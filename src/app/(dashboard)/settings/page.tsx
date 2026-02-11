'use client'

import { useWorkspace } from '@/lib/workspace-context'
import { Settings, Building2, Palette, Bell, Shield } from 'lucide-react'

export default function SettingsPage() {
  const { currentOrg, loading } = useWorkspace()
  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-np-dark">Settings</h1>
        <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · Workspace Configuration</p>
      </div>

      <div className="space-y-4">
        {[
          { icon: Building2, title: 'Organization', desc: 'Name, logo, and workspace details', color: '#386797' },
          { icon: Palette, title: 'Brand Profiles', desc: 'Brand voice, colors, vocabulary rules', color: '#8B5CF6' },
          { icon: Bell, title: 'Notifications', desc: 'Slack, email, and in-app notification preferences', color: '#F59E0B' },
          { icon: Shield, title: 'Security', desc: 'Authentication, access controls, API keys', color: '#EF4444' },
        ].map((section, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl p-5 flex items-center gap-4 hover:shadow-sm transition-all cursor-pointer">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: section.color + '15' }}>
              <section.icon className="w-5 h-5" style={{ color: section.color }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-np-dark">{section.title}</h3>
              <p className="text-xs text-gray-500">{section.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
