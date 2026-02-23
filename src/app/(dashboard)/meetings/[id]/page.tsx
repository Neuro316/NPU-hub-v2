'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useRockData } from '@/lib/hooks/use-rock-data'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { StatusDot, BadgePill, AvatarStack, Avatar, ProgressBar } from '@/components/shared/meeting-rock-ui'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { Meeting, MeetingTemplate, MeetingAttendee, AgendaSection, IdsItem, IdsStatus, MeetingActionItem } from '@/lib/types/meetings'
import {
  ChevronLeft, ChevronDown, ChevronRight, Clock, Check, Loader2, Target,
  Play, Pause, SkipForward, Timer, Plus, X, Sparkles,
  AlertTriangle, CheckCircle2, MessageSquare, Trash2,
  Mic, MicOff, Calendar, ArrowRight, ExternalLink, Send,
  Edit3, RotateCcw, Archive, ThumbsUp
} from 'lucide-react'

/* ─── Timer ─── */
function STimer({ dur, go }: { dur: number; go: boolean }) {
  const [el, setEl] = useState(0); const ref = useRef<NodeJS.Timeout|null>(null)
  const tot = dur*60; const rem = tot-el; const pct = tot>0?Math.max(0,rem/tot):0
  useEffect(() => { setEl(0) }, [dur])
  useEffect(() => { if(go) ref.current=setInterval(()=>setEl(p=>p+1),1000); else if(ref.current)clearInterval(ref.current); return()=>{if(ref.current)clearInterval(ref.current)} }, [go])
  const fmt = (s: number) => { const a=Math.abs(s); return `${s<0?'+':''}${Math.floor(a/60)}:${(a%60).toString().padStart(2,'0')}` }
  let c = '#16A34A', bg = '#F0FDF4'
  if(rem<=0){c='#DC2626';bg='#FEF2F2'} else if(pct<0.25){c='#D97706';bg='#FFFBEB'}
  return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold tabular-nums" style={{background:bg,color:c}}><Timer size={10}/>{fmt(rem)}</span>
}

/* ─── Voice ─── */
function useVoice(cb: (t:string)=>void) {
  const [on,setOn]=useState(false); const r=useRef<any>(null)
  const toggle=useCallback(()=>{
    const SR=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition; if(!SR) return
    if(on&&r.current){r.current.stop();setOn(false);return}
    const x=new SR();x.continuous=false;x.interimResults=false;x.lang='en-US'
    x.onresult=(e:any)=>{cb(e.results[0]?.[0]?.transcript||'');setOn(false)}
    x.onerror=()=>setOn(false);x.onend=()=>setOn(false);r.current=x;x.start();setOn(true)
  },[on,cb]); return {on,toggle}
}

