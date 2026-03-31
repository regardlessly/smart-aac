from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models.camera import Camera, CCTVSnapshot
from ..models.room import Room
from ..models.senior import (
    DailyPresenceSummary, Senior, SeniorPresence,
)
from .auth import login_required

bp = Blueprint('reports', __name__)


def _local_hour_to_utc(target_date, local_hour):
    """Convert a local-time hour on a given date to a naive UTC datetime."""
    local_tz = datetime.now(timezone.utc).astimezone().tzinfo
    local_dt = datetime(target_date.year, target_date.month, target_date.day,
                        local_hour, tzinfo=local_tz)
    utc_dt = local_dt.astimezone(timezone.utc)
    return utc_dt.replace(tzinfo=None)


def _merge_intervals(intervals):
    """Merge overlapping (start, end) intervals. Returns merged list."""
    if not intervals:
        return []
    sorted_iv = sorted(intervals, key=lambda x: x[0])
    merged = [sorted_iv[0]]
    for start, end in sorted_iv[1:]:
        if start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _aggregate_presences_by_room(presences, day_start, day_end):
    """Aggregate presence records into room_agg dict, merging overlapping intervals.

    Skips overnight carryover sessions (arrived before day_start) to avoid
    phantom duration from stale sessions that were never properly closed.

    Returns room_agg: {room_id: {room_name, duration_seconds, session_count, first_arrival}}
    """
    # Collect intervals per room
    room_intervals: dict[int, dict] = {}
    for _pid, room_id, room_name, arrived, last_seen in presences:
        rid = room_id or 0
        if not arrived or not last_seen:
            continue
        # Skip overnight carryover sessions — these are stale sessions from
        # the previous day that were never properly closed
        if arrived < day_start:
            continue
        eff_start = max(arrived, day_start)
        eff_end = min(last_seen, day_end)
        if eff_end <= eff_start:
            continue
        if rid not in room_intervals:
            room_intervals[rid] = {
                'room_name': room_name or 'Unknown',
                'intervals': [],
            }
        room_intervals[rid]['intervals'].append((eff_start, eff_end))

    # Merge overlapping intervals and compute totals
    room_agg: dict[int, dict] = {}
    for rid, data in room_intervals.items():
        merged = _merge_intervals(data['intervals'])
        total_secs = sum((e - s).total_seconds() for s, e in merged)
        room_agg[rid] = {
            'room_name': data['room_name'],
            'duration_seconds': total_secs,
            'session_count': len(merged),
            'first_arrival': merged[0][0],
        }
    return room_agg


# ── Daily Attendance Report ──────────────────────────────────────


