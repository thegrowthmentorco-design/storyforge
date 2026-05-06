/**
 * M14.17 — Pipeline lens renderer.
 *
 * Reads `extraction.lens_payload` (a PipelineResult) and dispatches to
 * the right template renderer based on `synthesizer.template`. Falls
 * back to the `default` template if nothing matches.
 *
 * Layout shape mirrors DossierPane's outer column so the two lenses
 * feel like the same product. Each template is a thin component that
 * walks the synthesizer's `sections` dict and renders the fields the
 * spec calls for.
 */

import React from 'react'
import MarkdownText from '../MarkdownText.jsx'
import { AlertTriangle, Calendar, CheckCircle, FileText, HelpCircle, Lightbulb, Search, Sparkles, Users } from '../icons.jsx'

export default function PipelinePane({ extraction }) {
  const result = extraction?.lens_payload
  if (!result) {
    return (
      <div style={emptyShell}>
        <p style={{ color: 'var(--text-muted)' }}>
          No pipeline payload found on this extraction.
        </p>
      </div>
    )
  }

  const { router, synthesizer, critic, revision_count } = result
  const template = synthesizer?.template || 'default'
  const sections = synthesizer?.sections || {}

  return (
    <div style={paneShell}>
      <div style={contentColumn}>
        <PipelineHeader
          extraction={extraction}
          router={router}
          critic={critic}
          revisionCount={revision_count}
        />
        {template === 'agenda_act' && <AgendaActTemplate sections={sections} />}
        {template === 'contract_decide' && <ContractDecideTemplate sections={sections} />}
        {template === 'research_understand' && <ResearchUnderstandTemplate sections={sections} />}
        {template === 'financial_decide' && <FinancialDecideTemplate sections={sections} />}
        {template === 'default' && <DefaultTemplate sections={sections} />}
        {/* Fallback for templates we don't recognize — render the raw sections. */}
        {!['agenda_act', 'contract_decide', 'research_understand', 'financial_decide', 'default'].includes(template) && (
          <DefaultTemplate sections={sections} />
        )}
        <PipelineFooter result={result} />
      </div>
    </div>
  )
}

// ============================================================================
// Header — shows the router's classification + critic verdict
// ============================================================================

function PipelineHeader({ extraction, router, critic, revisionCount }) {
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
        color: 'var(--accent-strong)', textTransform: 'uppercase',
      }}>
        Pipeline · {router?.doc_type || 'unknown'} · {router?.user_intent || 'understand'}
      </div>
      <h1 style={{
        margin: 0,
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(26px, 3vw, 34px)',
        fontWeight: 600,
        lineHeight: 1.15,
        color: 'var(--text-strong)',
        letterSpacing: '-0.02em',
      }}>
        {extraction?.filename || 'Document'}
      </h1>
      {router && (
        <div style={routerStrip}>
          <Pill label="Type" value={router.doc_type} confidence={router.doc_type_confidence} />
          <Pill label="Intent" value={router.user_intent} confidence={router.user_intent_confidence} />
          <Pill label="Depth" value={router.depth} />
          <Pill
            label="Specialists"
            value={(router.selected_specialists || []).map((s) => SPECIALIST_LABELS[s] || s).join(' · ') || 'none'}
          />
          {critic && (
            <Pill
              label="Critic"
              value={critic.verdict === 'pass' ? `✓ pass (q ${critic.overall_quality}/5)` : `↻ revised ${revisionCount}×`}
              tone={critic.verdict === 'pass' ? 'success' : 'warn'}
            />
          )}
        </div>
      )}
      {router?.rationale && (
        <p style={{
          margin: 0, fontStyle: 'italic',
          fontFamily: 'var(--font-display)',
          fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55,
        }}>
          {router.rationale}
        </p>
      )}
    </header>
  )
}

const SPECIALIST_LABELS = {
  action_extractor: 'actions',
  risk_analyzer: 'risks',
  argument_mapper: 'arguments',
  obligation_mapper: 'obligations',
  glossary_builder: 'glossary',
  numerical_analyzer: 'numbers',
  timeline_builder: 'timeline',
}

function Pill({ label, value, confidence, tone = 'neutral' }) {
  const tones = {
    neutral: { bg: 'var(--bg-subtle)', fg: 'var(--text-strong)', label: 'var(--text-soft)' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success-ink)', label: 'var(--success-ink)' },
    warn:    { bg: 'var(--warn-soft)',    fg: 'var(--warn-ink)',    label: 'var(--warn-ink)' },
  }
  const c = tones[tone]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      background: c.bg, fontSize: 11.5,
      border: '1px solid var(--border)',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: c.label, fontWeight: 700,
      }}>
        {label}
      </span>
      <span style={{ color: c.fg, fontWeight: 500 }}>{value}</span>
      {confidence != null && (
        <span style={{ color: c.label, fontSize: 10, fontFamily: 'var(--font-mono)' }}>
          {Math.round(confidence * 100)}%
        </span>
      )}
    </span>
  )
}

