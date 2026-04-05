'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKENDS = [0, 6]

export default function CreatePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [isInfinite, setIsInfinite] = useState(false)
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('23:00')
  const [selectedDays, setSelectedDays] = useState<number[]>(ALL_DAYS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function toggleDay(day: number) {
    setSelectedDays(prev => {
      if (prev.includes(day)) {
        const next = prev.filter(d => d !== day)
        return next.length === 0 ? prev : next // keep at least 1
      }
      return [...prev, day].sort()
    })
  }

  function setPreset(days: number[]) {
    setSelectedDays(days)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name || !startDate) return
    if (!isInfinite && !endDate) return
    if (!isInfinite && endDate < startDate) { setError('End date must be after start date.'); return }
    setLoading(true)
    try {
      let code = generateCode()
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: collision } = await supabase.from('calendars').select('code').eq('code', code).maybeSingle()
        if (!collision) break
        code = generateCode()
      }
      const effectiveEnd = isInfinite ? startDate : endDate
      const expiresAt = new Date(effectiveEnd)
      expiresAt.setFullYear(expiresAt.getFullYear() + (isInfinite ? 10 : 0))
      expiresAt.setDate(expiresAt.getDate() + (isInfinite ? 0 : 30))
      const daysToStore = selectedDays.length === 7 ? null : selectedDays
      const { data: cal, error: calErr } = await supabase
        .from('calendars')
        .insert({
          code, name,
          start_date: startDate, end_date: effectiveEnd,
          day_start_time: startTime, day_end_time: endTime,
          expires_at: expiresAt.toISOString(),
          is_infinite: isInfinite,
          selected_days_of_week: daysToStore,
        })
        .select().single()
      if (calErr) throw calErr
      router.push(`/share/${cal.code}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2), m = i % 2 === 0 ? '00' : '30'
    const val = `${String(h).padStart(2, '0')}:${m}`
    const label = `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
    return { val, label }
  })

  const isAllDays = selectedDays.length === 7
  const isWeekdays = selectedDays.length === 5 && WEEKDAYS.every(d => selectedDays.includes(d))
  const isWeekends = selectedDays.length === 2 && WEEKENDS.every(d => selectedDays.includes(d))

  return (
    <main className="flex-1 flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>
      <nav className="flex items-center justify-between px-6 sm:px-10 py-5">
        <a href="/" className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10 4L6 8l4 4"/>
          </svg>
          Back to synkra
        </a>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: 'var(--font-jakarta)', color: 'var(--ink)' }}>
              New calendar
            </h1>
            <p style={{ color: 'var(--ink-2)' }}>Set a date range, then share the code.</p>
          </div>

          <Card style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="space-y-2">
                  <Label htmlFor="cal-name" style={{ color: 'var(--ink)' }}>Calendar name</Label>
                  <Input
                    id="cal-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Summer Trip Planning"
                    required
                    autoFocus
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                    className="focus-visible:ring-2"
                  />
                </div>

                <div className="space-y-3">
                  <div className={`grid gap-4 ${isInfinite ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    <div className="space-y-2">
                      <Label htmlFor="start-date" style={{ color: 'var(--ink)' }}>Start date</Label>
                      <Input
                        id="start-date"
                        type="date"
                        value={startDate}
                        min={today}
                        onChange={e => setStartDate(e.target.value)}
                        required
                        style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                      />
                    </div>
                    {!isInfinite && (
                      <div className="space-y-2">
                        <Label htmlFor="end-date" style={{ color: 'var(--ink)' }}>End date</Label>
                        <Input
                          id="end-date"
                          type="date"
                          value={endDate}
                          min={startDate || today}
                          onChange={e => setEndDate(e.target.value)}
                          required
                          style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                        />
                      </div>
                    )}
                  </div>
                  {/* Infinite toggle */}
                  <button
                    type="button"
                    onClick={() => setIsInfinite(v => !v)}
                    className="flex items-center gap-2.5 text-sm transition-colors"
                    style={{ color: isInfinite ? 'var(--primary)' : 'var(--ink-3)' }}
                  >
                    <div
                      className="relative flex-shrink-0 w-9 h-5 rounded-full transition-colors"
                      style={{ background: isInfinite ? 'var(--primary)' : 'var(--border)' }}
                    >
                      <div
                        className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                        style={{
                          background: 'white',
                          left: isInfinite ? 'calc(100% - 18px)' : '2px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }}
                      />
                    </div>
                    <span className="font-medium">No end date</span>
                    <span className="text-xs" style={{ color: 'var(--ink-3)' }}>— keep adding weeks as you go</span>
                  </button>
                </div>

                {/* Day selection */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label style={{ color: 'var(--ink)' }}>
                      Which days{' '}
                      <span className="font-normal text-xs" style={{ color: 'var(--ink-3)' }}>optional</span>
                    </Label>
                    <div className="flex items-center gap-1">
                      {[
                        { label: 'All', active: isAllDays, days: ALL_DAYS },
                        { label: 'Weekdays', active: isWeekdays, days: WEEKDAYS },
                        { label: 'Weekends', active: isWeekends, days: WEEKENDS },
                      ].map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setPreset(preset.days)}
                          className="text-xs px-2 py-1 rounded-lg font-medium transition-all"
                          style={{
                            background: preset.active ? 'var(--primary)' : 'var(--bg)',
                            color: preset.active ? 'white' : 'var(--ink-3)',
                            border: `1px solid ${preset.active ? 'var(--primary)' : 'var(--border)'}`,
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {DAY_LABELS.map((label, i) => {
                      const active = selectedDays.includes(i)
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleDay(i)}
                          className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                          style={{
                            background: active ? 'var(--primary)' : 'var(--bg)',
                            color: active ? 'white' : 'var(--ink-3)',
                            border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                          }}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label style={{ color: 'var(--ink)' }}>
                    Daily hours{' '}
                    <span className="font-normal text-xs" style={{ color: 'var(--ink-3)' }}>optional</span>
                  </Label>
                  <div className="flex items-center gap-3">
                    <Select value={startTime} onValueChange={v => v && setStartTime(v)}>
                      <SelectTrigger className="flex-1" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
                        {timeOptions.map(o => <SelectItem key={o.val} value={o.val}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--ink-3)' }}>to</span>
                    <Select value={endTime} onValueChange={v => v && setEndTime(v)}>
                      <SelectTrigger className="flex-1" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
                        {timeOptions.map(o => <SelectItem key={o.val} value={o.val}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--destructive)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full py-6 rounded-xl font-semibold text-base mt-1 gap-2"
                  style={{ background: loading ? 'var(--ink-3)' : 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  {loading ? 'Creating…' : 'Create Calendar'}
                  {!loading && (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8h10M9 4l4 4-4 4"/>
                    </svg>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
