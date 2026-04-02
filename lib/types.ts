export interface Calendar {
  id: string
  code: string
  name: string
  host_participant_id: string | null
  start_date: string
  end_date: string
  day_start_time: string
  day_end_time: string
  is_locked: boolean
  created_at: string
  expires_at: string
}

export interface Participant {
  id: string
  calendar_id: string
  name: string
  color_hue: number
  is_submitted: boolean
  created_at: string
}

export interface Block {
  id: string
  participant_id: string
  calendar_id: string
  date: string
  start_time: string
  end_time: string
  tier: 1 | 2 | 3
  created_at: string
  updated_at: string
}

export const TIER_LABELS: Record<number, string> = {
  1: 'Kinda busy',
  2: 'Very busy',
  3: "Can't do it",
}
