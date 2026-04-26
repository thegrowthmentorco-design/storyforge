import React, { useEffect, useState } from 'react'
import { listJiraProjectsApi, pushToJiraApi } from '../api.js'
import { useToast } from './Toast.jsx'
import { Card } from './primitives.jsx'
import { track } from '../lib/analytics.js'

/* M6.2 — Push extraction stories to a Jira project.
 *
 * Flow:
 *   open → fetch projects (also acts as connection probe)
 *     │
 *     ├── 400/no-conn → "Connect Jira in Settings" CTA
 *     ├── 401         → "Token rejected — re-enter in Settings"
 *     └── ok          → project picker + Push button
 *                          │
 *                          push → results card (created links + per-row failures)
 */

export default function PushToJiraModal({ extraction, onClose }) {
  const { toast } = useToast()
  const [projects, setProjects] = useState(null)     // null=loading, []=empty, [...]=loaded
  const [loadError, setLoadError] = useState(null)   // {detail, status}
  const [selected, setSelected] = useState('')
  const [issueType, setIssueType] = useState('Story')
  const [pushing, setPushing] = useState(false)
  const [result, setResult] = useState(null)         // PushToJiraResult or null

  useEffect(() => {
    let alive = true
    listJiraProjectsApi()
      .then((rows) => {
        if (!alive) return
        setProjects(rows)
        if (rows.length > 0) setSelected(rows[0].key)
      })
      .catch((err) => {
        if (!alive) return
        setLoadError({ detail: err.message, status: err.status })
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !pushing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pushing])

  const doPush = async () => {
    if (!selected || pushing) return
    setPushing(true)
    track('push_to_jira_started', { project_key: selected })
    try {
      const r = await pushToJiraApi(extraction.id, { project_key: selected, issue_type: issueType })
      setResult(r)
      track('push_to_jira_finished', {
        pushed: r.pushed.length,
        failed: r.failed.length,
      })
    } catch (err) {
      toast.error(err.message || 'Push failed')
    } finally {
      setPushing(false)
    }
  }

  const storyCount = extraction.stories?.length || 0

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !pushing) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'grid', placeItems: 'center', zIndex: 100, padding: 24,
      }}
    >
      <Card padding={24} style={{ width: 500, maxWidth: '100%', boxShadow: 'var(--shadow-lg)' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600,
          color: 'var(--text-strong)', margin: '0 0 14px',
        }}>
          Push to Jira
        </h2>

        {/* --- Result view --- */}
        {result ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
              Pushed {result.pushed.length} of {storyCount} stories.
              {result.failed.length > 0 && (
                <span style={{ color: 'var(--danger-ink)' }}>
                  {' '}{result.failed.length} failed.
                </span>
              )}
            </div>
            {result.pushed.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <SectionLabel>Created</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.pushed.map((p) => (
                    <a
                      key={p.issue_key}
                      href={p.issue_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 12.5, fontFamily: 'var(--font-mono)',
                        color: 'var(--accent-strong)', textDecoration: 'none',
                      }}
                    >
                      {p.story_id} → {p.issue_key} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}
            {result.failed.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <SectionLabel>Failed</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.failed.map((f, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-strong)' }}>{f.story_id}</span>
                      {' — '}
                      <span style={{ color: 'var(--danger-ink)' }}>{f.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={onClose} style={primaryBtn}>Done</button>
            </div>
          </>
        ) : loadError ? (
          /* --- Error states --- */
          <>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 12px', lineHeight: 1.55 }}>
              {loadError.status === 400
                ? 'No Jira connection saved yet.'
                : loadError.status === 401
                  ? 'Jira token rejected — re-enter it in Settings.'
                  : `Could not reach Jira: ${loadError.detail}`}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
              <a href="/settings" style={{ ...primaryBtn, textDecoration: 'none', display: 'inline-block' }}>
                Open Settings
              </a>
            </div>
          </>
        ) : projects === null ? (
          <div style={{ padding: '20px 0', color: 'var(--text-soft)', fontSize: 13, textAlign: 'center' }}>
            Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 12px' }}>
              The connected account doesn't have any visible projects.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
            </div>
          </>
        ) : (
          /* --- Picker view --- */
          <>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>
              {storyCount} stor{storyCount === 1 ? 'y' : 'ies'} will be created in the chosen project.
              Acceptance criteria become bullet points in each issue's description.
            </p>
            <SectionLabel>Project</SectionLabel>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={pushing}
              style={{ ...inputStyle, marginBottom: 10 }}
            >
              {projects.map((p) => (
                <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
              ))}
            </select>
            <SectionLabel>Issue type</SectionLabel>
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              disabled={pushing}
              style={{ ...inputStyle, marginBottom: 14 }}
            >
              <option value="Story">Story</option>
              <option value="Task">Task</option>
              <option value="Bug">Bug</option>
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose} disabled={pushing} style={ghostBtn}>Cancel</button>
              <button type="button" onClick={doPush} disabled={pushing || !selected} style={primaryBtn}>
                {pushing ? 'Pushing…' : `Push ${storyCount} stor${storyCount === 1 ? 'y' : 'ies'}`}
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
      color: 'var(--text-soft)', marginBottom: 4,
    }}>
      {children}
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
const inputStyle = {
  width: '100%', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
  padding: '8px 10px', fontFamily: 'inherit', fontSize: 13,
  background: 'var(--bg)', color: 'inherit', outline: 'none',
}
