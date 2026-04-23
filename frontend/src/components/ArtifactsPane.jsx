import React from 'react'
import { Badge, Card, IconTile } from './primitives.jsx'
import {
  Sparkles,
  Users,
  FileText,
  Activity,
  Zap,
  Eye,
  Shield,
  Hash,
  Tag,
  Check,
  ChevronRight,
  User,
} from './icons.jsx'

function SectionHeader({ icon, tone, title, count, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <IconTile tone={tone} size={36}>
        {icon}
      </IconTile>
      <div style={{ flex: 1 }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            fontWeight: 600,
            color: 'var(--text-strong)',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {title}
        </h2>
        {count != null && (
          <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 2 }}>
            {count} {count === 1 ? 'item' : 'items'}
          </div>
        )}
      </div>
      {action}
    </div>
  )
}

function StoryCard({ story, idx }) {
  return (
    <Card
      hover
      padding={16}
      style={{
        animation: `fade-in .3s ease-out ${Math.min(idx * 60, 600)}ms both`,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Badge tone="accent" size="sm">
          {story.id}
        </Badge>
        <Badge tone="neutral" size="sm" icon={<User size={11} />}>
          {story.actor}
        </Badge>
        <div style={{ flex: 1 }} />
        {story.section && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-soft)',
            }}
          >
            {story.section}
          </span>
        )}
      </div>

      {/* Story body */}
      <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text)' }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>As a</span> {story.actor}{' '}
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>I want</span> {story.want}{' '}
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>so that</span> {story.so_that}
      </div>

      {/* Acceptance criteria */}
      {story.criteria?.length > 0 && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              color: 'var(--text-soft)',
              marginBottom: 8,
            }}
          >
            Acceptance criteria
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {story.criteria.map((c, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: 'var(--text)',
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: 'var(--success-soft)',
                    color: 'var(--success-ink)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  <Check size={11} />
                </span>
                <span>{c}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

/* Map common NFR categories to icon + tone */
function nfrIcon(category) {
  const c = (category || '').toLowerCase()
  if (c.includes('perf') || c.includes('latency') || c.includes('speed'))
    return { icon: <Zap size={14} />, tone: 'warn' }
  if (c.includes('avail') || c.includes('uptime') || c.includes('sla'))
    return { icon: <Activity size={14} />, tone: 'success' }
  if (c.includes('access') || c.includes('a11y') || c.includes('wcag'))
    return { icon: <Eye size={14} />, tone: 'info' }
  if (c.includes('pci') || c.includes('compli') || c.includes('secur') || c.includes('gdpr'))
    return { icon: <Shield size={14} />, tone: 'purple' }
  return { icon: <Hash size={14} />, tone: 'neutral' }
}

export default function ArtifactsPane({ extraction }) {
  return (
    <section
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '24px 28px 48px',
        minWidth: 0,
        background: 'var(--bg)',
      }}
    >
      {/* Tab pills (visual) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 24,
          flexWrap: 'wrap',
          padding: '4px',
          background: 'var(--bg-subtle)',
          borderRadius: 'var(--radius-pill)',
          width: 'fit-content',
        }}
      >
        {[
          ['Brief', null],
          ['Actors', extraction.actors.length],
          ['Stories', extraction.stories.length],
          ['NFRs', extraction.nfrs.length],
          ['Gaps', extraction.gaps.length],
        ].map(([label, count]) => (
          <span
            key={label}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-pill)',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              transition: 'background .12s, color .12s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-elevated)'
              e.currentTarget.style.color = 'var(--text-strong)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            {label}
            {count != null && (
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-soft)',
                }}
              >
                {count}
              </span>
            )}
          </span>
        ))}
      </div>

      {/* Brief */}
      <div style={{ marginBottom: 24 }} className="fade-in">
        <SectionHeader
          icon={<Sparkles size={16} />}
          tone="accent"
          title="Business summary"
        />
        <Card padding={20} style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.65,
              color: 'var(--accent-ink)',
              margin: 0,
              marginBottom: extraction.brief.tags.length ? 14 : 0,
            }}
          >
            {extraction.brief.summary}
          </p>
          {extraction.brief.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {extraction.brief.tags.map((t) => (
                <Badge key={t} tone="outline" icon={<Tag size={11} />}>
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Actors */}
      <div style={{ marginBottom: 24 }} className="fade-in">
        <SectionHeader
          icon={<Users size={16} />}
          tone="info"
          title="Actors"
          count={extraction.actors.length}
        />
        {extraction.actors.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {extraction.actors.map((a) => (
              <Card key={a} hover padding="10px 14px" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: 'var(--info-soft)',
                    color: 'var(--info-ink)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <User size={13} />
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-strong)', fontWeight: 500 }}>{a}</span>
              </Card>
            ))}
          </div>
        ) : (
          <EmptySection label="No actors extracted." />
        )}
      </div>

      {/* User stories */}
      <div style={{ marginBottom: 24 }} className="fade-in">
        <SectionHeader
          icon={<FileText size={16} />}
          tone="purple"
          title="User stories"
          count={extraction.stories.length}
        />
        {extraction.stories.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {extraction.stories.map((s, i) => (
              <StoryCard key={s.id} story={s} idx={i} />
            ))}
          </div>
        ) : (
          <EmptySection label="No user stories extracted." />
        )}
      </div>

      {/* NFRs as a proper table */}
      <div style={{ marginBottom: 24 }} className="fade-in">
        <SectionHeader
          icon={<Shield size={16} />}
          tone="success"
          title="Non-functional requirements"
          count={extraction.nfrs.length}
        />
        {extraction.nfrs.length ? (
          <Card padding={0} style={{ overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Category</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {extraction.nfrs.map((n, i) => {
                  const meta = nfrIcon(n.category)
                  return (
                    <tr key={i}>
                      <td>
                        <IconTile tone={meta.tone} size={28}>
                          {meta.icon}
                        </IconTile>
                      </td>
                      <td style={{ fontWeight: 500, color: 'var(--text-strong)' }}>{n.category}</td>
                      <td
                        style={{
                          color: 'var(--text)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12.5,
                        }}
                      >
                        {n.value}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <EmptySection label="No non-functional requirements extracted." />
        )}
      </div>
    </section>
  )
}

function EmptySection({ label }) {
  return (
    <div
      style={{
        padding: '20px',
        background: 'var(--bg-subtle)',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius)',
        fontSize: 12.5,
        color: 'var(--text-soft)',
        fontStyle: 'italic',
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  )
}
