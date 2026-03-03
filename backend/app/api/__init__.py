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
