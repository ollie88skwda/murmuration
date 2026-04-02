'use client'

import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('flock_theme')
    if (stored === 'dark') {
      setIsDark(true)
    } else if (stored === 'light') {
      setIsDark(false)
    } else {
      setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
    }
  }, [])

  function toggle() {
    const next = !isDark
    setIsDark(next)
    const html = document.documentElement
    if (next) {
      html.classList.add('dark')
      html.classList.remove('light')
      localStorage.setItem('flock_theme', 'dark')
    } else {
      html.classList.add('light')
      html.classList.remove('dark')
      localStorage.setItem('flock_theme', 'light')
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="w-8 h-8 flex items-center justify-center transition-colors"
      style={{ color: 'var(--ink-2)', borderRadius: 8 }}
    >
      {isDark ? (
        // Sun icon
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        </svg>
      ) : (
        // Moon icon
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      )}
    </button>
  )
}
