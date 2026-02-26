import os

basedir = os.path.abspath(os.path.dirname(__file__))


class Config:
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        'DATABASE_URL',
        f'sqlite:///{os.path.join(basedir, "smart_aac.db")}'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    CORS_ORIGINS = ['http://localhost:3000']

    # Camera worker (default off for dev without cameras)
    CAMERA_WORKER_ENABLED = os.environ.get(
        'CAMERA_WORKER_ENABLED', 'false').lower() == 'true'
    CAMERA_WORKER_INTERVAL = int(
        os.environ.get('CAMERA_WORKER_INTERVAL', '5'))

    # Path to the existing face_recognizer POC
    FACE_RECOGNIZER_DIR = os.path.abspath(
        os.path.join(basedir, '..', '..', 'face_recognizer')
    )


class DevelopmentConfig(Config):
    DEBUG = True


class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    CAMERA_WORKER_ENABLED = False
