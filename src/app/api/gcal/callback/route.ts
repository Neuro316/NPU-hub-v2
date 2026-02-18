import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code) {
    return new NextResponse(`
      <html><body><script>
        window.opener?.postMessage({ type: 'google_auth_error', error: '${error || 'no_code'}' }, '*');
        window.close();
      </script><p>Authentication failed. You can close this window.</p></body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }

  // Exchange code via the main gcal route
  try {
    const redirectUri = `${origin}/api/gcal/callback`
    const res = await fetch(`${origin}/api/gcal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: req.headers.get('cookie') || '',
      },
      body: JSON.stringify({ action: 'exchange_code', code, redirect_uri: redirectUri }),
    })
    const data = await res.json()

    return new NextResponse(`
      <html><body><script>
        window.opener?.postMessage({ type: 'google_auth_success' }, '*');
        window.close();
      </script><p>${data.success ? 'Connected! You can close this window.' : 'Failed to connect.'}</p></body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  } catch {
    return new NextResponse(`
      <html><body><script>window.close();</script><p>Error. Close this window.</p></body></html>
    `, { headers: { 'Content-Type': 'text/html' } })
  }
}
