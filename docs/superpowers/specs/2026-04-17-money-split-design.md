# Money Split Feature — Design Spec

**Date:** 2026-04-17  
**Project:** Synkra (murmuration)  
**Status:** Approved

## Overview

Add a "Split" tab to the existing calendar view. Given a total tournament cost, a set of dates (from the calendar), and a collaborative attendance grid (who attended which day), calculate each participant's fair share — paying only for the days they attended.

Primary use case: AAU tournament cost splitting among a small friend group.

## Database Schema

### `splits`
| column | type | constraints |
|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() |
| `calendar_id` | uuid | FK → calendars(id), unique |
| `total_cost` | numeric | default 0 |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

One split per calendar (unique on `calendar_id`).

### `split_attendance`
| column | type | constraints |
|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() |
| `split_id` | uuid | FK → splits(id) |
| `participant_id` | uuid | FK → participants(id) |
| `date` | date | must be within calendar's date range |

Unique constraint on `(split_id, participant_id, date)`. Row presence = attended. No boolean column needed — toggle is upsert (attended) or delete (not attended).

## UI Layout

The calendar gains a tab bar. Tabs: **Calendar** | **Split**.

### Split Tab — 3 zones

**Zone 1 — Setup strip**
- Total cost field: `$ [____]` — editable by any participant, saves on blur/enter with debounce
- Tournament dates displayed as read-only chips pulled from the calendar's `start_date` / `end_date` range. For infinite calendars (`is_infinite = true`), the Split tab shows a notice: "Set an end date on this calendar to use the Split feature."

**Zone 2 — Attendance grid**
- Rows = participants (color dot + name, same order as calendar sidebar)
- Columns = each date in the calendar's range
- Cell = toggle: filled circle = attended, empty = not attended
- Any participant can toggle any cell (collaborative, no host restriction)
- Optimistic UI: toggle updates local state immediately, then upserts/deletes to Supabase
- Realtime Supabase subscription on `split_attendance` (filtered by `split_id`) keeps all viewers in sync

**Zone 3 — Results**
- One row per participant: color dot + name + **$XX.XX**
- Derived client-side from attendance state + total cost
- Updates live as attendance changes

## Calculation Formula

```
cost_per_person_day = total_cost / total_person_days_attended
person_share = cost_per_person_day × person_days_attended
```

Where `total_person_days_attended` = sum of all checked cells across all participants. If nobody has attendance marked, show $0.00 for all.

## Component Breakdown

| Component | Responsibility |
|---|---|
| `SplitTab` | Owns state, Supabase subscriptions, passes data down |
| `CostInput` | Controlled input for total cost, debounced upsert |
| `AttendanceGrid` | Renders participant × date grid, delegates toggles up |
| `ResultsList` | Pure display, computes shares from props |

`SplitTab` lives inside the existing `CalendarClient` tab structure.

## Data Flow

1. Tab open → check if `splits` row exists for `calendar_id`. If not, create one silently with `total_cost = 0`.
2. Fetch all `split_attendance` rows for that `split_id`.
3. Subscribe to Supabase realtime on `split_attendance` filtered by `split_id`.
4. Cell toggle → optimistic local update → upsert or delete `split_attendance` row.
5. Cost change → debounced update to `splits.total_cost`.
6. Results computed client-side from current state — no extra query.

## Participants Source

Participants pulled from the existing `participants` table for this calendar — same list already loaded in `CalendarClient`. No separate people input needed.

## Out of Scope

- Per-day cost variation (all days equal weight)
- Locking the split after finalization
- Export / share results as image or text
- Multiple splits per calendar
