import React, { useEffect, useRef, useState, useId, useCallback } from 'react'
import mermaid from 'mermaid'
import { Download, Maximize2, X, ZoomIn, ZoomOut } from '../icons.jsx'

/**
 * Brand-aligned palette for the five semantic node classes. The
 * prompt instructs Claude to attach these via `:::process` etc.
 * Picked for AA contrast on the soft fill against the dark stroke;
 * the same swatches drive the legend so colors line up.
 */
const NODE_CLASSES = {
  process:  { fill: '#E8F0FE', stroke: '#1A73E8', text: '#0B3A8C' },
  data:     { fill: '#FFF4E5', stroke: '#F57C00', text: '#7A3E00' },
  external: { fill: '#F3E8FF', stroke: '#8B5CF6', text: '#4C1D95' },
  decision: { fill: '#FEF3C7', stroke: '#D97706', text: '#78350F' },
  storage:  { fill: '#E6FFFA', stroke: '#0F766E', text: '#134E4A' },
}

const CLASS_DEF_BLOCK = Object.entries(NODE_CLASSES)
  .map(([name, c]) =>
    `classDef ${name} fill:${c.fill},stroke:${c.stroke},stroke-width:2px,color:${c.text};`
  )
  .join('\n')

let mermaidInited = false
function ensureMermaid() {
  if (mermaidInited) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    fontFamily: 'inherit',
    themeVariables: {
      primaryColor: '#F8FAFC',
      primaryTextColor: '#0F172A',
      primaryBorderColor: '#475569',
      lineColor: '#64748B',
      secondaryColor: '#E2E8F0',
      tertiaryColor: '#F1F5F9',
      mainBkg: '#FFFFFF',
      nodeBorder: '#475569',
      clusterBkg: '#F8FAFC',
      clusterBorder: '#CBD5E1',
      edgeLabelBackground: '#FFFFFF',
      fontSize: '14px',
    },
    flowchart: { curve: 'basis', htmlLabels: true, padding: 16, nodeSpacing: 50, rankSpacing: 60 },
    sequence: { mirrorActors: false, useMaxWidth: true, actorMargin: 60 },
  })
  mermaidInited = true
}

/**
 * Append our pre-defined classDefs to the Mermaid source so node
 * `:::class` references resolve. Only applies to flowchart-style
 * diagrams; sequence/state diagrams ignore classDef.
 */
function injectClassDefs(source) {
  if (!source) return source
  const firstLine = source.trimStart().split('\n', 1)[0].trim().toLowerCase()
  const isFlowchart = firstLine.startsWith('flowchart') || firstLine.startsWith('graph')
  if (!isFlowchart) return source
  return `${source}\n${CLASS_DEF_BLOCK}`
}

export default function MermaidDiagram({ caption, source, legend = [] }) {
  const reactId = useId().replace(/:/g, '_')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(null)
  const [showSource, setShowSource] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!source) return
    ensureMermaid()
    let cancelled = false
    ;(async () => {
      try {
        const enriched = injectClassDefs(source)
        const { svg: rendered } = await mermaid.render(`m_${reactId}`, enriched)
        if (cancelled) return
        setSvg(rendered)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e?.message || String(e))
      }
    })()
    return () => { cancelled = true }
  }, [source, reactId])

  const downloadSvg = useCallback(() => {
    if (!svg) return
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (caption || 'diagram').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.svg'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [svg, caption])

  if (!source) return null

  return (
    <>
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
          <>
            <div style={canvasFrame}>
              <div style={canvasInner} dangerouslySetInnerHTML={{ __html: svg }} />
              <div style={toolbar}>
                <IconBtn title="Download as SVG" onClick={downloadSvg}><Download size={14} /></IconBtn>
                <IconBtn title="Open fullscreen" onClick={() => setFullscreen(true)}><Maximize2 size={14} /></IconBtn>
              </div>
            </div>
            {legend && legend.length > 0 && <Legend items={legend} />}
          </>
        )}
      </figure>
      {fullscreen && (
        <FullscreenModal
          svg={svg}
          caption={caption}
          legend={legend}
          onClose={() => setFullscreen(false)}
          onDownload={downloadSvg}
        />
      )}
    </>
  )
}

