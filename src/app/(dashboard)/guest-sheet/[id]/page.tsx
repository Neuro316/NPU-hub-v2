'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import {
  Mic, Globe, Link2, Tag, Calendar, Mail, ExternalLink,
  User, CheckSquare, AlertTriangle, MessageSquare, Printer,
} from 'lucide-react'

const DEFAULT_GUEST_PROFILE = {
  name: 'Cameron Allen',
  title: 'Founder, Neuro Progeny & Sensorium Neuro Wellness',
  email: 'cameron@neuroprogeny.com',
  website: 'neuroprogeny.com',
  bio_short: 'Cameron Allen is the founder of Neuro Progeny and Sensorium Neuro Wellness, where he develops capacity-based nervous system training programs using VR biofeedback and HRV monitoring. His work reframes nervous system states as adaptive capacities rather than deficits.',
  preferred_intro: "Today's guest is Cameron Allen, founder of Neuro Progeny and Sensorium Neuro Wellness. Cameron is pioneering a capacity-based approach to nervous system training \u2014 using VR biofeedback and HRV monitoring to help people develop greater nervous system range. His philosophy is simple but powerful: your nervous system isn't broken, it's showing you evidence of its capacity. Cameron, welcome to the show.",
  verbal_cta_template: "If this resonates with you, head to neuroprogeny.com/courses/free \u2014 I've put together a free nervous system training course that walks you through the capacity model.",
  avoid_topics: ['Specific client medical diagnoses', 'Guarantees about clinical outcomes', 'Comparisons to specific competitor programs'],
  social: {
    instagram: '@neuroprogeny',
    linkedin: 'linkedin.com/in/cameronallen-np',
    youtube: '@neuroprogeny',
    x: '@neuroprogeny',
  },
  headshot_url: null as string | null,
}

interface Appearance {
  id: string
  org_id: string
  type: string
  entry_type: string
  title: string
  platform: string | null
  host: string | null
  recording_date: string | null
  air_date: string | null
  url: string | null
  description: string | null
  key_topics: string[]
  key_quotes: string[]
  verbal_cta: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  promo_code: string | null
  affiliate_tier: string
  status: string
}

const CROSS_PROMO_ITEMS = [
  { label: 'Share episode to social media within 48 hours of airing', icon: Globe },
  { label: 'Use only UTM-tagged links in show notes and descriptions', icon: Link2 },
  { label: 'Include promo code in episode description', icon: Tag },
  { label: 'Multi-post promotion preferred (launch day + 7-day + 14-day)', icon: Calendar },
]

const SHOW_NOTES_CHECKLIST = [
  'Guest name and title',
  'Website link (with UTM parameters)',
  'Free course link (with UTM parameters)',
  'Promo code (if applicable)',
  'Social media handles',
  'Short guest bio',
  'Episode topic summary',
  'Key timestamps / chapters',
]

