'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Calendar, Participant, Block, TIER_LABELS } from '@/lib/types'
import { tierColor, hueForIndex } from '@/lib/colors'
import { getTimeSlots, getDateRange, formatTime, formatDate, addThirtyMin } from '@/lib/grid'
import ThemeToggle from '@/components/ThemeToggle'

interface Props {
  calendar: Calendar
  initialParticipants: Participant[]
  initialBlocks: Block[]
}

interface DragState {
  dateIdx: number
  startSlotIdx: number
  endSlotIdx: number
}

const SLOT_HEIGHT = 32
const TIME_COL_WIDTH = 60
const COL_WIDTH = 112

export default function CalendarClient({ calendar, initialParticipants, initialBlocks }: Props) {
  const router = useRouter()
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants)
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks)
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const [legendOpen, setLegendOpen] = useState(false)
  const [showHint, setShowHint] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ blockId: string; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [locking, setLocking] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dates = getDateRange(calendar.start_date, calendar.end_date)
  const slots = getTimeSlots(calendar.day_start_time, calendar.day_end_time)

  useEffect(() => {
    const stored = localStorage.getItem(`flock_${calendar.code}`)
    if (!stored) { router.replace(`/join/${calendar.code}`); return }
    const { participantId } = JSON.parse(stored)
    setMyParticipantId(participantId)
    setIsHost(calendar.host_participant_id === participantId)
  }, [calendar.code, calendar.host_participant_id, router])

  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 5000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const blocksSub = supabase.channel(`blocks:${calendar.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks', filter: `calendar_id=eq.${calendar.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') setBlocks(prev => [...prev, payload.new as Block])
        else if (payload.eventType === 'UPDATE') setBlocks(prev => prev.map(b => b.id === payload.new.id ? payload.new as Block : b))
        else if (payload.eventType === 'DELETE') setBlocks(prev => prev.filter(b => b.id !== payload.old.id))
      }).subscribe()

    const pSub = supabase.channel(`participants:${calendar.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `calendar_id=eq.${calendar.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') setParticipants(prev => [...prev, payload.new as Participant])
        else if (payload.eventType === 'UPDATE') setParticipants(prev => prev.map(p => p.id === payload.new.id ? payload.new as Participant : p))
      }).subscribe()

    return () => { supabase.removeChannel(blocksSub); supabase.removeChannel(pSub) }
  }, [calendar.id])

  const myParticipant = participants.find(p => p.id === myParticipantId)

  const finalizeDrag = useCallback(async (drag: DragState) => {
    if (!myParticipantId || !myParticipant) return
    const dateStr = dates[drag.dateIdx]
    const minSlot = Math.min(drag.startSlotIdx, drag.endSlotIdx)
    const maxSlot = Math.max(drag.startSlotIdx, drag.endSlotIdx)
    const startTime = slots[minSlot]
    const endTime = addThirtyMin(slots[maxSlot])
    setShowHint(false)

    const overlapping = blocks.filter(b =>
      b.participant_id === myParticipantId && b.date === dateStr &&
      b.start_time < endTime && b.end_time > startTime
    )
    let mergedStart = startTime, mergedEnd = endTime
    for (const b of overlapping) {
      if (b.start_time < mergedStart) mergedStart = b.start_time
      if (b.end_time > mergedEnd) mergedEnd = b.end_time
    }
    const overlapIds = overlapping.map(b => b.id)
    setBlocks(prev => prev.filter(b => !overlapIds.includes(b.id)))
    const newBlock = { participant_id: myParticipantId, calendar_id: calendar.id, date: dateStr, start_time: mergedStart, end_time: mergedEnd, tier: 2 as const }
    const tempId = `temp_${Date.now()}`
    setBlocks(prev => [...prev, { ...newBlock, id: tempId, created_at: '', updated_at: '' }])
    if (overlapIds.length > 0) await supabase.from('blocks').delete().in('id', overlapIds)
    const { data } = await supabase.from('blocks').insert(newBlock).select().single()
    if (data) setBlocks(prev => prev.map(b => b.id === tempId ? data : b))
  }, [myParticipantId, myParticipant, dates, slots, blocks, calendar.id])

  function handleCellMouseDown(dateIdx: number, slotIdx: number, e: React.MouseEvent) {
    if (calendar.is_locked || !myParticipantId) return
    if (e.button !== 0) return
    setDragging({ dateIdx, startSlotIdx: slotIdx, endSlotIdx: slotIdx })
    e.preventDefault()
  }

  function handleCellMouseEnter(dateIdx: number, slotIdx: number) {
    if (!dragging || dragging.dateIdx !== dateIdx) return
    setDragging(prev => prev ? { ...prev, endSlotIdx: slotIdx } : null)
  }

  function handleMouseUp() {
    if (dragging) { finalizeDrag(dragging); setDragging(null) }
  }

  async function handleBlockClick(block: Block, e: React.MouseEvent) {
    e.stopPropagation()
    if (block.participant_id !== myParticipantId || calendar.is_locked) return
    const nextTier = (block.tier % 3 + 1) as 1 | 2 | 3
    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, tier: nextTier } : b))
    await supabase.from('blocks').update({ tier: nextTier, updated_at: new Date().toISOString() }).eq('id', block.id)
  }

  function handleBlockContextMenu(blockId: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ blockId, x: e.clientX, y: e.clientY })
  }

  function handleBlockTouchStart(blockId: string, e: React.TouchEvent) {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0]
      setContextMenu({ blockId, x: touch.clientX, y: touch.clientY })
    }, 500)
  }

  function handleBlockTouchEnd() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }

  async function setBlockTier(blockId: string, tier: 1 | 2 | 3) {
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, tier } : b))
    setContextMenu(null)
    await supabase.from('blocks').update({ tier, updated_at: new Date().toISOString() }).eq('id', blockId)
  }

  async function deleteBlock(blockId: string) {
    setBlocks(prev => prev.filter(b => b.id !== blockId))
    setContextMenu(null)
    await supabase.from('blocks').delete().eq('id', blockId)
  }

  async function handleDone() {
    if (!myParticipantId) return
    setSubmitting(true)
    const isSubmitted = myParticipant?.is_submitted
    await supabase.from('participants').update({ is_submitted: !isSubmitted }).eq('id', myParticipantId)
    setParticipants(prev => prev.map(p => p.id === myParticipantId ? { ...p, is_submitted: !isSubmitted } : p))
    setSubmitting(false)
  }

  async function handleLock() {
    setLocking(true)
    await supabase.from('calendars').update({ is_locked: !calendar.is_locked }).eq('id', calendar.id)
    window.location.reload()
  }

  function renderBlocks(dateStr: string) {
    const dateBlocks = blocks.filter(b => b.date === dateStr && !hiddenIds.has(b.participant_id) && participants.find(p => p.id === b.participant_id))
    const rendered = new Set<string>()
    return dateBlocks.map(block => {
      if (rendered.has(block.id)) return null
      rendered.add(block.id)
      const participant = participants.find(p => p.id === block.participant_id)
      if (!participant) return null
      const startIdx = Math.max(0, slots.indexOf(block.start_time))
      const endIdx = slots.indexOf(block.end_time)
      const heightSlots = Math.max(1, (endIdx >= 0 ? endIdx : slots.length) - startIdx)
      const color = tierColor(participant.color_hue, block.tier)
      const isOwn = block.participant_id === myParticipantId && !calendar.is_locked
      return (
        <div
          key={block.id}
          style={{
            position: 'absolute', top: startIdx * SLOT_HEIGHT + 1, left: 3, right: 3,
            height: heightSlots * SLOT_HEIGHT - 2,
            backgroundColor: color, opacity: block.participant_id === myParticipantId ? 1 : 0.82,
            mixBlendMode: 'multiply', borderRadius: 7,
            cursor: isOwn ? 'pointer' : 'default',
            zIndex: block.participant_id === myParticipantId ? 2 : 1,
            display: 'flex', alignItems: 'flex-start', paddingLeft: 7, paddingTop: 5, overflow: 'hidden',
            boxShadow: isOwn ? `0 1px 4px ${color}55` : 'none',
            pointerEvents: 'auto',
          }}
          onClick={e => isOwn ? handleBlockClick(block, e) : undefined}
          onContextMenu={e => isOwn ? handleBlockContextMenu(block.id, e) : e.preventDefault()}
          onTouchStart={e => isOwn ? handleBlockTouchStart(block.id, e) : undefined}
          onTouchEnd={handleBlockTouchEnd}
        >
          {heightSlots >= 2 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.55)', whiteSpace: 'nowrap', letterSpacing: '0.01em' }}>
              {TIER_LABELS[block.tier]}
            </span>
          )}
        </div>
      )
    })
  }

  function renderDragPreview(dateIdx: number) {
    if (!dragging || dragging.dateIdx !== dateIdx || !myParticipant) return null
    const minSlot = Math.min(dragging.startSlotIdx, dragging.endSlotIdx)
    const maxSlot = Math.max(dragging.startSlotIdx, dragging.endSlotIdx)
    const color = tierColor(myParticipant.color_hue, 2)
    return (
      <div style={{
        position: 'absolute', top: minSlot * SLOT_HEIGHT + 1, left: 3, right: 3,
        height: (maxSlot - minSlot + 1) * SLOT_HEIGHT - 2,
        backgroundColor: color, opacity: 0.75, borderRadius: 7, zIndex: 10,
        pointerEvents: 'none', border: `2px solid ${color}`,
      }} />
    )
  }

  // Is a date a weekend?
  const isWeekend = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.getDay() === 0 || d.getDay() === 6
  }

  return (
    <div
      className="flex flex-col h-screen overflow-hidden no-select"
      style={{ background: 'var(--bg)' }}
      onMouseUp={handleMouseUp}
      onClick={() => setContextMenu(null)}
    >
      {/* Header */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-4 sm:px-5 py-3 border-b"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', boxShadow: '0 1px 0 var(--border)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="font-black text-lg tracking-tight flex-shrink-0" style={{ color: 'var(--primary)', fontFamily: 'var(--font-jakarta)' }}>
            flock
          </a>
          <span className="text-gray-300 hidden sm:block">·</span>
          <h1 className="font-semibold text-sm truncate hidden sm:block" style={{ color: 'var(--ink)' }}>{calendar.name}</h1>
          {calendar.is_locked && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: '#FEF3C7', color: '#B45309' }}>
              Locked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isHost && (
            <button
              onClick={handleLock}
              disabled={locking}
              className="hidden sm:block text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-2)', background: 'var(--bg-card)' }}
            >
              {calendar.is_locked ? 'Unlock' : 'Lock submissions'}
            </button>
          )}
          <button
            onClick={handleDone}
            disabled={submitting || calendar.is_locked}
            className="text-sm font-semibold px-4 py-1.5 rounded-lg transition-all text-white"
            style={{ background: myParticipant?.is_submitted ? 'var(--ink)' : 'var(--primary)' }}
          >
            {myParticipant?.is_submitted ? 'Edit' : 'Done'}
          </button>
          <ThemeToggle />
          <button
            onClick={() => setLegendOpen(o => !o)}
            className="sm:hidden flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
          >
            {participants.length}
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <circle cx="9" cy="7" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
              <circle cx="17" cy="7" r="3"/><path d="M21 20c0-1.7-.7-3.2-1.9-4.3"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Lock banner */}
      {calendar.is_locked && (
        <div className="flex-shrink-0 text-xs font-medium text-center py-2 px-4" style={{ background: '#FFFBEB', color: '#92400E', borderBottom: '1px solid #FDE68A' }}>
          This calendar is locked. Submissions are closed.
        </div>
      )}

      {/* Hint */}
      {showHint && !calendar.is_locked && myParticipant && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 text-sm font-medium text-white px-4 py-2.5 rounded-2xl shadow-xl"
          style={{ background: 'var(--ink)', marginTop: 16 }}>
          <span>Drag to mark when you&apos;re <strong>not</strong> free</span>
          <button onClick={() => setShowHint(false)} className="text-white/50 hover:text-white text-base leading-none">×</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Grid */}
        <div className="flex-1 overflow-auto grid-scroll" ref={undefined}>
          <div style={{ minWidth: TIME_COL_WIDTH + dates.length * COL_WIDTH }}>
            {/* Column headers */}
            <div className="flex sticky top-0 z-20 border-b" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <div style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, borderColor: 'var(--border)' }} className="flex-shrink-0 border-r" />
              {dates.map(dateStr => {
                const { short } = formatDate(dateStr)
                const weekend = isWeekend(dateStr)
                return (
                  <div
                    key={dateStr}
                    className="flex-shrink-0 text-center py-2.5 border-r"
                    style={{ width: COL_WIDTH, borderColor: 'var(--border)', background: weekend ? 'var(--primary-light)' : 'var(--bg-card)' }}
                  >
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: weekend ? 'var(--primary)' : 'var(--ink-2)' }}>
                      {short}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Body */}
            <div className="flex">
              {/* Time column */}
              <div style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, borderColor: 'var(--border)' }} className="flex-shrink-0 border-r">
                {slots.map(slot => (
                  <div key={slot} style={{ height: SLOT_HEIGHT }} className="flex items-start justify-end pr-2 pt-0.5">
                    {slot.endsWith(':00') && (
                      <span style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '0.02em' }}>{formatTime(slot)}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {dates.map((dateStr, dateIdx) => {
                const weekend = isWeekend(dateStr)
                return (
                  <div
                    key={dateStr}
                    className="flex-shrink-0 relative border-r"
                    style={{ width: COL_WIDTH, borderColor: 'var(--border)', background: weekend ? 'var(--primary-light)' : 'var(--bg-card)' }}
                  >
                    {slots.map((slot, slotIdx) => (
                      <div
                        key={slot}
                        style={{
                          height: SLOT_HEIGHT,
                          borderBottom: `1px solid ${slot.endsWith(':00') ? 'var(--border)' : 'transparent'}`,
                          cursor: 'crosshair',
                        }}
                        onMouseDown={e => handleCellMouseDown(dateIdx, slotIdx, e)}
                        onMouseEnter={() => handleCellMouseEnter(dateIdx, slotIdx)}
                      />
                    ))}
                    {/* Overlays */}
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                      <div style={{ position: 'relative', height: slots.length * SLOT_HEIGHT, pointerEvents: 'auto' }}>
                        {renderBlocks(dateStr)}
                        {renderDragPreview(dateIdx)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Legend sidebar */}
        <aside className="hidden sm:flex flex-col w-52 flex-shrink-0 border-l overflow-y-auto" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--ink-3)' }}>
              {participants.length} participant{participants.length !== 1 ? 's' : ''}
            </p>
          </div>

          {participants.length === 0 ? (
            <p className="p-4 text-sm" style={{ color: 'var(--ink-3)' }}>No one has filled in yet</p>
          ) : (
            <div className="flex flex-col p-2 gap-0.5">
              {participants.map(p => (
                <button
                  key={p.id}
                  onClick={() => setHiddenIds(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })}
                  className="flex items-center gap-2.5 px-2 py-2 rounded-xl text-left transition-colors hover:bg-gray-50 w-full"
                  style={{ opacity: hiddenIds.has(p.id) ? 0.4 : 1 }}
                >
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0 ring-2 ring-white shadow-sm"
                    style={{ background: tierColor(p.color_hue, 3) }}
                  />
                  <span className="text-sm font-medium flex-1 truncate" style={{ color: 'var(--ink)' }}>
                    {p.name}{p.id === myParticipantId ? '' : ''}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0"
                    style={{ background: p.is_submitted ? '#D1FAE5' : 'var(--primary-light)', color: p.is_submitted ? '#065F46' : 'var(--ink-3)' }}
                  >
                    {p.is_submitted ? '✓' : '…'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Tier legend */}
          <div className="mt-auto p-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-3)' }}>Tiers</p>
            <div className="flex flex-col gap-2">
              {([1, 2, 3] as const).map(tier => (
                <div key={tier} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: tierColor(myParticipant?.color_hue ?? 240, tier) }} />
                  <span className="text-xs" style={{ color: 'var(--ink-2)' }}>{TIER_LABELS[tier]}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile legend bottom sheet */}
      {legendOpen && (
        <div className="sm:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLegendOpen(false)} />
          <div className="relative rounded-t-3xl overflow-hidden max-h-[65vh]" style={{ background: 'var(--bg-card)' }}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <p className="font-bold" style={{ color: 'var(--ink)' }}>{participants.length} participant{participants.length !== 1 ? 's' : ''}</p>
              <button onClick={() => setLegendOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--bg)', color: 'var(--ink-2)' }}>×</button>
            </div>
            <div className="overflow-y-auto p-3">
              {participants.map(p => (
                <div key={p.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: tierColor(p.color_hue, 3) }} />
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--ink)' }}>{p.name}{p.id === myParticipantId ? ' (you)' : ''}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: p.is_submitted ? '#D1FAE5' : 'var(--primary-light)', color: p.is_submitted ? '#065F46' : 'var(--ink-3)' }}>
                    {p.is_submitted ? 'Done' : 'Pending'}
                  </span>
                </div>
              ))}
              {isHost && (
                <button onClick={handleLock} disabled={locking} className="mt-4 w-full py-3 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}>
                  {calendar.is_locked ? 'Unlock' : 'Lock submissions'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 rounded-2xl py-1.5 min-w-[170px] overflow-hidden"
            style={{ left: contextMenu.x, top: contextMenu.y, background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            {([1, 2, 3] as const).map(tier => (
              <button key={tier} onClick={() => setBlockTier(contextMenu.blockId, tier)}
                className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors" style={{ background: 'var(--bg-card)' }}>
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: tierColor(myParticipant?.color_hue ?? 240, tier) }} />
                <span style={{ color: 'var(--ink)' }}>{TIER_LABELS[tier]}</span>
              </button>
            ))}
            <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
            <button onClick={() => deleteBlock(contextMenu.blockId)}
              className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-red-50"
              style={{ color: '#EF4444' }}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
