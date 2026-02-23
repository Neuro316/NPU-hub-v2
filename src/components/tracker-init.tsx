'use client'

import { useTracker } from '@/lib/hooks/use-tracker'

// This component exists solely to initialize the tracking hook
// Drop it into the dashboard layout alongside other providers
export function TrackerInit() {
  useTracker()
  return null
}