@bp.route('/api/reports/daily-attendance')
@login_required
def daily_attendance():
    """List all seniors detected on a given day with first/last seen, rooms, duration.

    Uses DailyPresenceSummary for past dates, raw SeniorPresence for today.

    Query params:
        date – 'YYYY-MM-DD' (default: today)
    """
    date_str = request.args.get('date')
    if date_str:
        try:
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            target_date = date.today()
    else:
        target_date = date.today()

    cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
    cctv_end = current_app.config.get('CCTV_END_HOUR', 22)
    day_start = _local_hour_to_utc(target_date, cctv_start)
    day_end = _local_hour_to_utc(target_date, cctv_end)

    use_raw = (target_date == date.today())

    # Check if we have summaries for this date
    if not use_raw:
        summary_count = DailyPresenceSummary.query.filter(
            DailyPresenceSummary.date == target_date,
        ).count()
        if summary_count == 0:
            use_raw = True  # No summaries, fall back to raw

    attendees = []

    if use_raw:
        # Query raw presences for the day
        presences = SeniorPresence.query.outerjoin(
            Senior, SeniorPresence.senior_id == Senior.id,
        ).outerjoin(
            Room, SeniorPresence.room_id == Room.id,
        ).filter(
            SeniorPresence.status == 'identified',
            SeniorPresence.senior_id.isnot(None),
            SeniorPresence.arrived_at < day_end,
            SeniorPresence.last_seen_at >= day_start,
        ).with_entities(
            SeniorPresence.senior_id,
            Senior.name.label('senior_name'),
            SeniorPresence.room_id,
            Room.name.label('room_name'),
            SeniorPresence.arrived_at,
            SeniorPresence.last_seen_at,
            SeniorPresence.is_current,
        ).all()

        # Aggregate by senior
        senior_agg: dict[int, dict] = {}
        for sid, sname, rid, rname, arrived, last_seen, is_current in presences:
            if not arrived or not last_seen:
                continue
            if arrived < day_start:
                continue
            eff_start = max(arrived, day_start)
            eff_end = min(last_seen, day_end)
            if eff_end <= eff_start:
                continue
            if sid not in senior_agg:
                senior_agg[sid] = {
                    'senior_id': sid,
                    'senior_name': sname,
                    'first_seen': eff_start,
                    'last_seen': eff_end,
                    'rooms': set(),
                    'intervals': [],
                    'is_current': False,
                }
            agg = senior_agg[sid]
            agg['first_seen'] = min(agg['first_seen'], eff_start)
            agg['last_seen'] = max(agg['last_seen'], eff_end)
            if rname:
                agg['rooms'].add(rname)
            agg['intervals'].append((eff_start, eff_end))
            if is_current:
                agg['is_current'] = True

        for sid, agg in senior_agg.items():
            merged = _merge_intervals(agg['intervals'])
            total_secs = int(sum((e - s).total_seconds() for s, e in merged))
            attendees.append({
                'senior_id': agg['senior_id'],
                'senior_name': agg['senior_name'],
                'first_seen': agg['first_seen'].strftime('%I:%M %p'),
                'last_seen': agg['last_seen'].strftime('%I:%M %p'),
                'rooms': sorted(agg['rooms']),
                'duration_seconds': total_secs,
                'duration_formatted': (f'{total_secs // 3600}h '
                                       f'{(total_secs % 3600) // 60}m'),
                'session_count': len(merged),
                'status': 'present' if agg['is_current'] else 'departed',
            })
    else:
        # Use DailyPresenceSummary for past dates
        rows = db.session.query(
            DailyPresenceSummary.senior_id,
            Senior.name.label('senior_name'),
            func.sum(DailyPresenceSummary.total_seconds).label('total_seconds'),
            func.sum(DailyPresenceSummary.session_count).label('sessions'),
            func.min(DailyPresenceSummary.first_seen).label('first_seen'),
            func.max(DailyPresenceSummary.last_seen).label('last_seen'),
            func.group_concat(Room.name).label('room_names'),
        ).join(
            Senior, DailyPresenceSummary.senior_id == Senior.id,
        ).outerjoin(
            Room, DailyPresenceSummary.room_id == Room.id,
        ).filter(
            DailyPresenceSummary.date == target_date,
        ).group_by(
            DailyPresenceSummary.senior_id, Senior.name,
        ).all()

        for sid, sname, secs, sessions, first_s, last_s, rnames in rows:
            total_secs = int(secs or 0)
            rooms_list = sorted(set(
                r for r in (rnames or '').split(',') if r))
            attendees.append({
                'senior_id': sid,
                'senior_name': sname,
                'first_seen': (first_s.strftime('%I:%M %p')
                               if first_s else None),
                'last_seen': (last_s.strftime('%I:%M %p')
                              if last_s else None),
                'rooms': rooms_list,
                'duration_seconds': total_secs,
                'duration_formatted': (f'{total_secs // 3600}h '
                                       f'{(total_secs % 3600) // 60}m'),
                'session_count': int(sessions or 0),
                'status': 'departed',
            })

    # Sort by first_seen time (earliest first)
    attendees.sort(key=lambda a: a.get('first_seen') or '')

    # Summary stats
    total_seniors = len(attendees)
    total_secs_all = sum(a['duration_seconds'] for a in attendees)
    avg_duration = int(total_secs_all / total_seniors) if total_seniors else 0
    still_present = sum(1 for a in attendees if a['status'] == 'present')

    return jsonify({
        'date': target_date.isoformat(),
        'attendees': attendees,
        'summary': {
            'total_seniors': total_seniors,
            'still_present': still_present,
            'avg_duration': (f'{avg_duration // 3600}h '
                             f'{(avg_duration % 3600) // 60}m'),
            'total_duration': (f'{total_secs_all // 3600}h '
                               f'{(total_secs_all % 3600) // 60}m'),
        },
    })


# ── Room Occupancy Trending ──────────────────────────────────────


