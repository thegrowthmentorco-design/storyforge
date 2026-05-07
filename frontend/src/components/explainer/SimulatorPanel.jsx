import React, { useState } from 'react'
import { simulateApi } from '../../api.js'
import MarkdownText from '../MarkdownText.jsx'
import { Calculator, ChevronRight, RefreshCw, Zap } from '../icons.jsx'

/**
 * What-if simulator. Driven by `simulator_schema` on the extraction's
 * lens_payload. The form posts values to the backend; Claude evaluates
 * against the source document and returns a structured result with
 * headline, breakdown, and caveats.
 */
export default function SimulatorPanel({ extractionId, schema }) {
  const fields = schema?.fields || []
  const examples = schema?.example_inputs || []

  const initial = {}
  fields.forEach((f) => { initial[f.key] = f.default_value || '' })

  const [values, setValues] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const update = (key, val) => setValues((v) => ({ ...v, [key]: val }))

  const fillExample = (i) => {
    const ex = examples[i]
    if (!ex) return
    setValues((v) => ({ ...v, ...ex }))
  }

  const submit = async () => {
    if (loading) return
    // Strip empty optional fields so the model doesn't see "" for unspecified.
    const payload = {}
    Object.entries(values).forEach(([k, v]) => {
      const f = fields.find((x) => x.key === k)
      if (v === '' && f && !f.required) return
      payload[k] = v
    })
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await simulateApi(extractionId, payload)
      setResult(res?.result || null)
    } catch (e) {
      setError(e?.message || 'Simulation failed')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setValues(initial)
    setResult(null)
    setError(null)
  }

  return (
    <div style={shell}>
      <header style={headerBlock}>
        <Calculator size={18} style={{ color: 'var(--accent)' }} />
        <div style={{ flex: 1 }}>
          <h3 style={titleStyle}>{schema?.title || 'What-if simulator'}</h3>
          {schema?.description && <p style={descStyle}>{schema.description}</p>}
        </div>
      </header>

      {examples.length > 0 && (
        <div style={examplesRow}>
          <span style={examplesLabel}>Try an example:</span>
          {examples.map((ex, i) => (
            <button
              key={i}
              type="button"
              style={exampleChip}
              onClick={() => fillExample(i)}
              title={JSON.stringify(ex)}
            >
              Example {i + 1}
              <ChevronRight size={12} />
            </button>
          ))}
        </div>
      )}

      <div style={form}>
        {fields.map((f) => (
          <FormField key={f.key} field={f} value={values[f.key] ?? ''} onChange={(v) => update(f.key, v)} />
        ))}
      </div>

      <div style={actionsRow}>
        <button type="button" style={primaryBtn} onClick={submit} disabled={loading}>
          {loading ? <><span style={spinner} /> Computing…</> : <><Zap size={14} /> Compute</>}
        </button>
        {(result || error) && (
          <button type="button" style={secondaryBtn} onClick={reset}>
            <RefreshCw size={13} /> Reset
          </button>
        )}
      </div>

      {error && <div style={errorBox}>{error}</div>}
      {result && <ResultCard result={result} />}
    </div>
  )
}

