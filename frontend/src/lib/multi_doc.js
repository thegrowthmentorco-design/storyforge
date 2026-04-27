/* M7.5.c — pull per-doc names from a multi-doc raw_text.
 *
 * Backend stitches multi-doc inputs as:
 *   ===== DOC 1: spec.pdf =====
 *   <text>
 *
 *   ===== DOC 2: notes.docx =====
 *   <text>
 *
 * `parseDocNames(raw_text)` returns an array indexed by 1-based doc number
 * (so result[0] is "" — sentinel for `source_doc=0` = unknown / synthesized).
 * Single-doc inputs return [""] (no markers found).
 */

export function parseDocNames(rawText) {
  const out = ['']  // index 0 reserved for "synthesized / single-doc"
  if (!rawText) return out
  const re = /^=====\s*DOC\s+(\d+):\s*(.+?)\s*=====$/gm
  let m
  while ((m = re.exec(rawText)) !== null) {
    const idx = parseInt(m[1], 10)
    while (out.length <= idx) out.push('')
    out[idx] = m[2]
  }
  return out
}

/* Resolve a source_doc int to its display name (or empty string when not
 * applicable). 0 → "" (single-doc / synthesized — no badge needed). */
export function docNameFor(docNames, sourceDoc) {
  if (!sourceDoc || sourceDoc <= 0) return ''
  return docNames[sourceDoc] || `Doc ${sourceDoc}`
}

/* M8.5 — split raw_text into doc-aware paragraphs.
 *
 * Returns `{ docs, paragraphs }` where:
 *   docs       = [{ idx, name }]  one entry per "===== DOC N: …" marker
 *                (empty for single-doc input)
 *   paragraphs = [{ docIdx, text }]  marker lines are stripped, every
 *                surviving paragraph carries the docIdx of the marker
 *                that preceded it (0 = before any marker / single-doc)
 *
 * Single-doc inputs return `docs: []` and paragraphs all with `docIdx: 0`,
 * so callers branch on `docs.length > 1` to decide whether to render the
 * tab strip. */
const _MARKER_RE = /^=====\s*DOC\s+(\d+):\s*(.+?)\s*=====$/

export function splitParagraphsByDoc(rawText) {
  const docs = []
  const paragraphs = []
  let currentIdx = 0
  for (const p of (rawText || '').split(/\n{2,}/)) {
    const trimmed = p.trim()
    if (!trimmed) continue
    const m = trimmed.match(_MARKER_RE)
    if (m) {
      currentIdx = parseInt(m[1], 10)
      docs.push({ idx: currentIdx, name: m[2] })
      continue
    }
    paragraphs.push({ docIdx: currentIdx, text: trimmed })
  }
  return { docs, paragraphs }
}
