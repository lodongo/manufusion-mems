import {useEffect,useMemo,useState} from 'react';
import {Banknote,Building2,CheckCircle2,Plus,Save,ShieldCheck,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {navigate} from '../lib/route';
import {SelectField} from '../components/ui';
import type {CorporateFinancialHome,CorporateFunctionFunding,CorporateFundingMethod,CorporateCostClass,AllocationBasis,FinanceNode,FinanceReferences} from '../../backend/corporateFinance';

const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const button='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const emptyRefs:FinanceReferences={legalEntities:[],sites:[],departments:[],costCenters:[],functions:[]};
const costClasses:Array<[CorporateCostClass,string]>= [
 ['shared_service','Shared service: benefits operating businesses'],
 ['shareholder','Shareholder / board activity: corporate-funded only'],
 ['direct_service','Direct operational or project services'],
 ['mixed','Mixed group services and corporate work'],
];
const fundingModes:Array<[CorporateFundingMethod,string]>= [
 ['corporate_budget','Corporate operating budget (employing entity bears cost)'],
 ['shareholder_funding','Holding company or shareholder funding (separately authorised)'],
 ['service_recharge','Service recovery / intercompany recharge'],
 ['hybrid','Hybrid: corporate-funded portion plus service recovery'],
];
const allocationBases:Array<[AllocationBasis,string]>= [
 ['fixed_percent','Fixed percentage split'],['time','Actual time / timesheets'],
 ['headcount','Employee headcount / FTE'],['usage','Usage or service consumption'],
 ['transactions','Transaction volume'],['revenue','Revenue weighting'],
 ['direct','Direct attribution / approved project cost'],
];
const pathTo=(id:string,refs:FinanceReferences)=>{
 const nodes=new Map([...refs.legalEntities,...refs.sites,...refs.departments,...refs.costCenters].map(x=>[x.id,x]));
 let current=id,entity='',site='',department='';
 for(let i=0;i<8&&current;i++){
  const node=nodes.get(current);if(!node)break;
  if(node.level==='legal_entity')entity=node.id;
  if(node.level==='site')site=node.id;
  if(node.level==='department')department=node.id;
  current=node.parentId;
 }
 return {entity,site,department};
};
const moneyValue=(n:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(n);
function makeRow(code:string,entityId:string):CorporateFunctionFunding{
 return {functionCode:code,homeDepartmentId:'',homeCostCenterId:'',costClass:'shared_service',
  fundingMethod:'corporate_budget',allocationBasis:'fixed_percent',
  allocations:[{legalEntityId:entityId,costCenterId:'',percentage:100}],
  rationale:'',serviceAgreementRef:'',allocationEvidence:'',budgetReference:'',effectiveFrom:''};
}
export default function CorporateFinancialHomePage({canEdit}:{canEdit:boolean}){
 const [config,setConfig]=useState<CorporateFinancialHome|null>(null);
 const [refs,setRefs]=useState<FinanceReferences>(emptyRefs);
 const [saved,setSaved]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [expanded,setExpanded]=useState('');
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const result=await callBackend<{config:CorporateFinancialHome;saved:boolean;references:FinanceReferences}>('/api/org/corporate/finance/read');
   setConfig(result.config);setRefs(result.references);setSaved(result.saved);
  }catch(e){setError(e instanceof Error?e.message:'Unable to load corporate financial home.')}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const edit=(f:(previous:CorporateFinancialHome)=>CorporateFinancialHome)=>
  setConfig(previous=>previous?f(previous):previous);
 const update=(code:string,patch:Partial<CorporateFunctionFunding>)=>edit(c=>({...c,
  functions:c.functions.map(row=>row.functionCode===code?{...row,...patch}:row),
 }));
 const entitySites=refs.sites.filter(s=>pathTo(s.id,refs).entity===config?.legalEntityId);
 const headquarterDepartments=refs.departments.filter(d=>pathTo(d.id,refs).site===config?.headquartersSiteId);
 const enabledFunctions=refs.functions.filter(f=>f.enabled);
 const create=(code:string)=>{
  if(!config?.legalEntityId||config.functions.some(f=>f.functionCode===code))return;
  edit(c=>({...c,functions:[...c.functions,makeRow(code,c.legalEntityId)]}));setExpanded(code);
 };
 const sum=(row:CorporateFunctionFunding)=>row.allocations.reduce((a,b)=>a+Number(b.percentage||0),0);
 const editAllocation=(code:string,index:number,patch:Partial<CorporateFunctionFunding['allocations'][number]>)=>{
  const current=config?.functions.find(f=>f.functionCode===code);if(!current)return;
  update(code,{allocations:current.allocations.map((a,i)=>i===index?{...a,...patch}:a)});
 };
 const newAllocation=(code:string)=>{
  const current=config?.functions.find(f=>f.functionCode===code);
  if(!current||current.allocations.length>=50)return;
  update(code,{allocations:[...current.allocations,{legalEntityId:'',costCenterId:'',percentage:0}]});
 };
 const save=async()=>{
  if(!config||!canEdit||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await callBackend<{config:CorporateFinancialHome}>('/api/org/corporate/finance/save',
    {config,expectedVersion:config.version});
   setConfig(result.config);setSaved(true);
   setNotice('Saved as draft. No salary, budget, GL posting or intercompany invoice was created.');
  }catch(e){setError(e instanceof Error?e.message:'Corporate funding validation failed.')}
  finally{setBusy(false)}
 };
 const newFunctionOptions=enabledFunctions.filter(f=>!config?.functions.some(m=>m.functionCode===f.code));
 const hasMapping=!!config?.functions.length;
 return <div className="min-w-0 space-y-4">
  <section className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
   <h2 className="flex items-center gap-2 text-lg font-bold"><Banknote className="h-5 w-5 text-brand"/>Corporate Financial Home & Funding</h2>
   <p className="mt-2 text-sm text-muted">Separate where corporate leadership governs from where it is employed, budgeted and costed. Link to real legal entities, HQ sites, departments and cost centres already defined in Organization Structure.</p>
  </section>
  {loading&&<p role="status" className="text-sm text-muted">Loading financial home…</p>}
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {config&&<>
   <section className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
    <h3 className="font-bold">Configuration sequence</h3>
    <div className="mt-3 space-y-2">
     {[
      '1. Select the legally registered corporate employing/cost-owning entity below',
      '2. Under that entity, create an HQ site of type Office',
      '3. Under HQ, create corporate Finance, HR, Engineering and other departments',
      '4. Under each department, create its own Cost Centre and manager job role',
      '5. Return here to map each corporate function and define how its costs are funded',
     ].map(step=><p key={step} className="rounded-lg bg-page p-2 text-xs text-muted">{step}</p>)}
    </div>
    <button type="button" className={button+' mt-3'} onClick={()=>navigate('organization_admin/structure')}>
     <Building2 className="mr-2 inline h-4 w-4"/>Open Organization Structure
    </button>
   </section>
   <div className="grid grid-cols-2 gap-2">
    <div className="rounded-xl border border-line bg-panel p-3"><p className="text-xs text-muted">Status</p><p className="font-bold">{saved?'Saved draft v'+config.version:'Not yet saved'}</p></div>
    <div className="rounded-xl border border-line bg-panel p-3"><p className="text-xs text-muted">Mapped corporate functions</p><p className="font-bold">{config.functions.length} / {enabledFunctions.length}</p></div>
   </div>
   <section className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
    <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-brand"/><h3 className="font-semibold">Corporate employing and cost-owning home</h3></div>
    <p className="text-xs text-muted">Use an existing registered legal entity as corporate employer / cost owner. Corporate Office is not automatically a separate company. Do not create a placeholder holding or services company.</p>
    <SelectField id="corp-fin-entity" label="Cost-owning legal entity" disabled={!canEdit} value={config.legalEntityId}
     onChange={e=>edit(c=>({...c,legalEntityId:e.target.value,headquartersSiteId:'',functions:[]}))}>
     <option value="">Select registered legal entity</option>
     {refs.legalEntities.map(x=><option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
    </SelectField>
    <SelectField id="corp-fin-site" label="Corporate Headquarters site" disabled={!canEdit||!config.legalEntityId}
     value={config.headquartersSiteId} onChange={e=>edit(c=>({...c,headquartersSiteId:e.target.value,functions:[]}))}>
     <option value="">Select site / headquarters office</option>
     {entitySites.map(x=><option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
    </SelectField>
    {config.legalEntityId&&!entitySites.length&&<p className="text-sm text-amber-700">First create an HQ Site under this legal entity in Organization Structure; choose Site type “Office”.</p>}
    {config.headquartersSiteId&&!headquarterDepartments.length&&<p className="text-sm text-amber-700">Create corporate departments under the chosen HQ site, then create a cost centre inside each department.</p>}
   </section>
   <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Corporate function cost centres and funding</h3>
     <SelectField id="corp-fin-add-function" label="Add function cost centre mapping"
      disabled={!canEdit||!config.headquartersSiteId||!newFunctionOptions.length}
      value="" onChange={e=>create(e.target.value)}>
      <option value="">+ Select corporate function</option>
      {newFunctionOptions.map(f=><option key={f.code} value={f.code}>{f.name}</option>)}
     </SelectField>
    </div>
    {!enabledFunctions.length&&<p className="rounded-xl border border-line p-3 text-sm text-muted">First save the default corporate functions in the Corporate Office / Functions section.</p>}
    {!hasMapping&&<p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Once you have selected a legal entity and an HQ site, map one corporate function at a time to its real department and cost centre. Default funding is 100% to its employing entity.</p>}
    {config.functions.map((row)=>{
     const func=refs.functions.find(x=>x.code===row.functionCode);
     const depts=headquarterDepartments;
     const costs=refs.costCenters.filter(c=>c.parentId===row.homeDepartmentId);
     const expandedRow=expanded===row.functionCode;
     const cross=row.allocations.some(a=>a.legalEntityId!==config.legalEntityId&&a.percentage>0);
     return <div key={row.functionCode} className="min-w-0 rounded-xl border border-line bg-panel">
      <button type="button" aria-expanded={expandedRow} onClick={()=>setExpanded(expandedRow?'':row.functionCode)}
       className="flex min-h-14 w-full items-center justify-between gap-2 p-3 text-left">
       <span className="min-w-0"><strong className="block break-words text-sm">{func?.name||row.functionCode}</strong>
        <span className="mt-1 block text-xs text-muted">{row.homeCostCenterId?refs.costCenters.find(c=>c.id===row.homeCostCenterId)?.name||'Cost Centre':'Cost Centre not mapped'} · {moneyValue(sum(row))}% allocated</span></span>
       <span className="shrink-0 text-brand">{expandedRow?'−':'+'}</span>
      </button>
      {expandedRow&&<div className="space-y-3 border-t border-line p-3">
       <SelectField id={'corp-fin-department-'+row.functionCode} label="Administrative department (under HQ site)"
        disabled={!canEdit} value={row.homeDepartmentId}
        onChange={e=>update(row.functionCode,{homeDepartmentId:e.target.value,homeCostCenterId:''})}>
        <option value="">Select corporate department</option>{depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
       </SelectField>
       <SelectField id={'corp-fin-cost-'+row.functionCode} label="Default corporate Cost Centre"
        disabled={!canEdit||!row.homeDepartmentId} value={row.homeCostCenterId}
        onChange={e=>update(row.functionCode,{homeCostCenterId:e.target.value})}>
        <option value="">Select Cost Centre</option>{costs.map(c=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
       </SelectField>
       <SelectField id={'corp-fin-class-'+row.functionCode} label="Nature of corporate activity"
        disabled={!canEdit} value={row.costClass} onChange={e=>update(row.functionCode,{costClass:e.target.value as CorporateCostClass})}>
        {costClasses.map(([v,l])=><option key={v} value={v}>{l}</option>)}
       </SelectField>
       <SelectField id={'corp-fin-mode-'+row.functionCode} label="Funding / recovery model"
        disabled={!canEdit} value={row.fundingMethod}
        onChange={e=>update(row.functionCode,{fundingMethod:e.target.value as CorporateFundingMethod})}>
        {fundingModes.map(([v,l])=><option key={v} value={v}>{l}</option>)}
       </SelectField>
       <SelectField id={'corp-fin-basis-'+row.functionCode} label="Beneficiary allocation basis"
        disabled={!canEdit} value={row.allocationBasis}
        onChange={e=>update(row.functionCode,{allocationBasis:e.target.value as AllocationBasis})}>
        {allocationBases.map(([v,l])=><option key={v} value={v}>{l}</option>)}
       </SelectField>
       <div className="rounded-xl border border-line bg-page p-3">
        <h4 className="font-semibold">Who funds or bears this Cost Centre’s costs?</h4>
        <p className="mt-1 text-xs text-muted">Funding distribution must total 100%. Cross-entity beneficiaries require a service agreement and evidence of benefits received. This is a draft allocation policy, not an automatic journal or bill.</p>
        {row.allocations.map((a,i)=>{
         const destinationCosts=refs.costCenters.filter(c=>pathTo(c.id,refs).entity===a.legalEntityId);
         return <div key={i} className="mt-3 space-y-2 rounded-xl border border-line bg-panel p-3">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold">Beneficiary {i+1}</p>
           {canEdit&&row.allocations.length>1&&<button type="button" aria-label="Remove beneficiary" onClick={()=>
            update(row.functionCode,{allocations:row.allocations.filter((_,j)=>j!==i)})} className={button}><Trash2 className="h-4 w-4"/></button>}
          </div>
          <SelectField id={row.functionCode+'-entity-'+i} label="Benefiting legal entity"
           disabled={!canEdit} value={a.legalEntityId}
           onChange={e=>editAllocation(row.functionCode,i,{legalEntityId:e.target.value,costCenterId:''})}>
           <option value="">Select legal entity</option>
           {refs.legalEntities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
          </SelectField>
          <SelectField id={row.functionCode+'-benefitcc-'+i} label="Receiving Cost Centre (optional during planning)"
           disabled={!canEdit||!a.legalEntityId} value={a.costCenterId}
           onChange={e=>editAllocation(row.functionCode,i,{costCenterId:e.target.value})}>
           <option value="">Legal-entity level allocation — assign cost centre later</option>
           {destinationCosts.map(c=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </SelectField>
          <label className="block text-sm text-muted">Allocation share (%)<input type="number" min={0} max={100} step="0.01"
           disabled={!canEdit} className={field} value={a.percentage}
           onChange={e=>editAllocation(row.functionCode,i,{percentage:Number(e.target.value)})}/></label>
         </div>;
        })}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
         <p className={'text-sm font-bold '+(Math.abs(sum(row)-100)<0.0001?'text-emerald-600':'text-amber-700')}>Allocated: {moneyValue(sum(row))}% / 100%</p>
         {canEdit&&<button type="button" className={button} disabled={row.allocations.length>=50} onClick={()=>newAllocation(row.functionCode)}><Plus className="mr-1 inline h-4 w-4"/>Add beneficiary</button>}
        </div>
       </div>
       {cross&&<p className="rounded-xl border border-line bg-page p-3 text-xs text-amber-700">Cross-company allocations require separate Finance and tax review, benefit evidence and a service agreement. Shareholder-only activities cannot be recharged to subsidiaries.</p>}
       <label className="block text-sm text-muted">Budget or funding reference<input className={field} maxLength={160}
        disabled={!canEdit} value={row.budgetReference}
        onChange={e=>update(row.functionCode,{budgetReference:e.target.value})}/></label>
       <label className="block text-sm text-muted">Service agreement reference (required if cross-company)<input
        className={field} maxLength={180} disabled={!canEdit} value={row.serviceAgreementRef}
        onChange={e=>update(row.functionCode,{serviceAgreementRef:e.target.value})}/></label>
       <label className="block text-sm text-muted">Allocation benefit evidence / cost driver<input className={field}
        maxLength={300} disabled={!canEdit} value={row.allocationEvidence}
        onChange={e=>update(row.functionCode,{allocationEvidence:e.target.value})}/></label>
       <label className="block text-sm text-muted">Business justification<textarea className={field+' min-h-20 p-3'}
        maxLength={500} disabled={!canEdit} value={row.rationale}
        onChange={e=>update(row.functionCode,{rationale:e.target.value})}/></label>
       <label className="block text-sm text-muted">Policy effective from<input type="date" className={field}
        disabled={!canEdit} value={row.effectiveFrom}
        onChange={e=>update(row.functionCode,{effectiveFrom:e.target.value})}/></label>
       {canEdit&&<button type="button" className={button} onClick={()=>{
        edit(c=>({...c,functions:c.functions.filter(x=>x.functionCode!==row.functionCode)}));setExpanded('');
       }}><Trash2 className="mr-1 inline h-4 w-4"/>Remove function funding mapping</button>}
      </div>}
     </div>;
    })}
   </section>
   <section className="space-y-3 rounded-xl border border-line bg-panel p-3">
    <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand"/>
     Corporate Financial Home does not grant approvals or change employment, site assignments, GL mapping, payroll or current costs. Finance approvals, cross-border tax review and intercompany postings are separate future controls.</p>
    {canEdit&&<button type="button" onClick={()=>void save()} disabled={busy||!config.legalEntityId||!config.headquartersSiteId}
     className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-onbrand disabled:opacity-40">
     <Save className="h-4 w-4"/>Save Financial Home & Funding as draft
    </button>}
   </section>
  </>}
 </div>;
}
