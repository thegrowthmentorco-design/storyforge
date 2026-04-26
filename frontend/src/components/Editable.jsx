import React, { useEffect, useRef, useState } from 'react'

/**
 * Editable primitives (M4.1).
 *
 * Three components, all share the same UX contract:
 *   - Click → switch to input/textarea/select (focus immediately).
 *   - Enter / blur → call `onSave(newValue)` (parent decides what to do
 *     with the change — typically PATCH the backend + update local state).
 *   - Escape → discard, restore the original value.
 *   - During save (`saving` prop true), disable + dim the field.
 *   - On the read-only display, hover surfaces a subtle dashed underline
 *     so editability is discoverable without screaming.
 *
 * Parent owns the persisted value; we only carry the in-progress edit
 * buffer locally. That keeps the component re-render cycle simple and
 * means a successful save automatically flows back through props.
 */

const placeholderStyle = {
  color: 'var(--text-soft)',
  fontStyle: 'italic',
}

function ReadView({ children, onClick, multiline, placeholder, value }) {
  const isEmpty = !value || (typeof value === 'string' && !value.trim())
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className="editable-read"
      style={{
        display: multiline ? 'block' : 'inline',
        cursor: 'text',
        borderRadius: 3,
        padding: '1px 3px',
        margin: '-1px -3px',
        ...(isEmpty ? placeholderStyle : null),
      }}
      title="Click to edit"
    >
      {isEmpty ? placeholder || 'Click to edit' : children}
    </span>
  )
}

/* Single-line text. Use for short fields: actor, story.want (yes, multi-word
 * but visually one line), NFR category/value, gap question, brief summary
 * (single line if short — use EditableTextarea for paragraphs). */
export function EditableText({
  value,
  onSave,
  saving = false,
  placeholder,
  inputStyle,
  displayStyle,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) {
      setDraft(value ?? '')
      // Focus + select-all on next tick so the user can immediately retype.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, value])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onSave?.(draft)
  }

  if (!editing) {
    return (
      <span style={displayStyle}>
        <ReadView
          value={value}
          placeholder={placeholder}
          onClick={() => !saving && setEditing(true)}
        >
          {value}
        </ReadView>
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(false)
        }
      }}
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px 6px',
        font: 'inherit',
        color: 'inherit',
        outline: 'none',
        opacity: saving ? 0.6 : 1,
        ...(inputStyle || {}),
      }}
    />
  )
}

/* Multi-line — paragraphs (story.want/so_that, brief.summary, gap.context).
 * Auto-grows to content. Cmd+Enter saves; plain Enter inserts newline. */
export function EditableTextarea({
  value,
  onSave,
  saving = false,
  placeholder,
  rows = 2,
  textareaStyle,
  displayStyle,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef(null)

  useEffect(() => {
    if (editing) {
      setDraft(value ?? '')
      requestAnimationFrame(() => {
        ref.current?.focus()
        ref.current?.select()
      })
    }
  }, [editing, value])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onSave?.(draft)
  }

  if (!editing) {
    return (
      <span style={displayStyle}>
        <ReadView
          value={value}
          placeholder={placeholder}
          multiline
          onClick={() => !saving && setEditing(true)}
        >
          {value}
        </ReadView>
      </span>
    )
  }

  return (
    <textarea
      ref={ref}
      value={draft}
      disabled={saving}
      rows={rows}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(false)
        }
      }}
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 8px',
        font: 'inherit',
        color: 'inherit',
        outline: 'none',
        width: '100%',
        resize: 'vertical',
        opacity: saving ? 0.6 : 1,
        ...(textareaStyle || {}),
      }}
    />
  )
}

/* Bounded picklist — gap.severity, future enum-like fields. */
export function EditableSelect({
  value,
  options,
  onSave,
  saving = false,
  selectStyle,
  displayStyle,
  renderDisplay,
}) {
  const ref = useRef(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (editing) requestAnimationFrame(() => ref.current?.focus())
  }, [editing])

  if (!editing) {
    return (
      <span style={displayStyle}>
        <ReadView
          value={value}
          onClick={() => !saving && setEditing(true)}
        >
          {renderDisplay ? renderDisplay(value) : value}
        </ReadView>
      </span>
    )
  }

  return (
    <select
      ref={ref}
      defaultValue={value}
      disabled={saving}
      onBlur={(e) => {
        setEditing(false)
        if (e.target.value !== value) onSave?.(e.target.value)
      }}
      onChange={(e) => {
        setEditing(false)
        if (e.target.value !== value) onSave?.(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(false)
      }}
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px 6px',
        font: 'inherit',
        color: 'inherit',
        outline: 'none',
        opacity: saving ? 0.6 : 1,
        ...(selectStyle || {}),
      }}
    >
      {options.map((opt) => (
        <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
          {typeof opt === 'string' ? opt : opt.label}
        </option>
      ))}
    </select>
  )
}

/* List of short strings (criteria, brief.tags, actors). Each item is its
 * own EditableText; trailing "+ Add" inserts a blank one (entering edit
 * mode immediately). Empty items get filtered on save so blank entries
 * disappear automatically.
 *
 * `onSave(newList)` is called with the cleaned-up list whenever an item
 * changes or is added/removed. */
export function EditableList({
  items = [],
  onSave,
  saving = false,
  placeholder = 'Item',
  itemStyle,
  addLabel = '+ Add',
  bulletRender,
}) {
  const [draftItems, setDraftItems] = useState(null)
  const list = draftItems ?? items

  const updateItem = (i, v) => {
    const next = [...list]
    next[i] = v
    const cleaned = next.map((s) => s).filter((s, idx) => s.trim() || idx === i)
    setDraftItems(null)
    onSave?.(cleaned.filter((s) => s.trim()))
  }

  const removeItem = (i) => {
    const next = list.filter((_, idx) => idx !== i)
    setDraftItems(null)
    onSave?.(next)
  }

  const addItem = () => {
    setDraftItems([...list, ''])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {list.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, ...itemStyle }}>
          {bulletRender ? bulletRender(i) : <span style={{ color: 'var(--text-soft)' }}>•</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditableText
              value={item}
              placeholder={placeholder}
              saving={saving}
              onSave={(v) => updateItem(i, v)}
            />
          </div>
          <button
            type="button"
            onClick={() => removeItem(i)}
            disabled={saving}
            aria-label="Remove item"
            title="Remove"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-soft)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: '0 4px',
              opacity: 0.6,
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        disabled={saving}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--accent-strong)',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          textAlign: 'left',
          padding: '2px 0',
          alignSelf: 'flex-start',
          fontFamily: 'inherit',
        }}
      >
        {addLabel}
      </button>
    </div>
  )
}
