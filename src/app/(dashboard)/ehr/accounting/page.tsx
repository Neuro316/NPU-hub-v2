'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import { DollarSign, Users, TrendingUp, ChevronLeft, Plus, X, Settings as SettingsIcon, BarChart3, LayoutDashboard, Search } from 'lucide-react'

interface AcctLocation { id: string; name: string; short_code: string; color: string; clinic_id: string | null; org_id: string }
interface AcctClinic { id: string; org_id: string; name: string; contact_name: string; ein: string; corp_type: string; has_w9: boolean; has_1099: boolean; address: string; city: string; state: string; zip: string; phone: string; email: string; website: string; notes: string; split_snw: number; split_clinic: number; split_dr: number }
interface AcctPayment { id: string; service_id: string; client_id: string; amount: number; payment_date: string; notes: string; split_snw: number; split_clinic: number; split_dr: number; clinic_id: string | null; payout_date: string; payout_period: string; is_paid_out: boolean }
interface AcctService { id: string; client_id: string; service_type: 'Map' | 'Program'; amount: number; service_date: string; notes: string; payments: AcctPayment[] }
interface AcctClient { id: string; name: string; location_id: string; org_id: string; notes: string; services: AcctService[] }
interface AcctConfig { map_splits: { snw: number; dr: number }; default_map_price: number; default_program_price: number; payout_agreement: string }

