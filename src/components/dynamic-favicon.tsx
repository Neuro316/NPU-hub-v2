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
        // Only an https URL or a site-relative path is usable. Anything else
        // (the literal 'PASTE_NEURO_PROGENY_FAVICON_URL_HERE' that sat in the
        // Neuro Progeny branding row, see migration 208) is treated as unset.
        // The fallback is a file that actually exists in /public; the old
        // '/favicon.ico' never did.
        const raw = String(data?.setting_value?.favicon_url || '').trim()
        const faviconUrl = /^(https:\/\/|\/)/i.test(raw) ? raw : '/images/np-logo.png'

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
