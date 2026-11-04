'use client'

// A crash in any dashboard page lands here, INSIDE the dashboard layout, so the
// sidebar and the call providers stay mounted and a live call carries on.
// Without this file Next.js replaced the whole app on an error, which unmounted
// OutboundCallProvider and ended the call.

import { useEffect } from 'react'

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard] page crashed; any live call stays connected.', error)
  }, [error])

  return (
    <div className="flex items-center justify-center py-24">
      <div className="max-w-sm rounded-xl border border-gray-100 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-np-dark">This page hit an error.</p>
        <p className="mt-1 text-xs text-gray-500">Any call you are on is still connected. Try again, or open another page.</p>
        <button type="button" onClick={reset}
          className="mt-4 rounded-lg bg-np-blue px-4 py-2 text-xs font-semibold text-white hover:bg-np-dark">
          Try again
        </button>
      </div>
    </div>
  )
}
