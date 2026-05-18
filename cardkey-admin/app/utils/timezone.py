"""中国时区工具，与 seatpool 行为一致。"""
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

CHINA_TZ = timezone(timedelta(hours=8))


def china_now() -> datetime:
    return datetime.now(CHINA_TZ).replace(tzinfo=None)


def now() -> datetime:
    return china_now()


def as_china_naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(CHINA_TZ)
    return dt.replace(tzinfo=None)


def as_china_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=CHINA_TZ)
    return dt.astimezone(CHINA_TZ)


def to_china_iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return as_china_aware(dt).isoformat()


def format_china_datetime(dt: Optional[datetime], fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    if dt is None:
        return "-"
    return as_china_naive(dt).strftime(fmt)


def format_china_date(dt: Optional[datetime]) -> str:
    return format_china_datetime(dt, "%Y-%m-%d")
