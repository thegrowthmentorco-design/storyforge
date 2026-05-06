"""M14.14 — Partial-JSON parser for streaming tool-use input.

Anthropic's `messages.stream()` emits tool inputs as a sequence of
`input_json_delta` events that each carry a string fragment of the
tool's JSON input. The fragments accumulate into a complete JSON
object by the end of the stream, but during streaming we want to
detect when individual top-level keys have FULLY closed so we can
emit them to the frontend as soon as they're ready.

This module provides one class — `StreamingTopLevelKeyExtractor` —
that you `feed()` chunks into and that returns newly-completed
top-level (key, value) pairs as they finish. It walks the buffer
char-by-char tracking JSON depth + string-state so it doesn't get
fooled by `{` / `}` / `,` characters inside string values.

It is NOT a general partial-JSON parser. It only finds top-level
keys of the root object. The DocumentDossier schema is flat at the
top level (every section is a direct field of the root), so this
covers the use case fully.

Failure mode: if Claude emits malformed JSON or unbalanced strings
mid-stream, the extractor stops emitting new keys until the buffer
becomes parseable again. The frontend just sees fewer
`section_ready` events; the final `complete` event still carries
the validated full payload.
"""

from __future__ import annotations

import json
import logging
from typing import Any

log = logging.getLogger(__name__)


class StreamingTopLevelKeyExtractor:
    """Feed JSON chunks; get back top-level (key, value) tuples as they
    finish closing.

    Usage:
        ex = StreamingTopLevelKeyExtractor()
        ex.feed('{"brief": {"summary": "hi"}, "tldr_la')
        # → [("brief", {"summary": "hi"})]
        ex.feed('dder": {"one_line": "do it"}}')
        # → [("tldr_ladder", {"one_line": "do it"})]
    """

    def __init__(self) -> None:
        self._buf: list[str] = []  # appended; joined lazily
        self._cursor: int = 0  # how far into the joined buf we've parsed
        self._opened_root: bool = False  # have we consumed the leading '{'?
        self._emitted: set[str] = set()  # keys we've already returned

    def feed(self, chunk: str) -> list[tuple[str, Any]]:
        """Append chunk; return list of newly-completed (key, value) pairs.

        Values are JSON-decoded — caller gets the actual dict / list /
        scalar, not the raw substring.
        """
        if not chunk:
            return []
        self._buf.append(chunk)
        return self._drain()

    def _joined(self) -> str:
        s = "".join(self._buf)
        # Collapse to a single string so future feeds work on contiguous data.
        # (Keeps _cursor indices valid across calls.)
        if len(self._buf) > 1:
            self._buf = [s]
        return s

    def _drain(self) -> list[tuple[str, Any]]:
        out: list[tuple[str, Any]] = []
        buf = self._joined()
        n = len(buf)
        i = self._cursor

        # 1. Skip until the root '{' if not yet seen.
        if not self._opened_root:
            while i < n and buf[i] != "{":
                i += 1
            if i >= n:
                self._cursor = i
                return out
            i += 1  # consume the '{'
            self._opened_root = True

        # 2. Repeatedly try to parse one (key, value) pair starting at i.
        while True:
            j = _skip_ws_commas(buf, i, n)
            if j >= n:
                self._cursor = i  # don't advance past where we couldn't start
                return out
            # Closing brace of the root → done.
            if buf[j] == "}":
                self._cursor = j + 1
                return out

            # Need a string key.
            if buf[j] != '"':
                # Malformed (or whitespace we missed) — stop, retry on next feed.
                self._cursor = i
                return out

            key_end = _scan_string(buf, j, n)
            if key_end is None:
                # Key still streaming.
                self._cursor = i
                return out
            key = json.loads(buf[j:key_end])

            # Skip ws + ':'
            k = _skip_ws(buf, key_end, n)
            if k >= n or buf[k] != ":":
                self._cursor = i
                return out
            k += 1
            k = _skip_ws(buf, k, n)
            if k >= n:
                self._cursor = i
                return out

            # Scan one JSON value starting at k.
            value_end = _scan_value(buf, k, n)
            if value_end is None:
                # Value still streaming. Stop here; come back on next feed.
                self._cursor = i
                return out

            # Got a full value. Decode and emit (if not already).
            value_str = buf[k:value_end]
            try:
                value = json.loads(value_str)
            except json.JSONDecodeError as e:
                # Should be rare — _scan_value tracks depth and strings, so a
                # value it considers complete should parse. Log and skip.
                log.warning("partial-json: failed to decode key=%r value=%r: %s",
                            key, value_str[:80], e)
                # Advance past this key to avoid re-scanning it forever.
                i = value_end
                continue

            if key not in self._emitted:
                self._emitted.add(key)
                out.append((key, value))

            # Advance past this pair and keep going.
            i = value_end


# -----------------------------------------------------------------------------
# Internal scanners
# -----------------------------------------------------------------------------


def _skip_ws(buf: str, i: int, n: int) -> int:
    while i < n and buf[i] in " \t\n\r":
        i += 1
    return i


def _skip_ws_commas(buf: str, i: int, n: int) -> int:
    while i < n and buf[i] in " \t\n\r,":
        i += 1
    return i


def _scan_string(buf: str, i: int, n: int) -> int | None:
    """Given buf[i] == '"', return index just past the closing quote, or
    None if the string is incomplete."""
    assert buf[i] == '"'
    j = i + 1
    while j < n:
        ch = buf[j]
        if ch == "\\":
            j += 2  # skip escaped char
            continue
        if ch == '"':
            return j + 1
        j += 1
    return None


def _scan_value(buf: str, i: int, n: int) -> int | None:
    """Scan one JSON value starting at i. Return index just past the value,
    or None if the value is incomplete."""
    if i >= n:
        return None
    ch = buf[i]

    if ch == '"':
        return _scan_string(buf, i, n)

    if ch in "{[":
        depth = 1
        in_str = False
        escape = False
        j = i + 1
        while j < n:
            c = buf[j]
            if escape:
                escape = False
                j += 1
                continue
            if in_str:
                if c == "\\":
                    escape = True
                elif c == '"':
                    in_str = False
                j += 1
                continue
            if c == '"':
                in_str = True
            elif c in "{[":
                depth += 1
            elif c in "}]":
                depth -= 1
                if depth == 0:
                    return j + 1
            j += 1
        return None

    # Scalar — number, true, false, null. Scan until we hit a terminator.
    j = i
    while j < n and buf[j] not in ",}] \t\n\r":
        j += 1
    if j >= n:
        # Could be that the scalar is still streaming OR we hit EOF mid-value.
        # Conservative: treat as incomplete.
        return None
    return j
