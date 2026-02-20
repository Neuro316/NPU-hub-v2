'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════
interface AcctLocation {
  id: string; name: string; short_code: string; color: string; clinic_id: string | null; org_id: string
}
interface AcctClinic {
  id: string; org_id: string; name: string; contact_name: string; ein: string; corp_type: string
  has_w9: boolean; has_1099: boolean; address: string; city: string; state: string; zip: string
  phone: string; email: string; website: string; notes: string
  split_snw: number; split_clinic: number; split_dr: number
}
interface AcctPayment {
  id: string; service_id: string; client_id: string; amount: number; payment_date: string; notes: string
  split_snw: number; split_clinic: number; split_dr: number; clinic_id: string | null
  payout_date: string; payout_period: string; is_paid_out: boolean
}
interface AcctService {
  id: string; client_id: string; service_type: 'Map' | 'Program'; amount: number; service_date: string; notes: string
  payments: AcctPayment[]
}
interface AcctClient {
  id: string; name: string; location_id: string; org_id: string; notes: string
  services: AcctService[]
}
interface AcctConfig {
  map_splits: { snw: number; dr: number }
  default_map_price: number; default_program_price: number; payout_agreement: string
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
const $$ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
const fD = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const fMoL = (m: string) => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
const gI = (n: string) => n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
const td = () => new Date().toISOString().split('T')[0]

const K = { bg: '#08080d', sf: '#0e0e15', sh: '#141420', cd: '#101018', cb: '#1c1c2c', tx: '#e4e4ee', tm: '#6a6a82', ac: '#7c6bf0', ag: 'rgba(124,107,240,0.12)', gn: '#3dd68c', rd: '#ef6b6b', yl: '#f0b429', or: '#e8864a', cy: '#4dcfcf', pu: '#b48afa', dv: '#18182a', pk: '#f472b6' }
const SB: Record<string, { b: string; t: string }> = { 'Paid in Full': { b: '#0b2e1d', t: '#3dd68c' }, 'Payment Plan': { b: '#332008', t: '#f0b429' }, 'Stopped/Incomplete': { b: '#350d0d', t: '#ef6b6b' }, 'Map Only': { b: '#12121e', t: '#8888a0' }, Trade: { b: '#14122a', t: '#9d8cf0' }, 'No Services': { b: '#121218', t: '#555568' } }
const COLORS = ['#f0b429', '#f472b6', '#a78bfa', '#4dcfcf', '#e8864a', '#3dd68c', '#ef6b6b', '#60a5fa', '#f9a8d4', '#a3e635']

function getStatus(c: AcctClient) {
  if (!c.services.length) return 'No Services'
  if (c.services.every(s => s.amount === 0)) return 'Trade'
  const p = c.services.find(s => s.service_type === 'Program')
  if (!p) return 'Map Only'
  const pd = p.payments.reduce((s, x) => s + x.amount, 0)
  if (p.notes?.toLowerCase().includes('stop')) return 'Stopped/Incomplete'
  return pd >= p.amount ? 'Paid in Full' : 'Payment Plan'
}

function calcSplit(amt: number, svcType: string, locId: string, locs: AcctLocation[], clinics: AcctClinic[], mapSp: { snw: number; dr: number }) {
  if (svcType === 'Map') return { snw: (amt * mapSp.snw) / 100, dr: (amt * mapSp.dr) / 100, clinicAmts: {} as Record<string, number> }
  const loc = locs.find(l => l.id === locId); const cl = loc?.clinic_id ? clinics.find(c => c.id === loc.clinic_id) : null
  if (cl) return { snw: (amt * cl.split_snw) / 100, dr: (amt * cl.split_dr) / 100, clinicAmts: { [cl.id]: (amt * cl.split_clinic) / 100 } }
  return { snw: (amt * 81.01) / 100, dr: (amt * 18.99) / 100, clinicAmts: {} as Record<string, number> }
}

function getPayoutDate(activityDate: string) {
  const d = new Date(activityDate + 'T12:00:00'); const day = d.getDate(); const m = d.getMonth(); const y = d.getFullYear()
  if (day <= 15) return new Date(y, m + 1, 1).toISOString().split('T')[0]
  else return new Date(y, m + 1, 15).toISOString().split('T')[0]
}
function getPeriodLabel(activityDate: string) {
  const d = new Date(activityDate + 'T12:00:00'); const day = d.getDate()
  const mName = d.toLocaleDateString('en-US', { month: 'short' })
  return day <= 15 ? `${mName} 1-15` : `${mName} 16-${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()}`
}

// ═══════════════════════════════════════════════════════════════
// UI PRIMITIVES
// ═══════════════════════════════════════════════════════════════
const Cd = ({ children, style }: any) => <div style={{ background: K.cd, border: `1px solid ${K.cb}`, borderRadius: 10, overflow: 'hidden', ...style }}>{children}</div>
const SH = ({ children, right }: any) => <div style={{ padding: '12px 18px', fontSize: 13, fontWeight: 700, borderBottom: `1px solid ${K.dv}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{children}{right}</div>
const TH = ({ children, style }: any) => <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: K.tm, borderBottom: `1px solid ${K.dv}`, ...style }}>{children}</th>
const TD = ({ children, style, m, c }: any) => <td style={{ padding: '8px 14px', borderBottom: `1px solid ${K.dv}`, color: c || K.tx, fontSize: 12.5, fontFamily: m ? "'DM Mono',monospace" : 'inherit', fontWeight: m ? 600 : 400, ...style }}>{children}</td>
const Stat = ({ l, v, c, s }: any) => <div style={{ flex: '1 1 130px', padding: '13px 15px', borderRadius: 9, background: K.cd, border: `1px solid ${K.cb}`, minWidth: 125 }}><div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: K.tm, marginBottom: 5 }}>{l}</div><div style={{ fontSize: 17, fontWeight: 700, color: c || K.tx, fontFamily: "'DM Mono',monospace", letterSpacing: '-0.02em' }}>{v}</div>{s && <div style={{ fontSize: 10.5, color: K.tm, marginTop: 3 }}>{s}</div>}</div>
const TabB = ({ a, onClick, children }: any) => <button onClick={onClick} style={{ padding: '8px 14px', fontSize: 12, fontWeight: a ? 700 : 500, color: a ? K.ac : K.tm, cursor: 'pointer', background: 'none', border: 'none', borderBottom: `2px solid ${a ? K.ac : 'transparent'}`, fontFamily: 'inherit' }}>{children}</button>
const LT = ({ loc, locs }: { loc: string; locs: AcctLocation[] }) => { const l = locs.find(x => x.id === loc); return <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: `${l?.color || K.tm}18`, color: l?.color || K.tm }}>{l?.name || loc}</span> }
const Bg = ({ s }: { s: string }) => <span style={{ display: 'inline-flex', padding: '2px 9px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: SB[s]?.b || K.cb, color: SB[s]?.t || K.tx, whiteSpace: 'nowrap' }}>{s}</span>
const Btn = ({ children, onClick, small, outline, disabled, color, style: st }: any) => <button onClick={onClick} disabled={disabled} style={{ padding: small ? '5px 12px' : '8px 18px', borderRadius: 7, fontSize: small ? 11 : 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, border: outline ? `1px solid ${color || K.ac}` : '1px solid transparent', background: outline ? 'transparent' : (color || K.ac), color: outline ? (color || K.ac) : '#fff', fontFamily: 'inherit', ...st }}>{children}</button>
const Inp = ({ label, value, onChange, type, placeholder, half, style: st }: any) => <div style={{ marginBottom: 10, flex: half ? '1 1 45%' : undefined, ...st }}>{label && <div style={{ fontSize: 10.5, fontWeight: 600, color: K.tm, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>}<input type={type || 'text'} value={value} onChange={(e: any) => onChange(e.target.value)} placeholder={placeholder} style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: `1px solid ${K.cb}`, background: K.bg, color: K.tx, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} /></div>
const Sel = ({ label, value, onChange, options }: any) => <div style={{ marginBottom: 10 }}>{label && <div style={{ fontSize: 10.5, fontWeight: 600, color: K.tm, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>}<select value={value} onChange={(e: any) => onChange(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: `1px solid ${K.cb}`, background: K.bg, color: K.tx, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', appearance: 'auto' as any }}>{options.map((o: any) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
const Modal = ({ title, onClose, children, wide }: any) => <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }} onClick={onClose}><div onClick={(e: any) => e.stopPropagation()} style={{ background: K.cd, border: `1px solid ${K.cb}`, borderRadius: 14, width: wide ? 720 : 500, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto' }}><div style={{ padding: '16px 20px', borderBottom: `1px solid ${K.dv}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3><button onClick={onClose} style={{ background: 'none', border: 'none', color: K.tm, fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}>&times;</button></div><div style={{ padding: 20 }}>{children}</div></div></div>
const NI = ({ l, v, on }: any) => <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}><span style={{ fontSize: 12, color: K.tm, width: 70, fontWeight: 500 }}>{l}</span><input type="number" value={v} onChange={(e: any) => on(parseFloat(e.target.value) || 0)} step={0.5} style={{ width: 64, padding: '5px 8px', borderRadius: 5, border: `1px solid ${K.cb}`, background: K.bg, color: K.tx, fontSize: 13, fontWeight: 600, textAlign: 'right', outline: 'none', fontFamily: "'DM Mono',monospace" }} /><span style={{ fontSize: 11, color: K.tm }}>%</span></div>
const Row = ({ children }: any) => <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{children}</div>
const Tag = ({ children, color }: any) => <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: `${color || K.gn}18`, color: color || K.gn }}>{children}</span>

const DistPrev = ({ amt, svcType, locId, locs, clinics, mapSp }: any) => {
  if (!amt || amt <= 0) return null
  const sp = calcSplit(amt, svcType, locId, locs, clinics, mapSp)
  const loc = locs.find((l: any) => l.id === locId); const cl = loc?.clinic_id ? clinics.find((c: any) => c.id === loc.clinic_id) : null
  return <div style={{ padding: '12px 14px', background: K.bg, borderRadius: 8, marginTop: 12, border: `1px solid ${K.cb}` }}>
    <div style={{ fontSize: 10.5, fontWeight: 600, color: K.tm, marginBottom: 8, textTransform: 'uppercase' }}>Distribution</div>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: K.cd, borderRadius: 6, minWidth: 80 }}><div style={{ fontSize: 10, color: K.cy, fontWeight: 600, marginBottom: 3 }}>SNW</div><div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: K.cy }}>{$$(sp.snw)}</div></div>
      {Object.entries(sp.clinicAmts).map(([cid, ca]) => { const c = clinics.find((x: any) => x.id === cid); return <div key={cid} style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: K.cd, borderRadius: 6, minWidth: 80 }}><div style={{ fontSize: 10, color: K.yl, fontWeight: 600, marginBottom: 3 }}>{c?.name || 'Clinic'}</div><div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: K.yl }}>{$$(ca as number)}</div></div> })}
      <div style={{ flex: 1, textAlign: 'center', padding: '8px 6px', background: K.cd, borderRadius: 6, minWidth: 80 }}><div style={{ fontSize: 10, color: K.pu, fontWeight: 600, marginBottom: 3 }}>Dr. Yonce</div><div style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: K.pu }}>{$$(sp.dr)}</div></div>
    </div>
    {svcType === 'Map' && <div style={{ marginTop: 6, fontSize: 10.5, color: K.tm }}>Maps: SNW + Dr. Yonce only</div>}
    {svcType === 'Program' && !cl && <div style={{ marginTop: 6, fontSize: 10.5, color: K.or }}>No clinic here. Clinic share goes to SNW.</div>}
  </div>
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════
function Ov({ clients, locs, onSel, onAdd }: { clients: AcctClient[]; locs: AcctLocation[]; onSel: (id: string) => void; onAdd: () => void }) {
  const tO = clients.reduce((s, c) => s + c.services.reduce((a, v) => a + v.amount, 0), 0)
  const tC = clients.reduce((s, c) => s + c.services.reduce((a, v) => a + v.payments.reduce((p, x) => p + x.amount, 0), 0), 0)
  const prg = clients.filter(c => c.services.some(s => s.service_type === 'Program'))
  const mpo = clients.filter(c => !c.services.some(s => s.service_type === 'Program') && c.services.some(s => s.amount > 0))
  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}><div><h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Dashboard</h2></div><Btn onClick={onAdd}>+ Add Client</Btn></div>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}><Stat l="Clients" v={clients.length} c={K.ac} /><Stat l="Revenue" v={$$(tO)} /><Stat l="Collected" v={$$(tC)} c={K.gn} /><Stat l="Outstanding" v={$$(tO - tC)} c={tO - tC > 0 ? K.yl : K.gn} /></div>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>{locs.map(l => { const lc = clients.filter(c => c.location_id === l.id).reduce((s, c) => s + c.services.reduce((a, v) => a + v.payments.reduce((p, x) => p + x.amount, 0), 0), 0); return <Stat key={l.id} l={l.name} v={$$(lc)} c={l.color} s={`${clients.filter(c => c.location_id === l.id).length} clients`} /> })}</div>
    <Cd style={{ marginBottom: 18 }}><SH>Programs ({prg.length})</SH><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><TH>Client</TH><TH>Loc</TH><TH>Program</TH><TH>Paid</TH><TH>Balance</TH><TH>Status</TH></tr></thead><tbody>{prg.map(c => { const p = c.services.find(s => s.service_type === 'Program')!; const pd = p.payments.reduce((s, x) => s + x.amount, 0); return <tr key={c.id} onClick={() => onSel(c.id)} style={{ cursor: 'pointer' }} onMouseEnter={e => (e.currentTarget.style.background = K.sh)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}><TD style={{ fontWeight: 600 }}>{c.name}</TD><TD><LT loc={c.location_id} locs={locs} /></TD><TD m>{$$(p.amount)}</TD><TD m c={K.gn}>{$$(pd)}</TD><TD m c={p.amount - pd > 0 ? K.yl : K.gn}>{$$(p.amount - pd)}</TD><TD><Bg s={getStatus(c)} /></TD></tr> })}</tbody></table></Cd>
    {mpo.length > 0 && <Cd><SH>Map Only ({mpo.length})</SH><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><TH>Client</TH><TH>Loc</TH><TH>Date</TH><TH>Amt</TH></tr></thead><tbody>{mpo.map(c => { const m = c.services.find(s => s.service_type === 'Map')!; return <tr key={c.id} onClick={() => onSel(c.id)} style={{ cursor: 'pointer' }} onMouseEnter={e => (e.currentTarget.style.background = K.sh)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}><TD style={{ fontWeight: 600 }}>{c.name}</TD><TD><LT loc={c.location_id} locs={locs} /></TD><TD style={{ color: K.tm, fontSize: 12 }}>{fD(m.service_date)}</TD><TD m>{$$(m.amount)}</TD></tr> })}</tbody></table></Cd>}
  </div>
}