@bp.route('/api/reports/room-occupancy')
@login_required
def room_occupancy():
    """Daily unique people count per room.

    Uses DailyPresenceSummary for past dates and raw presences for today.

    Query params:
        range   – 'week' (default) or 'month'
        room_id – optional filter to a single room
    """
    range_param = request.args.get('range', 'week')
    room_id = request.args.get('room_id', type=int)

    today = date.today()
    if range_param == 'month':
        start_date = today - timedelta(days=30)
    else:
        start_date = today - timedelta(days=7)

    # Collect all rooms
    rooms_q = Room.query.order_by(Room.id)
    if room_id:
        rooms_q = rooms_q.filter(Room.id == room_id)
    rooms = rooms_q.all()
    room_list = [{'id': r.id, 'name': r.name} for r in rooms]
    room_ids = {r.id for r in rooms}

    # ── From DailyPresenceSummary: distinct seniors per room per day ──
    summary_query = db.session.query(
        DailyPresenceSummary.room_id,
        DailyPresenceSummary.date,
        func.count(func.distinct(
            DailyPresenceSummary.senior_id)).label('count'),
    ).filter(
        DailyPresenceSummary.date >= start_date,
        DailyPresenceSummary.date <= today,
    )
    if room_id:
        summary_query = summary_query.filter(
            DailyPresenceSummary.room_id == room_id)
    summary_query = summary_query.group_by(
        DailyPresenceSummary.room_id, DailyPresenceSummary.date)
    summary_rows = summary_query.all()

    # Build date→room→count map from summaries
    date_room: dict[str, dict[int, int]] = {}
    summarized_dates: set[str] = set()
    for rid, vdate, cnt in summary_rows:
        if rid not in room_ids:
            continue
        d = vdate.isoformat() if isinstance(vdate, date) else str(vdate)
        date_room.setdefault(d, {})
        date_room[d][rid] = date_room[d].get(rid, 0) + cnt
        summarized_dates.add(d)

    # ── For dates without summaries (e.g. today): fall back to raw ──
    cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
    start_dt = _local_hour_to_utc(start_date, cctv_start)
    end_dt = _local_hour_to_utc(today + timedelta(days=1), 0)

    # Raw identified presences
    date_col = func.date(SeniorPresence.arrived_at)
    raw_query = db.session.query(
        SeniorPresence.room_id,
        date_col.label('visit_date'),
        func.count(func.distinct(SeniorPresence.senior_id)).label('count'),
    ).filter(
        SeniorPresence.senior_id.isnot(None),
        SeniorPresence.status == 'identified',
        SeniorPresence.arrived_at >= start_dt,
        SeniorPresence.arrived_at < end_dt,
        SeniorPresence.room_id.isnot(None),
    )
    if room_id:
        raw_query = raw_query.filter(SeniorPresence.room_id == room_id)
    raw_query = raw_query.group_by(SeniorPresence.room_id, date_col)
    raw_rows = raw_query.all()

    for rid, vdate, cnt in raw_rows:
        if rid not in room_ids:
            continue
        d = str(vdate)
        if d in summarized_dates:
            continue  # already have summary data for this date
        date_room.setdefault(d, {})
        date_room[d][rid] = date_room[d].get(rid, 0) + cnt

    # Unidentified from snapshots (always raw — not in summary table)
    unid_date_col = func.date(CCTVSnapshot.timestamp)
    unid_query = db.session.query(
        Camera.room_id,
        unid_date_col.label('snap_date'),
        func.max(CCTVSnapshot.unidentified_count).label('max_unid'),
    ).join(
        Camera, CCTVSnapshot.camera_id == Camera.id,
    ).filter(
        Camera.room_id.isnot(None),
        CCTVSnapshot.timestamp >= start_dt,
        CCTVSnapshot.timestamp < end_dt,
    )
    if room_id:
        unid_query = unid_query.filter(Camera.room_id == room_id)
    unid_query = unid_query.group_by(Camera.room_id, unid_date_col)
    unid_rows = unid_query.all()

    for rid, sdate, max_unid in unid_rows:
        if rid not in room_ids:
            continue
        d = str(sdate)
        date_room.setdefault(d, {})
        date_room[d][rid] = date_room[d].get(rid, 0) + (max_unid or 0)

    # Fill series for all dates in range
    series = []
    d = start_date
    while d <= today:
        ds = d.isoformat()
        point: dict = {'date': ds}
        for r in rooms:
            point[f'room_{r.id}'] = date_room.get(ds, {}).get(r.id, 0)
        series.append(point)
        d += timedelta(days=1)

    # Summary stats
    peak_day = ''
    peak_count = 0
    busiest_room_id = None
    busiest_room_total = 0
    room_totals: dict[int, int] = {}
    total_all = 0

    for pt in series:
        day_total = sum(pt[f'room_{r.id}'] for r in rooms)
        if day_total > peak_count:
            peak_count = day_total
            peak_day = pt['date']
        for r in rooms:
            v = pt[f'room_{r.id}']
            room_totals[r.id] = room_totals.get(r.id, 0) + v
            total_all += v

    for rid, total in room_totals.items():
        if total > busiest_room_total:
            busiest_room_total = total
            busiest_room_id = rid

    busiest_name = ''
    for r in rooms:
        if r.id == busiest_room_id:
            busiest_name = r.name
            break

    num_days = max(1, len(series))

    return jsonify({
        'rooms': room_list,
        'series': series,
        'summary': {
            'peak_day': peak_day,
            'peak_count': peak_count,
            'busiest_room': busiest_name,
            'avg_per_day': round(total_all / num_days, 1),
        },
    })


# ── Member Summary ───────────────────────────────────────────────


