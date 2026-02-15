'use client'

import { useState, useEffect } from 'react'

type TabId = 'privacy' | 'terms' | 'sms'

const TABS: { id: TabId; label: string }[] = [
  { id: 'privacy', label: 'Privacy Policy' },
  { id: 'terms', label: 'Terms & Conditions' },
  { id: 'sms', label: 'SMS Terms' },
]

export default function PoliciesPage() {
  const [activeTab, setActiveTab] = useState<TabId>('privacy')

  useEffect(() => {
    const hash = window.location.hash.replace('#', '') as TabId
    if (['privacy', 'terms', 'sms'].includes(hash)) {
      setActiveTab(hash)
    }
  }, [])

  const switchTab = (tab: TabId) => {
    setActiveTab(tab)
    window.history.replaceState(null, '', `#${tab}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen" style={{ background: '#f5f7f9', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div style={{ background: '#386797', padding: '24px 20px', textAlign: 'center' }}>
        <img src="https://storage.googleapis.com/msgsndr/Y84PhBsd1Ic7xKBHLuCc/media/6965af1298efbd32fc35e944.png" alt="Neuro Progeny" style={{ height: 40, marginBottom: 8 }} />
        <div style={{ fontFamily: "'DM Serif Display', serif", color: '#fff', fontSize: 18, letterSpacing: '0.02em' }}>Policies</div>
      </div>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px 60px' }}>
        <div style={{ display: 'flex', gap: 0, marginTop: 24, borderBottom: '2px solid #e5e8eb' }}>
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => switchTab(tab.id)} style={{ flex: 1, padding: '14px 12px', textAlign: 'center', fontSize: 14, fontWeight: 600, color: activeTab === tab.id ? '#386797' : '#666', cursor: 'pointer', borderBottom: `3px solid ${activeTab === tab.id ? '#386797' : 'transparent'}`, marginBottom: -2, transition: 'all 0.2s ease', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontFamily: 'inherit' }}>{tab.label}</button>
          ))}
        </div>
        <div style={{ background: '#fff', borderRadius: '0 0 12px 12px', padding: '32px 28px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {activeTab === 'privacy' && (
            <div>
              <EffectiveDate />
              <SectionHeading first>What We Collect</SectionHeading>
              <P>When you interact with Neuro Progeny assessments, programs, or communications, we may collect the following information:</P>
              <UL items={['Name, email address, and phone number (if provided)', 'Assessment and quiz responses', 'Optional demographic or health-related information you choose to share', 'Usage data related to how you interact with our tools and content']} />
              <SectionHeading>How We Use Your Data</SectionHeading>
              <P>Your information is used to:</P>
              <UL items={['Deliver your personalized assessment results and reports', 'Send follow-up educational content related to your results', 'Contact you about relevant programs and offerings, including the Immersive Mastermind', 'Send program updates, session reminders, and onboarding communications', 'Improve our assessments, tools, and services', 'Send occasional newsletters and educational updates']} />
              <SectionHeading>Consent to Contact</SectionHeading>
              <P>By submitting any Neuro Progeny assessment or providing your contact information through our forms, you consent to receive:</P>
              <UL items={['Your personalized report via email', 'Follow-up educational emails related to your results', 'Information about Neuro Progeny programs, events, and offerings']} />
              <P>If you have opted in to text communications, you also consent to receive SMS messages (see <InlineLink onClick={() => switchTab('sms')}>SMS Terms</InlineLink>).</P>
              <P>You may unsubscribe from email communications at any time by clicking the unsubscribe link in any email. You may opt out of SMS by texting <Keyword>STOP</Keyword> at any time.</P>
              <SectionHeading>Data Sharing</SectionHeading>
              <P><strong style={{ color: '#3E3E3E' }}>Your data is never sold or rented to third parties.</strong></P>
              <P>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes at any time. Information may be shared with service providers (such as email delivery and scheduling platforms) solely to support delivery of our services to you.</P>
              <SectionHeading>Data Security &amp; Retention</SectionHeading>
              <P>Your data is stored securely using industry-standard practices. We retain your information only for as long as necessary to provide our services or as required by law. Assessment data is stored in secure, access-controlled systems.</P>
              <SectionHeading>Your Rights</SectionHeading>
              <P>You may request access to, correction of, or deletion of your personal data at any time.</P>
              <ContactBox email="Admin@neuroprogeny.com" />
            </div>
          )}
          {activeTab === 'terms' && (
            <div>
              <EffectiveDate />
              <WarningBox />
              <SectionHeading>Educational Purpose</SectionHeading>
              <P>All Neuro Progeny assessments, including the Nervous System Capacity Index, Core Narratives Assessment, and related tools, are designed to increase self-awareness and provide educational insights about nervous system function and capacity. Results reflect patterns, not pathology.</P>
              <SectionHeading>Eligibility</SectionHeading>
              <P>You must be 18 years or older to complete any Neuro Progeny assessment or enroll in any Neuro Progeny program.</P>
              <SectionHeading>Consent to Communications</SectionHeading>
              <P>By submitting an assessment or enrolling in a program, you consent to receive your results and related communications from Neuro Progeny via email. If you provide a phone number and opt in to SMS, you also consent to receive text messages (see <InlineLink onClick={() => switchTab('sms')}>SMS Terms</InlineLink>). You may unsubscribe at any time.</P>
              <SectionHeading>Intellectual Property</SectionHeading>
              <P>All content, including assessment questions, scoring methodologies, educational materials, curriculum, and program frameworks, is the property of Neuro Progeny and may not be reproduced, distributed, or modified without written permission.</P>
              <SectionHeading>Limitation of Liability</SectionHeading>
              <P>Neuro Progeny is not liable for any decisions made based on assessment results, educational content, or program participation. All tools and programs are provided on an &ldquo;as is&rdquo; basis without warranties of any kind, express or implied.</P>
              <SectionHeading>Governing Law</SectionHeading>
              <P>These terms are governed by the laws of the State of North Carolina.</P>
              <ContactBox email="Admin@neuroprogeny.com" />
            </div>
          )}
          {activeTab === 'sms' && (
            <div>
              <EffectiveDate />
              <SectionHeading first>Program Name</SectionHeading>
              <P><strong style={{ color: '#3E3E3E' }}>Neuro Progeny SMS Alerts</strong></P>
              <SectionHeading>Program Description</SectionHeading>
              <P>By opting in to Neuro Progeny SMS Alerts, you consent to receive text messages from Neuro Progeny related to the Immersive Mastermind program and related services. Messages may include session reminders, program updates, onboarding communications, follow-ups, training notes, feedback surveys, and other informational messages related to your enrollment and participation.</P>
              <SectionHeading>Message Frequency</SectionHeading>
              <P>Message frequency varies based on your program enrollment and activity. You may receive recurring messages. Typical frequency ranges from 2 to 10 messages per week during active program participation.</P>
              <SectionHeading>Message &amp; Data Rates</SectionHeading>
              <P>Message and data rates may apply. Please contact your wireless carrier for details about your text messaging plan and any charges that may apply.</P>
              <SectionHeading>Opt-Out</SectionHeading>
              <HighlightBox><P>You can cancel SMS messages at any time. Text <Keyword>STOP</Keyword> to (828) 900-9821. After you send <Keyword>STOP</Keyword>, we will send you a confirmation that you have been unsubscribed. You will no longer receive SMS messages from us.</P><P style={{ marginBottom: 0 }}>If you want to join again, you may opt back in through your program enrollment or by texting START to (828) 900-9821.</P></HighlightBox>
              <SectionHeading>Help &amp; Support</SectionHeading>
              <HighlightBox><P style={{ marginBottom: 0 }}>If you are experiencing issues with the messaging program, text <Keyword>HELP</Keyword> to (828) 900-9821 for assistance.</P></HighlightBox>
              <ContactBox email="support@neuroprogeny.com" phone="(828) 900-9821" />
              <SectionHeading>Carrier Liability</SectionHeading>
              <P>Carriers are not liable for delayed or undelivered messages. Delivery is subject to effective transmission from your network provider.</P>
              <SectionHeading>Privacy</SectionHeading>
              <P>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. For full details, see our <InlineLink onClick={() => switchTab('privacy')}>Privacy Policy</InlineLink>.</P>
              <SectionHeading>Consent</SectionHeading>
              <P>By opting in to Neuro Progeny SMS Alerts, you acknowledge that you have read and agree to these SMS Terms and our Privacy Policy. Consent to receive text messages is not a condition of purchase.</P>
            </div>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'center', padding: '24px 16px', fontSize: 12, color: '#666' }}>
        <p>&copy; 2026 Neuro Progeny. All rights reserved.</p>
        <p style={{ marginTop: 4 }}><a href="https://neuroprogeny.com" style={{ color: '#386797', textDecoration: 'none', fontWeight: 500 }}>neuroprogeny.com</a></p>
      </div>
    </div>
  )
}

function EffectiveDate() {
  return <p style={{ fontSize: 13, color: '#666', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e5e8eb' }}>Last Updated: February 15, 2026</p>
}

function SectionHeading({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: '#3E3E3E', marginTop: first ? 0 : 28, marginBottom: 12 }}>{children}</h2>
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ marginBottom: 12, fontSize: 14, color: '#333', lineHeight: 1.7, ...style }}>{children}</p>
}

function UL({ items }: { items: string[] }) {
  return <ul style={{ margin: '8px 0 16px 20px', fontSize: 14, color: '#333', lineHeight: 1.7 }}>{items.map((item, i) => <li key={i} style={{ marginBottom: 6 }}>{item}</li>)}</ul>
}

function Keyword({ children }: { children: React.ReactNode }) {
  return <span style={{ display: 'inline-block', background: '#3E3E3E', color: '#fff', fontWeight: 700, padding: '2px 8px', borderRadius: 4, fontSize: 13, letterSpacing: '0.04em' }}>{children}</span>
}

function InlineLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ color: '#386797', textDecoration: 'none', background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 'inherit', cursor: 'pointer', fontWeight: 500 }}>{children}</button>
}

function HighlightBox({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'rgba(58, 157, 165, 0.08)', border: '1px solid rgba(58, 157, 165, 0.2)', borderRadius: 8, padding: '16px 20px', margin: '16px 0' }}>{children}</div>
}

function WarningBox() {
  return <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 8, padding: 16, margin: '16px 0' }}><strong style={{ color: '#92400E', fontSize: 14 }}>⚠️ NOT MEDICAL ADVICE</strong><p style={{ margin: '8px 0 0', color: '#92400E', fontSize: 13, lineHeight: 1.6 }}>Neuro Progeny assessments, programs, and educational content are for educational and self-development purposes only. They do not diagnose or treat medical or psychological conditions and do not replace professional care. Always consult qualified professionals for health concerns.</p></div>
}

function ContactBox({ email, phone }: { email: string; phone?: string }) {
  return <div style={{ background: '#faf8f5', borderRadius: 8, padding: '16px 20px', marginTop: 16 }}><p style={{ marginBottom: phone ? 4 : 0, fontSize: 14, color: '#333' }}><strong>Email:</strong>{' '}<a href={`mailto:${email}`} style={{ color: '#3A9DA5', textDecoration: 'none', fontWeight: 600 }}>{email}</a></p>{phone && <p style={{ marginBottom: 0, fontSize: 14, color: '#333' }}><strong>Phone:</strong>{' '}<a href={`tel:+1${phone.replace(/\D/g, '')}`} style={{ color: '#3A9DA5', textDecoration: 'none', fontWeight: 600 }}>{phone}</a></p>}</div>
}
