/**
 * M14.18 — Document Explainer chat panel.
 *
 * A conversational workspace anchored to one extraction. Replaces the
 * old dossier-era ChatPanel (deleted in the cleanup commit). Slimmer:
 * no starter prompts, no source-quote integration, no glossary tooltip
 * coordination — just a focused "ask anything about this document" UX.
 *
 * Layout: collapsed → small floating button bottom-right. Open → tall
 * sheet anchored to the right edge with messages + input at the bottom.
 *
 * Backend: POST /api/extractions/{id}/chat streams a response. Service
 * stuffs the full raw_text + an explainer-shape digest as the system
 * prompt; conversations persist in chat_message table.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { clearChatApi, listChatMessagesApi, sendChatMessageStream } from '../../api.js'
import { useToast } from '../Toast.jsx'
import MarkdownText from '../MarkdownText.jsx'
import { MessageSquare, Send, X } from '../icons.jsx'

export default function ChatPanel({ extractionId }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const abortRef = useRef(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Load history when the panel opens.
  useEffect(() => {
    if (!open || !extractionId) return
    setLoadingHistory(true)
    listChatMessagesApi(extractionId)
      .then((rows) => setMessages(rows || []))
      .catch((e) => toast.error(e.message || 'Could not load chat history'))
      .finally(() => setLoadingHistory(false))
  }, [open, extractionId, toast])

  // Reset draft + messages when extraction changes.
  useEffect(() => {
    setMessages([])
    setStreamingText('')
    setDraft('')
  }, [extractionId])

  // Auto-scroll to bottom on new messages or streaming text.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingText, open])

  // Auto-focus input when opened.
  useEffect(() => {
    if (open && inputRef.current) {
      // Slight delay so the slide-in animation doesn't fight focus.
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  const send = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed || streaming || !extractionId) return
    setDraft('')
    setStreaming(true)
    setStreamingText('')

    // Optimistic user-message render.
    const optimisticUser = {
      id: `tmp-${Date.now()}`,
      role: 'user', content: trimmed,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticUser])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const assistantMsg = await sendChatMessageStream(extractionId, trimmed, {
        // SSE 'text' events carry {delta: string}; readSSE JSON-parses the
        // data field so we receive the object — pull out the delta.
        // (Earlier bug: appending the object stringified to "[object Object]".)
        onText: (ev) => setStreamingText((prev) => prev + (ev?.delta || '')),
        signal: controller.signal,
      })
      // Backend `complete` event carries the assistant message; the user
      // message was persisted server-side at request time. Keep the
      // optimistic user bubble + append the persisted assistant.
      setMessages((prev) => [...prev, assistantMsg])
      setStreamingText('')
    } catch (e) {
      if (e?.name !== 'AbortError') toast.error(e.message || 'Chat failed')
      // Drop the optimistic user message if we never got a reply.
      setMessages((prev) => prev.filter((m) => !String(m.id || '').startsWith('tmp-')))
      setStreamingText('')
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [draft, streaming, extractionId, toast])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const onClear = async () => {
    if (!confirm('Clear the chat thread for this document?')) return
    try {
      await clearChatApi(extractionId)
      setMessages([])
      toast.success('Chat cleared')
    } catch (e) {
      toast.error(e.message || 'Clear failed')
    }
  }

  if (!extractionId) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={triggerStyle}
        aria-label="Ask a question about this document"
      >
        <MessageSquare size={16} />
        Ask a question
      </button>
    )
  }

  return (
    <aside style={panelStyle} role="dialog" aria-label="Document chat">
      <header style={headerStyle}>
        <MessageSquare size={15} style={{ color: 'var(--accent-strong)' }} />
        <div style={{ flex: 1, fontWeight: 600, color: 'var(--text-strong)', fontSize: 14 }}>
          Ask a question
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={onClear} style={headerActionBtn} title="Clear thread">
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ ...headerActionBtn, padding: '4px 8px' }}
          aria-label="Close chat"
        >
          <X size={14} />
        </button>
      </header>

      <div ref={scrollRef} style={scrollStyle}>
        {loadingHistory && (
          <p style={mutedNote}>Loading…</p>
        )}
        {!loadingHistory && messages.length === 0 && !streamingText && (
          <p style={mutedNote}>
            Ask anything about this document — pull out specific numbers, draft a
            response email, run a "what if" scenario, or get a section explained
            in plain language.
          </p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {streaming && (
          <MessageBubble role="assistant" content={streamingText || '…'} isStreaming />
        )}
      </div>

      <footer style={footerStyle}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about this document…"
          rows={2}
          style={inputStyle}
          disabled={streaming}
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim() || streaming}
          style={{
            ...sendBtnStyle,
            opacity: !draft.trim() || streaming ? 0.5 : 1,
            cursor: !draft.trim() || streaming ? 'not-allowed' : 'pointer',
          }}
          aria-label="Send message"
        >
          <Send size={14} />
        </button>
      </footer>
    </aside>
  )
}

function MessageBubble({ role, content, isStreaming }) {
  const isUser = role === 'user'
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      maxWidth: '100%',
    }}>
      <div style={{
        maxWidth: '90%',
        padding: '8px 12px',
        borderRadius: 'var(--radius)',
        background: isUser ? 'var(--accent-strong)' : 'var(--bg-subtle)',
        color: isUser ? '#fff' : 'var(--text-strong)',
        fontSize: 13.5,
        lineHeight: 1.55,
        whiteSpace: isUser ? 'pre-wrap' : 'normal',
        wordWrap: 'break-word',
        border: isUser ? 'none' : '1px solid var(--border)',
      }}>
        {isUser ? content : <MarkdownText text={content} />}
        {isStreaming && (
          <span aria-hidden style={{
            display: 'inline-block', width: 8, height: 14,
            marginLeft: 2, background: 'var(--text-muted)',
            animation: 'blink 1s step-end infinite',
            verticalAlign: 'text-bottom',
          }} />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Styles
// ============================================================================

const triggerStyle = {
  position: 'fixed',
  bottom: 24, right: 24,
  zIndex: 30,
  display: 'inline-flex',
  alignItems: 'center', gap: 8,
  padding: '10px 16px',
  background: 'var(--accent-strong)',
  color: '#fff',
  border: 'none',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  boxShadow: '0 4px 16px -2px rgba(0, 0, 0, 0.18)',
}

const panelStyle = {
  position: 'fixed',
  bottom: 24, right: 24,
  width: 'min(420px, calc(100vw - 48px))',
  height: 'min(640px, calc(100vh - 48px))',
  zIndex: 30,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 12px 48px -8px rgba(0, 0, 0, 0.28)',
  overflow: 'hidden',
}

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 14px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
}

const headerActionBtn = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  padding: '4px 8px',
  borderRadius: 4,
  display: 'inline-flex',
  alignItems: 'center', gap: 4,
}

const scrollStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const mutedNote = {
  margin: 0,
  fontSize: 13,
  color: 'var(--text-muted)',
  lineHeight: 1.55,
  fontStyle: 'italic',
}

const footerStyle = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
  padding: '12px 14px',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
}

const inputStyle = {
  flex: 1,
  resize: 'none',
  padding: '8px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'var(--text-strong)',
  fontSize: 13,
  lineHeight: 1.5,
  fontFamily: 'inherit',
  outline: 'none',
}

const sendBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
  width: 38, height: 38,
  background: 'var(--accent-strong)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'inherit',
}
