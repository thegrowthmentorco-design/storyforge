import React, { useMemo } from 'react'
import { Badge } from './primitives.jsx'
import { FileText, AlertTriangle } from './icons.jsx'

function highlightForGaps(paragraph, gapContexts) {
  if (!gapContexts.length) return [{ text: paragraph, hit: null }]
  for (const g of gapContexts) {
    const ctx = g.context?.trim()
    if (!ctx || ctx.length < 8) continue
    const idx = paragraph.toLowerCase().indexOf(ctx.toLowerCase())
    if (idx === -1) continue
    return [
      { text: paragraph.slice(0, idx), hit: null },
      { text: paragraph.slice(idx, idx + ctx.length), hit: g },
      { text: paragraph.slice(idx + ctx.length), hit: null },
    ]
  }
  return [{ text: paragraph, hit: null }]
}

export default function SourcePane({ extraction }) {
  const paragraphs = useMemo(() => {
    return (extraction.raw_text || '')
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
  }, [extraction.raw_text])

  const wordCount = (extraction.raw_text || '').trim().split(/\s+/).filter(Boolean).length

  return (
    <section
      style={{
        width: '42%',
        minWidth: 340,
        background: 'var(--bg-subtle)',
        borderRight: '1px solid var(--border)',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <FileText size={16} style={{ color: 'var(--text-muted)' }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              color: 'var(--text-soft)',
            }}
          >
            Source
          </span>
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text-strong)',
            marginBottom: 8,
            wordBreak: 'break-word',
            lineHeight: 1.3,
          }}
        >
          {extraction.filename}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Badge tone="neutral" size="sm">
            {wordCount.toLocaleString()} words
          </Badge>
          <Badge tone="neutral" size="sm">
            {paragraphs.length} paragraphs
          </Badge>
          {extraction.gaps.length > 0 && (
            <Badge tone="warn" size="sm" icon={<AlertTriangle size={11} />}>
              {extraction.gaps.length} gaps
            </Badge>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '20px 24px 40px', flex: 1 }}>
        {paragraphs.length === 0 && (
          <div
            style={{
              color: 'var(--text-soft)',
              fontSize: 13,
              fontStyle: 'italic',
            }}
          >
            No paragraphs detected in the source.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {paragraphs.map((p, i) => {
            const segments = highlightForGaps(p, extraction.gaps)
            const hasHit = segments.some((s) => s.hit)
            return (
              <p
                key={i}
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  paddingLeft: hasHit ? 12 : 0,
                  borderLeft: hasHit ? '3px solid var(--warn)' : 'none',
                  position: 'relative',
                }}
              >
                {segments.map((s, j) =>
                  s.hit ? (
                    <mark
                      key={j}
                      title={`${s.hit.severity.toUpperCase()} · ${s.hit.question}`}
                      style={{
                        background: 'var(--warn-soft)',
                        color: 'var(--warn-ink)',
                        padding: '1px 3px',
                        borderRadius: 3,
                        fontWeight: 500,
                      }}
                    >
                      {s.text}
                    </mark>
                  ) : (
                    <span key={j}>{s.text}</span>
                  ),
                )}
              </p>
            )
          })}
        </div>
      </div>
    </section>
  )
}
