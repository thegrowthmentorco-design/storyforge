/* ------------------------------------------------------------------ */
/* Token getter — App.jsx populates this on mount via useAuth().getToken.
   Stashed at module scope so the existing api.* functions stay
   sync-callable. Default returns null so calls before mount don't crash. */
let _tokenGetter = async () => null

export function setTokenGetter(fn) {
  _tokenGetter = fn || (async () => null)
}
/* ------------------------------------------------------------------ */

/** Build per-request headers — just the Clerk bearer.
 *
 *  As of M3.4.5, BYOK key + model_default are stored server-side per user
 *  and pulled at request time inside the route handlers. The frontend no
 *  longer needs to ferry them on every call. The single exception is
 *  `testApiKey` below, which deliberately sends X-Anthropic-Key for a
 *  one-shot key validation that doesn't touch the saved value. */
async function authHeaders() {
  const h = {}
  try {
    const token = await _tokenGetter()
    if (token) h['Authorization'] = `Bearer ${token}`
  } catch {
    /* getToken can throw on session expiry; let the request proceed and 401 */
  }
  return h
}

/**
 * Wrapper around fetch that always attaches auth headers.
 * Call sites pass `headers` for content-type or extras; auth is merged in.
 */
async function apiFetch(path, { headers, ...rest } = {}) {
  const auth = await authHeaders()
  return fetch(path, { ...rest, headers: { ...auth, ...(headers || {}) } })
}

async function readError(res) {
  let detail = `${res.status} ${res.statusText}`
  try {
    const body = await res.json()
    if (body?.detail) detail = body.detail
  } catch {
    /* not JSON */
  }
  return detail
}

/** Raise on non-2xx. Errors carry `.status` so callers can branch on it.
 *
 *  M3.5: paywall responses use a structured `detail: {paywall: true, ...}`
 *  shape (see services/limits.py + DECISIONS.md). When detected, we attach
 *  the whole payload to `err.paywall` so callers can show the upgrade modal
 *  without re-parsing the message string. */
