# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # start dev server on localhost:3000
npm run build    # production build (also type-checks)
npm run lint     # ESLint
```

There are no automated tests. Playwright is installed but no test files exist yet.

## Environment

Requires a `.env.local` with:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_GCAL_CLIENT_ID=
GCAL_CLIENT_SECRET=
```

## Architecture

**Synkra** is a group availability planner — users create a calendar, share a 6-letter code, and participants drag to mark when they're busy.

### Stack
- Next.js 16 (App Router) + React 19 + TypeScript
- Supabase (Postgres + Realtime) for persistence and live updates
- Tailwind CSS v4 + shadcn/ui components
- No auth — participants are identified by a UUID stored in `localStorage` (`synkra_participant_<calendarCode>`)

### Route map
| Route | Purpose |
|---|---|
| `/` | Landing page — create or join a calendar |
| `/create` | Multi-step calendar creation wizard |
| `/join/[code]` | Enter your name to join an existing calendar |
| `/calendar/[code]` | Main calendar view (server component that fetches initial data, renders `CalendarClient`) |
| `/share/[code]` | Shareable invite page |
| `/api/auth/google` | OAuth callback for Google Calendar import |
| `/api/gcal/events` | Proxy to fetch Google Calendar events and auto-create blocks |

### Data model (`lib/types.ts`)
- **Calendar** — the event container; has `host_participant_id`, date range, `day_start_time`/`day_end_time`, `is_locked`, `is_infinite`
- **Participant** — a person in a calendar; has `color_hue`, `is_submitted`
- **Block** — a busy period; has `date` (YYYY-MM-DD), `start_time`/`end_time` (HH:MM), `tier` (1=kinda busy, 2=very busy, 3=can't do it), optional `label`
- **Message** — chat message tied to a calendar + participant

### `CalendarClient.tsx` — the core component
This single file (~2000 lines) is where almost all product logic lives:
- **View modes**: `all` | `month` | `week` | `day` — each renders a different layout of the same time-grid
- **Drag-to-create**: `mousedown`/`mousemove`/`mouseup` + touch equivalents; `finalizeDrag()` writes to Supabase
- **Block context menu**: right-click or long-press; host can act on any participant's block
- **Undo/redo**: `undoStack`/`redoStack` refs (not state) capped at 20 entries; Ctrl+Z / Ctrl+Shift+Z
- **Realtime**: Supabase channel subscriptions for `blocks`, `participants`, `messages`, and `calendars` tables
- **"Best times" tab**: finds slots where the most participants are free, with configurable duration, required attendees, and tier threshold
- **Hide blocked days toggle**: per-tab (per `ViewMode`) eye-icon toggle that removes days where every visible participant has a block
- **Host controls**: host can delete any block, rename any participant

### Key lib files
- `lib/grid.ts` — time slot math: `getTimeSlots()`, `getDateRange()`, `timeToSlotIndex()`, `getTimeBands()`
- `lib/colors.ts` — `hueForIndex()` for participant colors, `tierColor()` for block opacity/shade
- `lib/history.ts` — `localStorage`-backed recent-calendar history (`synkra_history`)
- `lib/supabase.ts` — singleton Supabase client (uses `NEXT_PUBLIC_*` env vars, client-side only)

### Styling conventions
- CSS custom properties for all colors (defined in `globals.css`): `--bg`, `--bg-card`, `--ink`, `--ink-2`, `--ink-3`, `--primary`, `--border`, etc.
- Tailwind v4 for layout/spacing; inline `style` props for dynamic/themed colors
- No dark mode — the design uses a warm parchment + Aegean navy palette
