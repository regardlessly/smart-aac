"""End-of-day presence summarization.

Runs as a scheduled job (default 10:05 PM) to:
1. Close all current SeniorPresence records
   (cap last_seen_at at CCTV_END_HOUR, set is_current=False)
2. Aggregate raw presences into DailyPresenceSummary rows
   (one row per senior per room per day)

Presence timestamps are stored in UTC; CCTV operating hours are in
local time. This module converts local hours → UTC for all queries.
"""

import logging
from datetime import date, datetime, timedelta, timezone

from ..extensions import db
from ..models.senior import Senior, SeniorPresence, DailyPresenceSummary
from ..models.room import Room

logger = logging.getLogger('daily_summary_service')


def _local_hour_to_utc(target_date, local_hour):
    """Convert a local-time hour on a given date to a naive UTC datetime.

    The database stores naive UTC datetimes, so we return naive UTC
    for direct comparison in queries.
    """
    local_tz = datetime.now(timezone.utc).astimezone().tzinfo
    local_dt = datetime(target_date.year, target_date.month, target_date.day,
                        local_hour, tzinfo=local_tz)
    utc_dt = local_dt.astimezone(timezone.utc)
    return utc_dt.replace(tzinfo=None)  # naive UTC for DB comparison


class DailySummaryService:

    @staticmethod
    def run_daily_summary(target_date=None, cctv_start_hour=7,
                          cctv_end_hour=22, close_presences=True):
        """Generate daily presence summaries for a given date.

        Args:
            target_date: The date to summarize (default: today).
            cctv_start_hour: Start of CCTV operating hours (local time, 24h).
            cctv_end_hour: End of CCTV operating hours (local time, 24h).
            close_presences: Whether to close current presences (only
                             for today's scheduled run, not backfill).
        """
        if target_date is None:
            target_date = date.today()

        logger.info('Generating daily summary for %s (CCTV hours: %d–%d)',
                    target_date, cctv_start_hour, cctv_end_hour)

        # Convert local CCTV hours to UTC for DB queries
        day_start = _local_hour_to_utc(target_date, cctv_start_hour)
        day_end = _local_hour_to_utc(target_date, cctv_end_hour)

        logger.info('UTC window: %s to %s', day_start, day_end)

        # ── Step 1: Close current presences (only for today) ─────────
        if close_presences and target_date == date.today():
            DailySummaryService._close_current_presences(day_end)

        # ── Step 2: Find all presences that overlap with the window ──
        # A presence overlaps if: arrived_at < day_end AND last_seen_at > day_start
        presences = SeniorPresence.query.filter(
            SeniorPresence.senior_id.isnot(None),
            SeniorPresence.status == 'identified',
            SeniorPresence.arrived_at < day_end,
            SeniorPresence.last_seen_at > day_start,
        ).all()

        logger.info('Found %d presence records overlapping %s',
                    len(presences), target_date)

        # ── Step 3: Aggregate per senior per room ────────────────────
        # key: (senior_id, room_id) → {total_seconds, session_count,
        #                               first_seen, last_seen}
        agg: dict[tuple[int, int], dict] = {}

        for p in presences:
            # Clip to today's CCTV operating window (UTC)
            eff_start = max(p.arrived_at, day_start)
            eff_end = min(p.last_seen_at, day_end)
            if eff_end <= eff_start:
                continue

            dur = (eff_end - eff_start).total_seconds()
            key = (p.senior_id, p.room_id)

            if key not in agg:
                agg[key] = {
                    'total_seconds': 0,
                    'session_count': 0,
                    'first_seen': eff_start,
                    'last_seen': eff_end,
                }

            agg[key]['total_seconds'] += dur
            agg[key]['session_count'] += 1

            if eff_start < agg[key]['first_seen']:
                agg[key]['first_seen'] = eff_start
            if eff_end > agg[key]['last_seen']:
                agg[key]['last_seen'] = eff_end

        # ── Step 4: Upsert DailyPresenceSummary rows ─────────────────
        created = 0
        updated = 0

        for (senior_id, room_id), data in agg.items():
            existing = DailyPresenceSummary.query.filter_by(
                senior_id=senior_id,
                room_id=room_id,
                date=target_date,
            ).first()

            if existing:
                existing.total_seconds = int(data['total_seconds'])
                existing.session_count = data['session_count']
                existing.first_seen = data['first_seen']
                existing.last_seen = data['last_seen']
                existing.generated_at = datetime.now(timezone.utc)
                updated += 1
            else:
                summary = DailyPresenceSummary(
                    senior_id=senior_id,
                    room_id=room_id,
                    date=target_date,
                    total_seconds=int(data['total_seconds']),
                    session_count=data['session_count'],
                    first_seen=data['first_seen'],
                    last_seen=data['last_seen'],
                )
                db.session.add(summary)
                created += 1

        db.session.commit()
        logger.info('Daily summary for %s: %d created, %d updated',
                    target_date, created, updated)

        return {
            'date': target_date.isoformat(),
            'presences_processed': len(presences),
            'summaries_created': created,
            'summaries_updated': updated,
            'total_summaries': created + updated,
        }

    @staticmethod
    def _close_current_presences(cutoff_time):
        """Close all is_current=True presences.

        Caps last_seen_at at cutoff_time (UTC) and sets is_current=False.
        """
        current = SeniorPresence.query.filter_by(is_current=True).all()
        closed = 0
        for p in current:
            if p.last_seen_at and p.last_seen_at > cutoff_time:
                p.last_seen_at = cutoff_time
            p.is_current = False
            closed += 1

        if closed:
            db.session.commit()
            logger.info('Closed %d current presence records', closed)

    @staticmethod
    def backfill(start_date, end_date=None, cctv_start_hour=7,
                 cctv_end_hour=22):
        """Generate summaries for a range of past dates.

        Useful for backfilling historical data when the system is first
        deployed or if the scheduled job was missed.
        """
        if end_date is None:
            end_date = date.today()

        results = []
        d = start_date
        while d <= end_date:
            result = DailySummaryService.run_daily_summary(
                target_date=d,
                cctv_start_hour=cctv_start_hour,
                cctv_end_hour=cctv_end_hour,
                close_presences=False,  # don't close during backfill
            )
            results.append(result)
            d += timedelta(days=1)

        logger.info('Backfill complete: %d days processed', len(results))
        return results
