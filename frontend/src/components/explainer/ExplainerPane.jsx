/**
 * M14.18 — Document Explainer renderer.
 *
 * Reads `extraction.lens_payload` (an ExplainerOutput) and renders two
 * deliverables stacked: Plain-English Explanation (one card per section)
 * + Management Pitch (7 fixed blocks). Plus a flagged-issues callout
 * when the model surfaced ambiguities or missing info.
 *
 * Both sections use the M14.16 MarkdownText primitive so headings,
 * tables, lists, code blocks, and bold/italic in the model's output
 * render correctly.
 */
import React from 'react'
import MarkdownText from '../MarkdownText.jsx'
import ChatPanel from './ChatPanel.jsx'
import {
  AlertTriangle, BookOpen, CheckCircle, FileText, HelpCircle,
  Lightbulb, Sparkles, Zap,
} from '../icons.jsx'

const DOC_TYPE_LABELS = {
  rules_policy: 'Rules / Policy',
  report_research: 'Report / Research',
  contract_agreement: 'Contract / Agreement',
  technical_spec: 'Technical Spec',
  financial_budget: 'Financial / Budget',
  other: 'Document',
}

export default function ExplainerPane({ extraction }) {
  const data = extraction?.lens_payload
  if (!data) {
    return (
      <div style={emptyShell}>
        <p style={{ color: 'var(--text-muted)' }}>
          No explainer payload found on this extraction.
        </p>
      </div>
    )
  }

  const meta = data.metadata || {}
  const plain = data.plain_english || {}
  const pitch = data.management_pitch || {}

  // Filter out any "Gaps & questions" / "Open questions" / "Caveats" /
  // "What's missing" sections so legacy extractions (generated before
  // the prompt update that bans these) also render cleanly. The chat
  // panel covers follow-up questions; we don't want a static gaps
  // block bleeding through. Headings are matched case-insensitively
  // against a small set of substrings.
  const SECTION_HIDE_PATTERNS = [
    /gaps?/i, /open questions?/i, /caveats?/i, /missing/i,
    /things? to clarify/i, /unclear/i, /ambiguit/i,
  ]
  const visibleSections = (plain.sections || []).filter((s) => {
    const h = (s?.heading || '').trim()
    if (!h) return true
    return !SECTION_HIDE_PATTERNS.some((re) => re.test(h))
  })

  return (
    <div style={paneShell}>
      <div style={contentColumn}>
        {/* Header */}
        <header style={headerStyle}>
          <div style={headerLabel}>
            DOCUMENT EXPLAINER · {DOC_TYPE_LABELS[plain.doc_type] || 'Document'}
          </div>
          <h1 style={docTitle}>
            {meta.title || extraction?.filename || 'Document'}
          </h1>
          {meta.word_count > 0 && (
            <div style={metaLine}>
              {meta.word_count.toLocaleString()} words
              {visibleSections.length > 0 && (
                <> · {visibleSections.length} sections</>
              )}
            </div>
          )}
        </header>

        {/* Section 1: Plain-English Explanation */}
        <section>
          <SectionEyebrow icon={BookOpen} accent="--accent">
            Plain-English Explanation
          </SectionEyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 16 }}>
            {visibleSections.map((s, i) => (
              <ExplainerSection key={i} heading={s.heading} body={s.body} />
            ))}
          </div>
        </section>

        {/* Section 2: Management Pitch */}
        <section>
          <SectionEyebrow icon={Sparkles} accent="--info">
            How to explain this to management
          </SectionEyebrow>
          <ManagementPitch pitch={pitch} />
        </section>
      </div>
      {/* M14.18.fix — chat panel replaces the old "Gaps & questions"
          / flagged-issues callout. Floats bottom-right; opens a
          conversational workspace where the user can ask anything
          about the document. */}
      <ChatPanel extractionId={extraction?.id} />
    </div>
  )
}

// ============================================================================
// Plain-English section card
// ============================================================================

function ExplainerSection({ heading, body }) {
  return (
    <article style={sectionCard}>
      <h2 style={sectionHeading}>{heading}</h2>
      <div style={sectionBody}>
        <MarkdownText text={body} />
      </div>
    </article>
  )
}

// ============================================================================
// Management Pitch (7 blocks)
// ============================================================================

