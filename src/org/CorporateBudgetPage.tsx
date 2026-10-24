import {useEffect,useState} from 'react';
import {Banknote,FileCheck2,Plus,Save,ShieldCheck,ArrowLeftRight} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import {BUDGET_CLASSES,FUNDING_METHODS,type BudgetPlan,type FundingAgreement} from '../../backend/corporateBudget';

type Entity={id:string;code:string;name:string};
type Centre={id:string;code:string;name:string};
type InputLine={costCenterId:string;category:string;amount:number};
const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const currencyFormat=(amount:number,currency:string)=>currency+' '+new Intl.NumberFormat('en',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount);
export default function CorporateBudgetPage({canEdit}:{canEdit:boolean}){
 const [entities,setEntities]=useState<Entity[]>([]),[centres,setCentres]=useState<Centre[]>([]);
 const [leId,setLeId]=useState(''),[fy,setFy]=useState(new Date().getFullYear());
 const [currency,setCurrency]=useState(''),[plan,setPlan]=useState<BudgetPlan|null>(null);
 const [lines,setLines]=useState<InputLine[]>([{costCenterId:'',category:'OPEX',amount:0}]);
 const [reason,setReason]=useState('');
 const [revision,setRevision]=useState({costCenterId:'',category:'OPEX',delta:0});
 const [transfer,setTransfer]=useState({fromCostCenterId:'',fromCategory:'OPEX',toCostCenterId:'',toCategory:'OPEX',amount:0});
 const [exception,setException]=useState({costCenterId:'',category:'OPEX',sourceDocumentId:'',expiresOn:'',amount:0});
 const [simulate,setSimulate]=useState({costCenterId:'',category:'OPEX',sourceDocumentId:'',exceptionId:'',amount:0});
 const [simulation,setSimulation]=useState<Record<string,unknown>|null>(null);
 const [funding,setFunding]=useState({beneficiaryLegalEntityId:'',method:'ENT',currency:'',amount:0,
  agreementReference:'',purpose:'',effectiveFrom:'',effectiveTo:'',budgetReference:'',
  settlementPolicy:'PER_AGREEMENT'});
 const [agreements,setAgreements]=useState<FundingAgreement[]>([]);
 const [section,setSection]=useState<'plan'|'transfers'|'exceptions'|'funding'>('plan');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const errorOf=(e:unknown)=>e instanceof Error?e.message:'The request could not be completed.';
 const loadingOptions=async()=>{
   try{
    const r=await callBackend<{entities:Entity[]}>('/api/org/corporate/budget/options');
    setEntities(r.entities);setLeId(v=>v||r.entities[0]?.id||'');
   }catch(e){setError(errorOf(e));}
 };
 useEffect(()=>{void loadingOptions()},[]);
 const refresh=async()=>{
   if(!leId)return;
   setLoading(true);setError('');
   try{
    const [p,f]=await Promise.all([
     callBackend<{plan:BudgetPlan|null;currency:string;centres:Centre[]}>('/api/org/corporate/budget/get',{leId,fy}),
     callBackend<{agreements:FundingAgreement[]}>('/api/org/corporate/funding/list',{leId}),
    ]);
    setPlan(p.plan);setCurrency(p.currency);setCentres(p.centres);setAgreements(f.agreements);
    setFunding(x=>({...x,currency:p.currency||x.currency}));
   }catch(e){setPlan(null);setError(errorOf(e));}
   finally{setLoading(false)}
 };
 useEffect(()=>{void refresh()},[leId,fy]);
 const submit=async(path:string,payload:Record<string,unknown>)=>{
   if(busy)return;
   setBusy(true);setError('');setNotice('');
   try{
    const r=await callBackend<{id:string}>(path,payload);
    setNotice('Finance request '+r.id+' submitted. A different authorized approver must decide it in Finance → Requests. No accounting or cash movement was performed.');
    await refresh();
   }catch(e){setError(errorOf(e));}
   finally{setBusy(false)}
 };
 const centreSelect=(id:string,value:string,cb:(v:string)=>void,label:string)=>
  <SelectField id={id} label={label} value={value} onChange={e=>cb(e.target.value)} disabled={!canEdit}>
   <option value="">Select cost centre</option>
   {centres.map(c=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
  </SelectField>;
 const classSelect=(id:string,value:string,cb:(v:string)=>void,label:string)=>
  <SelectField id={id} label={label} value={value} onChange={e=>cb(e.target.value)} disabled={!canEdit}>
   {BUDGET_CLASSES.map(c=><option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
  </SelectField>;
 const amountField=(label:string,value:number,cb:(v:number)=>void)=>
  <label className="block text-sm text-muted">{label}<input className={field} type="number" min="0" step="0.01" disabled={!canEdit}
    value={value} onChange={e=>cb(Number(e.target.value))}/></label>;
 const reasonField=<label className="block text-sm text-muted">Business reason (mandatory, at least 10 characters)
   <textarea className={field+' min-h-20 p-3'} value={reason} disabled={!canEdit} onChange={e=>setReason(e.target.value)} maxLength={300}/>
  </label>;
 return <div className="min-w-0 space-y-4">
  <header className="rounded-2xl border border-line bg-panel p-4 space-y-2">
   <h3 className="flex items-center gap-2 text-lg font-bold"><Banknote className="h-5 w-5 text-brand"/>Funding & Budget Management</h3>
   <p className="text-sm text-muted">P2: use existing finance approvals for legal-entity budgets, transfers, approved exceptions and funding policies. Funding agreements here do not transfer cash, record loans or post journals.</p>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  <section className="rounded-xl border border-line bg-panel p-3 space-y-2">
   <SelectField id="cb-le" label="Legal entity" value={leId} onChange={e=>setLeId(e.target.value)}>
    <option value="">Select legal entity</option>{entities.map(e=><option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}
   </SelectField>
   <label className="block text-sm text-muted">Financial year
    <input type="number" min="1900" max="2500" className={field} value={fy} onChange={e=>setFy(Number(e.target.value))}/>
   </label>
   <p className="text-xs text-muted">Legal-entity functional currency: {currency||'Not configured'}. Fiscal year and currency are inherited from Finance settings.</p>
  </section>
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
   {([['plan','Annual Budget'],['transfers','Transfers'],['exceptions','Exceptions'],['funding','Funding']] as const).map(([id,label])=>
    <button key={id} type="button" className={'min-h-11 rounded-lg border border-line px-2 text-xs font-semibold '+(section===id?'bg-brand/10 text-brand':'bg-panel text-muted')}
      onClick={()=>setSection(id)}>{label}</button>)}
  </div>
  {loading&&<p role="status" className="text-sm text-muted">Loading finance configuration…</p>}
  {section==='plan'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="font-semibold">Annual budget plan</h4>
   {plan?<div className="space-y-2">
     <p className="text-xs text-muted">Approved plan · Version {plan.version} · Reference {plan.approvalRef}</p>
     {plan.lines.map(line=><div key={line.costCenterId+'|'+line.category} className="rounded-lg border border-line p-3">
       <p className="text-sm font-semibold">{centres.find(c=>c.id===line.costCenterId)?.name||line.costCenterId} · {line.category}</p>
       <p className="text-xs text-muted">Approved {currencyFormat(line.approvedMinor/100,currency)} · Adjusted {currencyFormat(line.adjustmentsMinor/100,currency)}</p>
       <p className="text-sm">Available {currencyFormat((line.approvedMinor+line.adjustmentsMinor-line.committedMinor-line.actualMinor)/100,currency)}</p>
     </div>)}
     {canEdit&&<section className="rounded-lg border border-line bg-page p-3 space-y-3">
       <h5 className="font-semibold">Governed budget revision</h5>
       <p className="text-xs text-muted">Increase (+) or reduce (−) a budget line. A new cost-centre/category line can be added with a positive amount. Committed or spent budget cannot be removed. All amendments require a separate Finance approval and preserve the original budget.</p>
       {centreSelect('rev-cc',revision.costCenterId,v=>setRevision(a=>({...a,costCenterId:v})),'Revised cost centre')}
       {classSelect('rev-class',revision.category,v=>setRevision(a=>({...a,category:v})),'Revised budget class')}
       <label className="block text-sm text-muted">Revision (+ increase / − decrease), {currency}
        <input className={field} type="number" step="0.01" value={revision.delta}
          disabled={!canEdit} onChange={e=>setRevision(a=>({...a,delta:Number(e.target.value)}))}/>
       </label>
       {reasonField}
       <button type="button" className={btn+' w-full'} disabled={busy||!revision.costCenterId||revision.delta===0||reason.trim().length<10}
         onClick={()=>void submit('/api/org/corporate/budget/revision/propose',{leId,fy,changes:[revision],reason})}>
        Propose budget revision for approval</button>
      </section>}
    </div>:<div className="space-y-3">
     <p className="text-xs text-muted">Prepare a budget by cost centre and class. Submitting creates a valued Finance request; approval activates one immutable opening plan per legal entity/year. Subsequent reallocations use governed transfers.</p>
     {lines.map((line,i)=><div className="space-y-2 rounded-lg border border-line p-3" key={i}>
       {centreSelect('bud-cc-'+i,line.costCenterId,v=>setLines(a=>a.map((x,j)=>j===i?{...x,costCenterId:v}:x)),'Cost centre')}
       {classSelect('bud-class-'+i,line.category,v=>setLines(a=>a.map((x,j)=>j===i?{...x,category:v}:x)),'Budget class')}
       {amountField('Annual amount ('+currency+')',line.amount,v=>setLines(a=>a.map((x,j)=>j===i?{...x,amount:v}:x)))}
       {canEdit&&lines.length>1&&<button type="button" className={btn} onClick={()=>setLines(a=>a.filter((_,j)=>j!==i))}>Remove line</button>}
      </div>)}
      {canEdit&&<button type="button" className={btn} onClick={()=>setLines(a=>[...a,{costCenterId:'',category:'OPEX',amount:0}])}><Plus className="h-4 w-4 inline"/> Add budget line</button>}
      <p className="font-semibold">Proposed total: {currencyFormat(lines.reduce((s,l)=>s+l.amount,0),currency)}</p>
      {reasonField}
      {canEdit&&<button type="button" disabled={busy||!leId||!currency} className="min-h-12 w-full rounded-xl bg-brand px-3 font-semibold text-onbrand disabled:opacity-40"
        onClick={()=>void submit('/api/org/corporate/budget/propose',{leId,fy,lines,reason})}>
        <FileCheck2 className="inline h-4 w-4 mr-2"/> Submit annual budget for Finance approval</button>}
    </div>}
  </section>}
  {section==='transfers'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="flex items-center gap-2 font-semibold"><ArrowLeftRight className="h-4 w-4"/> Internal budget transfer</h4>
   <p className="text-xs text-muted">Same legal entity and financial year only. No cash movement or GL posting. Cross-company funding is configured in Funding Agreements.</p>
   {!plan?<p className="text-sm text-muted">Approve an annual budget plan first.</p>:<>
    {centreSelect('transfer-from',transfer.fromCostCenterId,v=>setTransfer(a=>({...a,fromCostCenterId:v})),'Source cost centre')}
    {classSelect('transfer-fc',transfer.fromCategory,v=>setTransfer(a=>({...a,fromCategory:v})),'Source budget class')}
    {centreSelect('transfer-to',transfer.toCostCenterId,v=>setTransfer(a=>({...a,toCostCenterId:v})),'Destination cost centre')}
    {classSelect('transfer-tc',transfer.toCategory,v=>setTransfer(a=>({...a,toCategory:v})),'Destination budget class')}
    {amountField('Transfer ('+currency+')',transfer.amount,v=>setTransfer(a=>({...a,amount:v})))}
    {reasonField}
    {canEdit&&<button type="button" className="min-h-12 w-full rounded-xl bg-brand px-3 font-semibold text-onbrand disabled:opacity-40"
      disabled={busy} onClick={()=>void submit('/api/org/corporate/budget/transfer/propose',{leId,fy,...transfer,reason})}>
      Submit transfer for approval</button>}
   </>}
  </section>}
  {section==='exceptions'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="font-semibold">Spending exception and availability simulator</h4>
   <p className="text-xs text-muted">Approved exceptions are strictly source-document-scoped. Live Procurement/WO/PO consumption hooks are a later controlled integration; simulator results are advisory.</p>
   {!plan?<p className="text-sm text-muted">Approve an annual budget first.</p>:<>
    {centreSelect('exc-cc',exception.costCenterId,v=>setException(a=>({...a,costCenterId:v})),'Exception cost centre')}
    {classSelect('exc-cat',exception.category,v=>setException(a=>({...a,category:v})),'Budget class')}
    <label className="block text-sm text-muted">Source document ID<input className={field} value={exception.sourceDocumentId} disabled={!canEdit}
     onChange={e=>setException(a=>({...a,sourceDocumentId:e.target.value}))}/></label>
    {amountField('Maximum additional amount ('+currency+')',exception.amount,v=>setException(a=>({...a,amount:v})))}
    <label className="block text-sm text-muted">Expiry<input type="date" className={field} value={exception.expiresOn} disabled={!canEdit}
      onChange={e=>setException(a=>({...a,expiresOn:e.target.value}))}/></label>
    {reasonField}
    {canEdit&&<button type="button" className={btn+' w-full'} disabled={busy}
     onClick={()=>void submit('/api/org/corporate/budget/exception/propose',{leId,fy,...exception,reason})}>Request budget exception</button>}
    <div className="border-t border-line pt-3 space-y-2">
     <h5 className="font-semibold text-sm">Simulate available budget</h5>
     {centreSelect('sim-cc',simulate.costCenterId,v=>setSimulate(a=>({...a,costCenterId:v})),'Cost centre')}
     {classSelect('sim-class',simulate.category,v=>setSimulate(a=>({...a,category:v})),'Budget class')}
     {amountField('Proposed amount ('+currency+')',simulate.amount,v=>setSimulate(a=>({...a,amount:v})))}
     <label className="block text-sm text-muted">Document ID<input className={field} value={simulate.sourceDocumentId} onChange={e=>setSimulate(a=>({...a,sourceDocumentId:e.target.value}))}/></label>
     <label className="block text-sm text-muted">Approved exception FCR ID (optional)<input className={field} value={simulate.exceptionId} onChange={e=>setSimulate(a=>({...a,exceptionId:e.target.value}))}/></label>
     <button type="button" className={btn+' w-full'} onClick={async()=>{
       try{const r=await callBackend<Record<string,unknown>>('/api/org/corporate/budget/simulate',{leId,fy,...simulate});setSimulation(r);setError('')}
       catch(e){setError(errorOf(e))}
     }}>Simulate (no reservation)</button>
     {simulation&&<p className="rounded-lg border border-line p-3 text-sm">
       Result: <strong>{String(simulation.status)}</strong> · Available {currencyFormat(Number(simulation.availableMinor||0)/100,currency)} · Shortfall {currencyFormat(Number(simulation.shortfallMinor||0)/100,currency)} · Advisory only
      </p>}
    </div>
   </>}
  </section>}
  {section==='funding'&&<section className="rounded-xl border border-line bg-panel p-3 space-y-3">
   <h4 className="font-semibold">Funding agreement policies</h4>
   <p className="text-xs text-muted">Approvals use the existing Finance authority. Bilateral agreements require a separate beneficiary approval before policy confirmation. Loan, equity and recharge transactions will need later accounting and Treasury implementation.</p>
   <SelectField id="fund-benef" label="Beneficiary legal entity" disabled={!canEdit} value={funding.beneficiaryLegalEntityId} onChange={e=>setFunding(a=>({...a,beneficiaryLegalEntityId:e.target.value}))}>
    <option value="">Select beneficiary</option>{entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
   </SelectField>
   <SelectField id="fund-method" label="Funding method" disabled={!canEdit} value={funding.method} onChange={e=>setFunding(a=>({...a,method:e.target.value}))}>
    {FUNDING_METHODS.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
   </SelectField>
   <label className="block text-sm text-muted">Agreement / contract reference<input className={field} disabled={!canEdit} value={funding.agreementReference} onChange={e=>setFunding(a=>({...a,agreementReference:e.target.value}))}/></label>
   <label className="block text-sm text-muted">Currency (ISO code)<input className={field} maxLength={3} disabled={!canEdit} value={funding.currency} onChange={e=>setFunding(a=>({...a,currency:e.target.value.toUpperCase()}))}/></label>
   {amountField('Maximum funding amount',funding.amount,v=>setFunding(a=>({...a,amount:v})))}
   <label className="block text-sm text-muted">Funding purpose<textarea className={field+' min-h-20 p-3'} disabled={!canEdit} value={funding.purpose} onChange={e=>setFunding(a=>({...a,purpose:e.target.value}))}/></label>
   <div className="grid gap-2 sm:grid-cols-2">
    <label className="text-sm text-muted">Effective from<input type="date" className={field} disabled={!canEdit} value={funding.effectiveFrom} onChange={e=>setFunding(a=>({...a,effectiveFrom:e.target.value}))}/></label>
    <label className="text-sm text-muted">Effective to<input type="date" className={field} disabled={!canEdit} value={funding.effectiveTo} onChange={e=>setFunding(a=>({...a,effectiveTo:e.target.value}))}/></label>
   </div>
   <SelectField id="fund-settlement" label="Settlement policy" value={funding.settlementPolicy} disabled={!canEdit} onChange={e=>setFunding(a=>({...a,settlementPolicy:e.target.value}))}>
    {['IMMEDIATE','MONTHLY','QUARTERLY','ON_DEMAND','PER_AGREEMENT'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}
   </SelectField>
   <label className="block text-sm text-muted">Budget reference<input className={field} disabled={!canEdit} value={funding.budgetReference} onChange={e=>setFunding(a=>({...a,budgetReference:e.target.value}))}/></label>
   {reasonField}
   {canEdit&&<button type="button" className="min-h-12 w-full rounded-xl bg-brand px-3 font-semibold text-onbrand disabled:opacity-40" disabled={busy}
    onClick={()=>void submit('/api/org/corporate/funding/propose',{providerLegalEntityId:leId,...funding,reason})}>
    <Save className="h-4 w-4 mr-1 inline"/> Propose funding agreement</button>}
   <h5 className="font-semibold">Recorded funding agreements</h5>
   {agreements.length===0&&<p className="text-sm text-muted">No approved funding policy records for this legal entity.</p>}
   {agreements.map(ag=><div key={ag.id} className="rounded-lg border border-line p-3 space-y-1">
    <p className="text-sm font-semibold">{ag.agreementReference} · {ag.method}</p>
    <p className="text-xs text-muted">{ag.providerLegalEntityId} → {ag.beneficiaryLegalEntityId} · {currencyFormat(ag.limitMinor/100,ag.currency)}</p>
    <p className="text-xs text-muted">Status: {ag.status.replaceAll('_',' ')} · no cash posted</p>
    {canEdit&&ag.status==='awaiting_counterparty'&&ag.beneficiaryLegalEntityId===leId&&
      <button type="button" className={btn} disabled={busy}
       onClick={()=>void submit('/api/org/corporate/funding/counterparty/propose',{agreementId:ag.id,reason:reason||'Approve documented bilateral funding policy terms'})}>
       Propose beneficiary acceptance</button>}
   </div>)}
  </section>}
  <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0 text-brand"/>
   All material changes require Finance approval by a different authorized person. Budget commitment, exception consumption, actual spending enforcement and intercompany GL posting are not enabled in this milestone.</p>
 </div>;
}
