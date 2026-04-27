import React, { useEffect, useMemo, useRef, useState } from 'react'
import { downloadExtractionSourceApi } from '../api.js'
import { parseDocNames } from '../lib/multi_doc.js'
import { useToast } from './Toast.jsx'
import { Badge, Button } from './primitives.jsx'
import { FileText, AlertTriangle, Download } from './icons.jsx'

/* M5.2 — collect every (quote, source-of-quote) pair from the extraction so
 * we can highlight them inline in the source text. Stories + NFRs get an
 * "info" tone; gap source_quotes (and the legacy gap.context heuristic) keep
 * the warn tone so users can tell them apart at a glance.
 *
 * Returns a list of { quote, kind: 'story'|'nfr'|'gap', label } sorted by
 * quote length DESC so longer quotes win when one is a substring of another
 * (otherwise the shorter match would get found first and break the longer
 * highlight). */
function collectQuotes(extraction) {
  const out = []
  for (const s of extraction.stories || []) {
    if (s.source_quote) out.push({ quote: s.source_quote, kind: 'story', label: `${s.id} · ${s.actor}` })
  }
  for (const n of extraction.nfrs || []) {
    if (n.source_quote) out.push({ quote: n.source_quote, kind: 'nfr', label: `${n.category} · ${n.value}` })
  }
  for (const g of extraction.gaps || []) {
    if (g.source_quote) out.push({ quote: g.source_quote, kind: 'gap', label: `${g.severity?.toUpperCase()} · ${g.question}` })
    // Legacy fallback — pre-M5.1 gaps only had `context`. Keep highlighting
    // those until the data is rerun against the new prompt.
    else if (g.context && g.context.length >= 8) out.push({ quote: g.context, kind: 'gap', label: `${g.severity?.toUpperCase()} · ${g.question}` })
  }
  return out.sort((a, b) => b.quote.length - a.quote.length)
}

/* Walk a paragraph and split it into segments at every quote-match (case-
 * insensitive substring). Greedy left-to-right; once a span is matched it's
 * not re-considered for other quotes. Returns [{text, hit?}]. */
function segmentParagraph(paragraph, quotes) {
  if (!quotes.length) return [{ text: paragraph, hit: null }]
  const lower = paragraph.toLowerCase()
  // Build [start, end, hit] spans
  const spans = []
  for (const q of quotes) {
    const needle = q.quote.trim().toLowerCase()
    if (!needle || needle.length < 4) continue
    let from = 0
    while (true) {
      const idx = lower.indexOf(needle, from)
      if (idx === -1) break
      const end = idx + needle.length
      // Skip if overlaps an already-claimed span
      if (!spans.some((s) => idx < s[1] && end > s[0])) {
        spans.push([idx, end, q])
      }
      from = end
    }
  }
  if (!spans.length) return [{ text: paragraph, hit: null }]
  spans.sort((a, b) => a[0] - b[0])
  const segs = []
  let cursor = 0
  for (const [start, end, hit] of spans) {
    if (start > cursor) segs.push({ text: paragraph.slice(cursor, start), hit: null })
    segs.push({ text: paragraph.slice(start, end), hit })
    cursor = end
  }
  if (cursor < paragraph.length) segs.push({ text: paragraph.slice(cursor), hit: null })
  return segs
}