// ============================================================================
// Templates
// ============================================================================

function AgendaActTemplate({ sections }) {
  return (
    <div style={sectionsCol}>
      {sections.schedule?.length > 0 && (
        <Section title="Schedule" icon={Calendar} accent="--accent">
          <ScheduleList items={sections.schedule} />
        </Section>
      )}
      {sections.top_risks?.length > 0 && (
        <Section title="Top risks" icon={AlertTriangle} accent="--danger">
          <RiskList risks={sections.top_risks} />
        </Section>
      )}
      {sections.actions?.length > 0 && (
        <Section title="Actions" icon={CheckCircle} accent="--success">
          <ActionList actions={sections.actions} />
        </Section>
      )}
      {sections.open_questions?.length > 0 && (
        <Section title="Open questions" icon={HelpCircle} accent="--info">
          <OpenQuestionsList items={sections.open_questions} />
        </Section>
      )}
    </div>
  )
}

function ContractDecideTemplate({ sections }) {
  return (
    <div style={sectionsCol}>
      {sections.summary && (
        <Section title="Summary" icon={FileText} accent="--accent">
          <MarkdownText text={sections.summary} style={{ fontSize: 15, lineHeight: 1.6 }} />
        </Section>
      )}
      {sections.key_obligations?.length > 0 && (
        <Section title="Key obligations" icon={CheckCircle} accent="--accent">
          <ObligationList items={sections.key_obligations} />
        </Section>
      )}
      {sections.red_flags?.length > 0 && (
        <Section title="Red flags" icon={AlertTriangle} accent="--danger">
          <RedFlagList items={sections.red_flags} />
        </Section>
      )}
      {sections.exit_options?.length > 0 && (
        <Section title="Exit options" icon={CheckCircle} accent="--info">
          <ExitClauseList items={sections.exit_options} />
        </Section>
      )}
      {sections.recommendation_inputs?.length > 0 && (
        <Section title="Decision inputs" icon={Lightbulb} accent="--warn">
          <BulletList items={sections.recommendation_inputs} />
        </Section>
      )}
    </div>
  )
}

function ResearchUnderstandTemplate({ sections }) {
  return (
    <div style={sectionsCol}>
      {sections.thesis && (
        <Section title="Thesis" icon={Lightbulb} accent="--accent">
          <p style={thesisText}>{sections.thesis}</p>
        </Section>
      )}
      {sections.claim_map?.length > 0 && (
        <Section title="Claim map" icon={Search} accent="--accent">
          <ClaimList items={sections.claim_map} />
        </Section>
      )}
      {sections.weak_links?.length > 0 && (
        <Section title="Weak links" icon={AlertTriangle} accent="--warn">
          <WeakLinksList items={sections.weak_links} />
        </Section>
      )}
      {sections.glossary?.length > 0 && (
        <Section title="Glossary" icon={FileText} accent="--info">
          <GlossaryList items={sections.glossary} />
        </Section>
      )}
      {sections.what_to_read_first && (
        <Section title="What to read first" icon={Sparkles} accent="--accent">
          <MarkdownText text={sections.what_to_read_first} style={{ fontSize: 15, lineHeight: 1.6 }} />
        </Section>
      )}
    </div>
  )
}

function FinancialDecideTemplate({ sections }) {
  return (
    <div style={sectionsCol}>
      {sections.headline?.length > 0 && (
        <Section title="Headline numbers" icon={Sparkles} accent="--accent">
          <HeadlineNumbersList items={sections.headline} />
        </Section>
      )}
      {sections.trends?.length > 0 && (
        <Section title="Trends" icon={Sparkles} accent="--info">
          <TrendList items={sections.trends} />
        </Section>
      )}
      {sections.anomalies?.length > 0 && (
        <Section title="Anomalies" icon={AlertTriangle} accent="--warn">
          <AnomalyList items={sections.anomalies} />
        </Section>
      )}
      {sections.risks?.length > 0 && (
        <Section title="High-impact risks" icon={AlertTriangle} accent="--danger">
          <RiskList risks={sections.risks} />
        </Section>
      )}
      {sections.decision_inputs && (
        <Section title="Decision inputs" icon={Lightbulb} accent="--accent">
          <MarkdownText text={sections.decision_inputs} style={{ fontSize: 15, lineHeight: 1.6 }} />
        </Section>
      )}
    </div>
  )
}

