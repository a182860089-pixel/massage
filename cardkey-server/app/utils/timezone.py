"""中国时区工具，剥离自 seatpool/app/utils/timezone.py，去掉无关函数。"""
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
    aware = as_china_aware(dt)
    return aware.isoformat()


def parse_datetime_to_china_naive(value: Union[str, datetime, None]) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return as_china_naive(value)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except (ValueError, TypeError):
        return None
    return as_china_naive(dt)