@bp.route('/api/reports/member/<int:member_id>/summary')
@login_required
def member_summary(member_id):
    """Aggregated stats for a single member.

    Uses DailyPresenceSummary for accurate per-day metrics.
    Falls back to raw presences for today (not yet summarized).
    """
    senior = Senior.query.get_or_404(member_id)

    # ── From DailyPresenceSummary ──
    summaries = DailyPresenceSummary.query.filter(
        DailyPresenceSummary.senior_id == member_id,
    ).all()

    # Collect unique days and total seconds from summaries
    day_seconds: dict[date, float] = {}
    for s in summaries:
        day_seconds[s.date] = day_seconds.get(s.date, 0) + s.total_seconds

    # ── For today: always use raw presences (summary may be stale) ──
    today = date.today()
    cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
    cctv_end = current_app.config.get('CCTV_END_HOUR', 22)
    day_start = _local_hour_to_utc(today, cctv_start)
    day_end = _local_hour_to_utc(today, cctv_end)

    today_presences = SeniorPresence.query.filter(
        SeniorPresence.senior_id == member_id,
        SeniorPresence.status == 'identified',
        SeniorPresence.arrived_at < day_end,
        SeniorPresence.last_seen_at >= day_start,
    ).all()

    # Merge overlapping intervals to avoid double-counting
    # Skip overnight carryover sessions
    intervals = []
    for p in today_presences:
        if not p.arrived_at or not p.last_seen_at:
            continue
        if p.arrived_at < day_start:
            continue
        eff_start = max(p.arrived_at, day_start)
        eff_end = min(p.last_seen_at, day_end)
        if eff_end > eff_start:
            intervals.append((eff_start, eff_end))

    merged = _merge_intervals(intervals)
    today_secs = sum((e - s).total_seconds() for s, e in merged)
    if today_secs > 0:
        day_seconds[today] = today_secs

    total_days = len(day_seconds)
    total_secs = sum(day_seconds.values())
    avg_seconds = int(total_secs / total_days) if total_days else 0
    avg_formatted = f'{avg_seconds // 3600}h {(avg_seconds % 3600) // 60}m'

    # Last seen — check raw presences for most recent
    latest = SeniorPresence.query.filter(
        SeniorPresence.senior_id == member_id,
        SeniorPresence.status == 'identified',
    ).options(
        joinedload(SeniorPresence.room),
    ).order_by(SeniorPresence.last_seen_at.desc()).first()

    last_seen_room = None
    last_seen_at = None
    if latest and latest.last_seen_at:
        last_seen_room = latest.room.name if latest.room else None
        last_seen_at = latest.last_seen_at.isoformat() + 'Z'

    return jsonify({
        'senior_id': senior.id,
        'senior_name': senior.name,
        'registered_at': (senior.registered_at.isoformat()
                          if senior.registered_at else None),
        'total_visits': total_days,
        'avg_duration': avg_formatted,
        'last_seen_room': last_seen_room,
        'last_seen_at': last_seen_at,
    })


# ── Member Weekly Participation ──────────────────────────────────


@bp.route('/api/reports/member/<int:member_id>/weekly')
@login_required
def member_weekly(member_id):
    """Weekly participation for a single member.

    Uses DailyPresenceSummary for past dates.

    Query params:
        month – 'YYYY-MM' (default: current month)
    """
    senior = Senior.query.get_or_404(member_id)

    month_str = request.args.get('month')
    if month_str:
        try:
            year, month = map(int, month_str.split('-'))
        except (ValueError, AttributeError):
            year, month = date.today().year, date.today().month
    else:
        year, month = date.today().year, date.today().month

    month_start = date(year, month, 1)
    if month == 12:
        month_end = date(year + 1, 1, 1)
    else:
        month_end = date(year, month + 1, 1)

    # Build week boundaries
    weeks = []
    d = month_start
    week_num = 1
    while d < month_end:
        week_end = min(d + timedelta(days=7), month_end)
        weeks.append({
            'week': week_num,
            'label': f'Wk{week_num}',
            'start': d,
            'end': week_end,
        })
        d = week_end
        week_num += 1

    # ── From DailyPresenceSummary ──
    summaries = DailyPresenceSummary.query.outerjoin(
        Room, DailyPresenceSummary.room_id == Room.id,
    ).filter(
        DailyPresenceSummary.senior_id == member_id,
        DailyPresenceSummary.date >= month_start,
        DailyPresenceSummary.date < month_end,
    ).with_entities(
        DailyPresenceSummary.date,
        Room.name.label('room_name'),
    ).all()

    summarized_dates: set[date] = set()
    week_data: dict[int, dict] = {
        w['week']: {'days': set(), 'rooms': set()} for w in weeks
    }

    for s_date, rname in summaries:
        summarized_dates.add(s_date)
        for w in weeks:
            if w['start'] <= s_date < w['end']:
                week_data[w['week']]['days'].add(s_date)
                if rname:
                    week_data[w['week']]['rooms'].add(rname)
                break

    # ── For today: always merge raw presences (summary may be stale) ──
    today = date.today()
    if month_start <= today < month_end:
        cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
        cctv_end = current_app.config.get('CCTV_END_HOUR', 22)
        day_start = _local_hour_to_utc(today, cctv_start)
        day_end = _local_hour_to_utc(today, cctv_end)

        today_presences = SeniorPresence.query.outerjoin(
            Room, SeniorPresence.room_id == Room.id,
        ).filter(
            SeniorPresence.senior_id == member_id,
            SeniorPresence.status == 'identified',
            SeniorPresence.arrived_at < day_end,
            SeniorPresence.last_seen_at >= day_start,
        ).with_entities(
            Room.name.label('room_name'),
        ).all()

        if today_presences:
            for w in weeks:
                if w['start'] <= today < w['end']:
                    week_data[w['week']]['days'].add(today)
                    for (rname,) in today_presences:
                        if rname:
                            week_data[w['week']]['rooms'].add(rname)
                    break

    total_days = 0
    weeks_result = []
    for w in weeks:
        wd = week_data[w['week']]
        days_count = len(wd['days'])
        total_days += days_count
        end_display = w['end'] - timedelta(days=1)
        weeks_result.append({
            'week': w['week'],
            'label': w['label'],
            'start': w['start'].strftime('%d %b'),
            'end': end_display.strftime('%d %b'),
            'days_visited': days_count,
            'rooms': sorted(wd['rooms']),
        })

    return jsonify({
        'senior': {'id': senior.id, 'name': senior.name},
        'month': f'{year}-{month:02d}',
        'weeks': weeks_result,
        'total_days': total_days,
    })


