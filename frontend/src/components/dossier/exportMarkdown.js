/**
 * M14.6 — DocumentDossier → Markdown serializer.
 *
 * Walks the lens_payload shape (see backend/services/lenses/dossier.py)
 * and emits a single GitHub-flavored markdown string suitable for paste
 * into Notion / Linear / a .md file. Pure function — no DOM, no fetch.
 *
 * Section ordering matches DossierPane's render order so the exported
 * document feels identical to what the user sees on screen.
 */

const NL = '\n'
const NL2 = '\n\n'

function safe(s) {
  if (s === null || s === undefined) return ''
  return String(s)
}

function bullets(items, fmt = (x) => x) {
  if (!items || items.length === 0) return ''
  return items.map((it) => `- ${fmt(it)}`).join(NL)
}

function numbered(items, fmt = (x) => x) {
  if (!items || items.length === 0) return ''
  return items.map((it, i) => `${i + 1}. ${fmt(it)}`).join(NL)
}

function h1(s) { return `# ${s}` }
function h2(s) { return `## ${s}` }
function h3(s) { return `### ${s}` }
function quote(s) { return s.split('\n').map((l) => `> ${l}`).join(NL) }

function brief(b) {
  if (!b) return ''
  let out = h2('Brief') + NL2 + safe(b.summary)
  if (b.tags && b.tags.length > 0) {
    out += NL2 + b.tags.map((t) => `\`${t}\``).join(' ')
  }
  return out
}

function tldrLadder(l) {
  if (!l) return ''
  const rows = [
    ['1 line', l.one_line],
    ['1 paragraph', l.one_paragraph],
    ['1 page', l.one_page],
  ].filter(([, v]) => v)
  if (rows.length === 0) return ''
  return h2('TLDR Ladder') + NL2 + rows.map(([k, v]) => `**${k}**${NL}${NL}${safe(v)}`).join(NL2)
}

function fiveW1H(w) {
  if (!w) return ''
  const cells = [
    ['Who', w.who], ['What', w.what], ['When', w.when],
    ['Where', w.where], ['Why', w.why], ['How', w.how],
  ].filter(([, v]) => v)
  if (cells.length === 0) return ''
  return h2('5W1H') + NL2 + cells.map(([k, v]) => `**${k}** — ${safe(v)}`).join(NL2)
}

function glossary(terms) {
  if (!terms || terms.length === 0) return ''
  return h2('Glossary') + NL2 + terms.map((t) => `- **${safe(t.term)}** — ${safe(t.definition)}`).join(NL)
}

function mindmap(m) {
  if (!m) return ''
  let out = h2('Mindmap') + NL2 + `**${safe(m.root)}**`
  for (const branch of (m.branches || [])) {
    out += NL + `- ${safe(branch.label)}`
    for (const sub of (branch.children || [])) {
      out += NL + `  - ${safe(sub.label)}`
      for (const leaf of (sub.children || [])) {
        out += NL + `    - ${safe(leaf.label)}`
      }
    }
  }
  return out
}

function domain(d) {
  if (!d) return ''
  const branches = [
    ['Business Purpose', d.business_purpose],
    ['Stakeholders', d.stakeholders],
    ['Process Flow', d.process_flow],
    ['Data', d.data],
    ['Rules', d.rules],
    ['Metrics', d.metrics],
    ['Problems / Opportunities', d.problems_opportunities],
  ].filter(([, v]) => v && v.points && v.points.length > 0)
  if (branches.length === 0) return ''
  return h2('Domain Map') + NL2 + branches.map(([k, v]) => h3(k) + NL2 + bullets(v.points)).join(NL2)
}

