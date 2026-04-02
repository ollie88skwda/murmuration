'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [code, setCode] = useState('')

  function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (trimmed.length === 6) {
      router.push(`/join/${trimmed}`)
    }
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-12">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-indigo-500">
          <path d="M16 4C10 4 5 9 5 15c0 4 2 7.5 5 9.5L16 28l6-3.5c3-2 5-5.5 5-9.5 0-6-5-11-11-11z" fill="currentColor" opacity="0.15"/>
          <path d="M8 12c2-3 5-5 8-5s6 2 8 5M12 18c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5M6 16c0 1 .2 2 .5 3M26 16c0 1-.2 2-.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          <circle cx="16" cy="18" r="2" fill="currentColor"/>
        </svg>
        <span className="text-2xl font-bold text-indigo-600" style={{ fontFamily: 'var(--font-jakarta)' }}>
          flock
        </span>
      </div>

      {/* Hero */}
      <div className="text-center mb-10 max-w-lg">
        <h1 className="text-4xl sm:text-5xl font-bold text-[#1a1635] mb-4 leading-tight" style={{ fontFamily: 'var(--font-jakarta)' }}>
          Find a time that<br />works for everyone.
        </h1>
        <p className="text-lg text-[#5b5780]">No accounts. No drama. Just a shared calendar.</p>
      </div>

      {/* Cards */}
      <div className="w-full max-w-2xl flex flex-col sm:flex-row gap-4">
        {/* Create */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-indigo-100 p-8 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <svg width="24" height="24" fill="none" stroke="#5B6AF0" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#1a1635] mb-2">Create a Calendar</h2>
          <p className="text-sm text-[#5b5780] mb-6">Set a date range and share a code with your group.</p>
          <a
            href="/create"
            className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors text-center block"
          >
            Create a Calendar →
          </a>
        </div>

        {/* Join */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-indigo-100 p-8 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <svg width="24" height="24" fill="none" stroke="#5B6AF0" strokeWidth="2" strokeLinecap="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-9 9M3 21l9-9"/>
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#1a1635] mb-2">Already have a code?</h2>
          <p className="text-sm text-[#5b5780] mb-6">Enter the 6-character code to join a calendar.</p>
          <form onSubmit={handleJoin} className="w-full flex flex-col gap-3">
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="FLCK7X"
              maxLength={6}
              className="w-full text-center text-2xl font-mono tracking-[0.3em] border-2 border-indigo-200 rounded-xl py-3 px-4 focus:outline-none focus:border-indigo-500 uppercase bg-indigo-50 placeholder-indigo-200"
            />
            <button
              type="submit"
              disabled={code.length !== 6}
              className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-200 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors"
            >
              Join →
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
