/* M4.5.3 — per-extraction "last seen" timestamps in localStorage.
 *
 * Why localStorage and not a backend table:
 *   * single user / single device covers 90% of usage today
 *   * zero migration, zero round-trip, no schema churn
 *   * deferred (M4.5.3.b): backend `(user_id, extraction_id, last_seen_at)`
 *     so multi-device + share-link viewers also benefit
 *
 * Stored shape:
 *   { [extractionId]: ISO timestamp string }
 *
 * Quietly tolerant of corruption (try/catch around JSON parse) and of
 * private-mode / quota-exceeded errors (try/catch around setItem). Either
 * failure mode degrades to "everything looks new", which is a safe default.
 */

const KEY = 'storyforge:extraction-seen'

function load() {
  try { return JSON.parse(window.localStorage.getItem(KEY) || '{}') }
  catch { return {} }
}

export function getLastSeen(extractionId) {
  if (!extractionId) return null
  const v = load()[extractionId]
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

/** Mark this extraction as seen *now*. Call when the user opens / switches
 *  to an extraction so subsequent comments register as "new" until the next
 *  open. */
export function markSeen(extractionId) {
  if (!extractionId) return
  const map = load()
  map[extractionId] = new Date().toISOString()
  try { window.localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* private mode etc */ }
}

/** Count how many of `comments` are newer than the last-seen timestamp.
 *  When no last-seen recorded, treats everything as already seen (the
 *  user simply never opened this extraction since M4.5.3 shipped — don't
 *  invent a phantom unread count for legacy state). */
export function unreadCount(extractionId, comments) {
  if (!extractionId || !comments?.length) return 0
  const seen = getLastSeen(extractionId)
  if (!seen) return 0
  let n = 0
  for (const c of comments) {
    const t = c?.created_at ? new Date(c.created_at) : null
    if (t && t.getTime() > seen.getTime()) n++
  }
  return n
}