// ═══════════════════════════════════════════════════════════════
// DETAIL VIEW
// ═══════════════════════════════════════════════════════════════
function Det({ cl, locs, clinics, mapSp, onBack, onAddSvc, onAddPmt }: any) {
  const [tab, sT] = useState('svc'); const [showAS, setSAS] = useState(false); const [showAP, setSAP] = useState<string | null>(null)
  const [sf, setSF] = useState({ t: 'Map', a: '600', d: td(), n: '' })
  const [pf, setPF] = useState({ a: '', d: td(), n: '' })
  const st = getStatus(cl); const tO = cl.services.reduce((s: number, v: AcctService) => s + v.amount, 0); const tP = cl.services.reduce((s: number, v: AcctService) => s + v.payments.reduce((p: number, x: AcctPayment) => p + x.amount, 0), 0); const bal = tO - tP; const pct = tO > 0 ? (tP / tO) * 100 : 100
  const doAS = async () => { await onAddSvc(cl.id, { service_type: sf.t, amount: parseFloat(sf.a) || 0, service_date: sf.d, notes: sf.n }); setSAS(false); setSF({ t: 'Map', a: '600', d: td(), n: '' }) }
  const doAP = async (sid: string) => { const a = parseFloat(pf.a) || 0; if (a <= 0) return; await onAddPmt(cl.id, sid, { amount: a, payment_date: pf.d, notes: pf.n }); setSAP(null); setPF({ a: '', d: td(), n: '' }) }
  const tSvc = showAP ? cl.services.find((s: AcctService) => s.id === showAP) : null
  const loc = locs.find((l: AcctLocation) => l.id === cl.location_id); const clObj = loc?.clinic_id ? clinics.find((c: AcctClinic) => c.id === loc.clinic_id) : null

  return <div>
    <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: K.tm, cursor: 'pointer', marginBottom: 14, padding: '5px 0', background: 'none', border: 'none', fontFamily: 'inherit' }}><span style={{ fontSize: 16 }}>&#8592;</span> Back</button>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, background: `${loc?.color || K.ac}18`, color: loc?.color || K.ac }}>{gI(cl.name)}</div>
      <div style={{ flex: 1 }}><h2 style={{ fontSize: 19, fontWeight: 700, marginBottom: 3 }}>{cl.name}</h2><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Bg s={st} /><LT loc={cl.location_id} locs={locs} />{clObj && <span style={{ fontSize: 10.5, color: K.tm }}>via {clObj.name}</span>}</div></div>
    </div>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
      <Stat l="Owed" v={$$(tO)} />
      <div style={{ flex: '1 1 120px', padding: '13px 15px', borderRadius: 9, background: K.cd, border: `1px solid ${K.cb}`, minWidth: 118 }}><div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: K.tm, marginBottom: 5 }}>Paid</div><div style={{ fontSize: 17, fontWeight: 700, color: K.gn, fontFamily: "'DM Mono',monospace" }}>{$$(tP)}</div><div style={{ height: 5, borderRadius: 3, background: K.dv, overflow: 'hidden', marginTop: 7 }}><div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, borderRadius: 3, background: K.gn }} /></div></div>
      <Stat l="Balance" v={$$(bal)} c={bal > 0 ? K.yl : K.gn} />
    </div>

    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${K.dv}`, marginBottom: 20 }}><div style={{ display: 'flex' }}><TabB a={tab === 'svc'} onClick={() => sT('svc')}>Services</TabB><TabB a={tab === 'pmt'} onClick={() => sT('pmt')}>Payments</TabB></div>{tab === 'svc' && <Btn small onClick={() => setSAS(true)}>+ Add Service</Btn>}</div>

    {tab === 'svc' && cl.services.map((sv: AcctService) => {
      const svP = sv.payments.reduce((s: number, p: AcctPayment) => s + p.amount, 0); const sp = calcSplit(svP, sv.service_type, cl.location_id, locs, clinics, mapSp); const rem = sv.amount - svP; const clAmt = Object.values(sp.clinicAmts).reduce((s, v) => s + v, 0)
      return <Cd key={sv.id} style={{ marginBottom: 14 }}><SH right={$$(sv.amount)}>{sv.service_type === 'Map' ? 'Initial Map' : 'Neuro Program'}</SH><div style={{ padding: '12px 18px' }}>
        <div style={{ display: 'flex', gap: 18, fontSize: 12, flexWrap: 'wrap' }}><span><span style={{ color: K.tm }}>Date: </span>{fD(sv.service_date)}</span><span><span style={{ color: K.tm }}>Paid: </span><span style={{ color: K.gn }}>{$$(svP)}</span></span>{rem > 0 && <span><span style={{ color: K.tm }}>Rem: </span><span style={{ color: K.yl }}>{$$(rem)}</span></span>}</div>
        {sv.notes && <div style={{ fontSize: 11, color: K.tm, fontStyle: 'italic', marginTop: 3 }}>{sv.notes}</div>}
        <div style={{ marginTop: 10, padding: '9px 12px', background: K.bg, borderRadius: 7 }}><div style={{ fontSize: 10, fontWeight: 600, color: K.tm, marginBottom: 6, textTransform: 'uppercase' }}>Splits (on collected)</div><div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}><span><span style={{ color: K.tm }}>SNW: </span><span style={{ color: K.cy }}>{$$(sp.snw)}</span></span>{clAmt > 0 && <span><span style={{ color: K.tm }}>Clinic: </span><span style={{ color: K.yl }}>{$$(clAmt)}</span></span>}<span><span style={{ color: K.tm }}>Dr.Y: </span><span style={{ color: K.pu }}>{$$(sp.dr)}</span></span></div></div>
        {sv.payments.length > 0 && <div style={{ marginTop: 10 }}><div style={{ fontSize: 10.5, fontWeight: 600, color: K.tm, marginBottom: 4, textTransform: 'uppercase' }}>Payments</div>{sv.payments.map(pm => <div key={pm.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${K.dv}`, fontSize: 12 }}><span style={{ color: K.tm }}>{fD(pm.payment_date)}</span><span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600, color: K.gn }}>{$$(pm.amount)}</span><span style={{ color: K.tm, fontSize: 11 }}>{pm.notes}</span><span style={{ color: K.tm, fontSize: 10 }}>pays out {fD(pm.payout_date || getPayoutDate(pm.payment_date))}</span></div>)}</div>}
        <div style={{ marginTop: 10 }}><Btn small outline onClick={() => { setSAP(sv.id); setPF({ a: rem > 0 ? String(rem) : '', d: td(), n: '' }) }}>+ Add Payment</Btn></div>
      </div></Cd>
    })}

    {tab === 'pmt' && <Cd><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><TH>Date</TH><TH>Svc</TH><TH style={{ textAlign: 'right' }}>Amt</TH><TH style={{ color: K.cy, textAlign: 'right' }}>SNW</TH>{clObj && <TH style={{ color: K.yl, textAlign: 'right' }}>Clinic</TH>}<TH style={{ color: K.pu, textAlign: 'right' }}>Dr.Y</TH><TH>Payout</TH></tr></thead>
      <tbody>{cl.services.flatMap((sv: AcctService) => sv.payments.map((pm: AcctPayment) => {
        const sp = calcSplit(pm.amount, sv.service_type, cl.location_id, locs, clinics, mapSp); return { ...pm, svc: sv.service_type, ...sp }
      })).sort((a: any, b: any) => a.payment_date.localeCompare(b.payment_date)).map((pm: any, i: number) => {
        const clA = Object.values(pm.clinicAmts).reduce((s: number, v: any) => s + v, 0) as number
        return <tr key={i}><TD>{fD(pm.payment_date)}</TD><TD style={{ color: K.tm, fontSize: 12 }}>{pm.svc}</TD><TD m c={K.gn} style={{ textAlign: 'right' }}>{$$(pm.amount)}</TD><TD m c={K.cy} style={{ textAlign: 'right', fontSize: 12 }}>{$$(pm.snw)}</TD>{clObj && <TD m c={clA > 0 ? K.yl : K.tm} style={{ textAlign: 'right', fontSize: 12 }}>{clA > 0 ? $$(clA) : '\u2014'}</TD>}<TD m c={K.pu} style={{ textAlign: 'right', fontSize: 12 }}>{$$(pm.dr)}</TD><TD style={{ color: K.tm, fontSize: 11 }}>{fD(pm.payout_date || getPayoutDate(pm.payment_date))}</TD></tr>
      })}</tbody></table></Cd>}

    {showAS && <Modal title="Add Service" onClose={() => setSAS(false)}><Sel label="Type" value={sf.t} onChange={(v: string) => setSF(p => ({ ...p, t: v, a: v === 'Map' ? '600' : '5400' }))} options={[{ v: 'Map', l: 'Initial Map (qEEG)' }, { v: 'Program', l: 'Neuro Program' }]} /><Inp label="Amount ($)" value={sf.a} onChange={(v: string) => setSF(p => ({ ...p, a: v }))} type="number" /><Inp label="Date" value={sf.d} onChange={(v: string) => setSF(p => ({ ...p, d: v }))} type="date" /><Inp label="Notes" value={sf.n} onChange={(v: string) => setSF(p => ({ ...p, n: v }))} /><DistPrev amt={parseFloat(sf.a) || 0} svcType={sf.t} locId={cl.location_id} locs={locs} clinics={clinics} mapSp={mapSp} /><div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}><Btn outline onClick={() => setSAS(false)}>Cancel</Btn><Btn onClick={doAS}>Add</Btn></div></Modal>}
    {showAP && tSvc && <Modal title={`Payment: ${tSvc.service_type}`} onClose={() => setSAP(null)}>
      <div style={{ padding: '10px 14px', background: K.bg, borderRadius: 8, marginBottom: 14, fontSize: 12.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: K.tm }}>Total:</span><span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{$$(tSvc.amount)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: K.tm }}>Paid:</span><span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600, color: K.gn }}>{$$(tSvc.payments.reduce((s: number, p: AcctPayment) => s + p.amount, 0))}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: K.tm }}>Remaining:</span><span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: K.yl }}>{$$(tSvc.amount - tSvc.payments.reduce((s: number, p: AcctPayment) => s + p.amount, 0))}</span></div>
      </div>
      <Inp label="Amount ($)" value={pf.a} onChange={(v: string) => setPF(p => ({ ...p, a: v }))} type="number" /><Inp label="Date" value={pf.d} onChange={(v: string) => setPF(p => ({ ...p, d: v }))} type="date" /><Inp label="Note" value={pf.n} onChange={(v: string) => setPF(p => ({ ...p, n: v }))} />
      <DistPrev amt={parseFloat(pf.a) || 0} svcType={tSvc.service_type} locId={cl.location_id} locs={locs} clinics={clinics} mapSp={mapSp} />
      <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}><Btn outline onClick={() => setSAP(null)}>Cancel</Btn><Btn onClick={() => doAP(showAP!)}>Record</Btn></div>
    </Modal>}
  </div>
}

