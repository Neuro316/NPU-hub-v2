'use client'

import { useWorkspace } from '@/lib/workspace-context'
import { Brain, ExternalLink, FileText, Users } from 'lucide-react'

export default function NeuroReportPage() {
  const { currentOrg, loading } = useWorkspace()
  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">NeuroReport</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · qEEG Report Generator</p>
        </div>
        <a
          href="https://neuroreport.app"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open NeuroReport
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="w-10 h-10 rounded-lg bg-np-blue/10 flex items-center justify-center mb-3">
            <Brain className="w-5 h-5 text-np-blue" />
          </div>
          <h3 className="text-sm font-semibold text-np-dark mb-1">Generate Reports</h3>
          <p className="text-xs text-gray-500">Create professional qEEG reports from brain scan data with automated analysis and clinical recommendations.</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mb-3">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <h3 className="text-sm font-semibold text-np-dark mb-1">Enrolled Participants</h3>
          <p className="text-xs text-gray-500">Participants in the Enrolled pipeline automatically appear here with their reports and session data linked.</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-3">
            <FileText className="w-5 h-5 text-amber-600" />
          </div>
          <h3 className="text-sm font-semibold text-np-dark mb-1">Report History</h3>
          <p className="text-xs text-gray-500">View and manage all generated reports. Reports are linked to CRM contacts for easy access from their profile.</p>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
        <Brain className="w-14 h-14 text-gray-200 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-np-dark mb-2">NeuroReport Integration</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
          This module will connect to the NeuroReport system. Enrolled participants from the CRM will appear here automatically with their qEEG data, reports, and session history.
        </p>
        <a
          href="https://neuroreport.app"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white rounded-lg text-sm font-medium hover:bg-np-blue/90 transition-colors"
        >
          <ExternalLink className="w-4 h-4" /> Launch NeuroReport
        </a>
      </div>
    </div>
  )
}
