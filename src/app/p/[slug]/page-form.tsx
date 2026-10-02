'use client'
// The form on a public landing page. It posts to the one public intake endpoint, which checks
// everything again against the stored definition; this component only collects and shows.
import { useState } from 'react'

interface Field { key: string; label: string; type: string; required?: boolean; options?: string[] }
interface Consent { id: string; text: string; required?: boolean }

const box = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm'

export function PageForm({ slug, fields, consents }: { slug: string; fields: Field[]; consents: Consent[] }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [ticked, setTicked] = useState<string[]>([])
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (k: string, v: string) => setValues({ ...values, [k]: v })

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrors({})
    const utm: Record<string, string> = {}
    new URLSearchParams(window.location.search).forEach((v, k) => { if (k.startsWith('utm_')) utm[k] = v.slice(0, 200) })
    try {
      const res = await fetch('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form: slug, values, consents: ticked, website, utm }) })
      const j = await res.json().catch(() => ({}))
      if (res.ok) setDone(j.message || 'Thank you.')
      else setErrors(j.errors || { _form: j.error || 'Something went wrong. Try again.' })
    } catch { setErrors({ _form: 'Something went wrong. Try again.' }) } finally { setBusy(false) }
  }

  if (done) return <p className="rounded-lg bg-np-blue-light p-4 text-np-dark">{done}</p>
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {fields.map((f) => (
        <label key={f.key} className="block text-sm text-np-dark">{f.label}{f.required && ' *'}
          {f.type === 'textarea' ? <textarea className={box} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            : f.type === 'select' ? <select className={box} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">Choose one</option>{(f.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>
            : <input className={box} type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />}
          {errors[f.key] && <span className="text-xs text-red-600">{errors[f.key]}</span>}
        </label>))}
      {consents.map((c) => (
        <label key={c.id} className="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={ticked.includes(c.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, c.id] : ticked.filter((x) => x !== c.id))} />
          <span>{c.text}{errors[`consent:${c.id}`] && <span className="block text-red-600">{errors[`consent:${c.id}`]}</span>}</span>
        </label>))}
      <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      {errors._form && <p className="text-sm text-red-600">{errors._form}</p>}
      <button type="submit" disabled={busy} className="rounded-lg bg-np-blue px-5 py-2.5 font-medium text-white hover:bg-np-blue-hover disabled:opacity-50">{busy ? 'Sending' : 'Send'}</button>
    </form>)
}
