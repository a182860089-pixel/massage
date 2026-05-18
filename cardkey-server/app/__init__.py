"""Flask 应用工厂"""
import logging

from flask import Flask

from config import Config

from .extensions import db


def create_app(config_class: type[Config] = Config) -> Flask:
    config_class.assert_valid()

    app = Flask(__name__)
    app.config.from_object(config_class)

    logging.basicConfig(level=getattr(logging, app.config.get("LOG_LEVEL", "INFO"), logging.INFO))

    db.init_app(app)

    # 触发模型注册（不创建表，schema 由原 seatpool 维护）
    from .models import card_key, plugin_card_binding, plugin_card_rebind_log, site_config, member  # noqa: F401

    from .api.plugin_card_keys import bp as plugin_card_keys_bp
    app.register_blueprint(plugin_card_keys_bp)

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    return app
