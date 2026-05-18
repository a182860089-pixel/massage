"""UI 显示助手：剩余天数 / 卡密文案 等。"""
from datetime import datetime
from math import ceil
from typing import Optional

from .timezone import as_china_naive, china_now


CARD_TYPE_LABELS = {
    "unlimited": "标准卡",
    "limited": "限用卡",
    "daypass": "日抛卡",
}

CARD_STATUS_LABELS = {
    "unused": "未激活",
    "active": "已激活",
    "expired": "已过期",
    "used_up": "已用完",
    "renewed": "已续费消耗",
    "disabled": "已禁用",
}


def card_type_label(card_type: str) -> str:
    return CARD_TYPE_LABELS.get(str(card_type or "").lower(), str(card_type or "-"))


def card_status_label(status: str) -> str:
    return CARD_STATUS_LABELS.get(str(status or "").lower(), str(status or "-"))


def remaining_days(expires_at: Optional[datetime]) -> Optional[int]:
    """统一计算「剩余 N 天」，对所有卡型一视同仁。返回 None 表示未激活/未知。"""
    normalized = as_china_naive(expires_at)
    if not normalized:
        return None
    diff_seconds = (normalized - china_now()).total_seconds()
    if diff_seconds <= 0:
        return 0
    return max(0, ceil(diff_seconds / 86400))


def remaining_hours(expires_at: Optional[datetime]) -> Optional[int]:
    normalized = as_china_naive(expires_at)
    if not normalized:
        return None
    diff_seconds = (normalized - china_now()).total_seconds()
    if diff_seconds <= 0:
        return 0
    return max(0, ceil(diff_seconds / 3600))


def mask_card_key(card_key: str) -> str:
    text = str(card_key or "")
    if len(text) <= 4:
        return text + "***"
    return text[:4] + "***"


def mask_email(email: str) -> str:
    text = str(email or "")
    if "@" not in text:
        return text
    local, domain = text.split("@", 1)
    if len(local) <= 2:
        return local + "***@" + domain
    return local[:2] + "***@" + domain
