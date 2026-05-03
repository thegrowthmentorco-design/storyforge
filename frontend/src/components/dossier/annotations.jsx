/**
 * M14.2 — dossier annotation primitives.
 *
 * Three small components that layer over the existing DossierPane sections
 * to add comprehension + verification affordances WITHOUT changing the
 * backend schema or prompt:
 *
 *   <GlossaryTermified text={...} terms={glossaryTerms}>
 *      Walks text, finds occurrences of any term in `terms`, substitutes
 *      a hover-tooltip span. Native `title` attribute for the tooltip
 *      (no custom popover lib — works on hover, screen-readable, zero deps).
 *      Subtle dotted underline + accent-tinted color signals "hover for
 *      more". Case-sensitive word-boundary match; longer terms win first
 *      so e.g. "User Story" preempts "Story".
 *
 *   <SourceQuote text={...}>
 *      Compact "View source" disclosure (uses native <details>). Click to
 *      expand → shows the source quote in a blockquote. Only renders when
 *      text is non-empty.
 *
 *   <ConfidenceBadge sourced={bool}>
 *      Tiny pill — "✓ Sourced" when the item has an evidence quote,
 *      otherwise "Asserted". Subtle (not loud) — readers learn to glance
 *      for the green check; absence = the model synthesized this.
 */
import React, { useMemo } from 'react'

// ============================================================================
// Glossary tooltips
// ============================================================================

export function GlossaryTermified({ text, terms }) {
  // Build a single regex matching any glossary term at word boundaries.
  // Sort by length DESC so longer terms match first (avoid "RUL" preempting
  // "RULE", "User Story" preempting "Story"). Memoise per (terms, text)
  // because regex compilation + walking strings isn't free at render scale.
  const segments = useMemo(() => {
    if (!text || !terms || terms.length === 0) return [{ text }]
    const sorted = [...terms].sort((a, b) => b.term.length - a.term.length)
    const escaped = sorted.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'g')
    const out = []
    let last = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) })
      const matched = m[0]
      const def = sorted.find((t) => t.term === matched)?.definition || ''
      out.push({ text: matched, def })
      last = m.index + matched.length
    }
    if (last < text.length) out.push({ text: text.slice(last) })
    return out
  }, [text, terms])

  if (segments.length === 1 && !segments[0].def) return text || ''

  return (
    <>
      {segments.map((s, i) =>
        s.def ? (
          <span
            key={i}
            title={s.def}
            style={{
              borderBottom: '1px dotted var(--accent-strong)',
              color: 'var(--accent-ink)',
              cursor: 'help',
            }}
          >
            {s.text}
          </span>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        )
      )}
    </>
  )
}

// ============================================================================
// Source quote disclosure
// ============================================================================

export function SourceQuote({ text }) {
  if (!text) return null
  return (
    <details style={{ marginTop: 8 }}>
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          fontSize: 11.5,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--accent-strong)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontWeight: 600,
        }}
      >
        <span aria-hidden style={{ fontSize: 10 }}>▸</span>
        View source
      </summary>
      <blockquote
        style={{
          margin: '8px 0 0',
          padding: '8px 14px',
          borderLeft: '2px solid var(--accent)',
          background: 'var(--accent-soft)',
          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          fontSize: 13,
          fontStyle: 'italic',
          color: 'var(--text)',
          lineHeight: 1.55,
        }}
      >
        “{text}”
      </blockquote>
    </details>
  )
}

// ============================================================================
// Confidence pill
// ============================================================================

export function ConfidenceBadge({ sourced }) {
  return (
    <span
      title={
        sourced
          ? 'Sourced — backed by a verbatim quote from the document'
          : 'Asserted — synthesized from the document; no single passage'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 999,
        background: sourced ? 'var(--success-soft)' : 'var(--bg-subtle)',
        color: sourced ? 'var(--success-ink)' : 'var(--text-soft)',
        border: '1px solid ' + (sourced ? 'var(--success-soft)' : 'var(--border)'),
      }}
    >
      {sourced ? '✓ Sourced' : 'Asserted'}
    </span>
  )
}
