import click
from flask import Flask
from flask_cors import CORS

from .extensions import db, migrate


def create_app(config_name=None):
    app = Flask(__name__)

    if config_name == 'testing':
        app.config.from_object('config.TestConfig')
    else:
        app.config.from_object('config.DevelopmentConfig')

    # Extensions
    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app, origins=app.config.get('CORS_ORIGINS', ['*']))

    # Import models so Alembic sees them
    from .models import (  # noqa: F401
        senior, room, activity, alert, locker, kiosk_event, camera, user,
    )

    # Register API blueprints
    from .api import register_blueprints
    register_blueprints(app)

    # CLI commands
    @app.cli.command('seed')
    @click.option('--force', is_flag=True, help='Drop and recreate all data')
    def seed_command(force):
        """Seed the database with stub data."""
        from .seed.seed_data import run_seed
        run_seed(force=force)
        click.echo('Database seeded successfully.')

    # Start camera worker if enabled (in background thread so server starts immediately)
    if app.config.get('CAMERA_WORKER_ENABLED', False):
        import threading

        def _start_camera_worker():
            with app.app_context():
                try:
                    from .services.camera_worker import CameraWorker
                    worker = CameraWorker(app)
                    worker.start()
                    app.camera_worker = worker
                    app.logger.info('Camera worker started successfully')
                except Exception as e:
                    app.logger.warning(f'Camera worker failed to start: {e}')

        t = threading.Thread(target=_start_camera_worker, daemon=True)
        t.start()

    # Start daily summary scheduler
    if config_name != 'testing':
        try:
            from .scheduler import init_scheduler
            init_scheduler(app)
        except Exception as e:
            app.logger.warning(f'Scheduler failed to start: {e}')

    return app
