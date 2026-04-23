/**
 * StoryForge — local settings store (M1.4.6 will formalize this).
 *
 * Persists user preferences to localStorage:
 *   - anthropicKey: BYOK API key (sent as X-Anthropic-Key header)
 *   - model:        which Claude model to request (empty = server default)
 *   - theme:        'light' | 'dark' | 'system'
 *
 * In M3 these move to the backend per-user.
 */

const KEY = 'storyforge:settings'

const DEFAULTS = {
  anthropicKey: '',
  model: '',
  theme: 'light',
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEY)
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Merge a patch into stored settings. Returns the new full object. */
export function setSettings(patch) {
  const merged = { ...getSettings(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(merged))
  } catch {
    /* quota exceeded — settings object is tiny so this shouldn't happen */
  }
  return merged
}