# ── Member Duration per Day ──────────────────────────────────────


@bp.route('/api/reports/member/<int:member_id>/duration')
@login_required
def member_duration(member_id):
    """Duration per room for a single member on a specific date.

    Uses DailyPresenceSummary if available, falls back to raw presences.

    Query params:
        date – 'YYYY-MM-DD' (default: today)
    """
    senior = Senior.query.get_or_404(member_id)

    date_str = request.args.get('date')
    if date_str:
        try:
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            target_date = date.today()
    else:
        target_date = date.today()

    # ── Aggregate durations per room ──
    # Start with DailyPresenceSummary data
    summaries = DailyPresenceSummary.query.outerjoin(
        Room, DailyPresenceSummary.room_id == Room.id,
    ).filter(
        DailyPresenceSummary.senior_id == member_id,
        DailyPresenceSummary.date == target_date,
    ).with_entities(
        DailyPresenceSummary.room_id,
        Room.name.label('room_name'),
        DailyPresenceSummary.total_seconds,
        DailyPresenceSummary.session_count,
        DailyPresenceSummary.first_seen,
    ).order_by(Room.name).all()

    # room_id → {room_name, duration_seconds, session_count, first_arrival}
    room_agg: dict[int, dict] = {}

    # For today, always use raw presences (summaries may be stale)
    if target_date == date.today():
        cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
        cctv_end = current_app.config.get('CCTV_END_HOUR', 22)
        day_start = _local_hour_to_utc(target_date, cctv_start)
        day_end = _local_hour_to_utc(target_date, cctv_end)

        presences = SeniorPresence.query.outerjoin(
            Room, SeniorPresence.room_id == Room.id,
        ).filter(
            SeniorPresence.senior_id == member_id,
            SeniorPresence.status == 'identified',
            SeniorPresence.arrived_at < day_end,
            SeniorPresence.last_seen_at >= day_start,
        ).with_entities(
            SeniorPresence.id,
            SeniorPresence.room_id,
            Room.name.label('room_name'),
            SeniorPresence.arrived_at,
            SeniorPresence.last_seen_at,
        ).order_by(Room.name).all()

        room_agg = _aggregate_presences_by_room(presences, day_start, day_end)

    elif summaries:
        # Past date with summaries — use them
        for rid, room_name, dur, sess, first_seen in summaries:
            r = rid or 0
            room_agg[r] = {
                'room_name': room_name or 'Unknown',
                'duration_seconds': dur,
                'session_count': sess,
                'first_arrival': first_seen,
            }

    else:
        # Past date with no summaries — fall back to raw presences
        cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
        cctv_end = current_app.config.get('CCTV_END_HOUR', 22)
        day_start = _local_hour_to_utc(target_date, cctv_start)
        day_end = _local_hour_to_utc(target_date, cctv_end)

        presences = SeniorPresence.query.outerjoin(
            Room, SeniorPresence.room_id == Room.id,
        ).filter(
            SeniorPresence.senior_id == member_id,
            SeniorPresence.status == 'identified',
            SeniorPresence.arrived_at < day_end,
            SeniorPresence.last_seen_at >= day_start,
        ).with_entities(
            SeniorPresence.id,
            SeniorPresence.room_id,
            Room.name.label('room_name'),
            SeniorPresence.arrived_at,
            SeniorPresence.last_seen_at,
        ).order_by(Room.name).all()

        room_agg = _aggregate_presences_by_room(presences, day_start, day_end)

    # Build entries from aggregated data
    entries = []
    total_seconds = 0
    total_sessions = 0
    for rid, agg in sorted(room_agg.items(),
                            key=lambda x: x[1]['room_name']):
        dur = int(agg['duration_seconds'])
        total_seconds += dur
        total_sessions += agg['session_count']
        fa = agg['first_arrival']
        entries.append({
            'room_id': rid if rid != 0 else None,
            'room_name': agg['room_name'],
            'duration_seconds': dur,
            'duration_formatted': (f'{dur // 3600}h '
                                   f'{(dur % 3600) // 60}m'),
            'session_count': agg['session_count'],
            'first_arrival': (fa.strftime('%I:%M %p')
                              if fa else None),
        })

    return jsonify({
        'senior': {'id': senior.id, 'name': senior.name},
        'date': target_date.isoformat(),
        'entries': entries,
        'total_duration': (f'{total_seconds // 3600}h '
                           f'{(total_seconds % 3600) // 60}m'),
        'total_sessions': total_sessions,
    })


