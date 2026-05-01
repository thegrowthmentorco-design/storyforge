/**
 * M13.1 — public landing page shown to signed-out visitors at `/`.
 *
 * Signed-in users still get the studio at `/` (auth-gated upstream in
 * App.jsx's top-level Routes). The hero currently uses a CSS gradient
 * placeholder; swap in `<video src="/hero.mp4" autoplay muted loop>`
 * (and keep the gradient as a poster-equivalent fallback) when the
 * recording lands. File would live at `frontend/public/hero.mp4`.
 *
 * Design references: Palantir's homepage hero pattern — full-bleed
 * background, single CTA, minimal nav, big serif headline. Keeps the
 * studio's design tokens (--accent, --space-*, --gradient-*, Fraunces
 * for display) so the brand reads consistently from landing → app.
 */
import { Link } from 'react-router-dom'
import { Sparkles, FileText, Plug, ArrowRight } from '../components/icons.jsx'

export default function Landing() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0c', color: '#f5f5f7' }}>
      <Hero />
      <HowItWorks />
      <FooterCTA />
    </div>
  )
}

function Hero() {
  return (
    <section
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Background — animated gradient placeholder. Replace this block
          with <video src="/hero.mp4" autoPlay muted loop playsInline
          style={absolute fill, objectFit cover}> when the clip lands. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at top left, rgba(99,102,241,0.30), transparent 55%),' +
            'radial-gradient(ellipse at bottom right, rgba(168,85,247,0.25), transparent 60%),' +
            'linear-gradient(180deg, #0a0a0c 0%, #11121a 100%)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, transparent 0%, transparent 60%, rgba(10,10,12,0.85) 100%)',
        }}
      />

      <Nav />

      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '120px 24px 80px',
          textAlign: 'center',
          maxWidth: 1100,
          margin: '0 auto',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            fontSize: 12,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#c7c8d6',
            marginBottom: 28,
          }}
        >
          <Sparkles size={13} /> Powered by Claude
        </span>

        <h1
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 'clamp(40px, 7vw, 80px)',
            lineHeight: 1.05,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: 0,
            maxWidth: 900,
          }}
        >
          Turn messy requirements into clear user stories.
        </h1>

        <p
          style={{
            fontSize: 'clamp(16px, 1.6vw, 19px)',
            lineHeight: 1.55,
            color: '#a8a9b8',
            maxWidth: 640,
            marginTop: 24,
          }}
        >
          Drop in a BRD, meeting transcript, or messy doc. StoryForge extracts
          actors, user stories, acceptance criteria, NFRs, and the gaps you'd
          otherwise miss — grounded in the source, ready to push to Jira.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 36, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link
            to="/sign-up"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 24px',
              borderRadius: 10,
              background: '#fff',
              color: '#0a0a0c',
              fontWeight: 600,
              fontSize: 15,
              textDecoration: 'none',
              boxShadow: '0 8px 24px rgba(255,255,255,0.10)',
            }}
          >
            Get started — it's free <ArrowRight size={16} />
          </Link>
          <Link
            to="/sign-in"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '14px 22px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              color: '#f5f5f7',
              fontWeight: 500,
              fontSize: 15,
              textDecoration: 'none',
              background: 'transparent',
            }}
          >
            Sign in
          </Link>
        </div>

        <p style={{ marginTop: 18, fontSize: 12.5, color: '#7e7f90' }}>
          Bring your own Anthropic API key. No credit card required.
        </p>
      </div>
    </section>
  )
}

function Nav() {
  return (
    <header
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 32px',
        zIndex: 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 17 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Sparkles size={15} />
        </span>
        <span style={{ fontFamily: 'Fraunces, Georgia, serif', letterSpacing: '-0.01em' }}>StoryForge</span>
      </div>
      <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link
          to="/sign-in"
          style={{
            color: '#c7c8d6',
            fontSize: 14,
            textDecoration: 'none',
            padding: '8px 14px',
            borderRadius: 8,
          }}
        >
          Sign in
        </Link>
        <Link
          to="/sign-up"
          style={{
            color: '#0a0a0c',
            background: '#fff',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
            padding: '9px 16px',
            borderRadius: 8,
          }}
        >
          Get started
        </Link>
      </nav>
    </header>
  )
}

function HowItWorks() {
  const steps = [
    {
      icon: <FileText size={22} />,
      title: 'Drop your doc',
      body: 'BRDs, meeting notes, transcripts, slide decks. PDF, Word, Markdown, plain text — multi-doc supported.',
    },
    {
      icon: <Sparkles size={22} />,
      title: 'Watch Claude extract',
      body: 'Streaming user stories, acceptance criteria, NFRs and gaps as the model reads. Every artifact links back to the source quote.',
    },
    {
      icon: <Plug size={22} />,
      title: 'Push to your tools',
      body: 'One-click push to Jira, Linear, GitHub Issues, Notion, or Slack. OAuth + API-token paths supported.',
    },
  ]
  return (
    <section style={{ padding: '120px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 64 }}>
        <p
          style={{
            fontSize: 12,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#7e7f90',
            margin: 0,
          }}
        >
          How it works
        </p>
        <h2
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontSize: 'clamp(32px, 4.5vw, 48px)',
            lineHeight: 1.1,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            marginTop: 14,
            marginBottom: 0,
          }}
        >
          From PDF to push, in minutes.
        </h2>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 24,
        }}
      >
        {steps.map((s) => (
          <div
            key={s.title}
            style={{
              padding: 28,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(99,102,241,0.30), rgba(168,85,247,0.20))',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
              }}
            >
              {s.icon}
            </span>
            <h3
              style={{
                fontFamily: 'Fraunces, Georgia, serif',
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                margin: 0,
                marginBottom: 10,
              }}
            >
              {s.title}
            </h3>
            <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#a8a9b8', margin: 0 }}>{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function FooterCTA() {
  return (
    <section
      style={{
        padding: '100px 24px 120px',
        textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <h2
        style={{
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 'clamp(28px, 4vw, 42px)',
          letterSpacing: '-0.02em',
          fontWeight: 600,
          margin: 0,
        }}
      >
        Stop rewriting requirements by hand.
      </h2>
      <p style={{ color: '#a8a9b8', fontSize: 16, marginTop: 14, marginBottom: 32 }}>
        Sign up free, paste a doc, see what Claude pulls out.
      </p>
      <Link
        to="/sign-up"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 26px',
          borderRadius: 10,
          background: '#fff',
          color: '#0a0a0c',
          fontWeight: 600,
          fontSize: 15,
          textDecoration: 'none',
        }}
      >
        Get started <ArrowRight size={16} />
      </Link>
      <div style={{ marginTop: 64, fontSize: 12.5, color: '#5e5f70' }}>
        © StoryForge · <Link to="/sign-in" style={{ color: '#7e7f90', textDecoration: 'none' }}>Sign in</Link>
      </div>
    </section>
  )
}
