'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Calendar, Participant, Block, TIER_LABELS } from '@/lib/types'
import { saveToHistory } from '@/lib/history'
import { tierColor, hueForIndex } from '@/lib/colors'
import { getTimeSlots, getDateRange, formatTime, formatDate, addThirtyMin, timeToSlotIndex, getTimeBands } from '@/lib/grid'
import ChatPanel from '@/components/ChatPanel'

const GCAL_TOKEN_KEY = 'synkra_gcal_token'

interface GCalToken {
  accessToken: string
  expiresAt: number
}

function getStoredGCalToken(): GCalToken | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(GCAL_TOKEN_KEY)
    if (!raw) return null
    const token = JSON.parse(raw) as GCalToken
    if (Date.now() > token.expiresAt) {
      localStorage.removeItem(GCAL_TOKEN_KEY)
      return null
    }
    return token
  } catch {
    return null
  }
}

interface Props {
  calendar: Calendar
  initialParticipants: Participant[]
  initialBlocks: Block[]
  gcalSuccess?: boolean
}

interface DragState {
  dateIdx: number
  startSlotIdx: number
  endSlotIdx: number
}

type ViewMode = 'all' | 'week' | 'day' | 'month'

const SLOT_HEIGHT = 32
const TIME_COL_WIDTH = 60
const COL_WIDTH = 112