function FormField({ field, value, onChange }) {
  const labelEl = (
    <label htmlFor={field.key} style={fieldLabel}>
      {field.label}
      {field.required && <span style={requiredMark}>*</span>}
    </label>
  )
  const helpEl = field.help_text && <span style={helpText}>{field.help_text}</span>

  let control
  if (field.kind === 'select' && field.options?.length > 0) {
    control = (
      <select id={field.key} style={selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Select —</option>
        {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  } else if (field.kind === 'multiselect' && field.options?.length > 0) {
    const arr = value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []
    const toggle = (opt) => {
      const next = arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt]
      onChange(next.join(', '))
    }
    control = (
      <div style={multiselectShell}>
        {field.options.map((opt) => (
          <button
            key={opt}
            type="button"
            style={{ ...multiOption, ...(arr.includes(opt) ? multiOptionActive : {}) }}
            onClick={() => toggle(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    )
  } else if (field.kind === 'boolean') {
    control = (
      <label style={booleanRow}>
        <input
          type="checkbox"
          checked={value === 'true' || value === true}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <span style={{ fontSize: 13 }}>Yes</span>
      </label>
    )
  } else if (field.kind === 'number') {
    control = (
      <input
        id={field.key}
        type="number"
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else if (field.kind === 'date') {
    control = (
      <input
        id={field.key}
        type="date"
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else {
    control = (
      <input
        id={field.key}
        type="text"
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <div style={fieldShell}>
      {labelEl}
      {control}
      {helpEl}
    </div>
  )
}

function ResultCard({ result }) {
  if (!result) return null
  const isNa = !!result.not_applicable
  return (
    <div style={{ ...resultShell, borderColor: isNa ? 'var(--warn)' : 'var(--accent)' }}>
      <div style={{ ...resultEyebrow, color: isNa ? 'var(--warn)' : 'var(--accent)' }}>
        {isNa ? 'Outside the rules' : 'Result'}
      </div>
      <div style={headline}>{result.headline}</div>
      {result.summary && <div style={summary}><MarkdownText text={result.summary} /></div>}
      {result.breakdown?.length > 0 && (
        <ol style={breakdownList}>
          {result.breakdown.map((b, i) => (
            <li key={i} style={breakdownItem}>
              <div style={breakdownLabel}>{b.label}</div>
              <div style={breakdownValue}>{b.value}</div>
              {b.source_quote && (
                <div style={breakdownQuote}>“{b.source_quote}”</div>
              )}
            </li>
          ))}
        </ol>
      )}
      {result.caveats?.length > 0 && (
        <div style={caveatsBox}>
          <div style={caveatsLabel}>Caveats</div>
          <ul style={caveatsList}>
            {result.caveats.map((c, i) => <li key={i} style={caveatsItem}>{c}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// Styles
// =====================================================================

const shell = {
  marginTop: 16,
  padding: '24px 28px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}
const headerBlock = { display: 'flex', alignItems: 'flex-start', gap: 12 }
const titleStyle = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text-strong)',
  lineHeight: 1.3,
}
const descStyle = { margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }
const examplesRow = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  paddingBottom: 12,
  borderBottom: '1px dashed var(--border)',
}
const examplesLabel = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}
const exampleChip = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  fontSize: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--radius-pill)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const form = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
}
const fieldShell = { display: 'flex', flexDirection: 'column', gap: 4 }
const fieldLabel = { fontSize: 12, fontWeight: 600, color: 'var(--text)' }
const requiredMark = { color: 'var(--warn)', marginLeft: 3 }
const helpText = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }
const inputStyle = {
  padding: '8px 10px',
  fontSize: 13.5,
  fontFamily: 'inherit',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text)',
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const multiselectShell = { display: 'flex', flexWrap: 'wrap', gap: 4 }
const multiOption = {
  padding: '4px 10px',
  fontSize: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-muted)',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const multiOptionActive = {
  background: 'var(--accent-soft)',
  borderColor: 'var(--accent)',
  color: 'var(--accent-ink)',
}
const booleanRow = { display: 'inline-flex', alignItems: 'center', gap: 6 }
const actionsRow = { display: 'flex', gap: 8 }
const primaryBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const secondaryBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  fontSize: 13,
  color: 'var(--text-muted)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const spinner = {
  display: 'inline-block',
  width: 11, height: 11,
  border: '1.5px solid rgba(255,255,255,0.4)',
  borderTopColor: '#fff',
  borderRadius: '50%',
  animation: 'spin 0.7s linear infinite',
}
const errorBox = {
  padding: 12,
  background: 'var(--warn-soft)',
  color: 'var(--warn-ink)',
  border: '1px solid var(--warn)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13.5,
}
const resultShell = {
  marginTop: 4,
  padding: '18px 20px',
  background: 'var(--bg-elevated)',
  border: '2px solid',
  borderRadius: 'var(--radius-lg)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}
const resultEyebrow = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
}
const headline = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(20px, 2.6vw, 26px)',
  fontWeight: 600,
  color: 'var(--text-strong)',
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
}
const summary = { fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }
const breakdownList = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  borderTop: '1px dashed var(--border)',
  paddingTop: 12,
}
const breakdownItem = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  paddingLeft: 14,
  borderLeft: '2px solid var(--accent)',
}
const breakdownLabel = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }
const breakdownValue = {
  fontFamily: 'var(--font-mono)',
  fontSize: 14,
  color: 'var(--text-strong)',
  fontWeight: 500,
}
const breakdownQuote = {
  marginTop: 4,
  fontSize: 12,
  fontStyle: 'italic',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
}
const caveatsBox = {
  padding: 12,
  background: 'var(--bg-subtle)',
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius-md)',
}
const caveatsLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
}
const caveatsList = { margin: 0, paddingLeft: 18 }
const caveatsItem = { fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }
