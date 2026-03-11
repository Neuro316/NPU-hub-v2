'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Upload, Download, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle,
  X, ChevronDown, ChevronRight, Copy, Sparkles, Users, ArrowRight,
  Trash2, Settings, Globe, Linkedin, Instagram, Twitter, Youtube, Clock
} from 'lucide-react'
import * as XLSX from 'xlsx'

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CONSTANTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const CONTACT_TYPES = [
  { value: '', label: 'Not set' },
  { value: 'b2b_coach', label: 'B2B - Coach/Practitioner' },
  { value: 'b2b_clinic', label: 'B2B - Clinic/Facility' },
  { value: 'b2b_partner', label: 'B2B - Partner/Referral' },
  { value: 'b2c_client', label: 'B2C - Client/Patient' },
  { value: 'b2c_prospect', label: 'B2C - Prospect' },
  { value: 'other', label: 'Other' },
]

const CRM_FIELDS = [
  // â”€â”€ Basic Identity â”€â”€
  { key: 'first_name', label: 'First Name', required: true, group: 'Basic' },
  { key: 'last_name', label: 'Last Name', required: true, group: 'Basic' },
  { key: 'email', label: 'Email', required: false, group: 'Basic' },
  { key: 'phone', label: 'Phone', required: false, group: 'Basic' },
  { key: 'company', label: 'Company / Org', required: false, group: 'Basic' },
  { key: 'occupation', label: 'Occupation / Title', required: false, group: 'Basic' },
  { key: 'address_city', label: 'City', required: false, group: 'Basic' },
  { key: 'address_state', label: 'State / Country', required: false, group: 'Basic' },
  { key: 'address_street', label: 'Street', required: false, group: 'Basic' },
  { key: 'address_zip', label: 'Zip', required: false, group: 'Basic' },
  // â”€â”€ Pipeline â”€â”€
  { key: 'pipeline_id', label: 'Pipeline', required: false, group: 'Pipeline' },
  { key: 'pipeline_stage', label: 'Pipeline Stage', required: false, group: 'Pipeline' },
  // â”€â”€ Platform & Social â”€â”€
  { key: 'platform', label: 'Primary Platform', required: false, group: 'Social' },
  { key: 'profile_handle', label: 'Handle / Profile URL', required: false, group: 'Social' },
  { key: 'linkedin_url', label: 'LinkedIn URL', required: false, group: 'Social' },
  { key: 'instagram_handle', label: 'Instagram', required: false, group: 'Social' },
  { key: 'twitter_handle', label: 'Twitter/X', required: false, group: 'Social' },
  { key: 'youtube_url', label: 'YouTube', required: false, group: 'Social' },
  { key: 'tiktok_handle', label: 'TikTok', required: false, group: 'Social' },
  { key: 'facebook_url', label: 'Facebook', required: false, group: 'Social' },
  { key: 'website_url', label: 'Blog / Website', required: false, group: 'Social' },
  { key: 'blog_url', label: 'Blog URL', required: false, group: 'Social' },
  // â”€â”€ Follower Counts â”€â”€
  { key: 'instagram_followers', label: 'Instagram Followers', required: false, group: 'Reach' },
  { key: 'linkedin_followers', label: 'LinkedIn Followers', required: false, group: 'Reach' },
  { key: 'youtube_subscribers', label: 'YouTube Subscribers', required: false, group: 'Reach' },
  { key: 'tiktok_followers', label: 'TikTok Followers', required: false, group: 'Reach' },
  { key: 'facebook_followers', label: 'Facebook Followers', required: false, group: 'Reach' },
  { key: 'twitter_followers', label: 'Twitter/X Followers', required: false, group: 'Reach' },
  { key: 'podcast_listeners', label: 'Podcast Listeners', required: false, group: 'Reach' },
  { key: 'email_list_subscribers', label: 'Email List Subscribers', required: false, group: 'Reach' },
  { key: 'total_est_reach', label: 'Total Est. Reach', required: false, group: 'Reach' },
  // â”€â”€ Partner Scoring â”€â”€
  { key: 'alignment_score', label: 'Alignment (1-5)', required: false, group: 'Scoring' },
  { key: 'commercial_relevance_score', label: 'Commercial Relevance (1-5)', required: false, group: 'Scoring' },
  { key: 'outreach_ease_score', label: 'Outreach Ease (1-5)', required: false, group: 'Scoring' },
  { key: 'credibility_score', label: 'Credibility (1-5)', required: false, group: 'Scoring' },
  { key: 'outreach_total_score', label: 'Total Score', required: false, group: 'Scoring' },
  { key: 'priority_tier', label: 'Priority Tier', required: false, group: 'Scoring' },
  // â”€â”€ Partnership Fit â”€â”€
  { key: 'fit_category', label: 'Fit Category', required: false, group: 'Partner Fit' },
  { key: 'primary_niche', label: 'Primary Niche', required: false, group: 'Partner Fit' },
  { key: 'audience_type', label: 'Audience Type', required: false, group: 'Partner Fit' },
  { key: 'offer_angle', label: 'Likely Offer Angle', required: false, group: 'Partner Fit' },
  { key: 'outreach_opener', label: 'Custom Outreach Opener', required: false, group: 'Partner Fit' },
  { key: 'partnership_type', label: 'Partnership Type', required: false, group: 'Partner Fit' },
  // â”€â”€ CRM / Pipeline â”€â”€
  { key: 'contact_type', label: 'Contact Type (B2B/B2C)', required: false, group: 'Intelligence' },
  { key: 'population_served', label: 'Population Served', required: false, group: 'Intelligence' },
  { key: 'topics_of_interest', label: 'Topics of Interest', required: false, group: 'Intelligence' },
  { key: 'presentation_topics', label: 'Presentation Topics', required: false, group: 'Intelligence' },
  { key: 'publications', label: 'Publications', required: false, group: 'Intelligence' },
  { key: 'key_differentiator', label: 'Key Differentiator', required: false, group: 'Intelligence' },
  { key: 'industry', label: 'Industry', required: false, group: 'Intelligence' },
  // â”€â”€ Outreach Ops â”€â”€
  { key: 'outreach_owner', label: 'Outreach Owner', required: false, group: 'Outreach' },
  { key: 'outreach_status', label: 'Status', required: false, group: 'Outreach' },
  { key: 'outreach_strategy', label: 'Outreach Strategy', required: false, group: 'Outreach' },
  { key: 'outreach_last_touch', label: 'Last Touch', required: false, group: 'Outreach' },
  { key: 'outreach_next_step', label: 'Next Step', required: false, group: 'Outreach' },
  { key: 'outreach_response_summary', label: 'Response Summary', required: false, group: 'Outreach' },
  { key: 'outreach_follow_up_date', label: 'Follow-up Date', required: false, group: 'Outreach' },
  // â”€â”€ Market & Research Intel â”€â”€
  { key: 'est_audience_size', label: 'Est. Audience Size', required: false, group: 'Market Intel' },
  { key: 'engagement_rate', label: 'Engagement Rate', required: false, group: 'Market Intel' },
  { key: 'content_frequency', label: 'Content Frequency', required: false, group: 'Market Intel' },
  { key: 'content_type', label: 'Content Type', required: false, group: 'Market Intel' },
  { key: 'market_segment', label: 'Market Segment', required: false, group: 'Market Intel' },
  { key: 'geographic_market', label: 'Geographic Market', required: false, group: 'Market Intel' },
  { key: 'competitor_partnerships', label: 'Competitor Partnerships', required: false, group: 'Market Intel' },
  { key: 'market_opportunity_notes', label: 'Market Opportunity Notes', required: false, group: 'Market Intel' },
  { key: 'revenue_potential', label: 'Revenue Potential', required: false, group: 'Market Intel' },
  { key: 'npu_sensorium_fit', label: 'NPU / Sensorium Fit', required: false, group: 'Market Intel' },
  // â”€â”€ Attribution / Admin â”€â”€
  { key: 'source', label: 'Source', required: false, group: 'Attribution' },
  { key: 'tags', label: 'Tags (pipe-separated)', required: false, group: 'Attribution' },
  { key: 'ai_research_notes', label: 'AI Research Notes', required: false, group: 'Attribution' },
  { key: 'how_heard_about_us', label: 'How Heard About Us', required: false, group: 'Attribution' },
  { key: 'reason_for_contact', label: 'Reason for Contact', required: false, group: 'Attribution' },
  { key: 'notes', label: 'Notes', required: false, group: 'Attribution' },
  { key: 'social_follow_suggestion', label: 'Suggest Follow?', required: false, group: 'Attribution' },
  { key: 'preferred_outreach_strategy', label: 'Preferred Outreach Strategy', required: false, group: 'Attribution' },
]

// Spreadsheet column â†’ CRM field key (exact match for NP Master Partner Template)
const SPREADSHEET_AUTO_MAP: Record<string, string> = {
  'first name': 'first_name',
  'last name': 'last_name',
  'email': 'email',
  'phone': 'phone',
  'company / org': 'company',
  'company': 'company',
  'occupation / title': 'occupation',
  'occupation': 'occupation',
  'title': 'occupation',
  'city': 'address_city',
  'state / country': 'address_state',
  'state': 'address_state',
  'primary platform': 'platform',
  'platform': 'platform',
  'handle / profile url': 'profile_handle',
  'handle': 'profile_handle',
  'linkedin url': 'linkedin_url',
  'linkedin': 'linkedin_url',
  'instagram': 'instagram_handle',
  'twitter/x': 'twitter_handle',
  'twitter': 'twitter_handle',
  'x': 'twitter_handle',
  'youtube': 'youtube_url',
  'tiktok': 'tiktok_handle',
  'facebook': 'facebook_url',
  'blog / website': 'website_url',
  'website': 'website_url',
  'blog': 'blog_url',
  'instagram followers': 'instagram_followers',
  'instagram\nfollowers': 'instagram_followers',
  'linkedin followers': 'linkedin_followers',
  'linkedin\nfollowers': 'linkedin_followers',
  'youtube subscribers': 'youtube_subscribers',
  'youtube\nsubscribers': 'youtube_subscribers',
  'tiktok followers': 'tiktok_followers',
  'tiktok\nfollowers': 'tiktok_followers',
  'facebook followers': 'facebook_followers',
  'facebook\nfollowers': 'facebook_followers',
  'twitter/x followers': 'twitter_followers',
  'twitter/x\nfollowers': 'twitter_followers',
  'podcast listeners': 'podcast_listeners',
  'podcast\nlisteners': 'podcast_listeners',
  'email list subscribers': 'email_list_subscribers',
  'email list\nsubscribers': 'email_list_subscribers',
  'total est. reach': 'total_est_reach',
  'total est.\nreach': 'total_est_reach',
  'alignment (1â€“5)': 'alignment_score',
  'alignment\n(1â€“5)': 'alignment_score',
  'alignment (1-5)': 'alignment_score',
  'commercial relevance (1â€“5)': 'commercial_relevance_score',
  'commercial\nrelevance (1â€“5)': 'commercial_relevance_score',
  'commercial relevance (1-5)': 'commercial_relevance_score',
  'outreach ease (1â€“5)': 'outreach_ease_score',
  'outreach\nease (1â€“5)': 'outreach_ease_score',
  'outreach ease (1-5)': 'outreach_ease_score',
  'credibility (1â€“5)': 'credibility_score',
  'credibility\n(1â€“5)': 'credibility_score',
  'credibility (1-5)': 'credibility_score',
  'total score': 'outreach_total_score',
  'priority tier': 'priority_tier',
  'fit category': 'fit_category',
  'primary niche': 'primary_niche',
  'audience type': 'audience_type',
  'likely offer angle': 'offer_angle',
  'offer angle': 'offer_angle',
  'custom outreach opener': 'outreach_opener',
  'outreach opener': 'outreach_opener',
  'partnership type': 'partnership_type',
  'pipeline': 'pipeline_id',
  'pipeline stage': 'pipeline_stage',
  'contact type\n(b2b/b2c)': 'contact_type',
  'contact type (b2b/b2c)': 'contact_type',
  'contact type': 'contact_type',
  'population served': 'population_served',
  'topics of interest': 'topics_of_interest',
  'presentation topics': 'presentation_topics',
  'publications': 'publications',
  'outreach owner': 'outreach_owner',
  'status': 'outreach_status',
  'outreach strategy': 'outreach_strategy',
  'last touch': 'outreach_last_touch',
  'last touch\n(date)': 'outreach_last_touch',
  'next step': 'outreach_next_step',
  'response summary': 'outreach_response_summary',
  'follow-up date': 'outreach_follow_up_date',
  'est. audience size': 'est_audience_size',
  'engagement rate': 'engagement_rate',
  'engagement rate (%)': 'engagement_rate',
  'content frequency': 'content_frequency',
  'content type': 'content_type',
  'market segment': 'market_segment',
  'geographic market': 'geographic_market',
  'competitor partnerships': 'competitor_partnerships',
  'market opportunity notes': 'market_opportunity_notes',
  'revenue potential': 'revenue_potential',
  'npu / sensorium fit': 'npu_sensorium_fit',
  'source': 'source',
  'tags': 'tags',
  'ai research notes': 'ai_research_notes',
}

