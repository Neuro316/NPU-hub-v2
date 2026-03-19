'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

interface InviteData {
  id: string
  email: string
  org_id: string
  role: string
  program: string | null
  org_name: string
}

export default function InviteAcceptPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [invite, setInvite] = useState<InviteData | null>(null)
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'expired' | 'used' | 'submitting' | 'done'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', password: '', confirm_password: '' })

  // Validate token on mount
  useEffect(() => {
    const validate = async () => {
      try {
        const res = await fetch(`/api/invite/${token}`)
        const data = await res.json()

        if (!res.ok) {
          setStatus(data.reason === 'used' ? 'used' : data.reason === 'expired' ? 'expired' : 'invalid')
          return
        }

        setInvite(data)
        setStatus('valid')
      } catch {
        setStatus('invalid')
      }
    }
    validate()
  }, [token])

  const handleAccept = async () => {
    setError(null)

    if (!form.first_name || !form.last_name || !form.password) {
      setError('Please fill in all fields.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.')
      return
    }

    setStatus('submitting')
    try {
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name,
          last_name: form.last_name,
          password: form.password,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to accept invite')

      // Sign in with the new credentials
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: invite!.email,
        password: form.password,
      })

      if (signInError) {
        // Account created but auto-login failed — redirect to login
        setStatus('done')
        return
      }

      router.push('/dashboard')
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.')
      setStatus('valid')
    }
  }

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-np-light">
        <div className="text-sm text-gray-500">Validating invite...</div>
      </div>
    )
  }

  // Invalid / expired / used states
  if (status === 'invalid' || status === 'expired' || status === 'used') {
    const messages = {
      invalid: { title: 'Invalid Invite', desc: 'This invite link is not valid. Please contact your administrator.' },
      expired: { title: 'Invite Expired', desc: 'This invite has expired. Please request a new one from your administrator.' },
      used: { title: 'Already Accepted', desc: 'This invite has already been used. You can sign in with your account.' },
    }
    const msg = messages[status]

    return (
      <div className="min-h-screen flex items-center justify-center bg-np-light">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-np-dark mb-2">{msg.title}</h2>
            <p className="text-sm text-gray-500 mb-6">{msg.desc}</p>
            <Link href="/login" className="text-sm text-np-blue hover:underline">Go to Sign In</Link>
          </div>
        </div>
      </div>
    )
  }

  // Success — account created, redirect to login
  if (status === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-np-light">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-np-dark mb-2">Account Created</h2>
            <p className="text-sm text-gray-500 mb-6">Your account is ready. Sign in to get started.</p>
            <Link href="/login" className="inline-block px-6 py-2 bg-np-blue text-white text-sm font-semibold rounded-lg hover:bg-np-blue/90 transition-colors">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Valid invite — show acceptance form
  return (
    <div className="min-h-screen flex items-center justify-center bg-np-light">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-7">
            <div className="w-14 h-14 bg-np-blue rounded-2xl flex items-center justify-center mx-auto mb-3">
              <span className="text-white text-xl font-bold">NP</span>
            </div>
            <h1 className="text-xl font-semibold text-np-dark">Accept Invite</h1>
            <p className="text-xs text-gray-400 mt-1">NPU Hub — Operations Platform</p>
          </div>

          <div className="px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg mb-4">
            <p className="text-xs text-blue-700">
              Joining: <span className="font-semibold">{invite?.org_name}</span>
              {invite?.program && <span className="ml-1">({invite.program})</span>}
            </p>
            <p className="text-xs text-blue-600 mt-0.5">{invite?.email}</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">First Name</label>
                <input type="text" value={form.first_name} onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))}
                  placeholder="First" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Last Name</label>
                <input type="text" value={form.last_name} onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))}
                  placeholder="Last" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Password</label>
              <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="Min. 8 characters" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Confirm Password</label>
              <input type="password" value={form.confirm_password} onChange={e => setForm(p => ({ ...p, confirm_password: e.target.value }))}
                placeholder="Repeat password" onKeyDown={e => e.key === 'Enter' && handleAccept()}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
            </div>
            <button onClick={handleAccept} disabled={status === 'submitting'}
              className="w-full py-2.5 bg-np-blue text-white text-sm font-semibold rounded-lg hover:bg-np-blue/90 transition-colors disabled:opacity-50 mt-1">
              {status === 'submitting' ? 'Creating Account...' : 'Create Account & Join'}
            </button>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            Already have an account? <Link href="/login" className="text-np-blue hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