# ── Member Attendance Calendar ───────────────────────────────────


def _parse_month(month_str):
    """Parse 'YYYY-MM' string into (year, month) ints."""
    if month_str:
        try:
            year, month = map(int, month_str.split('-'))
            return year, month
        except (ValueError, AttributeError):
            pass
    return date.today().year, date.today().month


def _month_bounds(year, month):
    """Return (month_start, month_end) as date objects."""
    month_start = date(year, month, 1)
    if month == 12:
        month_end = date(year + 1, 1, 1)
    else:
        month_end = date(year, month + 1, 1)
    return month_start, month_end


def _today_raw_seconds_by_room(member_id):
    """Get today's raw presence seconds grouped by room for a member.

    Returns dict: room_id → {room_name, total_seconds}
    """
    today = date.today()
    cctv_start = current_app.config.get('CCTV_START_HOUR', 7)
    cctv_end = current_app.config.get('CCTV_END_HOUR', 22)
    day_start = _local_hour_to_utc(today, cctv_start)
    day_end = _local_hour_to_utc(today, cctv_end)

    presences = SeniorPresence.query.outerjoin(
        Room, SeniorPresence.room_id == Room.id,
    ).filter(
        SeniorPresence.senior_id == member_id,
        SeniorPresence.status == 'identified',
        SeniorPresence.arrived_at < day_end,
        SeniorPresence.last_seen_at >= day_start,
    ).with_entities(
        SeniorPresence.room_id,
        Room.name.label('room_name'),
        SeniorPresence.arrived_at,
        SeniorPresence.last_seen_at,
    ).all()

    # Collect intervals per room, then merge overlapping ones
    room_intervals: dict[int, dict] = {}
    for rid, rname, arrived, last_seen in presences:
        if not arrived or not last_seen:
            continue
        # Skip overnight carryover sessions
        if arrived < day_start:
            continue
        eff_start = max(arrived, day_start)
        eff_end = min(last_seen, day_end)
        if eff_end <= eff_start:
            continue
        key = rid or 0
        if key not in room_intervals:
            room_intervals[key] = {'room_name': rname or 'Unknown',
                                   'intervals': []}
        room_intervals[key]['intervals'].append((eff_start, eff_end))

    room_data: dict = {}
    for key, data in room_intervals.items():
        merged = _merge_intervals(data['intervals'])
        total_secs = sum((e - s).total_seconds() for s, e in merged)
        room_data[key] = {'room_name': data['room_name'],
                          'total_seconds': total_secs}

    return room_data


@bp.route('/api/reports/member/<int:member_id>/calendar')
@login_required
def member_calendar(member_id):
    """Attendance calendar heatmap for a single member.

    Returns per-day total seconds for the selected month.

    Query params:
        month – 'YYYY-MM' (default: current month)
    """
    senior = Senior.query.get_or_404(member_id)
    year, month = _parse_month(request.args.get('month'))
    month_start, month_end = _month_bounds(year, month)

    # From DailyPresenceSummary
    rows = db.session.query(
        DailyPresenceSummary.date,
        func.sum(DailyPresenceSummary.total_seconds).label('total_seconds'),
    ).filter(
        DailyPresenceSummary.senior_id == member_id,
        DailyPresenceSummary.date >= month_start,
        DailyPresenceSummary.date < month_end,
    ).group_by(DailyPresenceSummary.date).all()

    day_map: dict[str, int] = {}
    summarized_dates: set[date] = set()
    for d, secs in rows:
        day_map[d.isoformat()] = int(secs)
        summarized_dates.add(d)

    # Today fallback
    today = date.today()
    if month_start <= today < month_end and today not in summarized_dates:
        room_data = _today_raw_seconds_by_room(member_id)
        today_secs = sum(rd['total_seconds'] for rd in room_data.values())
        if today_secs > 0:
            day_map[today.isoformat()] = int(today_secs)

    # Build response
    days = [{'date': d, 'total_seconds': s} for d, s in sorted(day_map.items())]
    days_present = len(days)
    total_secs = sum(d['total_seconds'] for d in days)
    max_day = max(days, key=lambda x: x['total_seconds']) if days else None

    def _fmt_hrs(s):
        return f"{s // 3600}h {(s % 3600) // 60}m"

    return jsonify({
        'senior': {'id': senior.id, 'name': senior.name},
        'month': f'{year}-{month:02d}',
        'days': days,
        'summary': {
            'days_present': days_present,
            'total_hours': _fmt_hrs(total_secs),
            'max_day': {
                'date': max_day['date'],
                'hours': _fmt_hrs(max_day['total_seconds']),
            } if max_day else None,
        },
    })


