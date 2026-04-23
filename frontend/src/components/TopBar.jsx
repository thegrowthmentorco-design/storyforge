import React from 'react'
import { Badge, Button, IconButton } from './primitives.jsx'
import {
  ChevronRight,
  Sun,
  Moon,
  AlertTriangle,
  RefreshCw,
  Download,
  Sparkles,
  FileText,
} from './icons.jsx'

function exportMarkdown(extraction) {
  const e = extraction
  const lines = []
  lines.push(`# ${e.filename}\n`)
  lines.push(`> ${e.brief.summary}\n`)
  if (e.brief.tags?.length) {
    lines.push(e.brief.tags.map((t) => `\`${t}\``).join(' ') + '\n')
  }
  lines.push('## Actors\n')
  e.actors.forEach((a) => lines.push(`- ${a}`))
  lines.push('\n## User Stories\n')
  e.stories.forEach((s) => {
    lines.push(`### ${s.id} — ${s.actor}`)
    lines.push(`**As a** ${s.actor} **I want** ${s.want} **so that** ${s.so_that}`)
    if (s.section) lines.push(`_Source: ${s.section}_`)
    if (s.criteria?.length) {
      lines.push('\n**Acceptance criteria:**')
      s.criteria.forEach((c) => lines.push(`- ${c}`))
    }
    lines.push('')
  })
  lines.push('## Non-Functional Requirements\n')
  lines.push('| Category | Value |')
  lines.push('|---|---|')
  e.nfrs.forEach((n) => lines.push(`| ${n.category} | ${n.value} |`))
  lines.push('\n## Gaps & questions\n')
  e.gaps.forEach((g) =>
    lines.push(`- **[${g.severity}]** ${g.question} _(${g.section})_ — ${g.context}`),
  )
  return lines.join('\n')
}

export default function TopBar({
  extraction,
  loading,
  theme,
  onTheme,
  showGaps,
  onToggleGaps,
  onReset,
}) {
  const onExport = () => {
    if (!extraction) return
    const md = exportMarkdown(extraction)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${extraction.filename.replace(/\.[^/.]+$/, '')}.stories.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      style={{
        height: 56,
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        gap: 10,
        flexShrink: 0,
        background: 'var(--bg-elevated)',
      }}
    >
      {extraction ? (
        <>
          <span style={{ color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={14} />
            Documents
          </span>
          <ChevronRight size={14} style={{ color: 'var(--text-soft)' }} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-strong)',
              maxWidth: 360,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {extraction.filename}
          </span>
          {loading ? (
            <Badge tone="info" icon={<Sparkles size={12} />}>
              Running
            </Badge>
          ) : extraction.live ? (
            <Badge tone="success" dot>
              Live · v1
            </Badge>
          ) : (
            <Badge tone="warn" icon={<AlertTriangle size={11} />}>
              Mock mode · no API key
            </Badge>
          )}
        </>
      ) : (
        <>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Home</span>
          <ChevronRight size={14} style={{ color: 'var(--text-soft)' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-strong)' }}>
            New extraction
          </span>
        </>
      )}

      <div style={{ flex: 1 }} />

      <IconButton
        label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
        onClick={() => onTheme(theme === 'light' ? 'dark' : 'light')}
      >
        {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
      </IconButton>

      {extraction && (
        <>
          <IconButton
            label={showGaps ? 'Hide gaps panel' : 'Show gaps panel'}
            onClick={onToggleGaps}
            active={showGaps}
          >
            <AlertTriangle size={15} />
          </IconButton>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} onClick={onReset}>
            New
          </Button>
          <Button variant="primary" size="sm" icon={<Download size={13} />} onClick={onExport}>
            Export .md
          </Button>
        </>
      )}
    </div>
  )
}
