/* M6.1 — client-side export helpers.
 *
 * MD / JSON / CSV are generated in the browser since the frontend already
 * holds the full ExtractionRecord (no server round-trip needed). DOCX is
 * served from `/api/extractions/{id}/export.docx` via api.js — too heavy
 * for client-side generation (would need a 250 KB JS lib).
 *
 * Each builder returns a string. `download()` packages it as a Blob +
 * triggers the browser save dialog via a synthesized <a download> click.
 */

// ---- builders -------------------------------------------------------------

export function buildMarkdown(extraction) {
  const e = extraction
  const lines = []
  lines.push(`# ${e.filename}\n`)
  if (e.brief?.summary) lines.push(`> ${e.brief.summary}\n`)
  if (e.brief?.tags?.length) {
    lines.push(e.brief.tags.map((t) => `\`${t}\``).join(' ') + '\n')
  }
  if (e.actors?.length) {
    lines.push('## Actors\n')
    e.actors.forEach((a) => lines.push(`- ${a}`))
  }
  if (e.stories?.length) {
    lines.push('\n## User Stories\n')
    e.stories.forEach((s) => {
      lines.push(`### ${s.id} — ${s.actor}`)
      lines.push(`**As a** ${s.actor} **I want** ${s.want} **so that** ${s.so_that}`)
      if (s.section) lines.push(`_Source: ${s.section}_`)
      if (s.criteria?.length) {
        lines.push('\n**Acceptance criteria:**')
        s.criteria.forEach((c) => lines.push(`- ${c}`))
      }
      if (s.source_quote) lines.push(`\n> ${s.source_quote}`)
      lines.push('')
    })
  }
  if (e.nfrs?.length) {
    lines.push('## Non-Functional Requirements\n')
    lines.push('| Category | Value |')
    lines.push('|---|---|')
    e.nfrs.forEach((n) => lines.push(`| ${n.category} | ${n.value} |`))
  }
  if (e.gaps?.length) {
    lines.push('\n## Gaps & questions\n')
    e.gaps.forEach((g) => {
      const sec = g.section ? ` _(${g.section})_` : ''
      lines.push(`- **[${g.severity}]** ${g.question}${sec} — ${g.context || ''}`)
    })
  }
  return lines.join('\n')
}

/* Strip server-only fields the frontend shouldn't expose to a downloader.
 * raw_text is the source doc — keep it; it's already what was uploaded.
 * source_file_path may be an internal r2:// URI — strip it.
 * user_id / org_id are scope info — strip. */
export function buildJson(extraction) {
  const { source_file_path, user_id, org_id, ...safe } = extraction || {}
  return JSON.stringify(safe, null, 2)
}

/* CSV with sections separated by header rows. One file is friendlier than
 * a zip; Excel + Sheets both handle multi-section CSV by treating section
 * headers as plain rows the user can manually split. */
export function buildCsv(extraction) {
  const e = extraction
  const rows = []

  // Stories table
  if (e.stories?.length) {
    rows.push(['# Stories'])
    rows.push(['id', 'actor', 'want', 'so_that', 'section', 'criteria', 'source_quote'])
    e.stories.forEach((s) => {
      rows.push([
        s.id || '',
        s.actor || '',
        s.want || '',
        s.so_that || '',
        s.section || '',
        (s.criteria || []).join(' | '),
        s.source_quote || '',
      ])
    })
    rows.push([])
  }

  if (e.nfrs?.length) {
    rows.push(['# NFRs'])
    rows.push(['category', 'value', 'source_quote'])
    e.nfrs.forEach((n) => {
      rows.push([n.category || '', n.value || '', n.source_quote || ''])
    })
    rows.push([])
  }

  if (e.gaps?.length) {
    rows.push(['# Gaps'])
    rows.push(['severity', 'question', 'section', 'context', 'source_quote'])
    e.gaps.forEach((g) => {
      rows.push([g.severity || '', g.question || '', g.section || '', g.context || '', g.source_quote || ''])
    })
    rows.push([])
  }

  if (e.brief?.summary || e.brief?.tags?.length) {
    rows.push(['# Brief'])
    rows.push(['summary', 'tags'])
    rows.push([e.brief?.summary || '', (e.brief?.tags || []).join(' | ')])
  }

  return rows.map((r) => r.map(escapeCsvCell).join(',')).join('\n')
}

function escapeCsvCell(v) {
  const s = String(v ?? '')
  // RFC 4180: quote if contains ", comma, or newline. Inside quotes,
  // double up any " characters.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// ---- download trigger -----------------------------------------------------

/* Build a Blob from `content` + `mimeType`, synthesize a click on a
 * temporary <a download>, then revoke the URL. No async — runs in the
 * same task as the user's click so browsers don't block it as
 * "popup-during-async". */
export function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after a tick so the download finishes referencing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* Strip the source-file extension so downloads read as
 * "requirements.md" / ".csv" / ".json" not "requirements.pdf.md". */
export function exportBaseName(filename) {
  return (filename || 'extraction').replace(/\.[^/.]+$/, '')
}
