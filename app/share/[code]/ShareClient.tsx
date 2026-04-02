'use client'

import { Calendar } from '@/lib/types'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { hueForIndex } from '@/lib/colors'
import ThemeToggle from '@/components/ThemeToggle'

export default function ShareClient({ calendar }: { calendar: Calendar }) {
  const router = useRouter()
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [shareUrl, setShareUrl] = useState(`https://flock-two.vercel.app/join/${calendar.code}`)

  useEffect(() => {
    setShareUrl(`${window.location.origin}/join/${calendar.code}`)
  }, [calendar.code])

  function copy(text: string, which: 'code' | 'url') {
    navigator.clipboard.writeText(text)
    if (which === 'code') { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000) }
    else { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000) }
  }

  useEffect(() => {
    const stored = localStorage.getItem(`flock_${calendar.code}`)
    if (stored) return
    async function registerHost() {
      const { data: existing } = await supabase.from('participants').select('*').eq('calendar_id', calendar.id).ilike('name', 'Host').single()
      if (existing) {
        localStorage.setItem(`flock_${calendar.code}`, JSON.stringify({ participantId: existing.id, calendarId: calendar.id }))
        if (!calendar.host_participant_id) await supabase.from('calendars').update({ host_participant_id: existing.id }).eq('id', calendar.id)
        return
      }
      const { data: countData } = await supabase.from('participants').select('id', { count: 'exact' }).eq('calendar_id', calendar.id)
      const hue = hueForIndex(countData?.length ?? 0)
      const { data: participant } = await supabase.from('participants').insert({ calendar_id: calendar.id, name: 'Host', color_hue: hue }).select().single()
      if (participant) {
        await supabase.from('calendars').update({ host_participant_id: participant.id }).eq('id', calendar.id)
        localStorage.setItem(`flock_${calendar.code}`, JSON.stringify({ participantId: participant.id, calendarId: calendar.id }))
      }
    }
    registerHost()
  }, [calendar])

  return (
    <main className="flex-1 flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>
      <nav className="flex items-center justify-between px-6 sm:px-10 py-5">
        <a href="/" className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4L6 8l4 4"/></svg>
          flock
        </a>
        <ThemeToggle />
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-md">
          {/* Success card */}
          <div className="rounded-3xl p-8 text-center" style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)' }}>
            {/* Icon */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5" style={{ background: 'var(--primary-light)' }}>
              <svg width="28" height="28" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7"/>
              </svg>
            </div>

            <p className="text-sm font-medium mb-1" style={{ color: 'var(--ink-2)' }}>Calendar created</p>
            <h1 className="text-2xl font-bold mb-7" style={{ fontFamily: 'var(--font-jakarta)', color: 'var(--ink)' }}>
              {calendar.name}
            </h1>

            {/* Code block */}
            <div
              className="rounded-2xl p-5 mb-4 flex items-center justify-between"
              style={{ background: 'var(--primary-light)', border: '1px solid var(--border)' }}
            >
              <div className="text-left">
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--primary)' }}>Share code</p>
                <p className="text-4xl font-mono font-black tracking-[0.15em]" style={{ color: 'var(--primary)' }}>
                  {calendar.code}
                </p>
              </div>
              <button
                onClick={() => copy(calendar.code, 'code')}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
                style={{ background: copiedCode ? 'var(--primary)' : 'white', color: copiedCode ? 'white' : 'var(--ink-2)' }}
              >
                {copiedCode
                  ? <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 12l5 5L20 6"/></svg>
                  : <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                }
              </button>
            </div>

            {/* URL row */}
            <div
              className="rounded-xl px-4 py-3 mb-6 flex items-center justify-between"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <span className="text-xs font-mono truncate" style={{ color: 'var(--ink-2)' }}>{shareUrl}</span>
              <button
                onClick={() => copy(shareUrl, 'url')}
                className="ml-2 flex-shrink-0 transition-colors"
                style={{ color: copiedUrl ? 'var(--primary)' : 'var(--ink-3)' }}
              >
                {copiedUrl
                  ? <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 9l4 4L16 5"/></svg>
                  : <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                }
              </button>
            </div>

            <button
              onClick={() => router.push(`/calendar/${calendar.code}`)}
              className="w-full py-3.5 rounded-xl font-semibold text-white transition-all"
              style={{ background: 'var(--primary)' }}
            >
              Open my calendar →
            </button>
          </div>

          <p className="text-center text-sm mt-4" style={{ color: 'var(--ink-3)' }}>
            Share the code or link with your group.
          </p>
        </div>
      </div>
    </main>
  )
}
