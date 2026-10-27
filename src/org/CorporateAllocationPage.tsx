import {useEffect,useMemo,useState} from 'react';
import {Calculator,FileCheck2,Plus,Save,ShieldCheck,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import RichTable,{type Column} from '../components/RichTable';
import {Segmented,useConfirm} from '../components/screen';
import {
 ALLOCATION_BASIS,POOL_TYPES,type AllocationPolicy,type AllocationReferences,
 type AllocationBeneficiary,type AllocationCalculation,
} from '../../backend/corporateAllocation';
import {majorFromMinor,currencyDigits} from '../../backend/corporateBudget';

const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const primary='flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-40';
const TABLE_HEIGHT='h-[55dvh] min-h-[300px]';
const CODE=/^[A-Z][A-Z0-9_-]{2,29}$/;
type View='policies'|'create'|'beneficiary'|'preview'|'execute';
type Draft={code:string;name:string;sourceCostCenterId:string;functionCode:string;
 costNature:string;basis:string;beneficiaries:AllocationBeneficiary[];
 glAccountCodes:string;annualCeiling:number;effectiveFrom:string;effectiveTo:string;
 purpose:string;driverEvidencePolicy:string;taxPolicyReference:string;pricingPolicy:string};
type Pending={id:string;code:string;name:string;providerLegalEntityId:string;currency:string;status:string;confirmed:boolean;annualCeilingMinor:number;beneficiaries:AllocationBeneficiary[]};
type AllocRow=AllocationCalculation['rows'][number];
const emptyDraft=():Draft=>({
 code:'',name:'',sourceCostCenterId:'',functionCode:'',costNature:'SHARED_SERVICE',
 basis:'FIXED_PCT',beneficiaries:[],glAccountCodes:'',annualCeiling:0,
 effectiveFrom:'',effectiveTo:'',purpose:'',driverEvidencePolicy:'',
 taxPolicyReference:'',pricingPolicy:'AT_COST',
});
const emptyRefs:AllocationReferences={legalEntities:[],costCenters:[],functions:[]};
function Issues({items}:{items:string[]}){
 if(!items.length)return null;
 return <ul role="status" className="list-disc space-y-0.5 rounded-xl border border-line bg-amber-500/10 p-3 pl-7 text-xs text-soft">{items.map(x=><li key={x}>{x}</li>)}</ul>;
}
export default function CorporateAllocationPage({canEdit}:{canEdit:boolean}){
 const [refs,setRefs]=useState<AllocationReferences>(emptyRefs);
 const [beneficiaryEntities,setBeneficiaryEntities]=useState<AllocationReferences['legalEntities']>([]);
 const [legalEntityId,setLegalEntityId]=useState('');
 const [policies,setPolicies]=useState<AllocationPolicy[]>([]);
 const [pending,setPending]=useState<Pending[]>([]);
 const [draft,setDraft]=useState<Draft>(emptyDraft());
 const [view,setView]=useState<View>('policies');
 const [policyId,setPolicyId]=useState(''),[pendingId,setPendingId]=useState('');
 const [previewCost,setPreviewCost]=useState(0);
 const [sourceJournalId,setSourceJournalId]=useState('');
 const [sourceLineNo,setSourceLineNo]=useState(1);
 const [taxReviewRef,setTaxReviewRef]=useState('');
 const [verifiedPreview,setVerifiedPreview]=useState<{runId:string;previouslyExecuted:boolean;postingEnabled:boolean;currency:string;source:{amountMinor:number};allocation:AllocationCalculation}|null>(null);
 const [drivers,setDrivers]=useState<Record<string,string>>({});
 const [result,setResult]=useState<AllocationCalculation|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const {ask,sheet}=useConfirm();
 const chosen=policies.find(p=>p.id===policyId);
 const byEntity=useMemo(()=>{
  const map=new Map<string,AllocationReferences['costCenters']>();
  for(const cc of refs.costCenters){const existing=map.get(cc.legalEntityId)||[];existing.push(cc);map.set(cc.legalEntityId,existing);}
  return map;
 },[refs]);
 const err=(e:unknown)=>e instanceof Error?e.message:'Could not complete request.';
 const refresh=async()=>{
  if(!legalEntityId)return;
  try{
   const [own,b]=await Promise.all([
    callBackend<{policies:AllocationPolicy[]}>('/api/org/corporate/allocation/list',{legalEntityId}),
    callBackend<{policies:Pending[]}>('/api/org/corporate/allocation/beneficiary/list',{legalEntityId}),
   ]);
   setPolicies(own.policies);setPending(b.policies);
  }catch(e){setError(err(e));}
 };
 useEffect(()=>{
  void (async()=>{
   try{
    const data=await callBackend<AllocationReferences & {allLegalEntities:AllocationReferences['legalEntities']}>('/api/org/corporate/allocation/options');
    setRefs({legalEntities:data.legalEntities||[],costCenters:data.costCenters||[],functions:data.functions||[]});
    setBeneficiaryEntities(data.allLegalEntities||data.legalEntities||[]);
    setLegalEntityId(old=>old||data.legalEntities?.[0]?.id||'');
   }catch(e){setError(err(e));}
  })();
 },[]);
 useEffect(()=>{setPolicyId('');setPendingId('');setResult(null);setVerifiedPreview(null);void refresh()},[legalEntityId]);
 /** Each submission asks for its own reason (min. 10 characters) at the moment it is made. */
 const submit=(title:string,confirmLabel:string,message:string,route:string,payload:Record<string,unknown>,after?:()=>void)=>{
  setError('');setNotice('');
  ask({title,confirmLabel,message,reason:{label:'Reason for Finance approval',minLength:10,placeholder:'Why is this needed? Stored with the request and the audit trail.'}},
   async reason=>{
    const data=await callBackend<{id:string}>(route,{...payload,reason});
    setNotice('Submitted Finance approval request '+data.id+'. A separate authorized reviewer decides it under the Chart of Authority; no costs have been posted.');
    after?.();
    await refresh();
   });
 };
 const editBeneficiary=(i:number,patch:Partial<AllocationBeneficiary>)=>
  setDraft(d=>({...d,beneficiaries:d.beneficiaries.map((b,j)=>i===j?{...b,...patch}:b)}));
 const selector=(id:string,label:string,value:string,onChange:(x:string)=>void,values:Array<{value:string;label:string}>,disabled=!canEdit)=>
  <SelectField id={id} label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
   <option value="">Select</option>{values.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}
  </SelectField>;
 const centerOptions=(le:string)=>(byEntity.get(le)||[]).map(c=>({value:c.id,label:c.name+' ('+c.code+')'}));
 const entityOptions=refs.legalEntities.map(e=>({value:e.id,label:e.name+' ('+e.code+')'}));
 const allEntityOptions=beneficiaryEntities.map(e=>({value:e.id,label:e.name+' ('+e.code+')'}));
 const entityName=(id:string)=>beneficiaryEntities.find(e=>e.id===id)?.name||refs.legalEntities.find(e=>e.id===id)?.name||id;
 const centreName=(id:string)=>refs.costCenters.find(c=>c.id===id)?.name||id;
 const currentCurrency=chosen?.currency||'';
 const major=(minor:number,curr:string)=>{try{return majorFromMinor(minor,curr)}catch{return minor/100}};
 const format=(minor:number,curr:string)=>{
  let digit=2;try{digit=currencyDigits(curr)}catch{}
  return curr+' '+new Intl.NumberFormat('en',{minimumFractionDigits:digit,maximumFractionDigits:digit}).format(major(minor,curr));
 };
 const fixedTotal=draft.beneficiaries.reduce((s,b)=>s+(b.fixedPercent||0),0);
 const draftIssues=useMemo(()=>{
  const out:string[]=[];const d=draft;
  if(!CODE.test(d.code))out.push('Pool code: 3–30 capitals, digits, _ or -, starting with a letter.');
  if(!d.name.trim())out.push('Pool name is required.');
  if(!d.sourceCostCenterId)out.push('Select the source cost centre.');
  if(!(d.annualCeiling>0))out.push('Annual maximum cost must be greater than zero.');
  if(!d.effectiveFrom||!d.effectiveTo)out.push('Effective from and to dates are required.');
  else if(d.effectiveTo<d.effectiveFrom)out.push('Effective to date must be on or after the start date.');
  if(!d.purpose.trim())out.push('Business purpose is required.');
  if(d.pricingPolicy==='CONTRACT'&&!d.taxPolicyReference.trim())out.push('Contract pricing needs a tax / transfer-pricing policy reference.');
  if(!d.beneficiaries.length)out.push('Add at least one beneficiary cost centre.');
  const seen=new Set<string>();
  d.beneficiaries.forEach((b,i)=>{
   if(!b.legalEntityId||!b.costCenterId)out.push('Beneficiary '+(i+1)+': select legal entity and cost centre.');
   if(b.costCenterId&&b.costCenterId===d.sourceCostCenterId)out.push('Beneficiary '+(i+1)+': cannot be the source cost centre.');
   const k=b.legalEntityId+'|'+b.costCenterId;if(b.costCenterId&&seen.has(k))out.push('Beneficiary '+(i+1)+' is listed twice.');seen.add(k);
   if(b.legalEntityId&&b.legalEntityId!==legalEntityId&&(!b.serviceAgreementRef.trim()||!b.benefitEvidence.trim()))
    out.push('Beneficiary '+(i+1)+': other legal entities need a service agreement reference and benefit evidence.');
   if(d.basis==='FIXED_PCT'&&!(b.fixedPercent>0))out.push('Beneficiary '+(i+1)+': fixed share must be greater than zero.');
  });
  if(d.basis==='FIXED_PCT'&&d.beneficiaries.length&&Math.abs(fixedTotal-100)>0.0005)out.push('Fixed shares must total exactly 100%.');
  return out;
 },[draft,legalEntityId,fixedTotal]);

 const policyColumns:Column<AllocationPolicy>[]=[
  {key:'code',label:'Pool',value:p=>p.code},
  {key:'name',label:'Name',value:p=>p.name},
  {key:'nature',label:'Cost nature',value:p=>p.costNature},
  {key:'basis',label:'Basis',value:p=>p.basis},
  {key:'status',label:'Status',value:p=>p.status.replaceAll('_',' ')},
  {key:'currency',label:'Currency',value:p=>p.currency},
  {key:'ceiling',label:'Annual ceiling',type:'number',value:p=>major(p.annualCeilingMinor,p.currency)},
  {key:'beneficiaries',label:'Beneficiaries',type:'number',value:p=>p.beneficiaries.length},
  {key:'approval',label:'Approval',value:p=>p.approvalRef||'Not approved',hidden:true},
 ];
 const pendingColumns:Column<Pending>[]=[
  {key:'code',label:'Pool',value:p=>p.code},
  {key:'name',label:'Name',value:p=>p.name},
  {key:'provider',label:'Provider',value:p=>entityName(p.providerLegalEntityId)},
  {key:'status',label:'Status',value:p=>p.confirmed?'Confirmed':p.status.replaceAll('_',' ')},
  {key:'ceiling',label:'Pool ceiling',type:'number',value:p=>major(p.annualCeilingMinor,p.currency)},
  {key:'currency',label:'Currency',value:p=>p.currency},
 ];
 const allocColumns=(curr:string):Column<AllocRow>[]=>[
  {key:'entity',label:'Legal entity',value:r=>entityName(r.legalEntityId)},
  {key:'cc',label:'Cost centre',value:r=>centreName(r.costCenterId)},
  {key:'amount',label:'Amount',type:'number',value:r=>major(r.amountMinor,curr)},
  {key:'share',label:'Share %',type:'number',value:r=>Number(r.sharePercent.toFixed(4))},
  {key:'type',label:'Treatment',value:r=>r.intercompany?'Intercompany (voucher)':'Same entity'},
 ];
 const chosenPending=pending.find(p=>p.id===pendingId);
 const entityCanEdit=canEdit&&!!legalEntityId;

 return <div className="min-w-0 space-y-3">
  {sheet}
  <header className="flex items-start gap-2">
   <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-brand"/>
   <p className="text-xs text-muted"><strong className="text-sm text-ink">Shared Cost Allocation.</strong> Governed cost pools, drivers and benefit distribution. Invoices, GL reallocation and settlement are separate approved steps.</p>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {selector('alloc-owner','Finance legal entity',legalEntityId,setLegalEntityId,entityOptions,false)}
  <Segmented label="Allocation sections" value={view} onChange={v=>{setView(v);setError('')}} options={[
   {value:'policies',label:'Pools',count:policies.length},{value:'create',label:'Add pool'},
   {value:'beneficiary',label:'Confirmations',count:pending.filter(p=>!p.confirmed).length},
   {value:'preview',label:'Preview'},{value:'execute',label:'Execute'},
  ]}/>

  {view==='policies'&&<section className="space-y-3">
   {chosen&&<div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3">
    <strong className="min-w-0 flex-1 text-sm">{chosen.code} — {chosen.name}</strong>
    <button type="button" className={btn} onClick={()=>{setView('preview');setResult(null)}}>Preview allocation</button>
    {chosen.status==='approved_policy'&&<button type="button" className={btn} onClick={()=>{setView('execute');setVerifiedPreview(null)}}>Execute</button>}
   </div>}
   <RichTable id="corp-allocation-pools" title="Allocation pools" fileName="Allocation_pools" columns={policyColumns}
    rows={policies} rowKey={p=>p.id} onRowClick={p=>{setPolicyId(p.id===policyId?'':p.id);setResult(null);setDrivers({});}}
    rowClassName={p=>p.id===policyId?'bg-brand/10':''} height={TABLE_HEIGHT} empty="No allocation pools for this provider legal entity."/>
  </section>}

  {view==='create'&&<section className="space-y-3 rounded-xl border border-line bg-panel p-3">
   <h4 className="font-semibold">Propose a shared cost allocation pool</h4>
   <p className="text-xs text-muted">Each pool is one auditable cost pool. Shareholder-only governance costs cannot be passed to subsidiaries; separate mixed pools first.</p>
   <div className="grid gap-2 sm:grid-cols-2">
    <label className="text-sm text-muted">Pool code *<input className={field+' font-mono'} maxLength={30} value={draft.code} disabled={!entityCanEdit} onChange={e=>setDraft(x=>({...x,code:e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'')}))}/></label>
    <label className="text-sm text-muted">Pool name *<input className={field} maxLength={130} value={draft.name} disabled={!entityCanEdit} onChange={e=>setDraft(x=>({...x,name:e.target.value}))}/></label>
   </div>
   {selector('alloc-source','Source cost centre *',draft.sourceCostCenterId,v=>setDraft(x=>({...x,sourceCostCenterId:v})),centerOptions(legalEntityId),!entityCanEdit)}
   {selector('alloc-func','Corporate function (optional)',draft.functionCode,v=>setDraft(x=>({...x,functionCode:v})),refs.functions.map(f=>({value:f.code,label:f.name})),!entityCanEdit)}
   <SelectField id="alloc-nature" label="Cost nature" value={draft.costNature} disabled={!entityCanEdit} onChange={e=>setDraft(x=>({...x,costNature:e.target.value}))}>
    {POOL_TYPES.map(b=><option value={b.code} key={b.code}>{b.label}</option>)}
   </SelectField>
   <SelectField id="alloc-basis" label="Allocation basis" value={draft.basis} disabled={!entityCanEdit} onChange={e=>setDraft(x=>({...x,basis:e.target.value}))}>
    {ALLOCATION_BASIS.map(b=><option key={b.code} value={b.code}>{b.label}</option>)}
   </SelectField>
   <label className="block text-sm text-muted">Annual maximum cost (provider functional currency) *
    <input type="number" inputMode="decimal" min="0" step="any" value={draft.annualCeiling||''} className={field}
     disabled={!entityCanEdit} onChange={e=>setDraft(x=>({...x,annualCeiling:Number(e.target.value)}))}/></label>
   <label className="block text-sm text-muted">Source GL account codes (comma separated, optional)
    <input className={field+' font-mono'} value={draft.glAccountCodes} disabled={!entityCanEdit} spellCheck={false}
     onChange={e=>setDraft(x=>({...x,glAccountCodes:e.target.value}))}/></label>
   <label className="block text-sm text-muted">Business purpose *
    <textarea className={field+' min-h-20 p-3'} maxLength={500} value={draft.purpose} disabled={!entityCanEdit} onChange={e=>setDraft(x=>({...x,purpose:e.target.value}))}/></label>
   <label className="block text-sm text-muted">Driver data source and evidence requirements
    <textarea className={field+' min-h-20 p-3'} maxLength={500} value={draft.driverEvidencePolicy} disabled={!entityCanEdit} onChange={e=>setDraft(x=>({...x,driverEvidencePolicy:e.target.value}))}/></label>
   <SelectField id="alloc-pricing" label="Service pricing policy" value={draft.pricingPolicy} disabled={!entityCanEdit} onChange={e=>setDraft(x=>({...x,pricingPolicy:e.target.value}))}>
    <option value="AT_COST">At cost — no markup</option><option value="CONTRACT">Contract pricing (requires tax policy)</option>
   </SelectField>
   {draft.pricingPolicy==='CONTRACT'&&<label className="block text-sm text-muted">Tax / transfer-pricing policy reference *
    <input className={field} disabled={!entityCanEdit} value={draft.taxPolicyReference} onChange={e=>setDraft(x=>({...x,taxPolicyReference:e.target.value}))}/></label>}
   <div className="grid gap-2 sm:grid-cols-2">
    <label className="text-sm text-muted">Effective from *<input type="date" className={field} disabled={!entityCanEdit} value={draft.effectiveFrom} onChange={e=>setDraft(x=>({...x,effectiveFrom:e.target.value}))}/></label>
    <label className="text-sm text-muted">Effective to *<input type="date" min={draft.effectiveFrom||undefined} className={field} disabled={!entityCanEdit} value={draft.effectiveTo} onChange={e=>setDraft(x=>({...x,effectiveTo:e.target.value}))}/></label>
   </div>
   <div className="flex items-center justify-between gap-2">
    <h5 className="text-sm font-semibold">Beneficiary cost centres *</h5>
    {entityCanEdit&&<button type="button" className={btn} disabled={draft.beneficiaries.length>=100} onClick={()=>setDraft(d=>({...d,beneficiaries:[...d.beneficiaries,{legalEntityId:'',costCenterId:'',fixedPercent:0,serviceAgreementRef:'',benefitEvidence:''}]}))}><Plus className="mr-1 inline h-4 w-4"/>Add</button>}
   </div>
   {draft.beneficiaries.map((b,i)=><section key={i} className="space-y-2 rounded-lg border border-line p-3">
    <div className="flex items-center justify-between"><strong className="text-sm">Beneficiary {i+1}</strong>
     {entityCanEdit&&<button type="button" aria-label={'Remove beneficiary '+(i+1)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-line" onClick={()=>setDraft(x=>({...x,beneficiaries:x.beneficiaries.filter((_,j)=>j!==i)}))}><Trash2 className="h-4 w-4"/></button>}</div>
    {selector('alloc-be-'+i,'Beneficiary legal entity',b.legalEntityId,v=>editBeneficiary(i,{legalEntityId:v,costCenterId:''}),allEntityOptions,!entityCanEdit)}
    {selector('alloc-bc-'+i,'Beneficiary cost centre',b.costCenterId,v=>editBeneficiary(i,{costCenterId:v}),centerOptions(b.legalEntityId),!entityCanEdit)}
    {draft.basis==='FIXED_PCT'&&<label className="block text-sm text-muted">Fixed allocation (%)
     <input type="number" inputMode="decimal" min="0" max="100" step="any" className={field} value={b.fixedPercent||''} disabled={!entityCanEdit} onChange={e=>editBeneficiary(i,{fixedPercent:Number(e.target.value)})}/></label>}
    {b.legalEntityId&&b.legalEntityId!==legalEntityId&&<>
     <label className="block text-sm text-muted">Shared-service agreement reference *
      <input className={field} value={b.serviceAgreementRef} disabled={!entityCanEdit} onChange={e=>editBeneficiary(i,{serviceAgreementRef:e.target.value})}/></label>
     <label className="block text-sm text-muted">Evidence of service benefit *
      <textarea className={field+' min-h-20 p-3'} maxLength={500} value={b.benefitEvidence} disabled={!entityCanEdit} onChange={e=>editBeneficiary(i,{benefitEvidence:e.target.value})}/></label>
    </>}
   </section>)}
   {draft.basis==='FIXED_PCT'&&<p className={'text-xs '+(Math.abs(fixedTotal-100)>0.0005?'font-semibold text-danger':'text-muted')}>Fixed shares total: {fixedTotal.toFixed(3)}% (100% required)</p>}
   {entityCanEdit&&<><Issues items={draftIssues}/>
    <button type="button" className={primary} disabled={draftIssues.length>0}
     onClick={()=>submit('Propose allocation pool '+draft.code+'?','Submit for approval',
      draft.beneficiaries.length+' beneficiaries, annual ceiling '+draft.annualCeiling.toLocaleString('en')+'. Cross-entity beneficiaries must each confirm separately.',
      '/api/org/corporate/allocation/propose',{providerLegalEntityId:legalEntityId,policy:{...draft,glAccountCodes:draft.glAccountCodes.split(',').map(x=>x.trim()).filter(Boolean)}},
      ()=>setDraft(emptyDraft()))}>
     <Save className="h-4 w-4"/>Propose allocation pool for approval</button></>}
  </section>}

  {view==='beneficiary'&&<section className="space-y-3">
   <p className="text-xs text-muted">Each beneficiary legal entity confirms the terms separately before the pool becomes active. A provider approver may not also approve a beneficiary confirmation.</p>
   {chosenPending&&<div className="space-y-2 rounded-xl border border-line bg-panel p-3">
    <strong className="text-sm">{chosenPending.code} — {chosenPending.name}</strong>
    <p className="text-xs text-muted">Provider {entityName(chosenPending.providerLegalEntityId)} · pool ceiling {format(chosenPending.annualCeilingMinor,chosenPending.currency)}</p>
    {chosenPending.beneficiaries.filter(b=>b.legalEntityId===legalEntityId).map(b=><p key={b.costCenterId} className="text-xs text-muted">
     Your cost centre {centreName(b.costCenterId)}: fixed share {b.fixedPercent}% — {b.serviceAgreementRef}</p>)}
    {canEdit&&!chosenPending.confirmed&&<button className={btn} type="button"
     onClick={()=>submit('Confirm '+chosenPending.code+'?','Submit confirmation',
      'Submits this entity’s confirmation of the allocation terms for independent Finance approval.',
      '/api/org/corporate/allocation/beneficiary/propose',{policyId:chosenPending.id,legalEntityId})}>
     <FileCheck2 className="mr-1 inline h-4 w-4"/>Request beneficiary approval</button>}
   </div>}
   <RichTable id="corp-allocation-confirmations" title="Beneficiary confirmations" fileName="Allocation_confirmations" columns={pendingColumns}
    rows={pending} rowKey={p=>p.id} onRowClick={p=>setPendingId(p.id===pendingId?'':p.id)}
    rowClassName={p=>p.id===pendingId?'bg-brand/10':''} height={TABLE_HEIGHT} empty="No shared cost pools involve this entity."/>
  </section>}

  {view==='preview'&&<section className="space-y-3 rounded-xl border border-line bg-panel p-3">
   <h4 className="font-semibold">Driver-based allocation preview</h4>
   {selector('alloc-preview-policy','Cost allocation pool',policyId,v=>{setPolicyId(v);setResult(null);setDrivers({})},policies.map(p=>({value:p.id,label:p.code+' — '+p.name})),false)}
   {chosen&&<>
    <p className="text-xs text-muted">Basis {chosen.basis} · status {chosen.status.replaceAll('_',' ')} · ceiling {format(chosen.annualCeilingMinor,chosen.currency)}</p>
    <label className="block text-sm text-muted">Cost amount ({chosen.currency})
     <input type="number" inputMode="decimal" min="0" step="any" className={field} value={previewCost||''} onChange={e=>setPreviewCost(Number(e.target.value))}/></label>
    {chosen.basis!=='FIXED_PCT'&&chosen.beneficiaries.map(b=>{
     const key=b.legalEntityId+'|'+b.costCenterId;
     return <label key={key} className="block text-sm text-muted">
      {entityName(b.legalEntityId)} · {centreName(b.costCenterId)} — {chosen.basis} driver quantity
      <input type="number" inputMode="decimal" min="0" step="any" className={field} value={drivers[key]||''} onChange={e=>setDrivers(x=>({...x,[key]:e.target.value}))}/>
     </label>;
    })}
    <button type="button" className={btn+' w-full'} disabled={!(previewCost>0)} onClick={async()=>{
     try{
      const values=Object.fromEntries(Object.entries(drivers).map(([k,v])=>[k,Number(v)]));
      setResult(await callBackend<AllocationCalculation>('/api/org/corporate/allocation/preview',{policyId,cost:previewCost,drivers:values}));setError('');
     }catch(e){setError(err(e))}
    }}>Calculate preview (no posting)</button>
   </>}
   {result&&<>
    <RichTable id="corp-allocation-preview" title="Allocation preview" fileName="Allocation_preview" columns={allocColumns(currentCurrency)}
     rows={result.rows} rowKey={r=>r.legalEntityId+'|'+r.costCenterId} height="h-[45dvh] min-h-[260px]"/>
    <strong className="text-sm">Total {format(result.allocatedMinor,currentCurrency)} — {result.totalMinor===result.allocatedMinor?'reconciled':'NOT RECONCILED'}</strong>
    <p className="text-xs text-muted">Advisory only: manual driver inputs are not verified readings. Nothing was posted, invoiced, committed or transferred.</p>
   </>}
  </section>}

  {view==='execute'&&<section className="space-y-3 rounded-xl border border-line bg-panel p-3">
   <h4 className="font-semibold">Execute an approved, verified allocation</h4>
   <p className="text-xs text-muted">Only a posted P&amp;L expense line from an approved fixed-percentage pool qualifies. Internal reallocations and beneficiary vouchers are committed together after Finance approval; each beneficiary still approves its voucher before intercompany posting.</p>
   {selector('alloc-exec-policy','Approved pool',policyId,v=>{setPolicyId(v);setVerifiedPreview(null)},policies.filter(p=>p.status==='approved_policy').map(p=>({value:p.id,label:p.code+' — '+p.name})),false)}
   <label className="block text-sm text-muted">Posted source GL journal ID *
    <input className={field+' font-mono'} value={sourceJournalId} spellCheck={false} onChange={e=>{setSourceJournalId(e.target.value.trim());setVerifiedPreview(null)}}/></label>
   <label className="block text-sm text-muted">Source expense journal line number *
    <input className={field} type="number" inputMode="numeric" min="1" step="1" value={sourceLineNo} onChange={e=>{setSourceLineNo(Math.max(1,Math.floor(Number(e.target.value)||1)));setVerifiedPreview(null)}}/></label>
   <label className="block text-sm text-muted">Independent tax treatment review reference *
    <input className={field} value={taxReviewRef} onChange={e=>setTaxReviewRef(e.target.value)}/></label>
   <button type="button" className={btn+' w-full'} disabled={!policyId||!sourceJournalId} onClick={async()=>{
    try{setVerifiedPreview(await callBackend<typeof verifiedPreview>('/api/org/corporate/allocation/verified-preview',{policyId,journalId:sourceJournalId,lineNo:sourceLineNo}));setError('')}
    catch(e){setError(err(e))}
   }}>Verify posted expense and calculate</button>
   {verifiedPreview&&<div className="space-y-2">
    <p className="text-sm font-semibold">Verified amount: {format(verifiedPreview.source.amountMinor,verifiedPreview.currency)}</p>
    <RichTable id="corp-allocation-verified" title="Verified allocation" fileName="Allocation_verified" columns={allocColumns(verifiedPreview.currency)}
     rows={verifiedPreview.allocation.rows} rowKey={r=>r.legalEntityId+'|'+r.costCenterId} height="h-[40dvh] min-h-[240px]"/>
    <p className="text-xs text-muted">{verifiedPreview.postingEnabled?'Posting is enabled on this server':'Execution is disabled on this server'} · {verifiedPreview.previouslyExecuted?'this source was already allocated':'source not previously allocated under this pool'}</p>
    {canEdit&&<button type="button" className={primary} disabled={!verifiedPreview.postingEnabled||verifiedPreview.previouslyExecuted||taxReviewRef.trim().length<6}
     onClick={()=>submit('Submit allocation execution?','Submit for approval',
      'Allocates '+format(verifiedPreview.source.amountMinor,verifiedPreview.currency)+' from journal '+sourceJournalId+' line '+sourceLineNo+' after Finance maker-checker approval.',
      '/api/org/corporate/allocation/execute/propose',{policyId,journalId:sourceJournalId,lineNo:sourceLineNo,taxReviewReference:taxReviewRef},()=>setVerifiedPreview(null))}>
     Submit execution for approval</button>}
    {canEdit&&taxReviewRef.trim().length<6&&<p className="text-xs text-muted">Enter the tax treatment review reference (6+ characters) to submit.</p>}
   </div>}
  </section>}

  <p className="flex gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0 text-brand"/>
   Each submission asks for its own reason and is approved by a different person under the Chart of Authority. Draft pools and previews never post.</p>
 </div>;
}
