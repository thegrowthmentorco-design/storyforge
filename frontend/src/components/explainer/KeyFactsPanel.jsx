import React from 'react'
import {
  Calendar, DollarSign, Hash, Percent, Tag, Timer, User,
} from '../icons.jsx'

const KIND_META = {
  number:     { Icon: Hash,        accent: '--accent' },
  money:      { Icon: DollarSign,  accent: '--success' },
  date:       { Icon: Calendar,    accent: '--info' },
  deadline:   { Icon: Timer,       accent: '--warn' },
  duration:   { Icon: Timer,       accent: '--info' },
  percentage: { Icon: Percent,     accent: '--accent' },
  name:       { Icon: User,        accent: '--info' },
  other:      { Icon: Tag,         accent: '--text-muted' },
}

export default function KeyFactsPanel({ facts }) {
  if (!facts || facts.length === 0) return null
  return (
    <div style={grid} role="list" aria-label="Key facts">
      {facts.map((f, i) => {
        const meta = KIND_META[f.kind] || KIND_META.other
        const Icon = meta.Icon
        return (
          <div key={i} style={card} role="listitem">
            <div style={{ ...iconBox, color: `var(${meta.accent})` }}>
              <Icon size={14} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={label}>{f.label}</div>
              <div style={value} title={f.value}>{f.value}</div>
              {f.context && <div style={ctx}>{f.context}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const grid = {
  marginTop: 16,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 10,
}
const card = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '12px 14px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
}
const iconBox = {
  width: 28, height: 28,
  borderRadius: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  flexShrink: 0,
}
const label = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const value = {
  fontFamily: 'var(--font-display)',
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text-strong)',
  lineHeight: 1.25,
  wordBreak: 'break-word',
}
const ctx = {
  marginTop: 4,
  fontSize: 12,
  color: 'var(--text-muted)',
  lineHeight: 1.4,
}
