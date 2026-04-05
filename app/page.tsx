'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { loadHistory, formatRelativeTime, HistoryEntry } from '@/lib/history'

export default function HomePage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [mounted, setMounted] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    setMounted(true)
    setHistory(loadHistory())
  }, [])

  function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (trimmed.length === 6) router.push(`/join/${trimmed}`)
  }

  return (
    <main className="flex-1 flex flex-col min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 sm:px-10 py-5">
        <Logo />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <a href="/create">
            <Button variant="outline" size="sm" className="rounded-full font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}>
              New calendar
            </Button>
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        {/* Decorative grid preview */}
        <div className="relative mb-10 w-full max-w-xs h-20 overflow-hidden rounded-2xl opacity-60 fade-up" aria-hidden>
          <GridPreview />
        </div>

        <Badge variant="secondary" className="mb-5 px-3 py-1 text-xs font-semibold tracking-wide uppercase fade-up fade-up-1" style={{ background: 'var(--primary-light)', color: 'var(--primary)', border: 'none' }}>
          No account needed · Free
        </Badge>

        <h1
          className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.05] mb-5 tracking-tight fade-up fade-up-2"
          style={{ fontFamily: 'var(--font-jakarta)', color: 'var(--ink)' }}
        >
          Find the time.<br />
          <span style={{ color: 'var(--primary)' }}>Skip the chat.</span>
        </h1>

        <p className="text-lg sm:text-xl mb-12 max-w-md fade-up fade-up-3" style={{ color: 'var(--ink-2)' }}>
          Share a link. Everyone marks when they&apos;re busy.
          You see when everyone&apos;s free. Done.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch gap-3 w-full max-w-md fade-up fade-up-4">
          <a href="/create" className="sm:flex-1">
            <Button
              className="w-full font-semibold py-6 text-base rounded-2xl gap-2"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              Create a calendar
              <ArrowRight />
            </Button>
          </a>

          <form onSubmit={handleJoin} className="sm:flex-1 flex gap-2">
            <Input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="ENTER CODE"
              maxLength={6}
              className="flex-1 text-center font-mono text-base tracking-widest rounded-2xl uppercase h-auto py-3.5 border-2"
              style={{
                borderColor: code.length === 6 ? 'var(--primary)' : 'var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--ink)',
              }}
            />
            <Button
              type="submit"
              disabled={code.length !== 6}
              className="px-4 py-3.5 rounded-2xl font-semibold text-sm h-auto"
              variant={code.length === 6 ? 'default' : 'secondary'}
              style={code.length === 6 ? { background: 'var(--ink)', color: 'var(--bg)' } : { background: 'var(--border)', color: 'var(--ink-3)' }}
            >
              Join
            </Button>
          </form>
        </div>

        <p className="mt-6 text-sm" style={{ color: 'var(--ink-3)' }}>
          Share a 6-letter code &middot; Free forever
        </p>

        {/* Recent calendars */}
        {mounted && history.length > 0 && (
          <div className="w-full max-w-md mt-10 fade-up fade-up-5">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-bold uppercase tracking-widest text-left" style={{ color: 'var(--ink-3)' }}>
                Recent calendars
              </p>
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>
            <div className="flex flex-col gap-2">
              {history.map(entry => (
                <button
                  key={entry.code}
                  onClick={() => router.push(`/calendar/${entry.code}`)}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl border w-full text-left transition-all"
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(9,36,65,0.08)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                  }}
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>
                      {entry.name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
                      {entry.code} &middot; {formatRelativeTime(entry.visitedAt)}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-xl" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                    Open →
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Feature strip */}
      <Separator style={{ background: 'var(--border)' }} />
      <section className="px-6 sm:px-10 py-8 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto w-full">
        {[
          { icon: '🗓️', title: 'Drag to block', desc: 'Mark when you\'re busy with a simple drag.' },
          { icon: '🎨', title: 'Color-coded', desc: 'Each person gets a unique color. See overlaps instantly.' },
          { icon: '⚡', title: 'Realtime', desc: 'Everyone sees updates live as they happen.' },
        ].map(f => (
          <div key={f.title} className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0 mt-0.5">{f.icon}</span>
            <div>
              <p className="font-semibold text-sm mb-0.5" style={{ color: 'var(--ink)' }}>{f.title}</p>
              <p className="text-sm" style={{ color: 'var(--ink-2)' }}>{f.desc}</p>
            </div>
          </div>
        ))}
      </section>
    </main>
  )
}

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4"/>
    </svg>
  )
}

function Logo() {
  return (
    <a href="/" className="flex items-center gap-2">
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center"
        style={{ background: 'var(--primary)' }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M9 2C5.5 2 3 4.5 3 7.5c0 2 1 3.8 2.5 4.8L9 14.5l3.5-2.2C14 11.3 15 9.5 15 7.5 15 4.5 12.5 2 9 2z" fill="white" opacity="0.3"/>
          <circle cx="6.5" cy="8" r="1.5" fill="white"/>
          <circle cx="11.5" cy="8" r="1.5" fill="white"/>
          <path d="M6.5 11c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--ink)', fontFamily: 'var(--font-jakarta)' }}>
        synkra
      </span>
    </a>
  )
}

function GridPreview() {
  const cols = 5
  const rows = 6
  const colors = ['#092441', '#E45C3A', '#0EA5E9', '#10B981', '#F59E0B']
  const blocks = [
    { col: 1, row: 1, h: 2, ci: 0 },
    { col: 2, row: 0, h: 3, ci: 1 },
    { col: 3, row: 2, h: 2, ci: 2 },
    { col: 0, row: 3, h: 2, ci: 3 },
    { col: 4, row: 1, h: 3, ci: 4 },
    { col: 1, row: 3, h: 2, ci: 1 },
    { col: 3, row: 0, h: 2, ci: 0 },
  ]
  const colW = 100 / cols
  const rowH = 100 / rows

  return (
    <div className="absolute inset-0" style={{ background: 'var(--bg-card)', borderRadius: 16, overflow: 'hidden' }}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} style={{ position: 'absolute', left: `${i * colW}%`, top: 0, bottom: 0, width: 1, background: 'var(--border)' }} />
      ))}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ position: 'absolute', top: `${i * rowH}%`, left: 0, right: 0, height: 1, background: 'var(--border)' }} />
      ))}
      {blocks.map((b, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `calc(${b.col * colW}% + 3px)`,
          top: `calc(${b.row * rowH}% + 2px)`,
          width: `calc(${colW}% - 6px)`,
          height: `calc(${b.h * rowH}% - 4px)`,
          background: colors[b.ci],
          opacity: 0.7,
          borderRadius: 6,
          mixBlendMode: 'multiply',
        }} />
      ))}
    </div>
  )
}
