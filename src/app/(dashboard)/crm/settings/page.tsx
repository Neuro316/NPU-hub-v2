'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Settings — Configuration, team, email, DNC, webhooks
// Route: /crm/settings
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react'
import {
  Users, Mail, Shield, Webhook, Bell, Database,
  Phone, Bot, ChevronRight
} from 'lucide-react'

const SETTINGS_SECTIONS = [
  { id: 'team', label: 'Team Members', icon: Users, desc: 'Manage team roles, assignments, and round-robin rules' },
  { id: 'email', label: 'Email Configuration', icon: Mail, desc: 'Gmail Workspace integration, sending limits, warmup' },
  { id: 'twilio', label: 'Twilio / Phone', icon: Phone, desc: 'Phone number, messaging service, TwiML app' },
  { id: 'ai', label: 'AI Integration', icon: Bot, desc: 'Claude API for summaries, tasks, smart replies, sentiment' },
  { id: 'dnc', label: 'Do Not Contact', icon: Shield, desc: 'Org-level blocklist management' },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, desc: 'Outbound webhook subscriptions and event routing' },
  { id: 'notifications', label: 'Notifications', icon: Bell, desc: 'Alert thresholds for deliverability, response times' },
  { id: 'data', label: 'Data Management', icon: Database, desc: 'Import contacts, export data, merge tool, saved filters' },
]

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null)

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <h2 className="text-lg font-bold text-np-dark">CRM Settings</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SETTINGS_SECTIONS.map(section => {
          const Icon = section.icon
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className="flex items-center gap-4 p-4 rounded-xl border border-gray-100 bg-white hover:shadow-md hover:border-np-blue/20 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-np-blue/8 flex items-center justify-center flex-shrink-0">
                <Icon size={18} className="text-np-blue" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-np-dark">{section.label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{section.desc}</p>
              </div>
              <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
            </button>
          )
        })}
      </div>

      {/* Placeholder content when a section is selected */}
      {activeSection && (
        <div className="rounded-xl border border-gray-100 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-np-dark capitalize">
              {SETTINGS_SECTIONS.find(s => s.id === activeSection)?.label}
            </h3>
            <button onClick={() => setActiveSection(null)} className="text-xs text-np-blue hover:underline">
              ← Back
            </button>
          </div>

          {activeSection === 'email' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Provider</label>
                  <select className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option>Gmail Workspace</option>
                    <option>Resend</option>
                    <option>SMTP</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Sending Email</label>
                  <input defaultValue="admin@neuroprogeny.com" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Daily Send Limit</label>
                  <input type="number" defaultValue={500} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Batch Size</label>
                  <input type="number" defaultValue={50} className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" defaultChecked className="accent-teal" />
                <span className="text-xs text-gray-600">Enable warmup (starts at 50/day, doubles daily)</span>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Apps Script Webhook URL</label>
                <input placeholder="https://script.google.com/macros/s/..." className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono" />
              </div>
              <button className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
                Save Email Configuration
              </button>
            </div>
          )}

          {activeSection === 'twilio' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Account SID</label>
                  <input placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Auth Token</label>
                  <input type="password" placeholder="••••••••••••••••" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Phone Number</label>
                  <input placeholder="+1XXXXXXXXXX" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Messaging Service SID</label>
                  <input placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono" />
                </div>
              </div>
              <button className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
                Save Twilio Configuration
              </button>
            </div>
          )}

          {activeSection !== 'email' && activeSection !== 'twilio' && (
            <div className="text-center py-8">
              <p className="text-xs text-gray-400">Configuration panel for {activeSection} coming with backend integration.</p>
              <p className="text-[10px] text-gray-400 mt-1">The API routes and database tables are already in place.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
