import React from 'react'
import {
  AlertTriangle, ArrowRight, CheckCircle, HelpCircle, Lightbulb, Zap,
} from '../icons.jsx'

const KIND_META = {
  action:      { Icon: ArrowRight,    label: 'Action' },
  watch_out:   { Icon: AlertTriangle, label: 'Watch out' },
  opportunity: { Icon: Lightbulb,     label: 'Opportunity' },
  compliance:  { Icon: CheckCircle,   label: 'Compliance' },
  decision:    { Icon: HelpCircle,    label: 'Decision' },
}

const PRIORITY_META = {
  high:   { color: 'var(--warn)',    soft: 'var(--warn-soft)',    ink: 'var(--warn-ink)',    label: 'High' },
  medium: { color: 'var(--info)',    soft: 'var(--info-soft)',    ink: 'var(--info-ink)',    label: 'Medium' },
  low:    { color: 'var(--text-muted)', soft: 'var(--bg-elevated)', ink: 'var(--text-muted)', label: 'Low' },
}

export default function RecommendationsPanel({ items }) {
  if (!items || items.length === 0) return null
  const sorted = [...items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
  return (
    <div style={shell}>
      <ul style={list}>
        {sorted.map((r, i) => <RecommendationCard key={i} r={r} />)}
      </ul>
    </div>
  )
}

function RecommendationCard({ r }) {
  const kindMeta = KIND_META[r.kind] || KIND_META.action
  const prioMeta = PRIORITY_META[r.priority] || PRIORITY_META.medium
  const KindIcon = kindMeta.Icon
  return (
    <li style={{ ...card, borderLeftColor: prioMeta.color }}>
      <header style={cardHeader}>
        <span style={{ ...kindBadge, color: prioMeta.color }}>
          <KindIcon size={13} />
          {kindMeta.label}
        </span>
        <span style={{ ...priorityChip, background: prioMeta.soft, color: prioMeta.ink, borderColor: prioMeta.color }}>
          {prioMeta.label}
        </span>
      </header>
      <h3 style={titleStyle}>{r.title}</h3>
      {r.rationale && <p style={rationale}>{r.rationale}</p>}
      {r.suggested_action && (
        <div style={actionBox}>
          <Zap size={12} style={{ color: prioMeta.color, flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={actionLabel}>Suggested action</div>
            <div style={actionText}>{r.suggested_action}</div>
          </div>
        </div>
      )}
    </li>
  )
}

function priorityRank(p) {
  return p === 'high' ? 0 : p === 'medium' ? 1 : 2
}

const shell = {
  marginTop: 16,
  padding: '24px 28px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
}
const list = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}
const card = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '14px 16px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderLeft: '4px solid var(--accent)',
  borderRadius: 'var(--radius-md)',
}
const cardHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}
const kindBadge = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}
const priorityChip = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '2px 8px',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid',
}
const titleStyle = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text-strong)',
  lineHeight: 1.35,
  letterSpacing: '-0.01em',
}
const rationale = {
  margin: 0,
  fontSize: 13.5,
  lineHeight: 1.55,
  color: 'var(--text-muted)',
}
const actionBox = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  marginTop: 4,
  padding: '8px 10px',
  background: 'var(--bg-subtle)',
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius-md)',
}
const actionLabel = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 2,
}
const actionText = {
  fontSize: 13.5,
  lineHeight: 1.5,
  color: 'var(--text)',
}
