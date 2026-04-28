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
from sqlmodel import Session

from db.models import UserSettings

log = logging.getLogger("storyforge.byok")

ENV_KEY = "STORYFORGE_MASTER_KEY"
BYOK_MODE_ENV = "STORYFORGE_BYOK_MODE"

# M3.4.6 — three deployment shapes:
#   strict  (default) — every user must BYOK. Server's ANTHROPIC_API_KEY is
#                       NOT used for live extraction; missing user key falls
#                       through to mock mode in extract.py.
#   managed           — server pays. ALL extractions use the server's
#                       ANTHROPIC_API_KEY. User-stored keys are ignored
#                       (Settings UI hides the BYOK form).
#   choice            — user can BYOK if they want; otherwise server's key
#                       fills the gap. Header > stored > env precedence.
_VALID_MODES = {"strict", "managed", "choice"}


def byok_mode() -> str:
    raw = (os.environ.get(BYOK_MODE_ENV) or "strict").strip().lower()
    if raw not in _VALID_MODES:
        log.warning("Invalid %s=%r — falling back to 'strict'", BYOK_MODE_ENV, raw)
        return "strict"
    return raw


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


def key_preview(plaintext: str) -> str:
    """Public-safe redaction for UI display: `••••<last 4>`. Empty for short keys."""
    if not plaintext or len(plaintext) < 4:
        return ""
    return "••••" + plaintext[-4:]


def resolve_user_byok(
    session: Session, user_id: str, header_override: str | None = None
) -> tuple[str | None, str | None]:
    """Pick the effective Anthropic key + model for a request.

    Returns `(api_key, model)`, either of which may be None — when api_key is
    None, extract.py drops into mock mode.

    Mode-aware precedence (M3.4.6, controlled by `STORYFORGE_BYOK_MODE`):
      strict  — header > stored UserSettings; env is NEVER used for extraction.
                The header path is preserved so "Test connection" still works
                without saving.
      managed — server's `ANTHROPIC_API_KEY` always wins; header + stored are
                ignored. (UserSettings.model_default still applies.)
      choice  — header > stored > env. The user can BYOK if they want, otherwise
                the server's key fills in.

    Model precedence is identical across modes: caller passes the request-header
    model separately and combines with the stored model_default returned here.
    """
    mode = byok_mode()
    row = session.get(UserSettings, user_id)
    stored_model = row.model_default if row else None

    if mode == "managed":
        return os.environ.get("ANTHROPIC_API_KEY"), stored_model

    # strict + choice both honour the header-first user path
    if header_override:
        return header_override, stored_model

    stored_key = (
        decrypt_secret(row.anthropic_key_encrypted)
        if row and row.anthropic_key_encrypted
        else None
    )
    if stored_key:
        return stored_key, stored_model

    if mode == "choice":
        # User didn't BYOK — fall back to server's key.
        return os.environ.get("ANTHROPIC_API_KEY"), stored_model

    # strict mode + no user key → mock mode
    return None, stored_model