async function jsonOrThrow(res) {
  if (!res.ok) {
    let body = null
    try { body = await res.json() } catch { /* not JSON */ }
    const detail = body?.detail
    const isPaywall = detail && typeof detail === 'object' && detail.paywall === true
    const message = isPaywall
      ? (detail.message || 'Plan limit reached')
      : (typeof detail === 'string' ? detail : `${res.status} ${res.statusText}`)
    const err = new Error(message)
    err.status = res.status
    if (isPaywall) err.paywall = detail
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

// ---------- extraction ----------

/** Build the multipart form body shared by extract + extractStream.
 *  M7.5: `file` accepts a single File, an array of Files, or a FileList —
 *  each file is appended as a separate `file` form field, which FastAPI
 *  parses into a list[UploadFile] on the backend. Single-file uploads
 *  produce a one-element list (backward compatible). */
function buildExtractForm({ file, text, filename, projectId, lens } = {}) {
  const form = new FormData()
  const files = file == null ? [] : (Array.isArray(file) || file instanceof FileList) ? Array.from(file) : [file]
  for (const f of files) {
    if (f) form.append('file', f, f.name)
  }
  if (text) form.append('text', text)
  if (filename) form.append('filename', filename)
  if (projectId) form.append('project_id', projectId)
  // M14.1.b — lens dispatcher. Backend defaults to 'dossier' for new uploads
  // (the M14 narrated dossier); 'stories' kept for back-compat with any
  // caller that explicitly wants the legacy user-stories shape.
  if (lens) form.append('lens', lens)
  return form
}

/** Create a new extraction. Backend persists and returns the full ExtractionRecord. */
export async function extract({ file, text, filename, projectId, lens } = {}) {
  const res = await apiFetch('/api/extract', {
    method: 'POST',
    body: buildExtractForm({ file, text, filename, projectId, lens }),
  })
  return jsonOrThrow(res)
}

/**
 * Streaming variant of extract (M5.3). Same input shape; instead of
 * returning the final record, dispatches SSE events through callbacks
 * and resolves with the final ExtractionRecord on `complete`.
 *
 * Pre-flight failures (paywall, oversize, bad file type) come back as
 * normal HTTPErrors *before* streaming starts (response.ok=false) — we
 * convert those via jsonOrThrow so callers get the same `err.paywall`
 * shape as the non-streaming endpoint. Stream-time errors (rate limit,
 * model crash) arrive as `error` SSE events and reject with the same
 * Error shape.
 *
 * Callbacks (all optional):
 *   onStart({id, filename})  — fired once when the server confirms
 *   onUsage({input, output, max}) — fired repeatedly as tokens arrive
 *
 * M5.4.2 — pass `signal` (an AbortController.signal) to support a Stop
 * button. When aborted: fetch rejects, the SSE reader unwinds, we throw
 * an Error with `name: 'AbortError'` so the caller can show "Stopped"
 * instead of "Failed". Backend sees the disconnected client + cleans up
 * the Anthropic stream as the generator's `with` block exits.
 */
export async function extractStream(
  { file, text, filename, projectId, lens } = {},
  { onStart, onUsage, onSection, onStage, signal, stallTimeoutMs = 60_000 } = {},
) {
  const { readSSE } = await import('./lib/sse.js')

  const form = buildExtractForm({ file, text, filename, projectId, lens })

  // M14.14.d — stall detector. Some failure modes (Render proxy idle
  // timeout, transient Anthropic hang) cut the stream silently — no
  // `error`, no `complete`, just dead air. Without this the user is
  // stuck on the loading screen forever. We own an AbortController whose
  // signal is what we hand to apiFetch; we forward the caller's `signal`
  // (user Stop) AND a reset-on-event watchdog timer into it. Either path
  // can abort the fetch.
  const ownController = new AbortController()
  let stalled = false
  if (signal) {
    if (signal.aborted) ownController.abort()
    else signal.addEventListener('abort', () => ownController.abort(), { once: true })
  }
  let stallTimer = null
  const armStallTimer = () => {
    if (!stallTimeoutMs) return
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      stalled = true
      ownController.abort()
    }, stallTimeoutMs)
  }
  armStallTimer()

  const res = await apiFetch('/api/extract/stream', {
    method: 'POST',
    body: form,
    signal: ownController.signal,
  })
  if (!res.ok) {
    clearTimeout(stallTimer)
    return jsonOrThrow(res)
  }

  let finalRecord = null
  let streamError = null
  let lastEventName = null

  try {
    await readSSE(res, (name, data) => {
      armStallTimer()  // any event resets the watchdog
      lastEventName = name
      if (name === 'start') onStart?.(data)
      else if (name === 'usage') onUsage?.(data)
      // M14.14 — progressive section reveal. Backend emits one
      // `section_ready` event per top-level dossier key as it finishes
      // streaming. Caller passes onSection({key, value}) to mount sections
      // before the full payload arrives.
      else if (name === 'section_ready') onSection?.(data)
      // M14.17 — pipeline stage events ({name: 'router'|'extractor'|...,
      // detail: {...}}). Only fired for lens='pipeline'.
      else if (name === 'stage') onStage?.(data)
      else if (name === 'complete') finalRecord = data
      else if (name === 'error') streamError = data
    })
  } catch (err) {
    // Abort flows through here as a DOMException. Distinguish:
    //   - user-initiated abort → re-throw as AbortError (caller toasts "cancelled")
    //   - stall watchdog abort → throw a typed StallError so the caller
    //     can surface a different message
    if (err?.name === 'AbortError' && stalled) {
      const e = new Error(
        `Extraction stalled — no progress for ${Math.round(stallTimeoutMs / 1000)}s. `
        + `Last event was "${lastEventName || 'none'}". Please try again.`,
      )
      e.status = 504
      e.stalled = true
      throw e
    }
    if (err?.name === 'AbortError') throw err
    throw err
  } finally {
    clearTimeout(stallTimer)
  }

  if (streamError) {
    const err = new Error(streamError.detail || 'Extraction failed')
    err.status = streamError.status || 500
    throw err
  }
  if (!finalRecord) throw new Error('Stream ended without a complete event')
  return finalRecord
}

