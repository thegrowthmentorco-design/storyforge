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
import React, { lazy, Suspense, useState } from 'react'
import MarkdownText from '../MarkdownText.jsx'
import ChatPanel from './ChatPanel.jsx'
import KeyFactsPanel from './KeyFactsPanel.jsx'
import GlossaryPanel from './GlossaryPanel.jsx'
import RecommendationsPanel from './RecommendationsPanel.jsx'
import PersonaSwitcher from './PersonaSwitcher.jsx'
import SimulatorPanel from './SimulatorPanel.jsx'
import {
  AlertTriangle, BookOpen, Calculator, CheckCircle, ChevronDown, ChevronRight,
  FileText, Hash, HelpCircle, Lightbulb, Quote, Share2, Sparkles, Target, Users, Zap,
} from '../icons.jsx'

const MermaidDiagram = lazy(() => import('./MermaidDiagram.jsx'))

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
  // Persona override — when the user picks a non-default persona, we
  // swap the section bodies in-place. `default` falls back to the
  // original sections from lens_payload.
  const [personaSections, setPersonaSections] = useState(null)
  const [activePersona, setActivePersona] = useState('default')

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
  const baseSections = personaSections || plain.sections || []
  const visibleSections = baseSections.filter((s) => {
    const h = (s?.heading || '').trim()
    if (!h) return true
    return !SECTION_HIDE_PATTERNS.some((re) => re.test(h))
  })
  // Source quotes are tied to the original sections only — persona
  // rewrites preserve the same section topics in the same order, so
  // we look up quotes by index in plain.sections rather than re-fetching.
  const sourceQuotesByIndex = (plain.sections || []).map((s) => s.source_quotes || [])
  const quotesFor = (i) => activePersona === 'default' ? (sourceQuotesByIndex[i] || []) : []

  // Build the tab list. Conditional tabs (diagram, simulator, glossary,
  // recommendations) are skipped when their underlying data is absent so
  // the strip stays tight. Order: Overview → Explanation → Visual →
  // Simulator → Pitch → Actions.
  const tabs = [
    data.key_facts?.length > 0 && {
      key: 'overview',
      label: 'Overview',
      icon: Hash,
      accent: '--success',
      render: () => <KeyFactsPanel facts={data.key_facts} />,
    },
    plain.sections?.length > 0 && {
      key: 'explanation',
      label: 'Explanation',
      icon: BookOpen,
      accent: '--accent',
      render: () => (
        <>
          {extraction?.id && (
            <PersonaSwitcher
              extractionId={extraction.id}
              defaultSections={plain.sections || []}
              onSectionsChange={(secs, personaKey) => {
                setActivePersona(personaKey)
                setPersonaSections(personaKey === 'default' ? null : secs)
              }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 16 }}>
            {visibleSections.map((s, i) => (
              <ExplainerSection
                key={`${activePersona}-${i}`}
                heading={s.heading}
                body={s.body}
                sourceQuotes={quotesFor(i)}
              />
            ))}
          </div>
          {data.glossary?.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <SectionEyebrow icon={BookOpen} accent="--info">Glossary</SectionEyebrow>
              <GlossaryPanel terms={data.glossary} />
            </div>
          )}
        </>
      ),
    },
    data.diagram?.source && {
      key: 'diagram',
      label: 'Visual flow',
      icon: Share2,
      accent: '--success',
      render: () => (
        <Suspense fallback={<div style={loadingFallback}>Rendering diagram…</div>}>
          <MermaidDiagram
            caption={data.diagram.caption}
            source={data.diagram.source}
            legend={data.diagram.legend || []}
          />
        </Suspense>
      ),
    },
    data.simulator_schema && extraction?.id && {
      key: 'simulator',
      label: 'Simulator',
      icon: Calculator,
      accent: '--accent',
      render: () => <SimulatorPanel extractionId={extraction.id} schema={data.simulator_schema} />,
    },
    {
      key: 'pitch',
      label: 'Pitch',
      icon: Sparkles,
      accent: '--info',
      render: () => <ManagementPitch pitch={pitch} />,
    },
    data.recommendations?.length > 0 && {
      key: 'actions',
      label: 'Actions',
      icon: Target,
      accent: '--warn',
      render: () => <RecommendationsPanel items={data.recommendations} />,
    },
  ].filter(Boolean)

  const [activeTab, setActiveTab] = useState(tabs[0]?.key || 'explanation')
  const current = tabs.find((t) => t.key === activeTab) || tabs[0]

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

        {/* Tab strip — sticky so it stays visible while scrolling within a tab. */}
        <div style={tabStrip} role="tablist" aria-label="Extraction sections">
          {tabs.map((t) => {
            const Icon = t.icon
            const isActive = t.key === activeTab
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(t.key)}
                style={{
                  ...tabBtn,
                  ...(isActive ? {
                    color: `var(${t.accent})`,
                    borderBottomColor: `var(${t.accent})`,
                  } : {}),
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Active tab content */}
        <section role="tabpanel" key={current?.key} style={tabPanel}>
          {current?.render?.()}
        </section>
      </div>
      {/* Floating chat panel — available across every tab. */}
      <ChatPanel extractionId={extraction?.id} />
    </div>
  )
}

// ============================================================================
// Plain-English section card
// ============================================================================

function ExplainerSection({ heading, body, sourceQuotes }) {
  const [open, setOpen] = useState(false)
  const hasQuotes = sourceQuotes && sourceQuotes.length > 0
  const copyQuote = (text) => {
    if (!navigator.clipboard) return
    navigator.clipboard.writeText(text).catch(() => {})
  }
  return (
    <article style={sectionCard}>
      <h2 style={sectionHeading}>{heading}</h2>
      <div style={sectionBody}>
        <MarkdownText text={body} />
      </div>
      {hasQuotes && (
        <div style={sourcesShell}>
          <button
            type="button"
            style={sourcesToggle}
            onClick={() => setOpen((x) => !x)}
            aria-expanded={open}
          >
            {open
              ? <ChevronDown size={13} />
              : <ChevronRight size={13} />}
            <Quote size={13} />
            Sources ({sourceQuotes.length})
          </button>
          {open && (
            <ul style={sourcesList}>
              {sourceQuotes.map((q, i) => (
                <li key={i} style={sourcesItem}>
                  <span style={sourcesText}>“{q}”</span>
                  <button
                    type="button"
                    style={copyBtn}
                    onClick={() => copyQuote(q)}
                    title="Copy quote"
                  >
                    Copy
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
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

const tabStrip = {
  position: 'sticky',
  top: 0,
  zIndex: 5,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  padding: '4px 0',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border)',
  marginTop: -8,
}
const tabBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 14px',
  marginBottom: -1,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  color: 'var(--text-muted)',
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  transition: 'color 0.12s, border-color 0.12s',
}
const tabPanel = {
  paddingTop: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}
const loadingFallback = {
  marginTop: 16,
  fontSize: 13,
  color: 'var(--text-muted)',
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
const sourcesShell = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: '1px dashed var(--border)',
}
const sourcesToggle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const sourcesList = {
  margin: '12px 0 0',
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}
const sourcesItem = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderLeft: '3px solid var(--accent)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13.5,
  lineHeight: 1.55,
  color: 'var(--text)',
}
const sourcesText = {
  flex: 1,
  fontStyle: 'italic',
  fontFamily: 'var(--font-display)',
}
const copyBtn = {
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 600,
  padding: '3px 8px',
  border: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
  color: 'var(--text-muted)',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  fontFamily: 'inherit',
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

