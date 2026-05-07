import React, { useEffect, useRef, useState, useId } from 'react'
import mermaid from 'mermaid'

let mermaidInited = false

function ensureMermaid() {
  if (mermaidInited) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    fontFamily: 'inherit',
    flowchart: { curve: 'basis', htmlLabels: true, padding: 12 },
    sequence: { mirrorActors: false, useMaxWidth: true },
  })
  mermaidInited = true
}

export default function MermaidDiagram({ caption, source }) {
  const reactId = useId().replace(/:/g, '_')
  const ref = useRef(null)
  const [error, setError] = useState(null)
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    if (!source) return
    ensureMermaid()
    let cancelled = false
    ;(async () => {
      try {
        const { svg } = await mermaid.render(`m_${reactId}`, source)
        if (cancelled || !ref.current) return
        ref.current.innerHTML = svg
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e?.message || String(e))
      }
    })()
    return () => { cancelled = true }
  }, [source, reactId])

  if (!source) return null

  return (
    <figure style={shell}>
      {caption && <figcaption style={captionStyle}>{caption}</figcaption>}
      {error ? (
        <div style={errorBox}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Diagram failed to render</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{error}</div>
          <button type="button" onClick={() => setShowSource((s) => !s)} style={toggleBtn}>
            {showSource ? 'Hide source' : 'Show source'}
          </button>
          {showSource && <pre style={pre}>{source}</pre>}
        </div>
      ) : (
        <div ref={ref} style={canvas} />
      )}
    </figure>
  )
}

const shell = {
  margin: '16px 0 0',
  padding: '20px 24px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}
const captionStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 14,
  fontStyle: 'italic',
  color: 'var(--text-muted)',
  textAlign: 'center',
}
const canvas = {
  display: 'flex',
  justifyContent: 'center',
  overflowX: 'auto',
}
const errorBox = {
  padding: 12,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--warn)',
  background: 'var(--warn-soft)',
  color: 'var(--warn-ink)',
  fontSize: 14,
}
const toggleBtn = {
  padding: '4px 10px',
  fontSize: 12,
  borderRadius: 'var(--radius-pill)',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const pre = {
  marginTop: 8,
  padding: 10,
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'pre-wrap',
  overflow: 'auto',
  maxHeight: 240,
}
