'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, Save, ExternalLink, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface Appearance {
  id: string
  org_id: string
  title: string
  platform: string | null
  host: string | null
  recording_date: string | null
  air_date: string | null
  description: string | null
  key_topics: string[]
  verbal_cta: string | null
  promo_code: string | null
  utm_campaign: string | null
  affiliate_tier: string
  guest_sheet_overrides?: Record<string, unknown>
}

interface GuestProfile {
  guest_name?: string
  guest_title?: string
  short_bio?: string
  preferred_introduction?: string
  verbal_cta_template?: string
  topics_to_avoid?: string
  cross_promotion_requirements?: string
  cta_base_url?: string
}

interface GuestSheetModalProps {
  appearance: Appearance
  orgId: string
  onClose: () => void
}

export default function GuestSheetModal({ appearance, orgId, onClose }: GuestSheetModalProps) {
  const [guestProfile, setGuestProfile] = useState<GuestProfile>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form fields
  const [guestName, setGuestName] = useState('')
  const [guestTitle, setGuestTitle] = useState('')
  const [shortBio, setShortBio] = useState('')
  const [episodeTopic, setEpisodeTopic] = useState('')
  const [recordingDate, setRecordingDate] = useState('')
  const [airDate, setAirDate] = useState('')
  const [preferredIntro, setPreferredIntro] = useState('')
  const [ctaBaseUrl, setCtaBaseUrl] = useState('')
  const [verbalCta, setVerbalCta] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [talkingPoints, setTalkingPoints] = useState('')
  const [topicsToAvoid, setTopicsToAvoid] = useState('')
  const [crossPromo, setCrossPromo] = useState('')

  // Load guest profile and merge sources
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('organizations')
      .select('guest_profile')
      .eq('id', orgId)
      .single()
      .then(({ data: orgRow }) => {
        const profile = (orgRow?.guest_profile as GuestProfile) || {}
        setGuestProfile(profile)

        const overrides = (appearance.guest_sheet_overrides || {}) as Record<string, string>

        // Merge: overrides > appearance-specific > profile defaults
        setGuestName(overrides.guest_name || profile.guest_name || 'Cameron Allen')
        setGuestTitle(overrides.guest_title || profile.guest_title || '')
        setShortBio(overrides.short_bio || profile.short_bio || '')
        setEpisodeTopic(overrides.episode_topic || appearance.description || appearance.title || '')
        setRecordingDate(overrides.recording_date || formatDateForInput(appearance.recording_date))
        setAirDate(overrides.air_date || formatDateForInput(appearance.air_date))
        setPreferredIntro(overrides.preferred_introduction || profile.preferred_introduction || '')
        setCtaBaseUrl(overrides.cta_base_url || profile.cta_base_url || 'https://neuroprogeny.com/courses/free')
        setVerbalCta(overrides.verbal_cta || appearance.verbal_cta || profile.verbal_cta_template || '')
        setPromoCode(overrides.promo_code || appearance.promo_code || '')
        setTalkingPoints(overrides.talking_points || (appearance.key_topics?.length ? appearance.key_topics.join('\n') : ''))
        setTopicsToAvoid(overrides.topics_to_avoid || profile.topics_to_avoid || '')
        setCrossPromo(overrides.cross_promotion_requirements || profile.cross_promotion_requirements || '')

        setLoading(false)
      })
  }, [appearance, orgId])

  const showSlug = useMemo(
    () => (appearance.platform || appearance.title || 'show').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    [appearance.platform, appearance.title]
  )

  const utmPreview = useMemo(
    () => ctaBaseUrl ? `${ctaBaseUrl}?utm_source=podcast&utm_medium=audio&utm_campaign=${showSlug}` : '',
    [ctaBaseUrl, showSlug]
  )

  const buildOverrides = () => ({
    guest_name: guestName,
    guest_title: guestTitle,
    short_bio: shortBio,
    episode_topic: episodeTopic,
    recording_date: recordingDate,
    air_date: airDate,
    preferred_introduction: preferredIntro,
    cta_base_url: ctaBaseUrl,
    verbal_cta: verbalCta,
    promo_code: promoCode,
    talking_points: talkingPoints,
    topics_to_avoid: topicsToAvoid,
    cross_promotion_requirements: crossPromo,
  })

  const handleSaveAndGenerate = async () => {
    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('media_appearances')
        .update({ guest_sheet_overrides: buildOverrides() })
        .eq('id', appearance.id)
      if (error) throw error
      window.open(`/guest-sheet/${appearance.id}`, '_blank')
      onClose()
    } catch (e) {
      console.error('Failed to save guest sheet overrides:', e)
      alert('Failed to save. Check console for details.')
    } finally {
      setSaving(false)
    }
  }

  const handleGenerateWithoutSaving = () => {
    window.open(`/guest-sheet/${appearance.id}`, '_blank')
    onClose()
  }

  const inputCls = 'w-full mt-1 px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30'
  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400'
  const sectionCls = 'border-b border-gray-100 pb-4'

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div className="bg-white rounded-xl p-8" onClick={e => e.stopPropagation()}>
          <Loader2 className="w-6 h-6 animate-spin text-np-blue mx-auto" />
          <p className="text-sm text-gray-400 mt-2">Loading guest sheet data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <div>
            <h2 className="text-sm font-bold text-np-dark">Guest Sheet Editor</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {appearance.platform || appearance.title}
              {appearance.host ? ` · ${appearance.host}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* GUEST INFO */}
          <div className={sectionCls}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-np-blue mb-3">Guest Info</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Name</label>
                <input value={guestName} onChange={e => setGuestName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Title</label>
                <input value={guestTitle} onChange={e => setGuestTitle(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="mt-3">
              <label className={labelCls}>Short Bio</label>
              <textarea value={shortBio} onChange={e => setShortBio(e.target.value)} rows={3} className={inputCls} />
            </div>
          </div>

          {/* SHOW INFO */}
          <div className={sectionCls}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-np-blue mb-3">Show Info</p>
            <div className="mb-3">
              <label className={labelCls}>Episode Topic</label>
              <input value={episodeTopic} onChange={e => setEpisodeTopic(e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Recording Date</label>
                <input type="date" value={recordingDate} onChange={e => setRecordingDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Air Date</label>
                <input type="date" value={airDate} onChange={e => setAirDate(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          {/* PREFERRED INTRODUCTION */}
          <div className={sectionCls}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-np-blue mb-3">Preferred Introduction</p>
            <textarea value={preferredIntro} onChange={e => setPreferredIntro(e.target.value)} rows={4} className={inputCls} />
          </div>

          {/* CTA & LINKS */}
          <div className={sectionCls}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-np-blue mb-3">CTA &amp; Links</p>
            <div className="mb-3">
              <label className={labelCls}>CTA Base URL</label>
              <input value={ctaBaseUrl} onChange={e => setCtaBaseUrl(e.target.value)} className={inputCls} />
              {utmPreview && (
                <div className="mt-1.5 p-2 bg-blue-50 rounded-lg">
                  <span className="text-[9px] font-semibold uppercase text-blue-500 block mb-0.5">Full URL with UTM</span>
                  <span className="text-[11px] text-blue-700 font-mono break-all">{utmPreview}</span>
                </div>
              )}
            </div>
            <div className="mb-3">
              <label className={labelCls}>Verbal CTA Template</label>
              <textarea value={verbalCta} onChange={e => setVerbalCta(e.target.value)} rows={3} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Promo Code</label>
              <input value={promoCode} onChange={e => setPromoCode(e.target.value)} placeholder="e.g. PODCAST-SHOWNAME" className={inputCls} />
            </div>
          </div>

          {/* TALKING POINTS */}
          <div className={sectionCls}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-np-blue mb-3">Talking Points</p>
            <textarea value={talkingPoints} onChange={e => setTalkingPoints(e.target.value)} rows={4}
              placeholder="One per line..." className={inputCls} />
            <p className="text-[9px] text-gray-400 mt-1">One topic per line</p>
          </div>

          {/* TOPICS TO AVOID */}
          <div className={sectionCls}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-np-blue mb-3">Topics to Avoid</p>
            <textarea value={topicsToAvoid} onChange={e => setTopicsToAvoid(e.target.value)} rows={3}
              placeholder="One per line..." className={inputCls} />
          </div>

          {/* CROSS-PROMOTION */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-np-blue mb-3">Cross-Promotion Requirements</p>
            <textarea value={crossPromo} onChange={e => setCrossPromo(e.target.value)} rows={3} className={inputCls} />
          </div>
        </div>

        {/* Footer buttons */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex items-center justify-end gap-3 rounded-b-xl">
          <button
            onClick={handleGenerateWithoutSaving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Generate Without Saving
          </button>
          <button
            onClick={handleSaveAndGenerate}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-np-blue rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving...' : 'Save & Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDateForInput(d: string | null | undefined): string {
  if (!d) return ''
  // Strip timezone suffix and take just YYYY-MM-DD
  const clean = d.replace(/([+-]\d{2}:\d{2}|Z)$/, '')
  return clean.slice(0, 10)
}
