export interface HistoryEntry {
  code: string
  name: string
  visitedAt: string
}

const HISTORY_KEY = 'synkra_history'
const MAX_ENTRIES = 10

export function saveToHistory(code: string, name: string): void {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const existing: HistoryEntry[] = raw ? JSON.parse(raw) : []
    const now = new Date().toISOString()
    // Remove any existing entry with the same code
    const filtered = existing.filter(e => e.code !== code)
    // Add new entry at the front
    const updated = [{ code, name, visitedAt: now }, ...filtered].slice(0, MAX_ENTRIES)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  } catch {
    // Silently ignore localStorage errors
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 30) return `${diffDay} days ago`
  return new Date(isoString).toLocaleDateString()
}
