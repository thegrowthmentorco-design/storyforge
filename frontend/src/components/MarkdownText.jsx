/**
 * M14.16.a — Tiny Markdown renderer for chat + dossier prose blocks.
 *
 * Supports the subset Claude actually uses in explainer / chat replies:
 *   # / ## / ### / #### headings
 *   - or * bullets (one level; nested lists fall back to indented bullets)
 *   1. ordered lists
 *   **bold**, *italic* / _italic_
 *   `inline code` and ```fenced``` code blocks
 *   [link text](url)
 *   --- horizontal rule
 *   > blockquote
 *   | table | rows | (M14.18.fix — added for explainer output)
 *   blank line = paragraph break, single newline = soft break
 *
 * Out of scope (rare in Claude output, not worth the bytes): footnotes,
 * task lists, nested tables, alignment in tables. React-markdown would be
 * the obvious dep but adds ~30 KB gzipped.
 */
import React from 'react'

const HEADING_RE = /^(#{1,4})\s+(.*)$/
const BULLET_RE = /^[-*]\s+(.*)$/
const ORDERED_RE = /^(\d+)\.\s+(.*)$/
const HR_RE = /^---+\s*$/
const FENCE_RE = /^```/
const QUOTE_RE = /^>\s?(.*)$/
// Table detection: a row starts with `|` and the next line is a separator
// of pipes and dashes (with optional `:` for alignment, ignored for now).
const TABLE_ROW_RE = /^\s*\|/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export default function MarkdownText({ text, style }) {
  if (!text || typeof text !== 'string') return null
  const blocks = parseBlocks(text)
  return (
    <div style={style}>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  )
}

// ============================================================================
// Block parser — splits the source into typed blocks.
// ============================================================================

function parseBlocks(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Fenced code block
    if (FENCE_RE.test(line)) {
      const lang = line.slice(3).trim()
      const start = ++i
      while (i < lines.length && !FENCE_RE.test(lines[i])) i++
      blocks.push({ type: 'code', lang, content: lines.slice(start, i).join('\n') })
      i++ // skip closing fence
      continue
    }
    // Horizontal rule
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }
    // Heading
    const h = HEADING_RE.exec(line)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, content: h[2] })
      i++
      continue
    }
    // Blank line — block separator
    if (!line.trim()) {
      i++
      continue
    }
    // Table — detect header row + separator row. Both must be present;
    // a single `|` line without a `|---|` follow-up is just a paragraph.
    if (TABLE_ROW_RE.test(line)
        && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const header = parseTableRow(line)
      i += 2  // skip header + separator
      const rows = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(parseTableRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }
    // Blockquote — gather consecutive `>` lines.
    if (QUOTE_RE.test(line)) {
      const quoteLines = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoteLines.push(QUOTE_RE.exec(lines[i])[1])
        i++
      }
      blocks.push({ type: 'quote', content: quoteLines.join('\n') })
      continue
    }
    // Bullet list (consecutive bullets)
    if (BULLET_RE.test(line)) {
      const items = []
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(BULLET_RE.exec(lines[i])[1])
        i++
        // Capture indented continuation lines into the same item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += '\n' + lines[i].trim()
          i++
        }
      }
      blocks.push({ type: 'ul', items })
      continue
    }
    // Ordered list
    if (ORDERED_RE.test(line)) {
      const items = []
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        items.push(ORDERED_RE.exec(lines[i])[2])
        i++
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += '\n' + lines[i].trim()
          i++
        }
      }
      blocks.push({ type: 'ol', items })
      continue
    }
    // Paragraph — gather until blank line or block-starting line
    const paraLines = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', content: paraLines.join('\n') })
  }
  return blocks
}

function isBlockStart(line) {
  return HEADING_RE.test(line) || BULLET_RE.test(line)
    || ORDERED_RE.test(line) || HR_RE.test(line) || FENCE_RE.test(line)
    || QUOTE_RE.test(line) || TABLE_ROW_RE.test(line)
}

// Split a `| cell | cell | cell |` row into its cells. Strips leading/trailing
// pipes and trims surrounding whitespace. Empty trailing cells are kept so
// header + body row counts can mismatch (we render whatever's there).
function parseTableRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

// ============================================================================
// Block renderer
// ============================================================================

function renderBlock(b, key) {
  switch (b.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, b.level + 2)}`  // # → h3, ## → h4, ### → h5
      return <Tag key={key} style={headingStyles[b.level - 1]}>{renderInline(b.content)}</Tag>
    }
    case 'hr':
      return <hr key={key} style={hrStyle} />
    case 'ul':
      return (
        <ul key={key} style={listStyle}>
          {b.items.map((item, i) => (
            <li key={i} style={liStyle}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol key={key} style={listStyle}>
          {b.items.map((item, i) => (
            <li key={i} style={liStyle}>{renderInline(item)}</li>
          ))}
        </ol>
      )
    case 'code':
      return (
        <pre key={key} style={preStyle}>
          <code>{b.content}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote key={key} style={quoteBlockStyle}>
          {renderInline(b.content)}
        </blockquote>
      )
    case 'table':
      return (
        <div key={key} style={tableScrollStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {b.header.map((cell, i) => (
                  <th key={i} style={thStyle}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri} style={ri % 2 === 0 ? trEvenStyle : trOddStyle}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={tdStyle}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'p':
    default:
      return <p key={key} style={paraStyle}>{renderInline(b.content)}</p>
  }
}

// ============================================================================
// Inline renderer — splits a string into [text, <strong>...], etc.
//
// We tokenize against a single regex of all inline-marker shapes, then walk
// the matches. Order in the regex matters for greediness:
//   1. fenced code   `code`
//   2. bold           **text**
//   3. italic         *text*  /  _text_
//   4. link           [text](url)
// ============================================================================

// IMPORTANT: do NOT cache a `g`-flag RegExp at module scope and call .exec()
// in a loop while recursively re-entering renderInline — `lastIndex` is
// shared mutable state and recursion corrupts the outer loop's position,
// causing re-matches / overlapping outputs / runaway DOM. We use
// String.prototype.matchAll which returns a per-call iterator (lastIndex
// is internal to the iterator, not shared globally). Pattern is created
// fresh in matchAll so any future regex caching has to be intentional.
const INLINE_PATTERN = String.raw`(\x60[^\x60]+\x60|\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\))`

function renderInline(text) {
  if (!text) return null
  // Soft-break: convert a single \n inside a paragraph into a <br/>.
  // Split on newlines first so each line is processed for inline markers,
  // then interleave <br/> elements.
  const lines = text.split('\n')
  const out = []
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) out.push(<br key={`br-${lineIdx}`} />)
    const matches = line.matchAll(new RegExp(INLINE_PATTERN, 'g'))
    let lastIdx = 0
    for (const match of matches) {
      if (match.index > lastIdx) {
        out.push(line.slice(lastIdx, match.index))
      }
      out.push(renderToken(match[0], `${lineIdx}-${match.index}`))
      lastIdx = match.index + match[0].length
    }
    if (lastIdx < line.length) out.push(line.slice(lastIdx))
  })
  return out
}

function renderToken(token, key) {
  if (token.startsWith('`') && token.endsWith('`')) {
    return <code key={key} style={inlineCodeStyle}>{token.slice(1, -1)}</code>
  }
  if (token.startsWith('**') && token.endsWith('**')) {
    return <strong key={key}>{renderInline(token.slice(2, -2))}</strong>
  }
  if (token.startsWith('*') && token.endsWith('*')) {
    return <em key={key}>{token.slice(1, -1)}</em>
  }
  if (token.startsWith('_') && token.endsWith('_')) {
    return <em key={key}>{token.slice(1, -1)}</em>
  }
  // Link: [text](url)
  const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
  if (linkMatch) {
    const [, label, url] = linkMatch
    const safeUrl = /^(https?:|mailto:|\/)/.test(url) ? url : '#'
    return (
      <a key={key} href={safeUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>
        {label}
      </a>
    )
  }
  return token
}

// ============================================================================
// Styles
// ============================================================================

const paraStyle = {
  margin: '0 0 0.6em',
  fontSize: 'inherit',
  lineHeight: 'inherit',
}

const listStyle = {
  margin: '0 0 0.6em',
  paddingLeft: 22,
  fontSize: 'inherit',
  lineHeight: 'inherit',
}

const liStyle = {
  marginBottom: 4,
}

const hrStyle = {
  margin: '12px 0',
  border: 'none',
  borderTop: '1px solid var(--border)',
}

const headingStyles = [
  // # — h3
  { margin: '14px 0 6px', fontFamily: 'var(--font-display)', fontSize: '1.18em', fontWeight: 600, lineHeight: 1.3, color: 'var(--text-strong)' },
  // ## — h4
  { margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: '1.08em', fontWeight: 600, lineHeight: 1.3, color: 'var(--text-strong)' },
  // ### — h5
  { margin: '10px 0 4px', fontSize: '0.92em', fontWeight: 700, lineHeight: 1.3, color: 'var(--text-strong)', letterSpacing: '0.02em' },
  // #### — h6
  { margin: '8px 0 4px', fontSize: '0.82em', fontWeight: 700, lineHeight: 1.3, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' },
]

const inlineCodeStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.9em',
  padding: '1px 5px',
  borderRadius: 3,
  background: 'var(--bg-hover)',
  color: 'var(--text-strong)',
}

const preStyle = {
  margin: '0 0 0.6em',
  padding: '10px 12px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85em',
  lineHeight: 1.5,
  overflow: 'auto',
  whiteSpace: 'pre',
}

const linkStyle = {
  color: 'var(--accent-strong)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
}

// M14.18.fix — blockquote styling.
const quoteBlockStyle = {
  margin: '0 0 0.8em',
  padding: '8px 14px',
  borderLeft: '3px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--text)',
  fontStyle: 'italic',
  fontSize: '0.97em',
  lineHeight: 1.55,
  borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
}

// M14.18.fix — table styling. Outer wrapper enables horizontal scroll on
// narrow viewports without breaking the page layout. Inner table uses
// border-collapse so the row dividers actually meet.
const tableScrollStyle = {
  margin: '0 0 1em',
  overflowX: 'auto',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-elevated)',
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.92em',
  lineHeight: 1.5,
}

const thStyle = {
  textAlign: 'left',
  padding: '10px 14px',
  fontWeight: 600,
  fontSize: '0.86em',
  letterSpacing: '0.02em',
  color: 'var(--text-strong)',
  background: 'var(--bg-subtle)',
  borderBottom: '2px solid var(--border-strong)',
  whiteSpace: 'nowrap',
}

const tdStyle = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text)',
  verticalAlign: 'top',
}

const trEvenStyle = {
  background: 'var(--bg-elevated)',
}

const trOddStyle = {
  background: 'var(--bg-subtle)',
}
