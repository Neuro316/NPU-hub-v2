import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isPublicPath =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/pending') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/twilio') ||
      pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/policies') ||
    // Marketing build, approved as exact paths only (2026-09-30 ruling 7). Each route
    // carries its own check: intake validates a published form and rate-limits,
    // unsubscribe verifies an HMAC token, /a/<token> redeems a hashed single-purpose
    // token. The Resend webhook is already public under /api/webhooks and refuses
    // anything without a valid Svix signature.
    pathname === '/api/intake' ||
    pathname === '/api/email/unsubscribe' ||
    // Mail search (Running List q26): exact path only. Not public: withMailSearchAuth answers 401 without a
    // superadmin session or the Bearer secret. Listed here so the scheduled task (no cookie) is not sent to /login.
    pathname === '/api/agent/mail-search' ||
    /^\/a\/[A-Za-z0-9_-]+$/.test(pathname) ||
    // A tracked resource link (Running List q33): exact shape only, /r/ and a 12-character code. The route accepts
    // only an existing, unrevoked code whose resource is active, rate-limits, and stores no visitor data.
    /^\/r\/[A-Za-z0-9]{12}$/.test(pathname) ||
    // A landing page (agent ruling 12): renders only when published AND the org's `pages`
    // flag is on, and is otherwise a plain not-found.
    /^\/p\/[a-z0-9]+(-[a-z0-9]+)*$/.test(pathname)

  // Not logged in — redirect to login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Logged in — check pending status before allowing dashboard access
  if (user && !isPublicPath) {
    const { data: profile } = await supabase
      .from('team_profiles')
      .select('status')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (profile?.status === 'pending') {
      const url = request.nextUrl.clone()
      url.pathname = '/pending'
      return NextResponse.redirect(url)
    }
  }

  // Logged in and trying to hit login/signup — send to dashboard
  if (user && (pathname.startsWith('/login') || pathname.startsWith('/signup'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
