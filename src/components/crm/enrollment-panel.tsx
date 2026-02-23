'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Check, FileText, ExternalLink, ClipboardCheck, AlertCircle, Loader2, ChevronDown, ChevronRight, Shield } from 'lucide-react'

interface EnrollmentService {
  id: string; name: string
  consent_form_library_id: string | null
  intake_form_id: string | null
  active: boolean
}

interface ContactService {
  service_id: string
  consent_signed: boolean; consent_date: string | null
  intake_completed: boolean; intake_date: string | null
}

interface ConsentForm {
  form_id: string; form_name: string
  signed: boolean; signed_date: string | null; file_url: string | null
}

interface LibraryDoc { id: string; title: string; category: string; file_url: string | null }

export default function EnrollmentPanel({ contactId, orgId, enrolledServices, consentForms, onUpdate }: {
  contactId: string; orgId: string
  enrolledServices: ContactService[]
  consentForms: ConsentForm[]
  onUpdate: (services: ContactService[], forms: ConsentForm[]) => void
}) {
  const supabase = createClient()
  const [orgServices, setOrgServices] = useState<EnrollmentService[]>([])
  const [libraryDocs, setLibraryDocs] = useState<LibraryDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedService, setExpandedService] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    Promise.all([
      supabase.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'crm_enrollment_config').maybeSingle(),
      supabase.from('company_library').select('id, title, category, file_url').eq('org_id', orgId).order('title'),
    ]).then(([configRes, libRes]) => {
      const config = configRes.data?.setting_value
      if (config?.services) setOrgServices(config.services.filter((s: any) => s.active))
      if (libRes.data) setLibraryDocs(libRes.data)
      setLoading(false)
    })
  }, [orgId])

  const localServices = [...enrolledServices]
  const localForms = [...consentForms]

  const isServiceChecked = (sId: string) => localServices.some(s => s.service_id === sId)

  const toggleService = (svc: EnrollmentService) => {
    const exists = localServices.find(s => s.service_id === svc.id)
    let updatedServices: ContactService[]
    let updatedForms = [...localForms]

    if (exists) {
      // Remove service + its consent form
      updatedServices = localServices.filter(s => s.service_id !== svc.id)
      if (svc.consent_form_library_id) {
        updatedForms = updatedForms.filter(f => f.form_id !== svc.consent_form_library_id)
      }
    } else {
      // Add service + its consent form placeholder
      updatedServices = [...localServices, {
        service_id: svc.id, consent_signed: false, consent_date: null,
        intake_completed: false, intake_date: null,
      }]
      if (svc.consent_form_library_id) {
        const doc = libraryDocs.find(d => d.id === svc.consent_form_library_id)
        if (doc && !updatedForms.some(f => f.form_id === doc.id)) {
          updatedForms.push({
            form_id: doc.id, form_name: doc.title,
            signed: false, signed_date: null, file_url: doc.file_url,
          })
        }
      }
    }
    onUpdate(updatedServices, updatedForms)
  }

  const toggleConsent = (formId: string) => {
    const updatedForms = localForms.map(f => f.form_id === formId ? {
      ...f, signed: !f.signed, signed_date: !f.signed ? new Date().toISOString() : null
    } : f)
    // Also update the service consent_signed flag
    const updatedServices = localServices.map(s => {
      const svc = orgServices.find(os => os.id === s.service_id)
      if (svc?.consent_form_library_id === formId) {
        const form = updatedForms.find(f => f.form_id === formId)
        return { ...s, consent_signed: form?.signed || false, consent_date: form?.signed_date || null }
      }
      return s
    })
    onUpdate(updatedServices, updatedForms)
  }

  const toggleIntake = (serviceId: string) => {
    const updatedServices = localServices.map(s =>
      s.service_id === serviceId ? { ...s, intake_completed: !s.intake_completed, intake_date: !s.intake_completed ? new Date().toISOString() : null } : s
    )
    onUpdate(updatedServices, localForms)
  }

  if (loading) return <div className="flex items-center gap-2 text-xs text-gray-400 py-4"><Loader2 size={12} className="animate-spin" /> Loading enrollment config...</div>

  if (orgServices.length === 0) return (
    <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
      <div className="flex items-center gap-2 text-xs text-amber-600 font-semibold">
        <AlertCircle size={13} /> No services configured
      </div>
      <p className="text-[10px] text-amber-500 mt-1">Go to CRM Settings → Enrollment to set up services and consent forms.</p>
    </div>
  )

  const checkedCount = localServices.length
  const consentCount = localForms.filter(f => f.signed).length
  const totalConsent = localForms.length

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={13} className="text-teal" />
          <span className="text-xs font-bold text-np-dark">Enrollment & Consent</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="font-semibold text-teal">{checkedCount} services</span>
          {totalConsent > 0 && (
            <span className={`font-semibold ${consentCount === totalConsent ? 'text-green-500' : 'text-amber-500'}`}>
              {consentCount}/{totalConsent} forms signed
            </span>
          )}
        </div>
      </div>

      {/* Service checkboxes */}
      <div className="space-y-1.5">
        {orgServices.map(svc => {
          const checked = isServiceChecked(svc.id)
          const contactSvc = localServices.find(s => s.service_id === svc.id)
          const consentDoc = svc.consent_form_library_id ? libraryDocs.find(d => d.id === svc.consent_form_library_id) : null
          const consentForm = svc.consent_form_library_id ? localForms.find(f => f.form_id === svc.consent_form_library_id) : null
          const isExpanded = expandedService === svc.id

          return (
            <div key={svc.id} className={`rounded-xl border overflow-hidden transition-all ${
              checked ? 'border-teal/30 bg-teal/[0.02]' : 'border-gray-100'
            }`}>
              {/* Service row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => toggleService(svc)}
                  className={`w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 transition-colors ${
                    checked ? 'bg-teal border-teal' : 'border-gray-200 hover:border-teal'
                  }`}>
                  {checked && <Check size={11} className="text-white" strokeWidth={3} />}
                </button>
                <span className={`text-xs font-semibold flex-1 ${checked ? 'text-np-dark' : 'text-gray-400'}`}>{svc.name}</span>

                {checked && (
                  <div className="flex items-center gap-2">
                    {consentForm && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                        consentForm.signed ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
                      }`}>{consentForm.signed ? '✓ Consent' : '⚠ Consent'}</span>
                    )}
                    {contactSvc && svc.intake_form_id && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                        contactSvc.intake_completed ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                      }`}>{contactSvc.intake_completed ? '✓ Intake' : '○ Intake'}</span>
                    )}
                    <button onClick={() => setExpandedService(isExpanded ? null : svc.id)}
                      className="text-gray-300 hover:text-np-dark">
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  </div>
                )}
              </div>

              {/* Expanded: consent form + intake */}
              {checked && isExpanded && (
                <div className="px-4 pb-3 space-y-2 border-t border-gray-100 pt-2 bg-gray-50/50">
                  {/* Consent form */}
                  {consentDoc && consentForm && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleConsent(consentDoc.id)}
                        className={`w-4 h-4 rounded flex items-center justify-center border-2 shrink-0 ${
                          consentForm.signed ? 'bg-green-500 border-green-500' : 'border-gray-300'
                        }`}>{consentForm.signed && <Check size={9} className="text-white" strokeWidth={3} />}</button>
                      <FileText size={11} className="text-gray-400 shrink-0" />
                      <span className="text-[10px] text-np-dark flex-1">{consentDoc.title}</span>
                      {consentDoc.file_url && (
                        <a href={consentDoc.file_url} target="_blank" rel="noopener noreferrer"
                          className="text-[9px] text-np-blue flex items-center gap-0.5 hover:underline">
                          <ExternalLink size={9} /> View
                        </a>
                      )}
                      {consentForm.signed && consentForm.signed_date && (
                        <span className="text-[9px] text-green-500">Signed {new Date(consentForm.signed_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  )}
                  {!consentDoc && svc.consent_form_library_id && (
                    <p className="text-[10px] text-amber-500">⚠ Consent form not found in library</p>
                  )}
                  {!svc.consent_form_library_id && (
                    <p className="text-[10px] text-gray-400">No consent form linked. Configure in CRM Settings → Enrollment.</p>
                  )}

                  {/* Intake form */}
                  {svc.intake_form_id && contactSvc && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleIntake(svc.id)}
                        className={`w-4 h-4 rounded flex items-center justify-center border-2 shrink-0 ${
                          contactSvc.intake_completed ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                        }`}>{contactSvc.intake_completed && <Check size={9} className="text-white" strokeWidth={3} />}</button>
                      <ClipboardCheck size={11} className="text-gray-400 shrink-0" />
                      <span className="text-[10px] text-np-dark flex-1">Intake Form</span>
                      <a href={`/neuroreport?form=${svc.intake_form_id}`} target="_blank"
                        className="text-[9px] text-np-blue flex items-center gap-0.5 hover:underline">
                        <ExternalLink size={9} /> Open in NeuroReport
                      </a>
                    </div>
                  )}
                  {!svc.intake_form_id && (
                    <p className="text-[10px] text-gray-400">No intake form linked.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
