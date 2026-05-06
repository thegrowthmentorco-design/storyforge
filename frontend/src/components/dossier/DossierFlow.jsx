/**
 * M14.15 — Flow view for the dossier.
 *
 * Sections rendered as cards on a 4-column canvas (one column per Act),
 * with SVG arrows showing the narrative order Brief → TLDR → 5W1H → ...
 * → Closing. Clicking a card switches back to Read view + scrolls to
 * that section.
 *
 * The user sees the SHAPE of the document at a glance — how many
 * sections each act has, where the bulk of the content sits, where the
 * narrative branches (e.g. inversion + assumptions both feeding into
 * better questions). The Read view stays the place to actually read.
 *
 * v1 keeps it simple: no pan/zoom (just normal page scroll), no popover
 * previews (cards show 2-line summaries inline), no minimap. Phase 2.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Box,
  Calendar,
  Check,
  CheckCircle,
  FileText,
  HelpCircle,
  LayoutTemplate,
  Lightbulb,
  Search,
  Sparkles,
  Tag,
  Users,
  Zap,
} from '../icons.jsx'

// ============================================================================
// Section metadata — title, icon, summary extractor, metric extractor.
// Order within each act matches DossierPane's render order so the arrow
// chain reads as the same narrative.
// ============================================================================

const ACTS = [
  { key: 'orient', roman: 'I', title: 'Orient', accent: '--accent' },
  { key: 'structure', roman: 'II', title: 'Structure', accent: '--info' },
  { key: 'interrogate', roman: 'III', title: 'Interrogate', accent: '--warn' },
  { key: 'act', roman: 'IV', title: 'Act', accent: '--success' },
]

const SECTIONS = [
  // --- Act I — Orient ---
  {
    key: 'brief', act: 'orient', title: 'Brief', icon: FileText,
    summary: (d) => d.brief?.summary,
    metric: (d) => (d.brief?.tags?.length ? `${d.brief.tags.length} tags` : null),
    preview: (d) => {
      const tags = d.brief?.tags || []
      return tags.length ? { kind: 'chips', items: tags } : null
    },
  },
  {
    key: 'numbers_extract', act: 'orient', title: 'Numbers', icon: Sparkles,
    summary: (d) => {
      const n = d.numbers_extract?.facts?.length || 0
      return n > 0 ? `${n} facts pulled from the document.` : null
    },
    metric: (d) => {
      const n = d.numbers_extract?.facts?.length || 0
      return n > 0 ? `${n} facts` : null
    },
  },
  {
    key: 'tldr_ladder', act: 'orient', title: 'TLDR Ladder', icon: LayoutTemplate,
    summary: (d) => d.tldr_ladder?.one_line,
    metric: () => '3 depths',
    preview: (d) => {
      const l = d.tldr_ladder
      if (!l) return null
      const items = [
        l.one_line && { label: '1 line', text: l.one_line },
        l.one_paragraph && { label: '1 paragraph', text: l.one_paragraph },
      ].filter(Boolean)
      return items.length ? { kind: 'labeled', items } : null
    },
  },
  {
    key: 'five_w_one_h', act: 'orient', title: '5W1H', icon: HelpCircle,
    summary: (d) => {
      const w = d.five_w_one_h
      if (!w) return null
      // Show "who" as the preview — usually the most identifying.
      return w.who ? `Who: ${w.who}` : null
    },
    metric: () => '6 cells',
  },
  // --- Act II — Structure ---
  {
    key: 'glossary', act: 'structure', title: 'Glossary', icon: BookOpen,
    summary: (d) => {
      const n = d.glossary?.length || 0
      return n > 0 ? `${n} specialist terms decoded.` : null
    },
    metric: (d) => (d.glossary?.length ? `${d.glossary.length} terms` : null),
  },
  {
    key: 'mindmap', act: 'structure', title: 'Mindmap', icon: Activity,
    summary: (d) => d.mindmap?.root,
    metric: (d) => (d.mindmap?.branches?.length ? `${d.mindmap.branches.length} branches` : null),
  },
  {
    key: 'domain', act: 'structure', title: 'Domain Map', icon: Box,
    summary: (d) => d.domain?.business_purpose?.points?.[0],
    metric: () => '7 dimensions',
  },
  {
    key: 'timeline', act: 'structure', title: 'Timeline', icon: Calendar,
    summary: (d) => {
      const n = d.timeline?.phases?.length || 0
      return n > 0 ? `${n} phases extracted.` : null
    },
    metric: (d) => (d.timeline?.phases?.length ? `${d.timeline.phases.length} phases` : null),
  },
  {
    key: 'systems', act: 'structure', title: 'Systems View', icon: Activity,
    summary: (d) => {
      const e = d.systems?.entities?.length || 0
      const f = d.systems?.flows?.length || 0
      return e || f ? `${e} entities · ${f} flows` : null
    },
    metric: (d) => (d.systems?.entities?.length ? `${d.systems.entities.length} entities` : null),
  },
  // --- Act III — Interrogate ---
  {
    key: 'five_whys', act: 'interrogate', title: '5 Whys', icon: Search,
    summary: (d) => d.five_whys?.[0]?.question,
    metric: (d) => (d.five_whys?.length ? `${d.five_whys.length} steps` : null),
    preview: (d) => {
      const items = (d.five_whys || []).slice(0, 3).map((s, i) => ({
        label: `Why ${i + 1}`, text: s.question,
      }))
      return items.length ? { kind: 'labeled', items } : null
    },
  },
  {
    key: 'assumptions', act: 'interrogate', title: 'Assumptions', icon: Lightbulb,
    summary: (d) => d.assumptions?.[0]?.assumption,
    metric: (d) => {
      const items = d.assumptions || []
      const high = items.filter((a) => a.risk_level === 'high').length
      return items.length ? `${items.length} (${high} high)` : null
    },
    metricTone: 'warn',
    preview: (d) => {
      const order = { high: 0, medium: 1, low: 2 }
      const items = (d.assumptions || [])
        .slice()
        .sort((a, b) => (order[a.risk_level] ?? 9) - (order[b.risk_level] ?? 9))
        .slice(0, 4)
        .map((a) => ({ label: (a.risk_level || 'risk').toUpperCase(), text: a.assumption }))
      return items.length ? { kind: 'labeled', items } : null
    },
  },
  {
    key: 'inversion', act: 'interrogate', title: 'Inversion', icon: AlertTriangle,
    summary: (d) => d.inversion?.[0]?.scenario,
    metric: (d) => (d.inversion?.length ? `${d.inversion.length} risks` : null),
    metricTone: 'danger',
    preview: (d) => {
      const items = (d.inversion || []).slice(0, 4).map((f) => ({
        label: '×', text: f.scenario,
      }))
      return items.length ? { kind: 'labeled', items } : null
    },
  },
  {
    key: 'negative_space', act: 'interrogate', title: 'Negative Space', icon: AlertTriangle,
    summary: (d) => d.negative_space?.items?.[0]?.missing_item,
    metric: (d) => {
      const n = d.negative_space?.items?.length || 0
      return n > 0 ? `${n} gaps` : null
    },
    metricTone: 'warn',
  },
  {
    key: 'better_questions', act: 'interrogate', title: 'Better Questions', icon: Search,
    summary: (d) => d.better_questions?.[0]?.question,
    metric: (d) => (d.better_questions?.length ? `${d.better_questions.length} questions` : null),
    preview: (d) => {
      const items = (d.better_questions || []).slice(0, 4).map((q, i) => ({
        label: `${i + 1}.`, text: q.question,
      }))
      return items.length ? { kind: 'labeled', items } : null
    },
  },
  // --- Act IV — Act ---
  {
    key: 'action_items', act: 'act', title: 'Action Items', icon: CheckCircle,
    summary: (d) => d.action_items?.[0]?.action,
    metric: (d) => (d.action_items?.length ? `${d.action_items.length} actions` : null),
    metricTone: 'success',
    preview: (d) => {
      const items = (d.action_items || []).slice(0, 4).map((a) => ({
        label: a.owner || 'TBD', text: a.action,
      }))
      return items.length ? { kind: 'labeled', items } : null
    },
  },
  {
    key: 'decisions_made', act: 'act', title: 'Decisions Made', icon: Check,
    summary: (d) => d.decisions_made?.[0],
    metric: (d) => (d.decisions_made?.length ? `${d.decisions_made.length} settled` : null),
    metricTone: 'success',
  },
  {
    key: 'decisions_open', act: 'act', title: 'Open Decisions', icon: AlertTriangle,
    summary: (d) => d.decisions_open?.[0],
    metric: (d) => {
      const n = d.decisions_open?.length || 0
      return n > 0 ? `${n} open` : null
    },
    metricTone: 'warn',
  },
  {
    key: 'what_to_revisit', act: 'act', title: 'Revisit', icon: BookOpen,
    summary: (d) => d.what_to_revisit?.[0]?.item,
    metric: (d) => (d.what_to_revisit?.length ? `${d.what_to_revisit.length} items` : null),
  },
  {
    key: 'user_stories', act: 'act', title: 'User Stories', icon: Users,
    summary: (d) => {
      const n = d.user_stories?.length || 0
      return n > 0 ? `${n} stories with acceptance criteria.` : null
    },
    metric: (d) => (d.user_stories?.length ? `${d.user_stories.length} stories` : null),
  },
]

// Narrative arrow chain — the order Claude tells the story in. Maps to
// section keys, not act keys. Skips sections that aren't present in the
// payload (so partial dossiers still render a sensible chain).
const NARRATIVE_ORDER = SECTIONS.map((s) => s.key)

// M14.15.b — bridge field lookup. Maps (fromKey, toKey) to the dossier
// field holding the narrator-bridge text that connects them in Read view.
// Where two consecutive sections have multiple possible bridges (e.g.
// brief → tldr_ladder has both bridge_brief_to_numbers AND the legacy
// bridge_brief_to_tldr depending on which sections are present), we pick
// the one that matches the actual chain.
const BRIDGE_FIELDS = {
  'brief|numbers_extract': 'bridge_brief_to_numbers',
  'numbers_extract|tldr_ladder': 'bridge_numbers_to_tldr',
  'brief|tldr_ladder': 'bridge_brief_to_tldr',
  'tldr_ladder|five_w_one_h': 'bridge_tldr_to_5w1h',
  'five_w_one_h|glossary': 'bridge_5w1h_to_structure',
  'glossary|mindmap': 'bridge_glossary_to_mindmap',
  'mindmap|domain': 'bridge_mindmap_to_domain',
  'domain|timeline': 'bridge_domain_to_timeline',
  'timeline|systems': 'bridge_timeline_to_systems',
  'domain|systems': 'bridge_domain_to_systems',
  'systems|five_whys': 'bridge_systems_to_interrogate',
  'five_whys|assumptions': 'bridge_whys_to_assumptions',
  'assumptions|inversion': 'bridge_assumptions_to_inversion',
  'inversion|negative_space': 'bridge_inversion_to_negative_space',
  'negative_space|better_questions': 'bridge_negative_space_to_questions',
  'inversion|better_questions': 'bridge_inversion_to_questions',
  'better_questions|action_items': 'bridge_questions_to_act',
}
function bridgeText(dossier, fromKey, toKey) {
  const field = BRIDGE_FIELDS[`${fromKey}|${toKey}`]
  if (!field) return null
  const t = dossier?.[field]
  return t && t.trim() ? t : null
}


export default function DossierFlow({ dossier, onJumpToSection }) {
  // Section refs for arrow positioning. Stored in a single map so the
  // layout effect can read them all in one pass.
  const cardRefs = useRef({})
  const containerRef = useRef(null)
  const [arrowPaths, setArrowPaths] = useState([])
  const [hoveredArrowIdx, setHoveredArrowIdx] = useState(null)

  // Group sections by act + filter to ones with content. Sections with
  // no content (e.g., empty user_stories on a non-requirements doc)
  // don't render as cards or as arrow waypoints.
  const presentSections = SECTIONS.filter((s) => {
    const v = dossier?.[s.key]
    if (v == null) return false
    if (Array.isArray(v) && v.length === 0) return false
    if (typeof v === 'object' && Object.keys(v).length === 0) return false
    // Sub-list checks for nested-list sections.
    if (s.key === 'numbers_extract' && !v.facts?.length) return false
    if (s.key === 'timeline' && !v.phases?.length) return false
    if (s.key === 'negative_space' && !v.items?.length) return false
    return true
  })

  const sectionsByAct = ACTS.reduce((acc, a) => {
    acc[a.key] = presentSections.filter((s) => s.act === a.key)
    return acc
  }, {})

  // Recompute arrow paths whenever cards mount, the dossier changes, or
  // the window resizes. Reads each card's bounding box relative to the
  // container so arrows survive zoom + responsive layout.
  useLayoutEffect(() => {
    function compute() {
      if (!containerRef.current) return
      const containerBox = containerRef.current.getBoundingClientRect()
      const order = NARRATIVE_ORDER.filter((k) => cardRefs.current[k])
      const paths = []
      for (let i = 0; i < order.length - 1; i++) {
        const fromEl = cardRefs.current[order[i]]
        const toEl = cardRefs.current[order[i + 1]]
        if (!fromEl || !toEl) continue
        const a = fromEl.getBoundingClientRect()
        const b = toEl.getBoundingClientRect()
        // Anchor on the right edge of `from` and left edge of `to` when
        // they're in different columns; bottom→top when in same column.
        const sameAct = SECTIONS.find((s) => s.key === order[i])?.act
          === SECTIONS.find((s) => s.key === order[i + 1])?.act
        let fromX, fromY, toX, toY
        if (sameAct) {
          // vertical link inside a column
          fromX = (a.left + a.right) / 2 - containerBox.left
          fromY = a.bottom - containerBox.top
          toX = (b.left + b.right) / 2 - containerBox.left
          toY = b.top - containerBox.top
        } else {
          // horizontal link across columns (right edge → left edge)
          fromX = a.right - containerBox.left
          fromY = (a.top + a.bottom) / 2 - containerBox.top
          toX = b.left - containerBox.left
          toY = (b.top + b.bottom) / 2 - containerBox.top
        }
        // Bezier curve. Control points pulled toward the source/target
        // direction so curves look natural for both vertical + horizontal.
        const dx = toX - fromX, dy = toY - fromY
        const cx1 = fromX + (sameAct ? 0 : Math.max(40, dx / 3))
        const cy1 = fromY + (sameAct ? Math.max(20, dy / 3) : 0)
        const cx2 = toX - (sameAct ? 0 : Math.max(40, dx / 3))
        const cy2 = toY - (sameAct ? Math.max(20, dy / 3) : 0)
        // Approximate path midpoint via bezier formula at t=0.5.
        // For C(P0, P1, P2, P3) at t=0.5: B = (P0 + 3P1 + 3P2 + P3) / 8.
        const midX = (fromX + 3 * cx1 + 3 * cx2 + toX) / 8
        const midY = (fromY + 3 * cy1 + 3 * cy2 + toY) / 8
        paths.push({
          d: `M ${fromX} ${fromY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${toX} ${toY}`,
          fromKey: order[i],
          toKey: order[i + 1],
          midX, midY,
          bridge: bridgeText(dossier, order[i], order[i + 1]),
        })
      }
      setArrowPaths(paths)
    }
    compute()
    const ro = new ResizeObserver(compute)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', compute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', compute)
    }
  }, [dossier])

  if (!dossier) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        No dossier to flow.
      </div>
    )
  }

  return (
    <div ref={containerRef} style={canvasStyle}>
      {/* SVG arrow layer — sits behind the cards (zIndex 0) so it doesn't
          intercept clicks. Cards have zIndex 1. M14.15.b — arrows that
          carry a narrative bridge become hover targets that surface the
          bridge text as a floating tooltip. */}
      <svg style={svgLayerStyle} aria-hidden={hoveredArrowIdx == null}>
        <defs>
          <marker
            id="flow-arrowhead"
            viewBox="0 0 10 10"
            refX="8" refY="5"
            markerWidth="6" markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-strong)" />
          </marker>
        </defs>
        {arrowPaths.map((p, i) => {
          const hasBridge = !!p.bridge
          const isHovered = hoveredArrowIdx === i
          return (
            <g key={i}>
              {/* Visible stroke — pointerEvents none so clicks pass to cards */}
              <path
                d={p.d}
                fill="none"
                stroke="var(--accent-strong)"
                strokeWidth={isHovered ? '2.5' : '1.5'}
                strokeOpacity={isHovered ? '0.8' : '0.45'}
                markerEnd="url(#flow-arrowhead)"
                pointerEvents="none"
                style={{ transition: 'stroke-width var(--dur-fast), stroke-opacity var(--dur-fast)' }}
              />
              {/* Wider invisible hit area for hover detection. Only when
                  the arrow has a bridge to show; otherwise no need to
                  capture pointer events. */}
              {hasBridge && (
                <path
                  d={p.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                  pointerEvents="stroke"
                  style={{ cursor: 'help' }}
                  onMouseEnter={() => setHoveredArrowIdx(i)}
                  onMouseLeave={() => setHoveredArrowIdx((cur) => (cur === i ? null : cur))}
                />
              )}
            </g>
          )
        })}
      </svg>
      {/* M14.15.b — floating bridge-text tooltip. Rendered as HTML (not
          SVG) so it can use proper text wrapping + theme tokens. */}
      {hoveredArrowIdx != null && arrowPaths[hoveredArrowIdx]?.bridge && (
        <div
          style={{
            ...bridgeTooltipStyle,
            left: arrowPaths[hoveredArrowIdx].midX,
            top: arrowPaths[hoveredArrowIdx].midY,
          }}
          role="tooltip"
        >
          {arrowPaths[hoveredArrowIdx].bridge}
        </div>
      )}

      <div style={gridStyle}>
        {ACTS.map((act) => (
          <FlowColumn
            key={act.key}
            act={act}
            sections={sectionsByAct[act.key]}
            dossier={dossier}
            onJump={onJumpToSection}
            cardRefs={cardRefs}
          />
        ))}
      </div>
    </div>
  )
}


