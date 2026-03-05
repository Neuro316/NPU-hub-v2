'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import { DollarSign, Users, TrendingUp, ChevronLeft, Plus, X, Settings as SettingsIcon, BarChart3, LayoutDashboard, Search, Wallet, Megaphone, Trash2, Pencil, Download, FileText, Building2, Calendar as CalendarIcon } from 'lucide-react'

interface AcctLocation { id: string; name: string; short_code: string; color: string; clinic_id: string | null; org_id: string }
interface AcctClinic { id: string; org_id: string; name: string; contact_name: string; ein: string; corp_type: string; has_w9: boolean; has_1099: boolean; address: string; city: string; state: string; zip: string; phone: string; email: string; website: string; notes: string; split_snw: number; split_clinic: number; split_dr: number; flat_snw: number; flat_clinic: number; flat_dr: number }
interface AcctPayment { id: string; service_id: string; client_id: string; amount: number; payment_date: string; notes: string; split_snw: number; split_clinic: number; split_dr: number; clinic_id: string | null; payout_date: string; payout_period: string; is_paid_out: boolean }
interface AcctService { id: string; client_id: string; service_type: 'Map' | 'Program'; amount: number; service_date: string; notes: string; payments: AcctPayment[] }
interface AcctClient { id: string; name: string; location_id: string; org_id: string; notes: string; services: AcctService[] }
interface AcctConfig { map_splits: { snw: number; dr: number; snw_flat: number; dr_flat: number }; cc_processing_fee: number; snw_base_pct: number; snw_base_flat: number; default_map_price: number; default_program_price: number; payout_agreement: string; marketing?: { monthly_total: number; clinic_share: number; dr_share: number } }
interface AcctCheck { id: string; org_id: string; payee_type: 'clinic' | 'dr'; payee_clinic_id: string | null; check_number: string; check_date: string; amount: number; memo: string; created_at: string }
interface AcctMktgCharge { id: string; org_id: string; month: string; payee_type: 'clinic' | 'dr'; payee_clinic_id: string | null; amount: number; description: string; waived: boolean }

const $$ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
const r2 = (n: number) => Math.round(n * 100) / 100
const fD = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const fMoL = (m: string) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
const gI = (n: string) => n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
const td = () => new Date().toISOString().split('T')[0]
const curMonth = () => td().substring(0, 7)
const COLORS = ['#f0b429','#f472b6','#a78bfa','#4dcfcf','#e8864a','#3dd68c','#ef6b6b','#60a5fa','#f9a8d4','#a3e635']
const stClr: Record<string,{bg:string;tx:string}> = { 'Paid in Full':{bg:'bg-green-50',tx:'text-green-700'}, 'Payment Plan':{bg:'bg-amber-50',tx:'text-amber-700'}, 'Stopped/Incomplete':{bg:'bg-red-50',tx:'text-red-600'}, 'Map Only':{bg:'bg-gray-100',tx:'text-gray-600'}, Trade:{bg:'bg-purple-50',tx:'text-purple-600'}, 'No Services':{bg:'bg-gray-50',tx:'text-gray-400'} }

function getStatus(c: AcctClient) {
  if (!c.services.length) return 'No Services'
  if (c.services.every(s => s.amount === 0)) return 'Trade'
  const p = c.services.find(s => s.service_type === 'Program')
  if (!p) return 'Map Only'
  const pd = p.payments.reduce((s, x) => s + x.amount, 0)
  if (p.notes?.toLowerCase().includes('stop')) return 'Stopped/Incomplete'
  return pd >= p.amount ? 'Paid in Full' : 'Payment Plan'
}
// ══════════════════════════════════════════════════════════════
// SENSORIUM ACCOUNTING AGREEMENT
// ──────────────────────────────────────────────────────────────
// Pre-Aug 1 2025: SNW received only 10% of gross Program fee.
//   Clinic received flat fee via waterfall. Dr. Yonce got rest.
// Post-Aug 1 2025: SNW receives split_snw% (26%) of gross.
//   Clinic flat target distributed proportionally across payments
//   based on agreed program total (acct_services.amount).
//   SNW collects at higher proportion until full fee satisfied.
// ALL CC processing fees go to Sensorium always.
// Clinics submit biweekly invoices with session totals by client.
// Sensorium pays out on all sessions performed per invoice.
// ══════════════════════════════════════════════════════════════
const PRE_AUG_CUTOFF = '2025-08-01'
const PRE_AUG_SNW_PCT = 10

function calcSplit(
  amt: number,
  svcType: string,
  locId: string,
  locs: AcctLocation[],
  clinics: AcctClinic[],
  cfg: AcctConfig,
  serviceTotal?: number,
  serviceStartDate?: string, // if SERVICE started pre-Aug, ALL payments use 10%
) {
  if (amt <= 0) return { snw: 0, dr: 0, cc: 0, snwService: 0, clinicAmts: {} as Record<string, number> }
  const ccPct = cfg.cc_processing_fee ?? 3
  const ccAmt = r2(amt * ccPct / 100) // CC always goes to Sensorium

  // If the SERVICE started before Aug 1 2025, ALL payments use legacy 10%
  const isPreAug = serviceStartDate ? serviceStartDate < PRE_AUG_CUTOFF : false

  // ── MAP (qEEG): SNW + Dr only, clinic = $0 always ──
  if (svcType === 'Map') {
    const ms = cfg.map_splits
    const snwAmt = r2(amt * ms.snw / 100)
    const drAmt = r2(amt - snwAmt)
    return { snw: Math.max(snwAmt, 0), dr: Math.max(drAmt, 0), cc: ccAmt, snwService: r2(Math.max(snwAmt - ccAmt, 0)), clinicAmts: {} as Record<string, number> }
  }

  // ── PROGRAM ──
  const loc = locs.find(l => l.id === locId)
  const cl = loc?.clinic_id ? clinics.find(c => c.id === loc.clinic_id) : null

  if (cl) {
    const hasFlat = (cl.flat_clinic || 0) > 0

    if (hasFlat) {
      if (isPreAug) {
        // ══════ PRE-AUGUST 2025: LEGACY 10% ERA ══════
        // SNW received only 10% of gross (not 26%).
        // Clinic flat target ($3395) distributed PROPORTIONALLY
        // across payments based on program total, NOT per-payment waterfall.
        // This ensures clinic is capped at flat_clinic total across all payments
        // and Dr. Yonce receives remainder on every payment.
        const snwTotal = r2(amt * PRE_AUG_SNW_PCT / 100)
        const svcPortion = r2(Math.max(snwTotal - ccAmt, 0))

        if ((serviceTotal || 0) > 0) {
          const clinicGrossPct = (cl.flat_clinic || 0) / (serviceTotal || 1)
          let clinicAmt = r2(amt * clinicGrossPct)
          // Safety: clinic cannot exceed post-SNW pool
          clinicAmt = r2(Math.min(clinicAmt, Math.max(amt - snwTotal, 0)))
          let drAmt = r2(amt - snwTotal - clinicAmt)
          const drift = r2(amt - snwTotal - clinicAmt - drAmt)
          if (Math.abs(drift) >= 0.01) drAmt = r2(drAmt + drift)
          drAmt = Math.max(drAmt, 0)
          return {
            snw: Math.max(snwTotal, 0),
            dr: drAmt,
            cc: ccAmt,
            snwService: Math.max(svcPortion, 0),
            clinicAmts: { [cl.id]: Math.max(clinicAmt, 0) } as Record<string, number>,
          }
        }

        // Fallback if no serviceTotal
        const poolAfterSNW = r2(amt - snwTotal)
        const clinicFee = r2(Math.min(cl.flat_clinic, Math.max(poolAfterSNW, 0)))
        let drFee = r2(poolAfterSNW - clinicFee)
        const drift = r2(amt - snwTotal - clinicFee - drFee)
        drFee = r2(drFee + drift)
        return {
          snw: Math.max(snwTotal, 0),
          dr: Math.max(drFee, 0),
          cc: ccAmt,
          snwService: Math.max(svcPortion, 0),
          clinicAmts: { [cl.id]: Math.max(clinicFee, 0) } as Record<string, number>,
        }
      }

      // ══════ POST-AUGUST 2025: PROPORTIONAL MODE ══════
      // flat_clinic = clinic's TOTAL target across full program.
      // Each payment: clinic gets (flat_clinic / programTotal) * payment.
      // SNW gets split_snw% of gross (includes CC). Higher rate to
      // catch up from pre-Aug 10% deficit.
      const snwPct = cl.split_snw || 26
      const snwTotal = r2(amt * snwPct / 100)
      const svcPortion = r2(Math.max(snwTotal - ccAmt, 0))

      if ((serviceTotal || 0) > 0) {
        const clinicGrossPct = (cl.flat_clinic || 0) / (serviceTotal || 1)
        let clinicAmt = r2(amt * clinicGrossPct)
        // Safety: clinic cannot exceed post-SNW pool
        clinicAmt = r2(Math.min(clinicAmt, Math.max(amt - snwTotal, 0)))
        let drAmt = r2(amt - snwTotal - clinicAmt)
        const drift = r2(amt - snwTotal - clinicAmt - drAmt)
        if (Math.abs(drift) >= 0.01) drAmt = r2(drAmt + drift)
        drAmt = Math.max(drAmt, 0) // Dr never negative
        return {
          snw: Math.max(snwTotal, 0),
          dr: drAmt,
          cc: ccAmt,
          snwService: Math.max(svcPortion, 0),
          clinicAmts: { [cl.id]: Math.max(clinicAmt, 0) } as Record<string, number>,
        }
      }

      // Fallback: no serviceTotal, use old waterfall
      const poolAfterSNW = r2(amt - snwTotal)
      const clinicFee = r2(Math.min(cl.flat_clinic, Math.max(poolAfterSNW, 0)))
      let drFee = r2(poolAfterSNW - clinicFee)
      const drift = r2(amt - snwTotal - clinicFee - drFee)
      drFee = r2(drFee + drift)
      return {
        snw: Math.max(snwTotal, 0),
        dr: Math.max(drFee, 0),
        cc: ccAmt,
        snwService: Math.max(svcPortion, 0),
        clinicAmts: { [cl.id]: Math.max(clinicFee, 0) } as Record<string, number>,
      }
    } else {
      // ══════ PERCENTAGE MODE (no flat) ══════
      const snwAmt = r2(amt * cl.split_snw / 100)
      const clinicAmt = r2(amt * cl.split_clinic / 100)
      let drAmt = r2(amt - snwAmt - clinicAmt)
      const drift = r2(amt - snwAmt - clinicAmt - drAmt)
      drAmt = r2(drAmt + drift)
      return {
        snw: Math.max(snwAmt, 0),
        dr: Math.max(drAmt, 0),
        cc: ccAmt,
        snwService: r2(snwAmt - ccAmt),
        clinicAmts: { [cl.id]: Math.max(clinicAmt, 0) } as Record<string, number>,
      }
    }
  }

  // No clinic fallback
  const snwAmt = r2(amt * 81.01 / 100)
  const drAmt = r2(amt - snwAmt)
  return { snw: Math.max(snwAmt, 0), dr: Math.max(drAmt, 0), cc: ccAmt, snwService: r2(snwAmt - ccAmt), clinicAmts: {} as Record<string, number> }
}
function getPayoutDate(d: string) { const dt = new Date(d+'T12:00:00'); const day = dt.getDate(); const m = dt.getMonth(); const y = dt.getFullYear(); return day <= 15 ? new Date(y,m+1,1).toISOString().split('T')[0] : new Date(y,m+1,15).toISOString().split('T')[0] }

