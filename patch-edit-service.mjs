// patch-edit-service.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');
let patches = 0;

function patch(label, old, rep) {
  if (code.includes(old)) {
    code = code.replace(old, rep);
    patches++;
    console.log('  + ' + label);
  } else {
    console.log('  SKIP: ' + label);
  }
}

console.log('=== Patch: Edit Service + $3,395 cap ===\n');

// 1. Add editService function after addService
patch('Add editService function',
  "const addService=async(cid:string,svc:any)=>{if(!orgId)return;await supabase.from('acct_services').insert({org_id:orgId,client_id:cid,...svc});loadData()}",
  "const addService=async(cid:string,svc:any)=>{if(!orgId)return;await supabase.from('acct_services').insert({org_id:orgId,client_id:cid,...svc});loadData()}\n  const editService=async(svcId:string,data:any)=>{if(!orgId)return;await supabase.from('acct_services').update(data).eq('id',svcId);loadData()}"
);

// 2. Wire onEditSvc into DetView render call
patch('Wire onEditSvc into render',
  "onAddSvc={addService} onAddPmt={addPayment} onEditPmt={editPayment} onDeletePmt={deletePayment}",
  "onAddSvc={addService} onEditSvc={editService} onAddPmt={addPayment} onEditPmt={editPayment} onDeletePmt={deletePayment}"
);

// 3. Add onEditSvc to DetView props
patch('DetView props',
  "function DetView({cl,locs,clinics,cfg,onBack,onAddSvc,onAddPmt,onEditPmt,onDeletePmt}:any) {",
  "function DetView({cl,locs,clinics,cfg,onBack,onAddSvc,onEditSvc,onAddPmt,onEditPmt,onDeletePmt}:any) {"
);

// 4. Add edit state for services - after the sf state line
patch('Add edit service state',
  "const [sf,setSF]=useState({t:'Map',a:'600',d:td(),n:''})",
  "const [sf,setSF]=useState({t:'Map',a:'600',d:td(),n:''})\n  const [editingSvc,setEditingSvc]=useState<string|null>(null)\n  const [esSF,setEsSF]=useState({a:'',d:'',n:''})"
);

// 5. Replace the service card header to include edit button and inline edit form
// Find the service card header line
const oldHeader = "<div className=\"flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50\"><h4 className=\"text-xs font-bold text-np-dark\">{sv.service_type==='Map'?'Initial Map':'Neuro Program'}</h4><span className=\"text-xs font-bold text-np-dark\" style={{fontFeatureSettings:'\"tnum\"'}}>{$$(sv.amount)}</span></div>";

const newHeader = `<div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50"><div className="flex items-center gap-2"><h4 className="text-xs font-bold text-np-dark">{sv.service_type==='Map'?'Initial Map':'Neuro Program'}</h4><button onClick={()=>{setEditingSvc(editingSvc===sv.id?null:sv.id);setEsSF({a:String(sv.amount),d:sv.service_date,n:sv.notes||''})}} className="p-0.5 rounded hover:bg-np-blue/10" title="Edit service"><Pencil className="w-3 h-3 text-gray-300 hover:text-np-blue"/></button></div><span className="text-xs font-bold text-np-dark" style={{fontFeatureSettings:'"tnum"'}}>{$$(sv.amount)}</span></div>
        {editingSvc===sv.id&&<div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100 space-y-2">
          <div className="flex gap-2 items-end flex-wrap">
            <div><label className="block text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Total Price</label><input type="number" step="0.01" value={esSF.a} onChange={e=>setEsSF(p=>({...p,a:e.target.value}))} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-28 focus:outline-none focus:ring-1 focus:ring-np-blue/30" placeholder="e.g. 5400"/></div>
            <div><label className="block text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Service Date</label><input type="date" value={esSF.d} onChange={e=>setEsSF(p=>({...p,d:e.target.value}))} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30"/></div>
            <div className="flex-1"><label className="block text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Notes</label><input value={esSF.n} onChange={e=>setEsSF(p=>({...p,n:e.target.value}))} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-np-blue/30" placeholder="Optional notes"/></div>
            <button onClick={async()=>{const a=parseFloat(esSF.a)||0;if(a<=0)return;await onEditSvc(sv.id,{amount:a,service_date:esSF.d,notes:esSF.n});setEditingSvc(null)}} className="px-3 py-1.5 text-[10px] font-semibold bg-np-blue text-white rounded-lg hover:bg-np-blue/90">Save</button>
            <button onClick={()=>setEditingSvc(null)} className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          </div>
          <SplitPrev amt={parseFloat(esSF.a)||0} svcType={sv.service_type} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg} serviceTotal={parseFloat(esSF.a)||0} serviceStartDate={esSF.d}/>
        </div>}`;

if (code.includes(oldHeader)) {
  code = code.replace(oldHeader, newHeader);
  patches++;
  console.log('  + Service card header with edit form');
} else {
  console.log('  SKIP: service card header not found');
  // Try to find partial
  const partial = "sv.service_type==='Map'?'Initial Map':'Neuro Program'";
  console.log('  Partial match: ' + (code.includes(partial) ? 'YES at ' + code.indexOf(partial) : 'NO'));
}

// 6. Update $3995 comment to $3395
patch('Cap comment 3995 -> 3395',
  "// Clinic flat target ($3995) distributed PROPORTIONALLY",
  "// Clinic flat target ($3395) distributed PROPORTIONALLY"
);

// Verify
writeFileSync(FILE, code, 'utf-8');

let depth = 0;
for (const ch of code) { if (ch === '{') depth++; if (ch === '}') depth--; }
console.log('\n  Brace balance: ' + depth + (depth === 0 ? ' OK' : ' MISMATCH'));
console.log('  editService fn: ' + (code.includes("const editService=async") ? 'OK' : 'MISSING'));
console.log('  onEditSvc prop: ' + (code.includes('onEditSvc') ? 'OK' : 'MISSING'));
console.log('  editingSvc state: ' + (code.includes('editingSvc') ? 'OK' : 'MISSING'));
console.log('  $3395 comment: ' + (code.includes('$3395') ? 'OK' : 'MISSING'));
console.log('  SplitPrev in edit: ' + (code.includes("SplitPrev amt={parseFloat(esSF.a)") ? 'OK' : 'MISSING'));

console.log('\n=== Done: ' + patches + ' patches ===');
console.log('\nIMPORTANT: You also need to update flat_clinic in Supabase:');
console.log('  UPDATE acct_clinics SET flat_clinic = 3395 WHERE flat_clinic = 3995;');
