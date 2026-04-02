'use client'

import { Calendar } from '@/lib/types'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { hueForIndex } from '@/lib/colors'

export default function ShareClient({ calendar }: { calendar: Calendar }) {
  const router = useRouter()
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/join/${calendar.code}`
    : `https://flock.app/join/${calendar.code}`

  function copy(text: string, which: 'code' | 'url') {
    navigator.clipboard.writeText(text)
    if (which === 'code') { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000) }
    else { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000) }
  }

  // On share page, register host as participant if not already done
  useEffect(() => {
    const stored = localStorage.getItem(`flock_${calendar.code}`)
    if (stored) return // already joined as host

    async function registerHost() {
      const hostName = 'Host'
      // Check if host participant exists
      const { data: existing } = await supabase
        .from('participants')
        .select('*')
        .eq('calendar_id', calendar.id)
        .ilike('name', hostName)
        .single()

      if (existing) {
        localStorage.setItem(`flock_${calendar.code}`, JSON.stringify({ participantId: existing.id, calendarId: calendar.id }))
        // Update host_participant_id if needed
        if (!calendar.host_participant_id) {
          await supabase.from('calendars').update({ host_participant_id: existing.id }).eq('id', calendar.id)
        }
        return
      }

      const { data: countData } = await supabase
        .from('participants')
        .select('id', { count: 'exact' })
        .eq('calendar_id', calendar.id)

      const index = (countData?.length ?? 0)
      const hue = hueForIndex(index)

      const { data: participant } = await supabase
        .from('participants')
        .insert({ calendar_id: calendar.id, name: hostName, color_hue: hue })
        .select()
        .single()

      if (participant) {
        await supabase.from('calendars').update({ host_participant_id: participant.id }).eq('id', calendar.id)
        localStorage.setItem(`flock_${calendar.code}`, JSON.stringify({ participantId: participant.id, calendarId: calendar.id }))
      }
    }

    registerHost()
  }, [calendar])

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <a href="/" className="flex items-center gap-2 mb-10 self-start sm:self-auto">
        <span className="text-xl font-bold text-indigo-600" style={{ fontFamily: 'var(--font-jakarta)' }}>← flock</span>
      </a>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-indigo-100 p-8 flex flex-col items-center text-center">
        {/* Check icon */}
        <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-4">
          <svg width="32" height="32" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 16l5 5 11-11"/>
          </svg>
        </div>

        <p className="text-sm font-medium text-[#5b5780] mb-1">Calendar created</p>
        <h1 className="text-2xl font-bold text-[#1a1635] mb-6" style={{ fontFamily: 'var(--font-jakarta)' }}>
          {calendar.name}
        </h1>

        {/* Code */}
        <p className="text-xs font-medium text-[#5b5780] uppercase tracking-wider mb-2">Share code</p>
        <div className="w-full flex items-center justify-between bg-indigo-50 rounded-xl px-5 py-4 mb-3">
          <span className="text-3xl font-mono font-bold tracking-[0.2em] text-indigo-600">{calendar.code}</span>
          <button
            onClick={() => copy(calendar.code, 'code')}
            className="text-indigo-400 hover:text-indigo-600 transition-colors ml-3"
          >
            {copiedCode ? (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12l5 5L20 7"/></svg>
            ) : (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            )}
          </button>
        </div>

        {/* URL */}
        <p className="text-xs font-medium text-[#5b5780] uppercase tracking-wider mb-2">Or share link</p>
        <div className="w-full flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 mb-6">
          <span className="text-sm text-gray-500 font-mono truncate">{shareUrl}</span>
          <button
            onClick={() => copy(shareUrl, 'url')}
            className="text-gray-400 hover:text-indigo-600 transition-colors ml-2 flex-shrink-0"
          >
            {copiedUrl ? (
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12l5 5L20 7"/></svg>
            ) : (
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            )}
          </button>
        </div>

        <button
          onClick={() => router.push(`/calendar/${calendar.code}`)}
          className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          Open My Calendar →
        </button>
      </div>
    </main>
  )
}
