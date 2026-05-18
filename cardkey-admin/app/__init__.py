"""Flask 应用工厂。"""
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

    # 触发模型注册（schema 由原 seatpool_prod 维护，activation_records 由本工程自管）
    from . import models  # noqa: F401

    # 蓝图
    from .api.activation import bp as activation_bp
    from .api.plugin_card_keys import bp as plugin_card_keys_bp
    from .web.views import bp as web_bp
    from .admin.views import bp as admin_bp

    app.register_blueprint(activation_bp)
    app.register_blueprint(plugin_card_keys_bp)
    app.register_blueprint(web_bp)
    app.register_blueprint(admin_bp)

    # 自动建表：仅创建 activation_records 等本工程新增表，不会影响 seatpool_prod 已有表
    with app.app_context():
        db.create_all()

    # CLI 工具
    from .cli import register_cli
    register_cli(app)

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    return app
