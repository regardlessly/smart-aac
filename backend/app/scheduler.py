"""APScheduler integration for daily presence summarization.

Registers a CronTrigger job that runs at DAILY_REPORT_HOUR:DAILY_REPORT_MINUTE
each day to generate DailyPresenceSummary records from raw presences.
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger('scheduler')

_scheduler = None


def init_scheduler(app):
    """Initialize and start the APScheduler with daily summary job."""
    global _scheduler

    if _scheduler is not None:
        logger.warning('Scheduler already initialized')
        return _scheduler

    report_hour = app.config.get('DAILY_REPORT_HOUR', 22)
    report_minute = app.config.get('DAILY_REPORT_MINUTE', 5)
    cctv_start = app.config.get('CCTV_START_HOUR', 7)
    cctv_end = app.config.get('CCTV_END_HOUR', 22)

    _scheduler = BackgroundScheduler(daemon=True)

    def _run_daily_summary():
        """Job function — runs inside app context."""
        with app.app_context():
            from .services.daily_summary_service import DailySummaryService
            try:
                result = DailySummaryService.run_daily_summary(
                    cctv_start_hour=cctv_start,
                    cctv_end_hour=cctv_end,
                )
                logger.info('Scheduled daily summary completed: %s', result)
            except Exception:
                logger.exception('Scheduled daily summary failed')

    _scheduler.add_job(
        _run_daily_summary,
        trigger=CronTrigger(hour=report_hour, minute=report_minute),
        id='daily_presence_summary',
        name='Daily Presence Summary',
        replace_existing=True,
    )

    _scheduler.start()
    logger.info('Scheduler started — daily summary at %02d:%02d',
                report_hour, report_minute)

    return _scheduler


def get_scheduler():
    """Return the current scheduler instance."""
    return _scheduler
