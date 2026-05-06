/**
 * M14.14.c — Rich, document-aware loading card.
 *
 * Replaces the boring "Connecting to Claude…" spinner for dossier
 * extractions with something that reads like the document is actually
 * being processed: the document's name, a section-by-section progress
 * strip, the current Act being worked on with its narrative subtitle,
 * the next two Acts queued, and a "you can leave" reassurance.
 *
 * Driven by:
 *   - filename (the document being read)
 *   - partialDossier (object whose keys are completed dossier sections)
 *   - latestSectionKey (most-recent section_ready event)
 *   - onStop (abort the SSE fetch)
 *
 * Stories-lens extractions still use the legacy LoadingState card
 * (different stage labels). Dispatch happens in App.jsx.
 */
import React from 'react'

// 4 acts, 19 trackable sections (narrator/bridge fields excluded — they
// fire section_ready events too but aren't useful as progress signals).
const ACTS = [
  {
    key: 'orient', roman: 'I', title: 'Orient',
    subtitle: 'Reading the source and extracting the key facts.',
    sections: ['brief', 'numbers_extract', 'tldr_ladder', 'five_w_one_h'],
  },
  {
    key: 'structure', roman: 'II', title: 'Structure',
    subtitle: 'Mapping vocabulary, sections, and how the parts connect.',
    sections: ['glossary', 'mindmap', 'domain', 'timeline', 'systems'],
  },
  {
    key: 'interrogate', roman: 'III', title: 'Interrogate',
    subtitle: 'Stress-testing assumptions and surfacing what the doc leaves out.',
    sections: ['five_whys', 'assumptions', 'inversion', 'negative_space', 'better_questions'],
  },
  {
    key: 'act', roman: 'IV', title: 'Act',
    subtitle: 'Action items, decisions, and what to revisit next.',
    sections: ['action_items', 'decisions_made', 'decisions_open', 'what_to_revisit', 'user_stories'],
  },
]

const ALL_SECTION_KEYS = ACTS.flatMap((a) => a.sections)
const SECTION_TO_ACT = Object.fromEntries(
  ACTS.flatMap((a) => a.sections.map((s) => [s, a.key]))
)

// Friendly labels for the act header pill (matches DossierFlow).
const SECTION_LABELS = {
  brief: 'brief', numbers_extract: 'numbers', tldr_ladder: 'tldr',
  five_w_one_h: '5w1h', glossary: 'glossary', mindmap: 'mindmap',
  domain: 'domain', timeline: 'timeline', systems: 'systems',
  five_whys: '5 whys', assumptions: 'assumptions', inversion: 'inversion',
  negative_space: 'negative space', better_questions: 'better questions',
  action_items: 'action items', decisions_made: 'decisions made',
  decisions_open: 'open decisions', what_to_revisit: 'revisit',
  user_stories: 'user stories',
}