/** List extraction summaries. Newest first. */
export async function listExtractionsApi({ q, projectId, limit, offset } = {}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (projectId) params.set('project_id', projectId)
  if (limit != null) params.set('limit', String(limit))
  if (offset != null) params.set('offset', String(offset))
  const qs = params.toString()
  const res = await apiFetch(`/api/extractions${qs ? `?${qs}` : ''}`)
  return jsonOrThrow(res)
}

/** Full record by id. Throws on 404. */
export async function getExtractionApi(id) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}`)
  return jsonOrThrow(res)
}

/** Delete one. Resolves on 204. */
export async function deleteExtractionApi(id) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return jsonOrThrow(res)
}

// ============================================================================
// M14.4 — chat with a document
// ============================================================================

/** List the chat thread for an extraction. Returns array ordered by
 *  created_at ASC. */
export async function listChatMessagesApi(id) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}/chat`)
  return jsonOrThrow(res)
}

/** Stream a chat reply. SSE events:
 *    onText({delta})   — partial text as it streams
 *    onComplete(msg)   — full assistant message persisted server-side
 *  Returns a Promise that resolves on `complete` or rejects on `error` /
 *  network failure. Pass an AbortController.signal to support a Stop button.
 */
export async function sendChatMessageStream(
  id,
  content,
  { onText, onComplete, signal } = {},
) {
  const { readSSE } = await import('./lib/sse.js')
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal,
  })
  if (!res.ok) return jsonOrThrow(res)
  let final = null
  await readSSE(res, (eventName, data) => {
    if (eventName === 'text') onText?.(data)
    else if (eventName === 'complete') {
      final = data
      onComplete?.(data)
    } else if (eventName === 'error') {
      const err = new Error(data.detail || 'Chat failed')
      err.status = data.status
      throw err
    }
  })
  return final
}

/** Stream a persona-rewritten set of plain-English sections.
 *  SSE events: stage, complete{persona, sections}, error.
 */
export async function regeneratePersonaStream(id, persona, { onStage, onComplete, signal } = {}) {
  const { readSSE } = await import('./lib/sse.js')
  const res = await apiFetch(
    `/api/extractions/${encodeURIComponent(id)}/persona/${encodeURIComponent(persona)}`,
    { method: 'POST', signal },
  )
  if (!res.ok) return jsonOrThrow(res)
  let final = null
  await readSSE(res, (eventName, data) => {
    if (eventName === 'stage') onStage?.(data)
    else if (eventName === 'complete') {
      final = data
      onComplete?.(data)
    } else if (eventName === 'error') {
      const err = new Error(data.detail || 'Persona rewrite failed')
      err.status = data.status
      throw err
    }
  })
  return final
}

/** Evaluate the what-if simulator with a values payload.
 *  Returns { result: SimulationResult, usage: {...} }.
 */
export async function simulateApi(id, values) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  return jsonOrThrow(res)
}

/** Clear all messages in the chat thread for an extraction. */
export async function clearChatApi(id) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}/chat`, { method: 'DELETE' })
  if (!res.ok) await jsonOrThrow(res)
  return null
}

/** M4.5.3.b — mark an extraction as read for the calling user. Upserts
 *  the (user, extraction) ExtractionView row with last_seen_at = now.
 *  Returns nothing; subsequent GET /api/extractions/{id} responses will
 *  show unread_comment_count: 0 until a new comment lands. */
export async function markExtractionSeenApi(id) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}/seen`, { method: 'POST' })
  if (!res.ok) await jsonOrThrow(res)
  return null
}

/** Partial update (filename, project_id). */
export async function patchExtractionApi(id, patch) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return jsonOrThrow(res)
}

