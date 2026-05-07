/**
 * M14.16.a — Tiny Markdown renderer for chat + dossier prose blocks.
 *
 * Supports the subset Claude actually uses in dossier/chat replies:
 *   # / ## / ### / #### headings
 *   - or * bullets (one level; nested lists fall back to indented bullets)
 *   1. ordered lists
 *   **bold**, *italic* / _italic_
 *   `inline code` and ```fenced``` code blocks
 *   [link text](url)
 *   --- horizontal rule
 *   blank line = paragraph break, single newline = soft break
 *
 * Out of scope (rare in Claude output, not worth the bytes): tables,
 * footnotes, task lists, blockquotes (we add them if Claude starts using
 * them). React-markdown would be the obvious dep but adds ~30 KB gzipped.
 */
import React from 'react'

const HEADING_RE = /^(#{1,4})\s+(.*)$/
const BULLET_RE = /^[-*]\s+(.*)$/
const ORDERED_RE = /^(\d+)\.\s+(.*)$/
const HR_RE = /^---+\s*$/
const FENCE_RE = /^```/

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