/* ── tiny components ─────────────────────────────── */
function Stat({label,value,color,sub,icon:Icon}:any) {
  return <div className="relative overflow-hidden rounded-xl border border-gray-100 bg-white p-4 flex-1 min-w-[140px]">
    {color && <div className="absolute top-0 left-0 right-0 h-0.5" style={{background:color}} />}
    <div className="flex items-start justify-between"><div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-xl font-bold mt-0.5 tracking-tight text-np-dark" style={{fontFeatureSettings:'"tnum"'}}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>{Icon && <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:(color||'#386797')+'18',color:color||'#386797'}}><Icon className="w-4 h-4"/></div>}</div>
  </div>
}
const Badge = ({s}:{s:string}) => { const c=stClr[s]||{bg:'bg-gray-50',tx:'text-gray-500'}; return <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold ${c.bg} ${c.tx}`}>{s}</span> }
const LocTag = ({loc,locs}:{loc:string;locs:AcctLocation[]}) => { const l=locs.find(x=>x.id===loc); return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-gray-50 text-gray-600"><span className="w-2 h-2 rounded-full" style={{background:l?.color||'#999'}}/>{l?.name||loc}</span> }

function Mdl({title,onClose,children,wide}:{title:string;onClose:()=>void;children:React.ReactNode;wide?:boolean}) {
  return <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} className={`bg-white rounded-2xl shadow-xl border border-gray-100 ${wide?'w-[720px]':'w-[500px]'} max-w-[94vw] max-h-[88vh] overflow-y-auto`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-bold text-np-dark">{title}</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400"/></button>
      </div><div className="p-5">{children}</div>
    </div></div>
}
function FI({label,value,onChange,type,placeholder,half}:any) {
  return <div className={`mb-3 ${half?'flex-1':''}`}>
    {label && <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</label>}
    <input type={type||'text'} value={value} onChange={(e:any)=>onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue/40"/>
  </div>
}
function FS({label,value,onChange,options}:any) {
  return <div className="mb-3">
    {label && <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</label>}
    <select value={value} onChange={(e:any)=>onChange(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue/40">
      {options.map((o:any)=><option key={o.v} value={o.v}>{o.l}</option>)}
    </select></div>
}
function SplitPrev({amt,svcType,locId,locs,clinics,cfg,serviceTotal,serviceStartDate}:any) {
  if (!amt||amt<=0) return null; const sp=calcSplit(amt,svcType,locId,locs,clinics,cfg,serviceTotal,serviceStartDate)
  const cl=(()=>{const loc=locs.find((l:any)=>l.id===locId);return loc?.clinic_id?clinics.find((c:any)=>c.id===loc.clinic_id):null})()
  const isWaterfall = svcType==='Program' && cl && (cl.flat_clinic||0)>0
  const clAmt = Object.values(sp.clinicAmts).reduce((s:number,v:any)=>s+v,0)
  const ccPct = cfg.cc_processing_fee ?? 3
  return <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Distribution Preview {isWaterfall?(serviceStartDate&&serviceStartDate<'2025-08-01'?'(Pre-Aug Legacy 10%)':'(Proportional)'):svcType==='Map'?'(Map Split)':'(% Split)'}</p>
    {/* Waterfall steps */}
    {isWaterfall && <div className="space-y-1.5 mb-3 pb-3 border-b border-gray-200">
      <div className="flex justify-between text-[11px]"><span className="text-gray-400">Gross Program Fee</span><span className="font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(amt)}</span></div>
      <div className="flex justify-between text-[11px]"><span className="text-np-blue font-medium">SNW Total ({cl?.split_snw||26}% of gross)</span><span className="font-semibold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.snw)}</span></div>
      <div className="pl-4 space-y-0.5">
        <div className="flex justify-between text-[10px]"><span className="text-gray-400">CC Processing ({ccPct}%)</span><span className="text-gray-400" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.cc)}</span></div>
        <div className="flex justify-between text-[10px]"><span className="text-gray-400">Contract Services ({r2((cl?.split_snw||26)-ccPct)}%)</span><span className="text-gray-400" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.snwService)}</span></div>
      </div>
      <div className="flex justify-between text-[11px]"><span className="text-gray-400">Pool after SNW</span><span className="font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(r2(amt-sp.snw))}</span></div>
      <div className="flex justify-between text-[11px]"><span className="text-amber-600 font-medium">Clinic Flat Fee → {cl?.name?.split('(')[0]?.trim()||'Clinic'}</span><span className="font-semibold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(clAmt)}</span></div>
      <div className="flex justify-between text-[11px]"><span className="text-purple-600 font-medium">Dr. Yonce (remainder)</span><span className="font-semibold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.dr)}</span></div>
    </div>}
    {/* Non-waterfall CC note */}
    {!isWaterfall && svcType==='Program' && cl && <div className="text-[10px] text-gray-400 mb-2 pb-2 border-b border-gray-200">SNW {cl.split_snw}% includes {ccPct}% CC processing + {r2(cl.split_snw-ccPct)}% services</div>}
    {/* Payout buckets */}
    <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Payout Totals</p>
    <div className="flex gap-2 flex-wrap">
      <div className="flex-1 text-center p-2 bg-white rounded-lg border border-gray-100 min-w-[80px]">
        <p className="text-[10px] font-semibold text-np-blue mb-0.5">Sensorium</p>
        <p className="text-sm font-bold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.snw)}</p>
        <p className="text-[9px] text-gray-400 mt-0.5" style={{fontFeatureSettings:'"tnum"'}}>{r2(sp.snw/amt*100)}% of gross</p>
      </div>
      {Object.entries(sp.clinicAmts).map(([cid,ca])=>{const c=clinics.find((x:any)=>x.id===cid);return<div key={cid} className="flex-1 text-center p-2 bg-white rounded-lg border border-gray-100 min-w-[80px]">
        <p className="text-[10px] font-semibold text-amber-600 mb-0.5">{c?.name?.split('(')[0]?.trim()||'Clinic'}</p>
        <p className="text-sm font-bold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(ca as number)}</p>
        <p className="text-[9px] text-gray-400 mt-0.5" style={{fontFeatureSettings:'"tnum"'}}>{r2((ca as number)/amt*100)}% of gross</p>
      </div>})}
      <div className="flex-1 text-center p-2 bg-white rounded-lg border border-gray-100 min-w-[80px]">
        <p className="text-[10px] font-semibold text-purple-600 mb-0.5">Dr. Yonce</p>
        <p className="text-sm font-bold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.dr)}</p>
        <p className="text-[9px] text-gray-400 mt-0.5" style={{fontFeatureSettings:'"tnum"'}}>{r2(sp.dr/amt*100)}% of gross</p>
      </div>
    </div>
    {svcType==='Map'&&<p className="text-[10px] text-gray-400 mt-2">Maps: SNW + Dr. Yonce only</p>}
    {svcType==='Program'&&!cl&&<p className="text-[10px] text-amber-600 mt-2">No clinic assigned. Clinic share goes to SNW.</p>}
    <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-[10px]">
      <span className="text-gray-400">Sum check</span>
      <span className={`font-semibold ${Math.abs(sp.snw+clAmt+sp.dr-amt)<0.02?'text-green-600':'text-red-500'}`} style={{fontFeatureSettings:'"tnum"'}}>
        {$$(r2(sp.snw+clAmt+sp.dr))} / {$$(amt)} {Math.abs(sp.snw+clAmt+sp.dr-amt)<0.02?'✓':'✗'}
      </span>
    </div>
  </div>
}
function SplitIn({label,value,onChange,flatValue,onFlatChange}:{label:string;value:number;onChange:(v:number)=>void;flatValue?:number;onFlatChange?:(v:number)=>void}) {
  const hasFlat = (flatValue||0) > 0
  return <div className="flex items-center gap-2 py-1">
    <span className="text-xs text-gray-500 w-16 font-medium">{label}</span>
    <input type="number" value={value} onChange={e=>onChange(parseFloat(e.target.value)||0)} step={0.5} className={`w-16 px-2 py-1 text-sm font-semibold border rounded-md bg-white text-right focus:outline-none focus:ring-2 focus:ring-np-blue/20 ${hasFlat?'border-gray-100 text-gray-300':'border-gray-200 text-np-dark'}`} style={{fontFeatureSettings:'"tnum"'}}/>
    <span className="text-xs text-gray-400">%</span>
    {onFlatChange!==undefined&&<>
      <span className="text-xs text-gray-300 mx-1">or</span>
      <span className="text-xs text-gray-400">$</span>
      <input type="number" value={flatValue||''} onChange={e=>onFlatChange(parseFloat(e.target.value)||0)} placeholder="0" className={`w-20 px-2 py-1 text-sm font-semibold border rounded-md bg-white text-right focus:outline-none focus:ring-2 focus:ring-np-blue/20 ${hasFlat?'border-green-300 text-green-700':'border-gray-200 text-np-dark'}`} style={{fontFeatureSettings:'"tnum"'}}/>
      <span className="text-xs text-gray-400">flat</span>
      {hasFlat&&<span className="text-[9px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded font-semibold">FLAT</span>}
    </>}
  </div>
}
const Btn = ({children,onClick,outline,disabled,sm}:any) => <button onClick={onClick} disabled={disabled} className={`${sm?'px-2.5 py-1 text-[10px]':'px-3 py-1.5 text-xs'} font-semibold rounded-lg transition-colors disabled:opacity-40 ${outline?'text-np-blue border border-np-blue/30 hover:bg-np-blue/5':'text-white bg-np-blue hover:bg-np-accent'}`}>{children}</button>
const BtnDanger = ({children,onClick,sm}:any) => <button onClick={onClick} className={`${sm?'px-2 py-1 text-[10px]':'px-3 py-1.5 text-xs'} font-semibold text-red-500 border border-red-200 rounded-lg hover:bg-red-50`}>{children}</button>
const TH = ({children,className:cn}:any) => <th className={`py-2 px-4 text-[9px] font-semibold uppercase tracking-wider text-gray-400 ${cn||''}`}>{children}</th>

/* ── Dashboard ────────────────────────────────────── */
function DashView({clients,locs,onSel,onAdd}:{clients:AcctClient[];locs:AcctLocation[];onSel:(id:string)=>void;onAdd:()=>void}) {
  const tO=clients.reduce((s,c)=>s+c.services.reduce((a,v)=>a+v.amount,0),0)
  const tC=clients.reduce((s,c)=>s+c.services.reduce((a,v)=>a+v.payments.reduce((p,x)=>p+x.amount,0),0),0)
  const prg=clients.filter(c=>c.services.some(s=>s.service_type==='Program'))
  const mpo=clients.filter(c=>!c.services.some(s=>s.service_type==='Program')&&c.services.some(s=>s.amount>0))
  return <div className="space-y-5">
    <div className="flex items-center justify-between"><h2 className="text-base font-bold text-np-dark">Dashboard</h2>
      <button onClick={onAdd} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-np-blue rounded-lg hover:bg-np-accent transition-colors"><Plus className="w-3.5 h-3.5"/>Add Client</button></div>
    <div className="flex gap-3 flex-wrap"><Stat label="Clients" value={clients.length} color="#386797" icon={Users}/><Stat label="Revenue" value={$$(tO)} color="#386797" icon={DollarSign}/><Stat label="Collected" value={$$(tC)} color="#34A853" icon={TrendingUp}/><Stat label="Outstanding" value={$$(tO-tC)} color={tO-tC>0?'#FBBC04':'#34A853'}/></div>
    <div className="flex gap-3 flex-wrap">{locs.map(l=>{const lc=clients.filter(c=>c.location_id===l.id).reduce((s,c)=>s+c.services.reduce((a,v)=>a+v.payments.reduce((p,x)=>p+x.amount,0),0),0);return<Stat key={l.id} label={l.name} value={$$(lc)} color={l.color} sub={`${clients.filter(c=>c.location_id===l.id).length} clients`}/>})}</div>
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Programs ({prg.length})</h3></div>
      <div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30"><TH>Client</TH><TH>Location</TH><TH className="text-right">Program</TH><TH className="text-right">Paid</TH><TH className="text-right">Balance</TH><TH>Status</TH></tr></thead>
        <tbody>{prg.map(c=>{const p=c.services.find(s=>s.service_type==='Program')!;const pd=p.payments.reduce((s,x)=>s+x.amount,0);return<tr key={c.id} onClick={()=>onSel(c.id)} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors">
          <td className="py-2.5 px-4 text-xs font-semibold text-np-dark">{c.name}</td><td className="py-2.5 px-4"><LocTag loc={c.location_id} locs={locs}/></td>
          <td className="py-2.5 px-4 text-xs font-semibold text-np-dark text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(p.amount)}</td>
          <td className="py-2.5 px-4 text-xs font-semibold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(pd)}</td>
          <td className="py-2.5 px-4 text-xs font-semibold text-right" style={{color:p.amount-pd>0?'#FBBC04':'#34A853',fontFeatureSettings:'"tnum"'}}>{$$(p.amount-pd)}</td>
          <td className="py-2.5 px-4"><Badge s={getStatus(c)}/></td></tr>})}</tbody></table></div></div>
    {mpo.length>0&&<div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Map Only ({mpo.length})</h3></div>
      <div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30"><TH>Client</TH><TH>Location</TH><TH>Date</TH><TH className="text-right">Amount</TH></tr></thead>
        <tbody>{mpo.map(c=>{const m=c.services.find(s=>s.service_type==='Map')!;return<tr key={c.id} onClick={()=>onSel(c.id)} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors">
          <td className="py-2.5 px-4 text-xs font-semibold text-np-dark">{c.name}</td><td className="py-2.5 px-4"><LocTag loc={c.location_id} locs={locs}/></td>
          <td className="py-2.5 px-4 text-xs text-gray-400">{fD(m.service_date)}</td><td className="py-2.5 px-4 text-xs font-semibold text-np-dark text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(m.amount)}</td></tr>})}</tbody></table></div></div>}
  </div>
}

/* ── Detail ────────────────────────────────────────── */
function DetView({cl,locs,clinics,cfg,onBack,onAddSvc,onEditSvc,onAddPmt,onEditPmt,onDeletePmt}:any) {
  const [tab,setTab]=useState('svc');const [showAS,setSAS]=useState(false);const [showAP,setSAP]=useState<string|null>(null)
  const [sf,setSF]=useState({t:'Map',a:'600',d:td(),n:''})
  const [editingSvc,setEditingSvc]=useState<string|null>(null)
  const [esSF,setEsSF]=useState({a:'',d:'',n:''})
  const [pf,setPF]=useState({a:'',d:td(),n:''})
  const [editPm,setEditPm]=useState<AcctPayment|null>(null)
  const [ef,setEF]=useState({a:'',d:'',n:''})
  const st=getStatus(cl);const tO=cl.services.reduce((s:number,v:AcctService)=>s+v.amount,0);const tP=cl.services.reduce((s:number,v:AcctService)=>s+v.payments.reduce((p:number,x:AcctPayment)=>p+x.amount,0),0);const bal=tO-tP;const pct=tO>0?(tP/tO)*100:100
  const doAS=async()=>{await onAddSvc(cl.id,{service_type:sf.t,amount:parseFloat(sf.a)||0,service_date:sf.d,notes:sf.n});setSAS(false);setSF({t:'Map',a:'600',d:td(),n:''})}
  const doAP=async(sid:string)=>{const a=parseFloat(pf.a)||0;if(a<=0)return;await onAddPmt(cl.id,sid,{amount:a,payment_date:pf.d,notes:pf.n});setSAP(null);setPF({a:'',d:td(),n:''})}
  const openEdit=(pm:AcctPayment)=>{setEditPm(pm);setEF({a:String(pm.amount),d:pm.payment_date,n:pm.notes||''})}
  const doEdit=async()=>{if(!editPm)return;const a=parseFloat(ef.a)||0;if(a<=0)return;await onEditPmt(editPm.id,{amount:a,payment_date:ef.d,notes:ef.n});setEditPm(null)}
  const doDelete=async(pm:AcctPayment)=>{if(!confirm(`Delete ${$$(pm.amount)} payment from ${fD(pm.payment_date)}?`))return;await onDeletePmt(pm.id)}
  const tSvc=showAP?cl.services.find((s:AcctService)=>s.id===showAP):null
  const editSvc=editPm?cl.services.find((s:AcctService)=>s.id===editPm.service_id):null
  const loc=locs.find((l:AcctLocation)=>l.id===cl.location_id);const clObj=loc?.clinic_id?clinics.find((c:AcctClinic)=>c.id===loc.clinic_id):null

  return <div className="space-y-5">
    <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-400 hover:text-np-dark transition-colors"><ChevronLeft className="w-3.5 h-3.5"/>Back</button>
    <div className="flex items-center gap-3">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold" style={{background:(loc?.color||'#386797')+'18',color:loc?.color||'#386797'}}>{gI(cl.name)}</div>
      <div><h2 className="text-base font-bold text-np-dark">{cl.name}</h2><div className="flex items-center gap-2 mt-0.5"><Badge s={st}/><LocTag loc={cl.location_id} locs={locs}/>{clObj&&<span className="text-[10px] text-gray-400">via {clObj.name}</span>}</div></div></div>
    <div className="flex gap-3 flex-wrap">
      <Stat label="Owed" value={$$(tO)}/>
      <div className="relative overflow-hidden rounded-xl border border-gray-100 bg-white p-4 flex-1 min-w-[140px]"><div className="absolute top-0 left-0 right-0 h-0.5 bg-green-500"/>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Paid</p>
        <p className="text-xl font-bold mt-0.5 text-green-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(tP)}</p>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-2"><div className="h-full rounded-full bg-green-500 transition-all" style={{width:`${Math.min(pct,100)}%`}}/></div></div>
      <Stat label="Balance" value={$$(bal)} color={bal>0?'#FBBC04':'#34A853'}/>
    </div>
    <div className="flex items-center justify-between border-b border-gray-100">
      <div className="flex">{['svc','pmt'].map(t=><button key={t} onClick={()=>setTab(t)} className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${tab===t?'border-np-blue text-np-blue':'border-transparent text-gray-400 hover:text-gray-600'}`}>{t==='svc'?'Services':'Payments'}</button>)}</div>
      {tab==='svc'&&<button onClick={()=>setSAS(true)} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-np-blue bg-np-blue/10 rounded-md hover:bg-np-blue/20 mb-1"><Plus className="w-3 h-3"/>Add Service</button>}
    </div>
    {tab==='svc'&&cl.services.map((sv:AcctService)=>{
      const svP=sv.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0);const sp=sv.payments.reduce((acc,pm)=>{const s=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount,sv.service_date);return{snw:r2(acc.snw+s.snw),dr:r2(acc.dr+s.dr),cc:r2(acc.cc+s.cc),snwService:r2(acc.snwService+s.snwService),clinicAmts:Object.fromEntries(Object.entries(s.clinicAmts).map(([k,v])=>[k,r2((acc.clinicAmts[k]||0)+v)]))}},{snw:0,dr:0,cc:0,snwService:0,clinicAmts:{}} as ReturnType<typeof calcSplit>);const rem=sv.amount-svP;const clAmt=Object.values(sp.clinicAmts).reduce((s,v)=>s+v,0)
      return <div key={sv.id} className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><div className="flex items-center gap-2"><h4 className="text-xs font-bold text-np-dark">{sv.service_type==='Map'?'Initial Map':'Neuro Program'}</h4><button onClick={()=>{setEditingSvc(editingSvc===sv.id?null:sv.id);setEsSF({a:String(sv.amount),d:sv.service_date,n:sv.notes||''})}} className="p-0.5 rounded hover:bg-np-blue/10" title="Edit service"><Pencil className="w-3 h-3 text-gray-300 hover:text-np-blue"/></button></div><span className="text-xs font-bold text-np-dark" style={{fontFeatureSettings:'"tnum"'}}>{$(sv.amount)}</span></div>
        {editingSvc===sv.id&&<div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100 space-y-2">
          <div className="flex gap-2 items-end flex-wrap">
            <div><label className="block text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Total Price</label><input type="number" step="0.01" value={esSF.a} onChange={e=>setEsSF(p=>({...p,a:e.target.value}))} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-28 focus:outline-none focus:ring-1 focus:ring-np-blue/30" placeholder="e.g. 5400"/></div>
            <div><label className="block text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Service Date</label><input type="date" value={esSF.d} onChange={e=>setEsSF(p=>({...p,d:e.target.value}))} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"/></div>
            <div className="flex-1"><label className="block text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Notes</label><input value={esSF.n} onChange={e=>setEsSF(p=>({...p,n:e.target.value}))} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-np-blue/30" placeholder="Optional notes"/></div>
            <button onClick={async()=>{const a=parseFloat(esSF.a)||0;if(a<=0)return;await onEditSvc(sv.id,{amount:a,service_date:esSF.d,notes:esSF.n});setEditingSvc(null)}} className="px-3 py-1.5 text-[10px] font-semibold bg-np-blue text-white rounded-lg hover:bg-np-blue/90">Save</button>
            <button onClick={()=>setEditingSvc(null)} className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          </div>
          <SplitPrev amt={parseFloat(esSF.a)||0} svcType={sv.service_type} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg} serviceTotal={parseFloat(esSF.a)||0} serviceStartDate={esSF.d}/>
        </div>}
        <div className="p-4 space-y-3">
          <div className="flex gap-4 text-xs flex-wrap"><span><span className="text-gray-400">Date: </span>{fD(sv.service_date)}</span><span><span className="text-gray-400">Paid: </span><span className="text-green-600 font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(svP)}</span></span>{rem>0&&<span><span className="text-gray-400">Rem: </span><span className="text-amber-600 font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(rem)}</span></span>}</div>
          {sv.notes&&<p className="text-[11px] text-gray-400 italic">{sv.notes}</p>}
          <div className="p-3 bg-gray-50 rounded-lg"><p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Splits (on collected)</p>
            <div className="flex gap-3 text-xs flex-wrap">
              <span><span className="text-gray-400">SNW: </span><span className="font-semibold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.snw)}</span>{sp.snwService>0&&<span className="text-[9px] text-gray-400 ml-0.5">({$$(sp.cc)} CC + {$$(sp.snwService)} svc)</span>}</span>
              {clAmt>0&&<span><span className="text-gray-400">Clinic: </span><span className="font-semibold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(clAmt)}</span></span>}
              <span><span className="text-gray-400">Dr.Y: </span><span className="font-semibold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.dr)}</span></span>
            </div></div>
          {sv.payments.length>0&&<div><p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Payments</p>
            {sv.payments.map(pm=><div key={pm.id} className="group flex items-center justify-between py-1.5 border-b border-gray-50 text-xs">
              <span className="text-gray-400 w-20">{fD(pm.payment_date)}</span><span className="font-semibold text-green-600 w-20" style={{fontFeatureSettings:'"tnum"'}}>{$$(pm.amount)}</span><span className="text-gray-400 text-[11px] flex-1 truncate">{pm.notes||''}</span><span className="text-gray-300 text-[10px] mr-2">pays out {fD(pm.payout_date||getPayoutDate(pm.payment_date))}</span>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={()=>openEdit(pm)} className="p-1 rounded hover:bg-np-blue/10" title="Edit"><Pencil className="w-3 h-3 text-gray-400 hover:text-np-blue"/></button>
                <button onClick={()=>doDelete(pm)} className="p-1 rounded hover:bg-red-50" title="Delete"><Trash2 className="w-3 h-3 text-gray-300 hover:text-red-500"/></button>
              </div>
            </div>)}</div>}
          <button onClick={()=>{setSAP(sv.id);setPF({a:rem>0?String(rem):'',d:td(),n:''})}} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-np-blue border border-np-blue/30 rounded-md hover:bg-np-blue/5"><Plus className="w-3 h-3"/>Add Payment</button>
        </div></div>})}
    {tab==='pmt'&&<div className="rounded-xl border border-gray-100 bg-white overflow-hidden"><div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30"><TH>Date</TH><TH>Service</TH><TH className="text-right">Amount</TH><TH className="text-right text-np-blue">SNW</TH>{clObj&&<TH className="text-right text-amber-600">Clinic</TH>}<TH className="text-right text-purple-600">Dr.Y</TH><TH>Payout</TH><TH></TH></tr></thead>
      <tbody>{cl.services.flatMap((sv:AcctService)=>sv.payments.map((pm:AcctPayment)=>{const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount,sv.service_date);return{...pm,svc:sv.service_type,...sp,_orig:pm}})).sort((a:any,b:any)=>a.payment_date.localeCompare(b.payment_date)).map((pm:any,i:number)=>{
        const clA=Object.values(pm.clinicAmts).reduce((s:number,v:any)=>s+v,0) as number
        return <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 group"><td className="py-2 px-3 text-xs text-gray-600">{fD(pm.payment_date)}</td><td className="py-2 px-3 text-xs text-gray-400">{pm.svc}</td>
          <td className="py-2 px-3 text-xs font-semibold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(pm.amount)}</td><td className="py-2 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(pm.snw)}</td>
          {clObj&&<td className="py-2 px-3 text-xs text-right" style={{color:clA>0?'#d97706':'#d1d5db',fontFeatureSettings:'"tnum"'}}>{clA>0?$$(clA):'\u2014'}</td>}
          <td className="py-2 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(pm.dr)}</td><td className="py-2 px-3 text-[10px] text-gray-400">{fD(pm.payout_date||getPayoutDate(pm.payment_date))}</td>
          <td className="py-2 px-1">
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={()=>openEdit(pm._orig)} className="p-1 rounded hover:bg-np-blue/10" title="Edit"><Pencil className="w-3 h-3 text-gray-400 hover:text-np-blue"/></button>
              <button onClick={()=>doDelete(pm._orig)} className="p-1 rounded hover:bg-red-50" title="Delete"><Trash2 className="w-3 h-3 text-gray-300 hover:text-red-500"/></button>
            </div>
          </td></tr>})}</tbody></table></div></div>}
    {showAS&&<Mdl title="Add Service" onClose={()=>setSAS(false)}>
      <FS label="Type" value={sf.t} onChange={(v:string)=>setSF(p=>({...p,t:v,a:v==='Map'?'600':'5400'}))} options={[{v:'Map',l:'Initial Map (qEEG)'},{v:'Program',l:'Neuro Program'}]}/>
      <FI label="Amount ($)" value={sf.a} onChange={(v:string)=>setSF(p=>({...p,a:v}))} type="number"/><FI label="Date" value={sf.d} onChange={(v:string)=>setSF(p=>({...p,d:v}))} type="date"/><FI label="Notes" value={sf.n} onChange={(v:string)=>setSF(p=>({...p,n:v}))}/>
      <SplitPrev amt={parseFloat(sf.a)||0} svcType={sf.t} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg} serviceTotal={parseFloat(sf.a)||0}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={()=>setSAS(false)}>Cancel</Btn><Btn onClick={doAS}>Add</Btn></div></Mdl>}
    {showAP&&tSvc&&<Mdl title={`Payment: ${tSvc.service_type}`} onClose={()=>setSAP(null)}>
      <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 mb-4 space-y-1">
        <div className="flex justify-between text-xs"><span className="text-gray-400">Total:</span><span className="font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(tSvc.amount)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-gray-400">Paid:</span><span className="font-semibold text-green-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(tSvc.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0))}</span></div>
        <div className="flex justify-between text-xs"><span className="text-gray-400">Remaining:</span><span className="font-bold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(tSvc.amount-tSvc.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0))}</span></div></div>
      <FI label="Amount ($)" value={pf.a} onChange={(v:string)=>setPF(p=>({...p,a:v}))} type="number"/><FI label="Date" value={pf.d} onChange={(v:string)=>setPF(p=>({...p,d:v}))} type="date"/><FI label="Note" value={pf.n} onChange={(v:string)=>setPF(p=>({...p,n:v}))}/>
      <SplitPrev amt={parseFloat(pf.a)||0} svcType={tSvc.service_type} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg} serviceTotal={tSvc.amount} serviceStartDate={tSvc.service_date}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={()=>setSAP(null)}>Cancel</Btn><Btn onClick={()=>doAP(showAP!)}>Record</Btn></div></Mdl>}
    {editPm&&<Mdl title="Edit Payment" onClose={()=>setEditPm(null)}>
      {editSvc&&<div className="p-3 bg-gray-50 rounded-xl border border-gray-100 mb-4 space-y-1">
        <div className="flex justify-between text-xs"><span className="text-gray-400">Service:</span><span className="font-semibold">{editSvc.service_type==='Map'?'Initial Map':'Neuro Program'} ({$$(editSvc.amount)})</span></div>
        <div className="flex justify-between text-xs"><span className="text-gray-400">Original amount:</span><span className="font-semibold text-green-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(editPm.amount)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-gray-400">Original date:</span><span className="text-gray-600">{fD(editPm.payment_date)}</span></div></div>}
      <FI label="Amount ($)" value={ef.a} onChange={(v:string)=>setEF(p=>({...p,a:v}))} type="number"/>
      <FI label="Date" value={ef.d} onChange={(v:string)=>setEF(p=>({...p,d:v}))} type="date"/>
      <FI label="Note" value={ef.n} onChange={(v:string)=>setEF(p=>({...p,n:v}))}/>
      {editSvc&&<SplitPrev amt={parseFloat(ef.a)||0} svcType={editSvc.service_type} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg} serviceTotal={editSvc.amount} serviceStartDate={editSvc.service_date}/>}
      <div className="flex gap-2 mt-4 justify-end">
        <BtnDanger onClick={()=>{doDelete(editPm);setEditPm(null)}}>Delete Payment</BtnDanger>
        <div className="flex-1"/>
        <Btn outline onClick={()=>setEditPm(null)}>Cancel</Btn>
        <Btn onClick={doEdit}>Save Changes</Btn>
      </div></Mdl>}
  </div>
}










