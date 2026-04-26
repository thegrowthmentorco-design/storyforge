"""Per-token rate limiting (M6.7.c).

In-process fixed-window counter keyed by API-token id. Suitable for our
single-Render-instance deployment; if we ever scale out, swap to a Redis-
backed store (the public surface — `check_and_record(token_id)` returning
`None` on OK or seconds-to-wait on hit — stays the same).

Why fixed-window over sliding-window or true token-bucket: simplicity wins
at this scale. We're protecting against runaway scripts ("for i in range(1
000000): post()") and noisy CI loops, not implementing a fair-queueing SLA.
A 60-second fixed window with a generous limit (60 req/min default) catches
real abuse without burning the kind of memory a sliding-window log would.

Limit is configurable via `STORYFORGE_API_RATE_LIMIT_PER_MINUTE` env var
(default 60). Set to 0 to disable entirely (useful in tests).

Cleanup: when the buckets dict gets above `_MAX_TRACKED`, drop entries
whose window has been expired for at least 60s. Cheap; runs at insert time
so a single big spike doesn't strand allocations.
"""

from __future__ import annotations

import logging
import os
import threading
import time

log = logging.getLogger("storyforge.rate_limit")

_DEFAULT_LIMIT = 60
_WINDOW_SECONDS = 60
_MAX_TRACKED = 5000   # well above any sane number of active tokens


def _limit() -> int:
    """Read the limit at call time so tests can override via env without
    needing to reload this module."""
    raw = os.environ.get("STORYFORGE_API_RATE_LIMIT_PER_MINUTE")
    if raw is None:
        return _DEFAULT_LIMIT
    try:
        return max(0, int(raw))
    except ValueError:
        return _DEFAULT_LIMIT


# bucket: token_id -> (window_start_unix, count)
_buckets: dict[str, tuple[float, int]] = {}
_lock = threading.Lock()


def _maybe_sweep_locked(now: float) -> None:
    """If we've grown past the cap, drop expired entries. Caller holds _lock."""
    if len(_buckets) <= _MAX_TRACKED:
        return
    cutoff = now - (_WINDOW_SECONDS + 60)  # one window past expiry
    stale = [k for k, (start, _) in _buckets.items() if start < cutoff]
    for k in stale:
        _buckets.pop(k, None)
    log.info("rate_limit sweep dropped %d/%d stale buckets", len(stale), len(_buckets) + len(stale))


def check_and_record(token_id: str) -> float | None:
    """Record one request against the bucket for `token_id`.

    Returns None when within the limit (request should proceed); otherwise
    returns the number of seconds the caller should wait (suitable for the
    `Retry-After` header). Limit of 0 disables the check entirely (returns
    None immediately).
    """
    limit = _limit()
    if limit <= 0:
        return None

    now = time.time()
    with _lock:
        start, count = _buckets.get(token_id, (now, 0))
        # Reset the window if the previous one has expired.
        if now - start >= _WINDOW_SECONDS:
            start, count = now, 0
        count += 1
        _buckets[token_id] = (start, count)
        _maybe_sweep_locked(now)
        if count > limit:
            # How long until the window resets?
            remaining = max(1, int(_WINDOW_SECONDS - (now - start)))
            return float(remaining)
    return None


def reset() -> None:
    """Test helper — clear the bucket dict between cases."""
    with _lock:
        _buckets.clear()
