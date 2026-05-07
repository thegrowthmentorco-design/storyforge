import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from '../icons.jsx'

const COLLAPSE_THRESHOLD = 6

export default function GlossaryPanel({ terms }) {
  const [expanded, setExpanded] = useState(false)
  if (!terms || terms.length === 0) return null

  const visible = expanded ? terms : terms.slice(0, COLLAPSE_THRESHOLD)
  const hidden = Math.max(0, terms.length - visible.length)

  return (
    <div style={shell}>
      <dl style={list}>
        {visible.map((t, i) => (
          <div key={i} style={row}>
            <dt style={termCol}>
              <span style={termText}>{t.term}</span>
              {t.expansion && <span style={expansionText}>({t.expansion})</span>}
            </dt>
            <dd style={defCol}>{t.definition}</dd>
          </div>
        ))}
      </dl>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          style={toggleBtn}
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded
            ? <><ChevronDown size={14} /> Show fewer</>
            : <><ChevronRight size={14} /> Show {hidden} more {hidden === 1 ? 'term' : 'terms'}</>}
        </button>
      )}
    </div>
  )
}

const shell = {
  marginTop: 16,
  padding: '20px 24px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}
const list = { margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }
const row = {
  display: 'grid',
  gridTemplateColumns: 'minmax(160px, 240px) 1fr',
  gap: 16,
  alignItems: 'baseline',
}
const termCol = { display: 'flex', flexDirection: 'column', gap: 2 }
const termText = {
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  fontSize: 15,
  color: 'var(--text-strong)',
}
const expansionText = {
  fontSize: 12,
  fontStyle: 'italic',
  color: 'var(--text-muted)',
}
const defCol = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.55,
  color: 'var(--text)',
}
const toggleBtn = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  marginTop: 4,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--accent)',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