function DefaultTemplate({ sections }) {
  return (
    <div style={sectionsCol}>
      {sections.summary && (
        <Section title="Summary" icon={FileText} accent="--accent">
          <MarkdownText text={sections.summary} style={{ fontSize: 15, lineHeight: 1.6 }} />
        </Section>
      )}
      {sections.key_points?.length > 0 && (
        <Section title="Key points" icon={Sparkles} accent="--accent">
          <BulletList items={sections.key_points} />
        </Section>
      )}
      {sections.things_to_do_or_decide?.length > 0 && (
        <Section title="Things to do or decide" icon={CheckCircle} accent="--success">
          <FlexibleList items={sections.things_to_do_or_decide} />
        </Section>
      )}
      {sections.open_questions?.length > 0 && (
        <Section title="Open questions" icon={HelpCircle} accent="--info">
          <BulletList items={sections.open_questions} />
        </Section>
      )}
    </div>
  )
}

// ============================================================================
// Building blocks
// ============================================================================

function Section({ title, icon: Icon, accent, children }) {
  return (
    <section style={sectionStyle}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
        paddingLeft: 12, borderLeft: `3px solid var(${accent})`,
      }}>
        <Icon size={16} style={{ color: `var(${accent})`, flexShrink: 0 }} />
        <h2 style={{
          margin: 0, fontFamily: 'var(--font-display)',
          fontSize: 22, fontWeight: 600, color: 'var(--text-strong)',
          letterSpacing: '-0.015em', lineHeight: 1.2,
        }}>{title}</h2>
      </header>
      <div>{children}</div>
    </section>
  )
}

// Plain bullet list of strings
function BulletList({ items }) {
  return (
    <ul style={ulStyle}>
      {items.map((it, i) => (
        <li key={i} style={liStyle}>
          {typeof it === 'string' ? <MarkdownText text={it} /> : <pre style={preStyle}>{JSON.stringify(it, null, 2)}</pre>}
        </li>
      ))}
    </ul>
  )
}

// Renders mixed list — strings as bullets, objects as cards
function FlexibleList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ padding: '8px 0' }}>
          {typeof it === 'string'
            ? <MarkdownText text={it} />
            : <ObjectCard obj={it} />
          }
        </div>
      ))}
    </div>
  )
}

