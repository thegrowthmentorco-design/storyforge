import React, { useState } from 'react'
import { regeneratePersonaStream } from '../../api.js'
import { useToast } from '../Toast.jsx'

const PERSONAS = [
  { key: 'default',    label: 'Default' },
  { key: 'eli5',       label: 'Explain like I’m 5' },
  { key: 'cfo',        label: 'For the CFO' },
  { key: 'new_joiner', label: 'For a new joiner' },
  { key: 'lawyer',     label: 'For a lawyer' },
  { key: 'engineer',   label: 'For an engineer' },
]

/**
 * Pill row that swaps the plain-English sections into a persona voice.
 * Caches each fetched persona in component state so toggling back to a
 * previously-fetched one is free.
 */
export default function PersonaSwitcher({ extractionId, defaultSections, onSectionsChange }) {
  const toast = useToast()
  const [active, setActive] = useState('default')
  const [loading, setLoading] = useState(null) // persona key being fetched
  const [cache, setCache] = useState({ default: defaultSections })

  const switchTo = async (key) => {
    if (loading) return
    if (key === active) return

    if (cache[key]) {
      setActive(key)
      onSectionsChange(cache[key], key)
      return
    }

    setLoading(key)
    try {
      const final = await regeneratePersonaStream(extractionId, key, {})
      const sections = final?.sections || []
      setCache((c) => ({ ...c, [key]: sections }))
      setActive(key)
      onSectionsChange(sections, key)
    } catch (e) {
      toast?.show?.(`Couldn't switch persona: ${e.message || e}`, { kind: 'error' })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div style={shell} role="tablist" aria-label="Audience persona">
      <span style={hint}>Audience</span>
      <div style={pills}>
        {PERSONAS.map((p) => {
          const isActive = active === p.key
          const isLoading = loading === p.key
          return (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={!!loading}
              onClick={() => switchTo(p.key)}
              style={{
                ...pill,
                ...(isActive ? pillActive : {}),
                ...(loading && !isActive ? pillDisabled : {}),
              }}
            >
              {isLoading && <span style={spinner} aria-hidden="true" />}
              {p.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const shell = {
  marginTop: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
}
const hint = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}
const pills = { display: 'flex', flexWrap: 'wrap', gap: 6 }
const pill = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 12px',
  fontSize: 12.5,
  fontWeight: 500,
  fontFamily: 'inherit',
  color: 'var(--text-muted)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  transition: 'background 0.12s, color 0.12s, border-color 0.12s',
}
const pillActive = {
  color: 'var(--accent-ink)',
  background: 'var(--accent-soft)',
  borderColor: 'var(--accent)',
  fontWeight: 600,
}
const pillDisabled = { opacity: 0.5, cursor: 'not-allowed' }
const spinner = {
  display: 'inline-block',
  width: 10, height: 10,
  border: '1.5px solid var(--border)',
  borderTopColor: 'var(--accent)',
  borderRadius: '50%',
  animation: 'spin 0.7s linear infinite',
}
