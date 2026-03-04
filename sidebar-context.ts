'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface SidebarContextType {
  isCollapsed: boolean
  isMobileOpen: boolean
  toggleCollapse: () => void
  openMobile: () => void
  closeMobile: () => void
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
  isMobileOpen: false,
  toggleCollapse: () => {},
  openMobile: () => {},
  closeMobile: () => {},
})

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  // Auto-close mobile sidebar on route change / resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <SidebarContext.Provider value={{
      isCollapsed,
      isMobileOpen,
      toggleCollapse: () => setIsCollapsed(prev => !prev),
      openMobile: () => setIsMobileOpen(true),
      closeMobile: () => setIsMobileOpen(false),
    }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