function ManagementPitch({ pitch }) {
  return (
    <div style={pitchShell}>
      {pitch.one_line_summary && (
        <PitchBlock icon={Zap} accent="--accent" label="In one line">
          <div style={oneLineText}>{pitch.one_line_summary}</div>
        </PitchBlock>
      )}

      {pitch.big_picture && (
        <PitchBlock icon={FileText} accent="--info" label="The big picture">
          <MarkdownText text={pitch.big_picture} style={pitchProse} />
        </PitchBlock>
      )}

      {pitch.key_drivers?.length > 0 && (
        <PitchBlock icon={HelpCircle} accent="--accent" label="The 2-3 things that drive everything">
          <ol style={driversList}>
            {pitch.key_drivers.map((d, i) => (
              <li key={i} style={driversItem}>
                <span style={driverNum}>{i + 1}</span>
                <span style={{ flex: 1 }}>{d}</span>
              </li>
            ))}
          </ol>
        </PitchBlock>
      )}

      {pitch.practical_example && (
        <PitchBlock icon={Lightbulb} accent="--success" label="What this means in practice">
          <MarkdownText text={pitch.practical_example} style={pitchProse} />
        </PitchBlock>
      )}

      {pitch.key_risks_or_safeguards?.length > 0 && (
        <PitchBlock icon={AlertTriangle} accent="--warn" label="Key risks & safeguards">
          <ul style={risksList}>
            {pitch.key_risks_or_safeguards.map((r, i) => (
              <li key={i} style={risksItem}>
                <MarkdownText text={r} />
              </li>
            ))}
          </ul>
        </PitchBlock>
      )}

      {pitch.whats_new?.length > 0 && (
        <PitchBlock icon={Sparkles} accent="--info" label="What is new or different">
          <ul style={whatsNewList}>
            {pitch.whats_new.map((w, i) => (
              <li key={i} style={risksItem}>
                <MarkdownText text={w} />
              </li>
            ))}
          </ul>
        </PitchBlock>
      )}

      {pitch.closer && (
        <PitchBlock icon={CheckCircle} accent="--accent" label="The takeaway">
          <div style={closerText}>{pitch.closer}</div>
        </PitchBlock>
      )}
    </div>
  )
}

function PitchBlock({ icon: Icon, accent, label, children }) {
  return (
    <div style={pitchBlock}>
      <header style={pitchBlockHeader}>
        <Icon size={14} style={{ color: `var(${accent})` }} />
        <span style={{ ...pitchBlockLabel, color: `var(${accent})` }}>{label}</span>
      </header>
      <div>{children}</div>
    </div>
  )
}


// ============================================================================
// Reusable header eyebrow
// ============================================================================

function SectionEyebrow({ icon: Icon, accent, children }) {
  return (
    <div style={eyebrowRow}>
      <Icon size={16} style={{ color: `var(${accent})` }} />
      <span style={{ ...eyebrowText, color: `var(${accent})` }}>{children}</span>
      <div style={{ ...eyebrowRule, background: `var(${accent})` }} />
    </div>
  )
}

// ============================================================================
// Styles
// ============================================================================

const paneShell = {
  flex: 1,
  background: 'var(--bg-elevated)',
  overflow: 'auto',
}

const contentColumn = {
  width: '100%',
  maxWidth: 'min(960px, 96vw)',
  margin: '0 auto',
  padding: 'clamp(32px, 5vw, 64px) clamp(20px, 4vw, 48px) 120px',
  display: 'flex',
  flexDirection: 'column',
  gap: 40,
}

const emptyShell = {
  flex: 1,
  display: 'grid',
  placeItems: 'center',
  padding: 'var(--space-8)',
}

const headerStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}
const headerLabel = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.16em',
  color: 'var(--accent-strong)',
}
const docTitle = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(28px, 4vw, 38px)',
  fontWeight: 600,
  lineHeight: 1.15,
  color: 'var(--text-strong)',
  letterSpacing: '-0.02em',
}
const metaLine = {
  fontSize: 13,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-display)',
  fontStyle: 'italic',
}

const eyebrowRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}
const eyebrowText = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  flexShrink: 0,
}
const eyebrowRule = {
  flex: 1,
  height: 2,
  borderRadius: 1,
  opacity: 0.25,
}

// Plain-English section card
const sectionCard = {
  padding: '20px 24px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
}
const sectionHeading = {
  margin: '0 0 12px',
  fontFamily: 'var(--font-display)',
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--text-strong)',
  letterSpacing: '-0.015em',
  lineHeight: 1.25,
}
const sectionBody = {
  fontSize: 15,
  lineHeight: 1.65,
  color: 'var(--text)',
}

// Management Pitch
const pitchShell = {
  marginTop: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '24px 28px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
}
const pitchBlock = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 6,
}
const pitchBlockHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}
const pitchBlockLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
}
const pitchProse = {
  fontSize: 15,
  lineHeight: 1.65,
  color: 'var(--text)',
}
const oneLineText = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(18px, 2.4vw, 22px)',
  fontWeight: 500,
  lineHeight: 1.4,
  color: 'var(--text-strong)',
  letterSpacing: '-0.01em',
}
const closerText = {
  fontFamily: 'var(--font-display)',
  fontSize: 16,
  fontStyle: 'italic',
  lineHeight: 1.5,
  color: 'var(--text-strong)',
  paddingLeft: 14,
  borderLeft: '3px solid var(--accent)',
}

const driversList = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}
const driversItem = {
  display: 'flex',
  gap: 12,
  fontSize: 15,
  lineHeight: 1.55,
  color: 'var(--text)',
}
const driverNum = {
  flexShrink: 0,
  width: 24, height: 24,
  borderRadius: 999,
  background: 'var(--accent-soft)',
  color: 'var(--accent-ink)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  fontSize: 12,
  display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
}

const risksList = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}
const risksItem = {
  paddingLeft: 16,
  borderLeft: '2px solid var(--warn)',
  fontSize: 14.5,
  lineHeight: 1.6,
  color: 'var(--text)',
}

const whatsNewList = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