# ── Member Favourite Rooms ───────────────────────────────────────


@bp.route('/api/reports/member/<int:member_id>/favourite-rooms')
@login_required
def member_favourite_rooms(member_id):
    """Favourite rooms breakdown for a single member.

    Aggregates total time per room across a month.

    Query params:
        month – 'YYYY-MM' (default: current month)
    """
    senior = Senior.query.get_or_404(member_id)
    year, month = _parse_month(request.args.get('month'))
    month_start, month_end = _month_bounds(year, month)

    rows = db.session.query(
        DailyPresenceSummary.room_id,
        Room.name.label('room_name'),
        func.sum(DailyPresenceSummary.total_seconds).label('total_seconds'),
        func.count(func.distinct(DailyPresenceSummary.date)).label('days_count'),
    ).outerjoin(
        Room, DailyPresenceSummary.room_id == Room.id,
    ).filter(
        DailyPresenceSummary.senior_id == member_id,
        DailyPresenceSummary.date >= month_start,
        DailyPresenceSummary.date < month_end,
    ).group_by(
        DailyPresenceSummary.room_id, Room.name,
    ).order_by(func.sum(DailyPresenceSummary.total_seconds).desc()).all()

    # Build room map
    room_map: dict[int, dict] = {}
    summarized_dates = set()
    for rid, rname, secs, days_cnt in rows:
        key = rid or 0
        room_map[key] = {
            'room_id': rid,
            'room_name': rname or 'Unknown',
            'total_seconds': int(secs),
            'days_count': days_cnt,
        }

    # Check if there are any summarized dates at all for this month
    if rows:
        s_dates = db.session.query(
            func.distinct(DailyPresenceSummary.date)
        ).filter(
            DailyPresenceSummary.senior_id == member_id,
            DailyPresenceSummary.date >= month_start,
            DailyPresenceSummary.date < month_end,
        ).all()
        summarized_dates = {d[0] for d in s_dates}

    # Today fallback
    today = date.today()
    if month_start <= today < month_end and today not in summarized_dates:
        raw_rooms = _today_raw_seconds_by_room(member_id)
        for rid_key, rd in raw_rooms.items():
            if rid_key in room_map:
                room_map[rid_key]['total_seconds'] += int(rd['total_seconds'])
                room_map[rid_key]['days_count'] += 1
            else:
                room_map[rid_key] = {
                    'room_id': rid_key if rid_key != 0 else None,
                    'room_name': rd['room_name'],
                    'total_seconds': int(rd['total_seconds']),
                    'days_count': 1,
                }

    total_all = sum(r['total_seconds'] for r in room_map.values())

    def _fmt_hrs(s):
        return f"{s // 3600}h {(s % 3600) // 60}m"

    rooms_list = sorted(room_map.values(),
                        key=lambda x: x['total_seconds'], reverse=True)
    for r in rooms_list:
        r['duration_formatted'] = _fmt_hrs(r['total_seconds'])
        r['percentage'] = round(r['total_seconds'] / total_all * 100,
                                1) if total_all else 0

    return jsonify({
        'senior': {'id': senior.id, 'name': senior.name},
        'month': f'{year}-{month:02d}',
        'rooms': rooms_list,
        'total_duration': _fmt_hrs(total_all),
    })


# ── Member Attendance Trend ──────────────────────────────────────