function systems(s) {
  if (!s) return ''
  const parts = []
  if (s.entities && s.entities.length > 0) {
    parts.push(h3('Entities') + NL2 + s.entities.map((e) => `- **${safe(e.name)}** — ${safe(e.role)}`).join(NL))
  }
  if (s.flows && s.flows.length > 0) {
    parts.push(h3('Flows') + NL2 + s.flows.map((f) => `- \`${safe(f.from_entity)}\` → \`${safe(f.to_entity)}\` — ${safe(f.label)}`).join(NL))
  }
  if (s.feedback_loops && s.feedback_loops.length > 0) {
    parts.push(h3('Feedback Loops') + NL2 + bullets(s.feedback_loops, (l) => safe(l.description)))
  }
  if (parts.length === 0) return ''
  return h2('Systems View') + NL2 + parts.join(NL2)
}

function fiveWhys(steps) {
  if (!steps || steps.length === 0) return ''
  return h2('5 Whys') + NL2 + steps.map((s, i) => {
    let out = `**${i + 1}. ${safe(s.question)}**${NL2}→ ${safe(s.answer)}`
    if (s.evidence) out += NL2 + quote(safe(s.evidence))
    return out
  }).join(NL2)
}

function assumptions(items) {
  if (!items || items.length === 0) return ''
  return h2('Assumptions Audit') + NL2 + items.map((a) => {
    const risk = (a.risk_level || '').toUpperCase()
    return `- **[${risk}]** ${safe(a.assumption)}${a.risk_explanation ? `${NL}  - _${safe(a.risk_explanation)}_` : ''}`
  }).join(NL)
}

function inversion(items) {
  if (!items || items.length === 0) return ''
  return h2("Inversion · what could go catastrophically wrong") + NL2 +
    items.map((f) => `- × ${safe(f.scenario)}${f.likelihood ? ` _(${safe(f.likelihood)})_` : ''}`).join(NL)
}

function betterQuestions(items) {
  if (!items || items.length === 0) return ''
  return h2('Better Questions') + NL2 + items.map((q, i) => {
    let out = `${i + 1}. ${safe(q.question)}`
    if (q.why_it_matters) out += `${NL}   - _${safe(q.why_it_matters)}_`
    return out
  }).join(NL)
}

function actionItems(items) {
  if (!items || items.length === 0) return ''
  let out = h2('Action Items') + NL2
  out += `| Owner | Action | When |${NL}|---|---|---|`
  for (const a of items) {
    const action = safe(a.action).replace(/\|/g, '\\|')
    out += NL + `| \`${safe(a.owner)}\` | ${action} | ${safe(a.when)} |`
  }
  return out
}

function decisions(made, open) {
  const m = made || [], o = open || []
  if (m.length === 0 && o.length === 0) return ''
  let out = h2('Decisions')
  if (m.length > 0) out += NL2 + h3('Decisions Made') + NL2 + bullets(m, safe)
  if (o.length > 0) out += NL2 + h3('Open / Unresolved') + NL2 + bullets(o, safe)
  return out
}

function whatToRevisit(items) {
  if (!items || items.length === 0) return ''
  return h2('What to Revisit') + NL2 + items.map((r, i) =>
    `${i + 1}. **${safe(r.item)}**${r.why ? `${NL}   - _${safe(r.why)}_` : ''}`,
  ).join(NL)
}

function userStories(stories) {
  if (!stories || stories.length === 0) return ''
  return h2('User Stories') + NL2 + stories.map((s) => {
    let out = `### \`${safe(s.id)}\``
    out += NL2 + `**As a** ${safe(s.actor)}, **I want** ${safe(s.want)} **so that** ${safe(s.so_that)}.`
    if (s.criteria && s.criteria.length > 0) {
      out += NL2 + '**Acceptance criteria:**' + NL2 + bullets(s.criteria, safe)
    }
    if (s.source_quote) out += NL2 + quote(safe(s.source_quote))
    return out
  }).join(NL2)
}

