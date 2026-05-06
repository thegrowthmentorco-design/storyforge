/**
 * M14.10 — Diff panel for dossier extractions.
 *
 * Slide-down sheet that lives inside DossierPane. User opens it from the
 * chapter-nav "Diff" button. Inside:
 *   1. Pick a prior version from a dropdown (populated by listVersionsApi).
 *   2. Fetch /api/extractions/{after}/diff/{prior}.
 *   3. Render the structured diff (scalar_block / list_strings / list_objects).
 *
 * The renderer is intentionally generic — it walks `result.sections` and
 * renders each by `kind`. Adding new dossier sections doesn't require
 * touching this file as long as backend/dossier_diff.py registers them.
 */
import React, { useEffect, useState } from 'react'
import { diffDossierApi, listVersionsApi } from '../../api.js'
import { H2, H3 } from './markdown.jsx'

export default function DossierDiff({ extraction, onClose }) {
  const [versions, setVersions] = useState([])
  const [loadingVersions, setLoadingVersions] = useState(true)
  const [priorId, setPriorId] = useState(null)
  const [diff, setDiff] = useState(null)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoadingVersions(true)
    listVersionsApi(extraction.id)
      .then((vs) => {
        if (cancelled) return
        // Filter to dossier-lens siblings older than the current row.
        const eligible = vs.filter(
          (v) => v.id !== extraction.id && v.lens === 'dossier',
        )
        setVersions(eligible)
        if (eligible.length > 0) setPriorId(eligible[0].id)
      })
      .catch((e) => !cancelled && setError(e.message || 'Could not load versions'))
      .finally(() => !cancelled && setLoadingVersions(false))
    return () => { cancelled = true }
  }, [extraction.id])

  useEffect(() => {
    if (!priorId) return
    let cancelled = false
    setLoadingDiff(true)
    setError(null)
    diffDossierApi(extraction.id, priorId)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(e.message || 'Diff failed'))
      .finally(() => !cancelled && setLoadingDiff(false))
    return () => { cancelled = true }
  }, [extraction.id, priorId])

  return (
    <div style={shellStyle} role="region" aria-label="Dossier version diff">
      <header style={headerStyle}>
        <H2>Compare versions</H2>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onClose} style={closeBtn} aria-label="Close diff">
          ✕
        </button>
      </header>

      {loadingVersions ? (
        <p style={mutedNote}>Loading version history…</p>
      ) : versions.length === 0 ? (
        <p style={mutedNote}>
          No prior versions to compare against. Re-extract this document
          (or upload an updated version) to start a v1 → v2 diff.
        </p>
      ) : (
        <>
          <div style={pickerRow}>
            <label htmlFor="dossier-diff-prior" style={pickerLabel}>
              Compare against
            </label>
            <select
              id="dossier-diff-prior"
              value={priorId || ''}
              onChange={(e) => setPriorId(e.target.value)}
              style={selectStyle}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.filename} · {new Date(v.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          {error && <p style={errorNote}>{error}</p>}
          {loadingDiff && <p style={mutedNote}>Computing diff…</p>}
          {diff && !loadingDiff && <DiffSummary diff={diff} />}
          {diff && !loadingDiff && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              {diff.sections.length === 0 ? (
                <p style={mutedNote}>
                  No differences detected — these two versions extracted the
                  same dossier shape.
                </p>
              ) : (
                diff.sections.map((s) => <DiffSection key={s.key} section={s} />)
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DiffSummary({ diff }) {
  const { summary } = diff
  return (
    <div style={summaryRow}>
      <SummaryStat n={summary.sections_changed} label="sections changed" />
      <SummaryStat n={summary.items_added} label="added" tone="success" />
      <SummaryStat n={summary.items_removed} label="removed" tone="danger" />
      <SummaryStat n={summary.items_modified} label="modified" tone="info" />
    </div>
  )
}

function SummaryStat({ n, label, tone }) {
  const ink = tone === 'success' ? 'var(--success-ink)'
    : tone === 'danger' ? 'var(--danger-ink)'
    : tone === 'info' ? 'var(--info-ink)'
    : 'var(--text-strong)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: ink }}>
        {n}
      </span>
      <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-soft)' }}>
        {label}
      </span>
    </div>
  )
}

function DiffSection({ section }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <H3>{section.label}</H3>
      {section.kind === 'scalar_block' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {section.changes.map((c, i) => (
            <ScalarChange key={i} path={c.path} before={c.before} after={c.after} />
          ))}
        </div>
      )}
      {section.kind === 'list_strings' && (
        <ListStringsDiff added={section.added} removed={section.removed} />
      )}
      {section.kind === 'list_objects' && (
        <ListObjectsDiff
          added={section.added}
          removed={section.removed}
          changed={section.changed}
        />
      )}
    </section>
  )
}

function ScalarChange({ path, before, after }) {
  return (
    <div style={changeCard}>
      <div style={pathLabel}>{path}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ ...sideBlock, borderLeftColor: 'var(--danger)' }}>
          <SideTag tone="danger">before</SideTag>
          <p style={sideText}>{before || <em style={emptyMark}>empty</em>}</p>
        </div>
        <div style={{ ...sideBlock, borderLeftColor: 'var(--success)' }}>
          <SideTag tone="success">after</SideTag>
          <p style={sideText}>{after || <em style={emptyMark}>empty</em>}</p>
        </div>
      </div>
    </div>
  )
}

