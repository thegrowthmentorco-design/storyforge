import React from 'react'
import { Badge, Card, IconTile } from './primitives.jsx'
import { AlertTriangle, AlertCircle, HelpCircle, CheckCircle } from './icons.jsx'

const SEVERITY_ORDER = { high: 0, med: 1, low: 2 }

const SEVERITY_META = {
  high: {
    tone: 'danger',
    badge: 'danger',
    icon: <AlertTriangle size={14} />,
    label: 'High',
  },
  med: {
    tone: 'warn',
    badge: 'warn',
    icon: <AlertCircle size={14} />,
    label: 'Medium',
  },
  low: {
    tone: 'info',
    badge: 'info',
    icon: <HelpCircle size={14} />,
    label: 'Low',
  },
}

export default function GapsRail({ gaps }) {
  const sorted = [...(gaps || [])].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  )

  return (
    <aside
      style={{
        width: 320,
        background: 'var(--bg-subtle)',
        borderLeft: '1px solid var(--border)',
        overflowY: 'auto',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 18px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconTile tone="warn" size={32}>
            <AlertTriangle size={15} />
          </IconTile>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text-strong)',
                lineHeight: 1.2,
              }}
            >
              Gaps & questions
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-soft)', marginTop: 2 }}>
              {sorted.length} {sorted.length === 1 ? 'item' : 'items'} for stakeholders
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '14px 14px 30px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {sorted.length === 0 && (
          <Card
            padding={20}
            style={{
              textAlign: 'center',
              background: 'var(--success-soft)',
              borderColor: 'transparent',
            }}
          >
            <IconTile tone="success" size={36} style={{ margin: '0 auto 10px' }}>
              <CheckCircle size={16} />
            </IconTile>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--success-ink)', marginBottom: 4 }}>
              No gaps detected
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--success-ink)', opacity: 0.8 }}>
              The source covered the bases.
            </div>
          </Card>
        )}

        {sorted.map((g, i) => {
          const meta = SEVERITY_META[g.severity] || SEVERITY_META.low
          return (
            <Card
              key={i}
              hover
              padding={14}
              style={{
                animation: `fade-in .3s ease-out ${Math.min(i * 60, 600)}ms both`,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Badge tone={meta.badge} icon={meta.icon} size="sm">
                  {meta.label}
                </Badge>
                <div style={{ flex: 1 }} />
                {g.section && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-soft)',
                    }}
                  >
                    {g.section}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: 'var(--text-strong)',
                  marginBottom: 6,
                  lineHeight: 1.4,
                }}
              >
                {g.question}
              </div>
              {g.context && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    lineHeight: 1.55,
                    marginBottom: 10,
                  }}
                >
                  {g.context}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 11.5,
                    color: 'var(--accent-strong)',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  Resolve
                </button>
                <span style={{ color: 'var(--text-soft)', fontSize: 11.5 }}>·</span>
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 11.5,
                    color: 'var(--accent-strong)',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  Ask stakeholder
                </button>
                <span style={{ color: 'var(--text-soft)', fontSize: 11.5 }}>·</span>
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 11.5,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  Ignore
                </button>
              </div>
            </Card>
          )
        })}
      </div>
    </aside>
  )
}
