import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import ShareClient from './ShareClient'

export default async function SharePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  const { data: calendar } = await supabase
    .from('calendars')
    .select('*')
    .eq('code', code.toUpperCase())
    .single()

  if (!calendar) notFound()

  return <ShareClient calendar={calendar} />
}
