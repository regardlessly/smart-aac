from .senior import Senior, SeniorPresence, DailyPresenceSummary
from .room import Room
from .activity import Activity
from .alert import Alert
from .locker import Locker
from .kiosk_event import KioskEvent
from .camera import Camera, CCTVSnapshot
from .user import User
from .app_config import AppConfig

__all__ = [
    'Senior', 'SeniorPresence', 'DailyPresenceSummary',
    'Room', 'Activity', 'Alert',
    'Locker', 'KioskEvent', 'Camera', 'CCTVSnapshot', 'User',
    'AppConfig',
]
