# Money Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Split" tab to the Synkra calendar view that lets users input a total cost, mark which participants attended which tournament days, and see each person's proportional share.

**Architecture:** Two new Supabase tables (`splits`, `split_attendance`) store cost and per-person-per-day attendance. A `SplitTab` component renders inside the existing `CalendarClient` behind a top-level Calendar/Split tab bar. All state is owned by `SplitTab` with a Supabase realtime subscription on `split_attendance` so collaborative toggles update live.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase JS v2, Tailwind v4, Stitch MCP (UI design)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `lib/types.ts` | Add `Split`, `SplitAttendance` types |
| Modify | `app/calendar/[code]/CalendarClient.tsx` | Add `activeTab` state + tab bar UI + conditional render |
| Create | `app/calendar/[code]/SplitTab.tsx` | All split UI: data fetching, cost input, attendance grid, results |

---

## Task 1: DB Schema

**Files:**
- No local files — run SQL in Supabase SQL editor

- [ ] **Step 1: Create `splits` table**

Open the Supabase project → SQL Editor → New query. Run:

```sql
create table splits (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars(id) on delete cascade,
  total_cost numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint splits_calendar_id_unique unique (calendar_id)
);
```

- [ ] **Step 2: Create `split_attendance` table**

```sql
create table split_attendance (
  id uuid primary key default gen_random_uuid(),
  split_id uuid not null references splits(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  date date not null,
  constraint split_attendance_unique unique (split_id, participant_id, date)
);
```

- [ ] **Step 3: Enable realtime on `split_attendance`**

```sql
alter publication supabase_realtime add table split_attendance;
```

- [ ] **Step 4: Verify**

In Supabase Table Editor, confirm both tables exist with the correct columns and constraints.

---

## Task 2: TypeScript Types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add Split and SplitAttendance interfaces**

Open `lib/types.ts`. Append after the last existing export:

```typescript
export interface Split {
  id: string
  calendar_id: string
  total_cost: number
  created_at: string
  updated_at: string
}

export interface SplitAttendance {
  id: string
  split_id: string
  participant_id: string
  date: string
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat(split): add Split and SplitAttendance types"
```

---

## Task 3: Generate Split Tab UI with Stitch

**Files:**
- No local files — uses Stitch MCP to generate the visual design

- [ ] **Step 1: Create a Stitch project for the split tab design**

Call the Stitch MCP tool `create_project` with a name like "Synkra Split Tab".

- [ ] **Step 2: Generate the split tab screen**

Call `generate_screen_from_text` with this prompt:

```
Design a "Split" tab for a scheduling web app called Synkra.

The tab has three zones stacked vertically:

Zone 1 — Setup strip (top):
- Label "Total cost" with a dollar sign prefix and a number input field
- Tournament dates shown as small read-only chips (e.g. "Jun 3", "Jun 4", "Jun 5")

Zone 2 — Attendance grid (middle):
- Table where rows = participants (colored dot + name on left) and columns = dates
- Each cell is a toggle checkbox. Checked = filled circle in participant's color. Unchecked = empty circle.
- Column headers are the date chips

Zone 3 — Results (bottom):
- Heading "Your shares"
- List of participants: colored dot + name on left, bold dollar amount on right (e.g. "$45.00")
- Subtle dividers between rows

Style: clean, minimal, matches the existing Synkra palette — dark navy primary (#0E2347), light backgrounds, rounded corners, no dark mode.
```

- [ ] **Step 3: Review the generated design**

Call `get_screen` on the generated screen ID. Review the output and note any layout details to carry into the implementation.

---

## Task 4: Add Tab Bar to CalendarClient

**Files:**
- Modify: `app/calendar/[code]/CalendarClient.tsx`

- [ ] **Step 1: Add `activeTab` state**

In `CalendarClient`, find the block of `useState` declarations (around line 57). Add after them:

```typescript
const [activeTab, setActiveTab] = useState<'calendar' | 'split'>('calendar')
```

- [ ] **Step 2: Add tab bar UI**

Find the closing `</header>` tag (around line 1139). Insert the tab bar immediately after it:

