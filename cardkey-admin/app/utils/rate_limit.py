"""进程内简易限流。"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import DefaultDict, Deque

_lock = Lock()
_buckets: DefaultDict[str, Deque[float]] = defaultdict(deque)


def _cleanup(bucket: Deque[float], cutoff: float) -> None:
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()


def is_rate_limited(key: str, *, limit: int, window_seconds: float) -> bool:
    if limit <= 0:
        return False
    window = max(float(window_seconds or 0), 0.001)
    now = time.monotonic()
    cutoff = now - window
    with _lock:
        bucket = _buckets[key]
        _cleanup(bucket, cutoff)
        if len(bucket) >= limit:
            return True
        bucket.append(now)
        return False


def reset_rate_limits() -> None:
    with _lock:
        _buckets.clear()
