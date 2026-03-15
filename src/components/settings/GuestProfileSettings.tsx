'use client'

import { useEffect, useState, useRef } from 'react'
import { Save, Upload, Loader2, CheckCircle2, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'

interface GuestProfileData {
  guest_name: string
  guest_title: string
  email: string
  website: string
  short_bio: string
  preferred_introduction: string
  verbal_cta_template: string
  topics_to_avoid: string
  social_instagram: string
  social_linkedin: string
  social_youtube: string
  social_twitter: string
  headshot_url: string
  cross_promotion_requirements: string
}

const EMPTY_PROFILE: GuestProfileData = {
  guest_name: 'Cameron Allen',
  guest_title: '',
  email: '',
  website: '',
  short_bio: '',
  preferred_introduction: '',
  verbal_cta_template: '',
  topics_to_avoid: '',
  social_instagram: '',
  social_linkedin: '',
  social_youtube: '',
  social_twitter: '',
  headshot_url: '',
  cross_promotion_requirements: '',
}

export default function GuestProfileSettings() {
  const { currentOrg } = useWorkspace()
  const [data, setData] = useState<GuestProfileData>({ ...EMPTY_PROFILE })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Load on mount
  useEffect(() => {
    if (!currentOrg) return
    const supabase = createClient()
    supabase
      .from('organizations')
      .select('guest_profile')
      .eq('id', currentOrg.id)
      .maybeSingle()
      .then(({ data: row }) => {
        if (row?.guest_profile) {
          setData(prev => ({ ...prev, ...row.guest_profile }))
        }
      })
  }, [currentOrg])

  const set = (key: keyof GuestProfileData, value: string) =>
    setData(prev => ({ ...prev, [key]: value }))

  const handleSave = async () => {
    if (!currentOrg) return
    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('organizations')
        .update({ guest_profile: data })
        .eq('id', currentOrg.id)
      if (error) throw error
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error('Failed to save guest profile:', e)
      alert('Failed to save guest profile. Check console for details.')
    } finally {
      setSaving(false)
    }
  }

  const handleHeadshotUpload = async (file: File) => {
    if (!currentOrg) return
    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const path = `${currentOrg.id}/headshot-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('headshots')
        .upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage
        .from('headshots')
        .getPublicUrl(path)
      set('headshot_url', urlData.publicUrl)
    } catch (e) {
      console.error('Headshot upload failed:', e)
      alert('Failed to upload headshot. Check console for details.')
    } finally {
      setUploading(false)
    }
  }

  const inputCls = 'w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30'
  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400'

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-np-dark">Guest Profile</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Default guest information used for podcast appearances and media outreach.
        </p>
      </div>

      {/* Name & Title */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Guest Name</label>
          <input value={data.guest_name} onChange={e => set('guest_name', e.target.value)}
            placeholder="Cameron Allen" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Guest Title</label>
          <input value={data.guest_title} onChange={e => set('guest_title', e.target.value)}
            placeholder="Founder & CEO" className={inputCls} />
        </div>
      </div>

      {/* Email & Website */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Email</label>
          <input type="email" value={data.email} onChange={e => set('email', e.target.value)}
            placeholder="cameron@neuroprogeny.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Website</label>
          <input value={data.website} onChange={e => set('website', e.target.value)}
            placeholder="https://neuroprogeny.com" className={inputCls} />
        </div>
      </div>

      {/* Short Bio */}
      <div>
        <label className={labelCls}>Short Bio</label>
        <textarea value={data.short_bio} onChange={e => set('short_bio', e.target.value)}
          rows={3} placeholder="A brief bio for podcast hosts and media kits..."
          className={inputCls} />
      </div>

      {/* Preferred Introduction */}
      <div>
        <label className={labelCls}>Preferred Introduction</label>
        <textarea value={data.preferred_introduction} onChange={e => set('preferred_introduction', e.target.value)}
          rows={3} placeholder="How you'd like to be introduced by hosts..."
          className={inputCls} />
      </div>

      {/* Verbal CTA Template */}
      <div>
        <label className={labelCls}>Verbal CTA Template</label>
        <textarea value={data.verbal_cta_template} onChange={e => set('verbal_cta_template', e.target.value)}
          rows={3} placeholder="Your go-to call-to-action for live appearances..."
          className={inputCls} />
      </div>

      {/* Topics to Avoid */}
      <div>
        <label className={labelCls}>Topics to Avoid</label>
        <textarea value={data.topics_to_avoid} onChange={e => set('topics_to_avoid', e.target.value)}
          rows={3} placeholder="One topic per line..."
          className={inputCls} />
        <p className="text-[9px] text-gray-400 mt-1">One topic per line</p>
      </div>

      {/* Social Handles */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Social Handles</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Instagram</label>
            <input value={data.social_instagram} onChange={e => set('social_instagram', e.target.value)}
              placeholder="@handle" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>LinkedIn</label>
            <input value={data.social_linkedin} onChange={e => set('social_linkedin', e.target.value)}
              placeholder="linkedin.com/in/..." className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>YouTube</label>
            <input value={data.social_youtube} onChange={e => set('social_youtube', e.target.value)}
              placeholder="@channel" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>X / Twitter</label>
            <input value={data.social_twitter} onChange={e => set('social_twitter', e.target.value)}
              placeholder="@handle" className={inputCls} />
          </div>
        </div>
      </div>

      {/* Headshot Upload */}
      <div className="border-t border-gray-100 pt-4">
        <label className={labelCls}>Headshot</label>
        <div className="flex items-center gap-4 mt-2">
          {data.headshot_url ? (
            <div className="relative">
              <img src={data.headshot_url} alt="Headshot" className="w-16 h-16 rounded-lg object-cover border border-gray-100" />
              <button onClick={() => set('headshot_url', '')}
                className="absolute -top-1.5 -right-1.5 p-0.5 bg-white border border-gray-200 rounded-full text-gray-400 hover:text-red-500">
                <Trash2 size={10} />
              </button>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300">
              <Upload size={16} />
            </div>
          )}
          <div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleHeadshotUpload(e.target.files[0]) }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-np-blue border border-np-blue/20 rounded-lg hover:bg-np-blue/5 disabled:opacity-40">
              {uploading ? <><Loader2 size={12} className="animate-spin" /> Uploading...</> : <><Upload size={12} /> Upload Image</>}
            </button>
            <p className="text-[9px] text-gray-400 mt-1">JPG, PNG, or WebP. Stored in Supabase.</p>
          </div>
        </div>
      </div>

      {/* Cross-Promotion Requirements */}
      <div>
        <label className={labelCls}>Cross-Promotion Requirements</label>
        <textarea value={data.cross_promotion_requirements} onChange={e => set('cross_promotion_requirements', e.target.value)}
          rows={3} placeholder="Any requirements or preferences for cross-promotion..."
          className={inputCls} />
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100">
        {saved && <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium"><CheckCircle2 size={12} /> Saved</span>}
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">
          <Save size={12} /> {saving ? 'Saving...' : 'Save Guest Profile'}
        </button>
      </div>
    </div>
  )
}