/* == COMPREHENSIVE REPORTING SUITE ============================== */
function generateCSV(headers: string[], rows: any[][]): string {
  const esc = (v: any) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s }
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
}
function downloadCSV(fn: string, csv: string) {
  const b = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const u = URL.createObjectURL(b)
  const a = document.createElement('a'); a.href = u; a.download = fn; a.click(); URL.revokeObjectURL(u)
}

type RptType = 'collections' | 'monthly_collections' | 'recon_detail' | 'by_center' | 'by_client' | 'summary' | 'payments' | 'payout_ledger'

function ReportView({ clients, locs, clinics, cfg, checks, mktg }: { clients: AcctClient[]; locs: AcctLocation[]; clinics: AcctClinic[]; cfg: AcctConfig; checks: AcctCheck[]; mktg: AcctMktgCharge[] }) {
  const [rpt, setRpt] = useState<RptType>('collections')
  const [dFrom, setDFrom] = useState('')
  const [dTo, setDTo] = useState('')
  const [selCtr, setSelCtr] = useState<string>('all')
  const [selSvc, setSelSvc] = useState<string>('all')
  const [showEnt, setShowEnt] = useState({snw:true,cli:true,dr:true})

  const allRows = useMemo(() => {
    const rows: any[] = []
    clients.forEach(cl => {
      const loc = locs.find(l => l.id === cl.location_id)
      const clinic = loc?.clinic_id ? clinics.find(c => c.id === loc.clinic_id) : null
      cl.services.forEach(sv => { sv.payments.forEach(pm => {
        if (pm.amount === 0) return
        if (dFrom && pm.payment_date < dFrom) return
        if (dTo && pm.payment_date > dTo) return
        if (selCtr !== 'all' && cl.location_id !== selCtr) return
        if (selSvc !== 'all' && sv.service_type !== selSvc) return
        const sp = calcSplit(pm.amount, sv.service_type, cl.location_id, locs, clinics, cfg, sv.amount, sv.service_date)
        const clAmt = Object.values(sp.clinicAmts).reduce((s, v) => s + v, 0)
        rows.push({ client: cl.name, location: loc?.name || '', locationId: cl.location_id, clinic: clinic?.name || 'No clinic', clinicId: clinic?.id || '', serviceType: sv.service_type, serviceTotal: sv.amount, serviceDate: sv.service_date, paymentDate: pm.payment_date, paymentAmt: pm.amount, snw: sp.snw, cc: sp.cc, snwService: sp.snwService, clinicAmt: clAmt, dr: sp.dr, isLegacy: sv.service_date < PRE_AUG_CUTOFF, payoutDate: pm.payout_date || getPayoutDate(pm.payment_date), notes: pm.notes || '' })
      })})
    })
    return rows.sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))
  }, [clients, locs, clinics, cfg, dFrom, dTo, selCtr, selSvc])

  const totals = useMemo(() => {
    const t = { revenue: 0, snw: 0, cc: 0, snwService: 0, dr: 0, clinics: {} as Record<string, number> }
    allRows.forEach(r => { t.revenue += r.paymentAmt; t.snw += r.snw; t.cc += r.cc; t.snwService += r.snwService; t.dr += r.dr; if (r.clinicId) t.clinics[r.clinicId] = (t.clinics[r.clinicId] || 0) + r.clinicAmt })
    return t
  }, [allRows])

  const totalClinic = Object.values(totals.clinics).reduce((s,v) => s+v, 0)

  const F = (n: number) => { const s = Math.abs(n).toLocaleString('en-US',{style:'currency',currency:'USD'}); return n < 0 ? '-'+s : s }

  const entCols = () => {
    const cols: {key:string;label:string;color:string}[] = []
    if (showEnt.snw) cols.push({key:'snw',label:'SNW',color:'text-np-blue'})
    if (showEnt.cli) cols.push({key:'cli',label:'Clinic',color:'text-amber-600'})
    if (showEnt.dr) cols.push({key:'dr',label:'Dr. Yonce',color:'text-purple-600'})
    return cols
  }

  const collData = useMemo(() => {
    const m: Record<string, {name:string;loc:string;locId:string;svc:string;prog:number;coll:number;snw:number;cli:number;dr:number;n:number}> = {}
    allRows.forEach(r => {
      const k = r.client+'|'+r.serviceType
      if (!m[k]) m[k] = {name:r.client,loc:r.location,locId:r.locationId,svc:r.serviceType,prog:0,coll:0,snw:0,cli:0,dr:0,n:0}
      const x = m[k]; x.coll += r.paymentAmt; x.snw += r.snw; x.cli += r.clinicAmt; x.dr += r.dr; x.n++
      if (r.serviceTotal > x.prog) x.prog = r.serviceTotal
    })
    return Object.values(m).sort((a,b) => a.name.localeCompare(b.name))
  }, [allRows])

  const moCollData = useMemo(() => {
    const m: Record<string, {coll:number;snw:number;cli:number;dr:number;n:number;cls:Set<string>}> = {}
    allRows.forEach(r => {
      const mo = r.paymentDate.substring(0,7)
      if (!m[mo]) m[mo] = {coll:0,snw:0,cli:0,dr:0,n:0,cls:new Set()}
      const x = m[mo]; x.coll += r.paymentAmt; x.snw += r.snw; x.cli += r.clinicAmt; x.dr += r.dr; x.n++; x.cls.add(r.client)
    })
    return Object.entries(m).sort(([a],[b])=>a.localeCompare(b)).map(([mo,d])=>({mo,...d,cc:d.cls.size}))
  }, [allRows])

  const byCenterData = useMemo(() => {
    const m: Record<string, {loc:string;rev:number;snw:number;cli:number;dr:number;cls:Set<string>;n:number}> = {}
    allRows.forEach(r => { if(!m[r.locationId]) m[r.locationId]={loc:r.location,rev:0,snw:0,cli:0,dr:0,cls:new Set(),n:0}; const x=m[r.locationId]; x.rev+=r.paymentAmt;x.snw+=r.snw;x.cli+=r.clinicAmt;x.dr+=r.dr;x.cls.add(r.client);x.n++ })
    return Object.entries(m).map(([id,d])=>({id,...d,cc:d.cls.size}))
  }, [allRows])

  const byClientData = useMemo(() => {
    const m: Record<string, {name:string;loc:string;rev:number;snw:number;cli:number;dr:number;n:number;leg:boolean}> = {}
    allRows.forEach(r => { if(!m[r.client]) m[r.client]={name:r.client,loc:r.location,rev:0,snw:0,cli:0,dr:0,n:0,leg:r.isLegacy}; const x=m[r.client]; x.rev+=r.paymentAmt;x.snw+=r.snw;x.cli+=r.clinicAmt;x.dr+=r.dr;x.n++ })
    return Object.values(m).sort((a,b)=>b.rev-a.rev)
  }, [allRows])

  const doExport = () => {
    const ec = entCols()
    const eH = ec.map(c => c.label)

    if (rpt === 'collections') {
      const hdr = ['Client','Center','Service','Program','Collected','Balance',...eH,'Payments']
      const rws = collData.map(d => { const row: any[] = [d.name,d.loc,d.svc,r2(d.prog),r2(d.coll),r2(d.prog-d.coll)]; if(showEnt.snw)row.push(r2(d.snw)); if(showEnt.cli)row.push(r2(d.cli)); if(showEnt.dr)row.push(r2(d.dr)); row.push(d.n); return row })
      downloadCSV('collections-by-client.csv', generateCSV(hdr, rws))
    }
    else if (rpt === 'monthly_collections') {
      const hdr = ['Month','Collected',...eH,'Clients','Payments']
      const rws = moCollData.map(d => { const row: any[] = [fMoL(d.mo),r2(d.coll)]; if(showEnt.snw)row.push(r2(d.snw)); if(showEnt.cli)row.push(r2(d.cli)); if(showEnt.dr)row.push(r2(d.dr)); row.push(d.cc,d.n); return row })
      downloadCSV('monthly-collections.csv', generateCSV(hdr, rws))
    }
    else if (rpt === 'recon_detail') {
      const eH = entCols().map(c=>c.label)
      const rows: any[][] = []
      // Section 1: Revenue & Splits
      rows.push(['--- REVENUE COLLECTED & SPLITS ---'])
      rows.push(['Date','Client','Center','Payment',...eH])
      allRows.forEach(r => {
        const row: any[] = [r.paymentDate,r.client,r.location,r2(r.paymentAmt)]
        if(showEnt.snw) row.push(r2(r.snw))
        if(showEnt.cli) row.push(r2(r.clinicAmt))
        if(showEnt.dr) row.push(r2(r.dr))
        rows.push(row)
      })
      const splitRow: any[] = ['TOTAL','','',r2(totals.revenue)]
      if(showEnt.snw) splitRow.push(r2(totals.snw))
      if(showEnt.cli) splitRow.push(r2(totalClinic))
      if(showEnt.dr) splitRow.push(r2(totals.dr))
      rows.push(splitRow)
      rows.push([])
      // Section 2: Checks/ACH Paid
      const visChecks = checks.filter(ch => (ch.payee_type==='dr'&&showEnt.dr)||(ch.payee_type!=='dr'&&showEnt.cli)).sort((a,b)=>a.check_date.localeCompare(b.check_date))
      if (visChecks.length > 0) {
        rows.push(['--- PAYMENTS MADE (CHECKS & ACH) ---'])
        rows.push(['Date','Check #','Payee','Amount','Memo'])
        visChecks.forEach(ch => {
          const payee = ch.payee_type==='dr'?'Dr. Yonce':clinics.find(c=>c.id===ch.payee_clinic_id)?.name||'Clinic'
          rows.push([ch.check_date,ch.check_number,payee,r2(ch.amount),ch.memo||''])
        })
        rows.push(['TOTAL PAID','','',r2(visChecks.reduce((s,c)=>s+c.amount,0))])
        rows.push([])
      }
      // Section 3: Reconciliation Summary
      const paidD = checks.filter(c=>c.payee_type==='dr').reduce((s,c)=>s+c.amount,0)
      const paidC: Record<string,number> = {}; clinics.forEach(c=>{paidC[c.id]=checks.filter(ch=>ch.payee_clinic_id===c.id).reduce((s,ch)=>s+ch.amount,0)})
      const mktgD = mktg.filter(m=>!m.waived&&m.payee_type==='dr').reduce((s,m)=>s+m.amount,0)
      const mktgC: Record<string,number> = {}; clinics.forEach(c=>{mktgC[c.id]=mktg.filter(m=>!m.waived&&m.payee_clinic_id===c.id).reduce((s,m)=>s+m.amount,0)})
      rows.push(['--- RECONCILIATION SUMMARY ---'])
      rows.push(['Entity','Split Owed','Paid Out','Ad Spend','Still Owed'])
      let tOwed=0,tPaid=0,tMktg=0,tNet=0
      if(showEnt.snw){const o=r2(totals.snw);tOwed+=o;rows.push(['Sensorium (SNW)',o,0,0,o])}
      if(showEnt.cli) clinics.forEach(c=>{const o=r2(totals.clinics[c.id]||0);const p=r2(paidC[c.id]||0);const m=r2(mktgC[c.id]||0);const n=r2(o-p-m);if(o>0.01||p>0.01){tOwed+=o;tPaid+=p;tMktg+=m;tNet+=n;rows.push([c.name,o,p,m,n])}})
      if(showEnt.dr){const o=r2(totals.dr);const p=r2(paidD);const m=r2(mktgD);const n=r2(o-p-m);tOwed+=o;tPaid+=p;tMktg+=m;tNet+=n;rows.push(['Dr. Yonce',o,p,m,n])}
      rows.push(['TOTAL',r2(tOwed),r2(tPaid),r2(tMktg),r2(tNet)])
      downloadCSV('reconciliation.csv', generateCSV(rows[0].map(()=>''), rows))
    }
    else if (rpt === 'by_center') {
      const hdr = ['Center','Revenue',...eH,'Clients','Payments']
      const rws = byCenterData.map(d => { const row: any[] = [d.loc,r2(d.rev)]; if(showEnt.snw)row.push(r2(d.snw)); if(showEnt.cli)row.push(r2(d.cli)); if(showEnt.dr)row.push(r2(d.dr)); row.push(d.cc,d.n); return row })
      downloadCSV('by-center.csv', generateCSV(hdr, rws))
    }
    else if (rpt === 'by_client') {
      const hdr = ['Client','Center','Revenue',...eH,'Payments','Era']
      const rws = byClientData.map(d => { const row: any[] = [d.name,d.loc,r2(d.rev)]; if(showEnt.snw)row.push(r2(d.snw)); if(showEnt.cli)row.push(r2(d.cli)); if(showEnt.dr)row.push(r2(d.dr)); row.push(d.n,d.leg?'Pre-Aug 10pct':'Current 26pct'); return row })
      downloadCSV('by-client.csv', generateCSV(hdr, rws))
    }
    else if (rpt === 'summary') {
      const rows: any[][] = [['Total Revenue',r2(totals.revenue)]]
      if (showEnt.snw) rows.push(['SNW Total',r2(totals.snw)],['CC Processing',r2(totals.cc)],['SNW Services',r2(totals.snwService)])
      if (showEnt.cli) clinics.forEach(c => rows.push(['Clinic: '+c.name,r2(totals.clinics[c.id]||0)]))
      if (showEnt.dr) rows.push(['Dr. Yonce',r2(totals.dr)])
      downloadCSV('accounting-summary.csv', generateCSV(['Metric','Amount'], rows))
    }
    else if (rpt === 'payments') {
      const hdr = ['Date','Client','Center','Service','Payment',...eH,'Era','Notes']
      const rws = allRows.map(r => { const row: any[] = [r.paymentDate,r.client,r.location,r.serviceType,r2(r.paymentAmt)]; if(showEnt.snw)row.push(r2(r.snw)); if(showEnt.cli)row.push(r2(r.clinicAmt)); if(showEnt.dr)row.push(r2(r.dr)); row.push(r.isLegacy?'Pre-Aug 10pct':'Current 26pct',r.notes); return row })
      downloadCSV('all-payments.csv', generateCSV(hdr, rws))
    }
    else if (rpt === 'payout_ledger') {
      const ledger: any[] = []; const bp: Record<string,any[]> = {}
      allRows.forEach(r => { const p = r.payoutDate.substring(0,7); if(!bp[p])bp[p]=[]; bp[p].push(r) })
      Object.entries(bp).sort(([a],[b])=>a.localeCompare(b)).forEach(([period,rows]) => {
        if (showEnt.snw) ledger.push([fMoL(period),'Sensorium',r2(rows.reduce((s:number,r:any)=>s+r.snw,0)),rows.length+' pmts'])
        if (showEnt.dr) ledger.push([fMoL(period),'Dr. Yonce',r2(rows.reduce((s:number,r:any)=>s+r.dr,0)),''])
        if (showEnt.cli) { const cT:Record<string,number>={}; rows.forEach((r:any)=>{if(r.clinicId)cT[r.clinicId]=(cT[r.clinicId]||0)+r.clinicAmt}); clinics.forEach(c=>{if(cT[c.id])ledger.push([fMoL(period),c.name,r2(cT[c.id]),''])}) }
      })
      downloadCSV('payout-ledger.csv', generateCSV(['Period','Payee','Amount','Notes'], ledger))
    }
  }

  const tabs: {k:RptType;l:string;i:any}[] = [
    {k:'collections',l:'Collections',i:TrendingUp},
    {k:'monthly_collections',l:'Monthly Collected',i:CalendarIcon},
    {k:'recon_detail',l:'Reconciliation',i:BarChart3},
    {k:'by_center',l:'By Center',i:Building2},
    {k:'by_client',l:'By Client',i:Users},
    {k:'summary',l:'Summary',i:DollarSign},
    {k:'payments',l:'All Payments',i:FileText},
    {k:'payout_ledger',l:'Payout Ledger',i:Wallet},
  ]

  const RTH = ({children,className}:any) => <th className={'py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap '+(className||'')}>{children}</th>
  const ec = entCols()

  return <div className="space-y-5">
    <div><h2 className="text-base font-bold text-np-dark">Reports</h2><p className="text-xs text-gray-400 mt-0.5">Filter by entity, service, date range, and center. Export any view to CSV.</p></div>

    <div className="flex gap-1.5 flex-wrap">{tabs.map(t=>{const I=t.i;return<button key={t.k} onClick={()=>setRpt(t.k)} className={'flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-lg border transition-colors '+(rpt===t.k?'bg-np-blue/10 border-np-blue/30 text-np-blue':'bg-white border-gray-200 text-gray-500 hover:bg-gray-50')}><I className="w-3.5 h-3.5"/>{t.l}</button>})}</div>

    <div className="flex gap-3 items-end flex-wrap">
      <div><label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">From</label><input type="date" value={dFrom} onChange={e=>setDFrom(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"/></div>
      <div><label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">To</label><input type="date" value={dTo} onChange={e=>setDTo(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"/></div>
      <div><label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Center</label><select value={selCtr} onChange={e=>setSelCtr(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"><option value="all">All Centers</option>{locs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      <div><label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Service</label><select value={selSvc} onChange={e=>setSelSvc(e.target.value)} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"><option value="all">All Services</option><option value="Map">Map Only</option><option value="Program">Program Only</option></select></div>
      <div><label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Show Entities</label><div className="flex gap-3 items-center py-1.5">{[{k:'snw' as const,l:'SNW',c:'text-np-blue'},{k:'cli' as const,l:'Clinic',c:'text-amber-600'},{k:'dr' as const,l:'Dr.Y',c:'text-purple-600'}].map(e=><label key={e.k} className={'flex items-center gap-1 text-[11px] font-semibold cursor-pointer '+e.c}><input type="checkbox" checked={showEnt[e.k]} onChange={()=>setShowEnt(p=>({...p,[e.k]:!p[e.k]}))} className="w-3 h-3 rounded"/>{e.l}</label>)}</div></div>
      {(dFrom||dTo||selCtr!=='all'||selSvc!=='all')&&<button onClick={()=>{setDFrom('');setDTo('');setSelCtr('all');setSelSvc('all')}} className="px-2.5 py-1.5 text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200">Clear</button>}
      <div className="flex-1"/>
      <button onClick={doExport} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700"><Download className="w-3.5 h-3.5"/>Export CSV</button>
    </div>
    <p className="text-[10px] text-gray-400">{allRows.length} payments {dFrom||dTo?'in range':'total'} {selCtr!=='all'||selSvc!=='all'?'(filtered)':''}</p>

    {/* == COLLECTIONS BY CLIENT == */}
    {rpt==='collections'&&(()=>{
      const cTot = collData.reduce((t,d) => ({prog:t.prog+d.prog,coll:t.coll+d.coll,snw:t.snw+d.snw,cli:t.cli+d.cli,dr:t.dr+d.dr,n:t.n+d.n}),{prog:0,coll:0,snw:0,cli:0,dr:0,n:0})
      return <div className="rounded-xl border border-gray-100 bg-white overflow-hidden"><div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30">
        <RTH>Client</RTH><RTH>Center</RTH><RTH>Service</RTH><RTH className="text-right">Program</RTH><RTH className="text-right text-green-600">Collected</RTH><RTH className="text-right text-red-500">Balance</RTH>
        {ec.map(c=><RTH key={c.key} className={'text-right '+c.color}>{c.label}</RTH>)}
        <RTH className="text-right">Pmts</RTH></tr></thead><tbody>
        {collData.map((d,i) => {const bal=r2(d.prog-d.coll); return <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
          <td className="py-2 px-3 text-xs font-semibold text-np-dark">{d.name}</td>
          <td className="py-2 px-3"><LocTag loc={d.locId} locs={locs}/></td>
          <td className="py-2 px-3"><span className={'text-[9px] font-bold px-1.5 py-0.5 rounded '+(d.svc==='Program'?'bg-blue-50 text-blue-600':'bg-gray-100 text-gray-500')}>{d.svc}</span></td>
          <td className="py-2 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.prog)}</td>
          <td className="py-2 px-3 text-xs font-semibold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.coll)}</td>
          <td className="py-2 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"',color:bal>0?'#ef4444':'#22c55e'}}>{bal>0?F(bal):'Paid'}</td>
          {showEnt.snw&&<td className="py-2 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.snw)}</td>}
          {showEnt.cli&&<td className="py-2 px-3 text-xs text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{d.cli>0?F(d.cli):'\u2014'}</td>}
          {showEnt.dr&&<td className="py-2 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.dr)}</td>}
          <td className="py-2 px-3 text-xs text-gray-400 text-right">{d.n}</td></tr>})}
        <tr className="bg-gray-50/50 border-t border-gray-200">
          <td className="py-2.5 px-3 text-xs font-bold" colSpan={3}>TOTAL ({collData.length})</td>
          <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(cTot.prog)}</td>
          <td className="py-2.5 px-3 text-xs font-bold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(cTot.coll)}</td>
          <td className="py-2.5 px-3 text-xs font-bold text-red-500 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(cTot.prog-cTot.coll))}</td>
          {showEnt.snw&&<td className="py-2.5 px-3 text-xs font-bold text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(cTot.snw)}</td>}
          {showEnt.cli&&<td className="py-2.5 px-3 text-xs font-bold text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(cTot.cli)}</td>}
          {showEnt.dr&&<td className="py-2.5 px-3 text-xs font-bold text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(cTot.dr)}</td>}
          <td className="py-2.5 px-3 text-xs font-bold text-right">{cTot.n}</td></tr>
      </tbody></table></div></div>
    })()}

    {/* == MONTHLY COLLECTIONS == */}
    {rpt==='monthly_collections'&&(()=>{
      const mTot = moCollData.reduce((t,d)=>({coll:t.coll+d.coll,snw:t.snw+d.snw,cli:t.cli+d.cli,dr:t.dr+d.dr,n:t.n+d.n}),{coll:0,snw:0,cli:0,dr:0,n:0})
      return <div className="rounded-xl border border-gray-100 bg-white overflow-hidden"><div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30">
        <RTH>Month</RTH><RTH className="text-right text-green-600">Collected</RTH>
        {ec.map(c=><RTH key={c.key} className={'text-right '+c.color}>{c.label}</RTH>)}
        <RTH className="text-right">Clients</RTH><RTH className="text-right">Pmts</RTH></tr></thead><tbody>
        {moCollData.map(d => <tr key={d.mo} className="border-b border-gray-50 hover:bg-gray-50/50">
          <td className="py-2.5 px-3 text-xs font-bold text-np-dark whitespace-nowrap">{fMoL(d.mo)}</td>
          <td className="py-2.5 px-3 text-xs font-semibold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.coll)}</td>
          {showEnt.snw&&<td className="py-2.5 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.snw)}</td>}
          {showEnt.cli&&<td className="py-2.5 px-3 text-xs text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{d.cli>0?F(d.cli):'\u2014'}</td>}
          {showEnt.dr&&<td className="py-2.5 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.dr)}</td>}
          <td className="py-2.5 px-3 text-xs text-gray-500 text-right">{d.cc}</td>
          <td className="py-2.5 px-3 text-xs text-gray-400 text-right">{d.n}</td></tr>)}
        <tr className="bg-gray-50/50 border-t border-gray-200">
          <td className="py-2.5 px-3 text-xs font-bold">TOTAL</td>
          <td className="py-2.5 px-3 text-xs font-bold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(mTot.coll)}</td>
          {showEnt.snw&&<td className="py-2.5 px-3 text-xs font-bold text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(mTot.snw)}</td>}
          {showEnt.cli&&<td className="py-2.5 px-3 text-xs font-bold text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(mTot.cli)}</td>}
          {showEnt.dr&&<td className="py-2.5 px-3 text-xs font-bold text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(mTot.dr)}</td>}
          <td className="py-2.5 px-3 text-xs font-bold text-right">{new Set(allRows.map(r=>r.client)).size}</td>
          <td className="py-2.5 px-3 text-xs font-bold text-right">{mTot.n}</td></tr>
      </tbody></table></div></div>
    })()}

    {/* == RECONCILIATION == */}
    {rpt==='recon_detail'&&(()=>{
      // Compute splits owed per entity
      const owed: Record<string, number> = { snw: totals.snw, dr: totals.dr }
      clinics.forEach(c => { owed['clinic_'+c.id] = totals.clinics[c.id] || 0 })

      // Compute checks paid per entity
      const paid: Record<string, number> = { snw: 0, dr: 0 }
      clinics.forEach(c => { paid['clinic_'+c.id] = 0 })
      checks.forEach(ch => {
        if (ch.payee_type === 'dr') paid.dr += ch.amount
        else if (ch.payee_clinic_id) paid['clinic_'+ch.payee_clinic_id] = (paid['clinic_'+ch.payee_clinic_id] || 0) + ch.amount
      })

      // Marketing deductions per entity
      const mktgTotals: Record<string, number> = { snw: 0, dr: 0 }
      clinics.forEach(c => { mktgTotals['clinic_'+c.id] = 0 })
      mktg.forEach(m => {
        if (m.waived) return
        if (m.payee_type === 'dr') mktgTotals.dr += m.amount
        else if (m.payee_clinic_id) mktgTotals['clinic_'+m.payee_clinic_id] = (mktgTotals['clinic_'+m.payee_clinic_id] || 0) + m.amount
      })

      // Filter checks by selected entities
      const visibleChecks = checks.filter(ch => {
        if (ch.payee_type === 'dr' && showEnt.dr) return true
        if (ch.payee_type !== 'dr' && showEnt.cli) return true
        return false
      }).sort((a,b) => a.check_date.localeCompare(b.check_date))

      const visibleCheckTotal = visibleChecks.reduce((s,c) => s + c.amount, 0)

      // Entity summary rows
      type EntRow = { name: string; key: string; color: string; splitOwed: number; checksPaid: number; mktgDed: number; net: number }
      const entities: EntRow[] = []
      if (showEnt.snw) {
        const net = r2(owed.snw - (paid.snw||0) - (mktgTotals.snw||0))
        entities.push({ name: 'Sensorium (SNW)', key: 'snw', color: 'text-np-blue', splitOwed: r2(owed.snw), checksPaid: r2(paid.snw||0), mktgDed: r2(mktgTotals.snw||0), net })
      }
      if (showEnt.cli) {
        clinics.forEach(c => {
          const k = 'clinic_'+c.id
          const net = r2((owed[k]||0) - (paid[k]||0) - (mktgTotals[k]||0))
          entities.push({ name: c.name.split('(')[0].trim(), key: k, color: 'text-amber-600', splitOwed: r2(owed[k]||0), checksPaid: r2(paid[k]||0), mktgDed: r2(mktgTotals[k]||0), net })
        })
      }
      if (showEnt.dr) {
        const net = r2(owed.dr - (paid.dr||0) - (mktgTotals.dr||0))
        entities.push({ name: 'Dr. Yonce', key: 'dr', color: 'text-purple-600', splitOwed: r2(owed.dr), checksPaid: r2(paid.dr||0), mktgDed: r2(mktgTotals.dr||0), net })
      }
      const activeEntities = entities.filter(e => e.splitOwed > 0.01 || e.checksPaid > 0.01)
      const grandOwed = r2(activeEntities.reduce((s,e)=>s+e.splitOwed,0))
      const grandPaid = r2(activeEntities.reduce((s,e)=>s+e.checksPaid,0))
      const grandMktg = r2(activeEntities.reduce((s,e)=>s+e.mktgDed,0))
      const grandNet = r2(activeEntities.reduce((s,e)=>s+e.net,0))

      return <div className="space-y-5">

        {/* 1. Payment Splits - what came in and how it splits */}
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between"><h3 className="text-sm font-semibold text-np-dark">Revenue Collected & Splits</h3><span className="text-xs text-gray-400">{allRows.length} payments</span></div>
          <div className="overflow-auto max-h-[400px]"><table className="w-full text-left"><thead className="sticky top-0 bg-white z-10"><tr className="border-b border-gray-100 bg-gray-50/30">
            <RTH>Date</RTH><RTH>Client</RTH><RTH>Center</RTH><RTH className="text-right">Payment</RTH>
            {ec.map(c=><RTH key={c.key} className={'text-right '+c.color}>{c.label}</RTH>)}
            </tr></thead><tbody>
            {allRows.map((r,i)=><tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fD(r.paymentDate)}</td>
              <td className="py-1.5 px-3 text-xs font-semibold text-np-dark">{r.client}</td>
              <td className="py-1.5 px-3"><LocTag loc={r.locationId} locs={locs}/></td>
              <td className="py-1.5 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.paymentAmt)}</td>
              {showEnt.snw&&<td className="py-1.5 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.snw)}</td>}
              {showEnt.cli&&<td className="py-1.5 px-3 text-xs text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{r.clinicAmt>0?F(r.clinicAmt):'\u2014'}</td>}
              {showEnt.dr&&<td className="py-1.5 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.dr)}</td>}
              </tr>)}
            <tr className="bg-gray-50/50 border-t-2 border-gray-200 sticky bottom-0 z-10">
              <td className="py-2.5 px-3 text-xs font-bold" colSpan={3}>TOTAL</td>
              <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(totals.revenue))}</td>
              {showEnt.snw&&<td className="py-2.5 px-3 text-xs font-bold text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(totals.snw))}</td>}
              {showEnt.cli&&<td className="py-2.5 px-3 text-xs font-bold text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(totalClinic))}</td>}
              {showEnt.dr&&<td className="py-2.5 px-3 text-xs font-bold text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(totals.dr))}</td>}
              </tr>
          </tbody></table></div></div>

        {/* 2. Checks Written - what was paid out */}
        {visibleChecks.length>0&&<div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between"><h3 className="text-sm font-semibold text-np-dark">Payments Made (Checks & ACH)</h3><span className="text-xs text-gray-400">{visibleChecks.length} payments</span></div>
          <div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30">
            <RTH>Date</RTH><RTH>Check #</RTH><RTH>Payee</RTH><RTH className="text-right">Amount</RTH><RTH>Memo</RTH></tr></thead><tbody>
            {visibleChecks.map((ch,i)=>{
              const payee = ch.payee_type==='dr'?'Dr. Yonce':clinics.find(c=>c.id===ch.payee_clinic_id)?.name?.split('(')[0]?.trim()||'Clinic'
              return <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fD(ch.check_date)}</td>
                <td className="py-1.5 px-3 text-xs font-semibold text-np-dark">{ch.check_number}</td>
                <td className="py-1.5 px-3 text-xs text-gray-600">{payee}</td>
                <td className="py-1.5 px-3 text-xs font-semibold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(ch.amount)}</td>
                <td className="py-1.5 px-3 text-xs text-gray-400">{ch.memo||''}</td></tr>})}
            <tr className="bg-gray-50/50 border-t-2 border-gray-200">
              <td className="py-2.5 px-3 text-xs font-bold" colSpan={3}>TOTAL PAID</td>
              <td className="py-2.5 px-3 text-xs font-bold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(visibleCheckTotal))}</td>
              <td></td></tr>
          </tbody></table></div></div>}

        {/* 3. Reconciliation Summary - split owed vs paid vs net */}
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Total Split</p><p className="text-lg font-bold text-np-dark" style={{fontFeatureSettings:'"tnum"'}}>{F(grandOwed)}</p></div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><p className="text-[10px] font-semibold uppercase tracking-wider text-green-500 mb-1">Total Payout</p><p className="text-lg font-bold text-green-600" style={{fontFeatureSettings:'"tnum"'}}>{F(grandPaid)}</p></div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-1">Total Ad Spend</p><p className="text-lg font-bold text-red-500" style={{fontFeatureSettings:'"tnum"'}}>{grandMktg>0.01?'-'+F(grandMktg):'$0.00'}</p></div>
          <div className="rounded-xl border-2 bg-white p-4 text-center" style={{borderColor:Math.abs(grandNet)<0.01?'#16a34a':grandNet>0?'#d97706':'#dc2626'}}><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Still Owed</p><p className="text-lg font-bold" style={{fontFeatureSettings:'"tnum"',color:Math.abs(grandNet)<0.01?'#16a34a':grandNet>0?'#d97706':'#dc2626'}}>{Math.abs(grandNet)<0.01?'Settled':F(grandNet)}</p></div>
        </div>

        <div className="rounded-xl border-2 border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-bold text-np-dark">Reconciliation Summary</h3></div>
          <div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30">
            <RTH>Entity</RTH><RTH className="text-right">Split Owed</RTH><RTH className="text-right text-green-600">Paid Out</RTH><RTH className="text-right text-red-500">Mktg Ded.</RTH><RTH className="text-right">Net Owed</RTH></tr></thead><tbody>
            {activeEntities.map(e => <tr key={e.key} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className={'py-2.5 px-3 text-xs font-semibold '+e.color}>{e.name}</td>
              <td className="py-2.5 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(e.splitOwed)}</td>
              <td className="py-2.5 px-3 text-xs text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{e.checksPaid>0?F(e.checksPaid):'\u2014'}</td>
              <td className="py-2.5 px-3 text-xs text-red-500 text-right" style={{fontFeatureSettings:'"tnum"'}}>{e.mktgDed>0?'-'+F(e.mktgDed):'\u2014'}</td>
              <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"',color:Math.abs(e.net)<0.01?'#16a34a':e.net>0?'#d97706':'#dc2626'}}>{Math.abs(e.net)<0.01?'Settled':F(e.net)}</td></tr>)}
            <tr className="bg-gray-50/50 border-t-2 border-gray-200">
              <td className="py-2.5 px-3 text-xs font-bold">TOTAL</td>
              <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(grandOwed)}</td>
              <td className="py-2.5 px-3 text-xs font-bold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(grandPaid)}</td>
              <td className="py-2.5 px-3 text-xs font-bold text-red-500 text-right" style={{fontFeatureSettings:'"tnum"'}}>{grandMktg>0.01?'-'+F(grandMktg):'\u2014'}</td>
              <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"',color:Math.abs(grandNet)<0.01?'#16a34a':grandNet>0?'#d97706':'#dc2626'}}>{Math.abs(grandNet)<0.01?'Settled':F(grandNet)}</td></tr>
          </tbody></table></div></div>

      </div>
    })()}

    {/* == BY CENTER == */}
    {rpt==='by_center'&&<div className="rounded-xl border border-gray-100 bg-white overflow-hidden"><div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30">
      <RTH>Center</RTH><RTH className="text-right">Revenue</RTH>
      {ec.map(c=><RTH key={c.key} className={'text-right '+c.color}>{c.label}</RTH>)}
      <RTH className="text-right">Clients</RTH><RTH className="text-right">Pmts</RTH></tr></thead><tbody>
      {byCenterData.map(d=><tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/50">
        <td className="py-2.5 px-3 text-xs font-semibold text-np-dark"><LocTag loc={d.id} locs={locs}/></td>
        <td className="py-2.5 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.rev)}</td>
        {showEnt.snw&&<td className="py-2.5 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.snw)}</td>}
        {showEnt.cli&&<td className="py-2.5 px-3 text-xs text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{d.cli>0?F(d.cli):'\u2014'}</td>}
        {showEnt.dr&&<td className="py-2.5 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.dr)}</td>}
        <td className="py-2.5 px-3 text-xs text-gray-500 text-right">{d.cc}</td>
        <td className="py-2.5 px-3 text-xs text-gray-400 text-right">{d.n}</td></tr>)}
      <tr className="bg-gray-50/50 border-t border-gray-200">
        <td className="py-2.5 px-3 text-xs font-bold">TOTAL</td>
        <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.revenue)}</td>
        {showEnt.snw&&<td className="py-2.5 px-3 text-xs font-bold text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.snw)}</td>}
        {showEnt.cli&&<td className="py-2.5 px-3 text-xs font-bold text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totalClinic)}</td>}
        {showEnt.dr&&<td className="py-2.5 px-3 text-xs font-bold text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.dr)}</td>}
        <td className="py-2.5 px-3 text-xs font-bold text-right">{new Set(allRows.map(r=>r.client)).size}</td>
        <td className="py-2.5 px-3 text-xs font-bold text-right">{allRows.length}</td></tr>
    </tbody></table></div></div>}

    {/* == BY CLIENT == */}
    {rpt==='by_client'&&<div className="rounded-xl border border-gray-100 bg-white overflow-hidden"><div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30">
      <RTH>Client</RTH><RTH>Center</RTH><RTH>Era</RTH><RTH className="text-right">Revenue</RTH>
      {ec.map(c=><RTH key={c.key} className={'text-right '+c.color}>{c.label}</RTH>)}
      <RTH className="text-right">Pmts</RTH></tr></thead><tbody>
      {byClientData.map((d,i)=><tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
        <td className="py-2 px-3 text-xs font-semibold text-np-dark">{d.name}</td>
        <td className="py-2 px-3 text-xs text-gray-500">{d.loc}</td>
        <td className="py-2 px-3"><span className={'text-[9px] font-bold px-1.5 py-0.5 rounded '+(d.leg?'bg-amber-50 text-amber-600':'bg-blue-50 text-blue-600')}>{d.leg?'10% Legacy':'26% Current'}</span></td>
        <td className="py-2 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.rev)}</td>
        {showEnt.snw&&<td className="py-2 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.snw)}</td>}
        {showEnt.cli&&<td className="py-2 px-3 text-xs text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{d.cli>0?F(d.cli):'\u2014'}</td>}
        {showEnt.dr&&<td className="py-2 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(d.dr)}</td>}
        <td className="py-2 px-3 text-xs text-gray-400 text-right">{d.n}</td></tr>)}
      <tr className="bg-gray-50/50 border-t border-gray-200">
        <td className="py-2.5 px-3 text-xs font-bold" colSpan={3}>TOTAL ({byClientData.length})</td>
        <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.revenue)}</td>
        {showEnt.snw&&<td className="py-2.5 px-3 text-xs font-bold text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.snw)}</td>}
        {showEnt.cli&&<td className="py-2.5 px-3 text-xs font-bold text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totalClinic)}</td>}
        {showEnt.dr&&<td className="py-2.5 px-3 text-xs font-bold text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.dr)}</td>}
        <td className="py-2.5 px-3 text-xs font-bold text-right">{allRows.length}</td></tr>
    </tbody></table></div></div>}

    {/* == SUMMARY == */}
    {rpt==='summary'&&<div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <Stat label="Total Revenue" value={F(totals.revenue)} icon={DollarSign}/>
        {showEnt.snw&&<Stat label="SNW Retained" value={F(totals.snw)} color="#386797" sub={'CC: '+F(totals.cc)+' | Svc: '+F(totals.snwService)}/>}
        {showEnt.cli&&clinics.map(c=><Stat key={c.id} label={c.name.split('(')[0].trim()} value={F(totals.clinics[c.id]||0)} color="#d97706"/>)}
        {showEnt.dr&&<Stat label="Dr. Yonce" value={F(totals.dr)} color="#9333ea"/>}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-4"><h3 className="text-sm font-semibold text-np-dark mb-3">Split Percentages</h3>
        <div className="flex gap-4 text-xs">
          {showEnt.snw&&<span>SNW: <span className="font-bold text-np-blue">{totals.revenue>0?r2(totals.snw/totals.revenue*100):0}%</span></span>}
          {showEnt.cli&&clinics.map(c=><span key={c.id}>Clinic: <span className="font-bold text-amber-600">{totals.revenue>0?r2((totals.clinics[c.id]||0)/totals.revenue*100):0}%</span></span>)}
          {showEnt.dr&&<span>Dr.Y: <span className="font-bold text-purple-600">{totals.revenue>0?r2(totals.dr/totals.revenue*100):0}%</span></span>}
        </div></div>
      <div className="rounded-xl border border-gray-100 bg-white p-4"><h3 className="text-sm font-semibold text-np-dark mb-3">Totals</h3>
        <div className="flex gap-6 text-xs">
          <span>Revenue: <span className="font-bold">{F(totals.revenue)}</span></span>
          {showEnt.snw&&<span>SNW: <span className="font-bold text-np-blue">{F(totals.snw)}</span></span>}
          {showEnt.cli&&<span>Clinic: <span className="font-bold text-amber-600">{F(totalClinic)}</span></span>}
          {showEnt.dr&&<span>Dr.Y: <span className="font-bold text-purple-600">{F(totals.dr)}</span></span>}
        </div></div>
    </div>}

    {/* == ALL PAYMENTS == */}
    {rpt==='payments'&&<div className="rounded-xl border border-gray-100 bg-white overflow-hidden"><div className="overflow-auto max-h-[600px]"><table className="w-full text-left"><thead className="sticky top-0 bg-white"><tr className="border-b border-gray-100 bg-gray-50/30">
      <RTH>Date</RTH><RTH>Client</RTH><RTH>Center</RTH><RTH>Svc</RTH><RTH className="text-right">Amount</RTH>
      {ec.map(c=><RTH key={c.key} className={'text-right '+c.color}>{c.label}</RTH>)}
      <RTH>Era</RTH></tr></thead><tbody>
      {allRows.map((r,i)=><tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
        <td className="py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fD(r.paymentDate)}</td>
        <td className="py-1.5 px-3 text-xs font-semibold text-np-dark">{r.client}</td>
        <td className="py-1.5 px-3"><LocTag loc={r.locationId} locs={locs}/></td>
        <td className="py-1.5 px-3 text-[11px] text-gray-400">{r.serviceType}</td>
        <td className="py-1.5 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.paymentAmt)}</td>
        {showEnt.snw&&<td className="py-1.5 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.snw)}</td>}
        {showEnt.cli&&<td className="py-1.5 px-3 text-xs text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{r.clinicAmt>0?F(r.clinicAmt):'\u2014'}</td>}
        {showEnt.dr&&<td className="py-1.5 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.dr)}</td>}
        <td className="py-1.5 px-3"><span className={'text-[8px] font-bold px-1 py-0.5 rounded '+(r.isLegacy?'bg-amber-50 text-amber-600':'bg-blue-50 text-blue-600')}>{r.isLegacy?'10%':'26%'}</span></td></tr>)}
      <tr className="bg-gray-50/50 border-t border-gray-200 sticky bottom-0">
        <td className="py-2.5 px-3 text-xs font-bold" colSpan={4}>TOTAL ({allRows.length})</td>
        <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.revenue)}</td>
        {showEnt.snw&&<td className="py-2.5 px-3 text-xs font-bold text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.snw)}</td>}
        {showEnt.cli&&<td className="py-2.5 px-3 text-xs font-bold text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totalClinic)}</td>}
        {showEnt.dr&&<td className="py-2.5 px-3 text-xs font-bold text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(totals.dr)}</td>}
        <td></td></tr>
    </tbody></table></div></div>}

    {/* == PAYOUT LEDGER == */}
    {rpt==='payout_ledger'&&<div className="space-y-4">
      {(()=>{
        const bp: Record<string,any[]>={}; allRows.forEach(r=>{const p=r.payoutDate.substring(0,7);if(!bp[p])bp[p]=[];bp[p].push(r)})
        let grandSnw=0,grandDr=0,grandCli=0
        const cards = Object.entries(bp).sort(([a],[b])=>a.localeCompare(b)).map(([period,rows])=>{
          const snw=rows.reduce((s:number,r:any)=>s+r.snw,0); const dr=rows.reduce((s:number,r:any)=>s+r.dr,0)
          const cT:Record<string,number>={}; rows.forEach((r:any)=>{if(r.clinicId)cT[r.clinicId]=(cT[r.clinicId]||0)+r.clinicAmt})
          const cliTotal = Object.values(cT).reduce((s,v)=>s+v,0)
          grandSnw+=snw; grandDr+=dr; grandCli+=cliTotal
          return <div key={period} className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between"><h3 className="text-sm font-semibold text-np-dark">{fMoL(period)}</h3><span className="text-xs text-gray-400">{rows.length} payments</span></div>
            <div className="p-4 flex gap-3 flex-wrap">
              {showEnt.snw&&<div className="flex-1 text-center p-3 bg-blue-50 rounded-lg min-w-[120px]"><p className="text-[10px] font-semibold text-np-blue">Sensorium</p><p className="text-base font-bold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{F(snw)}</p></div>}
              {showEnt.cli&&clinics.map(c=>cT[c.id]?<div key={c.id} className="flex-1 text-center p-3 bg-amber-50 rounded-lg min-w-[120px]"><p className="text-[10px] font-semibold text-amber-600">{c.name.split('(')[0].trim()}</p><p className="text-base font-bold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{F(cT[c.id])}</p></div>:null)}
              {showEnt.dr&&<div className="flex-1 text-center p-3 bg-purple-50 rounded-lg min-w-[120px]"><p className="text-[10px] font-semibold text-purple-600">Dr. Yonce</p><p className="text-base font-bold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{F(dr)}</p></div>}
            </div></div>
        })
        return <>{cards}
          <div className="rounded-xl border-2 border-gray-200 bg-white p-4"><div className="flex items-center justify-between mb-2"><h3 className="text-sm font-bold text-np-dark">Grand Total</h3><span className="text-xs text-gray-400">{allRows.length} payments</span></div>
            <div className="flex gap-4 text-xs">
              <span>Revenue: <span className="font-bold">{F(totals.revenue)}</span></span>
              {showEnt.snw&&<span>SNW: <span className="font-bold text-np-blue">{F(grandSnw)}</span></span>}
              {showEnt.cli&&<span>Clinic: <span className="font-bold text-amber-600">{F(grandCli)}</span></span>}
              {showEnt.dr&&<span>Dr.Y: <span className="font-bold text-purple-600">{F(grandDr)}</span></span>}
            </div></div>
        </>
      })()}
    </div>}
  </div>
}


/* ── Reconciliation ────────────────────────────────── */
function ReconView({clients,locs,clinics,cfg}:{clients:AcctClient[];locs:AcctLocation[];clinics:AcctClinic[];cfg:AcctConfig}) {
  const [exp,setE]=useState<string|null>(null)
  const data=useMemo(()=>{
    const months:Record<string,any>={}
    clients.forEach(cl=>cl.services.forEach(sv=>sv.payments.forEach(pm=>{
      if(pm.amount===0)return;const mk=pm.payment_date.substring(0,7)
      if(!months[mk])months[mk]={total:0,snw:0,dr:0,clinicAmts:{} as Record<string,number>,det:[] as any[]}
      const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount,sv.service_date)
      months[mk].total+=pm.amount;months[mk].snw+=sp.snw;months[mk].dr+=sp.dr
      Object.entries(sp.clinicAmts).forEach(([cid,ca])=>{months[mk].clinicAmts[cid]=(months[mk].clinicAmts[cid]||0)+ca})
      months[mk].det.push({client:cl.name,svc:sv.service_type,amt:pm.amount,d:pm.payment_date,loc:cl.location_id,snw:sp.snw,dr:sp.dr,clinicAmts:sp.clinicAmts,payoutDate:pm.payout_date||getPayoutDate(pm.payment_date)})
    })));return Object.entries(months).sort(([a],[b])=>a.localeCompare(b)).map(([mo,d])=>({mo,...d}))
  },[clients,locs,clinics,cfg])
  const totRev=data.reduce((s:number,m:any)=>s+m.total,0);const totSnw=data.reduce((s:number,m:any)=>s+m.snw,0);const totDr=data.reduce((s:number,m:any)=>s+m.dr,0)
  const totCl:Record<string,number>={};clinics.forEach(c=>{totCl[c.id]=data.reduce((s:number,m:any)=>s+(m.clinicAmts[c.id]||0),0)})

  return <div className="space-y-5">
    <div><h2 className="text-base font-bold text-np-dark">Reconciliation</h2><p className="text-xs text-gray-400 mt-0.5">Monthly revenue breakdown by splits</p></div>
    <div className="flex gap-3 flex-wrap"><Stat label="Total Revenue" value={$$(totRev)} icon={DollarSign}/><Stat label="SNW (retained)" value={$$(totSnw)} color="#386797"/>
      {clinics.map(c=><Stat key={c.id} label={c.name.length>20?c.name.split('(')[0].trim():c.name} value={$$(totCl[c.id]||0)} color="#d97706" sub="Split total"/>)}<Stat label="Dr. Yonce" value={$$(totDr)} color="#9333ea" sub="Split total"/></div>
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Monthly Revenue Detail</h3></div>
      <div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30"><TH>Month</TH><TH>Collected</TH><TH className="text-np-blue">SNW</TH>{clinics.map(c=><TH key={c.id} className="text-amber-600">{c.name.split('(')[0].trim()}</TH>)}<TH className="text-purple-600">Dr.Y</TH></tr></thead>
        <tbody>{data.map((r:any)=>[
          <tr key={r.mo} onClick={()=>setE(exp===r.mo?null:r.mo)} className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50/50 ${exp===r.mo?'bg-gray-50':''}`}>
            <td className="py-2.5 px-3 text-xs font-bold text-np-dark whitespace-nowrap"><span className="mr-1 text-gray-300">{exp===r.mo?'\u25BE':'\u25B8'}</span>{fMoL(r.mo)}</td>
            <td className="py-2.5 px-3 text-xs font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(r.total)}</td>
            <td className="py-2.5 px-3 text-xs text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(r.snw)}</td>
            {clinics.map(c=><td key={c.id} className="py-2.5 px-3 text-xs" style={{color:(r.clinicAmts[c.id]||0)>0?'#d97706':'#d1d5db',fontFeatureSettings:'"tnum"'}}>{(r.clinicAmts[c.id]||0)>0?$$(r.clinicAmts[c.id]):'\u2014'}</td>)}
            <td className="py-2.5 px-3 text-xs text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(r.dr)}</td></tr>,
          exp===r.mo?<tr key={r.mo+'-d'}><td colSpan={3+clinics.length+1} className="p-0 border-none"><div className="bg-gray-50/70 px-4 py-3 border-b border-gray-100">
            <table className="w-full text-left"><thead><tr className="border-b border-gray-100"><TH>Date</TH><TH>Client</TH><TH>Svc</TH><TH>Loc</TH><TH className="text-right">Amt</TH></tr></thead>
              <tbody>{r.det.sort((a:any,b:any)=>a.d.localeCompare(b.d)).map((d:any,j:number)=><tr key={j} className="border-b border-gray-100/50">
                <td className="py-1.5 px-3 text-xs text-gray-600">{fD(d.d)}</td><td className="py-1.5 px-3 text-xs font-semibold text-np-dark">{d.client}</td>
                <td className="py-1.5 px-3 text-[11px] text-gray-400">{d.svc}</td><td className="py-1.5 px-3"><LocTag loc={d.loc} locs={locs}/></td>
                <td className="py-1.5 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(d.amt)}</td></tr>)}</tbody></table></div></td></tr>:null
        ])}
        <tr className="bg-gray-50/50 border-t border-gray-200"><td className="py-2.5 px-3 text-xs font-bold text-np-dark">TOTAL</td><td className="py-2.5 px-3 text-xs font-bold" style={{fontFeatureSettings:'"tnum"'}}>{$$(totRev)}</td><td className="py-2.5 px-3 text-xs font-bold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(totSnw)}</td>{clinics.map(c=><td key={c.id} className="py-2.5 px-3 text-xs font-bold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(totCl[c.id]||0)}</td>)}<td className="py-2.5 px-3 text-xs font-bold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(totDr)}</td></tr>
        </tbody></table></div></div></div>
}

/* ── Payouts (checks + marketing + ledger) ─────────── */
function PayView({clients,locs,clinics,cfg,checks,mktg,onAddCheck,onDeleteCheck}:
  {clients:AcctClient[];locs:AcctLocation[];clinics:AcctClinic[];cfg:AcctConfig;checks:AcctCheck[];mktg:AcctMktgCharge[];onAddCheck:(d:any)=>void;onDeleteCheck:(id:string)=>void}) {
  const [showAdd,setAdd]=useState(false)
  const [cf,setCF]=useState({payeeType:'dr' as string,clinicId:'',checkNum:'',date:td(),amount:'',memo:''})

  // Compute total owed per payee from revenue splits
  const owed=useMemo(()=>{
    const o:{dr:number;clinics:Record<string,number>}={dr:0,clinics:{}}
    clients.forEach(cl=>cl.services.forEach(sv=>sv.payments.forEach(pm=>{
      if(pm.amount===0)return
      const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount,sv.service_date)
      o.dr+=sp.dr;Object.entries(sp.clinicAmts).forEach(([cid,ca])=>{o.clinics[cid]=(o.clinics[cid]||0)+ca})
    })));return o
  },[clients,locs,clinics,cfg])

  // Marketing deductions per payee
  const mktgTotals=useMemo(()=>{
    const m:{dr:number;clinics:Record<string,number>}={dr:0,clinics:{}}
    mktg.filter(c=>!c.waived).forEach(c=>{if(c.payee_type==='dr')m.dr+=c.amount;else if(c.payee_clinic_id)m.clinics[c.payee_clinic_id]=(m.clinics[c.payee_clinic_id]||0)+c.amount})
    return m
  },[mktg])

  // Checks paid per payee
  const checkTotals=useMemo(()=>{
    const c:{dr:number;clinics:Record<string,number>}={dr:0,clinics:{}}
    checks.forEach(ch=>{if(ch.payee_type==='dr')c.dr+=ch.amount;else if(ch.payee_clinic_id)c.clinics[ch.payee_clinic_id]=(c.clinics[ch.payee_clinic_id]||0)+ch.amount})
    return c
  },[checks])

  // Build payee list
  type Payee={type:'clinic'|'dr';id:string|null;name:string;color:string;owedAmt:number;mktgAmt:number;checkAmt:number;net:number}
  const payees:Payee[]=useMemo(()=>{
    const list:Payee[]=[]
    clinics.forEach(c=>{const o=owed.clinics[c.id]||0;const m=mktgTotals.clinics[c.id]||0;const ch=checkTotals.clinics[c.id]||0;list.push({type:'clinic',id:c.id,name:c.name.split('(')[0].trim(),color:'#d97706',owedAmt:o,mktgAmt:m,checkAmt:ch,net:o-m-ch})})
    const drO=owed.dr;const drM=mktgTotals.dr;const drC=checkTotals.dr
    list.push({type:'dr',id:null,name:'Dr. Yonce',color:'#9333ea',owedAmt:drO,mktgAmt:drM,checkAmt:drC,net:drO-drM-drC})
    return list
  },[clinics,owed,mktgTotals,checkTotals])

  const doAdd=async()=>{
    const a=parseFloat(cf.amount)||0;if(a<=0)return
    await onAddCheck({payee_type:cf.payeeType,payee_clinic_id:cf.payeeType==='clinic'?cf.clinicId:null,check_number:cf.checkNum,check_date:cf.date,amount:a,memo:cf.memo})
    setAdd(false);setCF({payeeType:'dr',clinicId:'',checkNum:'',date:td(),amount:'',memo:''})
  }

  // Get payee name for check display
  const payeeName=(ch:AcctCheck)=>ch.payee_type==='dr'?'Dr. Yonce':clinics.find(c=>c.id===ch.payee_clinic_id)?.name.split('(')[0].trim()||'Clinic'

  return <div className="space-y-5">
    <div className="flex items-center justify-between">
      <div><h2 className="text-base font-bold text-np-dark">Payouts</h2><p className="text-xs text-gray-400 mt-0.5">Checks, marketing deductions, and running balances</p></div>
      <button onClick={()=>setAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-np-blue rounded-lg hover:bg-np-accent transition-colors"><Plus className="w-3.5 h-3.5"/>Record Check</button>
    </div>

    {/* Payee ledger cards */}
    {payees.map(p=><div key={p.id||'dr'} className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
        <h3 className="text-sm font-bold" style={{color:p.color}}>{p.name}</h3>
        <span className={`text-sm font-bold ${p.net>0.01?'text-red-500':p.net<-0.01?'text-green-600':'text-gray-400'}`} style={{fontFeatureSettings:'"tnum"'}}>
          {p.net>0.01?`${$$(p.net)} owed`:p.net<-0.01?`${$$(-p.net)} overpaid`:'Settled'}
        </span>
      </div>
      <div className="p-4">
        <div className="flex gap-3 flex-wrap mb-4">
          <div className="flex-1 min-w-[120px] p-3 rounded-lg bg-gray-50 border border-gray-100 text-center"><p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Split Owed</p><p className="text-base font-bold" style={{color:p.color,fontFeatureSettings:'"tnum"'}}>{$$(p.owedAmt)}</p></div>
          <div className="flex-1 min-w-[120px] p-3 rounded-lg bg-red-50 border border-red-100 text-center"><p className="text-[9px] font-semibold uppercase tracking-wider text-red-400 mb-1">Marketing Ded.</p><p className="text-base font-bold text-red-600" style={{fontFeatureSettings:'"tnum"'}}>-{$$(p.mktgAmt)}</p></div>
          <div className="flex-1 min-w-[120px] p-3 rounded-lg bg-green-50 border border-green-100 text-center"><p className="text-[9px] font-semibold uppercase tracking-wider text-green-500 mb-1">Checks Paid</p><p className="text-base font-bold text-green-600" style={{fontFeatureSettings:'"tnum"'}}>-{$$(p.checkAmt)}</p></div>
          <div className={`flex-1 min-w-[120px] p-3 rounded-lg border text-center ${p.net>0.01?'bg-amber-50 border-amber-200':p.net<-0.01?'bg-green-50 border-green-200':'bg-gray-50 border-gray-100'}`}><p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Net Balance</p><p className={`text-base font-bold ${p.net>0.01?'text-amber-600':p.net<-0.01?'text-green-600':'text-gray-400'}`} style={{fontFeatureSettings:'"tnum"'}}>{$$(p.net)}</p></div>
        </div>
        {/* Checks for this payee */}
        {(()=>{const pChecks=checks.filter(ch=>ch.payee_type===p.type&&(p.type==='dr'||ch.payee_clinic_id===p.id)).sort((a,b)=>a.check_date.localeCompare(b.check_date));
          const pMktg=mktg.filter(m=>m.payee_type===p.type&&(p.type==='dr'||m.payee_clinic_id===p.id)).sort((a,b)=>a.month.localeCompare(b.month))
          return <div className="space-y-3">
            {pMktg.length>0&&<div><p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Marketing Deductions</p>
              {pMktg.map(m=><div key={m.id} className={`flex items-center justify-between py-1.5 border-b border-gray-50 text-xs ${m.waived?'opacity-40':''}`}>
                <span className="text-gray-400">{fMoL(m.month)}</span><span className="text-gray-500">{m.description}</span>{m.waived?<span className="px-2 py-0.5 rounded bg-gray-100 text-gray-400 text-[10px] font-semibold">Waived</span>:<span className="font-semibold text-red-500" style={{fontFeatureSettings:'"tnum"'}}>-{$$(m.amount)}</span>}</div>)}</div>}
            {pChecks.length>0&&<div><p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Checks Written</p>
              <table className="w-full text-left"><thead><tr className="border-b border-gray-100"><TH>Date</TH><TH>Check #</TH><TH className="text-right">Amount</TH><TH>Memo</TH><TH></TH></tr></thead>
                <tbody>{pChecks.map(ch=><tr key={ch.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-2 px-3 text-xs text-gray-600">{fD(ch.check_date)}</td>
                  <td className="py-2 px-3 text-xs font-semibold text-np-dark">{ch.check_number||'\u2014'}</td>
                  <td className="py-2 px-3 text-xs font-semibold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(ch.amount)}</td>
                  <td className="py-2 px-3 text-[11px] text-gray-400">{ch.memo}</td>
                  <td className="py-2 px-1"><button onClick={()=>{if(confirm('Delete this check?'))onDeleteCheck(ch.id)}} className="p-1 rounded hover:bg-red-50"><Trash2 className="w-3 h-3 text-gray-300 hover:text-red-400"/></button></td>
                </tr>)}</tbody></table></div>}
            {pChecks.length===0&&pMktg.length===0&&<p className="text-xs text-gray-400 italic">No checks or deductions recorded yet.</p>}
          </div>
        })()}
      </div>
    </div>)}

    {showAdd&&<Mdl title="Record Check Payment" onClose={()=>setAdd(false)}>
      <FS label="Pay To" value={cf.payeeType} onChange={(v:string)=>setCF(p=>({...p,payeeType:v,clinicId:v==='clinic'?(clinics[0]?.id||''):'select'}))} options={[{v:'dr',l:'Dr. Yonce'},...clinics.map(c=>({v:'clinic',l:c.name}))]}/>
      {cf.payeeType==='clinic'&&clinics.length>1&&<FS label="Clinic" value={cf.clinicId} onChange={(v:string)=>setCF(p=>({...p,clinicId:v}))} options={clinics.map(c=>({v:c.id,l:c.name}))}/>}
      <div className="flex gap-3"><FI half label="Check #" value={cf.checkNum} onChange={(v:string)=>setCF(p=>({...p,checkNum:v}))} placeholder="e.g. 1042"/><FI half label="Check Date" value={cf.date} onChange={(v:string)=>setCF(p=>({...p,date:v}))} type="date"/></div>
      <FI label="Amount ($)" value={cf.amount} onChange={(v:string)=>setCF(p=>({...p,amount:v}))} type="number"/>
      <FI label="Memo / Note" value={cf.memo} onChange={(v:string)=>setCF(p=>({...p,memo:v}))} placeholder="Optional"/>
      {/* Show what the balance would be after this check */}
      {(()=>{const a=parseFloat(cf.amount)||0;if(a<=0)return null
        const payee=cf.payeeType==='dr'?payees.find(p=>p.type==='dr'):payees.find(p=>p.type==='clinic'&&p.id===cf.clinicId)
        if(!payee)return null;const newNet=payee.net-a
        return <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">After This Check</p>
          <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">Current balance:</span><span className="font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(payee.net)}</span></div>
          <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">This check:</span><span className="font-semibold text-green-600" style={{fontFeatureSettings:'"tnum"'}}>-{$$(a)}</span></div>
          <div className="flex justify-between text-xs pt-1 border-t border-gray-200"><span className="text-gray-500 font-semibold">New balance:</span>
            <span className={`font-bold ${newNet>0.01?'text-amber-600':newNet<-0.01?'text-green-600':'text-gray-400'}`} style={{fontFeatureSettings:'"tnum"'}}>{$$(newNet)}{newNet<-0.01?' (overpaid)':''}</span></div>
        </div>})()}
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={()=>setAdd(false)}>Cancel</Btn><Btn onClick={doAdd}>Record Check</Btn></div>
    </Mdl>}
  </div>
}

/* ── Settings ──────────────────────────────────────── */
function SetView({locs,clinics,clients,agreement,setAgreement,config,setConfig,onSaveConfig,onSaveLoc,onDeleteLoc,onSaveClinic,mktg,onAddMktg,onDeleteMktg,onToggleWaive}:any) {
  const [modal,setMo]=useState<any>(null);const [form,setF]=useState<any>({});const [editAgr,setEA]=useState(false)
  const ms=config.map_splits||{snw:23,dr:77,snw_flat:0,dr_flat:0};const mT=ms.snw+ms.dr
  const setMS=(v:any)=>setConfig((p:any)=>({...p,map_splits:{...ms,...v}}))
  const [mktgMonth,setMM]=useState(curMonth())
  const open=(type:string,data:any)=>{setMo({type});setF(data||{})};const close=()=>{setMo(null);setF({})}
  const saveLoc=async()=>{if(!form.name?.trim()||!form.short?.trim())return;await onSaveLoc(modal.type==='addLoc'?null:form.id,{name:form.name.trim(),short_code:form.short.trim().toUpperCase(),color:form.color||COLORS[locs.length%COLORS.length],clinic_id:form.clinicId||null});close()}
  const deleteLoc=async(lid:string)=>{const n=clients.filter((c:AcctClient)=>c.location_id===lid).length;if(n>0){alert(`Cannot delete: ${n} client(s) assigned.`);return};await onDeleteLoc(lid);close()}
  const saveClinic=async()=>{if(!form.name?.trim())return;await onSaveClinic(modal.type==='addClinic'?null:form.id,{name:form.name.trim(),contact_name:form.contactName||'',ein:form.ein||'',corp_type:form.corpType||'',has_w9:!!form.hasW9,has_1099:!!form.has1099,address:form.address||'',city:form.city||'',state:form.state||'',zip:form.zip||'',phone:form.phone||'',email:form.email||'',website:form.website||'',notes:form.notes||'',split_snw:form.snw||26,split_clinic:form.clinic||55.01,split_dr:form.drY||18.99,flat_snw:form.flatSnw||0,flat_clinic:form.flatClinic||0,flat_dr:form.flatDr||0});close()}
  const addMktgMonth=async()=>{await onAddMktg(mktgMonth);setMM(curMonth())}

  // Group marketing charges by month
  const mktgByMonth=useMemo(()=>{
    const m:Record<string,AcctMktgCharge[]>={}
    mktg.forEach((c:AcctMktgCharge)=>{if(!m[c.month])m[c.month]=[];m[c.month].push(c)})
    return Object.entries(m).sort(([a],[b])=>a.localeCompare(b))
  },[mktg])

  // Check if a month has all charges waived
  const isMonthWaived=(charges:AcctMktgCharge[])=>charges.length>0&&charges.every(c=>c.waived)
  const monthTotal=(charges:AcctMktgCharge[])=>charges.filter(c=>!c.waived).reduce((s,c)=>s+c.amount,0)

  return <div className="space-y-5">
    <h2 className="text-base font-bold text-np-dark">Settings</h2>
    {/* Marketing Charges */}
    <div className="rounded-xl border-2 border-orange-200 bg-orange-50/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-orange-200 bg-orange-50/50 flex items-center gap-2"><Megaphone className="w-4 h-4 text-orange-500"/><h3 className="text-sm font-semibold text-np-dark">Marketing Reimbursements to SNW</h3></div>
      <div className="p-4 space-y-4">
        <div className="p-3 bg-white rounded-lg border border-orange-100">
          <p className="text-xs text-gray-500 mb-1">SNW covers social media marketing. Each clinic owes <span className="font-semibold text-amber-600">$500/mo</span> and Dr. Yonce owes <span className="font-semibold text-purple-600">$500 per clinic/mo</span>.</p>
          <p className="text-[11px] text-gray-400">{clinics.length} clinic{clinics.length!==1?'s':''} = <span className="font-semibold">{$$(clinics.length*500)}/mo clinics + {$$(clinics.length*500)}/mo Dr. Yonce = {$$(clinics.length*1000)}/mo total</span></p>
        </div>
        <div className="flex gap-3 items-end">
          <FI label="Add Month" value={mktgMonth} onChange={(v:string)=>setMM(v)} type="month"/>
          <div className="mb-3"><Btn onClick={addMktgMonth}>Generate Charges</Btn></div>
        </div>
        {mktgByMonth.length>0&&<div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Monthly Marketing Schedule</p>
          {mktgByMonth.map(([mo,charges])=>{const allWaived=isMonthWaived(charges);const tot=monthTotal(charges)
            return <div key={mo} className={`rounded-lg border mb-2 overflow-hidden ${allWaived?'border-gray-200 bg-gray-50/50':'border-orange-100 bg-white'}`}>
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold ${allWaived?'text-gray-400 line-through':'text-np-dark'}`}>{fMoL(mo)}</span>
                  {allWaived?<span className="px-2 py-0.5 rounded bg-gray-100 text-gray-400 text-[10px] font-semibold">Waived</span>
                    :<span className="text-xs font-semibold text-red-500" style={{fontFeatureSettings:'"tnum"'}}>{$$(tot)} total</span>}
                </div>
                <button onClick={()=>onToggleWaive(charges.map((c:AcctMktgCharge)=>c.id),!allWaived)}
                  className={`px-3 py-1 text-[10px] font-semibold rounded-md transition-colors ${allWaived?'text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100':'text-gray-500 bg-gray-50 border border-gray-200 hover:bg-gray-100'}`}>
                  {allWaived?'Restore':'Waive Month'}
                </button>
              </div>
              {!allWaived&&<div className="px-4 pb-3 pt-0">
                <div className="flex gap-2 flex-wrap">{charges.map((c:AcctMktgCharge)=>{
                  const name=c.payee_type==='dr'?'Dr. Yonce':clinics.find((x:AcctClinic)=>x.id===c.payee_clinic_id)?.name.split('(')[0].trim()||'Clinic'
                  const clRef=c.payee_type==='dr'&&c.payee_clinic_id?` (re: ${clinics.find((x:AcctClinic)=>x.id===c.payee_clinic_id)?.name.split('(')[0].trim()||'clinic'})`:''
                  return <div key={c.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] border ${c.waived?'bg-gray-50 border-gray-200 opacity-50':'bg-white border-gray-100'}`}>
                    <span style={{color:c.payee_type==='dr'?'#9333ea':'#d97706'}} className="font-semibold">{name}{clRef}</span>
                    <span className="font-semibold" style={{fontFeatureSettings:'"tnum"',color:c.waived?'#9ca3af':'#ef4444'}}>{c.waived?'waived':$$(-c.amount)}</span>
                    <button onClick={()=>onToggleWaive([c.id],!c.waived)} className="text-[10px] text-gray-400 hover:text-np-blue underline">{c.waived?'restore':'waive'}</button>
                  </div>})}</div>
              </div>}
            </div>})}
        </div>}
      </div></div>
    {/* Payout Agreement */}
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Payout Agreement</h3><Btn sm outline onClick={()=>{if(editAgr)onSaveConfig();setEA(!editAgr)}}>{editAgr?'Done':'Edit'}</Btn></div>
      <div className="p-4">{editAgr?<textarea value={agreement} onChange={e=>setAgreement(e.target.value)} className="w-full min-h-[200px] p-3 text-xs leading-relaxed border border-gray-200 rounded-lg bg-white text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/20 resize-y" style={{fontFeatureSettings:'"tnum"'}}/>:<pre className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">{agreement||'No agreement set.'}</pre>}</div></div>
    {/* Sensorium Revenue Configuration */}
    <div className="rounded-xl border-2 border-np-blue/30 bg-np-blue/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-np-blue/20 bg-np-blue/10"><h3 className="text-sm font-semibold text-np-dark">Sensorium Neuro Wellness</h3></div>
      <div className="p-4 space-y-4">
        <div className="p-3 bg-white rounded-lg border border-np-blue/20">
          <p className="text-xs text-gray-500 mb-2">Sensorium's program split (set per clinic) <span className="font-semibold text-np-blue">includes</span> the CC processing fee. For example, if SNW = 26% and CC = 3%, then 3% covers CC processing and 23% covers contract services.</p>
          <div className="flex gap-6 mt-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400"/>
              <span className="text-[11px] text-gray-500">CC Processing: <span className="font-semibold">{config.cc_processing_fee??3}%</span> of gross (inside SNW %)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-np-blue"/>
              <span className="text-[11px] text-gray-500">Contract Services: <span className="font-semibold">remainder of SNW %</span></span>
            </div>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">CC Processing Fee (Internal Breakdown)</p>
          <div className="flex items-center gap-2">
            <input type="number" value={config.cc_processing_fee??3} onChange={e=>setConfig((p:any)=>({...p,cc_processing_fee:parseFloat(e.target.value)||0}))} step={0.1} className="w-20 px-2 py-1.5 text-sm font-semibold border border-gray-200 rounded-md bg-white text-np-dark text-right focus:outline-none focus:ring-2 focus:ring-np-blue/20" style={{fontFeatureSettings:'"tnum"'}}/>
            <span className="text-xs text-gray-400">% of gross</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">This is NOT an additional deduction. It's the portion of SNW's total % allocated to credit card processing.</p>
        </div>
        <div className="mt-2"><Btn sm onClick={onSaveConfig}>Save</Btn></div>
      </div>
    </div>
    {/* Map Splits */}
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">qEEG / Map Splits (Global)</h3></div>
      <div className="p-4"><p className="text-xs text-gray-400 mb-3">Maps split between SNW and Dr. Yonce by percentage. No clinic involvement.</p>
        <SplitIn label="SNW" value={ms.snw} onChange={v=>setMS({snw:v})}/>
        <SplitIn label="Dr. Yonce" value={ms.dr} onChange={v=>setMS({dr:v})}/>
        <p className={`text-xs font-semibold mt-2 ${mT===100?'text-green-600':'text-red-500'}`}>Total: {mT}%{mT!==100&&' (must equal 100%)'}</p>
        <div className="mt-3"><Btn sm onClick={onSaveConfig}>Save Splits</Btn></div></div></div>
    {/* Clinic Entities */}
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Clinic Entities</h3><button onClick={()=>open('addClinic',{snw:26,clinic:55.01,drY:18.99,flatSnw:0,flatClinic:0,flatDr:0})} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-np-blue bg-np-blue/10 rounded-md hover:bg-np-blue/20"><Plus className="w-3 h-3"/>Create Clinic</button></div>
      {clinics.map((cl:AcctClinic)=>{const locsUsing=locs.filter((l:AcctLocation)=>l.clinic_id===cl.id);const isCorp=cl.corp_type==='ccorp'||cl.corp_type==='scorp'
        return <div key={cl.id} className="px-4 py-3 border-b border-gray-50"><div className="flex justify-between items-start"><div>
          <p className="text-sm font-bold text-np-dark">{cl.name}{cl.contact_name&&<span className="font-normal text-gray-400"> ({cl.contact_name})</span>}</p>
          <div className="flex gap-1.5 mt-1 flex-wrap">{cl.ein&&<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-600">EIN: {cl.ein}</span>}{cl.corp_type&&<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-600">{cl.corp_type==='sole'?'Sole Prop':cl.corp_type==='llc'?'LLC':cl.corp_type==='scorp'?'S-Corp':cl.corp_type==='ccorp'?'C-Corp':'Partnership'}</span>}{!isCorp&&(cl.has_w9?<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-green-50 text-green-600">W-9</span>:<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-500">W-9 needed</span>)}</div>
          {(cl.address||cl.city)&&<p className="text-[11px] text-gray-400 mt-1">{[cl.address,cl.city,cl.state,cl.zip].filter(Boolean).join(', ')}</p>}
          <p className="text-xs mt-1">{cl.flat_clinic>0
            ?<><span className="text-amber-600">Clinic {$$(cl.flat_clinic)} flat</span> <span className="text-gray-300">→</span> <span className="text-np-blue">SNW {cl.split_snw}% of rem.</span> <span className="text-gray-300">→</span> <span className="text-purple-600">Dr.Y remainder</span></>
            :<><span className="text-np-blue">SNW {cl.split_snw}%</span> / <span className="text-amber-600">Clinic {cl.split_clinic}%</span> / <span className="text-purple-600">Dr.Y {cl.split_dr}%</span></>
          }</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Locations: {locsUsing.length>0?locsUsing.map((l:AcctLocation)=>l.name).join(', '):<span className="text-amber-500">None</span>}</p>
        </div><Btn sm outline onClick={()=>open('editClinic',{...cl,contactName:cl.contact_name,corpType:cl.corp_type,hasW9:cl.has_w9,has1099:cl.has_1099,snw:cl.split_snw,clinic:cl.split_clinic,drY:cl.split_dr,flatSnw:cl.flat_snw||0,flatClinic:cl.flat_clinic||0,flatDr:cl.flat_dr||0})}>Edit</Btn></div></div>})}</div>
    {/* Locations */}
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Locations</h3><button onClick={()=>open('addLoc',{color:COLORS[locs.length%COLORS.length]})} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-np-blue bg-np-blue/10 rounded-md hover:bg-np-blue/20"><Plus className="w-3 h-3"/>Add Location</button></div>
      {locs.map((loc:AcctLocation)=>{const cl=loc.clinic_id?clinics.find((c:AcctClinic)=>c.id===loc.clinic_id):null;const n=clients.filter((c:AcctClient)=>c.location_id===loc.id).length
        return <div key={loc.id} className="px-4 py-3 border-b border-gray-50 flex justify-between items-center"><div className="flex items-center gap-3"><div className="w-3 h-3 rounded" style={{background:loc.color}}/><div><div className="flex items-center gap-2"><span className="text-sm font-bold text-np-dark">{loc.name}</span><span className="text-[10px] text-gray-400 px-1.5 py-0.5 bg-gray-50 rounded">{loc.short_code}</span><span className="text-[10px] text-gray-400">{n} client{n!==1?'s':''}</span></div><p className={`text-[11px] mt-0.5 ${cl?'text-green-600':'text-amber-500'}`}>{cl?`Clinic: ${cl.name}`:'No clinic'}</p></div></div>
          <div className="flex gap-1.5"><Btn sm outline onClick={()=>open('editLoc',{...loc,short:loc.short_code,clinicId:loc.clinic_id})}>Edit</Btn><BtnDanger sm onClick={()=>deleteLoc(loc.id)}>Delete</BtnDanger></div></div>})}</div>
    {/* Modals */}
    {(modal?.type==='addLoc'||modal?.type==='editLoc')&&<Mdl title={modal.type==='addLoc'?'Add Location':'Edit Location'} onClose={close}>
      <FI label="Name" value={form.name||''} onChange={(v:string)=>setF((p:any)=>({...p,name:v}))} placeholder="e.g. Greenville"/>
      <FI label="Short Code" value={form.short||''} onChange={(v:string)=>setF((p:any)=>({...p,short:v.toUpperCase()}))} placeholder="e.g. GVL"/>
      <div className="mb-3"><label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Color</label><div className="flex gap-1.5 flex-wrap">{COLORS.map(c=><div key={c} onClick={()=>setF((p:any)=>({...p,color:c}))} className="w-7 h-7 rounded-lg cursor-pointer" style={{background:c,border:(form.color||COLORS[0])===c?'3px solid #386797':'3px solid transparent'}}/>)}</div></div>
      <FS label="Assigned Clinic" value={form.clinicId||''} onChange={(v:string)=>setF((p:any)=>({...p,clinicId:v}))} options={[{v:'',l:'No clinic (share goes to SNW)'},...clinics.map((c:AcctClinic)=>({v:c.id,l:c.name}))]}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={close}>Cancel</Btn><Btn onClick={saveLoc}>{modal?.type==='addLoc'?'Add':'Save'}</Btn></div></Mdl>}
    {(modal?.type==='addClinic'||modal?.type==='editClinic')&&<Mdl title={modal.type==='addClinic'?'Create Clinic':'Edit Clinic'} onClose={close} wide>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-np-blue mb-3">Business Information</p>
      <FI label="Business Name" value={form.name||''} onChange={(v:string)=>setF((p:any)=>({...p,name:v}))}/>
      <FI label="Primary Contact" value={form.contactName||''} onChange={(v:string)=>setF((p:any)=>({...p,contactName:v}))}/>
      <div className="flex gap-3"><FI half label="EIN" value={form.ein||''} onChange={(v:string)=>setF((p:any)=>({...p,ein:v}))} placeholder="XX-XXXXXXX"/><FI half label="Phone" value={form.phone||''} onChange={(v:string)=>setF((p:any)=>({...p,phone:v}))}/></div>
      <FI label="Address" value={form.address||''} onChange={(v:string)=>setF((p:any)=>({...p,address:v}))}/>
      <div className="flex gap-3"><FI half label="City" value={form.city||''} onChange={(v:string)=>setF((p:any)=>({...p,city:v}))}/><FI half label="State" value={form.state||''} onChange={(v:string)=>setF((p:any)=>({...p,state:v}))}/></div>
      <div className="flex gap-3"><FI half label="Zip" value={form.zip||''} onChange={(v:string)=>setF((p:any)=>({...p,zip:v}))}/><FI half label="Email" value={form.email||''} onChange={(v:string)=>setF((p:any)=>({...p,email:v}))}/></div>
      <FI label="Website" value={form.website||''} onChange={(v:string)=>setF((p:any)=>({...p,website:v}))}/>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-np-blue mt-4 mb-3">Entity & Compliance</p>
      <FS label="Corporation Type" value={form.corpType||''} onChange={(v:string)=>setF((p:any)=>({...p,corpType:v}))} options={[{v:'',l:'Select...'},{v:'sole',l:'Sole Proprietor'},{v:'llc',l:'LLC'},{v:'partnership',l:'Partnership'},{v:'scorp',l:'S-Corp'},{v:'ccorp',l:'C-Corp'}]}/>
      {form.corpType!=='ccorp'&&form.corpType!=='scorp'&&<div className="p-3 bg-amber-50 rounded-lg border border-amber-100 mb-3"><p className="text-[11px] text-amber-700 mb-2">Non C-Corp entities require a signed W-9 and will receive a 1099.</p>
        <label className="flex items-center gap-2 text-xs cursor-pointer mb-1"><input type="checkbox" checked={!!form.hasW9} onChange={e=>setF((p:any)=>({...p,hasW9:e.target.checked}))} className="accent-np-blue"/>W-9 on file</label>
        <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={!!form.has1099} onChange={e=>setF((p:any)=>({...p,has1099:e.target.checked}))} className="accent-np-blue"/>1099 issued</label></div>}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-np-blue mt-4 mb-3">Program Revenue Splits</p>
      {/* Mode toggle */}
      <div className="flex gap-2 mb-3">{[{k:'waterfall',l:'Waterfall (Flat Clinic + % Remainder)'},{k:'pct',l:'All Percentages'}].map(m=>{
        const active=(m.k==='waterfall')?((form.flatClinic||0)>0):((form.flatClinic||0)===0)
        return <button key={m.k} onClick={()=>{if(m.k==='waterfall'){setF((p:any)=>({...p,flatClinic:p.flatClinic||3395,snw:26,drY:74,clinic:0,flatSnw:0,flatDr:0}))}else{setF((p:any)=>({...p,flatClinic:0,snw:26,clinic:55.01,drY:18.99,flatSnw:0,flatDr:0}))}}} className={`flex-1 px-3 py-2 text-[11px] font-semibold rounded-lg border transition-colors ${active?'bg-np-blue/10 border-np-blue/30 text-np-blue':'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'}`}>{m.l}</button>})}</div>

      {(form.flatClinic||0)>0 ? <>
        {/* ── WATERFALL MODE ── */}
        <div className="p-3 bg-np-blue/5 rounded-lg border border-np-blue/20 mb-3 space-y-1">
          <p className="text-[10px] font-semibold text-np-blue mb-1.5">Waterfall Calculation Order</p>
          <p className="text-[10px] text-gray-500">1. SNW gets <span className="text-np-blue font-semibold">{form.snw||26}% of gross</span> (includes {config?.cc_processing_fee??3}% CC + {r2((form.snw||26)-(config?.cc_processing_fee??3))}% services)</p>
          <p className="text-[10px] text-gray-500">2. Clinic target <span className="text-amber-600 font-semibold">${form.flatClinic||3395}</span> distributed <span className="font-semibold">proportionally</span> across payments based on agreed program total</p>
          <p className="text-[10px] text-gray-500">3. Dr. Yonce gets <span className="text-purple-600 font-semibold">the remainder</span> after SNW % and clinic proportional share</p>
        </div>
        <div className="space-y-3">
          <div><label className="block text-[10px] font-semibold uppercase tracking-wider text-np-blue mb-1">SNW Total (% of Gross)</label>
            <div className="flex items-center gap-2">
              <input type="number" value={form.snw||26} onChange={e=>setF((p:any)=>({...p,snw:parseFloat(e.target.value)||0}))} step={0.5} className="w-20 px-2 py-1.5 text-sm font-semibold border border-np-blue/30 rounded-md bg-white text-np-dark text-right focus:outline-none focus:ring-2 focus:ring-np-blue/20" style={{fontFeatureSettings:'"tnum"'}}/>
              <span className="text-[10px] text-gray-400">% of gross → includes {config?.cc_processing_fee??3}% CC processing</span></div>
            <p className="text-[10px] text-gray-400 mt-0.5">CC portion: {config?.cc_processing_fee??3}% | Services portion: {r2((form.snw||26)-(config?.cc_processing_fee??3))}%</p>
          </div>
          <div><label className="block text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1">Clinic Flat Fee ($)</label>
            <div className="flex items-center gap-2"><span className="text-sm text-gray-400">$</span>
              <input type="number" value={form.flatClinic||3395} onChange={e=>setF((p:any)=>({...p,flatClinic:parseFloat(e.target.value)||0}))} step={1} className="w-32 px-2 py-1.5 text-sm font-semibold border border-amber-300 rounded-md bg-white text-np-dark text-right focus:outline-none focus:ring-2 focus:ring-amber-200" style={{fontFeatureSettings:'"tnum"'}}/>
              <span className="text-[10px] text-gray-400">total target across full program, paid proportionally per payment</span></div></div>
          <div className="p-2.5 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-[10px] font-semibold text-purple-600">Dr. Yonce receives whatever remains after SNW {form.snw||26}% and the clinic flat fee</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Automatically calculated. No configuration needed.</p>
          </div>
          <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-100 mt-2 space-y-1">
            <p className="text-[10px] font-semibold text-amber-700">Agreement Terms</p>
            <p className="text-[10px] text-amber-600">• Pre-Aug 2025: SNW received only 10% of gross. Post-Aug 2025: SNW at full split rate until deficit recovered.</p>
            <p className="text-[10px] text-amber-600">• All CC processing fees go to Sensorium.</p>
            <p className="text-[10px] text-amber-600">• Clinic submits biweekly invoice with session totals by client. Sensorium pays out on all sessions performed.</p>
          </div>
        </div>
      </> : <>
        {/* ── PERCENTAGE MODE ── */}
        <p className="text-[10px] text-gray-400 mb-2">All three parties split the gross by percentage. SNW's % includes {config?.cc_processing_fee??3}% CC processing internally.</p>
        <SplitIn label="SNW" value={form.snw||0} onChange={v=>setF((p:any)=>({...p,snw:v}))}/><SplitIn label="Clinic" value={form.clinic||0} onChange={v=>setF((p:any)=>({...p,clinic:v}))}/><SplitIn label="Dr. Yonce" value={form.drY||0} onChange={v=>setF((p:any)=>({...p,drY:v}))}/>
        {(()=>{const pT=(form.snw||0)+(form.clinic||0)+(form.drY||0);return<p className={`text-xs font-semibold mt-2 ${Math.abs(pT-100)<0.1?'text-green-600':'text-red-500'}`}>Pct Total: {pT.toFixed(2)}%{Math.abs(pT-100)>=0.1&&' (should be 100%)'}</p>})()}
      </>}
      <FI label="Notes" value={form.notes||''} onChange={(v:string)=>setF((p:any)=>({...p,notes:v}))}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={close}>Cancel</Btn><Btn onClick={saveClinic}>Save</Btn></div></Mdl>}
  </div>
}

/* ── Main Page ─────────────────────────────────────── */
export default function AccountingPage() {
  const {currentOrg}=useWorkspace();const supabase=createClient()
  const [clients,setClients]=useState<AcctClient[]>([]);const [locs,setLocs]=useState<AcctLocation[]>([]);const [clinics,setClinics]=useState<AcctClinic[]>([])
  const [config,setConfig]=useState<AcctConfig>({map_splits:{snw:23,dr:77,snw_flat:0,dr_flat:0},cc_processing_fee:3,snw_base_pct:0,snw_base_flat:0,default_map_price:600,default_program_price:5400,payout_agreement:''})
  const [checks,setChecks]=useState<AcctCheck[]>([]);const [mktg,setMktg]=useState<AcctMktgCharge[]>([])
  const [loading,setLoading]=useState(true);const [vw,sV]=useState('dash');const [sel,sS]=useState<string|null>(null);const [q,sQ]=useState('')
  const [showAC,setSAC]=useState(false);const [nc,setNC]=useState({nm:'',loc:''})
  const orgId=currentOrg?.id

  const loadData=useCallback(async()=>{
    if(!orgId)return;setLoading(true)
    try{const [locsR,clinicsR,clientsR,svcsR,pmtsR,cfgR,chkR,mkR]=await Promise.all([
      supabase.from('acct_locations').select('*').eq('org_id',orgId),supabase.from('acct_clinics').select('*').eq('org_id',orgId),
      supabase.from('acct_clients').select('*').eq('org_id',orgId).order('name'),supabase.from('acct_services').select('*').eq('org_id',orgId),
      supabase.from('acct_payments').select('*').eq('org_id',orgId).order('payment_date'),
      supabase.from('org_settings').select('setting_value').eq('org_id',orgId).eq('setting_key','acct_config').maybeSingle(),
      supabase.from('acct_checks').select('*').eq('org_id',orgId).order('check_date'),
      supabase.from('acct_marketing_charges').select('*').eq('org_id',orgId)])
    setLocs(locsR.data||[]);setClinics(clinicsR.data||[]);if(cfgR.data?.setting_value)setConfig(cfgR.data.setting_value)
    setChecks(chkR.data||[]);setMktg(mkR.data||[])
    const svcs=svcsR.data||[];const pmts=pmtsR.data||[]
    setClients((clientsR.data||[]).map((c:any)=>({...c,services:svcs.filter((s:any)=>s.client_id===c.id).map((s:any)=>({...s,payments:pmts.filter((p:any)=>p.service_id===s.id)}))})))}catch(e){console.error('Load failed',e)}
    setLoading(false)},[orgId])

  useEffect(()=>{loadData()},[loadData])

  const addClient=async()=>{if(!nc.nm.trim()||!nc.loc||!orgId)return;await supabase.from('acct_clients').insert({org_id:orgId,name:nc.nm.trim(),location_id:nc.loc});setSAC(false);setNC({nm:'',loc:''});loadData()}
  const addService=async(cid:string,svc:any)=>{if(!orgId)return;await supabase.from('acct_services').insert({org_id:orgId,client_id:cid,...svc});loadData()}
  const editService=async(svcId:string,data:any)=>{if(!orgId)return;await supabase.from('acct_services').update(data).eq('id',svcId);loadData()}
  const addPayment=async(cid:string,sid:string,pmt:any)=>{if(!orgId)return;await supabase.from('acct_payments').insert({org_id:orgId,service_id:sid,client_id:cid,...pmt});loadData()}
  const editPayment=async(pmtId:string,data:any)=>{if(!orgId)return;await supabase.from('acct_payments').update(data).eq('id',pmtId);loadData()}
  const deletePayment=async(pmtId:string)=>{if(!orgId)return;await supabase.from('acct_payments').delete().eq('id',pmtId);loadData()}
  const saveConfig=async()=>{if(!orgId)return;await supabase.from('org_settings').upsert({org_id:orgId,setting_key:'acct_config',setting_value:config},{onConflict:'org_id,setting_key'})}
  const saveLoc=async(id:string|null,data:any)=>{if(!orgId)return;if(id)await supabase.from('acct_locations').update(data).eq('id',id);else await supabase.from('acct_locations').insert({id:data.short_code,org_id:orgId,...data});loadData()}
  const deleteLoc=async(id:string)=>{await supabase.from('acct_locations').delete().eq('id',id);loadData()}
  const saveClinic=async(id:string|null,data:any)=>{if(!orgId)return;if(id)await supabase.from('acct_clinics').update(data).eq('id',id);else await supabase.from('acct_clinics').insert({id:`clinic-${Date.now()}`,org_id:orgId,...data});loadData()}
  const addCheck=async(data:any)=>{if(!orgId)return;await supabase.from('acct_checks').insert({org_id:orgId,...data});loadData()}
  const deleteCheck=async(id:string)=>{await supabase.from('acct_checks').delete().eq('id',id);loadData()}
  const addMktg=async(month:string)=>{
    if(!orgId)return
    // For each clinic: clinic owes $500, Dr. Yonce owes $500 per clinic
    for(const c of clinics){
      await supabase.from('acct_marketing_charges').upsert({org_id:orgId,month,payee_type:'clinic',payee_clinic_id:c.id,amount:500,description:'Social media marketing'},{onConflict:'org_id,month,payee_type,payee_clinic_id'})
      await supabase.from('acct_marketing_charges').upsert({org_id:orgId,month,payee_type:'dr',payee_clinic_id:c.id,amount:500,description:'Social media marketing'},{onConflict:'org_id,month,payee_type,payee_clinic_id'})
    }
    loadData()
  }
  const toggleWaive=async(ids:string[],waived:boolean)=>{
    for(const id of ids){await supabase.from('acct_marketing_charges').update({waived}).eq('id',id)}
    loadData()
  }
  const deleteMktg=async(id:string)=>{await supabase.from('acct_marketing_charges').delete().eq('id',id);loadData()}

  const fl=clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()));const ac=clients.find(c=>c.id===sel)
  const navItems=[{k:'dash',icon:LayoutDashboard,l:'Dashboard'},{k:'payouts',icon:Wallet,l:'Payouts'},{k:'recon',icon:BarChart3,l:'Reconciliation'},{k:'reports',icon:FileText,l:'Reports'},{k:'settings',icon:SettingsIcon,l:'Settings'}]

  if(loading)return<div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse"/></div>

  return <div className="space-y-0">
    <div className="flex" style={{minHeight:'calc(100vh - 80px)'}}>
      <div className="w-56 min-w-[224px] border-r border-gray-100 bg-white flex flex-col -ml-6 -mt-5 -mb-5">
        <div className="px-3 pt-4 pb-2 border-b border-gray-100">
          <h1 className="text-sm font-bold text-np-dark">Satellite Accounting</h1>
          <p className="text-[10px] text-gray-400">Sensorium Neuro Wellness</p>
        </div>
        <div className="p-2.5"><div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300"/><input placeholder="Search..." value={q} onChange={e=>sQ(e.target.value)} className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/20"/></div></div>
        <div className="px-2 space-y-0.5">{navItems.map(n=>{const Icon=n.icon;const active=vw===n.k&&!sel;return<button key={n.k} onClick={()=>{sV(n.k);sS(null)}} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-colors ${active?'bg-np-blue/10 text-np-blue font-semibold':'text-gray-500 hover:bg-gray-50 hover:text-np-dark'}`}><Icon className="w-3.5 h-3.5"/>{n.l}</button>})}</div>
        <div className="flex items-center justify-between px-3 pt-4 pb-1"><span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">Accounts ({fl.length})</span><button onClick={()=>{setSAC(true);setNC({nm:'',loc:locs[0]?.id||''})}} className="text-[10px] font-semibold text-np-blue hover:underline">+ Add</button></div>
        <div className="flex-1 overflow-y-auto">{fl.map(c=>{const s=getStatus(c);const t=c.services.reduce((s2,v)=>s2+v.payments.reduce((p,x)=>p+x.amount,0),0);const lo=locs.find(l=>l.id===c.location_id);const sc=stClr[s]
          return<button key={c.id} onClick={()=>{sS(c.id);sV('dash')}} className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${sel===c.id?'bg-np-blue/10 border-l-2 border-np-blue':'border-l-2 border-transparent hover:bg-gray-50'}`}>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{background:(lo?.color||'#386797')+'18',color:lo?.color||'#386797'}}>{gI(c.name)}</div>
            <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-np-dark truncate">{c.name}</p>
              <div className="flex items-center justify-between"><span className="text-[10px] text-gray-400" style={{fontFeatureSettings:'"tnum"'}}>{$$(t)}</span>
                <div className="flex gap-1"><div className="w-1.5 h-1.5 rounded-full" style={{background:lo?.color||'#999'}}/><div className="w-1.5 h-1.5 rounded-full" style={{background:sc?.tx==='text-green-700'?'#34A853':sc?.tx==='text-amber-700'?'#FBBC04':sc?.tx==='text-red-600'?'#EA4335':'#999'}}/></div></div></div></button>})}</div></div>
      <div className="flex-1 overflow-y-auto p-5">
        {ac?<DetView cl={ac} locs={locs} clinics={clinics} cfg={config} onBack={()=>sS(null)} onAddSvc={addService} onEditSvc={editService} onAddPmt={addPayment} onEditPmt={editPayment} onDeletePmt={deletePayment}/>
          :vw==='payouts'?<PayView clients={clients} locs={locs} clinics={clinics} cfg={config} checks={checks} mktg={mktg} onAddCheck={addCheck} onDeleteCheck={deleteCheck}/>
          :vw==='recon'?<ReconView clients={clients} locs={locs} clinics={clinics} cfg={config}/>
          :vw==='reports'?<ReportView clients={clients} locs={locs} clinics={clinics} cfg={config} checks={checks} mktg={mktg}/>
          :vw==='settings'?<SetView locs={locs} clinics={clinics} config={config} setConfig={setConfig} clients={clients} agreement={config.payout_agreement} setAgreement={(v:string)=>setConfig(p=>({...p,payout_agreement:v}))} onSaveConfig={saveConfig} onSaveLoc={saveLoc} onDeleteLoc={deleteLoc} onSaveClinic={saveClinic} mktg={mktg} onAddMktg={addMktg} onDeleteMktg={deleteMktg} onToggleWaive={toggleWaive}/>
          :<DashView clients={clients} locs={locs} onSel={id=>{sS(id);sV('dash')}} onAdd={()=>{setSAC(true);setNC({nm:'',loc:locs[0]?.id||''})}}/>}
      </div></div>
    {showAC&&<Mdl title="Add Client" onClose={()=>setSAC(false)}>
      <FI label="Name" value={nc.nm} onChange={(v:string)=>setNC(p=>({...p,nm:v}))} placeholder="First and Last Name"/>
      <FS label="Location" value={nc.loc} onChange={(v:string)=>setNC(p=>({...p,loc:v}))} options={locs.map(l=>({v:l.id,l:l.name}))}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={()=>setSAC(false)}>Cancel</Btn><Btn onClick={addClient}>Add Client</Btn></div></Mdl>}
  </div>
}



