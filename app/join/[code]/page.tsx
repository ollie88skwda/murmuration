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
      <main className="flex-1 flex flex-col items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
        <div className="w-full max-w-sm rounded-2xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4" style={{ background: 'var(--primary-light)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-jakarta)', color: 'var(--ink)' }}>Calendar Locked</h1>
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>This calendar is locked. Submissions are closed.</p>
        </div>
      </main>
    )
  }

  return <JoinClient calendar={calendar} />
}
