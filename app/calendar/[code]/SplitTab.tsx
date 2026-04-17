'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Calendar, Participant, Split, SplitAttendance } from '@/lib/types'
import { getDateRange, formatDate } from '@/lib/grid'
import { tierColor } from '@/lib/colors'

interface Props {
  cal: Calendar
  participants: Participant[]
  myParticipantId: string | null
}

export default function SplitTab({ cal, participants, myParticipantId }: Props) {
  const [split, setSplit] = useState<Split | null>(null)
  const [attendance, setAttendance] = useState<SplitAttendance[]>([])
  const [loading, setLoading] = useState(true)

  const dates = cal.is_infinite ? [] : getDateRange(cal.start_date, cal.end_date)

  useEffect(() => {
    async function init() {
      setLoading(true)
      let { data: existingSplit } = await supabase
        .from('splits')
        .select('*')
        .eq('calendar_id', cal.id)
        .maybeSingle()

      if (!existingSplit) {
        const { data: newSplit } = await supabase
          .from('splits')
          .insert({ calendar_id: cal.id, total_cost: 0 })
          .select()
          .single()
        existingSplit = newSplit
      }

      if (!existingSplit) { setLoading(false); return }
      setSplit(existingSplit)

      const { data: rows } = await supabase
        .from('split_attendance')
        .select('*')
        .eq('split_id', existingSplit.id)
      setAttendance(rows ?? [])
      setLoading(false)
    }
    init()
  }, [cal.id])

  useEffect(() => {
    if (!split) return
    const channel = supabase
      .channel(`split_attendance:${split.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'split_attendance', filter: `split_id=eq.${split.id}` },
        payload => {
          if (payload.eventType === 'INSERT') {
            const newRow = payload.new as SplitAttendance
            setAttendance(prev => [
              ...prev.filter(a => !(a.participant_id === newRow.participant_id && a.date === newRow.date && a.id.startsWith('temp-'))),
              newRow,
            ])
          } else if (payload.eventType === 'DELETE') {
            setAttendance(prev => prev.filter(a => a.id !== (payload.old as { id: string }).id))
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [split])

  if (cal.is_infinite) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Set an end date on this calendar to use the Split feature.
        </p>
      </div>
    )
  }

  if (loading || !split) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col gap-6" style={{ background: 'var(--bg)' }}>
      <CostInput split={split} onUpdate={updated => setSplit(updated)} />
      <AttendanceGrid
        split={split}
        participants={participants}
        dates={dates}
        attendance={attendance}
        onToggle={(participantId, date, attended) => {
          if (attended) {
            setAttendance(prev => prev.filter(a => !(a.participant_id === participantId && a.date === date)))
          } else {
            setAttendance(prev => [...prev, {
              id: `temp-${participantId}-${date}`,
              split_id: split.id,
              participant_id: participantId,
              date,
            }])
          }
        }}
      />
      <ResultsList
        participants={participants}
        dates={dates}
        attendance={attendance}
        totalCost={split.total_cost}
      />
    </div>
  )
}

function CostInput({ split, onUpdate }: { split: Split; onUpdate: (s: Split) => void }) {
  const [value, setValue] = useState(String(split.total_cost))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setValue(e.target.value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const num = parseFloat(e.target.value)
      if (isNaN(num) || num < 0) return
      const { data } = await supabase
        .from('splits')
        .update({ total_cost: num, updated_at: new Date().toISOString() })
        .eq('id', split.id)
        .select()
        .single()
      if (data) onUpdate(data)
    }, 600)
  }

  return (
    <div
      className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <p className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--ink-3)' }}>
        Total Cost
      </p>
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold" style={{ color: 'var(--ink-2)' }}>$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={handleChange}
          className="text-2xl font-bold w-40 bg-transparent outline-none"
          style={{ color: 'var(--ink)', borderBottom: '2px solid var(--border)' }}
          placeholder="0.00"
        />
      </div>
    </div>
  )
}

function AttendanceGrid({
  split,
  participants,
  dates,
  attendance,
  onToggle,
}: {
  split: Split
  participants: Participant[]
  dates: string[]
  attendance: SplitAttendance[]
  onToggle: (participantId: string, date: string, currentlyAttended: boolean) => void
}) {
  const attendedSet = new Set(attendance.map(a => `${a.participant_id}|${a.date}`))

  async function toggle(participantId: string, date: string) {
    const key = `${participantId}|${date}`
    const attended = attendedSet.has(key)
    onToggle(participantId, date, attended)
    if (attended) {
      await supabase
        .from('split_attendance')
        .delete()
        .eq('split_id', split.id)
        .eq('participant_id', participantId)
        .eq('date', date)
    } else {
      await supabase
        .from('split_attendance')
        .upsert(
          { split_id: split.id, participant_id: participantId, date },
          { onConflict: 'split_id,participant_id,date' }
        )
    }
  }

  if (dates.length === 0) return null

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <p className="text-sm font-bold uppercase tracking-widest px-4 sm:px-5 pt-4 sm:pt-5 pb-3" style={{ color: 'var(--ink-3)' }}>
        Attendance
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 320 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="text-left pl-4 sm:pl-5 pr-3 py-2 text-xs font-semibold" style={{ color: 'var(--ink-2)', width: 120 }}>
                Person
              </th>
              {dates.map(d => (
                <th key={d} className="text-center px-2 py-2 text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                  {formatDate(d).short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {participants.map((p, i) => (
              <tr
                key={p.id}
                style={{ borderBottom: i < participants.length - 1 ? '1px solid var(--border)' : 'none' }}
              >
                <td className="pl-4 sm:pl-5 pr-3 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: tierColor(p.color_hue, 3) }}
                    />
                    <span className="text-sm font-medium truncate max-w-[80px]" style={{ color: 'var(--ink)' }}>
                      {p.name}
                    </span>
                  </div>
                </td>
                {dates.map(d => {
                  const attended = attendedSet.has(`${p.id}|${d}`)
                  return (
                    <td key={d} className="text-center px-2 py-3">
                      <button
                        onClick={() => toggle(p.id, d)}
                        className="w-7 h-7 rounded-full mx-auto flex items-center justify-center transition-all"
                        style={{
                          background: attended ? tierColor(p.color_hue, 3) : 'transparent',
                          border: `2px solid ${attended ? tierColor(p.color_hue, 3) : 'var(--border)'}`,
                          cursor: 'pointer',
                        }}
                        aria-label={`${p.name} ${attended ? 'attended' : 'did not attend'} ${d}`}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResultsList({
  participants,
  dates,
  attendance,
  totalCost,
}: {
  participants: Participant[]
  dates: string[]
  attendance: SplitAttendance[]
  totalCost: number
}) {
  const attendedSet = new Set(attendance.map(a => `${a.participant_id}|${a.date}`))

  const rows = participants.map(p => ({
    participant: p,
    days: dates.filter(d => attendedSet.has(`${p.id}|${d}`)).length,
  }))

  const totalPersonDays = rows.reduce((sum, r) => sum + r.days, 0)

  const results = rows.map(r => ({
    ...r,
    share: totalPersonDays === 0 ? 0 : (totalCost * r.days) / totalPersonDays,
  }))

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <p className="text-sm font-bold uppercase tracking-widest px-4 sm:px-5 pt-4 sm:pt-5 pb-3" style={{ color: 'var(--ink-3)' }}>
        Your Shares
      </p>
      <div>
        {results.map((r, i) => (
          <div
            key={r.participant.id}
            className="flex items-center gap-3 px-4 sm:px-5 py-3"
            style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ background: tierColor(r.participant.color_hue, 3) }}
            />
            <span className="flex-1 text-sm font-medium" style={{ color: 'var(--ink)' }}>
              {r.participant.name}
            </span>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
              {r.days} day{r.days !== 1 ? 's' : ''}
            </span>
            <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--primary)' }}>
              ${r.share.toFixed(2)}
            </span>
          </div>
        ))}
        {totalPersonDays === 0 && (
          <p className="px-4 sm:px-5 py-4 text-sm" style={{ color: 'var(--ink-3)' }}>
            Mark attendance above to see each person&apos;s share.
          </p>
        )}
      </div>
    </div>
  )
}