export default function GuestSheetPage() {
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()
  const { currentOrg } = useWorkspace()

  const [appearance, setAppearance] = useState<Appearance | null>(null)
  const [guestProfile, setGuestProfile] = useState(DEFAULT_GUEST_PROFILE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id || !currentOrg) return
    setLoading(true)

    Promise.all([
      supabase.from('media_appearances').select('*').eq('id', id).single(),
      supabase.from('organizations').select('guest_profile').eq('id', currentOrg.id).single(),
    ]).then(([appRes, orgRes]) => {
      if (appRes.data) setAppearance(appRes.data)
      if (orgRes.data?.guest_profile && typeof orgRes.data.guest_profile === 'object') {
        setGuestProfile(prev => ({ ...prev, ...orgRes.data.guest_profile as any }))
      }
      setLoading(false)
    })
  }, [id, currentOrg?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading guest sheet...</div>
      </div>
    )
  }

  if (!appearance) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Appearance not found.</div>
      </div>
    )
  }

  const showSlug = (appearance.platform || appearance.title || 'show').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const ctaLink = `https://neuroprogeny.com/courses/free?utm_source=podcast&utm_medium=audio&utm_campaign=${showSlug}`
  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'TBD'
  const topics = appearance.key_topics?.length > 0 ? appearance.key_topics : []

  return (
    <>
      {/* Print styles */}
      <style jsx global>{`
        @media print {
          /* Aggressively hide ALL navigation, sidebar, and chrome */
          nav, aside, header,
          [data-sidebar], [data-topbar],
          [class*="sidebar"], [class*="Sidebar"],
          [class*="nav-"], [class*="Nav"],
          [role="navigation"],
          .no-print, button.no-print,
          .fixed {
            display: none !important;
          }

          /* Target common Next.js layout wrappers for sidebar/nav */
          body > div > div > aside,
          body > div > div > nav,
          body > div > div > header {
            display: none !important;
          }

          /* Reset layout for print — override all wrapper margins/padding */
          main, [role="main"], .guest-sheet-content,
          [data-main-content],
          body > div, body > div > div, body > div > div > div,
          body > div > div > main {
            margin: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            margin-left: 0 !important;
            padding-left: 0 !important;
          }

          body { background: white !important; }

          @page {
            margin: 0.6in 0.75in 1in 0.75in;
            size: letter;
          }

          .print-page-break { break-before: page; }
          .print-avoid-break { break-inside: avoid; }

          /* Fixed footer logo on every printed page */
          .guest-sheet-print-footer {
            display: block !important;
            position: fixed;
            bottom: 0;
            left: 0;
          }
        }
      `}</style>

      <div className="guest-sheet-content max-w-4xl mx-auto p-6 print:p-0 print:max-w-none">
        {/* Print button - hidden in print */}
        <div className="no-print mb-6 flex items-center justify-between">
          <button
            onClick={() => window.history.back()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            &larr; Back
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-np-blue text-white rounded-lg text-sm font-medium hover:bg-np-blue/90"
          >
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>

        {/* ═══════ HEADER ═══════ */}
        <div className="text-center mb-8 pb-6 border-b-2 border-np-blue/20 print-avoid-break">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Mic className="w-5 h-5 text-np-blue" />
            <span className="text-xs font-bold tracking-widest uppercase text-np-blue">Neuro Progeny</span>
          </div>
          <h1 className="text-3xl font-bold text-np-dark mb-2 font-display">Guest Sheet</h1>
          <p className="text-gray-500">
            Prepared for <span className="font-semibold text-np-dark">{appearance.platform || appearance.title}</span>
            {appearance.host && <> &bull; Hosted by <span className="font-semibold text-np-dark">{appearance.host}</span></>}
          </p>
        </div>

        {/* ═══════ SHOW INFO ═══════ */}
        <div className="bg-np-blue/5 border border-np-blue/15 rounded-xl p-5 mb-6 print-avoid-break">
          <h2 className="text-sm font-bold text-np-blue uppercase tracking-wider mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Show Information
          </h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-400 text-xs block mb-0.5">Episode Topic</span>
              <span className="text-np-dark font-medium">{appearance.description || appearance.title}</span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block mb-0.5">Recording Date</span>
              <span className="text-np-dark font-medium">{formatDate(appearance.recording_date)}</span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block mb-0.5">Air Date</span>
              <span className="text-np-dark font-medium">{formatDate(appearance.air_date)}</span>
            </div>
          </div>
        </div>

        {/* ═══════ YOUR GUEST ═══════ */}
        <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6 print-avoid-break">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <User className="w-4 h-4" /> Your Guest
          </h2>
          <div className="flex gap-6">
            {/* Headshot */}
            <div className="flex-shrink-0">
              {guestProfile.headshot_url ? (
                <img src={guestProfile.headshot_url} alt={guestProfile.name} className="w-28 h-28 rounded-xl object-cover border border-gray-200" />
              ) : (
                <div className="w-28 h-28 rounded-xl bg-gray-100 flex items-center justify-center border border-gray-200">
                  <User className="w-12 h-12 text-gray-300" />
                </div>
              )}
            </div>
            {/* Info */}
            <div className="flex-1">
              <h3 className="text-xl font-bold text-np-dark">{guestProfile.name}</h3>
              <p className="text-sm text-gray-500 mb-3">{guestProfile.title}</p>
              <p className="text-sm text-gray-700 leading-relaxed mb-3">{guestProfile.bio_short}</p>
              <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                {guestProfile.social?.instagram && <span className="flex items-center gap-1">IG: {guestProfile.social.instagram}</span>}
                {guestProfile.social?.linkedin && <span className="flex items-center gap-1">LI: {guestProfile.social.linkedin}</span>}
                {guestProfile.social?.youtube && <span className="flex items-center gap-1">YT: {guestProfile.social.youtube}</span>}
                {guestProfile.social?.x && <span className="flex items-center gap-1">X: {guestProfile.social.x}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* ═══════ LINKS ═══════ */}
        <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6 print-avoid-break">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Link2 className="w-4 h-4" /> Links for Show Notes
          </h2>

          <div className="space-y-3 mb-4">
            <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
              <ExternalLink className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs font-bold text-blue-700 block mb-0.5">Primary CTA (with UTM tracking)</span>
                <span className="text-sm text-blue-900 font-mono break-all">{ctaLink}</span>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <Globe className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs font-bold text-gray-500 block mb-0.5">Website</span>
                <span className="text-sm text-gray-700">{guestProfile.website}</span>
              </div>
            </div>
          </div>

          {appearance.promo_code && (
            <div>
              <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
                <span className="text-xs font-bold text-green-600 block mb-1">PROMO CODE</span>
                <span className="text-2xl font-bold text-green-700 font-mono tracking-wider">{appearance.promo_code}</span>
              </div>
              <div className="mt-3 bg-green-50/50 border border-green-100 rounded-lg p-4">
                <span className="text-xs font-bold text-green-700 block mb-1.5">Here&apos;s what to tell your listeners:</span>
                <p className="text-sm text-green-800 italic leading-relaxed">
                  &ldquo;Head to neuroprogeny.com/courses/free and use the code <span className="font-bold not-italic">{appearance.promo_code}</span> for instant access to a free nervous system training course.&rdquo;
                </p>
              </div>
            </div>
          )}

          {appearance.affiliate_tier && appearance.affiliate_tier !== 'none' && (
            <div className="mt-3 p-3 bg-amber-50 rounded-lg">
              <span className="text-xs font-bold text-amber-600">Affiliate Tier:</span>
              <span className="text-sm text-amber-700 ml-2">{appearance.affiliate_tier.replace('tier', 'Tier ')}</span>
            </div>
          )}
        </div>

        {/* ═══════ PREFERRED INTRO ═══════ */}
        <div className="print-page-break"></div>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-6 mb-6 print-avoid-break">
          <h2 className="text-sm font-bold text-purple-700 uppercase tracking-wider mb-3 flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> Preferred Introduction
          </h2>
          <blockquote className="text-sm text-purple-900 leading-relaxed italic border-l-4 border-purple-300 pl-4">
            &ldquo;{guestProfile.preferred_intro}&rdquo;
          </blockquote>
        </div>

        {/* ═══════ TOPICS ═══════ */}
        <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6 print-avoid-break">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Talking Points</h2>
          {topics.length > 0 ? (
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
              {topics.map((t, i) => (
                <li key={i} className="leading-relaxed">{t}</li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-gray-400 italic">No specific talking points set for this appearance. Discuss with host.</p>
          )}

          {/* Avoid topics */}
          {guestProfile.avoid_topics?.length > 0 && (
            <div className="mt-5 bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Topics to Avoid
              </h3>
              <ul className="space-y-1">
                {guestProfile.avoid_topics.map((t, i) => (
                  <li key={i} className="text-sm text-red-700 flex items-start gap-2">
                    <span className="text-red-400 mt-0.5">&times;</span> {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verbal CTA */}
          {(appearance.verbal_cta || guestProfile.verbal_cta_template) && (
            <div className="mt-5 bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h3 className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-2">Verbal CTA</h3>
              <p className="text-sm text-purple-900 italic leading-relaxed">
                &ldquo;{appearance.verbal_cta || guestProfile.verbal_cta_template}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* ═══════ CROSS-PROMO ═══════ */}
        <div className="bg-white border border-gray-100 rounded-xl p-6 mb-6 print-avoid-break">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Cross-Promotion Requirements</h2>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {CROSS_PROMO_ITEMS.map((item, i) => {
              const Icon = item.icon
              return (
                <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <Icon className="w-4 h-4 text-np-blue mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-gray-700">{item.label}</span>
                </div>
              )
            })}
          </div>

          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Show Notes Checklist</h3>
          <div className="grid grid-cols-2 gap-2">
            {SHOW_NOTES_CHECKLIST.map((item, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-gray-600">
                <CheckSquare className="w-4 h-4 text-gray-300 flex-shrink-0" />
                {item}
              </label>
            ))}
          </div>
        </div>

        {/* ═══════ CONTACT ═══════ */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 print-avoid-break">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4" /> Contact
          </h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-400 text-xs block mb-0.5">Name</span>
              <span className="text-np-dark font-medium">{guestProfile.name}</span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block mb-0.5">Email</span>
              <span className="text-np-dark font-medium">{guestProfile.email}</span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block mb-0.5">Website</span>
              <span className="text-np-dark font-medium">{guestProfile.website}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4">Questions about this guest sheet? Reach out to {guestProfile.email}</p>
        </div>

        <div className="no-print text-center mt-8 text-xs text-gray-300">
          Generated from NPU Hub &bull; {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Print-only footer logo — fixed position shows on every printed page */}
      <div className="guest-sheet-print-footer hidden" aria-hidden="true">
        <img src="/images/np-logo.png" alt="Neuro Progeny" style={{ height: '40px', opacity: 0.8 }} />
      </div>
    </>
  )
}