const $$ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
const fD = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const fMoL = (m: string) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
const gI = (n: string) => n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
const td = () => new Date().toISOString().split('T')[0]
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
function calcSplit(amt: number, svcType: string, locId: string, locs: AcctLocation[], clinics: AcctClinic[], mapSp: {snw:number;dr:number}) {
  if (svcType === 'Map') return { snw: (amt*mapSp.snw)/100, dr: (amt*mapSp.dr)/100, clinicAmts: {} as Record<string,number> }
  const loc = locs.find(l => l.id === locId); const cl = loc?.clinic_id ? clinics.find(c => c.id === loc.clinic_id) : null
  if (cl) return { snw: (amt*cl.split_snw)/100, dr: (amt*cl.split_dr)/100, clinicAmts: { [cl.id]: (amt*cl.split_clinic)/100 } }
  return { snw: (amt*81.01)/100, dr: (amt*18.99)/100, clinicAmts: {} as Record<string,number> }
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
function SplitPrev({amt,svcType,locId,locs,clinics,mapSp}:any) {
  if (!amt||amt<=0) return null; const sp=calcSplit(amt,svcType,locId,locs,clinics,mapSp)
  const cl=(()=>{const loc=locs.find((l:any)=>l.id===locId);return loc?.clinic_id?clinics.find((c:any)=>c.id===loc.clinic_id):null})()
  return <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Distribution Preview</p>
    <div className="flex gap-2 flex-wrap">
      <div className="flex-1 text-center p-2 bg-white rounded-lg border border-gray-100 min-w-[80px]"><p className="text-[10px] font-semibold text-np-blue mb-0.5">SNW</p><p className="text-sm font-bold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.snw)}</p></div>
      {Object.entries(sp.clinicAmts).map(([cid,ca])=>{const c=clinics.find((x:any)=>x.id===cid);return<div key={cid} className="flex-1 text-center p-2 bg-white rounded-lg border border-gray-100 min-w-[80px]"><p className="text-[10px] font-semibold text-amber-600 mb-0.5">{c?.name||'Clinic'}</p><p className="text-sm font-bold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(ca as number)}</p></div>})}
      <div className="flex-1 text-center p-2 bg-white rounded-lg border border-gray-100 min-w-[80px]"><p className="text-[10px] font-semibold text-purple-600 mb-0.5">Dr. Yonce</p><p className="text-sm font-bold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.dr)}</p></div>
    </div>
    {svcType==='Map'&&<p className="text-[10px] text-gray-400 mt-2">Maps: SNW + Dr. Yonce only</p>}
    {svcType==='Program'&&!cl&&<p className="text-[10px] text-amber-600 mt-2">No clinic assigned. Clinic share goes to SNW.</p>}
  </div>
}
function SplitIn({label,value,onChange}:{label:string;value:number;onChange:(v:number)=>void}) {
  return <div className="flex items-center gap-2 py-1">
    <span className="text-xs text-gray-500 w-16 font-medium">{label}</span>
    <input type="number" value={value} onChange={e=>onChange(parseFloat(e.target.value)||0)} step={0.5} className="w-16 px-2 py-1 text-sm font-semibold border border-gray-200 rounded-md bg-white text-np-dark text-right focus:outline-none focus:ring-2 focus:ring-np-blue/20" style={{fontFeatureSettings:'"tnum"'}}/>
    <span className="text-xs text-gray-400">%</span>
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
function DetView({cl,locs,clinics,mapSp,onBack,onAddSvc,onAddPmt}:any) {
  const [tab,setTab]=useState('svc');const [showAS,setSAS]=useState(false);const [showAP,setSAP]=useState<string|null>(null)
  const [sf,setSF]=useState({t:'Map',a:'600',d:td(),n:''})
  const [pf,setPF]=useState({a:'',d:td(),n:''})
  const st=getStatus(cl);const tO=cl.services.reduce((s:number,v:AcctService)=>s+v.amount,0);const tP=cl.services.reduce((s:number,v:AcctService)=>s+v.payments.reduce((p:number,x:AcctPayment)=>p+x.amount,0),0);const bal=tO-tP;const pct=tO>0?(tP/tO)*100:100
  const doAS=async()=>{await onAddSvc(cl.id,{service_type:sf.t,amount:parseFloat(sf.a)||0,service_date:sf.d,notes:sf.n});setSAS(false);setSF({t:'Map',a:'600',d:td(),n:''})}
  const doAP=async(sid:string)=>{const a=parseFloat(pf.a)||0;if(a<=0)return;await onAddPmt(cl.id,sid,{amount:a,payment_date:pf.d,notes:pf.n});setSAP(null);setPF({a:'',d:td(),n:''})}
  const tSvc=showAP?cl.services.find((s:AcctService)=>s.id===showAP):null
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
      const svP=sv.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0);const sp=calcSplit(svP,sv.service_type,cl.location_id,locs,clinics,mapSp);const rem=sv.amount-svP;const clAmt=Object.values(sp.clinicAmts).reduce((s,v)=>s+v,0)
      return <div key={sv.id} className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h4 className="text-xs font-bold text-np-dark">{sv.service_type==='Map'?'Initial Map':'Neuro Program'}</h4><span className="text-xs font-bold text-np-dark" style={{fontFeatureSettings:'"tnum"'}}>{$$(sv.amount)}</span></div>
        <div className="p-4 space-y-3">
          <div className="flex gap-4 text-xs flex-wrap"><span><span className="text-gray-400">Date: </span>{fD(sv.service_date)}</span><span><span className="text-gray-400">Paid: </span><span className="text-green-600 font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(svP)}</span></span>{rem>0&&<span><span className="text-gray-400">Rem: </span><span className="text-amber-600 font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(rem)}</span></span>}</div>
          {sv.notes&&<p className="text-[11px] text-gray-400 italic">{sv.notes}</p>}
          <div className="p-3 bg-gray-50 rounded-lg"><p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Splits (on collected)</p>
            <div className="flex gap-3 text-xs flex-wrap"><span><span className="text-gray-400">SNW: </span><span className="font-semibold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.snw)}</span></span>{clAmt>0&&<span><span className="text-gray-400">Clinic: </span><span className="font-semibold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(clAmt)}</span></span>}<span><span className="text-gray-400">Dr.Y: </span><span className="font-semibold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(sp.dr)}</span></span></div></div>
          {sv.payments.length>0&&<div><p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Payments</p>
            {sv.payments.map(pm=><div key={pm.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 text-xs">
              <span className="text-gray-400">{fD(pm.payment_date)}</span><span className="font-semibold text-green-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(pm.amount)}</span><span className="text-gray-400 text-[11px]">{pm.notes}</span><span className="text-gray-300 text-[10px]">pays out {fD(pm.payout_date||getPayoutDate(pm.payment_date))}</span></div>)}</div>}
          <button onClick={()=>{setSAP(sv.id);setPF({a:rem>0?String(rem):'',d:td(),n:''})}} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-np-blue border border-np-blue/30 rounded-md hover:bg-np-blue/5"><Plus className="w-3 h-3"/>Add Payment</button>
        </div></div>})}
    {tab==='pmt'&&<div className="rounded-xl border border-gray-100 bg-white overflow-hidden"><div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30"><TH>Date</TH><TH>Service</TH><TH className="text-right">Amount</TH><TH className="text-right text-np-blue">SNW</TH>{clObj&&<TH className="text-right text-amber-600">Clinic</TH>}<TH className="text-right text-purple-600">Dr.Y</TH><TH>Payout</TH></tr></thead>
      <tbody>{cl.services.flatMap((sv:AcctService)=>sv.payments.map((pm:AcctPayment)=>{const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,mapSp);return{...pm,svc:sv.service_type,...sp}})).sort((a:any,b:any)=>a.payment_date.localeCompare(b.payment_date)).map((pm:any,i:number)=>{
        const clA=Object.values(pm.clinicAmts).reduce((s:number,v:any)=>s+v,0) as number
        return <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50"><td className="py-2 px-3 text-xs text-gray-600">{fD(pm.payment_date)}</td><td className="py-2 px-3 text-xs text-gray-400">{pm.svc}</td>
          <td className="py-2 px-3 text-xs font-semibold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(pm.amount)}</td><td className="py-2 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(pm.snw)}</td>
          {clObj&&<td className="py-2 px-3 text-xs text-right" style={{color:clA>0?'#d97706':'#d1d5db',fontFeatureSettings:'"tnum"'}}>{clA>0?$$(clA):'\u2014'}</td>}
          <td className="py-2 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(pm.dr)}</td><td className="py-2 px-3 text-[10px] text-gray-400">{fD(pm.payout_date||getPayoutDate(pm.payment_date))}</td></tr>})}</tbody></table></div></div>}
    {showAS&&<Mdl title="Add Service" onClose={()=>setSAS(false)}>
      <FS label="Type" value={sf.t} onChange={(v:string)=>setSF(p=>({...p,t:v,a:v==='Map'?'600':'5400'}))} options={[{v:'Map',l:'Initial Map (qEEG)'},{v:'Program',l:'Neuro Program'}]}/>
      <FI label="Amount ($)" value={sf.a} onChange={(v:string)=>setSF(p=>({...p,a:v}))} type="number"/><FI label="Date" value={sf.d} onChange={(v:string)=>setSF(p=>({...p,d:v}))} type="date"/><FI label="Notes" value={sf.n} onChange={(v:string)=>setSF(p=>({...p,n:v}))}/>
      <SplitPrev amt={parseFloat(sf.a)||0} svcType={sf.t} locId={cl.location_id} locs={locs} clinics={clinics} mapSp={mapSp}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={()=>setSAS(false)}>Cancel</Btn><Btn onClick={doAS}>Add</Btn></div></Mdl>}
    {showAP&&tSvc&&<Mdl title={`Payment: ${tSvc.service_type}`} onClose={()=>setSAP(null)}>
      <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 mb-4 space-y-1">
        <div className="flex justify-between text-xs"><span className="text-gray-400">Total:</span><span className="font-semibold" style={{fontFeatureSettings:'"tnum"'}}>{$$(tSvc.amount)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-gray-400">Paid:</span><span className="font-semibold text-green-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(tSvc.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0))}</span></div>
        <div className="flex justify-between text-xs"><span className="text-gray-400">Remaining:</span><span className="font-bold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(tSvc.amount-tSvc.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0))}</span></div></div>
      <FI label="Amount ($)" value={pf.a} onChange={(v:string)=>setPF(p=>({...p,a:v}))} type="number"/><FI label="Date" value={pf.d} onChange={(v:string)=>setPF(p=>({...p,d:v}))} type="date"/><FI label="Note" value={pf.n} onChange={(v:string)=>setPF(p=>({...p,n:v}))}/>
      <SplitPrev amt={parseFloat(pf.a)||0} svcType={tSvc.service_type} locId={cl.location_id} locs={locs} clinics={clinics} mapSp={mapSp}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={()=>setSAP(null)}>Cancel</Btn><Btn onClick={()=>doAP(showAP!)}>Record</Btn></div></Mdl>}
  </div>
}

/* ── Reconciliation ────────────────────────────────── */
function ReconView({clients,locs,clinics,mapSp}:{clients:AcctClient[];locs:AcctLocation[];clinics:AcctClinic[];mapSp:{snw:number;dr:number}}) {
  const [exp,setE]=useState<string|null>(null)
  const data=useMemo(()=>{
    const months:Record<string,any>={}
    clients.forEach(cl=>cl.services.forEach(sv=>sv.payments.forEach(pm=>{
      if(pm.amount===0)return;const mk=pm.payment_date.substring(0,7)
      if(!months[mk])months[mk]={total:0,snw:0,dr:0,clinicAmts:{} as Record<string,number>,det:[] as any[]}
      const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,mapSp)
      months[mk].total+=pm.amount;months[mk].snw+=sp.snw;months[mk].dr+=sp.dr
      Object.entries(sp.clinicAmts).forEach(([cid,ca])=>{months[mk].clinicAmts[cid]=(months[mk].clinicAmts[cid]||0)+ca})
      months[mk].det.push({client:cl.name,svc:sv.service_type,amt:pm.amount,d:pm.payment_date,loc:cl.location_id,snw:sp.snw,dr:sp.dr,clinicAmts:sp.clinicAmts,payoutDate:pm.payout_date||getPayoutDate(pm.payment_date)})
    })));return Object.entries(months).sort(([a],[b])=>a.localeCompare(b)).map(([mo,d])=>({mo,...d}))
  },[clients,locs,clinics,mapSp])
  const periods=useMemo(()=>{
    const p:Record<string,any>={};data.forEach((m:any)=>m.det.forEach((d:any)=>{
      const pd=d.payoutDate;if(!p[pd])p[pd]={total:0,snw:0,dr:0,clinicAmts:{} as Record<string,number>,items:[] as any[]}
      p[pd].total+=d.amt;p[pd].snw+=d.snw;p[pd].dr+=d.dr
      Object.entries(d.clinicAmts).forEach(([cid,ca])=>{p[pd].clinicAmts[cid]=(p[pd].clinicAmts[cid]||0)+(ca as number)});p[pd].items.push(d)
    }));return Object.entries(p).sort(([a],[b])=>a.localeCompare(b)).map(([pd,v])=>({payoutDate:pd,...v}))
  },[data])
  const totRev=data.reduce((s:number,m:any)=>s+m.total,0);const totSnw=data.reduce((s:number,m:any)=>s+m.snw,0);const totDr=data.reduce((s:number,m:any)=>s+m.dr,0)
  const totCl:Record<string,number>={};clinics.forEach(c=>{totCl[c.id]=data.reduce((s:number,m:any)=>s+(m.clinicAmts[c.id]||0),0)})
  const today=td();const nextPayout=periods.find((p:any)=>p.payoutDate>=today)

  return <div className="space-y-5">
    <div><h2 className="text-base font-bold text-np-dark">Reconciliation</h2><p className="text-xs text-gray-400 mt-0.5">Revenue splits and payout schedule</p></div>
    <div className="flex gap-3 flex-wrap"><Stat label="Total Revenue" value={$$(totRev)} icon={DollarSign}/><Stat label="SNW (retained)" value={$$(totSnw)} color="#386797"/>
      {clinics.map(c=><Stat key={c.id} label={c.name.length>20?c.name.split('(')[0].trim():c.name} value={$$(totCl[c.id]||0)} color="#d97706" sub="Total owed"/>)}<Stat label="Dr. Yonce" value={$$(totDr)} color="#9333ea" sub="Total owed"/></div>
    {nextPayout&&<div className="rounded-xl border-2 border-np-blue/20 bg-np-blue/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-np-blue/10"><h3 className="text-sm font-bold text-np-dark">Next Payout Due: {fD(nextPayout.payoutDate)}</h3></div>
      <div className="p-4"><p className="text-xs text-gray-500 mb-3">Collected: {$$(nextPayout.total)} from {nextPayout.items.length} payment{nextPayout.items.length!==1?'s':''}</p>
        <div className="flex gap-3 flex-wrap">
          {clinics.map(c=>(nextPayout.clinicAmts[c.id]||0)>0?<div key={c.id} className="flex-1 min-w-[140px] p-3 bg-white rounded-xl border border-gray-100 text-center"><p className="text-[10px] font-semibold text-amber-600 mb-1">Pay {c.name.split('(')[0].trim()}</p><p className="text-lg font-bold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(nextPayout.clinicAmts[c.id])}</p></div>:null)}
          {nextPayout.dr>0&&<div className="flex-1 min-w-[140px] p-3 bg-white rounded-xl border border-gray-100 text-center"><p className="text-[10px] font-semibold text-purple-600 mb-1">Pay Dr. Yonce</p><p className="text-lg font-bold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(nextPayout.dr)}</p></div>}
          <div className="flex-1 min-w-[140px] p-3 bg-white rounded-xl border border-gray-100 text-center"><p className="text-[10px] font-semibold text-np-blue mb-1">SNW Retains</p><p className="text-lg font-bold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(nextPayout.snw)}</p></div></div></div></div>}
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Payout Schedule</h3></div>
      <div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30"><TH>Payout Date</TH><TH>Activity</TH><TH className="text-right text-np-blue">SNW</TH>{clinics.map(c=><TH key={c.id} className="text-right text-amber-600">{c.name.split('(')[0].trim()}</TH>)}<TH className="text-right text-purple-600">Dr. Yonce</TH></tr></thead>
        <tbody>{periods.map((p:any)=>{const past=p.payoutDate<today;return<tr key={p.payoutDate} className={`border-b border-gray-50 hover:bg-gray-50/50 ${past?'opacity-50':''}`}>
          <td className="py-2 px-3 text-xs font-semibold text-np-dark">{fD(p.payoutDate)}{past&&<span className="ml-1.5 text-[10px] text-green-600">paid</span>}</td>
          <td className="py-2 px-3 text-xs font-semibold text-np-dark" style={{fontFeatureSettings:'"tnum"'}}>{$$(p.total)}<span className="text-gray-400 font-normal ml-1">{p.items.length} pmt{p.items.length!==1?'s':''}</span></td>
          <td className="py-2 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(p.snw)}</td>
          {clinics.map(c=><td key={c.id} className="py-2 px-3 text-xs text-right" style={{color:(p.clinicAmts[c.id]||0)>0?'#d97706':'#d1d5db',fontFeatureSettings:'"tnum"'}}>{(p.clinicAmts[c.id]||0)>0?$$(p.clinicAmts[c.id]):'\u2014'}</td>)}
          <td className="py-2 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(p.dr)}</td></tr>})}</tbody></table></div></div>
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
            <table className="w-full text-left"><thead><tr className="border-b border-gray-100"><TH>Date</TH><TH>Client</TH><TH>Svc</TH><TH>Loc</TH><TH className="text-right">Amt</TH><TH>Payout</TH></tr></thead>
              <tbody>{r.det.sort((a:any,b:any)=>a.d.localeCompare(b.d)).map((d:any,j:number)=><tr key={j} className="border-b border-gray-100/50">
                <td className="py-1.5 px-3 text-xs text-gray-600">{fD(d.d)}</td><td className="py-1.5 px-3 text-xs font-semibold text-np-dark">{d.client}</td>
                <td className="py-1.5 px-3 text-[11px] text-gray-400">{d.svc}</td><td className="py-1.5 px-3"><LocTag loc={d.loc} locs={locs}/></td>
                <td className="py-1.5 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{$$(d.amt)}</td><td className="py-1.5 px-3 text-[10px] text-gray-400">{fD(d.payoutDate)}</td></tr>)}</tbody></table></div></td></tr>:null
        ])}
        <tr className="bg-gray-50/50 border-t border-gray-200"><td className="py-2.5 px-3 text-xs font-bold text-np-dark">TOTAL</td><td className="py-2.5 px-3 text-xs font-bold" style={{fontFeatureSettings:'"tnum"'}}>{$$(totRev)}</td><td className="py-2.5 px-3 text-xs font-bold text-np-blue" style={{fontFeatureSettings:'"tnum"'}}>{$$(totSnw)}</td>{clinics.map(c=><td key={c.id} className="py-2.5 px-3 text-xs font-bold text-amber-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(totCl[c.id]||0)}</td>)}<td className="py-2.5 px-3 text-xs font-bold text-purple-600" style={{fontFeatureSettings:'"tnum"'}}>{$$(totDr)}</td></tr>
        </tbody></table></div></div></div>
}

/* ── Settings ──────────────────────────────────────── */
function SetView({locs,clinics,mapSp,setMapSp,clients,agreement,setAgreement,onSaveConfig,onSaveLoc,onDeleteLoc,onSaveClinic}:any) {
  const [modal,setMo]=useState<any>(null);const [form,setF]=useState<any>({});const [editAgr,setEA]=useState(false)
  const mT=mapSp.snw+mapSp.dr
  const open=(type:string,data:any)=>{setMo({type});setF(data||{})};const close=()=>{setMo(null);setF({})}
  const saveLoc=async()=>{if(!form.name?.trim()||!form.short?.trim())return;await onSaveLoc(modal.type==='addLoc'?null:form.id,{name:form.name.trim(),short_code:form.short.trim().toUpperCase(),color:form.color||COLORS[locs.length%COLORS.length],clinic_id:form.clinicId||null});close()}
  const deleteLoc=async(lid:string)=>{const n=clients.filter((c:AcctClient)=>c.location_id===lid).length;if(n>0){alert(`Cannot delete: ${n} client(s) assigned.`);return};await onDeleteLoc(lid);close()}
  const saveClinic=async()=>{if(!form.name?.trim())return;await onSaveClinic(modal.type==='addClinic'?null:form.id,{name:form.name.trim(),contact_name:form.contactName||'',ein:form.ein||'',corp_type:form.corpType||'',has_w9:!!form.hasW9,has_1099:!!form.has1099,address:form.address||'',city:form.city||'',state:form.state||'',zip:form.zip||'',phone:form.phone||'',email:form.email||'',website:form.website||'',notes:form.notes||'',split_snw:form.snw||26,split_clinic:form.clinic||55.01,split_dr:form.drY||18.99});close()}

  return <div className="space-y-5">
    <h2 className="text-base font-bold text-np-dark">Settings</h2>
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Payout Agreement</h3><Btn sm outline onClick={()=>{if(editAgr)onSaveConfig();setEA(!editAgr)}}>{editAgr?'Done':'Edit'}</Btn></div>
      <div className="p-4">{editAgr?<textarea value={agreement} onChange={e=>setAgreement(e.target.value)} className="w-full min-h-[200px] p-3 text-xs leading-relaxed border border-gray-200 rounded-lg bg-white text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/20 resize-y" style={{fontFeatureSettings:'"tnum"'}}/>:<pre className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">{agreement||'No agreement set.'}</pre>}</div></div>
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Map Splits (Global)</h3></div>
      <div className="p-4"><p className="text-xs text-gray-400 mb-3">Maps always split between SNW and Dr. Yonce only.</p>
        <SplitIn label="SNW" value={mapSp.snw} onChange={v=>setMapSp({...mapSp,snw:v})}/><SplitIn label="Dr. Yonce" value={mapSp.dr} onChange={v=>setMapSp({...mapSp,dr:v})}/>
        <p className={`text-xs font-semibold mt-2 ${mT===100?'text-green-600':'text-red-500'}`}>Total: {mT}%{mT!==100&&' (should be 100%)'}</p>
        <div className="mt-3"><Btn sm onClick={onSaveConfig}>Save Splits</Btn></div></div></div>
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Clinic Entities</h3><button onClick={()=>open('addClinic',{snw:26,clinic:55.01,drY:18.99})} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-np-blue bg-np-blue/10 rounded-md hover:bg-np-blue/20"><Plus className="w-3 h-3"/>Create Clinic</button></div>
      {clinics.map((cl:AcctClinic)=>{const locsUsing=locs.filter((l:AcctLocation)=>l.clinic_id===cl.id);const isCorp=cl.corp_type==='ccorp'||cl.corp_type==='scorp'
        return <div key={cl.id} className="px-4 py-3 border-b border-gray-50"><div className="flex justify-between items-start"><div>
          <p className="text-sm font-bold text-np-dark">{cl.name}{cl.contact_name&&<span className="font-normal text-gray-400"> ({cl.contact_name})</span>}</p>
          <div className="flex gap-1.5 mt-1 flex-wrap">{cl.ein&&<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-600">EIN: {cl.ein}</span>}{cl.corp_type&&<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-600">{cl.corp_type==='sole'?'Sole Prop':cl.corp_type==='llc'?'LLC':cl.corp_type==='scorp'?'S-Corp':cl.corp_type==='ccorp'?'C-Corp':'Partnership'}</span>}{!isCorp&&(cl.has_w9?<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-green-50 text-green-600">W-9</span>:<span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-500">W-9 needed</span>)}</div>
          {(cl.address||cl.city)&&<p className="text-[11px] text-gray-400 mt-1">{[cl.address,cl.city,cl.state,cl.zip].filter(Boolean).join(', ')}</p>}
          <p className="text-xs mt-1"><span className="text-np-blue">SNW {cl.split_snw}%</span> / <span className="text-amber-600">Clinic {cl.split_clinic}%</span> / <span className="text-purple-600">Dr.Y {cl.split_dr}%</span></p>
          <p className="text-[11px] text-gray-400 mt-0.5">Locations: {locsUsing.length>0?locsUsing.map((l:AcctLocation)=>l.name).join(', '):<span className="text-amber-500">None</span>}</p>
        </div><Btn sm outline onClick={()=>open('editClinic',{...cl,contactName:cl.contact_name,corpType:cl.corp_type,hasW9:cl.has_w9,has1099:cl.has_1099,snw:cl.split_snw,clinic:cl.split_clinic,drY:cl.split_dr})}>Edit</Btn></div></div>})}</div>
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-semibold text-np-dark">Locations</h3><button onClick={()=>open('addLoc',{color:COLORS[locs.length%COLORS.length]})} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-np-blue bg-np-blue/10 rounded-md hover:bg-np-blue/20"><Plus className="w-3 h-3"/>Add Location</button></div>
      {locs.map((loc:AcctLocation)=>{const cl=loc.clinic_id?clinics.find((c:AcctClinic)=>c.id===loc.clinic_id):null;const n=clients.filter((c:AcctClient)=>c.location_id===loc.id).length
        return <div key={loc.id} className="px-4 py-3 border-b border-gray-50 flex justify-between items-center"><div className="flex items-center gap-3"><div className="w-3 h-3 rounded" style={{background:loc.color}}/><div><div className="flex items-center gap-2"><span className="text-sm font-bold text-np-dark">{loc.name}</span><span className="text-[10px] text-gray-400 px-1.5 py-0.5 bg-gray-50 rounded">{loc.short_code}</span><span className="text-[10px] text-gray-400">{n} client{n!==1?'s':''}</span></div><p className={`text-[11px] mt-0.5 ${cl?'text-green-600':'text-amber-500'}`}>{cl?`Clinic: ${cl.name}`:'No clinic'}</p></div></div>
          <div className="flex gap-1.5"><Btn sm outline onClick={()=>open('editLoc',{...loc,short:loc.short_code,clinicId:loc.clinic_id})}>Edit</Btn><BtnDanger sm onClick={()=>deleteLoc(loc.id)}>Delete</BtnDanger></div></div>})}</div>
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
      <SplitIn label="SNW" value={form.snw||0} onChange={v=>setF((p:any)=>({...p,snw:v}))}/><SplitIn label="Clinic" value={form.clinic||0} onChange={v=>setF((p:any)=>({...p,clinic:v}))}/><SplitIn label="Dr. Yonce" value={form.drY||0} onChange={v=>setF((p:any)=>({...p,drY:v}))}/>
      {(()=>{const pT=(form.snw||0)+(form.clinic||0)+(form.drY||0);return<p className={`text-xs font-semibold mt-2 ${Math.abs(pT-100)<0.1?'text-green-600':'text-red-500'}`}>Total: {pT.toFixed(2)}%{Math.abs(pT-100)>=0.1&&' (should be 100%)'}</p>})()}
      <FI label="Notes" value={form.notes||''} onChange={(v:string)=>setF((p:any)=>({...p,notes:v}))}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={close}>Cancel</Btn><Btn onClick={saveClinic}>Save</Btn></div></Mdl>}
  </div>
}

/* ── Main Page ─────────────────────────────────────── */
export default function AccountingPage() {
  const {currentOrg}=useWorkspace();const supabase=createClient()
  const [clients,setClients]=useState<AcctClient[]>([]);const [locs,setLocs]=useState<AcctLocation[]>([]);const [clinics,setClinics]=useState<AcctClinic[]>([])
  const [config,setConfig]=useState<AcctConfig>({map_splits:{snw:23,dr:77},default_map_price:600,default_program_price:5400,payout_agreement:''})
  const [loading,setLoading]=useState(true);const [vw,sV]=useState('dash');const [sel,sS]=useState<string|null>(null);const [q,sQ]=useState('')
  const [showAC,setSAC]=useState(false);const [nc,setNC]=useState({nm:'',loc:''})
  const orgId=currentOrg?.id

  const loadData=useCallback(async()=>{
    if(!orgId)return;setLoading(true)
    try{const [locsR,clinicsR,clientsR,svcsR,pmtsR,cfgR]=await Promise.all([
      supabase.from('acct_locations').select('*').eq('org_id',orgId),supabase.from('acct_clinics').select('*').eq('org_id',orgId),
      supabase.from('acct_clients').select('*').eq('org_id',orgId).order('name'),supabase.from('acct_services').select('*').eq('org_id',orgId),
      supabase.from('acct_payments').select('*').eq('org_id',orgId).order('payment_date'),
      supabase.from('org_settings').select('setting_value').eq('org_id',orgId).eq('setting_key','acct_config').maybeSingle()])
    setLocs(locsR.data||[]);setClinics(clinicsR.data||[]);if(cfgR.data?.setting_value)setConfig(cfgR.data.setting_value)
    const svcs=svcsR.data||[];const pmts=pmtsR.data||[]
    setClients((clientsR.data||[]).map((c:any)=>({...c,services:svcs.filter((s:any)=>s.client_id===c.id).map((s:any)=>({...s,payments:pmts.filter((p:any)=>p.service_id===s.id)}))})))}catch(e){console.error('Load failed',e)}
    setLoading(false)},[orgId])

  useEffect(()=>{loadData()},[loadData])

  const addClient=async()=>{if(!nc.nm.trim()||!nc.loc||!orgId)return;await supabase.from('acct_clients').insert({org_id:orgId,name:nc.nm.trim(),location_id:nc.loc});setSAC(false);setNC({nm:'',loc:''});loadData()}
  const addService=async(cid:string,svc:any)=>{if(!orgId)return;await supabase.from('acct_services').insert({org_id:orgId,client_id:cid,...svc});loadData()}
  const addPayment=async(cid:string,sid:string,pmt:any)=>{if(!orgId)return;await supabase.from('acct_payments').insert({org_id:orgId,service_id:sid,client_id:cid,...pmt});loadData()}
  const saveConfig=async()=>{if(!orgId)return;await supabase.from('org_settings').upsert({org_id:orgId,setting_key:'acct_config',setting_value:config},{onConflict:'org_id,setting_key'})}
  const saveLoc=async(id:string|null,data:any)=>{if(!orgId)return;if(id)await supabase.from('acct_locations').update(data).eq('id',id);else await supabase.from('acct_locations').insert({id:data.short_code,org_id:orgId,...data});loadData()}
  const deleteLoc=async(id:string)=>{await supabase.from('acct_locations').delete().eq('id',id);loadData()}
  const saveClinic=async(id:string|null,data:any)=>{if(!orgId)return;if(id)await supabase.from('acct_clinics').update(data).eq('id',id);else await supabase.from('acct_clinics').insert({id:`clinic-${Date.now()}`,org_id:orgId,...data});loadData()}

  const fl=clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()));const ac=clients.find(c=>c.id===sel);const mapSp=config.map_splits
  const navItems=[{k:'dash',icon:LayoutDashboard,l:'Dashboard'},{k:'recon',icon:BarChart3,l:'Reconciliation'},{k:'settings',icon:SettingsIcon,l:'Settings'}]

  if(loading)return<div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse"/></div>

  return <div className="space-y-0">
    <div className="flex" style={{minHeight:'calc(100vh - 80px)'}}>
      {/* Inner sidebar */}
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

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-5">
        {ac?<DetView cl={ac} locs={locs} clinics={clinics} mapSp={mapSp} onBack={()=>sS(null)} onAddSvc={addService} onAddPmt={addPayment}/>
          :vw==='recon'?<ReconView clients={clients} locs={locs} clinics={clinics} mapSp={mapSp}/>
          :vw==='settings'?<SetView locs={locs} clinics={clinics} mapSp={mapSp} setMapSp={(v:any)=>setConfig(p=>({...p,map_splits:v}))} clients={clients} agreement={config.payout_agreement} setAgreement={(v:string)=>setConfig(p=>({...p,payout_agreement:v}))} onSaveConfig={saveConfig} onSaveLoc={saveLoc} onDeleteLoc={deleteLoc} onSaveClinic={saveClinic}/>
          :<DashView clients={clients} locs={locs} onSel={id=>{sS(id);sV('dash')}} onAdd={()=>{setSAC(true);setNC({nm:'',loc:locs[0]?.id||''})}}/>}
      </div></div>
    {showAC&&<Mdl title="Add Client" onClose={()=>setSAC(false)}>
      <FI label="Name" value={nc.nm} onChange={(v:string)=>setNC(p=>({...p,nm:v}))} placeholder="First and Last Name"/>
      <FS label="Location" value={nc.loc} onChange={(v:string)=>setNC(p=>({...p,loc:v}))} options={locs.map(l=>({v:l.id,l:l.name}))}/>
      <div className="flex gap-2 mt-4 justify-end"><Btn outline onClick={()=>setSAC(false)}>Cancel</Btn><Btn onClick={addClient}>Add Client</Btn></div></Mdl>}
  </div>
}