function Legend({ items }) {
  return (
    <div style={legendShell} role="list" aria-label="Diagram legend">
      {items.map((it, i) => {
        const c = NODE_CLASSES[it.kind] || NODE_CLASSES.process
        return (
          <div key={i} style={legendItem} role="listitem">
            <span
              style={{
                ...swatch,
                background: c.fill,
                borderColor: c.stroke,
                color: c.text,
              }}
              aria-hidden="true"
            />
            <span style={legendLabel}>{it.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function FullscreenModal({ svg, caption, legend, onClose, onDownload }) {
  const [scale, setScale] = useState(1)
  const [origin, setOrigin] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onMouseDown = (e) => {
    dragRef.current = { x: e.clientX - origin.x, y: e.clientY - origin.y }
  }
  const onMouseMove = (e) => {
    if (!dragRef.current) return
    setOrigin({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y })
  }
  const onMouseUp = () => { dragRef.current = null }
  const onWheel = (e) => {
    e.preventDefault()
    setScale((s) => Math.max(0.4, Math.min(3, s - e.deltaY * 0.001)))
  }

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalShell} onClick={(e) => e.stopPropagation()}>
        <header style={modalHeader}>
          <div style={{ flex: 1, fontWeight: 600, color: 'var(--text-strong)' }}>
            {caption || 'Diagram'}
          </div>
          <IconBtn title="Zoom out" onClick={() => setScale((s) => Math.max(0.4, s - 0.2))}>
            <ZoomOut size={14} />
          </IconBtn>
          <span style={zoomReadout}>{Math.round(scale * 100)}%</span>
          <IconBtn title="Zoom in" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>
            <ZoomIn size={14} />
          </IconBtn>
          <IconBtn title="Reset" onClick={() => { setScale(1); setOrigin({ x: 0, y: 0 }) }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>1:1</span>
          </IconBtn>
          <IconBtn title="Download as SVG" onClick={onDownload}><Download size={14} /></IconBtn>
          <IconBtn title="Close" onClick={onClose}><X size={14} /></IconBtn>
        </header>
        <div
          style={modalCanvas}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        >
          <div
            style={{
              transform: `translate(${origin.x}px, ${origin.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: dragRef.current ? 'none' : 'transform 0.12s ease-out',
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        {legend?.length > 0 && (
          <footer style={modalFooter}><Legend items={legend} /></footer>
        )}
      </div>
    </div>
  )
}

function IconBtn({ title, onClick, children }) {
  return (
    <button type="button" title={title} onClick={onClick} style={iconBtn}>
      {children}
    </button>
  )
}

// =====================================================================
// Styles
// =====================================================================

const shell = {
  margin: '16px 0 0',
  padding: '20px 24px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}
const captionStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 14,
  fontStyle: 'italic',
  color: 'var(--text-muted)',
  textAlign: 'center',
}
const canvasFrame = {
  position: 'relative',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 16,
  overflow: 'auto',
}
const canvasInner = { display: 'flex', justifyContent: 'center' }
const toolbar = {
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'flex',
  gap: 4,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-pill)',
  padding: 4,
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
}
const iconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  background: 'transparent',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontFamily: 'inherit',
}

const legendShell = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px 18px',
  paddingTop: 6,
  borderTop: '1px dashed var(--border)',
}
const legendItem = { display: 'inline-flex', alignItems: 'center', gap: 8 }
const swatch = {
  display: 'inline-block',
  width: 14,
  height: 14,
  borderRadius: 3,
  border: '2px solid',
  flexShrink: 0,
}
const legendLabel = { fontSize: 12.5, color: 'var(--text)' }

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

const modalBackdrop = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.55)',
  backdropFilter: 'blur(4px)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
}
const modalShell = {
  width: 'min(1200px, 96vw)',
  height: 'min(90vh, 900px)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 20px 60px rgba(15,23,42,0.35)',
}
const modalHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '12px 16px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
}
const zoomReadout = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--text-muted)',
  minWidth: 40,
  textAlign: 'center',
}
const modalCanvas = {
  flex: 1,
  overflow: 'hidden',
  cursor: 'grab',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background:
    'repeating-conic-gradient(var(--bg-subtle) 0 25%, transparent 0 50%) 50% / 28px 28px',
}
const modalFooter = {
  padding: '12px 16px',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
}
