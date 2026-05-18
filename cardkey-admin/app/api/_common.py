"""API 通用辅助：请求字段解析、限流、客户端 IP。"""
import re

from flask import current_app, request

from ..utils.rate_limit import is_rate_limited

_EMAIL_PATTERN = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def validate_email(email: str) -> bool:
    return bool(_EMAIL_PATTERN.match(email or ""))


def get_client_ip() -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return (request.remote_addr or "").strip()


def get_user_agent() -> str:
    return (request.headers.get("User-Agent") or "").strip()[:256]


def plugin_rate_limited(card_key: str, email: str) -> bool:
    window = int(current_app.config.get("PLUGIN_RATE_LIMIT_WINDOW_SECONDS", 60))
    limit = int(current_app.config.get("PLUGIN_RATE_LIMIT_MAX_REQUESTS", 20))
    return _rate_limited("plugin_card", card_key, email, window=window, limit=limit)


def activation_rate_limited(card_key: str, email: str) -> bool:
    window = int(current_app.config.get("ACTIVATION_RATE_LIMIT_WINDOW_SECONDS", 60))
    limit = int(current_app.config.get("ACTIVATION_RATE_LIMIT_MAX_REQUESTS", 10))
    return _rate_limited("activation", card_key, email, window=window, limit=limit)


def _rate_limited(prefix: str, card_key: str, email: str, *, window: int, limit: int) -> bool:
    identifiers = [
        get_client_ip(),
        str(card_key or "").strip(),
        str(email or "").strip().lower(),
    ]
    for identifier in identifiers:
        if not identifier:
            continue
        if is_rate_limited(f"{prefix}:{identifier}", limit=limit, window_seconds=window):
            return True
    return False