function FlowColumn({ act, sections, dossier, onJump, cardRefs }) {
  return (
    <div style={columnStyle}>
      <div style={columnHeaderStyle}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: `var(${act.accent})`,
          marginBottom: 2,
        }}>
          ACT {act.roman}
        </span>
        <h3 style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--text-strong)',
          letterSpacing: '-0.015em',
        }}>
          {act.title}
        </h3>
        <span style={{ fontSize: 11, color: 'var(--text-soft)' }}>
          {sections.length} section{sections.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sections.length === 0 ? (
          <div style={emptyColumnStyle}>No content yet.</div>
        ) : (
          sections.map((s) => (
            <FlowCard
              key={s.key}
              section={s}
              dossier={dossier}
              onJump={onJump}
              cardRefs={cardRefs}
              actAccent={act.accent}
            />
          ))
        )}
      </div>
    </div>
  )
}


function FlowCard({ section, dossier, onJump, cardRefs, actAccent }) {
  const Icon = section.icon
  const summary = section.summary?.(dossier)
  const metric = section.metric?.(dossier)
  const tone = section.metricTone || 'neutral'
  const toneColors = {
    neutral: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success-ink)' },
    warn:    { bg: 'var(--warn-soft)',    fg: 'var(--warn-ink)' },
    danger:  { bg: 'var(--danger-soft)',  fg: 'var(--danger-ink)' },
  }[tone]
  // M14.15.b — hover popover with section preview. 350ms delay so quick
  // pointer-fly-throughs don't open it; cancelled if pointer leaves
  // before the timeout fires.
  const preview = section.preview?.(dossier)
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const hoverTimer = React.useRef(null)
  const openPopover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setPopoverOpen(true), 350)
  }
  const closePopover = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    setPopoverOpen(false)
  }
  React.useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
  }, [])
  return (
    <div style={{ position: 'relative' }}>
    <button
      ref={(el) => { cardRefs.current[section.key] = el }}
      type="button"
      onClick={() => onJump?.(section.key, section.act)}
      style={cardStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `var(${actAccent})`
        e.currentTarget.style.boxShadow = 'var(--shadow-md)'
        e.currentTarget.style.transform = 'translateY(-1px)'
        openPopover()
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.boxShadow = 'var(--shadow-xs)'
        e.currentTarget.style.transform = 'translateY(0)'
        closePopover()
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 24, height: 24, borderRadius: 6,
          background: `var(${actAccent})`,
          color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={13} />
        </span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-strong)',
          flex: 1, minWidth: 0,
          textAlign: 'left',
        }}>
          {section.title}
        </span>
        {metric && (
          <span style={{
            fontSize: 10.5, fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 999,
            background: toneColors.bg,
            color: toneColors.fg,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.02em',
            flexShrink: 0,
          }}>
            {metric}
          </span>
        )}
      </div>
      {summary && (
        <p style={{
          margin: 0,
          fontSize: 12.5,
          lineHeight: 1.5,
          color: 'var(--text-muted)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          textAlign: 'left',
        }}>
          {summary}
        </p>
      )}
    </button>
    {popoverOpen && preview && (
      <CardPopover
        title={section.title}
        actAccent={actAccent}
        preview={preview}
      />
    )}
    </div>
  )
}

