// Generate 30-min slots between two HH:MM times
export function getTimeSlots(startTime: string, endTime: string): string[] {
  const slots: string[] = []
  const [startH, startM] = startTime.split(':').map(Number)
  const [endH, endM] = endTime.split(':').map(Number)
  let h = startH
  let m = startM
  while (h * 60 + m < endH * 60 + endM) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    m += 30
    if (m >= 60) { m -= 60; h++ }
  }
  return slots
}

// Convert HH:MM time string to a slot index (fractional, relative to slots[0])
// Does NOT rely on indexOf — safe even when time falls outside the slots array.
export function timeToSlotIndex(time: string, slots: string[]): number {
  if (slots.length === 0) return 0
  const [h, m] = time.split(':').map(Number)
  const [sh, sm] = slots[0].split(':').map(Number)
  return ((h * 60 + m) - (sh * 60 + sm)) / 30
}

// Generate all dates between start and end (inclusive)
export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const d = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export function formatDate(dateStr: string): { short: string; day: string } {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return {
    short: `${days[d.getDay()]} ${d.getDate()}`,
    day: `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`,
  }
}

// Add 30 mins to HH:MM
export function addThirtyMin(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + 30
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Time-of-day band definitions for the grid background
export interface TimeBand {
  label: 'night' | 'morning' | 'daytime' | 'evening'
  startSlot: number  // inclusive, relative to slots[0]
  endSlot: number    // exclusive
}

const BAND_DEFS = [
  { label: 'night'   as const, start:  0, end: 360  },  // 00:00–06:00
  { label: 'morning' as const, start: 360, end: 720  },  // 06:00–12:00
  { label: 'daytime' as const, start: 720, end: 1080 },  // 12:00–18:00
  { label: 'evening' as const, start: 1080, end: 1440 }, // 18:00–24:00
]

export function getTimeBands(slots: string[]): TimeBand[] {
  if (slots.length === 0) return []
  const [sh, sm] = slots[0].split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin = startMin + slots.length * 30

  const bands: TimeBand[] = []
  for (const def of BAND_DEFS) {
    const overlapStart = Math.max(def.start, startMin)
    const overlapEnd   = Math.min(def.end,   endMin)
    if (overlapEnd <= overlapStart) continue
    bands.push({
      label: def.label,
      startSlot: (overlapStart - startMin) / 30,
      endSlot:   (overlapEnd   - startMin) / 30,
    })
  }
  return bands
}