const TONE_STYLE = {
  story: { bg: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
  nfr: { bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  gap: { bg: 'var(--warn-soft)', ink: 'var(--warn-ink)' },
}

/* Stable DOM id for a quote string. Just lowercased + collapsed whitespace +
 * truncated to keep attribute size bounded. We don't need cryptographic
 * uniqueness — the SourcePane effect just needs to find SOMETHING that
 * matches `selectedQuote.text`. */
function quoteId(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200)
}

export default function SourcePane({ extraction, selectedQuote, width = '42%' }) {
  const bodyRef = useRef(null)
  const { toast } = useToast()
  const [downloadingIdx, setDownloadingIdx] = useState(null)

  const paragraphs = useMemo(() => {
    return (extraction.raw_text || '')
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
  }, [extraction.raw_text])

  const quotes = useMemo(() => collectQuotes(extraction), [extraction])

  const wordCount = (extraction.raw_text || '').trim().split(/\s+/).filter(Boolean).length

  // M7.5.b — per-doc download links. Backend returns one entry per uploaded
  // file in `source_file_paths`; legacy single-doc rows expose the single
  // `source_file_path` and an empty list (the resolver in
  // services.extractions normalises this server-side, but defend in depth
  // here too in case the field hasn't propagated to a stale cached record).
  const sourcePaths = useMemo(() => {
    const list = extraction.source_file_paths || []
    if (list.length) return list
    if (extraction.source_file_path) return [extraction.source_file_path]
    return []
  }, [extraction.source_file_paths, extraction.source_file_path])
  const docNames = useMemo(() => parseDocNames(extraction.raw_text || ''), [extraction.raw_text])

  const downloadSource = async (idx, displayName) => {
    setDownloadingIdx(idx)
    try {
      await downloadExtractionSourceApi(extraction.id, idx, displayName || extraction.filename)
    } catch (err) {
      toast.error(err?.message || 'Could not download source file')
    } finally {
      setDownloadingIdx(null)
    }
  }

  // M5.2 — when an artifact picks a quote, scroll to + flash the first
  // <mark> whose data-quote-id matches. Empty selection / no match = no-op.
  useEffect(() => {
    if (!selectedQuote || !bodyRef.current) return
    const id = quoteId(selectedQuote.text)
    const target = bodyRef.current.querySelector(`[data-quote-id="${CSS.escape(id)}"]`)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.remove('quote-flash')
    // Force reflow so the animation re-fires when the same target is picked twice
    void target.offsetWidth
    target.classList.add('quote-flash')
  }, [selectedQuote])

  return (
    <section
      style={{
        // M8.2 — width is parent-driven (App.jsx persists the ratio in
        // localStorage). Default '42%' keeps single-call usage unchanged.
        width,
        minWidth: 340,
        flexShrink: 0,
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

        {/* M7.5.b — per-doc downloads. Single-doc rows render one inline
            "Download original" button; multi-doc rows render a vertical
            list with the per-doc filename so users can grab any of the N
            originals without re-uploading. Hidden when no source was saved
            (paste-mode extractions). */}
        {sourcePaths.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sourcePaths.length === 1 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Download size={12} />}
                onClick={() => downloadSource(0, extraction.filename)}
                disabled={downloadingIdx !== null}
                title="Download the original uploaded file"
              >
                {downloadingIdx === 0 ? 'Downloading…' : 'Download original'}
              </Button>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: 'var(--text-soft)',
                  }}
                >
                  Originals · {sourcePaths.length}
                </div>
                {sourcePaths.map((_, i) => {
                  // i is 0-based; doc-name array is 1-based (index 0 reserved).
                  const display = docNames[i + 1] || `Document ${i + 1}`
                  return (
                    <Button
                      key={i}
                      variant="ghost"
                      size="sm"
                      icon={<Download size={12} />}
                      onClick={() => downloadSource(i, display)}
                      disabled={downloadingIdx !== null}
                      title={`Download "${display}"`}
                      style={{ justifyContent: 'flex-start' }}
                    >
                      {downloadingIdx === i ? 'Downloading…' : display}
                    </Button>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div ref={bodyRef} style={{ padding: '20px 24px 40px', flex: 1 }}>
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
            const segments = segmentParagraph(p, quotes)
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
                  borderLeft: hasHit ? '3px solid var(--border)' : 'none',
                  position: 'relative',
                }}
              >
                {segments.map((s, j) =>
                  s.hit ? (
                    <mark
                      key={j}
                      data-quote-id={quoteId(s.hit.quote)}
                      title={s.hit.label}
                      style={{
                        background: TONE_STYLE[s.hit.kind].bg,
                        color: TONE_STYLE[s.hit.kind].ink,
                        padding: '1px 3px',
                        borderRadius: 3,
                        fontWeight: 500,
                        scrollMarginTop: 80,
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
