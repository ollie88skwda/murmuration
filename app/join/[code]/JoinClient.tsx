'use client'

import { Calendar } from '@/lib/types'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { tierColor, hueForIndex } from '@/lib/colors'

export default function JoinClient({ calendar }: { calendar: Calendar }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [previewHue, setPreviewHue] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkingStorage, setCheckingStorage] = useState(true)

  // Auto-resume if already joined this calendar
  useEffect(() => {
    const stored = localStorage.getItem(`flock_${calendar.code}`)
    if (stored) {
      router.replace(`/calendar/${calendar.code}`)
    } else {
      setCheckingStorage(false)
    }
  }, [calendar.code, router])

  // Preview color as user types
  useEffect(() => {
    if (!name.trim()) { setPreviewHue(null); return }
    async function fetchNextHue() {
      const { data } = await supabase
        .from('participants')
        .select('id')
        .eq('calendar_id', calendar.id)
      setPreviewHue(hueForIndex(data?.length ?? 0))
    }
    fetchNextHue()
  }, [name, calendar.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const trimmedName = name.trim()
    if (!trimmedName) return

    setLoading(true)
    try {
      // Check if participant with this name already exists (case-insensitive)
      const { data: existing } = await supabase
        .from('participants')
        .select('*')
        .eq('calendar_id', calendar.id)
        .ilike('name', trimmedName)
        .single()

      if (existing) {
        // Resume existing session
        localStorage.setItem(`flock_${calendar.code}`, JSON.stringify({ participantId: existing.id, calendarId: calendar.id }))
        router.push(`/calendar/${calendar.code}`)
        return
      }

      // Create new participant
      const { data: allParticipants } = await supabase
        .from('participants')
        .select('id')
        .eq('calendar_id', calendar.id)

      const hue = hueForIndex(allParticipants?.length ?? 0)

      const { data: participant, error: err } = await supabase
        .from('participants')
        .insert({ calendar_id: calendar.id, name: trimmedName, color_hue: hue })
        .select()
        .single()

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
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <a href="/" className="flex items-center gap-2 mb-10 self-start sm:self-auto">
        <span className="text-xl font-bold text-indigo-600" style={{ fontFamily: 'var(--font-jakarta)' }}>← flock</span>
      </a>

      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-indigo-100 p-8 flex flex-col items-center text-center">
        <p className="text-sm text-[#5b5780] mb-1">You&apos;re joining</p>
        <h1 className="text-2xl font-bold text-[#1a1635] mb-6" style={{ fontFamily: 'var(--font-jakarta)' }}>
          {calendar.name}
        </h1>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1a1635] mb-2 text-left">
              What&apos;s your name?
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-400 text-[#1a1635]"
            />
          </div>

          {/* Color preview */}
          {previewHue !== null && (
            <div className="flex items-center gap-3 bg-indigo-50 rounded-xl px-4 py-3">
              <div
                className="w-8 h-8 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm"
                style={{ backgroundColor: tierColor(previewHue, 3) }}
              />
              <span className="text-sm text-[#5b5780]">Your color — you&apos;ll be assigned this unique color.</span>
            </div>
          )}

          {error && <p className="text-red-500 text-sm text-left">{error}</p>}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-200 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading ? 'Joining…' : "Let's go →"}
          </button>
        </form>
      </div>
    </main>
  )
}