function ObjectCard({ obj }) {
  return (
    <div style={cardStyle}>
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
          <span style={fieldLabel}>{k}</span>
          <span style={{ flex: 1, color: 'var(--text)', fontSize: 13.5 }}>
            {typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : JSON.stringify(v)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ScheduleList({ items }) {
  return (
    <ol style={olStyle}>
      {items.map((s, i) => (
        <li key={i} style={liStyle}>
          {typeof s === 'string' ? <MarkdownText text={s} /> : <ObjectCard obj={s} />}
        </li>
      ))}
    </ol>
  )
}

function RiskList({ risks }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {risks.map((r, i) => (
        <div key={i} style={{
          ...cardStyle,
          borderLeft: `3px solid ${impactToColor(r.impact)}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>{r.title}</span>
            <SeverityBadge label={`${r.impact}/${r.likelihood}`} severity={r.impact} />
            {r.category && <span style={categoryTag}>{r.category.replace(/_/g, ' ')}</span>}
          </div>
          {r.what_breaks && <p style={cardText}>{r.what_breaks}</p>}
          {r.trigger && <p style={cardSubText}><strong>Trigger:</strong> {r.trigger}</p>}
          {r.evidence && <SourceQuote text={r.evidence} />}
        </div>
      ))}
    </div>
  )
}

function ActionList({ actions }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {actions.map((a, i) => (
        <div key={i} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 500, color: 'var(--text-strong)', flex: 1 }}>{a.action}</span>
            {a.priority && <SeverityBadge label={a.priority} severity={a.priority} />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>{a.owner || 'unassigned'}</strong>
            {a.deadline && a.deadline !== 'unspecified' && <> · {a.deadline}</>}
          </div>
          {a.rationale && <p style={cardSubText}><em>{a.rationale}</em></p>}
          {a.source_span && <SourceQuote text={a.source_span} />}
        </div>
      ))}
    </div>
  )
}

function OpenQuestionsList({ items }) {
  return (
    <ul style={ulStyle}>
      {items.map((q, i) => (
        <li key={i} style={liStyle}>
          <strong>{q.question || q}</strong>
          {q.blocker && <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 13 }}>· blocked by: {q.blocker}</span>}
        </li>
      ))}
    </ul>
  )
}

function ObligationList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((o, i) => (
        <div key={i} style={cardStyle}>
          <div style={{ marginBottom: 4 }}>
            <strong>{o.obligor}</strong> owes <strong>{o.obligee}</strong>: {o.obligation}
          </div>
          <div style={cardSubText}>
            {o.trigger && <span><strong>When:</strong> {o.trigger} </span>}
            {o.deadline && <span>· <strong>Deadline:</strong> {o.deadline} </span>}
            {o.consequence_of_breach && o.consequence_of_breach !== 'unspecified' && (
              <span>· <strong>Breach:</strong> {o.consequence_of_breach}</span>
            )}
          </div>
          {o.source_span && <SourceQuote text={o.source_span} />}
        </div>
      ))}
    </div>
  )
}

function RedFlagList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((f, i) => (
        <div key={i} style={{ ...cardStyle, borderLeft: '3px solid var(--danger)' }}>
          <strong style={{ color: 'var(--danger-ink)' }}>{f.flag || f.title}</strong>
          {(f.why || f.what_breaks) && <p style={cardText}>{f.why || f.what_breaks}</p>}
          {(f.source_span || f.evidence) && <SourceQuote text={f.source_span || f.evidence} />}
        </div>
      ))}
    </div>
  )
}

function ExitClauseList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((e, i) => (
        <div key={i} style={cardStyle}>
          <strong>{e.party}</strong> may exit when {e.trigger}
          {e.notice_period && <span style={cardSubText}> · {e.notice_period} notice</span>}
          {e.source_span && <SourceQuote text={e.source_span} />}
        </div>
      ))}
    </div>
  )
}

function ClaimList({ items }) {
  return (
    <ol style={olStyle}>
      {items.map((c, i) => (
        <li key={i} style={liStyle}>
          <div style={{ fontWeight: 500, color: 'var(--text-strong)' }}>{c.claim}</div>
          {c.evidence_quality && (
            <span style={qualityPill(c.evidence_quality)}>
              {c.evidence_quality}
            </span>
          )}
          {c.evidence?.length > 0 && (
            <ul style={{ ...ulStyle, marginTop: 4, fontSize: 13.5 }}>
              {c.evidence.map((e, j) => (
                <li key={j} style={{ ...liStyle, color: 'var(--text-muted)' }}>
                  <em>{e.type}:</em> {e.summary}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

function WeakLinksList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((w, i) => (
        <div key={i} style={cardStyle}>
          {w.claim && <div style={{ fontWeight: 500 }}>{w.claim}</div>}
          {w.gap && <div style={{ fontWeight: 500 }}>Gap: {w.gap}</div>}
          {w.why_unsupported && <p style={cardSubText}>{w.why_unsupported}</p>}
          {w.between && <p style={cardSubText}>Between: {w.between.join(' ↔ ')}</p>}
        </div>
      ))}
    </div>
  )
}

function GlossaryList({ items }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 8 }}>
      {items.map((t, i) => (
        <React.Fragment key={i}>
          <dt style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
            {t.term}
          </dt>
          <dd style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {t.definition}
            {t.domain && <span style={domainTag}>{t.domain}</span>}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function HeadlineNumbersList({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
      {items.map((n, i) => (
        <div key={i} style={cardStyle}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--accent-ink)' }}>
            {n.value}{n.unit && ` ${n.unit}`}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{n.label}</div>
          {n.source_span && <SourceQuote text={n.source_span} />}
        </div>
      ))}
    </div>
  )
}

function TrendList({ items }) {
  const arrow = { up: '↑', down: '↓', flat: '→', volatile: '≈' }
  return (
    <ul style={ulStyle}>
      {items.map((t, i) => (
        <li key={i} style={liStyle}>
          <span style={{ fontFamily: 'var(--font-mono)', marginRight: 8 }}>{arrow[t.direction] || '→'}</span>
          <strong>{t.metric}</strong>
          {t.evidence && <span style={cardSubText}> — {t.evidence}</span>}
        </li>
      ))}
    </ul>
  )
}

function AnomalyList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((a, i) => (
        <div key={i} style={{ ...cardStyle, borderLeft: '3px solid var(--warn)' }}>
          <div style={{ fontWeight: 500 }}>{a.what}</div>
          {a.why_unusual && <p style={cardSubText}>{a.why_unusual}</p>}
          {a.source_span && <SourceQuote text={a.source_span} />}
        </div>
      ))}
    </div>
  )
}

function SourceQuote({ text }) {
  if (!text) return null
  return (
    <blockquote style={quoteStyle}>
      "{text}"
    </blockquote>
  )
}

function SeverityBadge({ label, severity }) {
  const colors = {
    high: { bg: 'var(--danger-soft)', fg: 'var(--danger-ink)' },
    medium: { bg: 'var(--warn-soft)', fg: 'var(--warn-ink)' },
    low: { bg: 'var(--info-soft)', fg: 'var(--info-ink)' },
  }
  const c = colors[severity] || colors.low
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999,
      background: c.bg, color: c.fg, fontFamily: 'var(--font-mono)',
    }}>
      {label}
    </span>
  )
}

function PipelineFooter({ result }) {
  const specialistsRan = Object.keys(result.specialists || {})
  if (specialistsRan.length === 0 && !result.critic) return null
  return (
    <footer style={{
      marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)',
      fontSize: 12, color: 'var(--text-soft)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div>
        Specialists run: {specialistsRan.length === 0 ? 'none' : specialistsRan.map((s) => SPECIALIST_LABELS[s] || s).join(', ')}
      </div>
      {result.critic && (
        <div>
          Critic: {result.critic.verdict} · quality {result.critic.overall_quality}/5
          {result.revision_count > 0 && ` · ${result.revision_count} revision${result.revision_count === 1 ? '' : 's'}`}
        </div>
      )}
    </footer>
  )
}

function impactToColor(severity) {
  return ({
    high: 'var(--danger)',
    medium: 'var(--warn)',
    low: 'var(--info)',
  })[severity] || 'var(--border)'
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
  maxWidth: 'min(1180px, 96vw)',
  margin: '0 auto',
  padding: 'clamp(32px, 5vw, 64px) clamp(20px, 4vw, 48px) 120px',
  display: 'flex',
  flexDirection: 'column',
  gap: 32,
}

const emptyShell = {
  flex: 1,
  display: 'grid',
  placeItems: 'center',
  padding: 'var(--space-8)',
}

const sectionsCol = {
  display: 'flex',
  flexDirection: 'column',
  gap: 32,
}

const sectionStyle = {
  paddingTop: 4,
}

const cardStyle = {
  padding: '12px 14px',
  background: 'var(--bg-subtle)',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
}
const cardText = {
  margin: '6px 0 0',
  fontSize: 14,
  color: 'var(--text)',
  lineHeight: 1.55,
}
const cardSubText = {
  margin: '4px 0 0',
  fontSize: 13,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
}

const ulStyle = {
  margin: 0,
  paddingLeft: 22,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const olStyle = {
  margin: 0,
  paddingLeft: 22,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const liStyle = {
  fontSize: 14.5,
  lineHeight: 1.55,
  color: 'var(--text)',
}

const fieldLabel = {
  flexShrink: 0,
  width: 96,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-soft)',
  paddingTop: 2,
}

const routerStrip = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
}

const thesisText = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 18,
  fontStyle: 'italic',
  lineHeight: 1.5,
  color: 'var(--text-strong)',
  paddingLeft: 16,
  borderLeft: '3px solid var(--accent)',
}

const quoteStyle = {
  margin: '8px 0 0',
  paddingLeft: 12,
  borderLeft: '2px solid var(--border-strong)',
  fontStyle: 'italic',
  fontSize: 13,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
}

const preStyle = {
  margin: 0,
  padding: 8,
  background: 'var(--bg-subtle)',
  borderRadius: 4,
  fontSize: 11.5,
  fontFamily: 'var(--font-mono)',
  lineHeight: 1.4,
  whiteSpace: 'pre-wrap',
}

const categoryTag = {
  fontSize: 10, fontFamily: 'var(--font-mono)',
  padding: '1px 6px', borderRadius: 3,
  background: 'var(--bg)', color: 'var(--text-soft)',
  textTransform: 'lowercase', letterSpacing: '0.04em',
}

const domainTag = {
  marginLeft: 8, fontSize: 10, fontFamily: 'var(--font-mono)',
  padding: '1px 6px', borderRadius: 3,
  background: 'var(--accent-soft)', color: 'var(--accent-ink)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
}

function qualityPill(quality) {
  const colors = {
    strong: { bg: 'var(--success-soft)', fg: 'var(--success-ink)' },
    moderate: { bg: 'var(--info-soft)', fg: 'var(--info-ink)' },
    weak: { bg: 'var(--warn-soft)', fg: 'var(--warn-ink)' },
    absent: { bg: 'var(--danger-soft)', fg: 'var(--danger-ink)' },
  }
  const c = colors[quality] || colors.moderate
  return {
    display: 'inline-block',
    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '2px 7px', borderRadius: 999, background: c.bg, color: c.fg,
    fontFamily: 'var(--font-mono)', marginTop: 4,
  }
}