export default function CalendarClient({ calendar, initialParticipants, initialBlocks, gcalSuccess }: Props) {
  const router = useRouter()
  // Feature 2: local cal state so lock/unlock updates without reload
  const [cal, setCal] = useState<Calendar>(calendar)
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants)
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks)
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const [legendOpen, setLegendOpen] = useState(false)
  const [showHint, setShowHint] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ blockId: string; x: number; y: number } | null>(null)
  const [editingLabel, setEditingLabel] = useState<{ blockId: string; value: string } | null>(null)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [locking, setLocking] = useState(false)
  const [chatOpen, setChatOpen] = useState(false) // mobile bottom sheet
  const [sidebarTab, setSidebarTab] = useState<'people' | 'chat' | 'best'>('people') // desktop sidebar
  const [meetingDuration, setMeetingDuration] = useState(60) // minutes
  const [customDuration, setCustomDuration] = useState('') // free-form custom duration input
  const [requiredIds, setRequiredIds] = useState<Set<string>>(new Set()) // must-attend participant IDs
  const [minHeadcount, setMinHeadcount] = useState(1) // minimum free participants
  const [tierThreshold, setTierThreshold] = useState<1|2|3>(2) // min tier counted as a conflict
  const [bestSubTab, setBestSubTab] = useState<'suggestions' | 'advanced'>('suggestions')
  const [editMode, setEditMode] = useState(false)
  const [editingTime, setEditingTime] = useState<{ blockId: string; startTime: string; endTime: string } | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [editingNameTarget, setEditingNameTarget] = useState<string | null>(null)
  // Feature 1: view mode + offset
  const [view, setView] = useState<ViewMode>('all')
  const [viewOffset, setViewOffset] = useState(0)
  // Hide blocked-out days toggle per tab
  const [hideBlockedDays, setHideBlockedDays] = useState<Record<ViewMode, boolean>>({ all: false, month: false, week: false, day: false })
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Undo/redo stacks: each entry = { created: blocks added, removed: blocks that were merged away }
  const undoStack = useRef<Array<{ created: Block[]; removed: Block[] }>>([])
  const redoStack = useRef<Array<{ created: Block[]; removed: Block[] }>>([])
  // Google Calendar integration
  const [gcalToken, setGcalToken] = useState<GCalToken | null>(null)
  const [gcalImporting, setGcalImporting] = useState(false)
  const [gcalImportCount, setGcalImportCount] = useState<number | null>(null)
  const [gcalError, setGcalError] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  // Infinite calendar: number of days to show from start_date
  const [infiniteVisibleDays, setInfiniteVisibleDays] = useState(21)

  function copyCode() {
    navigator.clipboard.writeText(cal.code).then(() => {
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1500)
    }).catch(() => {})
  }

  // For infinite calendars, compute a rolling end date based on how many days are loaded
  const effectiveEndDate = cal.is_infinite
    ? (() => {
        const d = new Date(cal.start_date + 'T00:00:00')
        d.setDate(d.getDate() + infiniteVisibleDays - 1)
        return d.toISOString().slice(0, 10)
      })()
    : cal.end_date

  const allDates = (() => {
    const dates = getDateRange(cal.start_date, effectiveEndDate)
    if (!cal.selected_days_of_week) return dates
    return dates.filter(d => {
      const dow = new Date(d + 'T00:00:00').getDay()
      return cal.selected_days_of_week!.includes(dow)
    })
  })()
  const allDatesRaw = getDateRange(cal.start_date, effectiveEndDate)
  const isActiveDate = (dateStr: string) => {
    if (!cal.selected_days_of_week) return true
    const dow = new Date(dateStr + 'T00:00:00').getDay()
    return cal.selected_days_of_week.includes(dow)
  }

  const slots = getTimeSlots(cal.day_start_time, cal.day_end_time)

  // ── Best-time algorithm ───────────────────────────────────────────────────
  const bestTimes = useMemo(() => {
    // Prefer submitted participants; fall back to everyone
    const pool = participants.filter(p => p.is_submitted)
    const considered = pool.length > 0 ? pool : participants
    if (considered.length === 0 || slots.length === 0) return []

    const effectiveDuration = customDuration ? Math.max(30, Math.round(parseInt(customDuration) / 30) * 30) : meetingDuration
    const slotsPerWindow = Math.max(1, effectiveDuration / 30)
    const effectiveMin = Math.min(minHeadcount, considered.length)

    type Suggestion = { date: string; startTime: string; endTime: string; score: number; freeCount: number; total: number; conflicts: { name: string; tier: 1|2|3 }[] }
    const results: Suggestion[] = []

    for (const date of allDates) {
      for (let i = 0; i <= slots.length - slotsPerWindow; i++) {
        const windowStart = slots[i]
        const windowEnd = addThirtyMin(slots[i + slotsPerWindow - 1])
        let score = 0
        let freeCount = 0
        const conflicts: { name: string; tier: 1|2|3 }[] = []
        let requiredViolation = false

        for (const p of considered) {
          const hit = blocks.filter(b =>
            b.participant_id === p.id &&
            b.date === date &&
            b.start_time < windowEnd &&
            b.end_time > windowStart &&
            b.tier >= tierThreshold
          )
          if (hit.length === 0) {
            freeCount++
          } else {
            const maxTier = Math.max(...hit.map(b => b.tier)) as 1|2|3
            score += maxTier === 3 ? 10 : maxTier === 2 ? 3 : 1
            conflicts.push({ name: p.name, tier: maxTier })
            if (requiredIds.has(p.id)) requiredViolation = true
          }
        }

        // Hard filters: required attendees must be free, minimum headcount must be met
        if (requiredViolation || freeCount < effectiveMin) continue

        results.push({ date, startTime: windowStart, endTime: windowEnd, score, freeCount, total: considered.length, conflicts })
      }
    }

    results.sort((a, b) =>
      a.score - b.score ||
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime)
    )

    // Deduplicate: skip windows that overlap with an already-selected one on the same date
    const picked: Suggestion[] = []
    for (const r of results) {
      if (picked.length >= 5) break
      const overlaps = picked.some(p =>
        p.date === r.date && p.startTime < r.endTime && p.endTime > r.startTime
      )
      if (!overlaps) picked.push(r)
    }
    return picked
  }, [participants, blocks, slots, allDates, meetingDuration, customDuration, requiredIds, minHeadcount, tierThreshold])
  const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2), m = i % 2 === 0 ? '00' : '30'
    const val = `${String(h).padStart(2, '0')}:${m}`
    const label = `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
    return { val, label }
  })

  // Blocked-out dates: days where every visible participant has at least one block
  const blockedOutDates = useMemo(() => {
    const visible = participants.filter(p => !hiddenIds.has(p.id))
    if (visible.length === 0) return new Set<string>()
    return new Set(
      allDatesRaw.filter(date =>
        visible.every(p => blocks.some(b => b.participant_id === p.id && b.date === date))
      )
    )
  }, [participants, hiddenIds, blocks, allDatesRaw])

  // Feature 1: Compute visible dates for the current view
  // week/all use allDatesRaw so non-selected days appear grayed rather than hidden
  const visibleDates = (() => {
    let dates: string[]
    if (view === 'all') dates = allDatesRaw
    else if (view === 'day') {
      const idx = Math.max(0, Math.min(viewOffset, allDates.length - 1))
      dates = allDates.slice(idx, idx + 1)
    } else if (view === 'week') {
      const start = viewOffset * 7
      dates = allDatesRaw.slice(start, start + 7)
    } else {
      // month: all dates (month view renders its own grid)
      dates = allDatesRaw
    }
    if (hideBlockedDays[view]) dates = dates.filter(d => !blockedOutDates.has(d))
    return dates
  })()

  const maxWeekOffset = Math.max(0, Math.ceil(allDatesRaw.length / 7) - 1)
  const maxDayOffset = Math.max(0, allDates.length - 1)

  useEffect(() => {
    const stored = localStorage.getItem(`synkra_${cal.code}`) ?? localStorage.getItem(`flock_${cal.code}`)
    if (!stored) { router.replace(`/join/${cal.code}`); return }
    const { participantId } = JSON.parse(stored)
    setMyParticipantId(participantId)
    setIsHost(cal.host_participant_id === participantId)
    saveToHistory(cal.code, cal.name)
  }, [cal.code, cal.name, cal.host_participant_id, router])

  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 5000)
    return () => clearTimeout(t)
  }, [])

  // Google Calendar: load stored token on mount
  useEffect(() => {
    setGcalToken(getStoredGCalToken())
  }, [])

  // Google Calendar: handle OAuth callback (?gcal=success#gcal_token=...)
  useEffect(() => {
    if (!gcalSuccess) return
    const hash = window.location.hash
    const match = hash.match(/gcal_token=([^&]+)/)
    if (!match) return
    try {
      const payload = JSON.parse(atob(match[1])) as GCalToken
      localStorage.setItem(GCAL_TOKEN_KEY, JSON.stringify(payload))
      setGcalToken(payload)
      // Clean up URL
      const url = new URL(window.location.href)
      url.searchParams.delete('gcal')
      url.hash = ''
      window.history.replaceState({}, '', url.toString())
    } catch {
      // ignore parse errors
    }
  }, [gcalSuccess])

  useEffect(() => {
    // Use a unique suffix per mount so supabase.channel() always creates a fresh
    // RealtimeChannel in 'closed' state. Without this, React Strict Mode's double-invoke
    // causes channel() to return the still-subscribed channel from the first mount, and
    // .subscribe() on an already-joined channel is a silent no-op — killing realtime.
    const s = Math.random().toString(36).slice(2, 7)

    const blocksSub = supabase.channel(`blocks:${cal.id}:${s}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks', filter: `calendar_id=eq.${cal.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const incoming = payload.new as Block
          setBlocks(prev => {
            if (prev.some(b => b.id === incoming.id)) return prev
            const withoutTemp = prev.filter(b =>
              !(b.id.startsWith('temp_') &&
                b.participant_id === incoming.participant_id &&
                b.date === incoming.date &&
                b.start_time === incoming.start_time &&
                b.end_time === incoming.end_time)
            )
            return [...withoutTemp, incoming]
          })
        } else if (payload.eventType === 'UPDATE') {
          setBlocks(prev => prev.map(b => b.id === payload.new.id ? payload.new as Block : b))
        } else if (payload.eventType === 'DELETE') {
          setBlocks(prev => prev.filter(b => b.id !== payload.old.id))
        }
      }).subscribe((status, err) => {
        if (err) console.error('[realtime] blocks error', err)
      })

    const pSub = supabase.channel(`participants:${cal.id}:${s}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `calendar_id=eq.${cal.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const incoming = payload.new as Participant
          setParticipants(prev => prev.some(p => p.id === incoming.id) ? prev : [...prev, incoming])
        } else if (payload.eventType === 'UPDATE') {
          setParticipants(prev => prev.map(p => p.id === payload.new.id ? payload.new as Participant : p))
        } else if (payload.eventType === 'DELETE') {
          setParticipants(prev => prev.filter(p => p.id !== payload.old.id))
        }
      }).subscribe((status, err) => {
        if (err) console.error('[realtime] participants error', err)
      })

    const calSub = supabase.channel(`calendar:${cal.id}:${s}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calendars', filter: `id=eq.${cal.id}` }, (payload) => {
        setCal(payload.new as Calendar)
      }).subscribe((status, err) => {
        if (err) console.error('[realtime] calendar error', err)
      })

    return () => {
      supabase.removeChannel(blocksSub)
      supabase.removeChannel(pSub)
      supabase.removeChannel(calSub)
    }
  }, [cal.id])

  const myParticipant = participants.find(p => p.id === myParticipantId)

  const finalizeDrag = useCallback(async (drag: DragState) => {
    if (!myParticipantId || !myParticipant) return
    const dateStr = visibleDates[drag.dateIdx]
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
    const newBlock = { participant_id: myParticipantId, calendar_id: cal.id, date: dateStr, start_time: mergedStart, end_time: mergedEnd, tier: 2 as const }
    const tempId = `temp_${Date.now()}`
    setBlocks(prev => [...prev, { ...newBlock, id: tempId, created_at: '', updated_at: '' }])
    if (overlapIds.length > 0) await supabase.from('blocks').delete().in('id', overlapIds)
    const { data } = await supabase.from('blocks').insert(newBlock).select().single()
    if (data) {
      setBlocks(prev => prev.map(b => b.id === tempId ? data : b))
      redoStack.current = []
      undoStack.current = undoStack.current.slice(-19).concat({ created: [data as Block], removed: overlapping })
    }
  }, [myParticipantId, myParticipant, visibleDates, slots, blocks, cal.id])

  function handleCellMouseDown(dateIdx: number, slotIdx: number, e: React.MouseEvent) {
    if (cal.is_locked || !myParticipantId) return
    if (!isActiveDate(visibleDates[dateIdx])) return
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

  // ── Touch drag (mobile block creation) ───────────────────────────────────
  // React 18 registers touch listeners as passive, so e.preventDefault() inside
  // onTouchMove is silently ignored. We use a non-passive document listener instead.
  const touchDragRef = useRef<{ dateIdx: number } | null>(null)

  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      if (!touchDragRef.current) return
      e.preventDefault() // blocks scroll & pull-to-refresh while dragging
      const touch = e.touches[0]
      const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
      if (!el) return
      const cell = el.closest('[data-dateidx]') as HTMLElement | null
      if (!cell) return
      const dIdx = parseInt(cell.dataset.dateidx!)
      const sIdx = parseInt(cell.dataset.slotidx!)
      if (dIdx === touchDragRef.current.dateIdx) {
        setDragging(prev => prev ? { ...prev, endSlotIdx: sIdx } : null)
      }
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => document.removeEventListener('touchmove', onTouchMove)
  }, [])

  function handleCellTouchStart(dateIdx: number, slotIdx: number, e: React.TouchEvent) {
    if (cal.is_locked || !myParticipantId) return
    if (!isActiveDate(visibleDates[dateIdx])) return
    e.preventDefault() // stop the initial scroll/pull-to-refresh gesture
    touchDragRef.current = { dateIdx }
    setDragging({ dateIdx, startSlotIdx: slotIdx, endSlotIdx: slotIdx })
  }

  function handleRootTouchEnd() {
    touchDragRef.current = null
    handleMouseUp()
  }

  async function handleBlockClick(block: Block, e: React.MouseEvent) {
    e.stopPropagation()
    if (block.participant_id !== myParticipantId || cal.is_locked) return
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

  const performUndo = useCallback(async () => {
    if (undoStack.current.length === 0) return
    const action = undoStack.current.pop()!
    // Optimistically remove created blocks from local state
    setBlocks(prev => prev.filter(b => !action.created.some(c => c.id === b.id)))
    // Re-insert removed/merged blocks
    const reinserted: Block[] = []
    for (const b of action.removed) {
      const { data } = await supabase.from('blocks').insert({
        participant_id: b.participant_id, calendar_id: b.calendar_id,
        date: b.date, start_time: b.start_time, end_time: b.end_time,
        tier: b.tier, label: b.label ?? null,
      }).select().single()
      if (data) { reinserted.push(data as Block); setBlocks(prev => [...prev, data as Block]) }
    }
    // Delete created blocks from DB
    const realIds = action.created.map(b => b.id).filter(id => !id.startsWith('temp_'))
    if (realIds.length > 0) await supabase.from('blocks').delete().in('id', realIds)
    // Push inverse to redo stack
    redoStack.current.push({ created: reinserted, removed: action.created.filter(b => !b.id.startsWith('temp_')) })
  }, [])

  const performRedo = useCallback(async () => {
    if (redoStack.current.length === 0) return
    const action = redoStack.current.pop()!
    setBlocks(prev => prev.filter(b => !action.created.some(c => c.id === b.id)))
    const reinserted: Block[] = []
    for (const b of action.removed) {
      const { data } = await supabase.from('blocks').insert({
        participant_id: b.participant_id, calendar_id: b.calendar_id,
        date: b.date, start_time: b.start_time, end_time: b.end_time,
        tier: b.tier, label: b.label ?? null,
      }).select().single()
      if (data) { reinserted.push(data as Block); setBlocks(prev => [...prev, data as Block]) }
    }
    const realIds = action.created.map(b => b.id).filter(id => !id.startsWith('temp_'))
    if (realIds.length > 0) await supabase.from('blocks').delete().in('id', realIds)
    undoStack.current.push({ created: reinserted, removed: action.created.filter(b => !b.id.startsWith('temp_')) })
  }, [])

  // Dismiss context menu on scroll (especially useful on mobile where popup doesn't follow scroll)
  useEffect(() => {
    if (!contextMenu) return
    function onScroll() { setContextMenu(null) }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [contextMenu])

  // Undo / redo keyboard shortcuts — declared after performUndo/performRedo to avoid TDZ
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!myParticipantId) return
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); performUndo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); performRedo()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [myParticipantId, performUndo, performRedo])

  // ── Day header: right-click / long-press to block entire day ────────────

  function handleDayHeaderContextMenu(dateStr: string, e: React.MouseEvent) {
    if (cal.is_locked || !myParticipantId || !isActiveDate(dateStr)) return
    e.preventDefault(); e.stopPropagation()
    blockEntireDay(dateStr)
  }

  function handleDayHeaderTouchStart(dateStr: string, e: React.TouchEvent) {
    if (cal.is_locked || !myParticipantId || !isActiveDate(dateStr)) return
    longPressTimer.current = setTimeout(() => blockEntireDay(dateStr), 500)
  }

  async function blockEntireDay(dateStr: string) {
    if (!myParticipantId || !myParticipant) return
    const startTime = cal.day_start_time
    const endTime = cal.day_end_time
    const existing = blocks.filter(b => b.participant_id === myParticipantId && b.date === dateStr)
    const existingIds = existing.map(b => b.id)
    setBlocks(prev => prev.filter(b => !existingIds.includes(b.id)))
    const newBlock = { participant_id: myParticipantId, calendar_id: cal.id, date: dateStr, start_time: startTime, end_time: endTime, tier: 3 as const }
    const tempId = `temp_day_${Date.now()}`
    setBlocks(prev => [...prev, { ...newBlock, id: tempId, created_at: '', updated_at: '' }])
    if (existingIds.length > 0) await supabase.from('blocks').delete().in('id', existingIds)
    const { data } = await supabase.from('blocks').insert(newBlock).select().single()
    if (data) {
      setBlocks(prev => prev.map(b => b.id === tempId ? data : b))
      redoStack.current = []
      undoStack.current = undoStack.current.slice(-19).concat({ created: [data as Block], removed: existing })
    }
  }

  function openLabelEditor(blockId: string) {
    const block = blocks.find(b => b.id === blockId)
    setContextMenu(null)
    setEditingLabel({ blockId, value: block?.label ?? '' })
  }

  function openTimeEditor(blockId: string) {
    const block = blocks.find(b => b.id === blockId)
    if (!block) return
    setContextMenu(null)
    setEditingTime({ blockId, startTime: block.start_time, endTime: block.end_time })
  }

  async function saveTime() {
    if (!editingTime) return
    const { blockId, startTime, endTime } = editingTime
    if (startTime >= endTime) return
    setEditingTime(null)
    const block = blocks.find(b => b.id === blockId)
    if (!block) return
    // Merge any other blocks from the same participant/date that now overlap
    const overlapping = blocks.filter(b =>
      b.id !== blockId &&
      b.participant_id === block.participant_id &&
      b.date === block.date &&
      b.start_time < endTime &&
      b.end_time > startTime
    )
    let mergedStart = startTime, mergedEnd = endTime
    for (const b of overlapping) {
      if (b.start_time < mergedStart) mergedStart = b.start_time
      if (b.end_time > mergedEnd) mergedEnd = b.end_time
    }
    const overlapIds = overlapping.map(b => b.id)
    setBlocks(prev => prev.filter(b => !overlapIds.includes(b.id)).map(b => b.id === blockId ? { ...b, start_time: mergedStart, end_time: mergedEnd } : b))
    if (overlapIds.length > 0) await supabase.from('blocks').delete().in('id', overlapIds)
    await supabase.from('blocks').update({ start_time: mergedStart, end_time: mergedEnd, updated_at: new Date().toISOString() }).eq('id', blockId)
  }

  async function saveParticipantName() {
    const targetId = editingNameTarget ?? myParticipantId
    if (!targetId || !nameInput.trim()) return
    const trimmed = nameInput.trim()
    setParticipants(prev => prev.map(p => p.id === targetId ? { ...p, name: trimmed } : p))
    setEditingName(false)
    setEditingNameTarget(null)
    await supabase.from('participants').update({ name: trimmed }).eq('id', targetId)
  }

  async function saveLabel(overrideValue?: string) {
    if (!editingLabel) return
    const { blockId } = editingLabel
    const label = (overrideValue !== undefined ? overrideValue : editingLabel.value).trim() || null
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, label } : b))
    setEditingLabel(null)
    await supabase.from('blocks').update({ label, updated_at: new Date().toISOString() }).eq('id', blockId)
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
    // Feature 2: No reload — Realtime subscription on 'calendars' will update cal state
    await supabase.from('calendars').update({ is_locked: !cal.is_locked }).eq('id', cal.id)
    setLocking(false)
  }

  // ── Google Calendar integration ───────────────────────────────────────────

  function handleConnectGCal() {
    window.location.href = `/api/auth/google?code=${cal.code}`
  }

  function handleDisconnectGCal() {
    localStorage.removeItem(GCAL_TOKEN_KEY)
    setGcalToken(null)
    setGcalImportCount(null)
    setGcalError(null)
  }

  async function handleImportGCal() {
    if (!gcalToken || !myParticipantId || !myParticipant) return
    setGcalImporting(true)
    setGcalError(null)

    try {
      const params = new URLSearchParams({
        accessToken: gcalToken.accessToken,
        startDate: cal.start_date,
        endDate: effectiveEndDate,
      })
      const res = await fetch(`/api/gcal/events?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setGcalError(body.error ?? 'Failed to fetch events')
        setGcalImporting(false)
        return
      }

      const { events } = await res.json() as {
        events: Array<{
          id: string
          summary?: string
          start: { dateTime: string }
          end: { dateTime: string }
        }>
      }

      const dayStart = cal.day_start_time
      const dayEnd = cal.day_end_time

      type BlockCandidate = { date: string; start_time: string; end_time: string }
      const candidates: BlockCandidate[] = []

      function roundDownTo30(t: string) {
        const [h, m] = t.split(':').map(Number)
        const rounded = Math.floor(m / 30) * 30
        return `${String(h).padStart(2, '0')}:${String(rounded).padStart(2, '0')}`
      }
      function roundUpTo30(t: string) {
        const [h, m] = t.split(':').map(Number)
        if (m === 0 || m === 30) return t
        const addMin = m < 30 ? 30 - m : 60 - m
        const total = h * 60 + m + addMin
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
      }

      for (const ev of events) {
        const startDt = new Date(ev.start.dateTime)
        const endDt = new Date(ev.end.dateTime)
        const dateStr = startDt.toLocaleDateString('en-CA')

        if (!allDates.includes(dateStr)) continue

        const evStart = startDt.toTimeString().slice(0, 5)
        const evEnd = endDt.toTimeString().slice(0, 5)

        const clampedStart = evStart < dayStart ? dayStart : evStart > dayEnd ? dayEnd : evStart
        const clampedEnd = evEnd < dayStart ? dayStart : evEnd > dayEnd ? dayEnd : evEnd

        if (clampedStart >= clampedEnd) continue

        const slotStart = roundDownTo30(clampedStart)
        const slotEnd = roundUpTo30(clampedEnd)

        if (slotStart >= slotEnd) continue

        candidates.push({ date: dateStr, start_time: slotStart, end_time: slotEnd })
      }

      if (candidates.length === 0) {
        setGcalImportCount(0)
        setGcalImporting(false)
        return
      }

      const byDate = new Map<string, BlockCandidate[]>()
      for (const c of candidates) {
        if (!byDate.has(c.date)) byDate.set(c.date, [])
        byDate.get(c.date)!.push(c)
      }

      let totalImported = 0

      for (const [date, dayCandidates] of byDate) {
        dayCandidates.sort((a, b) => a.start_time.localeCompare(b.start_time))

        const merged: BlockCandidate[] = []
        for (const c of dayCandidates) {
          if (merged.length === 0 || c.start_time > merged[merged.length - 1].end_time) {
            merged.push({ ...c })
          } else {
            if (c.end_time > merged[merged.length - 1].end_time) {
              merged[merged.length - 1].end_time = c.end_time
            }
          }
        }

        for (const m of merged) {
          const currentBlocks = blocks
          const overlapping = currentBlocks.filter(b =>
            b.participant_id === myParticipantId && b.date === date &&
            b.start_time < m.end_time && b.end_time > m.start_time
          )
          let mergedStart = m.start_time
          let mergedEnd = m.end_time
          for (const b of overlapping) {
            if (b.start_time < mergedStart) mergedStart = b.start_time
            if (b.end_time > mergedEnd) mergedEnd = b.end_time
          }

          const overlapIds = overlapping.map(b => b.id)
          if (overlapIds.length > 0) {
            setBlocks(prev => prev.filter(b => !overlapIds.includes(b.id)))
            await supabase.from('blocks').delete().in('id', overlapIds)
          }

          const newBlock = {
            participant_id: myParticipantId,
            calendar_id: cal.id,
            date,
            start_time: mergedStart,
            end_time: mergedEnd,
            tier: 3 as const,
          }
          const tempId = `temp_gcal_${Date.now()}_${Math.random()}`
          setBlocks(prev => [...prev, { ...newBlock, id: tempId, created_at: '', updated_at: '' }])
          const { data } = await supabase.from('blocks').insert(newBlock).select().single()
          if (data) setBlocks(prev => prev.map(b => b.id === tempId ? data : b))
          totalImported++
        }
      }

      setGcalImportCount(totalImported)
    } catch (err) {
      setGcalError('Something went wrong importing events')
      console.error('GCal import error:', err)
    } finally {
      setGcalImporting(false)
    }
  }

  // Feature 3: renderBlocks now shows participant name at top of each block
  function renderBlocks(dateStr: string) {
    const dateBlocks = blocks.filter(b => b.date === dateStr && !hiddenIds.has(b.participant_id) && participants.find(p => p.id === b.participant_id) && (!editMode || b.participant_id === myParticipantId))
    const rendered = new Set<string>()
    return dateBlocks.map(block => {
      if (rendered.has(block.id)) return null
      rendered.add(block.id)
      const participant = participants.find(p => p.id === block.participant_id)
      if (!participant) return null
      const startIdx = Math.max(0, timeToSlotIndex(block.start_time, slots))
      const endIdx = Math.min(slots.length, timeToSlotIndex(block.end_time, slots))
      const heightSlots = Math.max(1, endIdx - startIdx)
      const color = tierColor(participant.color_hue, block.tier)
      const isOwn = block.participant_id === myParticipantId && !cal.is_locked
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
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 7, paddingTop: 4, paddingRight: 4, overflow: 'hidden',
            boxShadow: isOwn ? `0 1px 4px ${color}55` : 'none',
            pointerEvents: 'auto',
          }}
          onClick={e => isOwn ? handleBlockClick(block, e) : undefined}
          onContextMenu={e => (isOwn || isHost) ? handleBlockContextMenu(block.id, e) : e.preventDefault()}
          onTouchStart={e => (isOwn || isHost) ? handleBlockTouchStart(block.id, e) : undefined}
          onTouchEnd={handleBlockTouchEnd}
        >
          {/* Participant name — tiny, uppercase, slightly transparent */}
          {heightSlots >= 1 && (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(0,0,0,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%', letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1.4 }}>
              {participant.name}
            </span>
          )}
          {heightSlots >= 1 && block.label && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.72)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%', letterSpacing: '0.01em', lineHeight: 1.3 }}>
              {block.label}
            </span>
          )}
          {heightSlots >= 2 && (
            <span style={{ fontSize: 9, fontWeight: 500, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap', letterSpacing: '0.01em', lineHeight: 1.3 }}>
              {formatTime(block.start_time)}–{formatTime(block.end_time)}
            </span>
          )}
          {heightSlots >= 3 && (
            <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(0,0,0,0.38)', whiteSpace: 'nowrap', letterSpacing: '0.01em', marginTop: 1 }}>
              {TIER_LABELS[block.tier]}
            </span>
          )}
        </div>
      )
    })
  }

  function renderTimeBands() {
    const bands = getTimeBands(slots)
    const bandColors: Record<string, string> = {
      night:   'rgba(99,102,241,0.07)',
      morning: 'rgba(251,191,36,0.08)',
      daytime: 'rgba(34,197,94,0.06)',
      evening: 'rgba(249,115,22,0.08)',
    }
    return bands.map(band => (
      <div
        key={band.label}
        style={{
          position: 'absolute',
          top: band.startSlot * SLOT_HEIGHT,
          left: 0, right: 0,
          height: (band.endSlot - band.startSlot) * SLOT_HEIGHT,
          background: bandColors[band.label],
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
    ))
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

  const isWeekend = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.getDay() === 0 || d.getDay() === 6
  }

  // ── Feature 1: Month view helpers ──────────────────────────────────────────

  function getMonthViewWeeks(): string[][] {
    if (allDates.length === 0) return []
    const firstDate = new Date(allDates[0] + 'T00:00:00')
    const lastDate = new Date(allDates[allDates.length - 1] + 'T00:00:00')

    // Start from the Sunday of the week containing firstDate
    const weekStart = new Date(firstDate)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())

    // End at the Saturday of the week containing lastDate
    const weekEnd = new Date(lastDate)
    weekEnd.setDate(weekEnd.getDate() + (6 - weekEnd.getDay()))

    const weeks: string[][] = []
    const cur = new Date(weekStart)
    while (cur <= weekEnd) {
      const week: string[] = []
      for (let i = 0; i < 7; i++) {
        week.push(cur.toISOString().slice(0, 10))
        cur.setDate(cur.getDate() + 1)
      }
      weeks.push(week)
    }
    return weeks
  }

  function getDayParticipants(dateStr: string): Participant[] {
    const dateBlocks = blocks.filter(b => b.date === dateStr && !hiddenIds.has(b.participant_id))
    const pIds = new Set(dateBlocks.map(b => b.participant_id))
    return participants.filter(p => pIds.has(p.id))
  }

  // Feature 1 + 4: Month view with participant dots
  function renderMonthView() {
    const weeks = getMonthViewWeeks()
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const allDateSet = new Set(allDates)

    return (
      <div className="flex-1 overflow-auto p-3 sm:p-5" style={{ background: 'var(--bg)' }}>
        {/* Day of week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
          {dayLabels.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 0' }}>
              {d}
            </div>
          ))}
        </div>
        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
            {week.map(dateStr => {
              const inRange = allDateSet.has(dateStr)
              const isBlocked = inRange && blockedOutDates.has(dateStr)
              const hiddenByFilter = hideBlockedDays.month && isBlocked
              const effectiveInRange = inRange && !hiddenByFilter
              const d = new Date(dateStr + 'T00:00:00')
              const dayNum = d.getDate()
              const isToday = dateStr === new Date().toISOString().slice(0, 10)
              const activeParts = effectiveInRange ? getDayParticipants(dateStr) : []
              const allBusy = effectiveInRange && participants.length > 0 && activeParts.length === participants.length

              return (
                <div
                  key={dateStr}
                  onClick={() => {
                    if (!effectiveInRange) return
                    const idx = allDates.indexOf(dateStr)
                    setViewOffset(idx)
                    setView('day')
                  }}
                  onMouseEnter={e => { if (effectiveInRange) (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)' }}
                  onMouseLeave={e => { if (effectiveInRange) (e.currentTarget as HTMLElement).style.borderColor = allBusy ? 'var(--primary)' : isToday ? 'var(--primary)' : 'var(--border)' }}
                  style={{
                    minHeight: 72,
                    borderRadius: 12,
                    border: `1.5px solid ${!effectiveInRange ? 'transparent' : allBusy || isToday ? 'var(--primary)' : 'var(--border)'}`,
                    background: !effectiveInRange ? 'transparent' : isToday ? 'var(--primary-light)' : 'var(--bg-card)',
                    padding: '8px 10px',
                    cursor: effectiveInRange ? 'pointer' : 'default',
                    opacity: effectiveInRange ? 1 : 0.2,
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: effectiveInRange ? 700 : 400, color: isToday ? 'var(--primary)' : effectiveInRange ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {dayNum}
                    </span>
                    {allBusy && effectiveInRange && (
                      <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--primary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>ALL</span>
                    )}
                  </div>
                  {effectiveInRange && activeParts.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {activeParts.map(p => (
                        <div
                          key={p.id}
                          title={p.name}
                          style={{ width: 8, height: 8, borderRadius: '50%', background: tierColor(p.color_hue, 2), flexShrink: 0 }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  // ── Feature 1: Grid view (all / week / day) ────────────────────────────────

  function renderGridView() {
    // For day/week views, fill the width; for all view, use fixed column widths + scroll
    const fillWidth = view === 'day' || view === 'week'
    return (
      <div className="flex-1 overflow-auto grid-scroll">
        <div style={fillWidth ? { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' } : { minWidth: TIME_COL_WIDTH + visibleDates.length * COL_WIDTH }}>
          {/* Column headers */}
          <div className="flex sticky top-0 z-20 border-b flex-shrink-0" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, borderColor: 'var(--border)', position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 2 }} className="flex-shrink-0 border-r" />
            {visibleDates.map(dateStr => {
              const { short, day } = formatDate(dateStr)
              const weekend = isWeekend(dateStr)
              const active = isActiveDate(dateStr)
              return (
                <div
                  key={dateStr}
                  className="text-center py-2.5 border-r select-none"
                  style={{
                    ...(fillWidth ? { flex: 1, minWidth: 0 } : { width: COL_WIDTH, flexShrink: 0 }),
                    borderColor: 'var(--border)',
                    background: !active ? 'var(--bg)' : weekend ? 'var(--primary-light)' : 'var(--bg-card)',
                    opacity: active ? 1 : 0.4,
                    cursor: active && myParticipantId && !cal.is_locked ? 'context-menu' : 'default',
                  }}
                  onContextMenu={e => handleDayHeaderContextMenu(dateStr, e)}
                  onTouchStart={e => handleDayHeaderTouchStart(dateStr, e)}
                  onTouchEnd={handleBlockTouchEnd}
                >
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: weekend ? 'var(--primary)' : 'var(--ink-2)' }}>
                    {fillWidth && view === 'day' ? day : short}
                  </span>
                </div>
              )
            })}
            {cal.is_infinite && !fillWidth && (
              <div className="flex-shrink-0 border-r" style={{ width: 80, borderColor: 'var(--border)', background: 'var(--bg)' }} />
            )}
          </div>

          {/* Body */}
          <div className={fillWidth ? 'flex flex-1' : 'flex'}>
            {/* Time column — sticky left so it stays visible when scrolling horizontally */}
            <div style={{ width: TIME_COL_WIDTH, minWidth: TIME_COL_WIDTH, borderColor: 'var(--border)', position: 'sticky', left: 0, zIndex: 10, background: 'var(--bg)' }} className="flex-shrink-0 border-r">
              {slots.map((slot, slotIdx) => (
                <div key={slot} style={{ height: SLOT_HEIGHT, position: 'relative' }}>
                  {slot.endsWith(':00') && (
                    <span style={{
                      position: 'absolute',
                      right: 8,
                      top: slotIdx === 0 ? 3 : 0,
                      transform: slotIdx === 0 ? 'none' : 'translateY(-50%)',
                      fontSize: 11,
                      color: 'var(--ink-2)',
                      fontWeight: 700,
                      letterSpacing: '0.01em',
                      whiteSpace: 'nowrap',
                      lineHeight: 1,
                    }}>{formatTime(slot)}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {visibleDates.map((dateStr, dateIdx) => {
              const weekend = isWeekend(dateStr)
              const active = isActiveDate(dateStr)
              return (
                <div
                  key={dateStr}
                  className="relative border-r"
                  style={{
                    ...(fillWidth ? { flex: 1, minWidth: 0 } : { width: COL_WIDTH, flexShrink: 0 }),
                    borderColor: 'var(--border)',
                    background: !active ? 'var(--bg)' : weekend ? 'var(--primary-light)' : 'var(--bg-card)',
                    opacity: active ? 1 : 0.45,
                  }}
                >
                  {slots.map((slot, slotIdx) => (
                    <div
                      key={slot}
                      data-dateidx={dateIdx}
                      data-slotidx={slotIdx}
                      style={{
                        height: SLOT_HEIGHT,
                        borderTop: slotIdx > 0 && slot.endsWith(':00') ? '1px solid var(--border)' : 'none',
                        cursor: active ? 'crosshair' : 'default',
                        touchAction: active ? 'none' : 'auto',
                      }}
                      onMouseDown={active ? e => handleCellMouseDown(dateIdx, slotIdx, e) : undefined}
                      onMouseEnter={active ? () => handleCellMouseEnter(dateIdx, slotIdx) : undefined}
                      onTouchStart={active ? e => handleCellTouchStart(dateIdx, slotIdx, e) : undefined}
                    />
                  ))}
                  {/* Overlays */}
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    <div style={{ position: 'relative', height: slots.length * SLOT_HEIGHT, pointerEvents: 'none' }}>
                      {renderTimeBands()}
                      {active && renderBlocks(dateStr)}
                      {active && renderDragPreview(dateIdx)}
                    </div>
                  </div>
                </div>
              )
            })}
            {/* Infinite: load more column */}
            {cal.is_infinite && !fillWidth && (
              <div
                className="flex-shrink-0 flex items-center justify-center border-r"
                style={{ width: 80, borderColor: 'var(--border)', background: 'var(--bg)' }}
              >
                <button
                  onClick={() => setInfiniteVisibleDays(d => d + 14)}
                  className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl transition-colors text-center"
                  style={{ color: 'var(--ink-3)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--primary)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--ink-3)' }}
                >
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 16 16">
                    <path d="M8 3v10M3 8l5 5 5-5"/>
                  </svg>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1.3 }}>2 more<br/>weeks</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Feature 1: Navigation label ───────────────────────────────────────────

  function getNavLabel(): string {
    if (view === 'day' && visibleDates.length > 0) {
      return formatDate(visibleDates[0]).day
    }
    if (view === 'week' && visibleDates.length > 0) {
      const first = formatDate(visibleDates[0]).short
      const last = formatDate(visibleDates[visibleDates.length - 1]).short
      return `${first} – ${last}`
    }
    return ''
  }


  return (
    <div
      className="flex flex-col overflow-hidden no-select"
      style={{ background: 'var(--bg)', height: '100dvh' }}
      onMouseUp={handleMouseUp}
      onTouchEnd={handleRootTouchEnd}
      onClick={() => setContextMenu(null)}
    >
      {/* Header */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-3 sm:px-5 py-2.5 border-b gap-2"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        {/* Left: logo + title */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <a
            href="/"
            className="flex items-center gap-1.5 flex-shrink-0 group min-w-[44px] min-h-[44px]"
          >
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-opacity group-hover:opacity-80"
              style={{ background: 'var(--primary)' }}
            >
              <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
                <path d="M2 6.5 C4 4.5, 6 8.5, 9 6.5 C12 4.5, 14 8.5, 16 6.5" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6"/>
                <path d="M2 11.5 C4 9.5, 6 13.5, 9 11.5 C12 9.5, 14 13.5, 16 11.5" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/>
              </svg>
            </div>
            <span className="font-black text-base tracking-tight hidden sm:block" style={{ color: 'var(--primary)', fontFamily: 'var(--font-jakarta)' }}>synkra</span>
          </a>
          <span className="hidden sm:block flex-shrink-0" style={{ color: 'var(--border)', fontSize: 16, lineHeight: 1 }}>·</span>
          <h1 className="font-semibold text-sm truncate hidden sm:block" style={{ color: 'var(--ink)' }}>{cal.name}</h1>
          <button
            onClick={copyCode}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono font-bold tracking-widest transition-all flex-shrink-0"
            style={{
              background: codeCopied ? 'var(--primary)' : 'var(--primary-light)',
              color: codeCopied ? 'white' : 'var(--primary)',
              cursor: 'pointer',
            }}
            title="Click to copy code"
          >
            {codeCopied ? 'Copied!' : cal.code}
            {!codeCopied && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            )}
          </button>
          {cal.is_locked && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
              Locked
            </span>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-1 justify-end">
          {isHost && (
            <button
              onClick={handleLock}
              disabled={locking}
              className="hidden sm:block text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors"
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-card)')}
              style={{ borderColor: 'var(--border)', color: 'var(--ink-2)', background: 'var(--bg-card)' }}
            >
              {cal.is_locked ? 'Unlock' : 'Lock'}
            </button>
          )}
          <button
            onClick={handleDone}
            disabled={submitting || cal.is_locked}
            className="text-xs font-bold px-3 py-2.5 rounded-lg transition-all min-h-[44px]"
            style={{
              background: myParticipant?.is_submitted ? 'var(--ink)' : 'var(--primary)',
              color: myParticipant?.is_submitted ? 'var(--bg)' : 'var(--primary-foreground)',
              opacity: submitting || cal.is_locked ? 0.5 : 1,
            }}
          >
            {myParticipant?.is_submitted ? 'Edit' : 'Done'}
          </button>
          {/* Chat toggle */}
          <button
            onClick={() => { setChatOpen(o => !o); setSidebarTab(t => t === 'chat' ? 'people' : 'chat') }}
            className="flex items-center justify-center w-11 h-11 rounded-lg border transition-colors"
            style={{
              borderColor: sidebarTab === 'chat' ? 'var(--primary)' : 'var(--border)',
              color: sidebarTab === 'chat' ? 'var(--primary)' : 'var(--ink-2)',
              background: sidebarTab === 'chat' ? 'var(--primary-light)' : 'var(--bg-card)',
            }}
            aria-label="Toggle chat"
            title="Chat"
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button
            onClick={() => setLegendOpen(o => !o)}
            className="sm:hidden flex items-center gap-1 text-xs font-semibold px-2.5 py-2.5 rounded-lg border min-h-[44px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-2)', background: 'var(--bg-card)' }}
          >
            {participants.length}
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <circle cx="9" cy="7" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
              <circle cx="17" cy="7" r="3"/><path d="M21 20c0-1.7-.7-3.2-1.9-4.3"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Lock banner */}
      {cal.is_locked && (
        <div className="flex-shrink-0 text-xs font-medium text-center py-2 px-4" style={{ background: 'var(--primary-light)', color: 'var(--primary)', borderBottom: '1px solid var(--border)' }}>
          This calendar is locked. Submissions are closed.
        </div>
      )}

      {/* View toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 sm:px-4 py-1.5 sm:py-2 border-b gap-1" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        {/* Nav arrows (left) */}
        <div className="flex items-center gap-0.5 sm:gap-1 min-w-0 flex-1">
          {(view === 'week' || view === 'day') && (
            <>
              <button
                onClick={() => setViewOffset(o => Math.max(0, o - 1))}
                disabled={viewOffset === 0}
                className="w-11 h-11 rounded-lg flex items-center justify-center"
                onMouseEnter={e => { if (viewOffset > 0) (e.currentTarget as HTMLElement).style.background = 'var(--bg)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                style={{ color: viewOffset > 0 ? 'var(--ink)' : 'var(--ink-3)', opacity: viewOffset > 0 ? 1 : 0.4, cursor: viewOffset > 0 ? 'pointer' : 'default' }}
                aria-label="Previous"
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12"><path d="M8 2L4 6l4 4"/></svg>
              </button>
              <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{getNavLabel()}</span>
              <button
                onClick={() => {
                  const atEdge = view === 'week' ? viewOffset >= maxWeekOffset : viewOffset >= maxDayOffset
                  if (cal.is_infinite && atEdge) {
                    setInfiniteVisibleDays(d => d + 14)
                  }
                  setViewOffset(o => view === 'week' ? o + 1 : o + 1)
                }}
                disabled={!cal.is_infinite && (view === 'week' ? viewOffset >= maxWeekOffset : viewOffset >= maxDayOffset)}
                className="w-11 h-11 rounded-lg flex items-center justify-center"
                onMouseEnter={e => { const canNext = cal.is_infinite || (view === 'week' ? viewOffset < maxWeekOffset : viewOffset < maxDayOffset); if (canNext) (e.currentTarget as HTMLElement).style.background = 'var(--bg)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                style={{ color: (cal.is_infinite || (view === 'week' ? viewOffset < maxWeekOffset : viewOffset < maxDayOffset)) ? 'var(--ink)' : 'var(--ink-3)', opacity: (cal.is_infinite || (view === 'week' ? viewOffset < maxWeekOffset : viewOffset < maxDayOffset)) ? 1 : 0.4 }}
                aria-label="Next"
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4"/></svg>
              </button>
            </>
          )}
        </div>
        {/* View tabs (center) */}
        <div className="flex items-center rounded-xl overflow-hidden border flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
          {(['all', 'month', 'week', 'day'] as ViewMode[]).map((v, i, arr) => (
            <button
              key={v}
              onClick={() => { setView(v); setViewOffset(0) }}
              className="text-xs font-semibold px-2 sm:px-3 py-2 sm:py-2.5 transition-all min-h-[40px] sm:min-h-[44px]"
              style={{
                background: view === v ? 'var(--primary)' : 'var(--bg-card)',
                color: view === v ? 'white' : 'var(--ink-2)',
                borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span className="hidden sm:inline">{{ all: 'All', month: 'Month', week: 'Week', day: 'Day' }[v]}</span>
              <span className="sm:hidden">{{ all: 'All', month: 'Mo', week: 'Wk', day: 'Day' }[v]}</span>
            </button>
          ))}
        </div>
        {/* Right: hide-blocked toggle + edit mode toggle */}
        <div className="flex items-center justify-end gap-1 sm:gap-1.5 flex-1">
          <button
            onClick={() => setHideBlockedDays(prev => ({ ...prev, [view]: !prev[view] }))}
            className="flex items-center justify-center w-11 h-11 rounded-lg border transition-all"
            title={hideBlockedDays[view] ? 'Show all days' : 'Hide fully-blocked days'}
            style={{
              background: hideBlockedDays[view] ? 'var(--primary)' : 'var(--bg-card)',
              borderColor: hideBlockedDays[view] ? 'var(--primary)' : 'var(--border)',
              color: hideBlockedDays[view] ? 'white' : 'var(--ink-2)',
            }}
          >
            {hideBlockedDays[view] ? (
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
          {myParticipantId && (
            <button
              onClick={() => setEditMode(o => !o)}
              className="text-xs font-semibold px-2.5 py-2.5 rounded-lg border transition-all min-h-[44px]"
              style={{
                background: editMode ? 'var(--primary)' : 'var(--bg-card)',
                color: editMode ? 'white' : 'var(--ink-2)',
                borderColor: editMode ? 'var(--primary)' : 'var(--border)',
              }}
              title={editMode ? 'Show everyone\'s schedule' : 'Focus on your schedule only'}
            >
              {editMode ? 'Edit' : 'View'}
            </button>
          )}
        </div>
      </div>

      {/* Hint */}
      {showHint && !cal.is_locked && myParticipant && (
        <div className="flex-shrink-0 flex flex-wrap items-center justify-center gap-2 text-sm font-medium text-white px-4 py-2"
          style={{ background: 'var(--ink)' }}>
          <span className="text-center">Drag to mark when you&apos;re <strong>not</strong> free</span>
          <button onClick={() => setShowHint(false)} className="text-white/50 hover:text-white text-base leading-none min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0">×</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Feature 1: Main content area — month view or grid view */}
        {view === 'month' ? renderMonthView() : renderGridView()}

        {/* Legend sidebar */}
        <aside className="hidden sm:flex flex-col w-80 flex-shrink-0 border-l" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          {/* Tabs */}
          <div className="flex border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
            {(['people', 'best', 'chat'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSidebarTab(tab)}
                className="flex-1 py-2.5 text-xs font-semibold transition-colors"
                style={{
                  color: sidebarTab === tab ? 'var(--primary)' : 'var(--ink-3)',
                  borderBottom: sidebarTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                  background: 'transparent',
                }}
              >
                {tab === 'people' ? `People (${participants.length})` : tab === 'best' ? '✦ Best' : 'Chat'}
              </button>
            ))}
          </div>

          {/* Chat tab */}
          {sidebarTab === 'chat' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <ChatPanel
                calendarId={cal.id}
                participantId={myParticipantId}
                participants={participants}
                onClose={() => setSidebarTab('people')}
              />
            </div>
          )}

          {/* Best times tab */}
          {sidebarTab === 'best' && (
            <div className="flex flex-col flex-1 overflow-hidden">

              {/* Duration — always visible */}
              <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--ink-2)' }}>Duration</span>
                <div className="flex rounded-lg overflow-hidden border ml-auto" style={{ borderColor: 'var(--border)' }}>
                  {[30, 60, 90, 120].map((d, idx, arr) => (
                    <button key={d} onClick={() => { setMeetingDuration(d); setCustomDuration('') }}
                      className="px-2.5 py-1 text-xs font-semibold transition-all"
                      style={{ background: meetingDuration === d && !customDuration ? 'var(--primary)' : 'var(--bg-card)', color: meetingDuration === d && !customDuration ? 'white' : 'var(--ink-2)', borderRight: idx < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      {d < 60 ? `${d}m` : `${d / 60}h`}
                    </button>
                  ))}
                </div>
                <input type="number" min="15" max="480" placeholder="min" value={customDuration}
                  onChange={e => setCustomDuration(e.target.value)}
                  className="w-14 text-xs text-center rounded-lg border px-1 py-1"
                  style={{ borderColor: customDuration ? 'var(--primary)' : 'var(--border)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }} />
              </div>

              {/* Sub-tabs */}
              <div className="flex-shrink-0 flex border-b" style={{ borderColor: 'var(--border)' }}>
                {(['suggestions', 'advanced'] as const).map(t => (
                  <button key={t} onClick={() => setBestSubTab(t)}
                    className="flex-1 py-2 text-xs font-semibold transition-colors"
                    style={{ color: bestSubTab === t ? 'var(--primary)' : 'var(--ink-3)', borderBottom: bestSubTab === t ? '2px solid var(--primary)' : '2px solid transparent', background: 'transparent' }}>
                    {t === 'suggestions' ? 'Suggestions' : 'Advanced settings'}
                  </button>
                ))}
              </div>

              {/* Suggestions tab */}
              {bestSubTab === 'suggestions' && (
                <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-2">
                  {participants.length === 0 && <p className="text-sm p-2" style={{ color: 'var(--ink-3)' }}>No participants yet.</p>}
                  {participants.length > 0 && bestTimes.length === 0 && <p className="text-sm p-2" style={{ color: 'var(--ink-3)' }}>No windows match your criteria.</p>}
                  {bestTimes.map((s, i) => {
                    const allFree = s.freeCount === s.total
                    const { day } = formatDate(s.date)
                    const tierColors: Record<1|2|3, string> = { 1: '#F59E0B', 2: '#8B5CF6', 3: '#EF4444' }
                    return (
                      <div key={`${s.date}-${s.startTime}`} className="rounded-xl p-3 border"
                        style={{ background: i === 0 ? 'var(--primary-light)' : 'var(--bg)', borderColor: i === 0 ? 'var(--primary)' : 'var(--border)' }}>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div>
                            {i === 0 && <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--primary)' }}>Best</span>}
                            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{day}</p>
                            <p className="text-xs" style={{ color: 'var(--ink-2)' }}>{formatTime(s.startTime)} – {formatTime(s.endTime)}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className="text-lg font-black leading-none" style={{ color: allFree ? '#10B981' : 'var(--ink)' }}>
                              {s.freeCount}<span className="text-xs font-semibold">/{s.total}</span>
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--ink-3)' }}>free</p>
                          </div>
                        </div>
                        {s.conflicts.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {s.conflicts.map(c => (
                              <span key={c.name} className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                                style={{ background: `${tierColors[c.tier]}22`, color: tierColors[c.tier] }}>
                                {c.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {bestTimes.length > 0 && (
                    <p className="text-[10px] text-center mt-1" style={{ color: 'var(--ink-3)' }}>
                      {participants.filter(p => p.is_submitted).length === 0 ? 'Based on all (none submitted yet)' : `Based on ${participants.filter(p => p.is_submitted).length} submitted`}
                    </p>
                  )}
                </div>
              )}

              {/* Advanced settings tab */}
              {bestSubTab === 'advanced' && (
                <div className="overflow-y-auto flex-1">
                  {/* Tier threshold */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--ink-2)' }}>Count as busy</span>
                    <div className="flex rounded-lg overflow-hidden border ml-auto" style={{ borderColor: 'var(--border)' }}>
                      {([1, 2, 3] as const).map((t, idx, arr) => (
                        <button key={t} onClick={() => setTierThreshold(t)}
                          className="px-2.5 py-1.5 text-xs font-semibold transition-all"
                          style={{ background: tierThreshold === t ? 'var(--primary)' : 'var(--bg-card)', color: tierThreshold === t ? 'white' : 'var(--ink-2)', borderRight: idx < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          {t === 1 ? 'Any' : t === 2 ? 'Very+' : "Can't"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Min headcount */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--ink-2)' }}>Min free</span>
                    <div className="flex items-center gap-2 ml-auto">
                      <button onClick={() => setMinHeadcount(n => Math.max(1, n - 1))} className="w-7 h-7 rounded-lg flex items-center justify-center text-base font-bold transition-colors" style={{ background: 'var(--bg)', color: 'var(--ink-2)' }}>−</button>
                      <span className="text-sm font-bold w-5 text-center" style={{ color: 'var(--ink)' }}>{minHeadcount}</span>
                      <button onClick={() => setMinHeadcount(n => Math.min(participants.length, n + 1))} className="w-7 h-7 rounded-lg flex items-center justify-center text-base font-bold transition-colors" style={{ background: 'var(--bg)', color: 'var(--ink-2)' }}>+</button>
                      <span className="text-xs" style={{ color: 'var(--ink-3)' }}>of {participants.length}</span>
                    </div>
                  </div>

                  {/* Required attendees */}
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold mb-2.5" style={{ color: 'var(--ink-2)' }}>Must attend</p>
                    {participants.length === 0
                      ? <p className="text-xs" style={{ color: 'var(--ink-3)' }}>No participants yet.</p>
                      : <div className="flex flex-wrap gap-1.5">
                          {participants.map(p => {
                            const req = requiredIds.has(p.id)
                            return (
                              <button key={p.id} onClick={() => setRequiredIds(prev => { const n = new Set(prev); req ? n.delete(p.id) : n.add(p.id); return n })}
                                className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all"
                                style={{ borderColor: req ? 'var(--primary)' : 'var(--border)', background: req ? 'var(--primary-light)' : 'var(--bg)', color: req ? 'var(--primary)' : 'var(--ink-2)' }}>
                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tierColor(p.color_hue, 3) }} />
                                {p.name}
                              </button>
                            )
                          })}
                        </div>
                    }
                  </div>
                </div>
              )}
            </div>
          )}

          {/* People tab */}
          {sidebarTab === 'people' && (<>
          <div className="overflow-y-auto flex-1">
          {/* Share code */}
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Share code</span>
            <button
              onClick={copyCode}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold tracking-widest transition-all"
              style={{
                background: codeCopied ? 'var(--primary)' : 'var(--bg)',
                color: codeCopied ? 'white' : 'var(--primary)',
                border: `1.5px solid ${codeCopied ? 'var(--primary)' : 'var(--border)'}`,
              }}
              title="Click to copy"
            >
              {codeCopied ? 'Copied!' : cal.code}
              {!codeCopied && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              )}
            </button>
          </div>
          {participants.length === 0 ? (
            <p className="p-4 text-sm" style={{ color: 'var(--ink-3)' }}>No one has filled in yet</p>
          ) : (
            <div className="flex flex-col p-2 gap-0.5">
              {participants.map(p => {
                const isMe = p.id === myParticipantId
                return (
                  <div key={p.id} className="flex items-center gap-0.5">
                    <button
                      onClick={() => setHiddenIds(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-xl text-left transition-colors flex-1 min-w-0"
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      style={{ opacity: hiddenIds.has(p.id) ? 0.4 : 1 }}
                    >
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0 shadow-sm"
                        style={{ background: tierColor(p.color_hue, 3), outline: '2px solid var(--bg-card)', outlineOffset: 1 }}
                      />
                      <span className="text-sm font-medium flex-1 truncate" style={{ color: 'var(--ink)' }}>
                        {p.name}{isMe ? ' (you)' : ''}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0"
                        style={{ background: p.is_submitted ? 'rgba(16,185,129,0.15)' : 'var(--primary-light)', color: p.is_submitted ? '#10B981' : 'var(--ink-3)' }}
                      >
                        {p.is_submitted ? '✓' : '…'}
                      </span>
                    </button>
                    {(isMe || isHost) && (
                      <button
                        onClick={() => { setNameInput(p.name); setEditingNameTarget(p.id); setEditingName(true) }}
                        className="p-1.5 rounded-lg flex-shrink-0 transition-colors"
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        title={isMe ? 'Edit your name' : `Rename ${p.name}`}
                        style={{ color: 'var(--ink-3)' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 9.5V12h2.5L11 4.5 8.5 2 1 9.5z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
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

          {/* Google Calendar integration */}
          {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
            <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-3)' }}>Google Calendar</p>
              {gcalToken ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#10B981' }} />
                    <span className="text-xs" style={{ color: 'var(--ink-2)' }}>Connected</span>
                  </div>
                  {gcalImportCount !== null && (
                    <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                      {gcalImportCount === 0 ? 'No events found' : `${gcalImportCount} block${gcalImportCount !== 1 ? 's' : ''} imported`}
                    </p>
                  )}
                  {gcalError && (
                    <p className="text-xs" style={{ color: '#EF4444' }}>{gcalError}</p>
                  )}
                  <button
                    onClick={handleImportGCal}
                    disabled={gcalImporting || !myParticipantId}
                    className="w-full text-xs font-semibold py-1.5 rounded-lg transition-colors"
                    style={{
                      background: 'var(--primary)', color: 'white',
                      opacity: gcalImporting || !myParticipantId ? 0.6 : 1,
                    }}
                  >
                    {gcalImporting ? 'Importing…' : 'Import busy times'}
                  </button>
                  <button
                    onClick={handleDisconnectGCal}
                    className="w-full text-xs font-medium py-1.5 rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink-3)', background: 'transparent' }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectGCal}
                  className="w-full text-xs font-semibold py-1.5 rounded-lg border flex items-center justify-center gap-1.5 transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  style={{ borderColor: 'var(--border)', color: 'var(--ink-2)', background: 'transparent' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Connect Google Calendar
                </button>
              )}
            </div>
          )}
          </div>
          </>)}
        </aside>
      </div>

      {/* Mobile chat bottom sheet */}
      {chatOpen && (
        <div className="sm:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setChatOpen(false)} />
          <div className="relative rounded-t-3xl overflow-hidden" style={{ background: 'var(--bg-card)', height: '70vh' }}>
            {/* Drag handle */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full z-10" style={{ background: 'var(--border)' }} />
            <ChatPanel
              calendarId={cal.id}
              participantId={myParticipantId}
              participants={participants}
              onClose={() => setChatOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Mobile legend bottom sheet */}
      {legendOpen && (
        <div className="sm:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLegendOpen(false)} />
          <div className="relative rounded-t-3xl overflow-hidden max-h-[65vh]" style={{ background: 'var(--bg-card)' }}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <p className="font-bold" style={{ color: 'var(--ink)' }}>{participants.length} participant{participants.length !== 1 ? 's' : ''}</p>
              <button onClick={() => setLegendOpen(false)} className="w-11 h-11 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--bg)', color: 'var(--ink-2)' }}>×</button>
            </div>
            <div className="overflow-y-auto p-3">
              {/* Share code — mobile */}
              <div className="flex items-center gap-2 pb-3 mb-1 border-b" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Share code</span>
                <button
                  onClick={copyCode}
                  className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold tracking-widest transition-all"
                  style={{
                    background: codeCopied ? 'var(--primary)' : 'var(--bg)',
                    color: codeCopied ? 'white' : 'var(--primary)',
                    border: `1.5px solid ${codeCopied ? 'var(--primary)' : 'var(--border)'}`,
                  }}
                >
                  {codeCopied ? 'Copied!' : cal.code}
                  {!codeCopied && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  )}
                </button>
              </div>
              {participants.map(p => (
                <div key={p.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: tierColor(p.color_hue, 3) }} />
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--ink)' }}>{p.name}{p.id === myParticipantId ? ' (you)' : ''}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: p.is_submitted ? 'rgba(16,185,129,0.15)' : 'var(--primary-light)', color: p.is_submitted ? '#10B981' : 'var(--ink-3)' }}>
                    {p.is_submitted ? 'Done' : 'Pending'}
                  </span>
                </div>
              ))}
              {isHost && (
                <button onClick={handleLock} disabled={locking} className="mt-4 w-full py-3 rounded-xl text-sm font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}>
                  {cal.is_locked ? 'Unlock' : 'Lock submissions'}
                </button>
              )}
              {/* Google Calendar — mobile */}
              {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--ink-3)' }}>Google Calendar</p>
                  {gcalToken ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#10B981' }} />
                        <span className="text-sm" style={{ color: 'var(--ink-2)' }}>Connected</span>
                      </div>
                      {gcalImportCount !== null && (
                        <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
                          {gcalImportCount === 0 ? 'No events found' : `${gcalImportCount} block${gcalImportCount !== 1 ? 's' : ''} imported`}
                        </p>
                      )}
                      {gcalError && (
                        <p className="text-sm" style={{ color: '#EF4444' }}>{gcalError}</p>
                      )}
                      <button
                        onClick={() => { handleImportGCal(); setLegendOpen(false) }}
                        disabled={gcalImporting || !myParticipantId}
                        className="w-full py-2.5 rounded-xl text-sm font-semibold"
                        style={{ background: 'var(--primary)', color: 'white', opacity: gcalImporting || !myParticipantId ? 0.6 : 1 }}
                      >
                        {gcalImporting ? 'Importing…' : 'Import busy times'}
                      </button>
                      <button
                        onClick={handleDisconnectGCal}
                        className="w-full py-2.5 rounded-xl text-sm font-medium border"
                        style={{ borderColor: 'var(--border)', color: 'var(--ink-3)' }}
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { handleConnectGCal(); setLegendOpen(false) }}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      Connect Google Calendar
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (() => {
        const ctxBlock = blocks.find(b => b.id === contextMenu.blockId)
        const ctxIsOwn = ctxBlock?.participant_id === myParticipantId
        // Auto-flip: estimate menu height, flip vertically/horizontally as needed
        const menuW = 200
        const estimatedH = ctxIsOwn ? 340 : 60
        const vw = typeof window !== 'undefined' ? window.innerWidth : 800
        const vh = typeof window !== 'undefined' ? window.innerHeight : 600
        const spaceBelow = vh - contextMenu.y
        const spaceAbove = contextMenu.y
        const flipV = spaceBelow < estimatedH && spaceAbove > spaceBelow
        const flipH = contextMenu.x + menuW + 8 > vw
        const menuTop = flipV ? Math.max(8, contextMenu.y - estimatedH) : contextMenu.y
        const menuLeft = flipH ? Math.max(8, contextMenu.x - menuW) : Math.min(contextMenu.x, vw - menuW - 8)
        return (
          <>
            {/* Transparent overlay — pointer-events:none so scrolling is not blocked on desktop */}
            <div className="fixed inset-0 z-50" style={{ pointerEvents: 'none' }} />
            {/* Invisible click-catcher that doesn't block scroll */}
            <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null) }} style={{ background: 'transparent' }} />
            <div
              className="fixed z-50 rounded-2xl py-1.5 min-w-[190px]"
              style={{
                left: Math.max(8, menuLeft), top: Math.max(8, menuTop),
                maxHeight: 'min(80dvh, 360px)', overflowY: 'auto',
                background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border)',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Own-block controls */}
              {ctxIsOwn && (<>
                <button onClick={() => openLabelEditor(contextMenu.blockId)}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-2)', flexShrink: 0 }}>
                    <path d="M1 9.5V12h2.5L11 4.5 8.5 2 1 9.5z"/>
                  </svg>
                  <span style={{ color: 'var(--ink)' }}>{ctxBlock?.label ? 'Edit label' : 'Add label'}</span>
                </button>
                <button onClick={() => openTimeEditor(contextMenu.blockId)}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-2)', flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                  </svg>
                  <span style={{ color: 'var(--ink)' }}>Edit time</span>
                </button>
                <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
                <p className="px-4 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--ink-3)' }}>Busy level</p>
                {([1, 2, 3] as const).map(tier => (
                  <button key={tier} onClick={() => setBlockTier(contextMenu.blockId, tier)}
                    className="w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 transition-colors"
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: tierColor(myParticipant?.color_hue ?? 240, tier) }} />
                    <span style={{ color: 'var(--ink)' }}>{TIER_LABELS[tier]}</span>
                    {ctxBlock?.tier === tier && (
                      <svg className="ml-auto" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round"><path d="M2 6l3 3 5-5"/></svg>
                    )}
                  </button>
                ))}
                <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
              </>)}
              {/* Delete — available to block owner OR host */}
              <button onClick={() => deleteBlock(contextMenu.blockId)}
                className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors"
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                style={{ color: '#EF4444' }}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M2 3.5h9M4.5 3.5V2h4v1.5M5 6v4M8 6v4M3 3.5l.5 7h6l.5-7"/>
                </svg>
                Delete block
              </button>
            </div>
          </>
        )
      })()}

      {/* Label editor */}
      {editingLabel && (
        <>
          <div className="fixed inset-0 z-50 bg-black/20" onClick={() => saveLabel()} />
          <div
            className="fixed z-50 rounded-2xl overflow-hidden"
            style={{
              left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              background: 'var(--bg-card)', boxShadow: '0 16px 48px rgba(0,0,0,0.22)',
              border: '1px solid var(--border)', width: 280,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Label this block</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>What are you doing during this time?</p>
            </div>
            <div className="p-4">
              <input
                autoFocus
                type="text"
                value={editingLabel.value}
                onChange={e => setEditingLabel(prev => prev ? { ...prev, value: e.target.value } : null)}
                onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditingLabel(null) }}
                placeholder="e.g. Doctor's appointment, Gym…"
                maxLength={60}
                className="w-full px-3 py-2.5 text-sm rounded-xl focus:outline-none"
                style={{ background: 'var(--bg)', border: '1.5px solid var(--border)', color: 'var(--ink)' }}
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => saveLabel()}
                  className="flex-1 py-2 text-sm font-semibold rounded-xl text-white"
                  style={{ background: 'var(--primary)' }}
                >
                  Save
                </button>
                {editingLabel.value && (
                  <button
                    onClick={() => saveLabel('')}
                    className="px-3 py-2 text-sm rounded-xl border"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink-3)' }}
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setEditingLabel(null)}
                  className="px-3 py-2 text-sm rounded-xl border"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink-3)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Time editor modal */}
      {editingTime && (
        <>
          <div className="fixed inset-0 z-50 bg-black/20" onClick={() => setEditingTime(null)} />
          <div
            className="fixed z-50 rounded-2xl overflow-hidden"
            style={{
              left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              background: 'var(--bg-card)', boxShadow: '0 16px 48px rgba(0,0,0,0.22)',
              border: '1px solid var(--border)', width: 300,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Edit time</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>Adjust start and end times for this block</p>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <select
                  value={editingTime.startTime}
                  onChange={e => setEditingTime(prev => prev ? { ...prev, startTime: e.target.value } : null)}
                  className="flex-1 px-3 py-2 text-sm rounded-xl"
                  style={{ background: 'var(--bg)', border: '1.5px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
                >
                  {timeOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                </select>
                <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--ink-3)' }}>to</span>
                <select
                  value={editingTime.endTime}
                  onChange={e => setEditingTime(prev => prev ? { ...prev, endTime: e.target.value } : null)}
                  className="flex-1 px-3 py-2 text-sm rounded-xl"
                  style={{ background: 'var(--bg)', border: '1.5px solid var(--border)', color: 'var(--ink)', outline: 'none' }}
                >
                  {timeOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                </select>
              </div>
              {editingTime.startTime >= editingTime.endTime && (
                <p className="text-xs" style={{ color: '#EF4444' }}>End time must be after start time</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={saveTime}
                  disabled={editingTime.startTime >= editingTime.endTime}
                  className="flex-1 py-2 text-sm font-semibold rounded-xl text-white"
                  style={{ background: editingTime.startTime >= editingTime.endTime ? 'var(--ink-3)' : 'var(--primary)' }}
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingTime(null)}
                  className="px-3 py-2 text-sm rounded-xl border"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink-3)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Name editor modal */}
      {editingName && (() => {
        const targetP = participants.find(p => p.id === (editingNameTarget ?? myParticipantId))
        const isRenamingOther = editingNameTarget && editingNameTarget !== myParticipantId
        return (
          <>
            <div className="fixed inset-0 z-50 bg-black/20" onClick={() => { setEditingName(false); setEditingNameTarget(null) }} />
            <div
              className="fixed z-50 rounded-2xl overflow-hidden"
              style={{
                left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                background: 'var(--bg-card)', boxShadow: '0 16px 48px rgba(0,0,0,0.22)',
                border: '1px solid var(--border)', width: 280,
              }}
              onClick={e => e.stopPropagation()}
            >
              <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {isRenamingOther ? `Rename ${targetP?.name ?? 'participant'}` : 'Edit your name'}
                </p>
              </div>
              <div className="p-4">
                <input
                  autoFocus
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveParticipantName(); if (e.key === 'Escape') { setEditingName(false); setEditingNameTarget(null) } }}
                  placeholder={isRenamingOther ? `${targetP?.name ?? 'Name'}` : 'Your name'}
                  maxLength={40}
                  className="w-full px-3 py-2.5 text-sm rounded-xl focus:outline-none"
                  style={{ background: 'var(--bg)', border: '1.5px solid var(--border)', color: 'var(--ink)' }}
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={saveParticipantName}
                    disabled={!nameInput.trim()}
                    className="flex-1 py-2 text-sm font-semibold rounded-xl text-white"
                    style={{ background: nameInput.trim() ? 'var(--primary)' : 'var(--ink-3)' }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingName(false); setEditingNameTarget(null) }}
                    className="px-3 py-2 text-sm rounded-xl border"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink-3)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
