'use client'

import { useEffect } from 'react'
import { useWorkspace } from '@/lib/workspace-context'

export function DynamicFavicon() {
  const { currentOrg } = useWorkspace()

  useEffect(() => {
    if (!currentOrg) return

    const updateFavicon = async () => {
      try {
        // Use API route to bypass RLS
        const res = await fetch(`/api/settings/read?org_id=${currentOrg.id}&key=branding`)
        const data = await res.json()
        const faviconUrl = data?.setting_value?.favicon_url || '/favicon.ico'

        let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement
        if (!link) {
          link = document.createElement('link')
          link.rel = 'icon'
          document.head.appendChild(link)
        }
        link.href = faviconUrl
      } catch {
        // Silently fall back to default
      }
    }

    updateFavicon()
  }, [currentOrg?.id])

  return null
}
