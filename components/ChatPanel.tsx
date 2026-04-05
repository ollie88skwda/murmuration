'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Message, Participant } from '@/lib/types'
import { tierColor } from '@/lib/colors'

interface Props {
  calendarId: string
  participantId: string | null
  participants: Participant[]
  onClose: () => void
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPanel({ calendarId, participantId, participants, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch initial messages
  useEffect(() => {
    let cancelled = false
    async function fetchMessages() {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('calendar_id', calendarId)
        .order('created_at', { ascending: true })
        .limit(50)
      if (!cancelled && data) {
        setMessages(data as Message[])
      }
      if (!cancelled) setLoading(false)
    }
    fetchMessages()
    return () => { cancelled = true }
  }, [calendarId])

  // Realtime subscription
  useEffect(() => {
    const s = Math.random().toString(36).slice(2, 7)
    const channel = supabase
      .channel(`messages:${calendarId}:${s}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `calendar_id=eq.${calendarId}` },
        (payload) => {
          const incoming = payload.new as Message
          setMessages(prev =>
            prev.some(m => m.id === incoming.id) ? prev : [...prev, incoming]
          )
        }
      )
      .subscribe((status, err) => {
        if (err) console.error('[realtime] messages error', err)
      })
    return () => { supabase.removeChannel(channel) }
  }, [calendarId])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const content = input.trim()
    if (!content || !participantId || sending) return
    setSending(true)
    setInput('')
    const optimisticId = `temp_${Date.now()}`
    const optimistic: Message = {
      id: optimisticId,
      calendar_id: calendarId,
      participant_id: participantId,
      content,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])
    const { data } = await supabase
      .from('messages')
      .insert({ calendar_id: calendarId, participant_id: participantId, content })
      .select()
      .single()
    if (data) {
      setMessages(prev => prev.map(m => m.id === optimisticId ? data as Message : m))
    }
    setSending(false)
    inputRef.current?.focus()
  }, [input, participantId, calendarId, sending])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const getParticipant = (id: string) => participants.find(p => p.id === id)

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-card)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)', paddingTop: '14px' }}
      >
        <div className="flex items-center gap-2">
          {/* Speech bubble icon */}
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-2)' }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Chat</span>
        </div>
        <button
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center rounded-full transition-colors"
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          style={{ color: 'var(--ink-2)' }}
          aria-label="Close chat"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M2 2l10 10M12 2L2 12"/>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3 grid-scroll">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>Loading…</span>
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--ink-3)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-xs text-center" style={{ color: 'var(--ink-3)' }}>No messages yet.<br/>Say hello!</p>
          </div>
        )}
        {messages.map((msg) => {
          const sender = getParticipant(msg.participant_id)
          const isOwn = msg.participant_id === participantId
          const dotColor = sender ? tierColor(sender.color_hue, 2) : '#aaa'
          return (
            <div
              key={msg.id}
              className="flex flex-col gap-0.5"
              style={{ alignItems: isOwn ? 'flex-end' : 'flex-start' }}
            >
              {/* Name + time */}
              <div
                className="flex items-center gap-1.5 px-1"
                style={{ flexDirection: isOwn ? 'row-reverse' : 'row' }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: dotColor }}
                />
                <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-2)' }}>
                  {sender?.name ?? 'Unknown'}{isOwn ? ' (you)' : ''}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                  {formatTimestamp(msg.created_at)}
                </span>
              </div>
              {/* Bubble */}
              <div
                className="px-3 py-2 rounded-2xl text-sm max-w-[220px] break-words leading-snug"
                style={
                  isOwn
                    ? { background: 'var(--primary)', color: 'var(--primary-foreground)', borderBottomRightRadius: 6 }
                    : { background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)', borderBottomLeftRadius: 6 }
                }
              >
                {msg.content}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 p-3 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        {!participantId ? (
          <p className="text-xs text-center py-1" style={{ color: 'var(--ink-3)' }}>
            Join the calendar to send messages.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message…"
              maxLength={500}
              disabled={sending}
              className="flex-1 px-3 py-2 text-sm rounded-xl focus:outline-none"
              style={{
                background: 'var(--bg)',
                border: '1.5px solid var(--border)',
                color: 'var(--ink)',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-xl transition-all"
              style={{
                background: input.trim() && !sending ? 'var(--primary)' : 'var(--border)',
                color: input.trim() && !sending ? '#fff' : 'var(--ink-3)',
              }}
              aria-label="Send message"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
