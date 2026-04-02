'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ThemeToggle from '@/components/ThemeToggle'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export default function CreatePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('23:00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name || !startDate || !endDate) return
    if (endDate < startDate) { setError('End date must be after start date.'); return }
    setLoading(true)
    try {
      let code = generateCode()
      const { data: existing } = await supabase.from('calendars').select('code').eq('code', code).single()
      if (existing) code = generateCode()
      const expiresAt = new Date(endDate)
      expiresAt.setDate(expiresAt.getDate() + 30)
      const { data: cal, error: calErr } = await supabase
        .from('calendars')
        .insert({ code, name, start_date: startDate, end_date: endDate, day_start_time: startTime, day_end_time: endTime, expires_at: expiresAt.toISOString() })
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

  return (
    <main className="flex-1 flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>
      <nav className="flex items-center justify-between px-6 sm:px-10 py-5">
        <a href="/" className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4L6 8l4 4"/></svg>
          Back to flock
        </a>
        <ThemeToggle />
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-1" style={{ fontFamily: 'var(--font-jakarta)', color: 'var(--ink)' }}>
              New calendar
            </h1>
            <p style={{ color: 'var(--ink-2)' }}>Set a date range, then share the code.</p>
          </div>

          <div className="rounded-2xl p-8" style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)' }}>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Calendar name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Summer Trip Planning"
                  required
                  autoFocus
                  className="w-full rounded-xl px-4 py-3 text-base focus:outline-none transition-colors"
                  style={{ border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                  onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Start date</label>
                  <input
                    type="date"
                    value={startDate}
                    min={today}
                    onChange={e => setStartDate(e.target.value)}
                    required
                    className="w-full rounded-xl px-4 py-3 text-base focus:outline-none transition-colors"
                    style={{ border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>End date</label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || today}
                    onChange={e => setEndDate(e.target.value)}
                    required
                    className="w-full rounded-xl px-4 py-3 text-base focus:outline-none transition-colors"
                    style={{ border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>
                  Daily hours{' '}
                  <span className="font-normal" style={{ color: 'var(--ink-3)' }}>optional</span>
                </label>
                <div className="flex items-center gap-3">
                  <select
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="flex-1 rounded-xl px-3 py-3 text-sm focus:outline-none"
                    style={{ border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                  >
                    {timeOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                  </select>
                  <span className="text-sm font-medium" style={{ color: 'var(--ink-3)' }}>to</span>
                  <select
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    className="flex-1 rounded-xl px-3 py-3 text-sm focus:outline-none"
                    style={{ border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                  >
                    {timeOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {error && (
                <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#FFF0F0', color: '#C0392B', border: '1px solid #FECACA' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl font-semibold text-base text-white transition-all mt-1"
                style={{ background: loading ? 'var(--ink-3)' : 'var(--primary)' }}
              >
                {loading ? 'Creating…' : 'Create Calendar →'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  )
}