const AI_PROMPT_TEMPLATE = `You are preparing a contact list for import into a CRM system for Neuro Progeny / Sensorium Neuro Wellness, a neurotechnology company focused on VR biofeedback and nervous system capacity training.

For each person on the list, research and fill in the following columns. Use publicly available information only.

REQUIRED FORMAT: Return a CSV or table with these exact column headers:
first_name, last_name, email, phone, company, contact_type, population_served, preferred_outreach_strategy, topics_of_interest, presentation_topics, publications, key_differentiator, occupation, industry, website_url, linkedin_url, instagram_handle, twitter_handle, facebook_url, youtube_url, tiktok_handle, blog_url, city, state, source, tags, notes, social_follow_suggestion, ai_research_notes

COLUMN INSTRUCTIONS:

1. **contact_type**: One of: b2b_coach, b2b_clinic, b2b_partner, b2c_client, b2c_prospect, other
2. **population_served**: Who do they primarily work with? (e.g., "children with ADHD", "veterans with TBI", "athletes", "executives")
3. **preferred_outreach_strategy**: Based on their online presence, what's the best way to reach them? (e.g., "LinkedIn DM - active poster", "Email via mutual connection with [Name]", "Instagram comment engagement first", "Conference introduction at [Event]")
4. **topics_of_interest**: Comma-separated topics they engage with on social media (e.g., "neurofeedback, brain health, biohacking, meditation")
5. **presentation_topics**: Comma-separated topics they present on at conferences or webinars
6. **publications**: Notable papers, books, or blog series (include titles and year)
7. **key_differentiator**: What makes them unique in their field? How do they position themselves differently from peers?
8. **social_follow_suggestion**: "yes" if I should follow/connect with them on social media, "no" if not relevant
9. **ai_research_notes**: Any additional intelligence. Include:
   - Known connections to other people on this list (format: "Likely knows [Name] - co-presented at [Event] 2024" or "Connected to [Name] on LinkedIn")
   - Their content style (long-form articles vs quick tips vs video)
   - Best time/method to engage
   - Any shared connections or warm introduction paths
   - Red flags or notes about their receptiveness to outreach

DISCOVERY INSTRUCTIONS:
- Check LinkedIn for mutual connections, shared groups, endorsements between people on the list
- Check co-authored papers on PubMed, Google Scholar, ResearchGate
- Check conference speaker lists for co-presentations
- Check social media for mutual follows, tags, or collaborations
- Check podcast guest appearances together
- For each discovered connection, note the basis and estimate confidence (high/medium/low)

FORMATTING RULES:
- Use pipe | separator for arrays within cells (e.g., "neurofeedback|brain health|biohacking")
- Dates in YYYY-MM-DD format
- Phone numbers as digits only (e.g., 8285551234)
- LinkedIn URLs as full URLs (https://linkedin.com/in/username)
- Instagram/Twitter/TikTok as handles without @ (e.g., johndoe)
- Leave cells empty if no data found (do not write "N/A" or "unknown")
- Write at 9th grade reading level, no jargon

Here is the list of people to research:
[PASTE YOUR LIST HERE - names, companies, or any identifying information you have]`

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TYPES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
interface ImportRow {
  _rowId: string
  _selected: boolean
  _status: 'pending' | 'imported' | 'skipped' | 'error'
  _error?: string
  _pipelineId?: string
  _pipelineStage?: string
  _contactType?: string
  _mergeDupe?: boolean
  [key: string]: any
}

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'done'

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN COMPONENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export default function ImportPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()

  // Steps
  const [step, setStep] = useState<Step>('upload')

  // Upload
  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [fileName, setFileName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Column mapping
  const [columnMap, setColumnMap] = useState<Record<string, string>>({}) // csv_col -> crm_field

  // Preview / editing
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [selectAll, setSelectAll] = useState(true)

  // Pipeline configs
  const [pipelines, setPipelines] = useState<any[]>([])
  const [bulkPipeline, setBulkPipeline] = useState('')
  const [bulkContactType, setBulkContactType] = useState('')
  const [showNewPipelineModal, setShowNewPipelineModal] = useState(false)
  const [newPipelineName, setNewPipelineName] = useState('')
  const [savingPipeline, setSavingPipeline] = useState(false)

  // Import state
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: number; merged: number; connections: number } | null>(null)

  // Duplicate detection
  const [existingContacts, setExistingContacts] = useState<any[]>([])
  const [duplicates, setDuplicates] = useState<Map<string, any>>(new Map()) // rowId -> existing contact

  // AI prompt
  const [showPrompt, setShowPrompt] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)

  // Load pipelines
  useEffect(() => {
    if (!currentOrg) return
    const sb = createClient()
    sb.from('org_settings').select('setting_value').eq('org_id', currentOrg.id).eq('setting_key', 'crm_pipelines').maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data?.setting_value?.pipelines) setPipelines(data.setting_value.pipelines)
      })
  }, [currentOrg?.id])

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FILE PARSING
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const parseCSV = (text: string) => {
    // Parse CSV handling multiline quoted fields
    const parseFullCSV = (raw: string): string[][] => {
      const rows: string[][] = []
      let current = ''
      let inQuotes = false
      let row: string[] = []

      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i]
        if (ch === '"') {
          if (inQuotes && raw[i + 1] === '"') { current += '"'; i++ }
          else inQuotes = !inQuotes
        } else if (ch === ',' && !inQuotes) {
          row.push(current.trim()); current = ''
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
          if (ch === '\r' && raw[i + 1] === '\n') i++ // skip \r\n
          row.push(current.trim())
          if (row.some(c => c)) rows.push(row)
          row = []; current = ''
        } else {
          current += ch
        }
      }
      // Last row
      row.push(current.trim())
      if (row.some(c => c)) rows.push(row)
      return rows
    }

    const allRows = parseFullCSV(text)
    if (allRows.length < 2) return

    const headers = allRows[0]
    const rows = allRows.slice(1)
    
    setRawHeaders(headers)
    setRawRows(rows)
    setFileName(fileName)

    // Auto-map columns
    const autoMap: Record<string, string> = {}
    headers.forEach(h => {
      const lower = h.toLowerCase().replace(/[^a-z0-9]/g, '')
      const match = CRM_FIELDS.find(f => {
        const fLower = f.key.replace(/_/g, '')
        const fLabel = f.label.toLowerCase().replace(/[^a-z0-9]/g, '')
        return lower === fLower || lower === fLabel || lower.includes(fLower) || fLower.includes(lower)
      })
      if (match) autoMap[h] = match.key
    })
    setColumnMap(autoMap)
    setStep('map')
  }

  const parseXLSX = (buffer: ArrayBuffer) => {
    const wb = XLSX.read(buffer, { type: 'array' })
    // Look for 'Master Contact DB' sheet first, otherwise use first sheet
    const sheetName = wb.SheetNames.includes('Master Contact DB')
      ? 'Master Contact DB'
      : wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    // Convert to array of arrays
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    // Find header row (look for 'First Name' or 'first_name' in first 6 rows)
    let headerRowIdx = 0
    for (let i = 0; i < Math.min(6, raw.length); i++) {
      const row = raw[i].map((v: any) => String(v).toLowerCase().replace(/[\n\r]+/g, ' ').trim())
      if (row.some(c => c.includes('first name') || c === 'first_name')) {
        headerRowIdx = i
        break
      }
    }
    const headerRow = raw[headerRowIdx].map((v: any) =>
      String(v ?? '').replace(/[\n\r]+/g, '\n').trim()
    )
    const dataRows = raw.slice(headerRowIdx + 1).filter(r => r.some((v: any) => v !== '' && v != null))
    const stringRows = dataRows.map(row =>
      row.map((v: any) => {
        if (v === null || v === undefined) return ''
        // Skip Excel formula results that are just numbers from SUM formulas for scores
        if (typeof v === 'number') return String(v)
        return String(v).trim()
      })
    )
    setRawHeaders(headerRow)
    setRawRows(stringRows)
    // Auto-map using SPREADSHEET_AUTO_MAP first, then fuzzy fallback
    const autoMap: Record<string, string> = {}
    headerRow.forEach(h => {
      const lower = h.toLowerCase().replace(/[\n\r]+/g, ' ').trim()
      // Try exact spreadsheet map first
      if (SPREADSHEET_AUTO_MAP[lower]) {
        autoMap[h] = SPREADSHEET_AUTO_MAP[lower]
        return
      }
      // Fuzzy fallback
      const stripped = lower.replace(/[^a-z0-9]/g, '')
      const match = CRM_FIELDS.find(f => {
        const fLower = f.key.replace(/_/g, '')
        const fLabel = f.label.toLowerCase().replace(/[^a-z0-9]/g, '')
        return stripped === fLower || stripped === fLabel
      })
      if (match) autoMap[h] = match.key
    })
    setColumnMap(autoMap)
    setStep('map')
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const buf = await file.arrayBuffer()
      parseXLSX(buf)
    } else if (file.name.endsWith('.csv') || file.name.endsWith('.tsv')) {
      const text = await file.text()
      parseCSV(text)
    } else {
      alert('Please upload a .xlsx, .csv, or .tsv file')
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    setFileName(file.name)
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const buf = await file.arrayBuffer()
      parseXLSX(buf)
    } else if (file.name.endsWith('.csv') || file.name.endsWith('.tsv')) {
      const text = await file.text()
      parseCSV(text)
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // COLUMN MAPPING -> PREVIEW
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const buildPreview = async () => {
    const rows: ImportRow[] = rawRows.map((row, i) => {
      const mapped: ImportRow = {
        _rowId: `row-${i}`,
        _selected: true,
        _status: 'pending',
        _pipelineId: '',
        _pipelineStage: '',
        _contactType: '',
      }
      rawHeaders.forEach((h, ci) => {
        const crmField = columnMap[h]
        if (crmField && row[ci]) {
          mapped[crmField] = row[ci]
        }
      })
      if (mapped.contact_type) mapped._contactType = mapped.contact_type
      if (mapped.pipeline_id) mapped._pipelineId = mapped.pipeline_id
      if (mapped.pipeline_stage) mapped._pipelineStage = mapped.pipeline_stage
      return mapped
    })

    // Load existing contacts for duplicate detection
    if (currentOrg) {
      const sb = createClient()
      const { data } = await sb.from('contacts')
        .select('id,first_name,last_name,email,phone')
        .eq('org_id', currentOrg.id).is('merged_into_id', null)
      setExistingContacts(data || [])

      // Check for duplicates
      const dupeMap = new Map<string, any>()
      rows.forEach(row => {
        const match = (data || []).find((c: any) => {
          if (row.email && c.email && row.email.toLowerCase() === c.email.toLowerCase()) return true
          if (row.phone && c.phone) {
            const rp = String(row.phone).replace(/\D/g, '').slice(-10)
            const cp = String(c.phone).replace(/\D/g, '').slice(-10)
            if (rp.length >= 10 && rp === cp) return true
          }
          if (row.first_name && row.last_name && c.first_name && c.last_name) {
            if (row.first_name.toLowerCase() === c.first_name.toLowerCase() &&
                row.last_name.toLowerCase() === c.last_name.toLowerCase()) return true
          }
          return false
        })
        if (match) dupeMap.set(row._rowId, match)
      })
      setDuplicates(dupeMap)
    }

    setImportRows(rows)
    setStep('preview')
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // IMPORT EXECUTION (with duplicate merge + auto-connections)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const executeImport = async () => {
    if (!currentOrg || !user) return
    setStep('importing')
    setImporting(true)
    setImportProgress(0)

    const sb = createClient()
    const selected = importRows.filter(r => r._selected)
    let imported = 0, skipped = 0, errors = 0, merged = 0, connections = 0

    const { data: batch } = await sb.from('contact_import_batches').insert({
      org_id: currentOrg.id, imported_by: user.id,
      filename: fileName, total_rows: selected.length,
      status: 'processing', column_mapping: columnMap,
    }).select('id').single()

    const batchId = batch?.id
    const importedContactIds: { rowId: string; contactId: string; name: string }[] = []

    for (let i = 0; i < selected.length; i++) {
      const row = selected[i]
      setImportProgress(Math.round(((i + 1) / selected.length) * 100))

      try {
        if (!row.first_name && !row.last_name) {
          row._status = 'skipped'; row._error = 'No name'; skipped++; continue
        }

        const parseArray = (v: string | undefined): string[] => {
          if (!v) return []
          return v.split(/[|,]/).map(s => s.trim()).filter(Boolean)
        }

        const contact: Record<string, any> = {
          first_name: row.first_name || '',
          last_name: row.last_name || '',
          email: row.email || null,
          phone: row.phone || null,
          source: row.source || 'Import',
          tags: parseArray(row.tags),
        }

        if (row._pipelineId) {
          contact.pipeline_id = row._pipelineId
          contact.pipeline_stage = row._pipelineStage || pipelines.find((p: any) => p.id === row._pipelineId)?.stages?.[0]?.name || 'New Lead'
        } else if (row._pipelineStage) {
          contact.pipeline_stage = row._pipelineStage
        }

        if (row._contactType) contact.contact_type = row._contactType

        const directFields = [
          'company', 'occupation', 'industry', 'population_served',
          'preferred_outreach_strategy', 'publications', 'key_differentiator',
          'website_url', 'linkedin_url', 'instagram_handle', 'twitter_handle',
          'facebook_url', 'youtube_url', 'tiktok_handle', 'blog_url',
          'address_city', 'address_state', 'address_street', 'address_zip',
          'how_heard_about_us', 'reason_for_contact', 'notes', 'ai_research_notes',
          // Partner intel fields
          'platform', 'profile_handle', 'primary_niche', 'audience_type', 'fit_category',
          'priority_tier', 'offer_angle', 'outreach_opener', 'partnership_type',
          'outreach_owner', 'outreach_status', 'outreach_strategy',
          'outreach_last_touch', 'outreach_next_step', 'outreach_response_summary',
          'outreach_follow_up_date',
          'est_audience_size', 'engagement_rate', 'content_frequency', 'content_type',
          'market_segment', 'geographic_market', 'competitor_partnerships',
          'market_opportunity_notes', 'revenue_potential', 'npu_sensorium_fit',
        ]
        directFields.forEach(f => { if (row[f]) contact[f] = row[f] })

        // Numeric partner fields
        const numericFields = [
          'alignment_score', 'commercial_relevance_score', 'outreach_ease_score',
          'credibility_score', 'outreach_total_score', 'outreach_rank',
          'instagram_followers', 'linkedin_followers', 'youtube_subscribers',
          'tiktok_followers', 'facebook_followers', 'twitter_followers',
          'podcast_listeners', 'email_list_subscribers', 'total_est_reach',
        ]
        numericFields.forEach(f => {
          if (row[f]) {
            const n = Number(String(row[f]).replace(/[^0-9.]/g, ''))
            if (!isNaN(n) && n > 0) contact[f] = n
          }
        })

        if (row.topics_of_interest) contact.topics_of_interest = parseArray(row.topics_of_interest)
        if (row.presentation_topics) contact.presentation_topics = parseArray(row.presentation_topics)

        if (row.social_follow_suggestion) {
          contact.social_follow_suggestion = ['yes', 'true', '1'].includes(String(row.social_follow_suggestion).toLowerCase())
        }

        // Check if duplicate - merge instead of insert
        const existingDupe = duplicates.get(row._rowId)
        let contactId: string

        if (existingDupe && row._mergeDupe !== false) {
          // Merge: update existing contact with non-null new fields
          const updates: Record<string, any> = {}
          Object.entries(contact).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== '' && k !== 'first_name' && k !== 'last_name') {
              updates[k] = v
            }
          })
          // Merge tags
          if (contact.tags?.length) {
            const existing = existingDupe.tags || []
            updates.tags = Array.from(new Set([...existing, ...contact.tags]))
          }
          const { error } = await sb.from('contacts').update(updates).eq('id', existingDupe.id)
          if (error) { row._status = 'error'; row._error = error.message; errors++; continue }
          contactId = existingDupe.id
          row._status = 'imported'; row._error = 'Merged with existing'; merged++
        } else {
          // New insert
          contact.org_id = currentOrg.id
          contact.import_batch_id = batchId || null
          const { data: newContact, error } = await sb.from('contacts').insert(contact).select('id').single()
          if (error) { row._status = 'error'; row._error = error.message; errors++; continue }
          contactId = newContact!.id
          row._status = 'imported'; imported++
        }

        importedContactIds.push({
          rowId: row._rowId,
          contactId,
          name: `${row.first_name || ''} ${row.last_name || ''}`.trim()
        })

      } catch (err: any) {
        row._status = 'error'; row._error = err.message; errors++
      }
    }

    // â”€â”€ Auto-discover connections from AI research notes â”€â”€
    for (const entry of importedContactIds) {
      const row = selected.find(r => r._rowId === entry.rowId)
      if (!row?.ai_research_notes) continue

      const notes = String(row.ai_research_notes).toLowerCase()
      // Look for patterns like "knows [Name]", "connected to [Name]", "co-presented with [Name]"
      for (const other of importedContactIds) {
        if (other.contactId === entry.contactId) continue
        const otherNames = other.name.toLowerCase().split(' ')
        const firstName = otherNames[0]
        const lastName = otherNames[otherNames.length - 1]

        // Check if the notes mention this other person
        if (firstName.length > 2 && (notes.includes(firstName + ' ' + lastName) || notes.includes(lastName))) {
          // Determine confidence based on language
          let confidence = 0.5
          let basis = 'Mentioned in AI research notes'
          if (notes.includes('co-authored') || notes.includes('co-presented')) { confidence = 0.9; basis = 'Co-authored or co-presented' }
          else if (notes.includes('connected to') || notes.includes('linkedin')) { confidence = 0.75; basis = 'LinkedIn connection' }
          else if (notes.includes('knows') || notes.includes('mutual')) { confidence = 0.7; basis = 'Known connection' }
          else if (notes.includes('likely')) { confidence = 0.5; basis = 'Likely connection' }

          // Create relationship if confidence > 0.4
          try {
            await sb.from('contact_relationships').insert({
              org_id: currentOrg.id,
              from_contact_id: entry.contactId,
              to_contact_id: other.contactId,
              relationship_type: 'colleague_of',
              strength: Math.round(confidence * 5),
              notes: `Auto-discovered: ${basis} (${Math.round(confidence * 100)}% confidence)`,
              created_by: user.id,
            })
            connections++
          } catch { /* Duplicate or constraint error, skip */ }
        }
      }
    }

    // Update batch
    if (batchId) {
      await sb.from('contact_import_batches').update({
        imported_rows: imported + merged, skipped_rows: skipped,
        status: 'completed',
        notes: connections > 0 ? `Auto-created ${connections} connections` : null,
      }).eq('id', batchId)
    }

    setImportRows([...importRows])
    setImportResult({ imported, skipped, errors, merged, connections })
    setImporting(false)
    setStep('done')
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // HELPERS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  const updateRow = (rowId: string, field: string, value: any) => {
    setImportRows(prev => prev.map(r => r._rowId === rowId ? { ...r, [field]: value } : r))
  }

  const bulkAssignPipeline = () => {
    if (!bulkPipeline) return
    const pl = pipelines.find((p: any) => p.id === bulkPipeline)
    setImportRows(prev => prev.map(r => r._selected ? {
      ...r,
      _pipelineId: bulkPipeline,
      _pipelineStage: pl?.stages?.[0]?.name || 'New Lead',
    } : r))
  }

  const bulkAssignType = () => {
    if (!bulkContactType) return
    setImportRows(prev => prev.map(r => r._selected ? { ...r, _contactType: bulkContactType } : r))
  }

  const createPipelineInline = async () => {
    if (!newPipelineName.trim() || !currentOrg) return
    setSavingPipeline(true)
    try {
      const sb = createClient()
      const { data } = await sb.from('org_settings').select('setting_value')
        .eq('org_id', currentOrg.id).eq('setting_key', 'crm_pipelines').maybeSingle()
      const existing: any[] = data?.setting_value?.pipelines || []
      const newPipeline = {
        id: `pipeline-${Date.now()}`,
        name: newPipelineName.trim(),
        stages: [
          { id: `s1-${Date.now()}`, name: 'Prospect', color: '#228DC4', position: 0 },
          { id: `s2-${Date.now()}`, name: 'Active', color: '#2A9D8F', position: 1 },
          { id: `s3-${Date.now()}`, name: 'Closed', color: '#34D399', is_closed_won: true, position: 2 },
        ],
      }
      const updated = [...existing, newPipeline]
      await sb.from('org_settings').upsert(
        { org_id: currentOrg.id, setting_key: 'crm_pipelines', setting_value: { pipelines: updated, active: existing[0]?.id || newPipeline.id } },
        { onConflict: 'org_id,setting_key' }
      )
      setPipelines(updated)
      // Auto-select the new pipeline and apply to all selected rows
      setBulkPipeline(newPipeline.id)
      setImportRows(prev => prev.map(r => r._selected ? {
        ...r, _pipelineId: newPipeline.id, _pipelineStage: newPipeline.stages[0].name,
      } : r))
      setNewPipelineName('')
      setShowNewPipelineModal(false)
    } catch (e) { console.error(e) } finally { setSavingPipeline(false) }
  }

  const toggleSelectAll = () => {
    const next = !selectAll
    setSelectAll(next)
    setImportRows(prev => prev.map(r => ({ ...r, _selected: next })))
  }

  const downloadTemplate = () => {
    // Build xlsx that exactly matches the NP Master Partner Template column structure
    const headers = [
      'First Name','Last Name','Email','Phone','Company / Org','Occupation / Title',
      'City','State / Country',
      'Primary Platform','Handle / Profile URL','LinkedIn URL','Instagram','Twitter/X',
      'YouTube','TikTok','Facebook','Blog / Website',
      'Instagram Followers','LinkedIn Followers','YouTube Subscribers','TikTok Followers',
      'Facebook Followers','Twitter/X Followers','Podcast Listeners','Email List Subscribers','Total Est. Reach',
      'Alignment (1-5)','Commercial Relevance (1-5)','Outreach Ease (1-5)','Credibility (1-5)','Total Score',
      'Priority Tier','Fit Category','Primary Niche','Audience Type',
      'Likely Offer Angle','Custom Outreach Opener','Partnership Type',
      'Pipeline','Pipeline Stage','Contact Type (B2B/B2C)','Population Served',
      'Topics of Interest','Presentation Topics','Publications',
      'Outreach Owner','Status','Outreach Strategy','Last Touch','Next Step','Response Summary','Follow-up Date',
      'Est. Audience Size','Engagement Rate','Content Frequency','Content Type',
      'Market Segment','Geographic Market','Competitor Partnerships','Market Opportunity Notes',
      'Source','Tags','AI Research Notes',
    ]
    const example = [
      'Jane','Smith','jane@example.com','8285551234','Brain Health Clinic','Clinical Director',
      'Asheville','NC',
      'LinkedIn','https://linkedin.com/in/janesmith','https://linkedin.com/in/janesmith','janesmith_neuro','janesmith',
      '','','','https://brainhealthclinic.com',
      '','','','','','','','','',
      '5','5','4','5','19',
      'A Tier','HRV / Performance','HRV, biofeedback, and performance recovery','Measurement-minded performance audience',
      'Position NP as HRV-friendly regulation & recovery tool',
      'Hi Jane â€” following your work on HRV biofeedback for clinical outcomes. Building Neuro Progeny and see a strong alignment fit.',
      'Affiliate',
      'Mastermind','Prospect','B2B / Clinic','Children with ADHD',
      'neurofeedback|brain health|biohacking','qEEG analysis|VR therapy','Smith et al. (2024) Journal of Neurofeedback',
      'Laura','Prospect','LinkedIn DM - active poster','','Schedule intro call','','',
      '~12,000','4.2%','Daily','Short-form video + long-form posts',
      'B2B','Southeast US','None known','Only provider combining VR with traditional neurofeedback â€” strong clinical credibility',
      'Conference','neurofeedback|VR|clinic-owner','Strong clinical background, published research, active poster. High priority.',
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['NEURO PROGENY  Â·  MASTER PARTNER & CONTACT DATABASE'],
      ['Fill in your contacts below. Upload this file on the Import page.'],
      headers,
      example,
    ])
    // Style header row (row index 2, 0-based)
    ws['!cols'] = headers.map(() => ({ wch: 22 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Master Contact DB')
    XLSX.writeFile(wb, 'NP_Partner_Import_Template.xlsx')
  }

  const copyPrompt = () => {
    navigator.clipboard.writeText(AI_PROMPT_TEMPLATE)
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 2000)
  }

  // â”€â”€ Visible columns in preview (only mapped ones) â”€â”€
  const mappedFields = Object.values(columnMap).filter(Boolean)
  const previewFields = CRM_FIELDS.filter(f => mappedFields.includes(f.key))
  const selectedCount = importRows.filter(r => r._selected).length

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // RENDER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  if (orgLoading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <Loader2 className="w-6 h-6 text-np-blue animate-spin" />
    </div>
  )

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">

      {/* â•â•â• HEADER â•â•â• */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark">Import Contacts</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Upload the NP Partner Template (.xlsx) or any CSV file â€” columns auto-map to CRM fields
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/crm/import/history"
            className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <Clock className="w-3.5 h-3.5" /> Import History
          </a>
          <button onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-3.5 h-3.5" /> Download Template
          </button>
          <button onClick={() => setShowPrompt(!showPrompt)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-white bg-purple-600 px-3 py-2 rounded-lg hover:bg-purple-700 transition-colors">
            <Sparkles className="w-3.5 h-3.5" /> AI Research Prompt
          </button>
        </div>
      </div>

      {/* â•â•â• STEP INDICATOR â•â•â• */}
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
        {(['upload', 'map', 'preview', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="w-3 h-3 text-gray-300" />}
            <span className={step === s ? 'text-np-blue' : step === 'done' || (s === 'upload' && step !== 'upload') ? 'text-green-500' : 'text-gray-300'}>
              {s === 'upload' ? '1. Upload' : s === 'map' ? '2. Map Columns' : s === 'preview' ? '3. Review & Import' : '4. Complete'}
            </span>
          </div>
        ))}
      </div>

      {/* â•â•â• AI PROMPT PANEL â•â•â• */}
      {showPrompt && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <h3 className="text-sm font-bold text-purple-800">AI Deep Research Prompt</h3>
            </div>
            <div className="flex gap-2">
              <button onClick={copyPrompt}
                className="flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-100 px-3 py-1.5 rounded-lg hover:bg-purple-200 transition-colors">
                {promptCopied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {promptCopied ? 'Copied!' : 'Copy Prompt'}
              </button>
              <button onClick={() => setShowPrompt(false)} className="text-purple-400 hover:text-purple-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-[10px] text-purple-700 mb-2">
            Copy this prompt and paste it into ChatGPT (Deep Research mode) or Claude. Add your list of names at the bottom.
            The AI will research each person and return a formatted CSV ready to import.
          </p>
          <pre className="bg-white border border-purple-100 rounded-lg p-3 text-[9px] text-gray-700 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
            {AI_PROMPT_TEMPLATE}
          </pre>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-white rounded-lg p-2 border border-purple-100">
              <p className="text-[9px] font-bold text-purple-700 mb-0.5">What it discovers</p>
              <p className="text-[8px] text-purple-600">Social profiles, publications, conference history, content style, mutual connections</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-purple-100">
              <p className="text-[9px] font-bold text-purple-700 mb-0.5">Connection mapping</p>
              <p className="text-[8px] text-purple-600">Finds co-authors, co-presenters, social connections between people on your list</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-purple-100">
              <p className="text-[9px] font-bold text-purple-700 mb-0.5">Outreach strategy</p>
              <p className="text-[8px] text-purple-600">Best channel, warm intro paths, engagement timing, content they respond to</p>
            </div>
          </div>
        </div>
      )}

      {/* â•â•â• STEP 1: UPLOAD â•â•â• */}
      {step === 'upload' && (
        <div className="bg-white border border-gray-100 rounded-2xl p-8">
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center cursor-pointer hover:border-np-blue/30 hover:bg-np-blue/5 transition-all"
          >
            <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-sm font-semibold text-np-dark mb-1">Drop your file here or click to browse</p>
            <p className="text-xs text-gray-400">Supports .xlsx (NP Partner Template), .csv, and .tsv</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={handleFileUpload} className="hidden" />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <h3 className="text-xs font-bold text-np-dark mb-2 flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-gray-400" /> Suggested Workflow
              </h3>
              <ol className="space-y-1.5 text-[10px] text-gray-600">
                <li className="flex gap-2"><span className="text-np-blue font-bold">1.</span> Click "AI Research Prompt" above and copy the prompt</li>
                <li className="flex gap-2"><span className="text-np-blue font-bold">2.</span> Paste into ChatGPT Deep Research with your contact list</li>
                <li className="flex gap-2"><span className="text-np-blue font-bold">3.</span> Download the AI-enriched CSV</li>
                <li className="flex gap-2"><span className="text-np-blue font-bold">4.</span> Upload here, map columns, assign pipelines, import</li>
              </ol>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <h3 className="text-xs font-bold text-np-dark mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-gray-400" /> Intelligence Fields
              </h3>
              <div className="space-y-1 text-[10px] text-gray-600">
                <p><span className="font-semibold text-np-dark">B2B vs B2C type</span> - Coach, clinic, partner, client, prospect</p>
                <p><span className="font-semibold text-np-dark">Population served</span> - Who they work with</p>
                <p><span className="font-semibold text-np-dark">Outreach strategy</span> - Best channel and approach</p>
                <p><span className="font-semibold text-np-dark">Topics & publications</span> - What they write/present about</p>
                <p><span className="font-semibold text-np-dark">Key differentiator</span> - How they stand out</p>
                <p><span className="font-semibold text-np-dark">Social profiles</span> - All handles for network building</p>
                <p><span className="font-semibold text-np-dark">AI research notes</span> - Deep research findings</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* â•â•â• STEP 2: COLUMN MAPPING â•â•â• */}
      {step === 'map' && (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-np-dark">Map Columns</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {fileName} - {rawRows.length} rows, {rawHeaders.length} columns. Map your file columns to CRM fields.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setStep('upload'); setRawHeaders([]); setRawRows([]) }}
                className="text-[10px] text-gray-500 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                Back
              </button>
              <button onClick={buildPreview}
                disabled={!columnMap[rawHeaders.find(h => columnMap[h] === 'first_name') || ''] && !columnMap[rawHeaders.find(h => columnMap[h] === 'last_name') || '']}
                className="text-[10px] font-bold text-white bg-np-blue px-4 py-1.5 rounded-lg hover:bg-np-blue/90 disabled:opacity-40 transition-colors">
                Continue to Preview
              </button>
            </div>
          </div>

          <div className="p-5 grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
            {rawHeaders.map(header => (
              <div key={header} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-np-dark truncate">{header}</p>
                  <p className="text-[8px] text-gray-400 truncate">Sample: {rawRows[0]?.[rawHeaders.indexOf(header)] || '(empty)'}</p>
                </div>
                <ArrowRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
                <select
                  value={columnMap[header] || ''}
                  onChange={e => setColumnMap(prev => ({ ...prev, [header]: e.target.value }))}
                  className="text-[10px] border border-gray-200 rounded-lg px-2 py-1.5 w-48 focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                >
                  <option value="">Skip this column</option>
                  {Object.entries(
                    CRM_FIELDS.reduce((groups, f) => {
                      if (!groups[f.group]) groups[f.group] = []
                      groups[f.group].push(f)
                      return groups
                    }, {} as Record<string, typeof CRM_FIELDS>)
                  ).map(([group, fields]) => (
                    <optgroup key={group} label={group}>
                      {fields.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.label} {f.required ? '*' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* â•â•â• STEP 3: PREVIEW & EDIT â•â•â• */}
      {step === 'preview' && (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-sm font-bold text-np-dark">Review & Import</h2>
                <p className="text-[10px] text-gray-400">
                {selectedCount} of {importRows.length} rows selected
                {duplicates.size > 0 && <span className="text-amber-600 font-medium ml-1">({duplicates.size} duplicates will merge)</span>}
              </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep('map')}
                  className="text-[10px] text-gray-500 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  Back to Mapping
                </button>
                <button onClick={executeImport} disabled={selectedCount === 0}
                  className="text-[10px] font-bold text-white bg-green-600 px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors">
                  Import {selectedCount} Contacts
                </button>
              </div>
            </div>

            {/* Bulk actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-gray-400 uppercase">Pipeline:</span>
                <select value={bulkPipeline} onChange={e => {
                  const val = e.target.value
                  setBulkPipeline(val)
                  if (val) {
                    const pl = pipelines.find((p: any) => p.id === val)
                    setImportRows(prev => prev.map(r => r._selected ? {
                      ...r, _pipelineId: val, _pipelineStage: pl?.stages?.[0]?.name || 'New Lead',
                    } : r))
                  }
                }}
                  className="text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  <option value="">None</option>
                  {pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={() => { setNewPipelineName(''); setShowNewPipelineModal(true) }}
                  title="Create new pipeline"
                  className="flex items-center justify-center w-6 h-6 rounded-full bg-np-blue/10 text-np-blue hover:bg-np-blue/20 transition-colors text-[11px] font-bold leading-none">
                  +
                </button>
                {bulkPipeline && (
                  <span className="text-[9px] text-green-600 font-medium">
                    âœ“ Applied to {importRows.filter(r => r._selected && r._pipelineId === bulkPipeline).length} contacts
                  </span>
                )}
              </div>
              <div className="w-px h-5 bg-gray-200" />
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-gray-400 uppercase">Bulk Type:</span>
                <select value={bulkContactType} onChange={e => setBulkContactType(e.target.value)}
                  className="text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button onClick={bulkAssignType} disabled={!bulkContactType}
                  className="text-[9px] font-bold text-np-blue bg-np-blue/10 px-2 py-1 rounded disabled:opacity-40 hover:bg-np-blue/20 transition-colors">
                  Apply
                </button>
              </div>
              <div className="w-px h-5 bg-gray-200" />
              <button onClick={() => setImportRows(prev => prev.filter(r => r._selected))}
                className="text-[9px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded hover:bg-red-100 transition-colors">
                <Trash2 className="w-3 h-3 inline mr-1" />Remove unselected
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-auto max-h-[55vh]">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <input type="checkbox" checked={selectAll} onChange={toggleSelectAll} className="rounded" />
                  </th>
                  <th className="px-3 py-2 text-left text-[8px] font-bold text-gray-400 uppercase">Status</th>
                  <th className="px-3 py-2 text-left text-[8px] font-bold text-gray-400 uppercase">Pipeline</th>
                  <th className="px-3 py-2 text-left text-[8px] font-bold text-gray-400 uppercase">Type</th>
                  {previewFields.map(f => (
                    <th key={f.key} className="px-3 py-2 text-left text-[8px] font-bold text-gray-400 uppercase whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importRows.map(row => (
                  <tr key={row._rowId} className={`border-b border-gray-50 ${!row._selected ? 'opacity-40' : 'hover:bg-gray-50'}`}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" checked={row._selected}
                        onChange={() => updateRow(row._rowId, '_selected', !row._selected)}
                        className="rounded" />
                    </td>
                    <td className="px-3 py-1.5">
                      {duplicates.has(row._rowId) ? (
                        <span className="text-[8px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                          title={`Matches: ${duplicates.get(row._rowId)?.first_name} ${duplicates.get(row._rowId)?.last_name} (${duplicates.get(row._rowId)?.email || duplicates.get(row._rowId)?.phone || 'name match'})`}>
                          Merge
                        </span>
                      ) : (
                        <span className="text-[8px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">New</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <select value={row._pipelineId || ''}
                          onChange={e => {
                            const pl = pipelines.find((p: any) => p.id === e.target.value)
                            updateRow(row._rowId, '_pipelineId', e.target.value)
                            updateRow(row._rowId, '_pipelineStage', pl?.stages?.[0]?.name || '')
                          }}
                          className="text-[9px] border border-gray-200 rounded px-1 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                          <option value="">No pipeline</option>
                          {pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <button onClick={() => { setNewPipelineName(''); setShowNewPipelineModal(true) }}
                          title="New pipeline" className="text-[9px] font-bold text-np-blue hover:text-np-dark leading-none">+</button>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={row._contactType || ''}
                        onChange={e => updateRow(row._rowId, '_contactType', e.target.value)}
                        className="text-[9px] border border-gray-200 rounded px-1 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                        {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    {previewFields.map(f => (
                      <td key={f.key} className="px-3 py-1.5">
                        <input
                          value={row[f.key] || ''}
                          onChange={e => updateRow(row._rowId, f.key, e.target.value)}
                          className="text-[9px] border border-transparent hover:border-gray-200 focus:border-np-blue/30 rounded px-1 py-0.5 w-full min-w-[80px] focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-transparent"
                          placeholder="-"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* â•â•â• STEP 3.5: IMPORTING â•â•â• */}
      {step === 'importing' && (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
          <Loader2 className="w-10 h-10 text-np-blue animate-spin mx-auto mb-4" />
          <p className="text-sm font-bold text-np-dark mb-1">Importing contacts...</p>
          <div className="w-64 mx-auto bg-gray-100 rounded-full h-2 mt-3">
            <div className="bg-np-blue h-2 rounded-full transition-all" style={{ width: `${importProgress}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-2">{importProgress}% complete</p>
        </div>
      )}

      {/* â•â•â• STEP 4: DONE â•â•â• */}
      {step === 'done' && importResult && (
        <div className="bg-white border border-gray-100 rounded-2xl p-8">
          <div className="text-center mb-6">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-np-dark">Import Complete</h2>
          </div>

          <div className="grid grid-cols-5 gap-3 max-w-2xl mx-auto mb-6">
            <div className="text-center bg-green-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-green-600">{importResult.imported}</p>
              <p className="text-[10px] text-green-700 font-medium">New</p>
            </div>
            <div className="text-center bg-blue-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-blue-600">{importResult.merged}</p>
              <p className="text-[10px] text-blue-700 font-medium">Merged</p>
            </div>
            <div className="text-center bg-purple-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-purple-600">{importResult.connections}</p>
              <p className="text-[10px] text-purple-700 font-medium">Connections</p>
            </div>
            <div className="text-center bg-amber-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-amber-600">{importResult.skipped}</p>
              <p className="text-[10px] text-amber-700 font-medium">Skipped</p>
            </div>
            <div className="text-center bg-red-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-red-600">{importResult.errors}</p>
              <p className="text-[10px] text-red-700 font-medium">Errors</p>
            </div>
          </div>

          {importResult.connections > 0 && (
            <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 mb-4 max-w-lg mx-auto text-center">
              <p className="text-[10px] text-purple-700">
                <Sparkles className="w-3 h-3 inline mr-1" />
                Auto-discovered {importResult.connections} connection(s) from AI research notes. View them on the Network tab.
              </p>
            </div>
          )}

          {/* Error details */}
          {importResult.errors > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3 mb-4 max-w-lg mx-auto">
              <p className="text-[10px] font-bold text-red-700 mb-1">Errors:</p>
              {importRows.filter(r => r._status === 'error').slice(0, 5).map(r => (
                <p key={r._rowId} className="text-[9px] text-red-600">
                  {r.first_name} {r.last_name}: {r._error}
                </p>
              ))}
            </div>
          )}

          <div className="flex justify-center gap-3">
            <button onClick={() => { setStep('upload'); setRawHeaders([]); setRawRows([]); setImportRows([]); setImportResult(null); setDuplicates(new Map()) }}
              className="text-[11px] font-medium text-gray-600 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
              Import More
            </button>
            <a href="/crm/contacts"
              className="text-[11px] font-bold text-white bg-np-blue px-4 py-2 rounded-lg hover:bg-np-blue/90 transition-colors inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> View Contacts
            </a>
            {(importResult?.connections || 0) > 0 && (
              <a href="/crm/network"
                className="text-[11px] font-bold text-white bg-purple-600 px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors inline-flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> View Network
              </a>
            )}
          </div>
        </div>
      )}

      {/* New Pipeline Modal */}
      {showNewPipelineModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 bg-white rounded-xl shadow-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">New Pipeline</h3>
              <button onClick={() => setShowNewPipelineModal(false)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mb-3">
              Creates a pipeline with default stages: Prospect â†’ Active â†’ Closed.
              You can customize stages in Pipeline Settings after import.
            </p>
            <div className="mb-4">
              <label className="text-[8px] font-bold uppercase tracking-wider text-gray-400">Pipeline Name</label>
              <input
                autoFocus
                value={newPipelineName}
                onChange={e => setNewPipelineName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createPipelineInline()}
                placeholder="e.g. Partner Outreach, Lead Nurture..."
                className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/30"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewPipelineModal(false)}
                className="px-3 py-2 text-xs text-gray-400 hover:text-gray-600">Cancel</button>
              <button onClick={createPipelineInline} disabled={!newPipelineName.trim() || savingPipeline}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors disabled:opacity-40">
                {savingPipeline ? 'Creating...' : 'Create & Select'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