```tsx
{/* Top-level tab bar */}
<div
  className="flex-shrink-0 flex border-b"
  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
>
  {(['calendar', 'split'] as const).map(tab => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className="px-5 py-2.5 text-sm font-semibold capitalize transition-colors"
      style={{
        color: activeTab === tab ? 'var(--primary)' : 'var(--ink-3)',
        borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
        background: 'transparent',
      }}
    >
      {tab === 'calendar' ? 'Calendar' : 'Split'}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Conditionally render calendar vs split**

Find the lock banner and everything below it (the view toolbar + `<div className="flex flex-1 overflow-hidden">` block). Wrap that entire block in `{activeTab === 'calendar' && (...)}`. Add an `else` branch for split:

```tsx
{activeTab === 'calendar' ? (
  <>
    {/* Lock banner */}
    {cal.is_locked && (
      <div className="flex-shrink-0 text-xs font-medium text-center py-2 px-4" style={{ background: 'var(--primary-light)', color: 'var(--primary)', borderBottom: '1px solid var(--border)' }}>
        This calendar is locked. Submissions are closed.
      </div>
    )}
    {/* View toolbar */}
    {/* ... existing view toolbar JSX stays here unchanged ... */}
    {/* Main content */}
    {/* ... existing flex-1 content JSX stays here unchanged ... */}
  </>
) : (
  <SplitTab
    cal={cal}
    participants={participants}
    myParticipantId={myParticipantId}
  />
)}
```

- [ ] **Step 4: Add SplitTab import at top of file**

```typescript
import SplitTab from './SplitTab'
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/Ollie/Documents/Code/murmuration && bun run build 2>&1 | tail -20
```

Expected: no type errors (build may warn about other things but no new errors).

- [ ] **Step 6: Commit**

```bash
git add 'app/calendar/[code]/CalendarClient.tsx'
git commit -m "feat(split): add Calendar/Split tab bar to CalendarClient"
```

---

## Task 5: SplitTab Component

**Files:**
- Create: `app/calendar/[code]/SplitTab.tsx`

This single file contains all split UI logic. Internal sub-components (`CostInput`, `AttendanceGrid`, `ResultsList`) are defined in the same file.

- [ ] **Step 1: Create the file with props and data fetching**

Create `app/calendar/[code]/SplitTab.tsx`:

```tsx
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
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

  // Dates from calendar range (not infinite — show notice for infinite calendars)
  const dates = cal.is_infinite ? [] : getDateRange(cal.start_date, cal.end_date)

  // Fetch or create split row, then fetch attendance
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

  // Realtime subscription on split_attendance
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
            // Replace any temp optimistic row for the same participant+date
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
          // Optimistic update handled inside; realtime will confirm
          if (attended) {
            setAttendance(prev => prev.filter(a => !(a.participant_id === participantId && a.date === date)))
          } else {
            // Add a temp row; realtime INSERT will replace it
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
```

- [ ] **Step 2: Add CostInput sub-component**

Append to the same file:

```tsx
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
```

- [ ] **Step 3: Add AttendanceGrid sub-component**

Append to the same file:

```tsx
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
```

- [ ] **Step 4: Add ResultsList sub-component**

Append to the same file:

```tsx
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
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/Ollie/Documents/Code/murmuration && bun run build 2>&1 | tail -20
```

Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add 'app/calendar/[code]/SplitTab.tsx' 'app/calendar/[code]/CalendarClient.tsx'
git commit -m "feat(split): implement SplitTab with cost input, attendance grid, and results"
```

---

## Task 6: Manual Verification

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

```bash
cd /Users/Ollie/Documents/Code/murmuration && bun dev
```

- [ ] **Step 2: Open a calendar and verify the tab bar**

Navigate to an existing calendar. Confirm "Calendar" and "Split" tabs appear below the header. Clicking "Calendar" shows the existing grid, clicking "Split" shows the Split tab.

- [ ] **Step 3: Verify cost input**

In the Split tab, enter a dollar amount. Wait 600ms. Reload the page and confirm the value persisted.

- [ ] **Step 4: Verify attendance toggling**

Click cells in the attendance grid. Confirm they fill with the participant's color. Open the same calendar in a second browser tab — confirm the toggle appears there in real time.

- [ ] **Step 5: Verify share calculation**

With 3 participants and a $300 total cost:
- If Alice attended 2 days and Bob attended 1 day and Carol attended 1 day → total person-days = 4 → Alice: $150, Bob: $75, Carol: $75.
- Confirm the Results section shows these numbers.

- [ ] **Step 6: Verify infinite calendar notice**

Open or create an infinite calendar. Go to the Split tab. Confirm the message "Set an end date on this calendar to use the Split feature." is shown.

- [ ] **Step 7: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix(split): address issues found during manual verification"
```