@bp.route('/api/reports/member/<int:member_id>/attendance-trend')
@login_required
def member_attendance_trend(member_id):
    """Weekly attendance trend over past N months.

    Query params:
        months – 1, 2, or 3 (default: 3)
    """
    senior = Senior.query.get_or_404(member_id)
    months_param = request.args.get('months', 3, type=int)
    months_param = min(max(months_param, 1), 6)

    today = date.today()
    start_date = today - timedelta(days=months_param * 30)

    rows = db.session.query(
        DailyPresenceSummary.date,
        func.sum(DailyPresenceSummary.total_seconds).label('total_seconds'),
    ).filter(
        DailyPresenceSummary.senior_id == member_id,
        DailyPresenceSummary.date >= start_date,
        DailyPresenceSummary.date <= today,
    ).group_by(DailyPresenceSummary.date).all()

    # Group by ISO week
    week_agg: dict[tuple, dict] = {}  # (iso_year, iso_week) → data
    for d, secs in rows:
        iso = d.isocalendar()
        key = (iso[0], iso[1])
        if key not in week_agg:
            # Find Monday of this ISO week
            monday = d - timedelta(days=iso[2] - 1)
            month_names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            week_agg[key] = {
                'iso_week': f'{iso[0]}-W{iso[1]:02d}',
                'week_label': f'W{iso[1]} {month_names[monday.month]}',
                'start_date': monday.isoformat(),
                'total_seconds': 0,
                'days_present': 0,
            }
        week_agg[key]['total_seconds'] += int(secs)
        week_agg[key]['days_present'] += 1

    # Today fallback
    if today not in {d for d, _ in rows}:
        raw_rooms = _today_raw_seconds_by_room(member_id)
        today_secs = sum(rd['total_seconds'] for rd in raw_rooms.values())
        if today_secs > 0:
            iso = today.isocalendar()
            key = (iso[0], iso[1])
            if key not in week_agg:
                monday = today - timedelta(days=iso[2] - 1)
                month_names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                week_agg[key] = {
                    'iso_week': f'{iso[0]}-W{iso[1]:02d}',
                    'week_label': f'W{iso[1]} {month_names[monday.month]}',
                    'start_date': monday.isoformat(),
                    'total_seconds': 0,
                    'days_present': 0,
                }
            week_agg[key]['total_seconds'] += int(today_secs)
            week_agg[key]['days_present'] += 1

    weeks = sorted(week_agg.values(), key=lambda w: w['iso_week'])
    for w in weeks:
        w['hours'] = round(w['total_seconds'] / 3600, 1)

    # Compute trend: compare last 4 weeks avg vs prior 4 weeks avg
    avg_weekly = 0
    trend = 'stable'
    if weeks:
        total_hrs = sum(w['hours'] for w in weeks)
        avg_weekly = round(total_hrs / len(weeks), 1)

        if len(weeks) >= 4:
            recent = sum(w['hours'] for w in weeks[-4:]) / 4
            prior = sum(w['hours'] for w in weeks[-8:-4]) / max(
                len(weeks[-8:-4]), 1) if len(weeks) > 4 else recent
            if prior > 0:
                change = (recent - prior) / prior
                if change < -0.2:
                    trend = 'declining'
                elif change > 0.2:
                    trend = 'increasing'

    return jsonify({
        'senior': {'id': senior.id, 'name': senior.name},
        'months': months_param,
        'weeks': weeks,
        'summary': {
            'avg_weekly_hours': avg_weekly,
            'trend': trend,
            'total_weeks': len(weeks),
        },
    })


# ── Member Peer Presence ─────────────────────────────────────────


@bp.route('/api/reports/member/<int:member_id>/peers')
@login_required
def member_peers(member_id):
    """Find members who most often share the same room & date.

    Query params:
        month – 'YYYY-MM' (default: current month)
    """
    senior = Senior.query.get_or_404(member_id)
    year, month = _parse_month(request.args.get('month'))
    month_start, month_end = _month_bounds(year, month)

    # Step 1: Get target senior's (room_id, date) pairs
    target_pairs = db.session.query(
        DailyPresenceSummary.room_id,
        DailyPresenceSummary.date,
    ).filter(
        DailyPresenceSummary.senior_id == member_id,
        DailyPresenceSummary.date >= month_start,
        DailyPresenceSummary.date < month_end,
        DailyPresenceSummary.room_id.isnot(None),
    ).all()

    if not target_pairs:
        return jsonify({
            'senior': {'id': senior.id, 'name': senior.name},
            'month': f'{year}-{month:02d}',
            'peers': [],
            'total_peers': 0,
        })

    pair_set = {(r, d) for r, d in target_pairs}
    room_ids = list({r for r, d in pair_set})
    dates = list({d for r, d in pair_set})

    # Step 2: Find other seniors sharing those (room, date) pairs
    other_rows = db.session.query(
        DailyPresenceSummary.senior_id,
        Senior.name.label('senior_name'),
        DailyPresenceSummary.room_id,
        Room.name.label('room_name'),
        DailyPresenceSummary.date,
    ).join(
        Senior, DailyPresenceSummary.senior_id == Senior.id,
    ).outerjoin(
        Room, DailyPresenceSummary.room_id == Room.id,
    ).filter(
        DailyPresenceSummary.senior_id != member_id,
        DailyPresenceSummary.room_id.in_(room_ids),
        DailyPresenceSummary.date.in_(dates),
    ).all()

    # Aggregate co-occurrences
    peer_map: dict[int, dict] = {}
    for sid, sname, rid, rname, d in other_rows:
        if (rid, d) not in pair_set:
            continue
        if sid not in peer_map:
            peer_map[sid] = {
                'senior_id': sid,
                'senior_name': sname,
                'co_occurrence_count': 0,
                'common_rooms': set(),
            }
        peer_map[sid]['co_occurrence_count'] += 1
        if rname:
            peer_map[sid]['common_rooms'].add(rname)

    # Sort and take top 20
    peers = sorted(peer_map.values(),
                   key=lambda x: -x['co_occurrence_count'])[:20]
    for p in peers:
        p['common_rooms'] = sorted(p['common_rooms'])

    return jsonify({
        'senior': {'id': senior.id, 'name': senior.name},
        'month': f'{year}-{month:02d}',
        'peers': peers,
        'total_peers': len(peer_map),
    })
