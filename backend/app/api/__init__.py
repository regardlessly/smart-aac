def register_blueprints(app):
    from .auth import bp as auth_bp
    from .dashboard import bp as dashboard_bp
    from .seniors import bp as seniors_bp
    from .rooms import bp as rooms_bp
    from .activities import bp as activities_bp
    from .alerts import bp as alerts_bp
    from .lockers import bp as lockers_bp
    from .kiosk_events import bp as kiosk_events_bp
    from .cameras import bp as cameras_bp
    from .sse import bp as sse_bp
    from .reports import bp as reports_bp
    from .summary import bp as summary_bp
    from .logs import bp as logs_bp
    from .settings import bp as settings_bp
    from .app_config import bp as app_config_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(seniors_bp)
    app.register_blueprint(rooms_bp)
    app.register_blueprint(activities_bp)
    app.register_blueprint(alerts_bp)
    app.register_blueprint(lockers_bp)
    app.register_blueprint(kiosk_events_bp)
    app.register_blueprint(cameras_bp)
    app.register_blueprint(sse_bp)
    app.register_blueprint(reports_bp)
    app.register_blueprint(summary_bp)
    app.register_blueprint(logs_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(app_config_bp)
