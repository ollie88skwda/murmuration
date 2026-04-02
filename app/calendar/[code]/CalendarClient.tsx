'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Calendar, Participant, Block, TIER_LABELS } from '@/lib/types'
import { tierColor, hueForIndex } from '@/lib/colors'
import { getTimeSlots, getDateRange, formatTime, formatDate, addThirtyMin } from '@/lib/grid'

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

  const gridRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dates = getDateRange(calendar.start_date, calendar.end_date)
  const slots = getTimeSlots(calendar.day_start_time, calendar.day_end_time)

  // Load identity from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`flock_${calendar.code}`)
    if (!stored) { router.replace(`/join/${calendar.code}`); return }
    const { participantId } = JSON.parse(stored)
    setMyParticipantId(participantId)
    setIsHost(calendar.host_participant_id === participantId)
  }, [calendar.code, calendar.host_participant_id, router])

  // Dismiss hint after first block placed or 5s
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 5000)
    return () => clearTimeout(t)
  }, [])

  // Realtime subscriptions
  useEffect(() => {
    const blocksSub = supabase
      .channel(`blocks:${calendar.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks', filter: `calendar_id=eq.${calendar.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setBlocks(prev => [...prev, payload.new as Block])
          } else if (payload.eventType === 'UPDATE') {
            setBlocks(prev => prev.map(b => b.id === payload.new.id ? payload.new as Block : b))
          } else if (payload.eventType === 'DELETE') {
            setBlocks(prev => prev.filter(b => b.id !== payload.old.id))
          }
        }
      )
      .subscribe()

    const participantsSub = supabase
      .channel(`participants:${calendar.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `calendar_id=eq.${calendar.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setParticipants(prev => [...prev, payload.new as Participant])
          } else if (payload.eventType === 'UPDATE') {
            setParticipants(prev => prev.map(p => p.id === payload.new.id ? payload.new as Participant : p))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(blocksSub)
      supabase.removeChannel(participantsSub)
    }
  }, [calendar.id])

  const myParticipant = participants.find(p => p.id === myParticipantId)

  // Get block at a specific cell (for my blocks only)
  function getMyBlockAt(dateStr: string, slotTime: string): Block | undefined {
    return blocks.find(b =>
      b.participant_id === myParticipantId &&
      b.date === dateStr &&
      b.start_time <= slotTime &&
      b.end_time > slotTime
    )
  }

  // All blocks at a cell (for rendering)
  function getBlocksAt(dateStr: string, slotTime: string): (Block & { participant: Participant })[] {
    return blocks
      .filter(b => b.date === dateStr && b.start_time <= slotTime && b.end_time > slotTime)
      .filter(b => !hiddenIds.has(b.participant_id))
      .map(b => ({ ...b, participant: participants.find(p => p.id === b.participant_id)! }))
      .filter(b => b.participant)
  }

  // Finalize drag → create/extend a block
  const finalizeDrag = useCallback(async (drag: DragState) => {
    if (!myParticipantId || !myParticipant) return
    const dateStr = dates[drag.dateIdx]
    const minSlot = Math.min(drag.startSlotIdx, drag.endSlotIdx)
    const maxSlot = Math.max(drag.startSlotIdx, drag.endSlotIdx)
    const startTime = slots[minSlot]
    const endTime = addThirtyMin(slots[maxSlot])

    setShowHint(false)

    // Check for existing block that overlaps this range → delete it and merge, or just create
    const overlapping = blocks.filter(b =>
      b.participant_id === myParticipantId &&
      b.date === dateStr &&
      b.start_time < endTime &&
      b.end_time > startTime
    )

    // Calculate merged range
    let mergedStart = startTime
    let mergedEnd = endTime
    for (const b of overlapping) {
      if (b.start_time < mergedStart) mergedStart = b.start_time
      if (b.end_time > mergedEnd) mergedEnd = b.end_time
    }

    // Optimistic update — remove overlapping, add merged
    const overlapIds = overlapping.map(b => b.id)
    setBlocks(prev => prev.filter(b => !overlapIds.includes(b.id)))

    const newBlock: Omit<Block, 'id' | 'created_at' | 'updated_at'> = {
      participant_id: myParticipantId,
      calendar_id: calendar.id,
      date: dateStr,
      start_time: mergedStart,
      end_time: mergedEnd,
      tier: 2,
    }

    // Optimistic local state
    const tempId = `temp_${Date.now()}`
    setBlocks(prev => [...prev, { ...newBlock, id: tempId, created_at: '', updated_at: '' }])

    // Delete overlapping from DB, insert new
    if (overlapIds.length > 0) {
      await supabase.from('blocks').delete().in('id', overlapIds)
    }
    const { data } = await supabase.from('blocks').insert(newBlock).select().single()
    if (data) {
      setBlocks(prev => prev.map(b => b.id === tempId ? data : b))
    }
  }, [myParticipantId, myParticipant, dates, slots, blocks, calendar.id])

  // Mouse drag handlers
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
    if (dragging) {
      finalizeDrag(dragging)
      setDragging(null)
    }
  }

  // Click on own block → cycle tier
  async function handleBlockClick(block: Block, e: React.MouseEvent) {
    e.stopPropagation()
    if (block.participant_id !== myParticipantId || calendar.is_locked) return
    const nextTier = (block.tier % 3 + 1) as 1 | 2 | 3
    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, tier: nextTier } : b))
    await supabase.from('blocks').update({ tier: nextTier, updated_at: new Date().toISOString() }).eq('id', block.id)
  }

  // Right-click / long-press on own block → context menu
  function handleBlockContextMenu(blockId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
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
    const newLocked = !calendar.is_locked
    await supabase.from('calendars').update({ is_locked: newLocked }).eq('id', calendar.id)
    window.location.reload()
  }

  const SLOT_HEIGHT = 32 // px per 30-min slot
  const TIME_COL_WIDTH = 64 // px

  // Render blocks as absolute overlays per column
  function renderBlocksForDateColumn(dateStr: string, colIndex: number) {
    // Group visible blocks for this date
    const dateBlocks = blocks.filter(b =>
      b.date === dateStr &&
      !hiddenIds.has(b.participant_id) &&
      participants.find(p => p.id === b.participant_id)
    )

    // Dedupe to one render per block (not per slot)
    const rendered = new Set<string>()
    return dateBlocks.map(block => {
      if (rendered.has(block.id)) return null
      rendered.add(block.id)

      const participant = participants.find(p => p.id === block.participant_id)
      if (!participant) return null

      const startSlotIdx = slots.indexOf(block.start_time)
      const endSlotIdx = slots.indexOf(block.end_time)
      const startIdx = startSlotIdx >= 0 ? startSlotIdx : 0
      const endIdx = endSlotIdx >= 0 ? endSlotIdx : slots.length
      const heightSlots = Math.max(1, endIdx - startIdx)

      const color = tierColor(participant.color_hue, block.tier)
      const isOwn = block.participant_id === myParticipantId && !calendar.is_locked

      return (
        <div
          key={block.id}
          style={{
            position: 'absolute',
            top: startIdx * SLOT_HEIGHT,
            left: 2,
            right: 2,
            height: heightSlots * SLOT_HEIGHT - 2,
            backgroundColor: color,
            opacity: block.participant_id === myParticipantId ? 1 : 0.85,
            mixBlendMode: 'multiply',
            borderRadius: 6,
            cursor: isOwn ? 'pointer' : 'default',
            zIndex: block.participant_id === myParticipantId ? 2 : 1,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 6,
            overflow: 'hidden',
          }}
          onClick={e => isOwn ? handleBlockClick(block, e) : undefined}
          onContextMenu={e => isOwn ? handleBlockContextMenu(block.id, e) : e.preventDefault()}
          onTouchStart={e => isOwn ? handleBlockTouchStart(block.id, e) : undefined}
          onTouchEnd={handleBlockTouchEnd}
        >
          {heightSlots >= 2 && (
            <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.6)', whiteSpace: 'nowrap' }}>
              {TIER_LABELS[block.tier]}
            </span>
          )}
        </div>
      )
    })
  }

  // Drag preview overlay
  function renderDragPreview(dateIdx: number) {
    if (!dragging || dragging.dateIdx !== dateIdx || !myParticipant) return null
    const minSlot = Math.min(dragging.startSlotIdx, dragging.endSlotIdx)
    const maxSlot = Math.max(dragging.startSlotIdx, dragging.endSlotIdx)
    const color = tierColor(myParticipant.color_hue, 2)
    return (
      <div style={{
        position: 'absolute',
        top: minSlot * SLOT_HEIGHT,
        left: 2,
        right: 2,
        height: (maxSlot - minSlot + 1) * SLOT_HEIGHT - 2,
        backgroundColor: color,
        opacity: 0.7,
        borderRadius: 6,
        zIndex: 10,
        pointerEvents: 'none',
        border: `2px solid ${color}`,
      }} />
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" onMouseUp={handleMouseUp} onClick={() => setContextMenu(null)}>
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 bg-white border-b border-indigo-100 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="text-indigo-500 font-bold text-lg flex-shrink-0" style={{ fontFamily: 'var(--font-jakarta)' }}>flock</a>
          <span className="text-gray-300 hidden sm:block">|</span>
          <h1 className="font-semibold text-[#1a1635] truncate hidden sm:block">{calendar.name}</h1>
          {calendar.is_locked && (
            <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0">Locked</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isHost && (
            <button
              onClick={handleLock}
              disabled={locking}
              className="text-sm border border-gray-200 text-gray-600 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors hidden sm:block"
            >
              {calendar.is_locked ? 'Unlock Submissions' : 'Close Submissions'}
            </button>
          )}
          <button
            onClick={handleDone}
            disabled={submitting || calendar.is_locked}
            className="bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-200 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
          >
            {myParticipant?.is_submitted ? 'Edit' : 'Done'}
          </button>
          {/* Mobile legend toggle */}
          <button
            onClick={() => setLegendOpen(o => !o)}
            className="sm:hidden border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm"
          >
            {participants.length} 👥
          </button>
        </div>
      </header>

      {/* Locked banner */}
      {calendar.is_locked && (
        <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-700 text-center">
          This calendar is locked. Submissions are closed.
        </div>
      )}

      {/* First-time hint */}
      {showHint && !calendar.is_locked && myParticipant && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-[#1a1635] text-white text-sm px-4 py-2 rounded-xl shadow-lg flex items-center gap-3">
          <span>Drag to mark when you&apos;re <strong>NOT</strong> free</span>
          <button onClick={() => setShowHint(false)} className="text-white/60 hover:text-white">×</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Grid */}
        <div className="flex-1 overflow-auto grid-scroll no-select" ref={gridRef}>
          <div style={{ minWidth: TIME_COL_WIDTH + dates.length * 120 }}>
            {/* Column headers */}
            <div className="flex sticky top-0 bg-white z-20 border-b border-gray-200">
              <div style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH }} className="flex-shrink-0 border-r border-gray-200" />
              {dates.map((dateStr, i) => {
                const { short } = formatDate(dateStr)
                return (
                  <div
                    key={dateStr}
                    className="flex-shrink-0 text-center text-xs font-semibold text-[#5b5780] py-2 border-r border-gray-100"
                    style={{ width: 120 }}
                  >
                    {short}
                  </div>
                )
              })}
            </div>

            {/* Grid body */}
            <div className="flex">
              {/* Time labels */}
              <div style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH }} className="flex-shrink-0 border-r border-gray-200">
                {slots.map((slot, i) => (
                  <div
                    key={slot}
                    style={{ height: SLOT_HEIGHT }}
                    className="flex items-start justify-end pr-2 pt-0.5"
                  >
                    {slot.endsWith(':00') && (
                      <span className="text-[10px] text-gray-400 font-medium">{formatTime(slot)}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {dates.map((dateStr, dateIdx) => (
                <div
                  key={dateStr}
                  className="flex-shrink-0 relative border-r border-gray-100"
                  style={{ width: 120 }}
                >
                  {/* Slot rows (interaction targets) */}
                  {slots.map((slot, slotIdx) => (
                    <div
                      key={slot}
                      style={{ height: SLOT_HEIGHT }}
                      className={`border-b ${slot.endsWith(':00') ? 'border-gray-200' : 'border-gray-100'} cursor-crosshair`}
                      onMouseDown={e => handleCellMouseDown(dateIdx, slotIdx, e)}
                      onMouseEnter={() => handleCellMouseEnter(dateIdx, slotIdx)}
                    />
                  ))}

                  {/* Block overlays — pointer-events auto so clicks hit blocks */}
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    <div style={{ position: 'relative', height: slots.length * SLOT_HEIGHT, pointerEvents: 'auto' }}>
                      {renderBlocksForDateColumn(dateStr, dateIdx)}
                      {renderDragPreview(dateIdx)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend — desktop sidebar */}
        <aside className="hidden sm:flex flex-col w-56 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
          <div className="p-4 border-b border-gray-100">
            <p className="text-xs font-semibold text-[#5b5780] uppercase tracking-wider">
              {participants.length} participant{participants.length !== 1 ? 's' : ''}
            </p>
          </div>
          {participants.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No one has filled in yet</p>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {participants.map(p => (
                <div key={p.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50">
                  <button
                    onClick={() => setHiddenIds(prev => {
                      const next = new Set(prev)
                      if (next.has(p.id)) next.delete(p.id); else next.add(p.id)
                      return next
                    })}
                    style={{ opacity: hiddenIds.has(p.id) ? 0.3 : 1 }}
                    className="w-4 h-4 rounded-full flex-shrink-0 ring-1 ring-black/10"
                    title={hiddenIds.has(p.id) ? 'Show' : 'Hide'}
                    aria-label={hiddenIds.has(p.id) ? `Show ${p.name}` : `Hide ${p.name}`}
                    // The swatch IS the toggle
                  >
                    <span
                      className="block w-full h-full rounded-full"
                      style={{ backgroundColor: tierColor(p.color_hue, 3) }}
                    />
                  </button>
                  <span className="text-sm text-[#1a1635] truncate flex-1">{p.name}{p.id === myParticipantId ? ' (you)' : ''}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${p.is_submitted ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {p.is_submitted ? 'Done' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Tier legend */}
          <div className="mt-auto p-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-[#5b5780] uppercase tracking-wider mb-2">Legend</p>
            <div className="flex flex-col gap-1.5">
              {([1, 2, 3] as const).map(tier => (
                <div key={tier} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: tierColor(myParticipant?.color_hue ?? 0, tier) }} />
                  <span className="text-xs text-gray-500">{TIER_LABELS[tier]}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile legend bottom sheet */}
      {legendOpen && (
        <div className="sm:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setLegendOpen(false)} />
          <div className="relative bg-white rounded-t-2xl p-4 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-[#1a1635]">{participants.length} participant{participants.length !== 1 ? 's' : ''}</p>
              <button onClick={() => setLegendOpen(false)} className="text-gray-400 text-xl">×</button>
            </div>
            {participants.map(p => (
              <div key={p.id} className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
                <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: tierColor(p.color_hue, 3) }} />
                <span className="text-sm text-[#1a1635] flex-1">{p.name}{p.id === myParticipantId ? ' (you)' : ''}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.is_submitted ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {p.is_submitted ? 'Done' : 'Pending'}
                </span>
              </div>
            ))}
            {isHost && (
              <button
                onClick={handleLock}
                disabled={locking}
                className="mt-4 w-full border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium"
              >
                {calendar.is_locked ? 'Unlock Submissions' : 'Close Submissions'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
          >
            {([1, 2, 3] as const).map(tier => (
              <button
                key={tier}
                onClick={() => setBlockTier(contextMenu.blockId, tier)}
                className="w-full text-left px-4 py-2 text-sm text-[#1a1635] hover:bg-indigo-50 flex items-center gap-2"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tierColor(myParticipant?.color_hue ?? 0, tier) }}
                />
                {TIER_LABELS[tier]}
              </button>
            ))}
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => deleteBlock(contextMenu.blockId)}
              className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
