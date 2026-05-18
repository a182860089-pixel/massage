"""精简版配置：只读环境变量，没有数据库存储的全局配置。"""
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
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        ""
    )
    SQLALCHEMY_ECHO = _bool("SQLALCHEMY_ECHO", False)
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 1800,
    }

    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

    PLUGIN_RATE_LIMIT_WINDOW_SECONDS = _int("PLUGIN_RATE_LIMIT_WINDOW_SECONDS", 60)
    PLUGIN_RATE_LIMIT_MAX_REQUESTS = _int("PLUGIN_RATE_LIMIT_MAX_REQUESTS", 20)

    @classmethod
    def assert_valid(cls):
        if not cls.SQLALCHEMY_DATABASE_URI:
            raise RuntimeError(
                "DATABASE_URL 未设置，请在 .env 或环境变量中填写"
            )
