'use client'

import { Calendar, Participant } from '@/lib/types'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { tierColor, hueForIndex } from '@/lib/colors'
import { saveToHistory } from '@/lib/history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export default function JoinClient({ calendar }: { calendar: Calendar }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [previewHue, setPreviewHue] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkingStorage, setCheckingStorage] = useState(true)
  const [existingParticipants, setExistingParticipants] = useState<Participant[]>([])
  const [claimingId, setClaimingId] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(`synkra_${calendar.code}`)
    if (stored) {
      saveToHistory(calendar.code, calendar.name)
      router.replace(`/calendar/${calendar.code}`)
    } else { setCheckingStorage(false) }
  }, [calendar.code, calendar.name, router])

  useEffect(() => {
    if (checkingStorage) return
    async function fetchParticipants() {
      const { data } = await supabase
        .from('participants')
        .select('*')
        .eq('calendar_id', calendar.id)
        .order('created_at', { ascending: true })
      if (data) setExistingParticipants(data)
    }
    fetchParticipants()
  }, [checkingStorage, calendar.id])

  async function handleClaim(participant: Participant) {
    setClaimingId(participant.id)
    localStorage.setItem(`synkra_${calendar.code}`, JSON.stringify({ participantId: participant.id, calendarId: calendar.id }))
    saveToHistory(calendar.code, calendar.name)
    router.push(`/calendar/${calendar.code}`)
  }

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
      const { data: existing } = await supabase.from('participants').select('*').eq('calendar_id', calendar.id).eq('name', trimmedName).maybeSingle()
      if (existing) {
        localStorage.setItem(`synkra_${calendar.code}`, JSON.stringify({ participantId: existing.id, calendarId: calendar.id }))
        saveToHistory(calendar.code, calendar.name)
        router.push(`/calendar/${calendar.code}`)
        return
      }
      const { data: allParticipants } = await supabase.from('participants').select('id').eq('calendar_id', calendar.id)
      const hue = hueForIndex(allParticipants?.length ?? 0)
      const { data: participant, error: err } = await supabase.from('participants').insert({ calendar_id: calendar.id, name: trimmedName, color_hue: hue }).select().single()
      if (err) throw err
      localStorage.setItem(`synkra_${calendar.code}`, JSON.stringify({ participantId: participant.id, calendarId: calendar.id }))
      saveToHistory(calendar.code, calendar.name)
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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10 4L6 8l4 4"/>
          </svg>
          synkra
        </a>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          <Card className="rounded-3xl" style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)' }}>
            <CardContent className="p-8">
              {/* Header */}
              <div className="mb-7">
                <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>You&apos;re joining</p>
                <h1 className="text-2xl font-bold leading-tight" style={{ fontFamily: 'var(--font-jakarta)', color: 'var(--ink)' }}>
                  {calendar.name}
                </h1>
              </div>

              {/* Existing participants */}
              {existingParticipants.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm font-medium mb-3" style={{ color: 'var(--ink-2)' }}>Are you one of these?</p>
                  <div className="flex flex-wrap gap-2">
                    {existingParticipants.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={claimingId !== null}
                        onClick={() => handleClaim(p)}
                        className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          color: 'var(--ink)',
                          opacity: claimingId !== null && claimingId !== p.id ? 0.45 : 1,
                          cursor: claimingId !== null ? 'default' : 'pointer',
                        }}
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ background: tierColor(p.color_hue, 3) }}
                        />
                        {claimingId === p.id ? 'Joining…' : p.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-6 mb-1">
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--ink-3)' }}>or join as someone new</span>
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="space-y-2">
                  <Label htmlFor="participant-name" style={{ color: 'var(--ink)' }}>What&apos;s your name?</Label>
                  <Input
                    id="participant-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name"
                    autoFocus
                    required
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  />
                </div>

                {/* Color preview */}
                {previewHue !== null && (
                  <div
                    className="flex items-center gap-3 rounded-xl px-4 py-3"
                    style={{ background: 'var(--primary-light)', border: '1px solid var(--border)' }}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex-shrink-0 shadow-sm"
                      style={{ background: tierColor(previewHue, 3), outline: '2px solid var(--bg-card)', outlineOffset: 1 }}
                    />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Your color</p>
                      <p className="text-xs" style={{ color: 'var(--ink-2)' }}>Unique to you on this calendar</p>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--destructive)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="w-full py-6 rounded-xl font-semibold text-base mt-1"
                  style={{
                    background: loading || !name.trim() ? 'var(--ink-3)' : 'var(--primary)',
                    color: 'var(--primary-foreground)'
                  }}
                >
                  {loading ? 'Joining…' : "Let's go →"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
