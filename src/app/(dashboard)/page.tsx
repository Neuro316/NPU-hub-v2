'use client'

import { useState, useEffect } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import {
  Route, CheckSquare, Megaphone, Target, Brain, Image, BarChart3, Users,
  Lightbulb, ArrowRight, Sparkles, TrendingUp, Zap
} from 'lucide-react'

interface Stats {
  journeyCards: number
  tasks: number
  campaigns: number
  posts: number
  mediaAssets: number
  ideas: number
  teamMembers: number
}

export default function DashboardPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const [stats, setStats] = useState<Stats>({ journeyCards: 0, tasks: 0, campaigns: 0, posts: 0, mediaAssets: 0, ideas: 0, teamMembers: 0 })
  const supabase = createClient()

  useEffect(() => {
    if (!currentOrg) return
    Promise.all([
      supabase.from('journey_cards').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('kanban_tasks').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('social_posts').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('media_assets').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('ideas').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
      supabase.from('team_profiles').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id),
    ]).then(([cards, tasks, campaigns, posts, media, ideas, team]) => {
      setStats({
        journeyCards: cards.count || 0,
        tasks: tasks.count || 0,
        campaigns: campaigns.count || 0,
        posts: posts.count || 0,
        mediaAssets: media.count || 0,
        ideas: ideas.count || 0,
        teamMembers: team.count || 0,
      })
    }).catch(() => {})
  }, [currentOrg?.id])

  if (orgLoading) return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-np-dark">{greeting}, {firstName}</h1>
        <p className="text-sm text-gray-500 mt-1">{currentOrg?.name} · NPU Hub</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Journey Cards', value: stats.journeyCards, icon: Route, color: '#386797', href: '/journeys' },
          { label: 'Active Tasks', value: stats.tasks, icon: CheckSquare, color: '#F59E0B', href: '/tasks' },
          { label: 'Campaigns', value: stats.campaigns, icon: Megaphone, color: '#8B5CF6', href: '/campaigns' },
          { label: 'Social Posts', value: stats.posts, icon: Target, color: '#E4405F', href: '/social' },
        ].map((stat, i) => (
          <Link key={i} href={stat.href}
            className="bg-white border border-gray-100 rounded-xl p-4 hover:shadow-md hover:border-gray-200 transition-all">
            <div className="flex items-center justify-between mb-3">
              <stat.icon className="w-5 h-5" style={{ color: stat.color }} />
              <ArrowRight className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <p className="text-2xl font-bold text-np-dark">{stat.value}</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-0.5">{stat.label}</p>
          </Link>
        ))}
      </div>

      <div className="mb-8">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Create Post', icon: Target, href: '/social', color: '#E4405F' },
            { label: 'New Campaign', icon: Megaphone, href: '/campaigns', color: '#8B5CF6' },
            { label: 'Add Task', icon: CheckSquare, href: '/tasks', color: '#F59E0B' },
            { label: 'Upload Media', icon: Image, href: '/media', color: '#10B981' },
          ].map((action, i) => (
            <Link key={i} href={action.href}
              className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3 hover:shadow-sm hover:border-gray-200 transition-all">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: action.color + '15' }}>
                <action.icon className="w-4 h-4" style={{ color: action.color }} />
              </div>
              <span className="text-xs font-semibold text-np-dark">{action.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-np-blue" />
            <h3 className="text-xs font-bold text-np-dark">Campaign Intelligence</h3>
            <span className="text-[8px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-medium">Bayesian</span>
          </div>
          {stats.campaigns > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Ranking engine active. Publish more content to sharpen campaign stack recommendations.</p>
              <Link href="/analytics" className="text-xs text-np-blue font-medium flex items-center gap-1 hover:underline">
                View Analytics <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Create your first campaign to activate the Bayesian ranking engine.</p>
          )}
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-green-500" />
            <h3 className="text-xs font-bold text-np-dark">Team</h3>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-np-dark">{stats.teamMembers}</p>
              <p className="text-[10px] text-gray-500">Active members</p>
            </div>
            <Link href="/team" className="text-xs text-np-blue font-medium flex items-center gap-1 hover:underline">
              Manage <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
