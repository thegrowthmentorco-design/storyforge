"""Symmetric encryption for stored secrets (M3.0 — landed early ahead of M3.4).

Today this is exercised only by tests — `UserSettings.anthropic_key_encrypted`
is the next consumer. Wired now so when M3.4 routes land, the crypto path is
already proven.

Operational notes:
  * `STORYFORGE_MASTER_KEY` must be a Fernet-encoded 32-byte key (44 chars,
    URL-safe base64). Generate one with `python -c "from cryptography.fernet
    import Fernet; print(Fernet.generate_key().decode())"`.
  * Rotating the key invalidates every previously-stored ciphertext; M3.4
    will re-encrypt on access if we add `MultiFernet` later.
  * In dev mode (no env var) we generate an *ephemeral* key and warn — every
    process restart loses encrypted secrets. Acceptable for local hacking.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger("storyforge.byok")

ENV_KEY = "STORYFORGE_MASTER_KEY"


def _resolve_key() -> bytes:
    raw = os.environ.get(ENV_KEY)
    if raw:
        return raw.encode()
    # Dev fallback. Stash on os.environ so subsequent calls in the same
    # process see the same key (otherwise every call would mint a new one
    # and decryption would fail immediately).
    new = Fernet.generate_key().decode()
    os.environ[ENV_KEY] = new
    log.warning(
        "%s not set — generated ephemeral key. Set in backend/.env to persist "
        "encrypted secrets across restarts.",
        ENV_KEY,
    )
    return new.encode()


@lru_cache(maxsize=1)
def _cipher() -> Fernet:
    return Fernet(_resolve_key())


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a UTF-8 string. Returns base64 ciphertext (also UTF-8)."""
    return _cipher().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str | None:
    """Decrypt a string produced by `encrypt_secret`. Returns None if the key
    has rotated or the ciphertext is corrupt — caller decides how to react."""
    try:
        return _cipher().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        log.warning("decrypt_secret: InvalidToken — key may have rotated")
        return None