/** Bulk-import a localStorage record. Idempotent on the same id. */
export async function importExtractionApi(record) {
  const res = await apiFetch('/api/extractions/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })
  return jsonOrThrow(res)
}

/** M6.1 — fetch a DOCX rendering of an extraction and trigger save.
 *  Server-side because python-docx is already installed (vs a 250 KB
 *  client-side lib). Returns nothing (side-effect: download). */
export async function downloadExtractionDocxApi(id) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}/export.docx`)
  if (!res.ok) {
    const err = new Error(await readError(res))
    err.status = res.status
    throw err
  }
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') || ''
  const match = cd.match(/filename="([^"]+)"/)
  const filename = match ? match[1] : 'extraction.docx'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Download an original uploaded source file (M7.5.b — multi-doc).
 *
 *  Path: GET /api/extractions/{id}/sources/{idx} — 0-based index into
 *  `extraction.source_file_paths`. Backend either streams the file (local-
 *  disk) or 302-redirects to a presigned R2 URL (`fetch` follows the redirect
 *  with Authorization stripped on cross-origin, which is exactly what we
 *  want — the presign doesn't need auth).
 *
 *  Filename comes from Content-Disposition. Returns nothing (side-effect:
 *  triggers a browser download). Throws on non-2xx so callers can toast.
 */
export async function downloadExtractionSourceApi(id, idx, fallbackName = 'source') {
  const res = await apiFetch(
    `/api/extractions/${encodeURIComponent(id)}/sources/${idx}`,
  )
  if (!res.ok) {
    const err = new Error(await readError(res))
    err.status = res.status
    throw err
  }
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') || ''
  const match = cd.match(/filename="([^"]+)"/)
  const filename = match ? match[1] : fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Re-run extraction on the same source. Uses current header model + key. */
export async function rerunExtractionApi(id) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}/rerun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  return jsonOrThrow(res)
}

// ---------- share links (M4.6) ----------

/** Get the active share token for an extraction, or null if none exists.
 *  Owner-side; requires Clerk auth + ownership of the extraction. */
export async function getShareApi(extractionId) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(extractionId)}/share`)
  return jsonOrThrow(res)
}

/** Create or rotate the share token. Any existing active token is revoked
 *  (single-active-token model). Returns the new {token, ...} record. */
export async function createShareApi(extractionId) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(extractionId)}/share`, {
    method: 'POST',
  })
  return jsonOrThrow(res)
}

/** Revoke all active tokens for this extraction. Idempotent. */
export async function revokeShareApi(extractionId) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(extractionId)}/share`, {
    method: 'DELETE',
  })
  if (!res.ok) await jsonOrThrow(res)
  return null
}

/** Public read of a shared extraction by token. NO auth header.
 *  We hit `fetch` directly (not apiFetch) so we don't accidentally send a
 *  stale Clerk JWT and confuse the public route. */
export async function fetchSharedExtraction(token) {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}`)
  return jsonOrThrow(res)
}

// ---------- comments (M4.5) ----------

/** All comments on an extraction. Oldest first. */
export async function listCommentsApi(extractionId) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(extractionId)}/comments`)
  return jsonOrThrow(res)
}

/** Create a comment on a specific artifact. target_kind: 'brief' | 'story'. */
export async function createCommentApi(extractionId, { target_kind, target_key = '', body }) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(extractionId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_kind, target_key, body }),
  })
  return jsonOrThrow(res)
}

/** Edit own comment. Backend stamps edited_at. */
export async function patchCommentApi(commentId, body) {
  const res = await apiFetch(`/api/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  return jsonOrThrow(res)
}

/** Delete own comment. */
export async function deleteCommentApi(commentId) {
  const res = await apiFetch(`/api/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) await jsonOrThrow(res)
  return null
}

/** All versions in this extraction's chain. Oldest first, 1-indexed. */
export async function listVersionsApi(id) {
  const res = await apiFetch(`/api/extractions/${encodeURIComponent(id)}/versions`)
  return jsonOrThrow(res)
}

// ---------- gap state ----------

export async function listGapStatesApi(extractionId) {
  const res = await apiFetch(
    `/api/extractions/${encodeURIComponent(extractionId)}/gaps`,
  )
  return jsonOrThrow(res)
}

