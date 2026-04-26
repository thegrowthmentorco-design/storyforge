import React, { useEffect, useState } from 'react'
import { getSlackConnectionApi, pushToSlackApi } from '../api.js'
import { useToast } from './Toast.jsx'
import { Card } from './primitives.jsx'
import { track } from '../lib/analytics.js'

/* M6.6 — Send extraction gaps to a Slack channel.
 *
 * Simpler than the other push modals: no picker (the webhook is bound
 * to a single channel — pick a different one in Slack admin). Just
 * confirm + send + result. Two states: ready (with optional
 * "include resolved gaps" toggle) and result.
 *
 * On open, fetches the connection so we can show the channel label
 * if the user gave one. If no connection is saved → CTA to Settings.
 */

export default function PushToSlackModal({ extraction, onClose }) {
  const { toast } = useToast()
  const [conn, setConn] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [includeResolved, setIncludeResolved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let alive = true
    getSlackConnectionApi()
      .then((c) => {
        if (!alive) return
        if (!c) setLoadError({ status: 400, detail: 'No Slack connection saved.' })
        else setConn(c)
      })
      .catch((err) => {
        if (!alive) return
        setLoadError({ detail: err.message, status: err.status })
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const send = async () => {
    if (busy) return
    setBusy(true)
    track('push_to_slack_started', { include_resolved: includeResolved })
    try {
      const r = await pushToSlackApi(extraction.id, { include_resolved: includeResolved })
      setResult(r)
      track('push_to_slack_finished', { posted: r.posted_gap_count })
    } catch (err) {
      toast.error(err.message || 'Slack send failed')
    } finally {
      setBusy(false)
    }
  }

  const gapCount = extraction.gaps?.length || 0

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'grid', placeItems: 'center', zIndex: 100, padding: 24,
      }}
    >
      <Card padding={24} style={{ width: 460, maxWidth: '100%', boxShadow: 'var(--shadow-lg)' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600,
          color: 'var(--text-strong)', margin: '0 0 14px',
        }}>
          Send gaps to Slack
        </h2>

        {result ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 16 }}>
              Sent {result.posted_gap_count} gap{result.posted_gap_count === 1 ? '' : 's'}
              {conn?.channel_label ? ` to ${conn.channel_label}` : ''}.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={primaryBtn}>Done</button>
            </div>
          </>
        ) : loadError ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 12px', lineHeight: 1.55 }}>
              {loadError.status === 400
                ? 'No Slack connection saved yet. Add a webhook in Settings.'
                : `Could not load Slack settings: ${loadError.detail}`}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
              <a href="/settings" style={{ ...primaryBtn, textDecoration: 'none', display: 'inline-block' }}>
                Open Settings
              </a>
            </div>
          </>
        ) : conn === null ? (
          <div style={{ padding: '20px 0', color: 'var(--text-soft)', fontSize: 13, textAlign: 'center' }}>
            Loading…
          </div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>
              Sending {gapCount > 0 ? gapCount : 'no'} gap{gapCount === 1 ? '' : 's'}
              {conn?.channel_label ? ` to ${conn.channel_label}` : ''}.
              {' '}Each gap renders as a Slack section block with severity, question, and context.
            </p>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12.5, color: 'var(--text)', marginBottom: 16, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={includeResolved}
                onChange={(e) => setIncludeResolved(e.target.checked)}
                disabled={busy}
              />
              Include resolved gaps too
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose} disabled={busy} style={ghostBtn}>Cancel</button>
              <button type="button" onClick={send} disabled={busy || gapCount === 0} style={primaryBtn}>
                {busy ? 'Sending…' : 'Send to Slack'}
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

const primaryBtn = {
  background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)',
  color: 'white', cursor: 'pointer', fontSize: 12.5, fontWeight: 500,
  fontFamily: 'inherit', padding: '8px 14px',
}
const ghostBtn = {
  background: 'transparent', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text)', cursor: 'pointer',
  fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit', padding: '7px 14px',
}
