import React, { useCallback, useRef } from 'react'

/* M8.2 — Vertical drag-handle between two flex children.
 *
 * Owns the drag math (clientX → ratio of containerRef's bounding rect),
 * emits `onChange(ratio)` on every move event. Parent owns the persisted
 * value + clamps via `min`/`max` props so the handle stays a dumb
 * coordinate-emitter and the persistence/recovery logic lives upstream.
 *
 * Visual: 4px-wide bar, transparent fill, col-resize cursor on hover, faint
 * accent line on grab. Hit area is widened to 8px via padding + negative
 * margin so the user doesn't have to pixel-hunt.
 *
 * Interaction: pointer events (works mouse + pen + touch). setPointerCapture
 * keeps the move events flowing even when the cursor leaves the handle's
 * box during a drag — without it, fast drags drop events as soon as the
 * cursor crosses out of the 4px stripe.
 */
export default function ResizeHandle({
  containerRef,
  onChange,
  min = 0.20,
  max = 0.70,
}) {
  const draggingRef = useRef(false)

  const handleMove = useCallback((e) => {
    if (!draggingRef.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width <= 0) return
    const raw = (e.clientX - rect.left) / rect.width
    const clamped = Math.max(min, Math.min(max, raw))
    onChange(clamped)
  }, [containerRef, onChange, min, max])

  const onPointerDown = (e) => {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    // Prevent text selection while dragging — feels broken otherwise.
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  const onPointerUp = (e) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* fine */ }
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={handleMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        flexShrink: 0,
        width: 4,
        cursor: 'col-resize',
        background: 'var(--border)',
        // Widen the hit area without changing visual width.
        padding: '0 2px',
        marginLeft: -2,
        marginRight: -2,
        transition: 'background .12s',
        touchAction: 'none',   // keeps mobile from interpreting as a scroll
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
      onMouseLeave={(e) => { if (!draggingRef.current) e.currentTarget.style.background = 'var(--border)' }}
    />
  )
}
