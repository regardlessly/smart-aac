import os

basedir = os.path.abspath(os.path.dirname(__file__))


class Config:
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        'DATABASE_URL',
        f'sqlite:///{os.path.join(basedir, "smart_aac.db")}'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:3100']

    # Authentication / JWT (fixed default for dev; set JWT_SECRET_KEY env var in production)
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'dev-secret-change-in-production')
    JWT_EXPIRY_HOURS = int(os.environ.get('JWT_EXPIRY_HOURS', '24'))

    # Odoo backend (for login proxy)
    ODOO_BASE_URL = os.environ.get(
        'ODOO_BASE_URL', 'https://caritahub-aac-dev.int.weeswares.com')
    ODOO_DB_NAME = os.environ.get('ODOO_DB_NAME', 'caritahub-aac-dev')
    ODOO_CENTRE_ID = os.environ.get('ODOO_CENTRE_ID', '9')

    # Camera worker (enabled by default — connects to real RTSP cameras)
    CAMERA_WORKER_ENABLED = os.environ.get(
        'CAMERA_WORKER_ENABLED', 'true').lower() == 'true'
    CAMERA_WORKER_INTERVAL = int(
        os.environ.get('CAMERA_WORKER_INTERVAL', '5'))

    # Data directory for known_faces, captures, output, models
    FACE_DATA_DIR = os.path.abspath(
        os.path.join(basedir, '..', 'data')
    )

    # FaceRecognizer tuning
    FR_CAPTURE_INTERVAL = int(
        os.environ.get('FR_CAPTURE_INTERVAL', '10'))
    FR_ANALYSE_EVERY = int(
        os.environ.get('FR_ANALYSE_EVERY', '1'))

    # CCTV operating hours (24h format)
    CCTV_START_HOUR = int(os.environ.get('CCTV_START_HOUR', '7'))   # 7 AM
    CCTV_END_HOUR = int(os.environ.get('CCTV_END_HOUR', '22'))     # 10 PM

    # Daily report generation hour (runs at this hour to summarize the day)
    DAILY_REPORT_HOUR = int(os.environ.get('DAILY_REPORT_HOUR', '11'))  # 11 AM
    DAILY_REPORT_MINUTE = int(os.environ.get('DAILY_REPORT_MINUTE', '45'))  # :45


class DevelopmentConfig(Config):
    DEBUG = True


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    CAMERA_WORKER_ENABLED = False
