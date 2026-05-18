"""cardkey-admin 配置。"""
import os
from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return int(default)


class Config:
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ECHO = _bool("SQLALCHEMY_ECHO", False)
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 1800,
    }

    SECRET_KEY = os.environ.get("SECRET_KEY", "")
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

    PLUGIN_RATE_LIMIT_WINDOW_SECONDS = _int("PLUGIN_RATE_LIMIT_WINDOW_SECONDS", 60)
    PLUGIN_RATE_LIMIT_MAX_REQUESTS = _int("PLUGIN_RATE_LIMIT_MAX_REQUESTS", 20)
    ACTIVATION_RATE_LIMIT_WINDOW_SECONDS = _int("ACTIVATION_RATE_LIMIT_WINDOW_SECONDS", 60)
    ACTIVATION_RATE_LIMIT_MAX_REQUESTS = _int("ACTIVATION_RATE_LIMIT_MAX_REQUESTS", 10)

    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8  # 8h
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"

    @classmethod
    def assert_valid(cls):
        if not cls.SQLALCHEMY_DATABASE_URI:
            raise RuntimeError("DATABASE_URL 未设置")
        if not cls.SECRET_KEY:
            raise RuntimeError("SECRET_KEY 未设置")
