import {useEffect,useMemo,useState} from 'react';
import {Calculator,FileCheck2,Plus,Save,ShieldCheck,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import {
 ALLOCATION_BASIS,POOL_TYPES,type AllocationPolicy,type AllocationReferences,
 type AllocationBeneficiary,type AllocationCalculation,
} from '../../backend/corporateAllocation';
import {majorFromMinor,currencyDigits} from '../../backend/corporateBudget';

const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
type Draft={code:string;name:string;sourceCostCenterId:string;functionCode:string;
 costNature:string;basis:string;beneficiaries:AllocationBeneficiary[];
 glAccountCodes:string;annualCeiling:number;effectiveFrom:string;effectiveTo:string;
 purpose:string;driverEvidencePolicy:string;taxPolicyReference:string;pricingPolicy:string};
const emptyDraft=():Draft=>({
 code:'',name:'',sourceCostCenterId:'',functionCode:'',costNature:'SHARED_SERVICE',
 basis:'FIXED_PCT',beneficiaries:[],glAccountCodes:'',annualCeiling:0,
 effectiveFrom:'',effectiveTo:'',purpose:'',driverEvidencePolicy:'',
 taxPolicyReference:'',pricingPolicy:'AT_COST',
});
const emptyRefs:AllocationReferences={legalEntities:[],costCenters:[],functions:[]};
export default function CorporateAllocationPage({canEdit}:{canEdit:boolean}){
 const [refs,setRefs]=useState<AllocationReferences>(emptyRefs);
 const [beneficiaryEntities,setBeneficiaryEntities]=useState<AllocationReferences['legalEntities']>([]);
 const [legalEntityId,setLegalEntityId]=useState('');
 const [policies,setPolicies]=useState<AllocationPolicy[]>([]);
 const [pending,setPending]=useState<Array<{id:string;code:string;name:string;
  providerLegalEntityId:string;currency:string;status:string;confirmed:boolean;annualCeilingMinor:number;
  beneficiaries:AllocationBeneficiary[]}>>([]);
 const [draft,setDraft]=useState<Draft>(emptyDraft());
 const [reason,setReason]=useState('');
 const [view,setView]=useState<'policies'|'create'|'beneficiary'|'preview'|'execute'>('policies');
 const [policyId,setPolicyId]=useState('');
 const [previewCost,setPreviewCost]=useState(0);
 const [sourceJournalId,setSourceJournalId]=useState('');
 const [sourceLineNo,setSourceLineNo]=useState(1);
 const [taxReviewRef,setTaxReviewRef]=useState('');
 const [verifiedPreview,setVerifiedPreview]=useState<{runId:string;previouslyExecuted:boolean;postingEnabled:boolean;currency:string;source:{amountMinor:number};allocation:AllocationCalculation}|null>(null);
 const [drivers,setDrivers]=useState<Record<string,string>>({});
 const [result,setResult]=useState<AllocationCalculation|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const chosen=policies.find(p=>p.id===policyId);
 const byEntity=useMemo(()=>{
  const map=new Map<string,AllocationReferences['costCenters']>();
  for(const cc of refs.costCenters){
   const existing=map.get(cc.legalEntityId)||[];
   existing.push(cc);map.set(cc.legalEntityId,existing);
  }
  return map;
 },[refs]);
 const err=(e:unknown)=>e instanceof Error?e.message:'Could not complete request.';
 const loadOptions=async()=>{
  try{
   const data=await callBackend<AllocationReferences & {allLegalEntities:AllocationReferences['legalEntities']}>('/api/org/corporate/allocation/options');
   setRefs({legalEntities:data.legalEntities||[],costCenters:data.costCenters||[],functions:data.functions||[]});
   setBeneficiaryEntities(data.allLegalEntities||data.legalEntities||[]);
   setLegalEntityId(old=>old||data.legalEntities?.[0]?.id||'');
  }catch(e){setError(err(e));}
 };
 const refresh=async()=>{
  if(!legalEntityId)return;
  try{
   const [own,b]=await Promise.all([
    callBackend<{policies:AllocationPolicy[]}>('/api/org/corporate/allocation/list',{legalEntityId}),
    callBackend<{policies:typeof pending}>('/api/org/corporate/allocation/beneficiary/list',{legalEntityId}),
   ]);
   setPolicies(own.policies);setPending(b.policies);
  }catch(e){setError(err(e));}
 };
 useEffect(()=>{void loadOptions()},[]);
 useEffect(()=>{void refresh()},[legalEntityId]);
 const submit=async(route:string,payload:Record<string,unknown>)=>{
  setBusy(true);setError('');setNotice('');
  try{
   const data=await callBackend<{id:string}>(route,payload);
   setNotice('Submitted Finance approval request '+data.id+'. Approval requires a separate authorized reviewer; no costs have been posted.');
   await refresh();
  }catch(e){setError(err(e));}
  finally{setBusy(false)}
 };
 const addBeneficiary=()=>setDraft(d=>({...d,beneficiaries:[...d.beneficiaries,{
  legalEntityId:'',costCenterId:'',fixedPercent:0,serviceAgreementRef:'',benefitEvidence:'',
 }]}));
 const editBeneficiary=(i:number,patch:Partial<AllocationBeneficiary>)=>
  setDraft(d=>({...d,beneficiaries:d.beneficiaries.map((b,j)=>i===j?{...b,...patch}:b)}));
 const selector=(id:string,label:string,value:string,onChange:(x:string)=>void,values:Array<{value:string;label:string}>)=>
  <SelectField id={id} label={label} value={value} disabled={!canEdit} onChange={e=>onChange(e.target.value)}>
   <option value="">Select</option>{values.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}
  </SelectField>;
 const centerOptions=(le:string)=> (byEntity.get(le)||[]).map(c=>({value:c.id,label:c.name+' ('+c.code+')'}));
 const entityOptions=refs.legalEntities.map(e=>({value:e.id,label:e.name+' ('+e.code+')'}));
 const allEntityOptions=beneficiaryEntities.map(e=>({value:e.id,label:e.name+' ('+e.code+')'}));
 const currentCurrency=chosen?.currency||'';
 const format=(minor:number,curr:string)=>{
  let digit=2;try{digit=currencyDigits(curr)}catch{}
  return curr+' '+new Intl.NumberFormat('en',{minimumFractionDigits:digit,maximumFractionDigits:digit})
   .format(majorFromMinor(minor,curr));
 };
 return <div className="min-w-0 space-y-4">
  <header className="rounded-2xl border border-line bg-panel p-4">
   <h3 className="flex items-center gap-2 text-lg font-bold"><Calculator className="h-5 w-5 text-brand"/> Shared Cost Allocation</h3>
   <p className="mt-2 text-sm text-muted">P3: governed allocation pools, cost drivers and benefit distribution. Actual intercompany invoices, GL reallocation and settlement are separate transactions and are not enabled by this configuration.</p>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {selector('alloc-owner','Finance legal entity',legalEntityId,setLegalEntityId,entityOptions)}
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
   {([['policies','Pools'],['create','Add pool'],['beneficiary','Confirmations'],['preview','Preview'],['execute','Execute GL-backed']] as const).map(([id,label])=>
    <button type="button" key={id} className={'min-h-11 rounded-lg border border-line px-2 text-xs font-semibold '+(view===id?'bg-brand/10 text-brand':'bg-panel text-muted')}
      onClick={()=>{setView(id);setError('')}}>{label}</button>)}
  </div>
  {view==='policies'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-2">
   <h4 className="font-semibold">Approved and pending allocation pools</h4>
   {!policies.length&&<p className="text-sm text-muted">No allocation pools recorded for this provider legal entity.</p>}
   {policies.map(p=><div key={p.id} className="rounded-lg border border-line p-3 space-y-1">
    <p className="text-sm font-semibold">{p.code} — {p.name}</p>
    <p className="text-xs text-muted">{p.costNature} · {p.basis} · {p.status.replaceAll('_',' ')}</p>
    <p className="text-xs text-muted">Annual ceiling {format(p.annualCeilingMinor,p.currency)} · {p.beneficiaries.length} beneficiary cost centres</p>
    <p className="text-xs text-muted">Agreement reference / approval: {p.approvalRef||'Not approved'}</p>
    <button type="button" className={btn} onClick={()=>{setPolicyId(p.id);setView('preview');setResult(null)}}>Preview allocation</button>
   </div>)}
  </section>}
  {view==='create'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="font-semibold">Propose shared cost allocation policy</h4>
   <p className="text-xs text-muted">Every policy defines one auditable cost pool. Shareholder-only governance costs cannot be passed to subsidiaries; separate mixed cost pools before allocation.</p>
   <div className="grid gap-2 sm:grid-cols-2">
    <label className="text-sm text-muted">Pool code<input className={field} maxLength={30} value={draft.code} disabled={!canEdit} onChange={e=>setDraft(x=>({...x,code:e.target.value.toUpperCase()}))}/></label>
    <label className="text-sm text-muted">Pool name<input className={field} maxLength={130} value={draft.name} disabled={!canEdit} onChange={e=>setDraft(x=>({...x,name:e.target.value}))}/></label>
   </div>
   {selector('alloc-source','Source cost centre',draft.sourceCostCenterId,v=>setDraft(x=>({...x,sourceCostCenterId:v})),centerOptions(legalEntityId))}
   {selector('alloc-func','Corporate function (optional)',draft.functionCode,v=>setDraft(x=>({...x,functionCode:v})),
    refs.functions.map(f=>({value:f.code,label:f.name})))}
   <SelectField id="alloc-nature" label="Cost nature" value={draft.costNature} disabled={!canEdit} onChange={e=>setDraft(x=>({...x,costNature:e.target.value}))}>
    {POOL_TYPES.map(b=><option value={b.code} key={b.code}>{b.label}</option>)}
   </SelectField>
   <SelectField id="alloc-basis" label="Allocation basis" value={draft.basis} disabled={!canEdit} onChange={e=>setDraft(x=>({...x,basis:e.target.value}))}>
    {ALLOCATION_BASIS.map(b=><option key={b.code} value={b.code}>{b.label}</option>)}
   </SelectField>
   <label className="text-sm text-muted">Annual maximum cost (provider functional currency)
    <input type="number" min="0" step="any" value={draft.annualCeiling} className={field}
     disabled={!canEdit} onChange={e=>setDraft(x=>({...x,annualCeiling:Number(e.target.value)}))}/></label>
   <label className="text-sm text-muted">Source GL account codes (comma separated, optional)
    <input className={field} value={draft.glAccountCodes} disabled={!canEdit}
      onChange={e=>setDraft(x=>({...x,glAccountCodes:e.target.value}))}/></label>
   <label className="text-sm text-muted">Business purpose
    <textarea className={field+' min-h-20 p-3'} value={draft.purpose} disabled={!canEdit}
     onChange={e=>setDraft(x=>({...x,purpose:e.target.value}))}/></label>
   <label className="text-sm text-muted">Driver data source and evidence requirements
    <textarea className={field+' min-h-20 p-3'} value={draft.driverEvidencePolicy} disabled={!canEdit}
     onChange={e=>setDraft(x=>({...x,driverEvidencePolicy:e.target.value}))}/></label>
   <SelectField id="alloc-pricing" label="Service pricing policy" value={draft.pricingPolicy} disabled={!canEdit}
     onChange={e=>setDraft(x=>({...x,pricingPolicy:e.target.value}))}>
      <option value="AT_COST">At cost — no markup</option><option value="CONTRACT">Contract pricing (requires tax policy)</option>
   </SelectField>
   {draft.pricingPolicy==='CONTRACT'&&<label className="text-sm text-muted">Tax / transfer-pricing policy reference
    <input className={field} disabled={!canEdit} value={draft.taxPolicyReference}
     onChange={e=>setDraft(x=>({...x,taxPolicyReference:e.target.value}))}/></label>}
   <div className="grid gap-2 sm:grid-cols-2">
    <label className="text-sm text-muted">Effective from
     <input type="date" className={field} disabled={!canEdit} value={draft.effectiveFrom} onChange={e=>setDraft(x=>({...x,effectiveFrom:e.target.value}))}/></label>
    <label className="text-sm text-muted">Effective to
     <input type="date" className={field} disabled={!canEdit} value={draft.effectiveTo} onChange={e=>setDraft(x=>({...x,effectiveTo:e.target.value}))}/></label>
   </div>
   <div className="flex justify-between items-center gap-2">
    <h5 className="font-semibold text-sm">Beneficiary cost centres</h5>
    {canEdit&&<button type="button" className={btn} onClick={addBeneficiary}><Plus className="inline h-4 w-4 mr-1"/>Add</button>}
   </div>
   {draft.beneficiaries.map((b,i)=><section key={i} className="rounded-lg border border-line p-3 space-y-2">
    <div className="flex justify-between items-center"><strong className="text-sm">Beneficiary {i+1}</strong>
     {canEdit&&<button type="button" className={btn} onClick={()=>setDraft(x=>({...x,beneficiaries:x.beneficiaries.filter((_,j)=>j!==i)}))}><Trash2 className="h-4 w-4"/></button>}</div>
    {selector('alloc-be-'+i,'Beneficiary legal entity',b.legalEntityId,v=>editBeneficiary(i,{legalEntityId:v,costCenterId:''}),allEntityOptions)}
    {selector('alloc-bc-'+i,'Beneficiary cost centre',b.costCenterId,v=>editBeneficiary(i,{costCenterId:v}),centerOptions(b.legalEntityId))}
    {draft.basis==='FIXED_PCT'&&<label className="text-sm text-muted">Fixed allocation (%)
     <input type="number" min="0" max="100" step="any" className={field} value={b.fixedPercent}
      disabled={!canEdit} onChange={e=>editBeneficiary(i,{fixedPercent:Number(e.target.value)})}/></label>}
    {b.legalEntityId!==legalEntityId&&<>
     <label className="text-sm text-muted">Shared-service agreement reference
      <input className={field} value={b.serviceAgreementRef} disabled={!canEdit} onChange={e=>editBeneficiary(i,{serviceAgreementRef:e.target.value})}/></label>
     <label className="text-sm text-muted">Evidence of service benefit
      <textarea className={field+' min-h-20 p-3'} value={b.benefitEvidence} disabled={!canEdit} onChange={e=>editBeneficiary(i,{benefitEvidence:e.target.value})}/></label>
    </>}
   </section>)}
   {draft.basis==='FIXED_PCT'&&<p className="text-xs text-muted">Fixed shares total: {draft.beneficiaries.reduce((s,b)=>s+b.fixedPercent,0).toFixed(3)}% (100% required)</p>}
   <label className="text-sm text-muted">Justification for Finance approval
    <textarea className={field+' min-h-20 p-3'} value={reason} disabled={!canEdit} onChange={e=>setReason(e.target.value)}/></label>
   {canEdit&&<button type="button" className="min-h-12 rounded-xl w-full bg-brand text-onbrand font-semibold px-3 disabled:opacity-40"
    disabled={busy||!legalEntityId} onClick={()=>void submit('/api/org/corporate/allocation/propose',{
     providerLegalEntityId:legalEntityId,reason,
     policy:{...draft,glAccountCodes:draft.glAccountCodes.split(',').map(x=>x.trim()).filter(Boolean)},
    })}><Save className="inline h-4 w-4 mr-1"/>Propose allocation policy for Finance approval</button>}
  </section>}
  {view==='beneficiary'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
    <h4 className="font-semibold">Beneficiary legal-entity approvals</h4>
    <p className="text-xs text-muted">Different legal entities separately confirm the terms before the allocation policy becomes active. A provider approver may not also approve a beneficiary acceptance.</p>
    {!pending.length&&<p className="text-sm text-muted">No shared cost policies require this entity.</p>}
    {pending.map(p=><div key={p.id} className="rounded-lg border border-line p-3 space-y-1">
      <strong className="text-sm">{p.code} — {p.name}</strong>
      <p className="text-xs text-muted">Provider {p.providerLegalEntityId} · status {p.status}</p>
      <p className="text-xs text-muted">Annual pool ceiling {format(p.annualCeilingMinor,p.currency)}</p>
      {p.beneficiaries.map(b=><p key={b.costCenterId} className="text-xs text-muted">
       Your cost centre {b.costCenterId}: fixed share {b.fixedPercent}% — {b.serviceAgreementRef}</p>)}
      {canEdit&&!p.confirmed&&<button className={btn} type="button" disabled={busy||reason.trim().length<10}
       onClick={()=>void submit('/api/org/corporate/allocation/beneficiary/propose',{policyId:p.id,legalEntityId,reason})}>
       <FileCheck2 className="inline h-4 w-4 mr-1"/>Request independent beneficiary approval</button>}
    </div>)}
    <label className="block text-sm text-muted">Reason for beneficiary approval
     <textarea className={field+' min-h-20 p-3'} disabled={!canEdit} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  </section>}
  {view==='preview'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="font-semibold">Driver-based allocation preview</h4>
   {selector('alloc-preview-policy','Cost allocation policy',policyId,v=>{setPolicyId(v);setResult(null);setDrivers({})},
    policies.map(p=>({value:p.id,label:p.code+' — '+p.name})))}
   {chosen&&<>
    <p className="text-xs text-muted">Basis: {chosen.basis} · policy status: {chosen.status} · ceiling {format(chosen.annualCeilingMinor,chosen.currency)}</p>
    <label className="text-sm text-muted">Cost amount ({chosen.currency})
     <input type="number" min="0" step="any" className={field} value={previewCost} onChange={e=>setPreviewCost(Number(e.target.value))}/></label>
    {chosen.basis!=='FIXED_PCT'&&chosen.beneficiaries.map(b=>{
     const key=b.legalEntityId+'|'+b.costCenterId;
     return <label key={key} className="block text-sm text-muted">
      {b.legalEntityId} · {b.costCenterId} — approved {chosen.basis} driver quantity
      <input type="number" min="0" step="any" className={field} value={drivers[key]||''}
       onChange={e=>setDrivers(x=>({...x,[key]:e.target.value}))}/>
     </label>;
    })}
    <button type="button" className={btn+' w-full'} onClick={async()=>{
     try{
      const values=Object.fromEntries(Object.entries(drivers).map(([k,v])=>[k,Number(v)]));
      const r=await callBackend<AllocationCalculation>('/api/org/corporate/allocation/preview',
       {policyId,cost:previewCost,drivers:values});
      setResult(r);setError('');
     }catch(e){setError(err(e))}
    }}>Calculate allocation preview (no posting)</button>
   </>}
   {result&&<div className="space-y-2">
    {result.rows.map(r=><div key={r.legalEntityId+'|'+r.costCenterId} className="rounded-lg border border-line p-3 text-sm">
     <p className="font-semibold">{r.legalEntityId} · {r.costCenterId}</p>
     <p>{format(r.amountMinor,currentCurrency)} ({r.sharePercent.toFixed(4)}%)</p>
     <p className="text-xs text-muted">{r.intercompany?'Intercompany recharge will require invoice/GL verification':'Same-entity allocation'} · evidence required</p>
    </div>)}
    <strong className="text-sm">Total: {format(result.allocatedMinor,currentCurrency)} — {result.totalMinor===result.allocatedMinor?'Reconciled':'NOT RECONCILED'}</strong>
    <p className="text-xs text-muted">Advisory simulation only; manual driver inputs are not verified source readings. The calculation has not created GL journals, intercompany balances, invoices, spending commitments or cash transfers.</p>
   </div>}
  </section>}
  {view==='execute'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="font-semibold">Execute approved, verified corporate allocation</h4>
   <p className="text-xs text-muted">Only a posted P&L expense journal line from an approved fixed-percentage pool qualifies. Finance approval is required. Internal cost-centre reallocations and cross-entity beneficiary vouchers are committed atomically; each beneficiary must still independently approve its voucher before intercompany GL posting.</p>
   {selector('alloc-exec-policy','Approved pool',policyId,v=>{setPolicyId(v);setVerifiedPreview(null)},policies.filter(p=>p.status==='approved_policy').map(p=>({value:p.id,label:p.code+' — '+p.name})))}
   <label className="block text-sm text-muted">Posted source GL journal ID
    <input className={field} value={sourceJournalId} onChange={e=>{setSourceJournalId(e.target.value);setVerifiedPreview(null)}}/></label>
   <label className="block text-sm text-muted">Source expense journal line number
    <input className={field} type="number" min="1" step="1" value={sourceLineNo} onChange={e=>{setSourceLineNo(Number(e.target.value));setVerifiedPreview(null)}}/></label>
   <label className="block text-sm text-muted">Independent tax treatment review reference
    <input className={field} value={taxReviewRef} onChange={e=>setTaxReviewRef(e.target.value)}/></label>
   <button type="button" className={btn+' w-full'} onClick={async()=>{
    try{const p=await callBackend<typeof verifiedPreview>('/api/org/corporate/allocation/verified-preview',
     {policyId,journalId:sourceJournalId,lineNo:sourceLineNo});setVerifiedPreview(p);setError('')}catch(e){setError(err(e))}
   }}>Verify posted expense and calculate allocation</button>
   {verifiedPreview&&<div className="space-y-2 rounded-xl border border-line p-3">
    <p className="text-sm font-semibold">Verified amount: {format(verifiedPreview.source.amountMinor,verifiedPreview.currency)}</p>
    {verifiedPreview.allocation.rows.map(r=><p key={r.legalEntityId+'|'+r.costCenterId} className="text-xs text-muted">{r.legalEntityId} · {r.costCenterId}: {format(r.amountMinor,verifiedPreview.currency)} — {r.intercompany?'beneficiary voucher':'same-entity allocation'}</p>)}
    <p className="text-xs text-muted">{verifiedPreview.postingEnabled?'P6 developer-only posting server enabled':'Execution disabled on this server'} · {verifiedPreview.previouslyExecuted?'Source already allocated':'Source not previously executed under this policy'}</p>
    {canEdit&&<button type="button" className={btn+' w-full'} disabled={busy||!verifiedPreview.postingEnabled||verifiedPreview.previouslyExecuted||taxReviewRef.trim().length<6||reason.trim().length<10}
      onClick={()=>void submit('/api/org/corporate/allocation/execute/propose',{policyId,journalId:sourceJournalId,lineNo:sourceLineNo,taxReviewReference:taxReviewRef,reason})}>Submit allocation execution to Finance maker-checker</button>}
   </div>}
   <label className="block text-sm text-muted">Reason for financial approval
    <textarea className={field+' min-h-20 p-3'} disabled={!canEdit} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  </section>}
  <p className="flex gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0 text-brand"/>
   Policies require approval and documented basis. These controls do not change existing procurement, payroll, HR security or general-ledger balances.</p>
 </div>;
}
