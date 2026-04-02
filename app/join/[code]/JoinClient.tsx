'use client'

import { Calendar } from '@/lib/types'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { tierColor, hueForIndex } from '@/lib/colors'
import ThemeToggle from '@/components/ThemeToggle'

export default function JoinClient({ calendar }: { calendar: Calendar }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [previewHue, setPreviewHue] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkingStorage, setCheckingStorage] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(`flock_${calendar.code}`)
    if (stored) { router.replace(`/calendar/${calendar.code}`) }
    else { setCheckingStorage(false) }
  }, [calendar.code, router])

  useEffect(() => {
    if (!name.trim()) { setPreviewHue(null); return }
    async function fetchNextHue() {
      const { data } = await supabase.from('participants').select('id').eq('calendar_id', calendar.id)
      setPreviewHue(hueForIndex(data?.length ?? 0))
    }
    const t = setTimeout(fetchNextHue, 300)
    return () => clearTimeout(t)
  }, [name, calendar.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const trimmedName = name.trim()
    if (!trimmedName) return
    setLoading(true)
    try {
      const { data: existing } = await supabase.from('participants').select('*').eq('calendar_id', calendar.id).ilike('name', trimmedName).single()
      if (existing) {
        localStorage.setItem(`flock_${calendar.code}`, JSON.stringify({ participantId: existing.id, calendarId: calendar.id }))
        router.push(`/calendar/${calendar.code}`)
        return
      }
      const { data: allParticipants } = await supabase.from('participants').select('id').eq('calendar_id', calendar.id)
      const hue = hueForIndex(allParticipants?.length ?? 0)
      const { data: participant, error: err } = await supabase.from('participants').insert({ calendar_id: calendar.id, name: trimmedName, color_hue: hue }).select().single()
      if (err) throw err
      localStorage.setItem(`flock_${calendar.code}`, JSON.stringify({ participantId: participant.id, calendarId: calendar.id }))
      router.push(`/calendar/${calendar.code}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingStorage) return null

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
        <div className="w-full max-w-sm">
          <div className="rounded-3xl p-8" style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)' }}>
            {/* Header */}
            <div className="mb-7">
              <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>You&apos;re joining</p>
              <h1 className="text-2xl font-bold leading-tight" style={{ fontFamily: 'var(--font-jakarta)', color: 'var(--ink)' }}>
                {calendar.name}
              </h1>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>
                  What&apos;s your name?
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  autoFocus
                  required
                  className="w-full rounded-xl px-4 py-3 text-base focus:outline-none transition-colors"
                  style={{ border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                  onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                />
              </div>

              {/* Color preview */}
              {previewHue !== null && (
                <div
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{ background: 'var(--primary-light)', border: '1px solid var(--border)' }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm"
                    style={{ background: tierColor(previewHue, 3) }}
                  />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Your color</p>
                    <p className="text-xs" style={{ color: 'var(--ink-2)' }}>Unique to you on this calendar</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FFF0F0', color: '#C0392B' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="w-full py-3.5 rounded-xl font-semibold text-base text-white transition-all mt-1"
                style={{ background: loading || !name.trim() ? 'var(--ink-3)' : 'var(--primary)' }}
              >
                {loading ? 'Joining…' : "Let's go →"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  )
}