export default function ExtractionProgress({
  filename,
  partialDossier,
  latestSectionKey,
  onStop,
}) {
  const ready = new Set(Object.keys(partialDossier || {}))
  const trackableReady = ALL_SECTION_KEYS.filter((k) => ready.has(k))
  const completedCount = trackableReady.length
  const total = ALL_SECTION_KEYS.length

  // Derive "current section" — the most recent trackable key OR the next
  // unfinished one if the most recent is a narrator/bridge.
  let currentKey = null
  if (latestSectionKey && SECTION_TO_ACT[latestSectionKey]) {
    currentKey = latestSectionKey
  } else if (trackableReady.length > 0) {
    currentKey = trackableReady[trackableReady.length - 1]
  }
  const currentActKey = currentKey ? SECTION_TO_ACT[currentKey] : ACTS[0].key
  const currentActIdx = ACTS.findIndex((a) => a.key === currentActKey)
  const currentAct = ACTS[currentActIdx] || ACTS[0]
  const nextActs = ACTS.slice(currentActIdx + 1, currentActIdx + 3)

  // Position in the strip: how many cards are filled.
  const filledIdx = completedCount

  return (
    <div style={pageShell}>
      <div style={cardShell}>
        {/* Header row */}
        <div style={headerRow}>
          <span style={readingLabel}>READING</span>
          <span style={pageCounter}>
            section {Math.min(filledIdx + 1, total)} of {total}
          </span>
        </div>

        {/* Document title */}
        <h1 style={docTitle}>{filename || 'Your document'}</h1>

        {/* Section strip — one mini "page" per trackable section.
            Cards before `filledIdx` are done; the one at `filledIdx` is
            currently being worked on; the rest are pending. */}
        <div style={stripRow}>
          {ALL_SECTION_KEYS.map((key, i) => {
            const state = i < filledIdx ? 'done' : i === filledIdx ? 'active' : 'pending'
            return <PageCard key={key} state={state} />
          })}
        </div>

        {/* Current act card */}
        <div style={currentActCard}>
          <div style={currentActHeader}>
            <span style={currentActLabel}>
              ACT {currentAct.roman} OF IV
            </span>
            <span style={currentActDot}>·</span>
            <span style={currentActSections}>
              {currentAct.sections
                .filter((s) => ready.has(s) || s === currentKey)
                .slice(-3)
                .map((s) => SECTION_LABELS[s])
                .join(' · ')}
            </span>
          </div>
          <h2 style={currentActTitle}>{currentAct.title}.</h2>
          <p style={currentActSubtitle}>{currentAct.subtitle}</p>
        </div>

        {/* Next acts row */}
        {nextActs.length > 0 && (
          <div style={nextRow}>
            {nextActs.map((a) => (
              <div key={a.key} style={nextCard}>
                <div style={nextLabel}>UP NEXT · ACT {a.roman}</div>
                <div style={nextTitle}>{a.title}</div>
              </div>
            ))}
            {/* If there's only one next act (we're already on Act III),
                pad with an empty cell so the layout stays balanced. */}
            {nextActs.length === 1 && <div style={{ flex: 1 }} />}
          </div>
        )}

        {/* Footer: leave-and-notify message + Stop button */}
        <div style={footerRow}>
          <span style={footerNote}>You can leave — we'll notify when ready.</span>
          {typeof onStop === 'function' && (
            <button type="button" onClick={onStop} style={stopBtn}>
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Page-card mini SVG (one per trackable section in the strip)
// ============================================================================

function PageCard({ state }) {
  const isDone = state === 'done'
  const isActive = state === 'active'
  const stroke = isDone || isActive ? 'var(--accent-strong)' : 'var(--border-strong)'
  const fill = isActive ? 'var(--accent-soft)' : 'transparent'
  const lineColor = isDone || isActive ? 'var(--accent-strong)' : 'var(--border-strong)'
  return (
    <svg
      width="38" height="50" viewBox="0 0 38 50"
      style={{
        flexShrink: 0,
        opacity: isDone || isActive ? 1 : 0.55,
        transition: 'opacity var(--dur-base) var(--ease-out)',
      }}
      aria-hidden
    >
      <rect
        x="2" y="2" width="34" height="46"
        rx="3" ry="3"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
      {/* Three faint lines representing text on the page */}
      <line x1="9" y1="14" x2="29" y2="14" stroke={lineColor} strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="20" x2="29" y2="20" stroke={lineColor} strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="26" x2="22" y2="26" stroke={lineColor} strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ============================================================================
// Styles
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
  letterSpacing: '-0.005em',
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

const stripRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  marginTop: 4,
}

const currentActCard = {
  background: 'var(--accent-soft)',
  borderRadius: 'var(--radius)',
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const currentActHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  fontSize: 11,
  letterSpacing: '0.12em',
}

const currentActLabel = {
  fontWeight: 700,
  color: 'var(--accent-ink)',
  textTransform: 'uppercase',
}

const currentActDot = {
  color: 'var(--accent-ink)',
  opacity: 0.5,
}

const currentActSections = {
  color: 'var(--accent-ink)',
  opacity: 0.75,
  textTransform: 'lowercase',
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  letterSpacing: '0.04em',
}

const currentActTitle = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(28px, 4vw, 36px)',
  fontWeight: 700,
  fontStyle: 'italic',
  color: 'var(--accent-ink)',
  letterSpacing: '-0.02em',
  lineHeight: 1.1,
}

const currentActSubtitle = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.55,
  color: 'var(--accent-ink)',
  opacity: 0.85,
}

const nextRow = {
  display: 'flex',
  gap: 12,
}

const nextCard = {
  flex: 1,
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const nextLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--text-soft)',
  textTransform: 'uppercase',
}

const nextTitle = {
  fontSize: 16,
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  color: 'var(--text-strong)',
  letterSpacing: '-0.015em',
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