// ═══════════════════════════════════════════════════════════════
// RECONCILIATION VIEW
// ═══════════════════════════════════════════════════════════════
function ReconTab({ clients, locs, clinics, mapSp }: { clients: AcctClient[]; locs: AcctLocation[]; clinics: AcctClinic[]; mapSp: { snw: number; dr: number } }) {
  const [exp, setE] = useState<string | null>(null)
  const data = useMemo(() => {
    const months: Record<string, any> = {}
    clients.forEach(cl => cl.services.forEach(sv => sv.payments.forEach(pm => {
      if (pm.amount === 0) return; const mk = pm.payment_date.substring(0, 7)
      if (!months[mk]) months[mk] = { total: 0, snw: 0, dr: 0, clinicAmts: {} as Record<string, number>, det: [] as any[] }
      const sp = calcSplit(pm.amount, sv.service_type, cl.location_id, locs, clinics, mapSp)
      months[mk].total += pm.amount; months[mk].snw += sp.snw; months[mk].dr += sp.dr
      Object.entries(sp.clinicAmts).forEach(([cid, ca]) => { months[mk].clinicAmts[cid] = (months[mk].clinicAmts[cid] || 0) + ca })
      months[mk].det.push({ client: cl.name, svc: sv.service_type, amt: pm.amount, d: pm.payment_date, loc: cl.location_id, n: pm.notes, snw: sp.snw, dr: sp.dr, clinicAmts: sp.clinicAmts, payoutDate: pm.payout_date || getPayoutDate(pm.payment_date), period: pm.payout_period || getPeriodLabel(pm.payment_date) })
    })))
    return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([mo, d]) => ({ mo, ...d }))
  }, [clients, locs, clinics, mapSp])

  const periods = useMemo(() => {
    const p: Record<string, any> = {}
    data.forEach((m: any) => m.det.forEach((d: any) => {
      const pd = d.payoutDate; if (!p[pd]) p[pd] = { total: 0, snw: 0, dr: 0, clinicAmts: {} as Record<string, number>, items: [] as any[] }
      p[pd].total += d.amt; p[pd].snw += d.snw; p[pd].dr += d.dr
      Object.entries(d.clinicAmts).forEach(([cid, ca]) => { p[pd].clinicAmts[cid] = (p[pd].clinicAmts[cid] || 0) + (ca as number) })
      p[pd].items.push(d)
    }))
    return Object.entries(p).sort(([a], [b]) => a.localeCompare(b)).map(([pd, v]) => ({ payoutDate: pd, ...v }))
  }, [data])

  const totRev = data.reduce((s: number, m: any) => s + m.total, 0)
  const totSnw = data.reduce((s: number, m: any) => s + m.snw, 0)
  const totDr = data.reduce((s: number, m: any) => s + m.dr, 0)
  const totCl: Record<string, number> = {}; clinics.forEach(c => { totCl[c.id] = data.reduce((s: number, m: any) => s + (m.clinicAmts[c.id] || 0), 0) })
  const today = td()
  const nextPayout = periods.find((p: any) => p.payoutDate >= today)

  return <div>
    <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Reconciliation</h2>
    <p style={{ fontSize: 12.5, color: K.tm, marginBottom: 20 }}>Revenue splits and payout schedule</p>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
      <Stat l="Total Revenue" v={$$(totRev)} />
      <Stat l="SNW (retained)" v={$$(totSnw)} c={K.cy} />
      {clinics.map(c => <Stat key={c.id} l={c.name.length > 20 ? c.name.split('(')[0].trim() : c.name} v={$$(totCl[c.id] || 0)} c={K.yl} s="Total owed to date" />)}
      <Stat l="Dr. Yonce" v={$$(totDr)} c={K.pu} s="Total owed to date" />
    </div>

    {nextPayout && <Cd style={{ marginBottom: 20, border: `1px solid ${K.ac}33` }}>
      <SH>Next Payout Due: {fD(nextPayout.payoutDate)}</SH>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: K.tm, marginBottom: 12 }}>Activity collected: {$$(nextPayout.total)} from {nextPayout.items.length} payment{nextPayout.items.length !== 1 ? 's' : ''}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {clinics.map(c => (nextPayout.clinicAmts[c.id] || 0) > 0 ? <div key={c.id} style={{ flex: '1 1 150px', padding: '12px 14px', background: K.bg, borderRadius: 8, textAlign: 'center' }}><div style={{ fontSize: 10, color: K.yl, fontWeight: 600, marginBottom: 4 }}>Pay {c.name.split('(')[0].trim()}</div><div style={{ fontSize: 20, fontWeight: 700, color: K.yl, fontFamily: "'DM Mono',monospace" }}>{$$(nextPayout.clinicAmts[c.id])}</div></div> : null)}
          {nextPayout.dr > 0 && <div style={{ flex: '1 1 150px', padding: '12px 14px', background: K.bg, borderRadius: 8, textAlign: 'center' }}><div style={{ fontSize: 10, color: K.pu, fontWeight: 600, marginBottom: 4 }}>Pay Dr. Yonce</div><div style={{ fontSize: 20, fontWeight: 700, color: K.pu, fontFamily: "'DM Mono',monospace" }}>{$$(nextPayout.dr)}</div></div>}
          <div style={{ flex: '1 1 150px', padding: '12px 14px', background: K.bg, borderRadius: 8, textAlign: 'center' }}><div style={{ fontSize: 10, color: K.cy, fontWeight: 600, marginBottom: 4 }}>SNW Retains</div><div style={{ fontSize: 20, fontWeight: 700, color: K.cy, fontFamily: "'DM Mono',monospace" }}>{$$(nextPayout.snw)}</div></div>
        </div>
      </div>
    </Cd>}

    <Cd style={{ marginBottom: 20 }}><SH>Payout Schedule</SH>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><TH>Payout Date</TH><TH>Activity</TH><TH style={{ color: K.cy, textAlign: 'right' }}>SNW</TH>{clinics.map(c => <TH key={c.id} style={{ color: K.yl, textAlign: 'right' }}>{c.name.split('(')[0].trim()}</TH>)}<TH style={{ color: K.pu, textAlign: 'right' }}>Dr. Yonce</TH></tr></thead>
        <tbody>{periods.map((p: any) => { const past = p.payoutDate < today; return <tr key={p.payoutDate} style={{ opacity: past ? 0.5 : 1 }} onMouseEnter={e => (e.currentTarget.style.background = K.sh)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}><TD style={{ fontWeight: 600 }}>{fD(p.payoutDate)}{past && <span style={{ marginLeft: 6, fontSize: 10, color: K.gn }}>paid</span>}</TD><TD m>{$$(p.total)}<span style={{ color: K.tm, fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{p.items.length} pmt{p.items.length !== 1 ? 's' : ''}</span></TD><TD m c={K.cy} style={{ textAlign: 'right' }}>{$$(p.snw)}</TD>{clinics.map(c => <TD key={c.id} m c={(p.clinicAmts[c.id] || 0) > 0 ? K.yl : K.tm} style={{ textAlign: 'right' }}>{(p.clinicAmts[c.id] || 0) > 0 ? $$(p.clinicAmts[c.id]) : '\u2014'}</TD>)}<TD m c={K.pu} style={{ textAlign: 'right' }}>{$$(p.dr)}</TD></tr> })}</tbody>
      </table>
    </Cd>

    <Cd><SH>Monthly Revenue Detail</SH>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><TH>Month</TH><TH>Collected</TH><TH style={{ color: K.cy }}>SNW</TH>{clinics.map(c => <TH key={c.id} style={{ color: K.yl }}>{c.name.split('(')[0].trim()}</TH>)}<TH style={{ color: K.pu }}>Dr.Y</TH></tr></thead>
        <tbody>{data.map((r: any) => [
          <tr key={r.mo} style={{ cursor: 'pointer', background: exp === r.mo ? K.sh : 'transparent' }} onClick={() => setE(exp === r.mo ? null : r.mo)} onMouseEnter={e => { if (exp !== r.mo) e.currentTarget.style.background = K.sh }} onMouseLeave={e => { if (exp !== r.mo) e.currentTarget.style.background = 'transparent' }}>
            <TD style={{ fontWeight: 700, whiteSpace: 'nowrap' }}><span style={{ marginRight: 6, fontSize: 10, color: K.tm }}>{exp === r.mo ? '\u25BE' : '\u25B8'}</span>{fMoL(r.mo)}</TD>
            <TD m>{$$(r.total)}</TD><TD m c={K.cy}>{$$(r.snw)}</TD>
            {clinics.map(c => <TD key={c.id} m c={(r.clinicAmts[c.id] || 0) > 0 ? K.yl : K.tm}>{(r.clinicAmts[c.id] || 0) > 0 ? $$(r.clinicAmts[c.id]) : '\u2014'}</TD>)}
            <TD m c={K.pu}>{$$(r.dr)}</TD>
          </tr>,
          exp === r.mo ? <tr key={r.mo + '-d'}><td colSpan={3 + clinics.length + 1} style={{ padding: 0, border: 'none' }}><div style={{ background: K.bg, padding: '14px 18px', borderBottom: `1px solid ${K.dv}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><TH>Date</TH><TH>Client</TH><TH>Svc</TH><TH>Loc</TH><TH style={{ textAlign: 'right' }}>Amt</TH><TH>Payout</TH></tr></thead>
              <tbody>{r.det.sort((a: any, b: any) => a.d.localeCompare(b.d)).map((d: any, j: number) => <tr key={j}><TD style={{ fontSize: 12 }}>{fD(d.d)}</TD><TD style={{ fontSize: 12, fontWeight: 600 }}>{d.client}</TD><TD style={{ fontSize: 11, color: K.tm }}>{d.svc}</TD><TD><LT loc={d.loc} locs={locs} /></TD><TD m style={{ textAlign: 'right' }}>{$$(d.amt)}</TD><TD style={{ fontSize: 11, color: K.tm }}>{fD(d.payoutDate)}</TD></tr>)}</tbody></table>
          </div></td></tr> : null
        ])}
          <tr style={{ background: 'rgba(255,255,255,0.02)' }}><TD style={{ fontWeight: 700 }}>TOTAL</TD><TD m style={{ fontWeight: 700 }}>{$$(totRev)}</TD><TD m c={K.cy} style={{ fontWeight: 700 }}>{$$(totSnw)}</TD>{clinics.map(c => <TD key={c.id} m c={K.yl} style={{ fontWeight: 700 }}>{$$(totCl[c.id] || 0)}</TD>)}<TD m c={K.pu} style={{ fontWeight: 700 }}>{$$(totDr)}</TD></tr>
        </tbody>
      </table>
    </Cd>
  </div>
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS VIEW
// ═══════════════════════════════════════════════════════════════
function SettingsTab({ locs, clinics, mapSp, setMapSp, clients, agreement, setAgreement, onSaveConfig, onSaveLoc, onDeleteLoc, onSaveClinic }: any) {
  const [modal, setMo] = useState<any>(null); const [form, setF] = useState<any>({}); const [editAgr, setEA] = useState(false)
  const mT = mapSp.snw + mapSp.dr
  const open = (type: string, data: any) => { setMo({ type }); setF(data || {}) }; const close = () => { setMo(null); setF({}) }

  const saveLoc = async () => {
    if (!form.name?.trim() || !form.short?.trim()) return
    await onSaveLoc(modal.type === 'addLoc' ? null : form.id, { name: form.name.trim(), short_code: form.short.trim().toUpperCase(), color: form.color || COLORS[locs.length % COLORS.length], clinic_id: form.clinicId || null })
    close()
  }
  const deleteLoc = async (lid: string) => {
    const n = clients.filter((c: AcctClient) => c.location_id === lid).length
    if (n > 0) { alert(`Cannot delete: ${n} client(s) assigned. Reassign first.`); return }
    await onDeleteLoc(lid); close()
  }
  const saveClinic = async () => {
    if (!form.name?.trim()) return
    const obj = { name: form.name.trim(), contact_name: form.contactName || '', ein: form.ein || '', corp_type: form.corpType || '', has_w9: !!form.hasW9, has_1099: !!form.has1099, address: form.address || '', city: form.city || '', state: form.state || '', zip: form.zip || '', phone: form.phone || '', email: form.email || '', website: form.website || '', notes: form.notes || '', split_snw: form.snw || 26, split_clinic: form.clinic || 55.01, split_dr: form.drY || 18.99 }
    await onSaveClinic(modal.type === 'addClinic' ? null : form.id, obj)
    close()
  }

  const clinicForm = () => {
    const pT = (form.snw || 0) + (form.clinic || 0) + (form.drY || 0); const isCorp = form.corpType === 'ccorp' || form.corpType === 'scorp'
    return <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: K.ac, marginBottom: 12, textTransform: 'uppercase' }}>Business Information</div>
      <Inp label="Business Name" value={form.name || ''} onChange={(v: string) => setF((p: any) => ({ ...p, name: v }))} />
      <Inp label="Primary Contact" value={form.contactName || ''} onChange={(v: string) => setF((p: any) => ({ ...p, contactName: v }))} />
      <Row><Inp half label="EIN" value={form.ein || ''} onChange={(v: string) => setF((p: any) => ({ ...p, ein: v }))} placeholder="XX-XXXXXXX" /><Inp half label="Phone" value={form.phone || ''} onChange={(v: string) => setF((p: any) => ({ ...p, phone: v }))} /></Row>
      <Inp label="Address" value={form.address || ''} onChange={(v: string) => setF((p: any) => ({ ...p, address: v }))} />
      <Row><Inp half label="City" value={form.city || ''} onChange={(v: string) => setF((p: any) => ({ ...p, city: v }))} /><Inp half label="State" value={form.state || ''} onChange={(v: string) => setF((p: any) => ({ ...p, state: v }))} /></Row>
      <Row><Inp half label="Zip" value={form.zip || ''} onChange={(v: string) => setF((p: any) => ({ ...p, zip: v }))} /><Inp half label="Email" value={form.email || ''} onChange={(v: string) => setF((p: any) => ({ ...p, email: v }))} /></Row>
      <Inp label="Website" value={form.website || ''} onChange={(v: string) => setF((p: any) => ({ ...p, website: v }))} />
      <div style={{ fontSize: 11, fontWeight: 600, color: K.ac, marginTop: 16, marginBottom: 12, textTransform: 'uppercase' }}>Entity Type & Compliance</div>
      <Sel label="Corporation Type" value={form.corpType || ''} onChange={(v: string) => setF((p: any) => ({ ...p, corpType: v }))} options={[{ v: '', l: 'Select...' }, { v: 'sole', l: 'Sole Proprietor' }, { v: 'llc', l: 'LLC' }, { v: 'partnership', l: 'Partnership' }, { v: 'scorp', l: 'S-Corp' }, { v: 'ccorp', l: 'C-Corp' }]} />
      {!isCorp && <div style={{ padding: '10px 14px', background: K.bg, borderRadius: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: K.or, marginBottom: 8 }}>Non C-Corp entities require a signed W-9 and will receive a 1099.</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 6 }}><input type="checkbox" checked={!!form.hasW9} onChange={e => setF((p: any) => ({ ...p, hasW9: e.target.checked }))} /> W-9 on file</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={!!form.has1099} onChange={e => setF((p: any) => ({ ...p, has1099: e.target.checked }))} /> 1099 issued</label>
      </div>}
      <div style={{ fontSize: 11, fontWeight: 600, color: K.ac, marginTop: 16, marginBottom: 12, textTransform: 'uppercase' }}>Program Revenue Splits</div>
      <NI l="SNW" v={form.snw || 0} on={(v: number) => setF((p: any) => ({ ...p, snw: v }))} /><NI l="Clinic" v={form.clinic || 0} on={(v: number) => setF((p: any) => ({ ...p, clinic: v }))} /><NI l="Dr. Yonce" v={form.drY || 0} on={(v: number) => setF((p: any) => ({ ...p, drY: v }))} />
      <div style={{ fontSize: 11, color: Math.abs(pT - 100) < 0.1 ? K.gn : K.rd, marginTop: 4, fontWeight: 600 }}>Total: {pT.toFixed(2)}%{Math.abs(pT - 100) >= 0.1 && ' (should be 100%)'}</div>
      <Inp label="Notes" value={form.notes || ''} onChange={(v: string) => setF((p: any) => ({ ...p, notes: v }))} style={{ marginTop: 12 }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}><Btn outline onClick={close}>Cancel</Btn><Btn onClick={saveClinic} disabled={!form.name?.trim()}>Save</Btn></div>
    </div>
  }

  const locForm = () => <div>
    <Inp label="Name" value={form.name || ''} onChange={(v: string) => setF((p: any) => ({ ...p, name: v }))} placeholder="e.g. Greenville" />
    <Inp label="Short Code" value={form.short || ''} onChange={(v: string) => setF((p: any) => ({ ...p, short: v.toUpperCase() }))} placeholder="e.g. GVL" />
    <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10.5, fontWeight: 600, color: K.tm, marginBottom: 4, textTransform: 'uppercase' }}>Color</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{COLORS.map(c => <div key={c} onClick={() => setF((p: any) => ({ ...p, color: c }))} style={{ width: 28, height: 28, borderRadius: 6, background: c, cursor: 'pointer', border: (form.color || COLORS[0]) === c ? '3px solid white' : '3px solid transparent' }} />)}</div></div>
    <Sel label="Assigned Clinic" value={form.clinicId || ''} onChange={(v: string) => setF((p: any) => ({ ...p, clinicId: v }))} options={[{ v: '', l: 'No clinic (clinic share goes to SNW)' }, ...clinics.map((c: AcctClinic) => ({ v: c.id, l: c.name }))]} />
    <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}><Btn outline onClick={close}>Cancel</Btn><Btn onClick={saveLoc} disabled={!form.name?.trim() || !form.short?.trim()}>{modal?.type === 'addLoc' ? 'Add' : 'Save'}</Btn></div>
  </div>

  return <div>
    <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>Settings</h2>
    <Cd style={{ marginBottom: 20 }}><SH right={<Btn small outline onClick={() => { if (editAgr) onSaveConfig(); setEA(!editAgr) }}>{editAgr ? 'Done' : 'Edit'}</Btn>}>Payout Agreement</SH>
      <div style={{ padding: 16 }}>{editAgr ? <textarea value={agreement} onChange={e => setAgreement(e.target.value)} style={{ width: '100%', minHeight: 200, padding: 14, borderRadius: 8, border: `1px solid ${K.cb}`, background: K.bg, color: K.tx, fontSize: 12, fontFamily: "'DM Mono',monospace", lineHeight: 1.6, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} /> : <pre style={{ fontSize: 12, color: K.tm, fontFamily: "'DM Mono',monospace", lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{agreement}</pre>}</div>
    </Cd>
    <Cd style={{ marginBottom: 20 }}><SH>Map Splits (Global)</SH><div style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: K.tm, marginBottom: 10 }}>Maps always split between SNW and Dr. Yonce only.</div>
      <NI l="SNW" v={mapSp.snw} on={(v: number) => setMapSp({ ...mapSp, snw: v })} /><NI l="Dr. Yonce" v={mapSp.dr} on={(v: number) => setMapSp({ ...mapSp, dr: v })} />
      <div style={{ fontSize: 11, color: mT === 100 ? K.gn : K.rd, marginTop: 4, fontWeight: 600 }}>Total: {mT}%</div>
      <div style={{ marginTop: 8 }}><Btn small onClick={onSaveConfig}>Save Splits</Btn></div>
    </div></Cd>
    <Cd style={{ marginBottom: 20 }}><SH>Clinic Entities<Btn small onClick={() => open('addClinic', { snw: 26, clinic: 55.01, drY: 18.99 })}>+ Create Clinic</Btn></SH>
      {clinics.map((cl: AcctClinic) => {
        const pT = cl.split_snw + cl.split_clinic + cl.split_dr; const locsUsing = locs.filter((l: AcctLocation) => l.clinic_id === cl.id); const isCorp = cl.corp_type === 'ccorp' || cl.corp_type === 'scorp'
        return <div key={cl.id} style={{ padding: '16px 18px', borderBottom: `1px solid ${K.dv}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div><div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{cl.name}{cl.contact_name && <span style={{ fontWeight: 400, color: K.tm }}> ({cl.contact_name})</span>}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{cl.ein && <Tag color={K.cy}>EIN: {cl.ein}</Tag>}{cl.corp_type && <Tag color={K.pu}>{cl.corp_type === 'sole' ? 'Sole Prop' : cl.corp_type === 'llc' ? 'LLC' : cl.corp_type === 'scorp' ? 'S-Corp' : cl.corp_type === 'ccorp' ? 'C-Corp' : 'Partnership'}</Tag>}{!isCorp && (cl.has_w9 ? <Tag color={K.gn}>W-9</Tag> : <Tag color={K.rd}>W-9 needed</Tag>)}</div>
              {(cl.address || cl.city) && <div style={{ fontSize: 11, color: K.tm, marginTop: 3 }}>{[cl.address, cl.city, cl.state, cl.zip].filter(Boolean).join(', ')}</div>}
              {(cl.phone || cl.email) && <div style={{ fontSize: 11, color: K.tm, marginTop: 2 }}>{[cl.phone, cl.email, cl.website].filter(Boolean).join(' | ')}</div>}
              <div style={{ fontSize: 12, marginTop: 4 }}><span style={{ color: K.cy }}>SNW {cl.split_snw}%</span> / <span style={{ color: K.yl }}>Clinic {cl.split_clinic}%</span> / <span style={{ color: K.pu }}>Dr.Y {cl.split_dr}%</span></div>
              <div style={{ fontSize: 11, color: K.tm, marginTop: 2 }}>Locations: {locsUsing.length > 0 ? locsUsing.map((l: AcctLocation) => l.name).join(', ') : <span style={{ color: K.or }}>None</span>}</div>
            </div>
            <Btn small outline onClick={() => open('editClinic', { ...cl, contactName: cl.contact_name, corpType: cl.corp_type, hasW9: cl.has_w9, has1099: cl.has_1099, snw: cl.split_snw, clinic: cl.split_clinic, drY: cl.split_dr, clinicId: cl.id })}>Edit</Btn>
          </div>
        </div>
      })}
    </Cd>
    <Cd><SH>Locations<Btn small onClick={() => open('addLoc', { color: COLORS[locs.length % COLORS.length] })}>+ Add Location</Btn></SH>
      {locs.map((loc: AcctLocation) => { const cl = loc.clinic_id ? clinics.find((c: AcctClinic) => c.id === loc.clinic_id) : null; const n = clients.filter((c: AcctClient) => c.location_id === loc.id).length
        return <div key={loc.id} style={{ padding: '14px 18px', borderBottom: `1px solid ${K.dv}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: loc.color, flexShrink: 0 }} /><div><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontWeight: 700 }}>{loc.name}</span><span style={{ fontSize: 11, color: K.tm, padding: '2px 6px', background: K.bg, borderRadius: 4 }}>{loc.short_code}</span><span style={{ fontSize: 11, color: K.tm }}>{n} client{n !== 1 ? 's' : ''}</span></div><div style={{ fontSize: 11, color: cl ? K.gn : K.or, marginTop: 2 }}>{cl ? `Clinic: ${cl.name}` : 'No clinic'}</div></div></div>
          <div style={{ display: 'flex', gap: 6 }}><Btn small outline onClick={() => open('editLoc', { ...loc, short: loc.short_code, clinicId: loc.clinic_id })}>Edit</Btn><Btn small outline color={K.rd} onClick={() => deleteLoc(loc.id)}>Delete</Btn></div>
        </div>
      })}
    </Cd>
    {modal?.type === 'addLoc' && <Modal title="Add Location" onClose={close}>{locForm()}</Modal>}
    {modal?.type === 'editLoc' && <Modal title="Edit Location" onClose={close}>{locForm()}</Modal>}
    {modal?.type === 'addClinic' && <Modal title="Create Clinic" onClose={close} wide>{clinicForm()}</Modal>}
    {modal?.type === 'editClinic' && <Modal title="Edit Clinic" onClose={close} wide>{clinicForm()}</Modal>}
  </div>
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function AccountingPage() {
  const { currentOrg } = useWorkspace()
  const supabase = createClient()

  const [clients, setClients] = useState<AcctClient[]>([])
  const [locs, setLocs] = useState<AcctLocation[]>([])
  const [clinics, setClinics] = useState<AcctClinic[]>([])
  const [config, setConfig] = useState<AcctConfig>({ map_splits: { snw: 23, dr: 77 }, default_map_price: 600, default_program_price: 5400, payout_agreement: '' })
  const [loading, setLoading] = useState(true)
  const [vw, sV] = useState('dash')
  const [sel, sS] = useState<string | null>(null)
  const [q, sQ] = useState('')
  const [showAC, setSAC] = useState(false)
  const [nc, setNC] = useState({ nm: '', loc: '' })

  const orgId = currentOrg?.id

  // ─── Load all data ───────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [locsRes, clinicsRes, clientsRes, svcsRes, pmtsRes, cfgRes] = await Promise.all([
        supabase.from('acct_locations').select('*').eq('org_id', orgId),
        supabase.from('acct_clinics').select('*').eq('org_id', orgId),
        supabase.from('acct_clients').select('*').eq('org_id', orgId).order('name'),
        supabase.from('acct_services').select('*').eq('org_id', orgId),
        supabase.from('acct_payments').select('*').eq('org_id', orgId).order('payment_date'),
        supabase.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'acct_config').maybeSingle(),
      ])

      setLocs(locsRes.data || [])
      setClinics(clinicsRes.data || [])
      if (cfgRes.data?.setting_value) setConfig(cfgRes.data.setting_value)

      // Assemble clients with nested services and payments
      const svcs = svcsRes.data || []
      const pmts = pmtsRes.data || []
      const assembled = (clientsRes.data || []).map((c: any) => ({
        ...c,
        services: svcs.filter((s: any) => s.client_id === c.id).map((s: any) => ({
          ...s,
          payments: pmts.filter((p: any) => p.service_id === s.id),
        })),
      }))
      setClients(assembled)
    } catch (e) { console.error('Failed to load accounting data', e) }
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  // ─── Mutations ───────────────────────────────────────────
  const addClient = async () => {
    if (!nc.nm.trim() || !nc.loc || !orgId) return
    await supabase.from('acct_clients').insert({ org_id: orgId, name: nc.nm.trim(), location_id: nc.loc })
    setSAC(false); setNC({ nm: '', loc: '' }); loadData()
  }

  const addService = async (clientId: string, svc: any) => {
    if (!orgId) return
    await supabase.from('acct_services').insert({ org_id: orgId, client_id: clientId, ...svc })
    loadData()
  }

  const addPayment = async (clientId: string, serviceId: string, pmt: any) => {
    if (!orgId) return
    await supabase.from('acct_payments').insert({ org_id: orgId, service_id: serviceId, client_id: clientId, ...pmt })
    loadData()
  }

  const saveConfig = async () => {
    if (!orgId) return
    await supabase.from('org_settings').upsert({ org_id: orgId, setting_key: 'acct_config', setting_value: config }, { onConflict: 'org_id,setting_key' })
  }

  const saveLoc = async (id: string | null, data: any) => {
    if (!orgId) return
    if (id) {
      await supabase.from('acct_locations').update(data).eq('id', id)
    } else {
      await supabase.from('acct_locations').insert({ id: data.short_code, org_id: orgId, ...data })
    }
    loadData()
  }

  const deleteLoc = async (id: string) => {
    await supabase.from('acct_locations').delete().eq('id', id)
    loadData()
  }

  const saveClinic = async (id: string | null, data: any) => {
    if (!orgId) return
    if (id) {
      await supabase.from('acct_clinics').update(data).eq('id', id)
    } else {
      await supabase.from('acct_clinics').insert({ id: `clinic-${Date.now()}`, org_id: orgId, ...data })
    }
    loadData()
  }

  // ─── Derived ─────────────────────────────────────────────
  const fl = clients.filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
  const ac = clients.find(c => c.id === sel)
  const mapSp = config.map_splits

  if (loading) return <div style={{ minHeight: '100vh', background: K.bg, color: K.tx, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif" }}>
    <div style={{ textAlign: 'center' }}><div style={{ fontSize: 14, color: K.tm }}>Loading accounting data...</div></div>
  </div>

  return <div style={{ minHeight: '100vh', background: `linear-gradient(180deg,${K.bg} 0%,#0b0b12 100%)`, color: K.tx, fontFamily: "'DM Sans','Segoe UI',sans-serif", fontSize: 13, marginLeft: -24, marginTop: -20, marginRight: -24, marginBottom: -20 }}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');input[type=number]::-webkit-inner-spin-button{opacity:1}select{appearance:auto}input[type=checkbox]{accent-color:${K.ac}}`}</style>
    <div style={{ padding: '18px 24px 12px', borderBottom: `1px solid ${K.dv}`, background: `linear-gradient(180deg,rgba(124,107,240,0.03) 0%,transparent 100%)` }}><h1 style={{ fontSize: 18, fontWeight: 700 }}>Sensorium Neuro Wellness</h1><div style={{ fontSize: 12, color: K.tm, marginTop: 2 }}>Satellite Office Accounting</div></div>
    <div style={{ display: 'flex', height: 'calc(100vh - 68px)' }}>
      <div style={{ width: 255, minWidth: 255, borderRight: `1px solid ${K.dv}`, overflowY: 'auto', background: K.sf, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px 6px' }}><input placeholder="Search..." value={q} onChange={e => sQ(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: `1px solid ${K.cb}`, background: K.bg, color: K.tx, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} /></div>
        <div style={{ padding: '4px 8px 2px' }}>{[{ k: 'dash', i: '\u25EB', l: 'Dashboard' }, { k: 'recon', i: '\u2261', l: 'Reconciliation' }, { k: 'settings', i: '\u2699', l: 'Settings' }].map(n => <div key={n.k} onClick={() => { sV(n.k); sS(null) }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', cursor: 'pointer', borderRadius: 7, marginBottom: 2, background: vw === n.k && !sel ? K.ag : 'transparent', borderLeft: `2px solid ${vw === n.k && !sel ? K.ac : 'transparent'}` }} onMouseEnter={e => { if (!(vw === n.k && !sel)) e.currentTarget.style.background = K.sh }} onMouseLeave={e => { if (!(vw === n.k && !sel)) e.currentTarget.style.background = 'transparent' }}><span style={{ fontSize: 14, color: K.ac, width: 18, textAlign: 'center' }}>{n.i}</span><span style={{ fontSize: 12, fontWeight: 600, color: vw === n.k && !sel ? K.tx : K.tm }}>{n.l}</span></div>)}</div>
        <div style={{ padding: '8px 12px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: K.tm }}>Accounts ({fl.length})</span><button onClick={() => { setSAC(true); setNC({ nm: '', loc: locs[0]?.id || '' }) }} style={{ fontSize: 11, color: K.ac, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>+ Add</button></div>
        <div style={{ flex: 1, overflowY: 'auto' }}>{fl.map(c => {
          const s = getStatus(c); const t = c.services.reduce((s2, v) => s2 + v.payments.reduce((p, x) => p + x.amount, 0), 0); const lo = locs.find(l => l.id === c.location_id)
          return <div key={c.id} onClick={() => { sS(c.id); sV('dash') }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', cursor: 'pointer', borderLeft: `2px solid ${sel === c.id ? K.ac : 'transparent'}`, background: sel === c.id ? K.ag : 'transparent' }} onMouseEnter={e => { if (sel !== c.id) e.currentTarget.style.background = K.sh }} onMouseLeave={e => { if (sel !== c.id) e.currentTarget.style.background = 'transparent' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, background: `${lo?.color || K.ac}18`, color: lo?.color || K.ac, flexShrink: 0 }}>{gI(c.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{c.name}</div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 10.5, color: K.tm }}>{$$(t)}</span><div style={{ display: 'flex', gap: 3 }}><div style={{ width: 5, height: 5, borderRadius: '50%', background: lo?.color || K.tm }} /><div style={{ width: 5, height: 5, borderRadius: '50%', background: SB[s]?.t || K.tm }} /></div></div></div>
          </div>
        })}</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {ac ? <Det cl={ac} locs={locs} clinics={clinics} mapSp={mapSp} onBack={() => sS(null)} onAddSvc={addService} onAddPmt={addPayment} />
          : vw === 'recon' ? <ReconTab clients={clients} locs={locs} clinics={clinics} mapSp={mapSp} />
            : vw === 'settings' ? <SettingsTab locs={locs} clinics={clinics} mapSp={mapSp} setMapSp={(v: any) => setConfig(p => ({ ...p, map_splits: v }))} clients={clients} agreement={config.payout_agreement} setAgreement={(v: string) => setConfig(p => ({ ...p, payout_agreement: v }))} onSaveConfig={saveConfig} onSaveLoc={saveLoc} onDeleteLoc={deleteLoc} onSaveClinic={saveClinic} />
              : <Ov clients={clients} locs={locs} onSel={id => { sS(id); sV('dash') }} onAdd={() => { setSAC(true); setNC({ nm: '', loc: locs[0]?.id || '' }) }} />}
      </div>
    </div>
    {showAC && <Modal title="Add Client" onClose={() => setSAC(false)}><Inp label="Name" value={nc.nm} onChange={(v: string) => setNC(p => ({ ...p, nm: v }))} placeholder="First and Last Name" /><Sel label="Location" value={nc.loc} onChange={(v: string) => setNC(p => ({ ...p, loc: v }))} options={locs.map(l => ({ v: l.id, l: l.name }))} /><div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}><Btn outline onClick={() => setSAC(false)}>Cancel</Btn><Btn onClick={addClient} disabled={!nc.nm.trim() || !nc.loc}>Add Client</Btn></div></Modal>}
  </div>
}
