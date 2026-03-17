'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

interface Org {
  id: string
  name: string
  slug: string
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-np-light"><div className="text-gray-400">Loading...</div></div>}>
      <SignupContent />
    </Suspense>
  )
}

function SignupContent() {
  const searchParams = useSearchParams()
  const orgParam = searchParams.get('org') // slug or id

  const [step, setStep] = useState<'form' | 'done'>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '', confirm_password: '' })

  // Fetch organizations on mount
  useEffect(() => {
    const fetchOrgs = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('organizations')
        .select('id, name, slug')
        .order('name')

      const orgList: Org[] = data || []
      setOrgs(orgList)

      // If ?org= param provided, match by slug or id
      if (orgParam && orgList.length > 0) {
        const match = orgList.find(
          o => o.slug === orgParam || o.id === orgParam
        )
        if (match) {
          setSelectedOrgId(match.id)
        }
      }

      // If only one org exists, auto-select it
      if (!orgParam && orgList.length === 1) {
        setSelectedOrgId(orgList[0].id)
      }

      setOrgsLoading(false)
    }
    fetchOrgs()
  }, [orgParam])

  const handleSignup = async () => {
    setError(null)
    if (!form.first_name || !form.last_name || !form.email || !form.password) {
      setError('Please fill in all fields.')
      return
    }
    if (!selectedOrgId) {
      setError('Please select an organization.')
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
    setLoading(true)
    try {
      const supabase = createClient()

      // Create auth user
      const { data, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { full_name: `${form.first_name} ${form.last_name}`, first_name: form.first_name, last_name: form.last_name } }
      })
      if (authError) throw authError
      if (!data.user) throw new Error('Signup failed.')

      // Create org membership + team profile via API (uses admin client)
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: data.user.id,
          org_id: selectedOrgId,
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
        }),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to complete signup')
      }

      await supabase.auth.signOut()
      setStep('done')
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-np-light">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-np-dark mb-2">Request Submitted</h2>
            <p className="text-sm text-gray-500 mb-6">Your account is pending admin approval. You&apos;ll be notified once access is granted.</p>
            <Link href="/login" className="text-sm text-np-blue hover:underline">Back to Sign In</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-np-light">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-7">
            <div className="w-14 h-14 bg-np-blue rounded-2xl flex items-center justify-center mx-auto mb-3">
              <span className="text-white text-xl font-bold">NP</span>
            </div>
            <h1 className="text-xl font-semibold text-np-dark">Request Access</h1>
            <p className="text-xs text-gray-400 mt-1">NPU Hub — Operations Platform</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}

          <div className="space-y-3">
            {/* Org selector — hidden if pre-selected via ?org= param */}
            {!orgParam && orgs.length > 1 && (
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Organization</label>
                <select
                  value={selectedOrgId}
                  onChange={e => setSelectedOrgId(e.target.value)}
                  disabled={orgsLoading}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 bg-white"
                >
                  <option value="">Select organization...</option>
                  {orgs.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Show which org is pre-selected when coming from an invite/link */}
            {orgParam && selectedOrgId && (
              <div className="px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs text-blue-700">
                  Joining: <span className="font-semibold">{orgs.find(o => o.id === selectedOrgId)?.name}</span>
                </p>
              </div>
            )}

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
              <label className="text-xs font-medium text-gray-600 mb-1 block">Email Address</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="you@example.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Password</label>
              <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="Min. 8 characters" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Confirm Password</label>
              <input type="password" value={form.confirm_password} onChange={e => setForm(p => ({ ...p, confirm_password: e.target.value }))}
                placeholder="Repeat password" onKeyDown={e => e.key === 'Enter' && handleSignup()}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
            </div>
            <button onClick={handleSignup} disabled={loading || orgsLoading}
              className="w-full py-2.5 bg-np-blue text-white text-sm font-semibold rounded-lg hover:bg-np-blue/90 transition-colors disabled:opacity-50 mt-1">
              {loading ? 'Submitting...' : 'Request Access'}
            </button>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            Already have access? <Link href="/login" className="text-sm text-np-blue hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
