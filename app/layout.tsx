import type { Metadata } from 'next'
import { Inter, Plus_Jakarta_Sans, Geist } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' })

export const metadata: Metadata = {
  title: 'Synkra — Group Availability Planner',
  description: 'Blend your schedules. Find a time that works for everyone. No accounts, no drama.',
}

const themeScript = `
(function() {
  try {
    // Migrate legacy flock_ keys
    var legacy = localStorage.getItem('flock_theme');
    if (legacy) { localStorage.setItem('synkra_theme', legacy); localStorage.removeItem('flock_theme'); }
    var legacyHistory = localStorage.getItem('flock_history');
    if (legacyHistory) { localStorage.setItem('synkra_history', legacyHistory); localStorage.removeItem('flock_history'); }
    var t = localStorage.getItem('synkra_theme');
    var html = document.documentElement;
    if (t === 'dark') { html.classList.add('dark'); }
    else if (t === 'light') { html.classList.add('light'); }
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) { html.classList.add('dark'); }
  } catch(e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("h-full", inter.variable, jakarta.variable, "font-sans", geist.variable)}>
      <head>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>{children}</body>
    </html>
  )
}