export async function patchGapStateApi(extractionId, gapIdx, patch) {
  const res = await apiFetch(
    `/api/extractions/${encodeURIComponent(extractionId)}/gaps/${gapIdx}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  return jsonOrThrow(res)
}

// ---------- projects ----------

export async function listProjectsApi() {
  const res = await apiFetch('/api/projects')
  return jsonOrThrow(res)
}

export async function createProjectApi(name) {
  const res = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return jsonOrThrow(res)
}

export async function patchProjectApi(id, patch) {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return jsonOrThrow(res)
}

export async function deleteProjectApi(id) {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return jsonOrThrow(res)
}

// ---------- user settings (M3.4.4) ----------

/** Returns `{anthropic_key_set, anthropic_key_preview, model_default, updated_at}`.
 *  Never includes the raw key — server only sends the masked tail. */
export async function getMeSettingsApi() {
  const res = await apiFetch('/api/me/settings')
  return jsonOrThrow(res)
}

/**
 * PUT /api/me/settings. Field semantics:
 *   undefined → don't include in body (no change)
 *   null      → don't include (treated as no change client-side too)
 *   ""        → clear the field server-side
 *   string    → set
 */
export async function putMeSettingsApi({ anthropicKey, modelDefault } = {}) {
  const body = {}
  if (anthropicKey !== undefined && anthropicKey !== null) body.anthropic_key = anthropicKey
  if (modelDefault !== undefined && modelDefault !== null) body.model_default = modelDefault
  const res = await apiFetch('/api/me/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow(res)
}

// ---------- plan + usage period (M3.5) ----------

/** Lightweight plan + this-period usage. Drives the sidebar usage bar. */
export async function getMePlanApi() {
  const res = await apiFetch('/api/me/plan')
  return jsonOrThrow(res)
}

// ---------- billing: checkout + portal (M3.6) ----------

/** Mint a Lemon Squeezy hosted-checkout URL for the current user.
 *  Frontend window.location's to the returned URL — LSQ takes it from there. */
export async function createCheckoutApi({ tier, interval = 'monthly' }) {
  const res = await apiFetch('/api/me/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier, interval }),
  })
  return jsonOrThrow(res)  // { url }
}

/** Get the LSQ customer-portal URL — manage card / cancel / view invoices.
 *  404 if user has never subscribed; caller should hide the entry point in that case. */
export async function getPortalApi() {
  const res = await apiFetch('/api/me/portal')
  return jsonOrThrow(res)  // { url }
}

// ---------- account: usage + legacy + export (M3.8) ----------

/** Usage aggregates: this_month, all_time, by_model, last_extraction_at. */
export async function getMeUsageApi() {
  const res = await apiFetch('/api/me/usage')
  return jsonOrThrow(res)
}

/** Counts of orphan `user_id='local'` rows still in the DB. */
export async function getMeLegacyApi() {
  const res = await apiFetch('/api/me/legacy')
  return jsonOrThrow(res)
}

/** One-shot reassign all `user_id='local'` rows to the calling user. */
export async function adoptLegacyApi() {
  const res = await apiFetch('/api/me/legacy/adopt', { method: 'POST' })
  return jsonOrThrow(res)
}

/**
 * Trigger the GDPR export. Streams a ZIP — we read it as a Blob and let the
 * browser save via a synthesised <a download>. Returns nothing (side-effect).
 */
export async function downloadMeExport() {
  const res = await apiFetch('/api/me/export')
  if (!res.ok) {
    const err = new Error(await readError(res))
    err.status = res.status
    throw err
  }
  const blob = await res.blob()
  // Honor server-supplied filename if present.
  const cd = res.headers.get('content-disposition') || ''
  const match = cd.match(/filename="([^"]+)"/)
  const filename = match ? match[1] : 'lucid-export.zip'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------- health + key test ----------

/** Health endpoint is unauth-protected; skip the auth header to avoid noise. */
export async function health() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
  return res.json()
}

/** Validate an arbitrary key by hitting /api/test-key. Throws on failure. */
export async function testApiKey(key) {
  const res = await apiFetch('/api/test-key', {
    method: 'POST',
    headers: key ? { 'X-Anthropic-Key': key } : {},
  })
  return jsonOrThrow(res)
}
