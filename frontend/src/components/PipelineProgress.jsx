/**
 * M14.17.d — Loading card for pipeline-lens extractions.
 *
 * Shows the 5 pipeline stages (router → extractor → specialists → synthesizer
 * → critic) as a checklist that fills in as `stage` SSE events arrive.
 * Mirrors ExtractionProgress's layout language so the two loading cards
 * feel like part of the same system.
 */
import React from 'react'
import { Check } from './icons.jsx'
// Active-stage indicator is a CSS spinner (border + spin keyframe), not a
// component import — keeps this card self-contained.

const STAGES = [
  { key: 'router', label: 'Routing' },
  { key: 'extractor', label: 'Extracting facts' },
  { key: 'specialists', label: 'Running specialists' },
  { key: 'synthesizer', label: 'Synthesizing' },
  { key: 'critic', label: 'Critic review' },
]

export default function PipelineProgress({ filename, stageEvents, onStop }) {
  // Walk the event log to compute per-stage state.
  // Each stage starts on its first event; "done" when an event has detail.done=true.
  const state = {}
  for (const ev of stageEvents || []) {
    if (!ev?.name) continue
    const key = normalizeStageKey(ev.name)
    if (!key) continue
    const current = state[key] || { state: 'active', detail: {} }
    if (ev.detail?.done) {
      current.state = 'done'
      current.detail = { ...current.detail, ...ev.detail }
    } else {
      current.state = 'active'
      current.detail = { ...current.detail, ...ev.detail }
    }
    state[key] = current
  }

  // Resolve which stage is currently the "in progress" one (last active).
  const activeIdx = STAGES.findIndex((s) => state[s.key]?.state === 'active')
  const completedCount = STAGES.filter((s) => state[s.key]?.state === 'done').length

  return (
    <div style={pageShell}>
      <div style={cardShell}>
        <div style={headerRow}>
          <span style={readingLabel}>PIPELINE</span>
          <span style={pageCounter}>
            stage {Math.min(completedCount + 1, STAGES.length)} of {STAGES.length}
          </span>
        </div>

        <h1 style={docTitle}>{filename || 'Your document'}</h1>

        {/* Router classification (when known) */}
        {state.router?.detail?.doc_type && (
          <div style={routerSummary}>
            Classified as <strong>{state.router.detail.doc_type}</strong>
            {' · '}intent <strong>{state.router.detail.user_intent}</strong>
            {' · '}depth <strong>{state.router.detail.depth}</strong>
            {state.router.detail.specialists?.length > 0 && (
              <>
                <br />
                Selected specialists:{' '}
                <strong>{state.router.detail.specialists.join(', ').replace(/_/g, ' ')}</strong>
              </>
            )}
          </div>
        )}

        {/* Stage checklist */}
        <div style={stagesList}>
          {STAGES.map((s, i) => {
            const ss = state[s.key]
            const isDone = ss?.state === 'done'
            const isActive = !isDone && ss?.state === 'active'
            const isPending = !ss
            return (
              <div key={s.key} style={{
                ...stageRow,
                color: isPending ? 'var(--text-soft)' : 'var(--text)',
              }}>
                <div style={stageBullet}>
                  {isDone ? (
                    <span style={doneCircle}><Check size={12} /></span>
                  ) : isActive ? (
                    <span style={activeSpinner} />
                  ) : (
                    <span style={pendingCircle} />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: isActive ? 600 : 500 }}>
                    {s.label}
                  </div>
                  {ss?.detail && Object.keys(ss.detail).length > 0 && (
                    <div style={stageDetail}>{renderDetail(s.key, ss.detail)}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={footerRow}>
          <span style={footerNote}>
            You can leave — we'll notify when the pipeline finishes.
          </span>
          {typeof onStop === 'function' && (
            <button type="button" onClick={onStop} style={stopBtn}>Stop</button>
          )}
        </div>
      </div>
    </div>
  )
}

function normalizeStageKey(name) {
  // Backend emits 'specialist_done' / 'specialist_failed' for individual
  // specialist completions; collapse those into the 'specialists' bucket.
  if (name === 'specialist_done' || name === 'specialist_failed') return 'specialists'
  if (STAGES.find((s) => s.key === name)) return name
  return null
}

function renderDetail(stage, detail) {
  if (stage === 'router') {
    if (detail.doc_type) {
      return null  // already shown above the list
    }
    return null
  }
  if (stage === 'extractor') {
    if (detail.done) {
      const bits = []
      if (detail.people) bits.push(`${detail.people} people`)
      if (detail.orgs) bits.push(`${detail.orgs} orgs`)
      if (detail.dates) bits.push(`${detail.dates} dates`)
      if (detail.numbers) bits.push(`${detail.numbers} numbers`)
      return bits.join(' · ') || null
    }
  }
  if (stage === 'specialists') {
    if (detail.running?.length) return `running: ${detail.running.join(', ').replace(/_/g, ' ')}`
    if (detail.key) return `done: ${detail.key.replace(/_/g, ' ')}`
  }
  if (stage === 'synthesizer') {
    if (detail.template) return `template: ${detail.template}`
    if (detail.revising) return `revising (pass ${detail.pass})`
  }
  if (stage === 'critic') {
    if (detail.verdict) return `${detail.verdict}${detail.issue_count ? ` · ${detail.issue_count} issues` : ''}`
    return `pass ${detail.pass ?? 0}`
  }
  return null
}

// ============================================================================
// Styles (mirrored from ExtractionProgress for visual consistency)
// ============================================================================

const pageShell = {
  flex: 1,
  display: 'grid',
  placeItems: 'center',
  padding: 32,
  background: 'var(--bg)',
}

const cardShell = {
  width: '100%',
  maxWidth: 720,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  padding: 'clamp(20px, 3vw, 32px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
}

const headerRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}
const readingLabel = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.16em',
  color: 'var(--accent-strong)',
}
const pageCounter = {
  fontSize: 12.5,
  fontFamily: 'var(--font-display)',
  fontStyle: 'italic',
  color: 'var(--text-muted)',
}

const docTitle = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(22px, 3vw, 28px)',
  fontWeight: 600,
  color: 'var(--text-strong)',
  letterSpacing: '-0.02em',
  lineHeight: 1.15,
}

const routerSummary = {
  padding: '12px 14px',
  background: 'var(--accent-soft)',
  color: 'var(--accent-ink)',
  borderRadius: 'var(--radius)',
  fontSize: 13,
  lineHeight: 1.55,
}

const stagesList = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  marginTop: 4,
}
const stageRow = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  fontSize: 14,
}
const stageBullet = {
  flexShrink: 0,
  width: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  paddingTop: 1,
}
const doneCircle = {
  width: 18, height: 18,
  borderRadius: 999,
  background: 'var(--success)',
  color: 'white',
  display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
}
const activeSpinner = {
  width: 16, height: 16,
  borderRadius: 999,
  border: '2px solid var(--accent-soft)',
  borderTopColor: 'var(--accent-strong)',
  animation: 'spin 0.9s linear infinite',
  display: 'inline-block',
}
const pendingCircle = {
  width: 16, height: 16,
  borderRadius: 999,
  border: '1.5px solid var(--border-strong)',
  display: 'inline-block',
}
const stageDetail = {
  marginTop: 2,
  fontSize: 12,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.02em',
}

const footerRow = {
  marginTop: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}
const footerNote = {
  fontSize: 12.5,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-display)',
  fontStyle: 'italic',
}
const stopBtn = {
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
  padding: '6px 14px',
  fontFamily: 'inherit',
}
