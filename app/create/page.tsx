'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
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
      // Ensure uniqueness (retry once on collision)
      const { data: existing } = await supabase.from('calendars').select('code').eq('code', code).single()
      if (existing) code = generateCode()

      const expiresAt = new Date(endDate)
      expiresAt.setDate(expiresAt.getDate() + 30)

      const { data: cal, error: calErr } = await supabase
        .from('calendars')
        .insert({
          code,
          name,
          start_date: startDate,
          end_date: endDate,
          day_start_time: startTime,
          day_end_time: endTime,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single()

      if (calErr) throw calErr

      router.push(`/share/${cal.code}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      <a href="/" className="flex items-center gap-2 mb-10 self-start sm:self-auto">
        <span className="text-xl font-bold text-indigo-600" style={{ fontFamily: 'var(--font-jakarta)' }}>← flock</span>
      </a>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-indigo-100 p-8">
        <h1 className="text-2xl font-bold text-[#1a1635] mb-6" style={{ fontFamily: 'var(--font-jakarta)' }}>
          New Calendar
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-sm font-medium text-[#1a1635] mb-1">Calendar name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Summer Trip Planning"
              required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-400 text-[#1a1635]"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-[#1a1635] mb-1">Start date</label>
              <input
                type="date"
                value={startDate}
                min={today}
                onChange={e => setStartDate(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-400 text-[#1a1635]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-[#1a1635] mb-1">End date</label>
              <input
                type="date"
                value={endDate}
                min={startDate || today}
                onChange={e => setEndDate(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-400 text-[#1a1635]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1a1635] mb-1">
              Daily hours <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <div className="flex items-center gap-2">
              <select
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-3 focus:outline-none focus:border-indigo-400 text-[#1a1635]"
              >
                {Array.from({ length: 48 }, (_, i) => {
                  const h = Math.floor(i / 2)
                  const m = i % 2 === 0 ? '00' : '30'
                  const val = `${String(h).padStart(2, '0')}:${m}`
                  const label = `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
                  return <option key={val} value={val}>{label}</option>
                })}
              </select>
              <span className="text-gray-400">to</span>
              <select
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-3 focus:outline-none focus:border-indigo-400 text-[#1a1635]"
              >
                {Array.from({ length: 48 }, (_, i) => {
                  const h = Math.floor(i / 2)
                  const m = i % 2 === 0 ? '00' : '30'
                  const val = `${String(h).padStart(2, '0')}:${m}`
                  const label = `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
                  return <option key={val} value={val}>{label}</option>
                })}
              </select>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white font-semibold py-3 rounded-xl transition-colors mt-2"
          >
            {loading ? 'Creating…' : 'Create Calendar →'}
          </button>
        </form>
      </div>
    </main>
  )
}