function numbersExtract(extract) {
  if (!extract?.facts || extract.facts.length === 0) return ''
  const order = ['cost', 'time', 'count', 'percentage', 'other']
  const labels = { cost: 'Cost', time: 'Time', count: 'Count', percentage: 'Percentage', other: 'Other' }
  const grouped = order
    .map((cat) => ({ cat, items: extract.facts.filter((f) => f.category === cat) }))
    .filter((g) => g.items.length > 0)
  if (grouped.length === 0) return ''
  let out = h2('Numbers Extract')
  for (const { cat, items } of grouped) {
    out += NL2 + h3(labels[cat]) + NL2 + items.map((f) => `- **${safe(f.value)}** — ${safe(f.label)}`).join(NL)
  }
  return out
}

function timeline(t) {
  if (!t?.phases || t.phases.length === 0) return ''
  return h2('Timeline') + NL2 + t.phases.map((p, i) => {
    let out = `${i + 1}. **${safe(p.label)}** _(${safe(p.when)})_`
    if (p.description) out += `${NL}   - ${safe(p.description)}`
    return out
  }).join(NL)
}

function negativeSpace(s) {
  if (!s?.items || s.items.length === 0) return ''
  return h2("Negative Space · what the doc doesn't say") + NL2 +
    s.items.map((it) => `- ∅ **${safe(it.missing_item)}** — ${safe(it.why_it_matters)}`).join(NL)
}

/**
 * Convert a DocumentDossier payload (lens_payload) into a markdown string.
 * Pass the extraction record so the title + filename make it into the header.
 */
export function dossierToMarkdown(extraction) {
  const d = extraction?.lens_payload
  if (!d) return ''

  const filename = extraction?.filename || 'Untitled document'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const parts = [
    h1(filename),
    `_Lucid dossier · exported ${generatedAt}_`,
  ]

  if (d.overture) parts.push(quote(safe(d.overture)))

  // Act I — Orient
  parts.push(h2('Act I · Orient'))
  if (d.orient_intro) parts.push(`_${safe(d.orient_intro)}_`)
  parts.push(brief(d.brief))
  parts.push(numbersExtract(d.numbers_extract))
  parts.push(tldrLadder(d.tldr_ladder))
  parts.push(fiveW1H(d.five_w_one_h))

  // Act II — Structure
  parts.push(h2('Act II · Structure'))
  if (d.structure_intro) parts.push(`_${safe(d.structure_intro)}_`)
  parts.push(glossary(d.glossary))
  parts.push(mindmap(d.mindmap))
  parts.push(domain(d.domain))
  parts.push(timeline(d.timeline))
  parts.push(systems(d.systems))

  // Act III — Interrogate
  parts.push(h2('Act III · Interrogate'))
  if (d.interrogate_intro) parts.push(`_${safe(d.interrogate_intro)}_`)
  parts.push(fiveWhys(d.five_whys))
  parts.push(assumptions(d.assumptions))
  parts.push(inversion(d.inversion))
  parts.push(negativeSpace(d.negative_space))
  parts.push(betterQuestions(d.better_questions))

  // Act IV — Act
  parts.push(h2('Act IV · Act'))
  if (d.act_intro) parts.push(`_${safe(d.act_intro)}_`)
  parts.push(actionItems(d.action_items))
  parts.push(decisions(d.decisions_made, d.decisions_open))
  parts.push(whatToRevisit(d.what_to_revisit))
  parts.push(userStories(d.user_stories))

  if (d.closing) parts.push('---' + NL2 + `_${safe(d.closing)}_`)

  return parts.filter((p) => p && p.length > 0).join(NL2) + NL
}

/**
 * Trigger a browser download of `content` as a file. Used by the export
 * button. Wrapped here so the caller doesn't need to deal with Blob /
 * URL.createObjectURL boilerplate.
 */
export function downloadFile(content, filename, mime = 'text/markdown') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Replace all chars unsafe for filenames with '_' and append the extension.
 */
export function suggestExportFilename(extraction, ext = 'md') {
  const base = (extraction?.filename || 'dossier').replace(/\.[^.]+$/, '')
  const safeName = base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  return `${safeName}.${ext}`
}
