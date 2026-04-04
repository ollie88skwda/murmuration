'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { hueForIndex } from '@/lib/colors'
import { Calendar, Participant, Block } from '@/lib/types'

const TEST_CODE = 'TESTDBG'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date) {
  return d.toISOString().split('T')[0]
}

function todayPlus(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return fmt(d)
}

// ── Gate screen ───────────────────────────────────────────────────────────────

function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.trim().toUpperCase() === 'DEBUG') {
      onUnlock()
    } else {
      setErr(true)
      setPw('')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d0d0f',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'monospace',
    }}>
      <div style={{
        background: '#141416',
        border: '1px solid #2a2a30',
        borderRadius: 8,
        padding: '2.5rem 3rem',
        minWidth: 340,
        textAlign: 'center',
      }}>
        <div style={{ color: '#4ade80', fontSize: 13, letterSpacing: '0.15em', marginBottom: 8 }}>
          FLOCK DEBUG PANEL
        </div>
        <div style={{ color: '#555', fontSize: 12, marginBottom: 28 }}>enter access code</div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            autoFocus
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setErr(false) }}
            placeholder="••••••"
            style={{
              background: '#0d0d0f',
              border: err ? '1px solid #ef4444' : '1px solid #2a2a30',
              borderRadius: 4,
              padding: '10px 14px',
              color: '#e5e5e5',
              fontFamily: 'monospace',
              fontSize: 14,
              outline: 'none',
              textAlign: 'center',
              letterSpacing: '0.2em',
            }}
          />
          {err && <div style={{ color: '#ef4444', fontSize: 12 }}>invalid password</div>}
          <button type="submit" style={{
            background: '#4ade80',
            color: '#0d0d0f',
            border: 'none',
            borderRadius: 4,
            padding: '10px 0',
            fontFamily: 'monospace',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            letterSpacing: '0.1em',
          }}>
            UNLOCK
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#141416',
      border: '1px solid #2a2a30',
      borderRadius: 6,
      padding: '1.25rem 1.5rem',
      marginBottom: '1.25rem',
    }}>
      <div style={{ color: '#4ade80', fontSize: 11, letterSpacing: '0.15em', marginBottom: 14, fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Btn({ onClick, children, variant = 'default', disabled }: {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
  variant?: 'default' | 'danger' | 'ghost'
  disabled?: boolean
}) {
  const bg = variant === 'danger' ? '#7f1d1d' : variant === 'ghost' ? 'transparent' : '#1e3a5f'
  const color = variant === 'danger' ? '#fca5a5' : variant === 'ghost' ? '#888' : '#93c5fd'
  const border = variant === 'ghost' ? '1px solid #2a2a30' : 'none'
  return (
    <button
      onClick={e => onClick?.(e)}
      disabled={disabled}
      style={{
        background: disabled ? '#1a1a1f' : bg,
        color: disabled ? '#444' : color,
        border: disabled ? '1px solid #222' : border,
        borderRadius: 4,
        padding: '6px 14px',
        fontFamily: 'monospace',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        letterSpacing: '0.05em',
      }}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <label style={{ color: '#888', fontSize: 12, minWidth: 120, fontFamily: 'monospace' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#0d0d0f',
  border: '1px solid #2a2a30',
  borderRadius: 4,
  padding: '5px 10px',
  color: '#e5e5e5',
  fontFamily: 'monospace',
  fontSize: 12,
  outline: 'none',
  minWidth: 0,
}

// ── Main debug panel ──────────────────────────────────────────────────────────

export default function DebugPage() {
  const [unlocked, setUnlocked] = useState(false)

  // Calendar
  const [calendar, setCalendar] = useState<Calendar | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calMsg, setCalMsg] = useState('')

  // Form: calendar creation
  const [calName, setCalName] = useState('Test Calendar')
  const [calStart, setCalStart] = useState(todayPlus(0))
  const [calEnd, setCalEnd] = useState(todayPlus(13))
  const [calDayStart, setCalDayStart] = useState('09:00')
  const [calDayEnd, setCalDayEnd] = useState('18:00')
  const [calDays, setCalDays] = useState<number[]>([1, 2, 3, 4, 5])

  // Participants
  const [participants, setParticipants] = useState<Participant[]>([])
  const [partName, setPartName] = useState('')
  const [selectedPart, setSelectedPart] = useState<Participant | null>(null)
  const [partLoading, setPartLoading] = useState(false)

  // Blocks
  const [blocks, setBlocks] = useState<Block[]>([])
  const [blockDate, setBlockDate] = useState(todayPlus(0))
  const [blockStart, setBlockStart] = useState('10:00')
  const [blockEnd, setBlockEnd] = useState('12:00')
  const [blockTier, setBlockTier] = useState<1 | 2 | 3>(2)
  const [blockLabel, setBlockLabel] = useState('')
  const [blockLoading, setBlockLoading] = useState(false)

  const [status, setStatus] = useState('')

  // ── Load existing test calendar on mount ──────────────────────────────────

  const loadCalendar = useCallback(async () => {
    const { data } = await supabase.from('calendars').select('*').eq('code', TEST_CODE).single()
    setCalendar(data ?? null)
  }, [])

  useEffect(() => {
    if (unlocked) loadCalendar()
  }, [unlocked, loadCalendar])

  // ── Load participants when calendar changes ───────────────────────────────

  const loadParticipants = useCallback(async () => {
    if (!calendar) { setParticipants([]); return }
    const { data } = await supabase.from('participants').select('*').eq('calendar_id', calendar.id).order('created_at')
    setParticipants(data ?? [])
  }, [calendar])

  useEffect(() => { loadParticipants() }, [loadParticipants])

  // ── Load blocks when participant changes ──────────────────────────────────

  const loadBlocks = useCallback(async () => {
    if (!selectedPart) { setBlocks([]); return }
    const { data } = await supabase.from('blocks').select('*').eq('participant_id', selectedPart.id).order('date').order('start_time')
    setBlocks(data ?? [])
  }, [selectedPart])

  useEffect(() => { loadBlocks() }, [loadBlocks])

  // ── Calendar ops ──────────────────────────────────────────────────────────

  async function createCalendar() {
    setCalLoading(true)
    setCalMsg('')
    try {
      // Delete existing test calendar first
      if (calendar) {
        await supabase.from('blocks').delete().eq('calendar_id', calendar.id)
        await supabase.from('participants').delete().eq('calendar_id', calendar.id)
        await supabase.from('calendars').delete().eq('id', calendar.id)
      }
      const expires = new Date()
      expires.setDate(expires.getDate() + 30)
      const { data, error } = await supabase.from('calendars').insert({
        code: TEST_CODE,
        name: calName,
        start_date: calStart,
        end_date: calEnd,
        day_start_time: calDayStart,
        day_end_time: calDayEnd,
        selected_days_of_week: calDays,
        expires_at: expires.toISOString(),
      }).select().single()
      if (error) throw error
      setCalendar(data)
      setSelectedPart(null)
      setCalMsg('created')
    } catch (e: unknown) {
      setCalMsg(e instanceof Error ? e.message : 'error')
    } finally {
      setCalLoading(false)
    }
  }

  async function deleteCalendar() {
    if (!calendar) return
    setCalLoading(true)
    try {
      await supabase.from('blocks').delete().eq('calendar_id', calendar.id)
      await supabase.from('participants').delete().eq('calendar_id', calendar.id)
      await supabase.from('calendars').delete().eq('id', calendar.id)
      setCalendar(null)
      setParticipants([])
      setSelectedPart(null)
      setBlocks([])
      setCalMsg('deleted')
    } finally {
      setCalLoading(false)
    }
  }

  // ── Participant ops ───────────────────────────────────────────────────────

  async function addParticipant(name?: string) {
    if (!calendar) return
    setPartLoading(true)
    try {
      const n = (name ?? partName).trim()
      if (!n) return
      const hue = hueForIndex(participants.length)
      const { data, error } = await supabase.from('participants').insert({
        calendar_id: calendar.id,
        name: n,
        color_hue: hue,
      }).select().single()
      if (error) throw error
      setParticipants(p => [...p, data])
      setPartName('')
      setStatus(`added participant: ${n}`)
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'error')
    } finally {
      setPartLoading(false)
    }
  }

  async function deleteParticipant(p: Participant) {
    setPartLoading(true)
    try {
      await supabase.from('blocks').delete().eq('participant_id', p.id)
      await supabase.from('participants').delete().eq('id', p.id)
      setParticipants(ps => ps.filter(x => x.id !== p.id))
      if (selectedPart?.id === p.id) { setSelectedPart(null); setBlocks([]) }
      setStatus(`deleted participant: ${p.name}`)
    } finally {
      setPartLoading(false)
    }
  }

  // ── Block ops ─────────────────────────────────────────────────────────────

  async function addBlock() {
    if (!selectedPart || !calendar) return
    setBlockLoading(true)
    try {
      const { data, error } = await supabase.from('blocks').insert({
        participant_id: selectedPart.id,
        calendar_id: calendar.id,
        date: blockDate,
        start_time: blockStart,
        end_time: blockEnd,
        tier: blockTier,
        label: blockLabel || null,
      }).select().single()
      if (error) throw error
      setBlocks(bs => [...bs, data])
      setStatus(`added block on ${blockDate}`)
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'error')
    } finally {
      setBlockLoading(false)
    }
  }

  async function deleteBlock(b: Block) {
    setBlockLoading(true)
    try {
      await supabase.from('blocks').delete().eq('id', b.id)
      setBlocks(bs => bs.filter(x => x.id !== b.id))
      setStatus(`deleted block`)
    } finally {
      setBlockLoading(false)
    }
  }

  // ── Scenario: Full scenario ───────────────────────────────────────────────

  async function runFullScenario() {
    if (!calendar) return
    setStatus('running full scenario...')
    const names = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve']
    const base = calendar.start_date
    const d1 = base
    const d2 = todayPlus(1)

    for (let i = 0; i < names.length; i++) {
      const hue = hueForIndex(participants.length + i)
      const { data: p, error } = await supabase.from('participants').insert({
        calendar_id: calendar.id,
        name: names[i],
        color_hue: hue,
      }).select().single()
      if (error || !p) continue

      // Add overlapping blocks for this participant
      await supabase.from('blocks').insert([
        { participant_id: p.id, calendar_id: calendar.id, date: d1, start_time: '09:00', end_time: '11:00', tier: (1 + (i % 3)) as 1 | 2 | 3, label: 'morning conflict' },
        { participant_id: p.id, calendar_id: calendar.id, date: d1, start_time: '14:00', end_time: '16:00', tier: (2 + (i % 2)) as 1 | 2 | 3, label: null },
        { participant_id: p.id, calendar_id: calendar.id, date: d2, start_time: '10:00', end_time: '12:30', tier: (1 + (i % 3)) as 1 | 2 | 3, label: 'overlap' },
      ])
    }
    await loadParticipants()
    setStatus('full scenario loaded — 5 participants with overlapping blocks')
  }

  // ── Scenario: Many participants ───────────────────────────────────────────

  async function runManyParticipants() {
    if (!calendar) return
    setStatus('adding 10 participants...')
    const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']
    for (let i = 0; i < names.length; i++) {
      const hue = hueForIndex(participants.length + i)
      await supabase.from('participants').insert({
        calendar_id: calendar.id,
        name: names[i],
        color_hue: hue,
      })
    }
    await loadParticipants()
    setStatus('added 10 participants')
  }

  // ── Day-of-week toggle ────────────────────────────────────────────────────

  function toggleDay(d: number) {
    setCalDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort())
  }

  const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  if (!unlocked) return <Gate onUnlock={() => setUnlocked(true)} />

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d0d0f',
      color: '#e5e5e5',
      fontFamily: 'monospace',
      padding: '2rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <div style={{ color: '#4ade80', fontSize: 16, letterSpacing: '0.15em', fontWeight: 700 }}>
            FLOCK // DEBUG PANEL
          </div>
          <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>
            admin interface — dev use only
          </div>
        </div>
        <a href="/" style={{ color: '#555', fontSize: 12, textDecoration: 'none' }}>← back to app</a>
      </div>

      {/* Status bar */}
      {status && (
        <div style={{
          background: '#0a1a0f',
          border: '1px solid #166534',
          borderRadius: 4,
          padding: '8px 14px',
          fontSize: 12,
          color: '#4ade80',
          marginBottom: '1.25rem',
        }}>
          &gt; {status}
        </div>
      )}

      {/* ── Test Calendar Manager ─────────────────────────────────────────── */}
      <Section title="TEST CALENDAR MANAGER">
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          {/* Config */}
          <div style={{ flex: 1, minWidth: 280 }}>
            <Field label="name">
              <input style={{ ...inputStyle, flex: 1 }} value={calName} onChange={e => setCalName(e.target.value)} />
            </Field>
            <Field label="start date">
              <input style={inputStyle} type="date" value={calStart} onChange={e => setCalStart(e.target.value)} />
            </Field>
            <Field label="end date">
              <input style={inputStyle} type="date" value={calEnd} onChange={e => setCalEnd(e.target.value)} />
            </Field>
            <Field label="day start">
              <input style={inputStyle} type="time" value={calDayStart} onChange={e => setCalDayStart(e.target.value)} />
            </Field>
            <Field label="day end">
              <input style={inputStyle} type="time" value={calDayEnd} onChange={e => setCalDayEnd(e.target.value)} />
            </Field>
            <Field label="days of week">
              <div style={{ display: 'flex', gap: 4 }}>
                {dayLabels.map((lbl, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    style={{
                      background: calDays.includes(i) ? '#1e3a5f' : '#1a1a1f',
                      color: calDays.includes(i) ? '#93c5fd' : '#555',
                      border: '1px solid #2a2a30',
                      borderRadius: 3,
                      padding: '3px 7px',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >{lbl}</button>
                ))}
              </div>
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn onClick={createCalendar} disabled={calLoading}>
                {calendar ? 'RECREATE' : 'CREATE'} CALENDAR
              </Btn>
              {calendar && <Btn onClick={deleteCalendar} variant="danger" disabled={calLoading}>DELETE ALL</Btn>}
            </div>
            {calMsg && <div style={{ color: '#4ade80', fontSize: 11, marginTop: 8 }}>{calMsg}</div>}
          </div>

          {/* Status */}
          <div style={{ flex: 1, minWidth: 200 }}>
            {calendar ? (
              <div style={{ background: '#0d0d0f', border: '1px solid #2a2a30', borderRadius: 4, padding: '1rem' }}>
                <div style={{ color: '#4ade80', fontSize: 11, marginBottom: 10 }}>ACTIVE TEST CALENDAR</div>
                <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                  <tbody>
                    {[
                      ['code', calendar.code],
                      ['name', calendar.name],
                      ['range', `${calendar.start_date} → ${calendar.end_date}`],
                      ['hours', `${calendar.day_start_time} – ${calendar.day_end_time}`],
                    ].map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: '#666', paddingRight: 14, paddingBottom: 4 }}>{k}</td>
                        <td style={{ color: '#e5e5e5', paddingBottom: 4 }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <a
                    href={`/calendar/${calendar.code}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-block',
                      background: '#1a2535',
                      color: '#93c5fd',
                      border: 'none',
                      borderRadius: 4,
                      padding: '6px 14px',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      textDecoration: 'none',
                    }}
                  >
                    OPEN CALENDAR ↗
                  </a>
                  <a
                    href={`/join/${calendar.code}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-block',
                      background: '#1a1a1f',
                      color: '#888',
                      border: '1px solid #2a2a30',
                      borderRadius: 4,
                      padding: '6px 14px',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      textDecoration: 'none',
                    }}
                  >
                    OPEN JOIN ↗
                  </a>
                </div>
              </div>
            ) : (
              <div style={{ color: '#444', fontSize: 12 }}>no test calendar — create one to start</div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Scenario Buttons ─────────────────────────────────────────────── */}
      <Section title="SCENARIOS">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn onClick={runFullScenario} disabled={!calendar}>FULL SCENARIO (5 overlapping)</Btn>
          <Btn onClick={runManyParticipants} disabled={!calendar}>MANY PARTICIPANTS (+10)</Btn>
          <Btn onClick={async () => {
            await createCalendar()
            setStatus('empty calendar ready')
          }}>EMPTY CALENDAR</Btn>
        </div>
        {!calendar && <div style={{ color: '#555', fontSize: 11, marginTop: 8 }}>create a test calendar first</div>}
      </Section>

      {/* ── Test Participant Manager ──────────────────────────────────────── */}
      <Section title="TEST PARTICIPANT MANAGER">
        {!calendar && <div style={{ color: '#555', fontSize: 12 }}>requires a test calendar</div>}
        {calendar && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="participant name"
                value={partName}
                onChange={e => setPartName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addParticipant()}
              />
              <Btn onClick={() => addParticipant()} disabled={partLoading || !partName.trim()}>ADD</Btn>
            </div>

            {participants.length === 0 && (
              <div style={{ color: '#444', fontSize: 12 }}>no participants yet</div>
            )}

            {participants.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a30' }}>
                    {['color', 'name', 'id', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', color: '#555', padding: '4px 10px 8px', fontWeight: 'normal' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {participants.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedPart(sp => sp?.id === p.id ? null : p)}
                      style={{
                        cursor: 'pointer',
                        background: selectedPart?.id === p.id ? '#0a1a2f' : 'transparent',
                        borderBottom: '1px solid #1a1a1f',
                      }}
                    >
                      <td style={{ padding: '6px 10px' }}>
                        <div style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: `hsl(${p.color_hue}, 65%, 55%)`,
                        }} />
                      </td>
                      <td style={{ padding: '6px 10px', color: selectedPart?.id === p.id ? '#93c5fd' : '#e5e5e5' }}>
                        {p.name} {selectedPart?.id === p.id ? '← selected' : ''}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#555' }}>{p.id.slice(0, 8)}…</td>
                      <td style={{ padding: '6px 10px' }}>
                        <Btn
                          onClick={e => { e.stopPropagation(); deleteParticipant(p) }}
                          variant="danger"
                          disabled={partLoading}
                        >
                          DEL
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Section>

      {/* ── Test Block Manager ────────────────────────────────────────────── */}
      <Section title={`TEST BLOCK MANAGER${selectedPart ? ` — ${selectedPart.name}` : ''}`}>
        {!selectedPart && <div style={{ color: '#555', fontSize: 12 }}>select a participant above</div>}
        {selectedPart && (
          <>
            {/* Add block form */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              <input style={inputStyle} type="date" value={blockDate} min={calendar?.start_date} max={calendar?.end_date} onChange={e => setBlockDate(e.target.value)} />
              <input style={inputStyle} type="time" value={blockStart} onChange={e => setBlockStart(e.target.value)} />
              <span style={{ color: '#555', fontSize: 12 }}>to</span>
              <input style={inputStyle} type="time" value={blockEnd} onChange={e => setBlockEnd(e.target.value)} />
              <select
                style={{ ...inputStyle }}
                value={blockTier}
                onChange={e => setBlockTier(Number(e.target.value) as 1 | 2 | 3)}
              >
                <option value={1}>tier 1 (kinda busy)</option>
                <option value={2}>tier 2 (very busy)</option>
                <option value={3}>tier 3 (can&apos;t do it)</option>
              </select>
              <input style={{ ...inputStyle, flex: 1 }} placeholder="label (optional)" value={blockLabel} onChange={e => setBlockLabel(e.target.value)} />
              <Btn onClick={addBlock} disabled={blockLoading}>ADD BLOCK</Btn>
            </div>

            {blocks.length === 0 && <div style={{ color: '#444', fontSize: 12 }}>no blocks for this participant</div>}

            {blocks.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a30' }}>
                    {['date', 'start', 'end', 'tier', 'label', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', color: '#555', padding: '4px 10px 8px', fontWeight: 'normal' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blocks.map(b => (
                    <tr key={b.id} style={{ borderBottom: '1px solid #1a1a1f' }}>
                      <td style={{ padding: '6px 10px', color: '#e5e5e5' }}>{b.date}</td>
                      <td style={{ padding: '6px 10px', color: '#aaa' }}>{b.start_time}</td>
                      <td style={{ padding: '6px 10px', color: '#aaa' }}>{b.end_time}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{
                          background: b.tier === 1 ? '#2a1a00' : b.tier === 2 ? '#1a1a2a' : '#2a0a0a',
                          color: b.tier === 1 ? '#fbbf24' : b.tier === 2 ? '#818cf8' : '#f87171',
                          borderRadius: 3,
                          padding: '1px 6px',
                          fontSize: 11,
                        }}>T{b.tier}</span>
                      </td>
                      <td style={{ padding: '6px 10px', color: '#666' }}>{b.label ?? '—'}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <Btn onClick={() => deleteBlock(b)} variant="danger" disabled={blockLoading}>DEL</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Section>
    </div>
  )
}
