'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

export default function PendingPage() {
  useEffect(() => {
    // Sign them out so they can't bypass this screen
    createClient().auth.signOut()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-np-light">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-np-dark mb-2">Access Pending</h2>
          <p className="text-sm text-gray-500 mb-2">
            Your account is awaiting admin approval.
          </p>
          <p className="text-xs text-gray-400 mb-6">
            You'll receive an email once your access has been granted. This usually happens within one business day.
          </p>
          <Link href="/login" className="text-sm text-np-blue hover:underline">Back to Sign In</Link>
        </div>
      </div>
    </div>
  )
}
