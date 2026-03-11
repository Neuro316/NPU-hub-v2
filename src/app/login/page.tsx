'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const [mode, setMode] = useState<'google' | 'email'>('google')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', password: '' })
  const router = useRouter()

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  const handleEmailLogin = async () => {
    setError(null)
    if (!form.email || !form.password) { setError('Please enter your email and password.'); return }
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
      if (authError) throw authError
      if (!data.user) throw new Error('Login failed.')

      // Check pending status
      const { data: profile } = await supabase
        .from('team_profiles')
        .select('status')
        .eq('user_id', data.user.id)
        .limit(1)
        .maybeSingle()

      if (profile?.status === 'pending') {
        await supabase.auth.signOut()
        setError('Your account is pending admin approval. You will be notified once access is granted.')
        setLoading(false)
        return
      }

      router.push('/')
    } catch (e: any) {
      setError(e?.message || 'Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-np-light">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-np-blue rounded-2xl flex items-center justify-center mx-auto mb-3">
              <span className="text-white text-xl font-bold">NP</span>
            </div>
            <h1 className="text-xl font-semibold text-np-dark">NPU Hub</h1>
            <p className="text-xs text-gray-400 mt-1">Operations Platform</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}

          {/* Tab toggle */}
          <div className="flex rounded-lg border border-gray-200 p-1 mb-5">
            <button onClick={() => { setMode('google'); setError(null) }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${mode === 'google' ? 'bg-np-blue text-white' : 'text-gray-500 hover:text-np-dark'}`}>
              Google
            </button>
            <button onClick={() => { setMode('email'); setError(null) }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${mode === 'email' ? 'bg-np-blue text-white' : 'text-gray-500 hover:text-np-dark'}`}>
              Email
            </button>
          </div>

          {mode === 'google' ? (
            <button onClick={handleGoogleLogin} disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg font-medium text-np-dark hover:bg-gray-50 transition-colors disabled:opacity-50">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {loading ? 'Signing in...' : 'Sign in with Google'}
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="you@example.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Password</label>
                <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="Your password" onKeyDown={e => e.key === 'Enter' && handleEmailLogin()}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
              <button onClick={handleEmailLogin} disabled={loading}
                className="w-full py-2.5 bg-np-blue text-white text-sm font-semibold rounded-lg hover:bg-np-blue/90 transition-colors disabled:opacity-50">
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">
              Don't have access?{' '}
              <Link href="/signup" className="text-np-blue hover:underline font-medium">Request Access</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
