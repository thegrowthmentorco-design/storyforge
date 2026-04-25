import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createCheckoutApi } from '../api.js'
import { useToast } from './Toast.jsx'
import { Badge, Button, Card, IconTile } from './primitives.jsx'
import { AlertTriangle, Sparkles, X, Zap } from './icons.jsx'

/**
 * Modal shown when an `/api/extract` (or `/rerun`) call returns a paywall
 * payload (M3.5). The payload structure comes from `services/limits.py` →
 * `_paywall()`:
 *
 *   {
 *     paywall: true,
 *     reason: 'trial_expired' | 'model_not_allowed' | 'doc_too_large' | 'monthly_limit',
 *     current_plan: 'trial' | 'starter' | ...,
 *     upgrade_to: 'starter' | 'pro' | 'team' | null,
 *     message: '<human-readable>',
 *     ...reason-specific extras
 *   }
 *
 * The CTA points users to /account where the Stripe checkout link will land
 * in M3.6. Until then, /account just shows their current plan.
 */

const REASON_META = {
  trial_expired: {
    title: 'Your trial has ended',
    icon: <AlertTriangle size={20} />,
    tone: 'warn',
  },
  model_not_allowed: {
    title: 'This model needs a paid plan',
    icon: <Sparkles size={20} />,
    tone: 'purple',
  },
  doc_too_large: {
    title: 'Document is too large for this plan',
    icon: <AlertTriangle size={20} />,
    tone: 'warn',
  },
  monthly_limit: {
    title: 'Monthly extraction limit reached',
    icon: <Zap size={20} />,
    tone: 'danger',
  },
}

export default function PaywallModal({ paywall, onClose }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!paywall) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paywall, onClose])

  if (!paywall) return null

  const meta = REASON_META[paywall.reason] || REASON_META.monthly_limit

  // M3.6: clicking Upgrade routes through Lemon Squeezy hosted checkout.
  // We mint the URL via /api/me/checkout (which carries our user_id in
  // custom_data so the webhook can map sub→user) then full-page navigate
  // — no popup, no iframe, no CSP gymnastics. The /account?checkout=success
  // redirect comes back into the SPA after payment.
  const handleUpgrade = async () => {
    if (!paywall.upgrade_to || busy) return
    setBusy(true)
    try {
      const { url } = await createCheckoutApi({ tier: paywall.upgrade_to, interval: 'monthly' })
      window.location.href = url
    } catch (e) {
      toast.error(e.message || 'Could not start checkout')
      setBusy(false)
    }
  }

  return (
    <>
      {/* Scrim — blocks the rest of the UI */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          zIndex: 100,
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(440px, calc(100vw - 32px))',
          zIndex: 101,
        }}
      >
        <Card padding={24} style={{ boxShadow: 'var(--shadow-lg)' }}>
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: 'transparent',
              border: 'none',
              padding: 6,
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>

          {/* Icon + title */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
            <IconTile tone={meta.tone} size={42}>{meta.icon}</IconTile>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2
                id="paywall-title"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 17,
                  fontWeight: 600,
                  color: 'var(--text-strong)',
                  margin: '0 0 4px',
                  lineHeight: 1.3,
                }}
              >
                {meta.title}
              </h2>
              <Badge tone="neutral" size="sm">
                Current plan: {(paywall.current_plan || 'trial').replace(/^./, c => c.toUpperCase())}
              </Badge>
            </div>
          </div>

          {/* Body */}
          <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6, margin: '0 0 18px' }}>
            {paywall.message}
          </p>

          {/* Per-reason extra context */}
          {paywall.reason === 'monthly_limit' && paywall.current_usage != null && (
            <div
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                marginBottom: 18,
                padding: '8px 10px',
                background: 'var(--bg-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Used {paywall.current_usage} of {paywall.limit} extractions this {paywall.period || 'month'}.
            </div>
          )}
          {paywall.reason === 'doc_too_large' && paywall.doc_pages_estimate != null && (
            <div
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                marginBottom: 18,
                padding: '8px 10px',
                background: 'var(--bg-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              Document ≈ {paywall.doc_pages_estimate} pages · plan caps at ≈ {paywall.max_pages_estimate} pages.
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Not now</Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { onClose(); navigate('/account') }}
              disabled={busy}
            >
              See all plans
            </Button>
            {paywall.upgrade_to && (
              <Button
                variant="primary"
                size="sm"
                icon={<Zap size={13} />}
                loading={busy}
                onClick={handleUpgrade}
              >
                {busy ? 'Loading…' : `Upgrade to ${paywall.upgrade_to.replace(/^./, c => c.toUpperCase())}`}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