function ListStringsDiff({ added, removed }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {removed.length > 0 && (
        <DiffList items={removed} tone="danger" prefix="−" label="Removed" />
      )}
      {added.length > 0 && (
        <DiffList items={added} tone="success" prefix="+" label="Added" />
      )}
    </div>
  )
}

function DiffList({ items, tone, prefix, label }) {
  const ink = tone === 'success' ? 'var(--success-ink)' : 'var(--danger-ink)'
  const bg = tone === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)'
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: ink, marginBottom: 6 }}>
        {label}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>
            <span style={{ color: ink, fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0 }}>{prefix}</span>
            <span>{typeof it === 'string' ? it : JSON.stringify(it)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ListObjectsDiff({ added, removed, changed }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {removed.length > 0 && <ObjectList items={removed} tone="danger" label="Removed" />}
      {added.length > 0 && <ObjectList items={added} tone="success" label="Added" />}
      {changed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--info-ink)' }}>
            Changed
          </div>
          {changed.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <pre style={{ ...preBlock, borderLeftColor: 'var(--danger)' }}>{JSON.stringify(c.before, null, 2)}</pre>
              <pre style={{ ...preBlock, borderLeftColor: 'var(--success)' }}>{JSON.stringify(c.after, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ObjectList({ items, tone, label }) {
  const ink = tone === 'success' ? 'var(--success-ink)' : 'var(--danger-ink)'
  const bg = tone === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)'
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: ink, marginBottom: 8 }}>
        {label}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => (
          <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', lineHeight: 1.55 }}>
            {JSON.stringify(it)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SideTag({ tone, children }) {
  const ink = tone === 'success' ? 'var(--success-ink)' : 'var(--danger-ink)'
  const bg = tone === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)'
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
      padding: '2px 8px', borderRadius: 999, background: bg, color: ink,
      alignSelf: 'flex-start', marginBottom: 6,
    }}>
      {children}
    </span>
  )
}

const shellStyle = {
  position: 'absolute',
  top: 64,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(960px, 92vw)',
  maxHeight: 'calc(100vh - 120px)',
  overflow: 'auto',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  padding: '20px 28px 32px',
  zIndex: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingBottom: 12,
  borderBottom: '1px solid var(--border)',
}

const closeBtn = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '4px 10px',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontFamily: 'inherit',
  fontSize: 14,
}

const pickerRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 0',
}

const pickerLabel = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const selectStyle = {
  flex: 1,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-strong)',
  fontFamily: 'inherit',
  fontSize: 13,
}

const summaryRow = {
  display: 'flex',
  gap: 28,
  padding: '14px 16px',
  background: 'var(--bg-subtle)',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
}

const mutedNote = {
  margin: 0,
  fontSize: 13.5,
  color: 'var(--text-muted)',
  lineHeight: 1.55,
}

const errorNote = {
  margin: 0,
  fontSize: 13.5,
  color: 'var(--danger-ink)',
  background: 'var(--danger-soft)',
  padding: '10px 12px',
  borderRadius: 8,
}

const changeCard = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px',
  background: 'var(--bg-subtle)',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
}

const pathLabel = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
  color: 'var(--text-muted)',
  letterSpacing: '0.02em',
}

const sideBlock = {
  borderLeft: '3px solid',
  paddingLeft: 12,
  display: 'flex',
  flexDirection: 'column',
}

const sideText = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
}

const emptyMark = {
  color: 'var(--text-soft)',
  fontStyle: 'italic',
}

const preBlock = {
  margin: 0,
  borderLeft: '3px solid',
  paddingLeft: 10,
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--text-strong)',
  background: 'var(--bg-subtle)',
  borderRadius: 4,
  padding: '8px 10px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
}
