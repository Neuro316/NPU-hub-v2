'use client'

import { useEffect } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'

export function DynamicFavicon() {
  const { currentOrg } = useWorkspace()

  useEffect(() => {
    if (!currentOrg) return

    const updateFavicon = async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('org_settings')
          .select('setting_value')
          .eq('org_id', currentOrg.id)
          .eq('setting_key', 'branding')
          .maybeSingle()

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
