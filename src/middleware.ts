import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase-middleware'

export async function middleware(request: NextRequest) {
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
