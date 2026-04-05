import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import CalendarClient from './CalendarClient'

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[]>> }) {
  const { code } = await params
  const resolvedSearchParams = await searchParams

  if (!/^[A-Z0-9]{6}$/i.test(code)) notFound()

  const { data: calendar } = await supabase
    .from('calendars')
    .select('*')
    .eq('code', code.toUpperCase())
    .single()

  if (!calendar) notFound()

  const { data: participants } = await supabase
    .from('participants')
    .select('*')
    .eq('calendar_id', calendar.id)
    .order('created_at')

  const { data: blocks } = await supabase
    .from('blocks')
    .select('*')
    .eq('calendar_id', calendar.id)
    .order('date')
    .order('start_time')

  return (
    <CalendarClient
      calendar={calendar}
      initialParticipants={participants ?? []}
      initialBlocks={blocks ?? []}
      gcalSuccess={resolvedSearchParams['gcal'] === 'success'}
    />
  )
}
