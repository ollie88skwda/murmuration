import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const accessToken = searchParams.get('accessToken')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (!accessToken || !startDate || !endDate) {
    return Response.json({ error: 'Missing required params' }, { status: 400 })
  }

  // timeMin is start of startDate, timeMax is end of endDate
  const timeMin = new Date(`${startDate}T00:00:00`).toISOString()
  // Add one day to endDate so we get all events on the last day
  const endDt = new Date(`${endDate}T00:00:00`)
  endDt.setDate(endDt.getDate() + 1)
  const timeMax = endDt.toISOString()

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  })

  const gcalRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  if (!gcalRes.ok) {
    const body = await gcalRes.text()
    return Response.json({ error: 'Google Calendar API error', details: body }, { status: gcalRes.status })
  }

  const data = await gcalRes.json() as {
    items: Array<{
      id: string
      summary?: string
      start: { dateTime?: string; date?: string; timeZone?: string }
      end: { dateTime?: string; date?: string; timeZone?: string }
      status?: string
      transparency?: string
    }>
  }

  // Filter out cancelled and transparent (free) events, and all-day events
  const events = (data.items ?? []).filter(ev => {
    if (ev.status === 'cancelled') return false
    if (ev.transparency === 'transparent') return false // marked as "free" in Google Calendar
    if (!ev.start.dateTime) return false // skip all-day events
    return true
  })

  return Response.json({ events })
}
