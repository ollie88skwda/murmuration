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

const migrationScript = `
(function() {
  try {
    var legacyHistory = localStorage.getItem('flock_history');
    if (legacyHistory) { localStorage.setItem('synkra_history', legacyHistory); localStorage.removeItem('flock_history'); }
    localStorage.removeItem('flock_theme');
    localStorage.removeItem('synkra_theme');
  } catch(e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("h-full", inter.variable, jakarta.variable, "font-sans", geist.variable)}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <Script id="migrate" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: migrationScript }} />
      </head>
      <body className="min-h-full flex flex-col" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>{children}</body>
    </html>
  )
}
