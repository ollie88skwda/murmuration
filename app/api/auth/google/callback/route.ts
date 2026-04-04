import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  if (!clientId || !clientSecret || !appUrl) {
    return new Response('Google OAuth not configured', { status: 503 })
  }

  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state') ?? '' // flock calendar code
  const error = searchParams.get('error')

  if (error || !code) {
    // Redirect back to calendar with error
    const dest = state ? `/calendar/${state}?gcal=error` : '/'
    return Response.redirect(`${appUrl}${dest}`)
  }

  const redirectUri = `${appUrl}/api/auth/google/callback`

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const dest = state ? `/calendar/${state}?gcal=error` : '/'
    return Response.redirect(`${appUrl}${dest}`)
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    expires_in: number
    token_type: string
  }

  const expiresAt = Date.now() + tokens.expires_in * 1000

  // Pass token info via URL fragment (never hits the server, stays client-side)
  // We encode as base64 in the hash so it's accessible via window.location.hash
  const payload = Buffer.from(
    JSON.stringify({ accessToken: tokens.access_token, expiresAt })
  ).toString('base64')

  const dest = state ? `/calendar/${state}` : '/'
  return Response.redirect(`${appUrl}${dest}?gcal=success#gcal_token=${payload}`)
}
