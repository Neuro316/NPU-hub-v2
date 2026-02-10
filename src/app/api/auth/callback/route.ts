import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/'

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            const cookieHeader = request.headers.get('cookie') || ''
            return cookieHeader.split('; ').filter(Boolean).map(c => {
              const [name, ...rest] = c.split('=')
              return { name, value: rest.join('=') }
            })
          },
          setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
            // handled in response
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(origin + next)
    }
  }

  return NextResponse.redirect(origin + '/login?error=auth')
}
