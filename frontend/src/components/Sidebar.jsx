import React from 'react'
import { NavLink } from 'react-router-dom'
import { IconButton } from './primitives.jsx'
import {
  Logo,
  Search,
  Edit,
  FileText,
  Settings,
  User,
  ChevronDown,
} from './icons.jsx'

function NavItem({ icon, label, to, count }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {count != null && (
        <span style={{ fontSize: 11, color: 'var(--text-soft)', fontFamily: 'var(--font-mono)' }}>
          {count}
        </span>
      )}
    </NavLink>
  )
}

export default function Sidebar({ onNew }) {
  return (
    <aside
      style={{
        width: 248,
        background: 'var(--bg-subtle)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Brand row */}
      <div
        style={{
          padding: '14px 14px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Logo size={28} />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            fontWeight: 600,
            color: 'var(--text-strong)',
            flex: 1,
          }}
        >
          StoryForge
        </span>
        <IconButton label="Search · coming soon" size={28} disabled aria-disabled="true" style={{ cursor: 'not-allowed', opacity: 0.45 }}>
          <Search size={15} />
        </IconButton>
        <IconButton label="New extraction" size={28} onClick={onNew}>
          <Edit size={15} />
        </IconButton>
      </div>

      {/* Scrollable nav */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 6, paddingBottom: 12 }}>
        <NavItem icon={<FileText size={16} />} label="Documents" to="/documents" />
        <NavItem icon={<Settings size={16} />} label="Settings" to="/settings" />
      </div>

      {/* Footer: user pill */}
      <div
        style={{
          padding: '12px 14px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 0',
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 999,
              background: 'var(--accent-soft)',
              color: 'var(--accent-ink)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <User size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: 'var(--text-strong)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Bragadeesh
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-soft)' }}>Free Trial</div>
          </div>
          <ChevronDown size={14} />
        </div>
      </div>
    </aside>
  )
}
