import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase-middleware'
import { isLeadDeviceHost, leadDeviceRoute } from '@/lib/lead-devices/public-origin'

// start.neuroprogeny.com only: it serves lead devices and nothing else, with no session and no
// cookies in either direction. Every other host goes through the Hub login exactly as before.
function leadDeviceResponse(request: NextRequest) {
  const route = leadDeviceRoute(request.nextUrl.pathname)
  if (!route) return new NextResponse(null, { status: 404 })
  const url = request.nextUrl.clone()
  url.pathname = route
  const headers = new Headers(request.headers)
  headers.delete('cookie')
  return NextResponse.rewrite(url, { request: { headers } })
}

export async function middleware(request: NextRequest) {
  if (isLeadDeviceHost(request.headers.get('host'))) return leadDeviceResponse(request)
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api/notify/sms: the bearer check (HUB_NOTIFY_SECRET) in that route is the
     *   ONLY gate for this path. The session middleware would redirect its
     *   cookieless scheduled callers to /login.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/integrations|api/cron|api/notify/sms$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
