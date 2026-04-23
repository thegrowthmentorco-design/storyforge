import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, Sparkles, X } from './icons.jsx'

/**
 * Toast system (M1.7.1)
 *
 * Usage:
 *   const { toast } = useToast()
 *   toast.success('Saved')
 *   toast.error('Could not extract')
 *   toast.info('Switched to dark mode')
 *   toast.warn('Free tier almost full')
 *
 *   // with options
 *   const id = toast.info('Working…', { duration: Infinity })
 *   toast.dismiss(id)
 *
 *   // with action (used by M1.3.4 delete-with-undo)
 *   toast.success('Document deleted', {
 *     duration: 5000,
 *     action: { label: 'Undo', onClick: () => restore() },
 *   })
 */
const ToastCtx = createContext(null)

const TONE_META = {
  success: {
    icon: <CheckCircle size={16} />,
    accent: 'var(--success)',
    accentInk: 'var(--success-ink)',
  },
  error: {
    icon: <AlertCircle size={16} />,
    accent: 'var(--danger)',
    accentInk: 'var(--danger-ink)',
  },
  warn: {
    icon: <AlertTriangle size={16} />,
    accent: 'var(--warn)',
    accentInk: 'var(--warn-ink)',
  },
  info: {
    icon: <Sparkles size={16} />,
    accent: 'var(--info)',
    accentInk: 'var(--info-ink)',
  },
}

let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
    const handle = timers.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (tone, message, opts = {}) => {
      const id = nextId++
      const duration = opts.duration ?? 4000
      setToasts((ts) => [...ts, { id, tone, message, action: opts.action }])
      if (duration !== Infinity && duration > 0) {
        const handle = setTimeout(() => dismiss(id), duration)
        timers.current.set(id, handle)
      }
      return id
    },
    [dismiss],
  )

  // Cleanup timers on unmount
  useEffect(
    () => () => {
      for (const handle of timers.current.values()) clearTimeout(handle)
    },
    [],
  )

  // Stable API object — recreated when push/dismiss change (which is never, since both are useCallback'd)
  const api = {
    success: (msg, opts) => push('success', msg, opts),
    error: (msg, opts) => push('error', msg, opts),
    warn: (msg, opts) => push('warn', msg, opts),
    info: (msg, opts) => push('info', msg, opts),
    dismiss,
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'flex-end',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

function ToastItem({ toast: t, onDismiss }) {
  const meta = TONE_META[t.tone] || TONE_META.info
  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        minWidth: 280,
        maxWidth: 440,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        background: 'var(--bg-elevated)',
        color: 'var(--text-strong)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${meta.accent}`,
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-lg)',
        fontSize: 13,
        lineHeight: 1.45,
        animation: 'toast-in 0.2s ease-out',
      }}
    >
      <span style={{ color: meta.accent, flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
        {meta.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{t.message}</div>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            try {
              t.action.onClick()
            } finally {
              onDismiss()
            }
          }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '0 4px',
            color: meta.accentInk,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            fontFamily: 'inherit',
          }}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 2,
          color: 'var(--text-muted)',
          cursor: 'pointer',
          flexShrink: 0,
          display: 'inline-flex',
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return { toast: ctx }
}