/* ─── IDS Detail Expander ─── */
function IdsDetail({ item, attendees, orgId, tmpl, onUpdate, onRemove }: {
  item: IdsItem; attendees: MeetingAttendee[]; orgId: string; tmpl: string
  onUpdate: (u: Partial<IdsItem>) => void; onRemove: () => void
}) {
  const [aiLoad, setAiLoad] = useState(false)
  const sc: Record<string,{c:string;l:string;n:IdsStatus}> = {
    identified:{c:'#D97706',l:'Identified',n:'discussing'}, discussing:{c:'#2563EB',l:'Discussing',n:'solved'},
    solved:{c:'#059669',l:'Solved',n:'solved'}, deferred:{c:'#6B7280',l:'Deferred',n:'deferred'},
  }
  const s = sc[item.status]||sc.identified

  const aiFill = async () => {
    setAiLoad(true)
    try {
      const res = await fetch('/api/ai/ids-analyzer',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({issue_text:item.description,org_id:orgId,meeting_template:tmpl,attendees:attendees.map(a=>a.display_name)})})
      if(res.ok){const d=await res.json();if(d.ids_item)onUpdate({issue_category:d.ids_item.issue_category,description:d.ids_item.description||item.description,dependencies_context:d.ids_item.dependencies_context,decisions_needed:d.ids_item.decisions_needed,action_items:d.ids_item.action_items,due_date:d.ids_item.due_date,owner_name:d.ids_item.owner})}
    } catch(e){console.error(e)} setAiLoad(false)
  }

  return (
    <div className="p-4 space-y-3 bg-white">
      {aiLoad && <div className="flex items-center gap-2 text-[11px] text-violet-500 py-1"><Loader2 size={11} className="animate-spin"/> AI analyzing...</div>}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={()=>onUpdate({status:s.n})} className="px-2.5 py-1 rounded-full text-[9px] font-bold" style={{background:s.c+'18',color:s.c}}>{s.l}</button>
        <button onClick={aiFill} disabled={aiLoad} className="flex items-center gap-1 px-2 py-1 text-[9px] font-semibold text-violet-500 bg-violet-50 rounded-lg hover:bg-violet-100 disabled:opacity-50"><Sparkles size={9}/> AI Fill</button>
        <input value={item.issue_category||''} onChange={e=>onUpdate({issue_category:e.target.value})} placeholder="Category..." className="text-[10px] font-semibold text-fire bg-fire/5 px-2 py-1 rounded-lg border-0 focus:outline-none w-32"/>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([['dependencies_context','Dependencies / Context'],['decisions_needed','Decisions Needed'],['action_items','Action Items'],['due_date','Due Date']] as const).map(([k,l])=>(
          <div key={k}><label className="text-[8px] font-bold text-gray-400 uppercase">{l}</label>
            {k==='due_date'?<input value={item[k]||''} onChange={e=>onUpdate({[k]:e.target.value})} placeholder="e.g. 2 weeks" className="w-full px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-gray-50/50 focus:outline-none"/>
            :<textarea value={item[k]||''} onChange={e=>onUpdate({[k]:e.target.value})} rows={2} className="w-full px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-gray-50/50 focus:outline-none resize-none"/>}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-[8px] font-bold text-gray-400 uppercase">Owner</label>
          <select value={item.owner_name||''} onChange={e=>{const a=attendees.find(x=>x.display_name===e.target.value);onUpdate({owner:a?.user_id||'',owner_name:e.target.value})}} className="w-full px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-gray-50/50 focus:outline-none">
            <option value="">Assign...</option>{attendees.map(a=><option key={a.user_id} value={a.display_name}>{a.display_name}</option>)}</select></div>
        {(item.status==='discussing'||item.status==='solved')&&<div><label className="text-[8px] font-bold text-gray-400 uppercase">Resolution</label>
          <textarea value={item.resolution||''} onChange={e=>onUpdate({resolution:e.target.value})} placeholder="Capture decision..." rows={2} className="w-full px-2 py-1.5 text-[10px] border border-gray-100 rounded-lg bg-gray-50/50 focus:outline-none resize-none"/></div>}
      </div>
      <div className="flex items-center justify-between pt-1 border-t border-gray-50">
        <button onClick={()=>onUpdate({status:'deferred'})} className="text-[9px] text-gray-400 hover:text-amber-500 flex items-center gap-0.5"><Archive size={9}/> Defer</button>
        <button onClick={onRemove} className="text-[9px] text-gray-300 hover:text-red-400 flex items-center gap-0.5"><Trash2 size={9}/> Remove</button>
      </div>
    </div>
  )
}

/* ─── End Review ─── */
function EndReview({ actions, onApprove, onDefer, onDelete, onNext }: {
  actions: MeetingActionItem[]; onApprove:(id:string)=>void; onDefer:(id:string)=>void; onDelete:(id:string)=>void; onNext:()=>void
}) {
  const approved = actions.filter(a => a.task_id)
  const pending = actions.filter(a => !a.task_id && !a.completed)
  return (
    <div className="space-y-4">
      <div className="text-center py-3">
        <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3"><CheckCircle2 size={24} className="text-green-500"/></div>
        <h3 className="text-sm font-bold text-np-dark">Meeting Complete</h3>
        <p className="text-xs text-gray-400 mt-0.5">Review each action item below</p>
      </div>
      {pending.length>0 && <div>
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Needs Review ({pending.length})</span>
        <div className="mt-2 space-y-1.5">{pending.map(a=>(
          <div key={a.id} className="flex items-center gap-2 p-3 bg-white rounded-xl border border-gray-100">
            <span className="text-xs text-np-dark flex-1">{a.title}</span>
            {a.owner_name && <span className="text-[9px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded shrink-0">{a.owner_name.split(' ')[0]}</span>}
            <div className="flex gap-1 shrink-0">
              <button onClick={()=>onApprove(a.id)} title="Approve → Task Manager" className="w-7 h-7 rounded-lg flex items-center justify-center bg-green-50 text-green-600 hover:bg-green-100"><ThumbsUp size={12}/></button>
              <button onClick={()=>onDefer(a.id)} title="Defer → Next meeting" className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600 hover:bg-amber-100"><RotateCcw size={12}/></button>
              <button onClick={()=>onDelete(a.id)} title="Delete" className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-400"><Trash2 size={12}/></button>
            </div>
          </div>
        ))}</div>
      </div>}
      {approved.length>0 && <div>
        <span className="text-[9px] font-bold text-green-500 uppercase tracking-wider">Sent to Tasks ({approved.length})</span>
        <div className="mt-1.5 space-y-1">{approved.map(a=>(<div key={a.id} className="flex items-center gap-2 py-1.5 text-[11px] text-gray-400"><Check size={10} className="text-green-500"/> <span className="line-through">{a.title}</span></div>))}</div>
      </div>}
      <button onClick={onNext} className="w-full flex items-center justify-center gap-2 py-3 bg-np-blue/5 text-np-blue text-xs font-semibold rounded-xl border border-np-blue/20 hover:bg-np-blue/10"><Calendar size={13}/> Schedule Next Meeting</button>
    </div>
  )
}

/* ─── Schedule Next ─── */
function SchedModal({ attendees, deferred, onSched, onClose }: {
  attendees: MeetingAttendee[]; deferred: MeetingActionItem[]; onSched:(d:string,t:string)=>void; onClose:()=>void
}) {
  const [d,setD]=useState('');const [t,setT]=useState('09:00')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6" onClick={e=>e.stopPropagation()}>
        <h3 className="text-sm font-bold text-np-dark mb-4">Schedule Next Meeting</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Date</label><input type="date" value={d} onChange={e=>setD(e.target.value)} className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-np-blue/20"/></div>
          <div><label className="text-[10px] font-semibold text-gray-500 uppercase">Time</label><input type="time" value={t} onChange={e=>setT(e.target.value)} className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-np-blue/20"/></div>
        </div>
        {deferred.length>0 && <div className="bg-amber-50 rounded-xl p-3 mb-4"><span className="text-[9px] font-bold text-amber-600 uppercase">Deferred Items ({deferred.length})</span><div className="mt-1 space-y-0.5">{deferred.map(a=><div key={a.id} className="text-[10px] text-amber-700">• {a.title}</div>)}</div></div>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button><button onClick={()=>d&&onSched(d,t)} disabled={!d} className="px-5 py-2 bg-np-blue text-white text-xs font-semibold rounded-xl disabled:opacity-40">Schedule</button></div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════ */
export default function MeetingDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { currentOrg } = useWorkspace()
  const { rocks } = useRockData()
  const { members } = useTeamData()
  const supabase = createClient()

  const [meeting, setMeeting] = useState<Meeting|null>(null)
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([])
  const [loading, setLoading] = useState(true)
  const [openSec, setOpenSec] = useState<number|null>(null)
  const [capText, setCapText] = useState('')
  const [showSched, setShowSched] = useState(false)
  const [editing, setEditing] = useState(false)
  const [prevActs, setPrevActs] = useState<MeetingActionItem[]>([])
  const [deferred, setDeferred] = useState<MeetingActionItem[]>([])
  const [expandedIds, setExpandedIds] = useState<string|null>(null)
  const capRef = useRef<HTMLInputElement>(null)
  const { on: vOn, toggle: vTog } = useVoice(t => setCapText(p => p?p+' '+t:t))

  const load = useCallback(async () => {
    if(!id) return; setLoading(true)
    const { data:m } = await supabase.from('meetings').select('*').eq('id',id).single()
    if(m) setMeeting({...m, ids_items:m.ids_items||[], action_items:m.action_items||[]})
    const { data:att } = await supabase.from('meeting_attendees').select('*, team_profiles:user_id(display_name)').eq('meeting_id',id)
    if(att) setAttendees(att.map((a:any)=>({...a, display_name:a.team_profiles?.display_name||'Unknown'})))
    if(m?.prev_meeting_id){const{data:prev}=await supabase.from('meetings').select('action_items').eq('id',m.prev_meeting_id).single();if(prev?.action_items)setPrevActs(prev.action_items.filter((a:any)=>!a.completed))}
    setLoading(false)
  },[id])
  useEffect(()=>{load()},[load])

  const save = async (u: Partial<Meeting>) => { if(!meeting) return; setMeeting(p=>p?{...p,...u}:p); await supabase.from('meetings').update({...u,updated_at:new Date().toISOString()}).eq('id',meeting.id) }

  const startMeeting = () => { save({status:'in_progress'}); setOpenSec(0) }
  const endMeeting = () => { extractActions(); save({status:'completed'}); setOpenSec(null) }

  const toggleSec = (i: number) => { if(meeting?.status!=='in_progress'&&meeting?.status!=='completed') return; setOpenSec(openSec===i?null:i) }

  const checkSec = (i: number) => {
    if(!meeting) return; const a=[...(meeting.agenda||[])]; a[i]={...a[i],completed:!a[i].completed}; save({agenda:a})
    if(a[i].completed){const nx=a.findIndex((s,j)=>j>i&&!s.completed); if(nx>=0) setOpenSec(nx)}
  }

  const updateNotes = (i:number,n:string) => { if(!meeting) return; const a=[...(meeting.agenda||[])]; a[i]={...a[i],notes:n}; save({agenda:a}) }

  const captureItem = () => {
    if(!capText.trim()||!meeting) return; const text=capText.trim()
    const isIds = openSec!==null && (meeting.agenda[openSec]?.section.toLowerCase().includes('ids')||meeting.agenda[openSec]?.section.toLowerCase().includes('identify'))
    if(isIds) {
      const ni: IdsItem = {id:crypto.randomUUID(),issue_category:'',description:text,dependencies_context:'',decisions_needed:'',action_items:'',due_date:'',owner:'',owner_name:'',status:'identified',resolution:'',created_at:new Date().toISOString()}
      save({ids_items:[...(meeting.ids_items||[]),ni]})
    } else {
      const na: MeetingActionItem = {id:crypto.randomUUID(),title:text,owner:'',owner_name:'',due_date:'',task_id:null,completed:false}
      save({action_items:[...(meeting.action_items||[]),na]})
    }
    setCapText(''); capRef.current?.focus()
  }

  const extractActions = () => {
    if(!meeting) return; const ex=[...(meeting.action_items||[])]
    ;(meeting.ids_items||[]).forEach(ids=>{if(ids.action_items?.trim()&&ids.status!=='deferred'){ids.action_items.split(/[;\n]/).map(l=>l.trim()).filter(Boolean).forEach(line=>{if(!ex.some(e=>e.title===line))ex.push({id:crypto.randomUUID(),title:line,owner:ids.owner,owner_name:ids.owner_name,due_date:ids.due_date,task_id:null,completed:false})})}})
    save({action_items:ex})
  }

  const updateIds = (itemId:string,u:Partial<IdsItem>) => { if(!meeting) return; save({ids_items:(meeting.ids_items||[]).map(i=>i.id===itemId?{...i,...u}:i)}) }
  const removeIds = (itemId:string) => { if(!meeting) return; save({ids_items:(meeting.ids_items||[]).filter(i=>i.id!==itemId)}) }

  const approveAction = async (aid:string) => {
    if(!meeting||!currentOrg) return; const action=(meeting.action_items||[]).find(a=>a.id===aid); if(!action) return
    const{data:cols}=await supabase.from('kanban_columns').select('id').eq('org_id',currentOrg.id).order('sort_order').limit(1); if(!cols?.length) return
    const{data:task}=await supabase.from('kanban_tasks').insert({org_id:currentOrg.id,column_id:cols[0].id,title:action.title,source:'meeting',priority:'medium',visibility:'everyone',sort_order:0,assignee:action.owner||null,custom_fields:{meeting_id:meeting.id,raci_responsible:action.owner_name}}).select().single()
    if(task) save({action_items:(meeting.action_items||[]).map(a=>a.id===aid?{...a,task_id:task.id}:a)})
  }

  const deferAction = (aid:string) => {
    if(!meeting) return; const a=(meeting.action_items||[]).find(x=>x.id===aid); if(a) setDeferred(p=>[...p,a])
    save({action_items:(meeting.action_items||[]).filter(x=>x.id!==aid)})
  }

  const deleteAction = (aid:string) => { if(!meeting) return; save({action_items:(meeting.action_items||[]).filter(a=>a.id!==aid)}) }

  const schedNext = async (date:string,time:string) => {
    if(!meeting||!currentOrg) return
    const carry=[...deferred,...(meeting.action_items||[]).filter(a=>!a.task_id&&!a.completed)]
    const{data:nm}=await supabase.from('meetings').insert({org_id:currentOrg.id,title:meeting.title,template:meeting.template,scheduled_at:new Date(`${date}T${time}:00`).toISOString(),duration_minutes:meeting.duration_minutes,status:'scheduled',prev_meeting_id:meeting.id,agenda:[{section:'Review Previous Action Items',duration_min:10,notes:'',completed:false},...(meeting.agenda||[]).filter(s=>!s.section.toLowerCase().includes('review previous'))],action_items:carry}).select().single()
    if(nm){await supabase.from('meetings').update({next_meeting_id:nm.id}).eq('id',meeting.id);if(attendees.length>0)await supabase.from('meeting_attendees').insert(attendees.map(a=>({meeting_id:nm.id,user_id:a.user_id})));setShowSched(false);router.push(`/meetings/${nm.id}`)}
  }

  const editSecTime = (i:number,m:number) => {if(!meeting)return;const a=[...(meeting.agenda||[])];a[i]={...a[i],duration_min:Math.max(1,m)};save({agenda:a})}
  const editSecName = (i:number,n:string) => {if(!meeting)return;const a=[...(meeting.agenda||[])];a[i]={...a[i],section:n};save({agenda:a})}
  const addSec = () => {if(!meeting)return;save({agenda:[...(meeting.agenda||[]),{section:'New Section',duration_min:10,notes:'',completed:false}]})}
  const rmSec = (i:number) => {if(!meeting)return;save({agenda:(meeting.agenda||[]).filter((_,j)=>j!==i)})}

  if(loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-np-blue"/></div>
  if(!meeting) return <div className="text-center py-16 text-sm text-gray-400">Meeting not found</div>

  const tmpl = MEETING_TEMPLATES[meeting.template as MeetingTemplate]||MEETING_TEMPLATES.custom
  const live = meeting.status==='in_progress'; const done = meeting.status==='completed'
  const ids = meeting.ids_items||[]; const acts = meeting.action_items||[]
  const isIds = (s:AgendaSection) => s.section.toLowerCase().includes('ids')||s.section.toLowerCase().includes('identify')
  const isRock = (s:AgendaSection) => s.section.toLowerCase().includes('rock')
  const isReview = (s:AgendaSection) => s.section.toLowerCase().includes('review previous')

  return (
    <div className="space-y-4 animate-in fade-in duration-300 max-w-3xl mx-auto pb-32">
      <button onClick={()=>router.push('/meetings')} className="flex items-center gap-1 text-xs text-np-blue font-semibold hover:text-np-dark"><ChevronLeft size={14}/> Meetings</button>

      {/* ═══ HEADER ═══ */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5">
          <div className="flex items-center gap-3">
            {live && <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse shrink-0"/>}
            <BadgePill text={tmpl.label} color={tmpl.color}/>
            <h1 className="text-base font-bold text-np-dark flex-1">{meeting.title}</h1>
            {meeting.status==='scheduled' && <button onClick={startMeeting} className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white text-xs font-semibold rounded-xl hover:bg-green-600 shadow-sm"><Play size={11}/> Start</button>}
            {live && <button onClick={endMeeting} className="flex items-center gap-1.5 px-4 py-2 bg-np-dark text-white text-xs font-semibold rounded-xl"><Check size={11}/> End Meeting</button>}
            {meeting.status==='scheduled' && <button onClick={()=>setEditing(!editing)} className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold text-gray-400 hover:text-np-dark rounded-lg hover:bg-gray-50"><Edit3 size={10}/> Edit</button>}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><Clock size={9}/>{meeting.scheduled_at?new Date(meeting.scheduled_at).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'No date'} · {meeting.duration_minutes} min</span>
            {attendees.length>0 && <AvatarStack list={attendees.map(a=>({initials:(a.display_name||'??').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()}))}/>}
          </div>
        </div>
      </div>

      {/* ═══ PREVIOUS ACTIONS ═══ */}
      {prevActs.length>0 && !done && (
        <div className="bg-amber-50/60 border border-amber-100 rounded-xl px-5 py-3">
          <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Previous Action Items</span>
          <div className="mt-1.5 space-y-1">{prevActs.map(a=>(
            <div key={a.id} className="flex items-center gap-2 text-[11px] text-amber-800"><ArrowRight size={9} className="shrink-0"/><span>{a.title}</span>{a.owner_name&&<span className="text-amber-500">— {a.owner_name.split(' ')[0]}</span>}</div>
          ))}</div>
        </div>
      )}

      {/* ═══ AGENDA ACCORDION ═══ */}
      <div className="space-y-1.5">
        {(meeting.agenda||[]).map((sec,i) => {
          const open = openSec===i
          const secIsIds = isIds(sec); const secIsRock = isRock(sec); const secIsReview = isReview(sec)
          const idsHere = secIsIds ? ids : []; const idsCount = idsHere.length

          return (
            <div key={i} className={`bg-white rounded-xl border overflow-hidden transition-all ${open?'border-np-blue/20 shadow-sm':'border-gray-100'}`}>
              {/* Row */}
              <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer select-none" onClick={()=>toggleSec(i)}>
                <button onClick={e=>{e.stopPropagation();checkSec(i)}} className={`w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 transition-colors ${sec.completed?'bg-green-500 border-green-500':'border-gray-200 hover:border-np-blue'}`}>
                  {sec.completed && <Check size={11} className="text-white" strokeWidth={3}/>}
                </button>

                {editing ? (
                  <input value={sec.section} onClick={e=>e.stopPropagation()} onChange={e=>editSecName(i,e.target.value)} className="flex-1 text-sm font-semibold text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 focus:px-2 rounded-lg"/>
                ) : (
                  <span className={`text-sm font-semibold flex-1 ${sec.completed?'text-gray-400 line-through':'text-np-dark'}`}>{sec.section}</span>
                )}

                {secIsIds && idsCount>0 && <span className="text-[9px] font-bold text-fire bg-fire/10 px-2 py-0.5 rounded-full">{ids.filter(x=>x.status==='solved').length}/{idsCount}</span>}
                {secIsReview && prevActs.length>0 && <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">{prevActs.length}</span>}

                {live && open && <STimer dur={sec.duration_min} go={open}/>}

                {editing ? (
                  <div className="flex items-center gap-1" onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>editSecTime(i,sec.duration_min-5)} className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">−</button>
                    <span className="text-[10px] font-bold text-gray-500 w-7 text-center">{sec.duration_min}m</span>
                    <button onClick={()=>editSecTime(i,sec.duration_min+5)} className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:bg-gray-100 flex items-center justify-center">+</button>
                    <button onClick={()=>rmSec(i)} className="ml-1 text-gray-300 hover:text-red-400"><X size={11}/></button>
                  </div>
                ) : (
                  <span className="text-[10px] text-gray-400 font-medium shrink-0">{sec.duration_min} min</span>
                )}
                <ChevronDown size={13} className={`text-gray-300 transition-transform ${open?'rotate-180':''}`}/>
              </div>

              {/* Expanded */}
              {open && (
                <div className="border-t border-gray-100">
                  {/* Notes */}
                  <div className="px-5 py-3">
                    <textarea value={sec.notes} onChange={e=>updateNotes(i,e.target.value)} placeholder="Section notes..." rows={2}
                      className="w-full text-xs text-gray-600 bg-gray-50/50 rounded-lg p-3 border border-gray-100 focus:outline-none focus:ring-1 focus:ring-np-blue/20 resize-none placeholder-gray-300"/>
                  </div>

                  {/* Previous Action Review */}
                  {secIsReview && prevActs.length>0 && (
                    <div className="px-5 pb-3 space-y-1">
                      {prevActs.map(a=>(
                        <div key={a.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                          <span className="text-amber-500 font-semibold">○</span>
                          <span className="text-np-dark flex-1">{a.title}</span>
                          {a.owner_name && <span className="text-gray-400">{a.owner_name.split(' ')[0]}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Rock Review */}
                  {secIsRock && rocks.length>0 && (
                    <div className="px-5 pb-3 space-y-1">
                      {rocks.map(r=>(
                        <div key={r.id} className="flex items-center gap-2 py-1.5">
                          <StatusDot status={r.status}/><span className="text-[11px] font-medium text-np-dark flex-1 truncate">{r.title}</span>
                          <ProgressBar pct={r.progress_pct} className="max-w-[80px]"/><span className="text-[10px] font-bold text-gray-500 w-7 text-right">{r.progress_pct}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* IDS Items */}
                  {secIsIds && (
                    <div className="px-5 pb-3">
                      {idsHere.length===0 && <p className="text-xs text-gray-400 py-4 text-center">No IDS issues — use the capture bar to add one</p>}
                      {idsHere.map(item=>(
                        <div key={item.id} className="mb-2 rounded-lg border border-gray-100 overflow-hidden">
                          <div className="px-3 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-gray-50/50" onClick={()=>setExpandedIds(expandedIds===item.id?null:item.id)}>
                            <span className="px-2 py-0.5 rounded-full text-[8px] font-bold" style={{background:item.status==='solved'?'#D1FAE5':item.status==='discussing'?'#DBEAFE':'#FEF3C7',color:item.status==='solved'?'#059669':item.status==='discussing'?'#2563EB':'#D97706'}}>{item.status.slice(0,4).toUpperCase()}</span>
                            <span className="text-xs text-np-dark font-medium flex-1 truncate">{item.description}</span>
                            {item.owner_name && <span className="text-[9px] text-gray-400">{item.owner_name.split(' ')[0]}</span>}
                            <ChevronRight size={11} className={`text-gray-300 transition-transform ${expandedIds===item.id?'rotate-90':''}`}/>
                          </div>
                          {expandedIds===item.id && <IdsDetail item={item} attendees={attendees} orgId={currentOrg?.id||''} tmpl={meeting.template} onUpdate={u=>updateIds(item.id,u)} onRemove={()=>removeIds(item.id)}/>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {editing && <button onClick={addSec} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30">+ Add Section</button>}
      </div>

      {/* ═══ LIVE CAPTURED ITEMS ═══ */}
      {live && acts.length>0 && (
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Captured ({acts.length})</span>
          <div className="mt-2 space-y-1">{acts.map(a=>(
            <div key={a.id} className="flex items-center gap-2 text-[11px] py-1">
              <Check size={9} className="text-np-blue shrink-0"/><span className="text-np-dark flex-1">{a.title}</span>
              <button onClick={()=>deleteAction(a.id)} className="text-gray-200 hover:text-red-400"><X size={10}/></button>
            </div>
          ))}</div>
        </div>
      )}

      {/* ═══ END REVIEW ═══ */}
      {done && (
        <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
          <EndReview actions={acts} onApprove={approveAction} onDefer={deferAction} onDelete={deleteAction} onNext={()=>setShowSched(true)}/>
        </div>
      )}

      {/* ═══ CAPTURE BAR — fixed bottom ═══ */}
      {live && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-gray-200 px-6 py-3 shadow-lg">
          <div className="max-w-3xl mx-auto flex gap-2">
            <div className="relative flex-1">
              <input ref={capRef} value={capText} onChange={e=>setCapText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey)captureItem()}}
                placeholder={openSec!==null&&isIds(meeting.agenda[openSec])?'📌 Capture IDS issue...':'✏️ Capture action item...'}
                className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-np-blue/20 pr-12"/>
              <button onClick={vTog} className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg ${vOn?'text-red-500 animate-pulse':'text-gray-300 hover:text-np-blue'}`}>{vOn?<MicOff size={14}/>:<Mic size={14}/>}</button>
            </div>
            <button onClick={captureItem} disabled={!capText.trim()} className="px-4 py-3 bg-np-blue text-white rounded-xl disabled:opacity-30 hover:bg-np-dark shrink-0"><Plus size={16}/></button>
          </div>
          {vOn && <p className="text-[10px] text-red-500 mt-1 text-center animate-pulse">🎤 Listening...</p>}
        </div>
      )}

      {showSched && <SchedModal attendees={attendees} deferred={deferred} onSched={schedNext} onClose={()=>setShowSched(false)}/>}
    </div>
  )
}
