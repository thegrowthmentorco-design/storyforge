# Contributing to StoryForge

Thanks for working on this. The shape of the project (one engineer, one
roadmap in `PROJECT.md`) keeps the bar low: there's no committee, no
required reviewers — but a few conventions that make the diff history
useful to read 6 months from now.

## Branches

- `main` is the only long-lived branch. Render auto-deploys from it.
- For non-trivial changes, branch off `main` with a name like
  `m4.6-share-link` or `fix/stream-session-leak`. Merge via PR.
- For straight-line milestone work, committing directly to `main` is
  fine — the changelog in `PROJECT.md` is the audit trail.

## Commit messages

The history reads like the changelog reads:

```
<scope/milestone>: <one-line summary>

<body — what changed, why, trade-offs taken>

<one paragraph per major change, separated by blank lines>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Examples (real commits):
- `M4.6: share read-only links`
- `M0 polish: frontend Sentry + Vitest scaffold + token-log + cov baseline`
- `fix(stream): open fresh Session inside SSE generator (M5.3 regression)`

Scope prefixes:
- `<milestone-id>` (e.g. `M4.6`, `M5.3`) for new feature work
- `fix(<area>)` for bugfixes — `fix(stream)`, `fix(billing)`, `fix(env)`
- `docs:` for docs-only changes
- `chore:` for cleanup that touches no behaviour

The body should explain *why*, not just *what* — a reader can run
`git diff` for the what. If a trade-off was taken, name it explicitly.
Don't summarize what you did; the diff already does that.

## Pull requests

When raising a PR (rare — see "Branches" above), the description should
mirror the commit body: summary + 1-3 bullets of what changed and why,
plus a "test plan" checklist so the reviewer knows what was actually
exercised.

```
## Summary
- One-line of what + why

## Test plan
- [ ] pytest passes locally
- [ ] vite build clean
- [ ] manual smoke: <golden path you tried>
```

Don't sweat the format — the goal is "future me knows what to verify
when this re-surfaces in a bug report."

## Where to make changes

| You want to…                          | Touch…                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| Add a new API endpoint                | `backend/routers/<feature>.py` + mount in `main.py`    |
| Add a new DB column                   | `backend/db/models.py` + soft migration in `db/session.py`|
| Add a new artifact field              | `backend/models.py` (Pydantic) + `extract.py` prompt   |
| Add a new frontend page               | `frontend/src/pages/<Page>.jsx` + `App.jsx` route       |
| Add a new artifact card behaviour     | `frontend/src/components/ArtifactsPane.jsx`             |
| Add a new background service / module | `backend/services/<name>.py`                            |

## Running locally

```bash
# Backend
cd backend
.venv/bin/uvicorn main:app --reload --port 8001

# Frontend (separate terminal)
cd frontend
npm run dev
```

Vite proxies `/api/*` to `http://127.0.0.1:8001` so the SPA + backend feel
single-origin during dev (matches the production single-container deploy).

## Running tests

```bash
# Backend (26 tests, ~2s)
cd backend && .venv/bin/pytest

# With coverage report
cd backend && .venv/bin/pytest --cov=services --cov=routers --cov=extract

# Frontend (4 tests, ~1s)
cd frontend && npm test
```

CI runs both on every push + PR. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Skills + roadmap

`PROJECT.md` is the source of truth for what's planned + what's shipped.
Update it as you ship — the changelog at the bottom is the running narrative.
`DECISIONS.md` is for the "why we picked X over Y" calls that don't fit
in any commit body.

## Don't commit

- `**/.env` and `**/.env.*` (anything with secrets)
- `backend/storyforge.db` and any other `*.sqlite*` files (dev DB)
- `backend/uploads/` (local file fallback when R2 is off)
- Anything under `frontend/node_modules/` or `backend/.venv/`

The root `.gitignore` covers all of these. If you need to commit
something that matches one of these patterns, that's a sign the
something belongs elsewhere.
