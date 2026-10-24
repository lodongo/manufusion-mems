import {useEffect,useMemo,useState} from 'react';
import {Plus,Save,Trash2,ShieldCheck} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import {
  MODEL_LABELS,defaultCorporateStructure,
  type OperatingModel,type ModelOverride,type CorporateHomeAssignment,
  type CorporateStructureConfig,type StructureReferences,
} from '../../backend/corporateStructure';

const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const emptyRefs:StructureReferences={nodes:[],functions:[],positions:[]};
const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
const blankAssignment=(subjectType:'function'|'position',subjectCode:string):CorporateHomeAssignment=>({
 id:uid(),subjectType,subjectCode,operatingNodeIds:[],reportingFunctionCode:'',
 employingLegalEntityId:'',administrativeNodeId:'',payrollLegalEntityId:'',payingLegalEntityId:'',
 financialLegalEntityId:'',financialCostCenterId:'',budgetLegalEntityId:'',budgetCostCenterId:'',
 fundingLegalEntityId:'',beneficiaries:[],effectiveFrom:'',effectiveTo:'',rationale:'',
});
const blankOverride=():ModelOverride=>({
 id:uid(),scope:'legal_entity',legalEntityId:'',functionCode:'',
 model:'HYB',effectiveFrom:'',effectiveTo:'',
});
export default function CorporateStructureMappingPage({canEdit}:{canEdit:boolean}){
 const [config,setConfig]=useState<CorporateStructureConfig|null>(null);
 const [refs,setRefs]=useState<StructureReferences>(emptyRefs);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [newSubjectType,setNewSubjectType]=useState<'function'|'position'>('function');
 const [newSubjectCode,setNewSubjectCode]=useState('');
 const [expanded,setExpanded]=useState('');
 const entities=useMemo(()=>refs.nodes.filter(n=>n.level==='legal_entity'&&n.status!=='inactive'),[refs]);
 const activeNodes=useMemo(()=>refs.nodes.filter(n=>n.status!=='inactive'),[refs]);
 const centres=useMemo(()=>activeNodes.filter(n=>n.level==='cost_center'),[activeNodes]);
 const functionOptions=useMemo(()=>refs.functions.filter(f=>f.enabled),[refs]);
 const subjects=newSubjectType==='function'
   ?functionOptions.map(f=>({code:f.code,name:f.name}))
   :refs.positions;
 const owningEntity=(id:string)=>{
   const visited=new Set<string>();
   const byId=new Map(activeNodes.map(n=>[n.id,n]));
   while(id&&!visited.has(id)){
     visited.add(id);const n=byId.get(id);
     if(!n)return '';
     if(n.level==='legal_entity')return n.id;
     id=n.parentId;
   }
   return '';
 };
 const load=async()=>{
   setLoading(true);setError('');
   try{
     const r=await callBackend<{config:CorporateStructureConfig;references:StructureReferences}>('/api/org/corporate/structure/read');
     setConfig(r.config);setRefs(r.references);
   }catch(e){setError(e instanceof Error?e.message:'Cannot load corporate mappings.')}
   finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const edit=(fn:(x:CorporateStructureConfig)=>CorporateStructureConfig)=>setConfig(x=>x?fn(x):x);
 const updateAssignment=(id:string,patch:Partial<CorporateHomeAssignment>)=>
   edit(x=>({...x,assignments:x.assignments.map(a=>a.id===id?{...a,...patch}:a)}));
 const updateOverride=(id:string,patch:Partial<ModelOverride>)=>
   edit(x=>({...x,overrides:x.overrides.map(o=>o.id===id?{...o,...patch}:o)}));
 const save=async()=>{
   if(!config||busy||!canEdit)return;
   setBusy(true);setError('');setNotice('');
   try{
     const r=await callBackend<{config:CorporateStructureConfig;note:string}>('/api/org/corporate/structure/save',
       {config,expectedVersion:config.version});
     setConfig(r.config);setNotice(r.note);
   }catch(e){setError(e instanceof Error?e.message:'Corporate mappings could not be saved.');}
   finally{setBusy(false)}
 };
 const entitySelector=(id:string,label:string,value:string,change:(v:string)=>void)=>
   <SelectField id={id} label={label} value={value} disabled={!canEdit} onChange={e=>change(e.target.value)}>
     <option value="">Not assigned — draft</option>
     {entities.map(e=><option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}
   </SelectField>;
 const centreSelector=(id:string,label:string,value:string,legalEntityId:string,change:(v:string)=>void)=>
   <SelectField id={id} label={label} value={value} disabled={!canEdit||!legalEntityId} onChange={e=>change(e.target.value)}>
     <option value="">Not assigned — draft</option>
     {centres.filter(c=>owningEntity(c.id)===legalEntityId).map(c=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
   </SelectField>;
 return <div className="min-w-0 space-y-4">
  <section className="rounded-2xl border border-line bg-panel p-4 space-y-2">
    <h3 className="text-lg font-bold">Operating models & independent homes</h3>
    <p className="text-sm text-muted">Configure different governance, employment, administration, payroll, financial and budget homes without modifying the existing legal-entity hierarchy. Draft records do not grant access or post transactions.</p>
    <p className="text-xs font-semibold text-brand">Phase P1 — configuration draft only</p>
  </section>
  {loading&&<p role="status">Loading corporate model configuration…</p>}
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {config&&<>
   <section className="rounded-xl border border-line bg-panel p-3 space-y-3">
     <SelectField id="cor-model-default" label="Tenant default organizational model"
       value={config.defaultModel} disabled={!canEdit}
       onChange={e=>edit(c=>({...c,defaultModel:e.target.value as OperatingModel}))}>
       {MODEL_LABELS.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
     </SelectField>
     <p className="text-xs text-muted">Override order: function + entity, then function, then entity, then tenant default. Overrides are effective-dated, and never grant user privileges.</p>
     <div className="flex items-center justify-between gap-2"><h4 className="font-semibold">Operating model overrides</h4>
      {canEdit&&<button type="button" className={btn} onClick={()=>edit(c=>({...c,overrides:[...c.overrides,blankOverride()]}))}>
       <Plus className="inline h-4 w-4"/> Add
      </button>}
     </div>
     {config.overrides.map((o,i)=><section key={o.id} className="rounded-xl border border-line bg-page p-3 space-y-3">
       <div className="flex items-center justify-between gap-2"><strong className="text-sm">Override {i+1}</strong>
        {canEdit&&<button type="button" className={btn} aria-label="Remove override" onClick={()=>edit(c=>({...c,overrides:c.overrides.filter(x=>x.id!==o.id)}))}><Trash2 className="h-4 w-4"/></button>}
       </div>
       <SelectField id={'ov-scope-'+o.id} label="Scope" value={o.scope} disabled={!canEdit}
        onChange={e=>updateOverride(o.id,{scope:e.target.value as ModelOverride['scope'],legalEntityId:'',functionCode:''})}>
        <option value="legal_entity">Legal entity</option><option value="function">Corporate function</option>
        <option value="function_entity">Function + legal entity</option>
       </SelectField>
       {o.scope!=='function'&&entitySelector('ov-le-'+o.id,'Legal entity',o.legalEntityId,v=>updateOverride(o.id,{legalEntityId:v}))}
       {o.scope!=='legal_entity'&&<SelectField id={'ov-fn-'+o.id} label="Corporate function" disabled={!canEdit} value={o.functionCode} onChange={e=>updateOverride(o.id,{functionCode:e.target.value})}>
        <option value="">Choose function</option>{functionOptions.map(f=><option key={f.code} value={f.code}>{f.name}</option>)}
       </SelectField>}
       <SelectField id={'ov-model-'+o.id} label="Operating model" value={o.model} disabled={!canEdit}
         onChange={e=>updateOverride(o.id,{model:e.target.value as OperatingModel})}>
         {MODEL_LABELS.map(m=><option key={m.code} value={m.code}>{m.label}</option>)}
       </SelectField>
       <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm text-muted">Effective from<input type="date" className={field} disabled={!canEdit} value={o.effectiveFrom} onChange={e=>updateOverride(o.id,{effectiveFrom:e.target.value})}/></label>
        <label className="text-sm text-muted">Effective to<input type="date" className={field} disabled={!canEdit} value={o.effectiveTo} onChange={e=>updateOverride(o.id,{effectiveTo:e.target.value})}/></label>
       </div>
     </section>)}
   </section>
   <section className="rounded-xl border border-line bg-panel p-3 space-y-3">
     <h4 className="font-semibold">Function and position administrative mappings</h4>
     <p className="text-xs text-muted">An oversight assignment does not establish an employment contract, job grade, security role or payroll transaction. These homes are independent planning references.</p>
     <div className="grid gap-2 sm:grid-cols-3">
       <SelectField id="home-subject-type" label="Mapping subject" disabled={!canEdit} value={newSubjectType}
        onChange={e=>{setNewSubjectType(e.target.value as 'function'|'position');setNewSubjectCode('')}}>
        <option value="function">Corporate function</option><option value="position">Job role / position</option>
       </SelectField>
       <SelectField id="home-subject" label="Select subject" disabled={!canEdit} value={newSubjectCode} onChange={e=>setNewSubjectCode(e.target.value)}>
        <option value="">Select</option>{subjects.map(s=><option key={s.code} value={s.code}>{s.name}</option>)}
       </SelectField>
       <div className="flex items-end">
        <button type="button" className={btn+' w-full'} disabled={!canEdit||!newSubjectCode}
         onClick={()=>{const a=blankAssignment(newSubjectType,newSubjectCode);edit(c=>({...c,assignments:[...c.assignments,a]}));setExpanded(a.id);setNewSubjectCode('')}}>
          <Plus className="mr-1 inline h-4 w-4"/> Add mapping
        </button>
       </div>
     </div>
     {config.assignments.map(a=><section key={a.id} className="rounded-xl border border-line bg-page">
       <button type="button" className="min-h-12 w-full px-3 py-2 text-left flex justify-between items-center gap-2"
        aria-expanded={expanded===a.id} onClick={()=>setExpanded(expanded===a.id?'':a.id)}>
        <span className="text-sm font-semibold break-words">{a.subjectType==='function'?'Function':'Position'}: {a.subjectCode}</span>
        <span className="text-xs text-muted">{expanded===a.id?'Collapse':'Configure'}</span>
       </button>
       {expanded===a.id&&<div className="border-t border-line p-3 space-y-3">
        <SelectField id={'home-report-'+a.id} label="Reporting corporate function" value={a.reportingFunctionCode} disabled={!canEdit}
         onChange={e=>updateAssignment(a.id,{reportingFunctionCode:e.target.value})}>
         <option value="">Corporate office / unspecified</option>
         {functionOptions.filter(f=>a.subjectType!=='function'||f.code!==a.subjectCode).map(f=><option key={f.code} value={f.code}>{f.name}</option>)}
        </SelectField>
        <div className="grid gap-2 sm:grid-cols-2">
         {entitySelector('home-emp-'+a.id,'Legal employing entity',a.employingLegalEntityId,v=>updateAssignment(a.id,{employingLegalEntityId:v}))}
         <SelectField id={'home-adm-'+a.id} label="HR / administrative unit" disabled={!canEdit} value={a.administrativeNodeId} onChange={e=>updateAssignment(a.id,{administrativeNodeId:e.target.value})}>
          <option value="">Not assigned</option>{activeNodes.map(n=><option key={n.id} value={n.id}>{n.name} ({n.level})</option>)}
         </SelectField>
         {entitySelector('home-pay-'+a.id,'Payroll legal entity',a.payrollLegalEntityId,v=>updateAssignment(a.id,{payrollLegalEntityId:v}))}
         {entitySelector('home-payer-'+a.id,'Cash-paying legal entity',a.payingLegalEntityId,v=>updateAssignment(a.id,{payingLegalEntityId:v}))}
         {entitySelector('home-fin-'+a.id,'Financial posting legal entity',a.financialLegalEntityId,v=>updateAssignment(a.id,{financialLegalEntityId:v,financialCostCenterId:''}))}
         {centreSelector('home-fincc-'+a.id,'Financial cost centre',a.financialCostCenterId,a.financialLegalEntityId,v=>updateAssignment(a.id,{financialCostCenterId:v}))}
         {entitySelector('home-bud-'+a.id,'Budget owner legal entity',a.budgetLegalEntityId,v=>updateAssignment(a.id,{budgetLegalEntityId:v,budgetCostCenterId:''}))}
         {centreSelector('home-budcc-'+a.id,'Budget cost centre',a.budgetCostCenterId,a.budgetLegalEntityId,v=>updateAssignment(a.id,{budgetCostCenterId:v}))}
         {entitySelector('home-fund-'+a.id,'Funding source legal entity',a.fundingLegalEntityId,v=>updateAssignment(a.id,{fundingLegalEntityId:v}))}
        </div>
        <section className="space-y-2">
         <h5 className="text-sm font-semibold">Operating coverage (no automatic access rights)</h5>
         <SelectField id={'coverage-add-'+a.id} label="Add operating unit" value="" disabled={!canEdit}
          onChange={e=>{if(e.target.value&&!a.operatingNodeIds.includes(e.target.value))updateAssignment(a.id,{operatingNodeIds:[...a.operatingNodeIds,e.target.value]})}}>
          <option value="">Select to add</option>
          {activeNodes.filter(n=>!a.operatingNodeIds.includes(n.id)).map(n=><option key={n.id} value={n.id}>{n.name} ({n.level})</option>)}
         </SelectField>
         <div className="flex flex-wrap gap-2">{a.operatingNodeIds.map(id=><button type="button" key={id} disabled={!canEdit}
           className={btn+' text-xs'} onClick={()=>updateAssignment(a.id,{operatingNodeIds:a.operatingNodeIds.filter(x=>x!==id)})}>
          {activeNodes.find(n=>n.id===id)?.name||id} ×</button>)}</div>
        </section>
        <section className="space-y-2">
         <div className="flex items-center justify-between gap-2"><h5 className="text-sm font-semibold">Beneficiary allocation (must total 100%)</h5>
          {canEdit&&<button type="button" className={btn} onClick={()=>updateAssignment(a.id,{beneficiaries:[...a.beneficiaries,{legalEntityId:'',costCenterId:'',percentage:100-a.beneficiaries.reduce((s,b)=>s+b.percentage,0)}]})}>
          <Plus className="inline h-4 w-4"/> Add</button>}</div>
         {a.beneficiaries.map((b,i)=><div key={i} className="rounded-lg border border-line p-2 space-y-2">
           {entitySelector('home-ben-'+a.id+'-'+i,'Beneficiary legal entity',b.legalEntityId,v=>updateAssignment(a.id,{beneficiaries:a.beneficiaries.map((x,j)=>j===i?{...x,legalEntityId:v,costCenterId:''}:x)}))}
           {centreSelector('home-bencc-'+a.id+'-'+i,'Beneficiary cost centre',b.costCenterId,b.legalEntityId,v=>updateAssignment(a.id,{beneficiaries:a.beneficiaries.map((x,j)=>j===i?{...x,costCenterId:v}:x)}))}
           <label className="text-sm text-muted">Percentage<input type="number" min="0" max="100" step="0.01" className={field} disabled={!canEdit}
            value={b.percentage} onChange={e=>updateAssignment(a.id,{beneficiaries:a.beneficiaries.map((x,j)=>j===i?{...x,percentage:Number(e.target.value)}:x)})}/></label>
           {canEdit&&<button type="button" className={btn} onClick={()=>updateAssignment(a.id,{beneficiaries:a.beneficiaries.filter((_,j)=>i!==j)})}><Trash2 className="mr-1 inline h-4 w-4"/> Remove beneficiary</button>}
          </div>)}
         {!!a.beneficiaries.length&&<p className="text-xs text-muted">Total {a.beneficiaries.reduce((s,b)=>s+b.percentage,0).toFixed(2)}% (required 100%). No actual recharge occurs here.</p>}
        </section>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm text-muted">Valid from<input type="date" className={field} disabled={!canEdit} value={a.effectiveFrom} onChange={e=>updateAssignment(a.id,{effectiveFrom:e.target.value})}/></label>
          <label className="text-sm text-muted">Valid to<input type="date" className={field} disabled={!canEdit} value={a.effectiveTo} onChange={e=>updateAssignment(a.id,{effectiveTo:e.target.value})}/></label>
        </div>
        <label className="block text-sm text-muted">Allocation and administrative rationale<textarea className={field+' min-h-20 p-3'} disabled={!canEdit} value={a.rationale} maxLength={500} onChange={e=>updateAssignment(a.id,{rationale:e.target.value})}/></label>
        {canEdit&&<button type="button" className={btn} onClick={()=>{edit(c=>({...c,assignments:c.assignments.filter(x=>x.id!==a.id)}));setExpanded('')}}><Trash2 className="mr-1 inline h-4 w-4"/> Remove mapping</button>}
       </div>}
      </section>)}
   </section>
   <section className="rounded-xl border border-line bg-panel p-3 space-y-3">
    <p className="flex gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0 text-brand"/>
     Draft configuration only. Approval workflows, role security, HR grade/leave eligibility, budget availability, cash movement and GL entries stay unchanged until separately implemented and approved.</p>
    <p className="text-xs text-muted">Configuration version: {config.version} · Status: {config.status}</p>
    {canEdit&&<button type="button" className="min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-onbrand disabled:opacity-40" onClick={()=>void save()} disabled={busy}>
      <Save className="mr-2 inline h-4 w-4"/> Save corporate model & home mappings as draft
    </button>}
   </section>
  </>}
 </div>;
}
