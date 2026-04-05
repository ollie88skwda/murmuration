import { supabase } from '@/lib/supabase'
import { notFound, redirect } from 'next/navigation'
import JoinClient from './JoinClient'

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  if (code.toUpperCase() === 'DEBUG') redirect('/debug')
  if (!/^[A-Z0-9]{6}$/i.test(code)) notFound()

  const { data: calendar } = await supabase
    .from('calendars')
    .select('*')
    .eq('code', code.toUpperCase())
    .single()

  if (!calendar) notFound()
  if (calendar.is_locked) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <p className="text-2xl mb-3">🔒</p>
          <h1 className="text-xl font-bold text-[#1a1635] mb-2">Calendar Locked</h1>
          <p className="text-sm text-[#5b5780]">This calendar is locked. Submissions are closed.</p>
        </div>
      </main>
    )
  }

  return <JoinClient calendar={calendar} />
}