// M14.15.b — anchored hover popover. Sits above + slightly to the right
// of the card. pointer-events: none so the user can mouse-out cleanly.
function CardPopover({ title, actAccent, preview }) {
  return (
    <div style={popoverStyle}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-strong)',
        marginBottom: 8,
        borderBottom: `2px solid var(${actAccent})`,
        paddingBottom: 6,
      }}>
        {title}
      </div>
      {preview.kind === 'chips' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {preview.items.map((c, i) => (
            <span key={i} style={{
              fontSize: 11, fontFamily: 'var(--font-mono)',
              padding: '2px 8px', borderRadius: 999,
              background: 'var(--accent-soft)', color: 'var(--accent-ink)',
            }}>
              {c}
            </span>
          ))}
        </div>
      )}
      {preview.kind === 'labeled' && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {preview.items.map((it, i) => (
            <li key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{
                flexShrink: 0,
                minWidth: 50,
                fontSize: 10, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--text-soft)',
                fontFamily: 'var(--font-mono)',
                paddingTop: 2,
              }}>{it.label}</span>
              <span style={{
                flex: 1, fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)',
              }}>{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const popoverStyle = {
  position: 'absolute',
  top: -8,
  left: 'calc(100% + 12px)',
  width: 320,
  zIndex: 5,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
  boxShadow: 'var(--shadow-lg)',
  pointerEvents: 'none',
  // Fade in.
  animation: 'popoverIn 160ms var(--ease-out)',
}


// ============================================================================
// Styles
// ============================================================================

const canvasStyle = {
  position: 'relative',
  width: '100%',
  minHeight: '100%',
  padding: '32px clamp(20px, 4vw, 48px) 80px',
  background: 'var(--bg)',
  // Backdrop hint that this is a canvas — faint dotted grid.
  backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
  backgroundSize: '24px 24px',
  backgroundPosition: '0 0',
  overflow: 'auto',
}

const svgLayerStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  // Pointer-events live on individual <path> elements: visible strokes
  // get pointerEvents='none' so clicks pass through to cards beneath;
  // invisible hit-area strokes get pointerEvents='stroke' so they can
  // capture hover for the bridge-text tooltip.
  zIndex: 0,
}

const bridgeTooltipStyle = {
  position: 'absolute',
  zIndex: 4,
  transform: 'translate(-50%, -100%) translateY(-10px)',
  background: 'var(--text-strong)',
  color: 'var(--bg-elevated)',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 12.5,
  lineHeight: 1.5,
  fontStyle: 'italic',
  fontFamily: 'var(--font-display)',
  maxWidth: 320,
  textAlign: 'center',
  boxShadow: 'var(--shadow-lg)',
  pointerEvents: 'none',
  whiteSpace: 'normal',
}

const gridStyle = {
  position: 'relative',
  zIndex: 1,
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
  gap: 'clamp(40px, 6vw, 80px)',
  alignItems: 'flex-start',
  maxWidth: 1400,
  margin: '0 auto',
}

const columnStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const columnHeaderStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  paddingBottom: 12,
  borderBottom: '1px solid var(--border)',
}

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 14px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-xs)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  transition: 'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
}

const emptyColumnStyle = {
  padding: 14,
  fontSize: 12.5,
  color: 'var(--text-soft)',
  fontStyle: 'italic',
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius)',
  textAlign: 'center',
}
