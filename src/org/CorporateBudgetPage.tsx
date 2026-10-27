import {useEffect,useMemo,useState} from 'react';
import {Banknote,FileCheck2,Plus,Save,ShieldCheck,ArrowLeftRight,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import RichTable,{type Column} from '../components/RichTable';
import {Segmented,useConfirm} from '../components/screen';
import {BUDGET_CLASSES,FUNDING_METHODS,currencyDigits,majorFromMinor,type BudgetPlan,type FundingAgreement} from '../../backend/corporateBudget';

type Entity={id:string;code:string;name:string};
type Centre={id:string;code:string;name:string};
type InputLine={costCenterId:string;category:string;amount:number};
type Section='plan'|'transfers'|'exceptions'|'funding';
type PlanLine=BudgetPlan['lines'][number];
const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const primary='flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-40';
const TABLE_HEIGHT='h-[55dvh] min-h-[300px]';
const currencyFormat=(amount:number,currency:string)=>{
 let digits=2;try{digits=currencyDigits(currency)}catch{}
 return currency+' '+new Intl.NumberFormat('en',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(amount);
};
function Issues({items}:{items:string[]}){
 if(!items.length)return null;
 return <ul role="status" className="list-disc space-y-0.5 rounded-xl border border-line bg-amber-500/10 p-3 pl-7 text-xs text-soft">{items.map(x=><li key={x}>{x}</li>)}</ul>;
}
const today=()=>new Date().toISOString().slice(0,10);
export default function CorporateBudgetPage({canEdit}:{canEdit:boolean}){
 const [entities,setEntities]=useState<Entity[]>([]),[centres,setCentres]=useState<Centre[]>([]);
 const [leId,setLeId]=useState(''),[fy,setFy]=useState(new Date().getFullYear());
 const [currency,setCurrency]=useState(''),[plan,setPlan]=useState<BudgetPlan|null>(null);
 const [lines,setLines]=useState<InputLine[]>([{costCenterId:'',category:'OPEX',amount:0}]);
 const [revision,setRevision]=useState({costCenterId:'',category:'OPEX',delta:0});
 const [transfer,setTransfer]=useState({fromCostCenterId:'',fromCategory:'OPEX',toCostCenterId:'',toCategory:'OPEX',amount:0});
 const [exception,setException]=useState({costCenterId:'',category:'OPEX',sourceDocumentId:'',expiresOn:'',amount:0});
 const [simulate,setSimulate]=useState({costCenterId:'',category:'OPEX',sourceDocumentId:'',exceptionId:'',amount:0});
 const [simulation,setSimulation]=useState<Record<string,unknown>|null>(null);
 const blankFunding=(cur='')=>({beneficiaryLegalEntityId:'',method:'ENT',currency:cur,amount:0,
  agreementReference:'',purpose:'',effectiveFrom:'',effectiveTo:'',budgetReference:'',settlementPolicy:'PER_AGREEMENT'});
 const [funding,setFunding]=useState(blankFunding());
 const [agreements,setAgreements]=useState<FundingAgreement[]>([]);
 const [selectedAgreement,setSelectedAgreement]=useState('');
 const [section,setSection]=useState<Section>('plan');
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const {ask,sheet}=useConfirm();
 const errorOf=(e:unknown)=>e instanceof Error?e.message:'The request could not be completed.';
 useEffect(()=>{
  void (async()=>{
   try{
    const r=await callBackend<{entities:Entity[]}>('/api/org/corporate/budget/options');
    setEntities(r.entities);setLeId(v=>v||r.entities[0]?.id||'');
   }catch(e){setError(errorOf(e));}
  })();
 },[]);
 const refresh=async()=>{
  if(!leId)return;
  setLoading(true);setError('');
  try{
   const [p,f]=await Promise.all([
    callBackend<{plan:BudgetPlan|null;currency:string;centres:Centre[]}>('/api/org/corporate/budget/get',{leId,fy}),
    callBackend<{agreements:FundingAgreement[]}>('/api/org/corporate/funding/list',{leId}),
   ]);
   setPlan(p.plan);setCurrency(p.currency);setCentres(p.centres);setAgreements(f.agreements);
   setFunding(x=>({...x,currency:x.currency||p.currency}));
  }catch(e){setPlan(null);setError(errorOf(e));}
  finally{setLoading(false)}
 };
 useEffect(()=>{setSelectedAgreement('');setSimulation(null);void refresh()},[leId,fy]);
 /** Every Finance request asks for its own reason at submission time (no shared or default reason). */
 const submit=(title:string,confirmLabel:string,message:string,path:string,payload:Record<string,unknown>,after?:()=>void)=>{
  setError('');setNotice('');
  ask({title,confirmLabel,message,reason:{label:'Business reason for Finance approval',minLength:10,placeholder:'Why is this needed? Stored with the request and the audit trail.'}},
   async reason=>{
    const r=await callBackend<{id:string}>(path,{...payload,reason});
    setNotice('Finance request '+r.id+' submitted. A different authorized approver decides it under the Chart of Authority. No accounting or cash movement was performed.');
    after?.();
    await refresh();
   });
 };
 const centreName=(id:string)=>centres.find(c=>c.id===id)?.name||id;
 const entityName=(id:string)=>entities.find(e=>e.id===id)?.name||id;
 const centreSelect=(id:string,value:string,cb:(v:string)=>void,label:string)=>
  <SelectField id={id} label={label} value={value} onChange={e=>cb(e.target.value)} disabled={!canEdit}>
   <option value="">Select cost centre</option>
   {centres.map(c=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
  </SelectField>;
 const classSelect=(id:string,value:string,cb:(v:string)=>void,label:string)=>
  <SelectField id={id} label={label} value={value} onChange={e=>cb(e.target.value)} disabled={!canEdit}>
   {BUDGET_CLASSES.map(c=><option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
  </SelectField>;
 const amountField=(label:string,value:number,cb:(v:number)=>void,signed=false)=>
  <label className="block text-sm text-muted">{label}<input className={field} type="number" inputMode="decimal" min={signed?undefined:0} step="any" disabled={!canEdit}
    value={value||''} onChange={e=>cb(Number(e.target.value))}/></label>;
 const available=(l:PlanLine)=>l.approvedMinor+l.adjustmentsMinor-l.committedMinor-l.actualMinor;
 const lineOf=(cc:string,cat:string)=>plan?.lines.find(l=>l.costCenterId===cc&&l.category===cat);

 // ---- Verification (mirrors server rules) ----
 const planIssues=useMemo(()=>{
  const out:string[]=[];
  if(!currency)out.push('Configure the legal entity functional currency in Finance first.');
  const keys=new Set<string>();
  lines.forEach((l,i)=>{
   if(!l.costCenterId)out.push('Line '+(i+1)+': select a cost centre.');
   if(!(l.amount>0))out.push('Line '+(i+1)+': amount must be greater than zero.');
   const k=l.costCenterId+'|'+l.category;if(l.costCenterId&&keys.has(k))out.push('Line '+(i+1)+': cost centre and class are already budgeted above.');keys.add(k);
  });
  return out;
 },[lines,currency]);
 const revisionIssues=useMemo(()=>{
  const out:string[]=[];
  if(!revision.costCenterId)out.push('Select a cost centre.');
  if(!revision.delta)out.push('Enter a non-zero revision.');
  const l=lineOf(revision.costCenterId,revision.category);
  if(revision.delta<0&&!l)out.push('A reduction needs an existing budget line.');
  if(l&&revision.delta<0&&-revision.delta*10**(currencyDigitsSafe(currency))>available(l))out.push('The reduction exceeds the available (uncommitted, unspent) budget.');
  return out;
 },[revision,plan,currency]);
 const transferIssues=useMemo(()=>{
  const out:string[]=[];
  if(!transfer.fromCostCenterId||!transfer.toCostCenterId)out.push('Select source and destination cost centres.');
  if(transfer.fromCostCenterId===transfer.toCostCenterId&&transfer.fromCategory===transfer.toCategory)out.push('Source and destination must differ.');
  if(!(transfer.amount>0))out.push('Transfer amount must be greater than zero.');
  const src=lineOf(transfer.fromCostCenterId,transfer.fromCategory);
  if(transfer.fromCostCenterId&&!src)out.push('The source cost centre has no budget in that class.');
  if(src&&transfer.amount*10**currencyDigitsSafe(currency)>available(src))out.push('Transfer exceeds the source’s available budget.');
  return out;
 },[transfer,plan,currency]);
 const exceptionIssues=useMemo(()=>{
  const out:string[]=[];
  if(!exception.costCenterId)out.push('Select a cost centre.');
  if(!exception.sourceDocumentId.trim())out.push('Enter the source document ID the exception is limited to.');
  if(!(exception.amount>0))out.push('Maximum additional amount must be greater than zero.');
  if(!exception.expiresOn)out.push('Set an expiry date.');else if(exception.expiresOn<today())out.push('Expiry date is in the past.');
  return out;
 },[exception]);
 const fundingIssues=useMemo(()=>{
  const out:string[]=[];const f=funding;
  if(!f.beneficiaryLegalEntityId)out.push('Select the beneficiary legal entity.');
  else if(f.beneficiaryLegalEntityId===leId)out.push('Beneficiary must be a different legal entity.');
  if(!f.agreementReference.trim())out.push('Agreement / contract reference is required.');
  if(!/^[A-Z]{3}$/.test(f.currency))out.push('Currency must be a 3-letter ISO code.');
  if(!(f.amount>0))out.push('Maximum funding amount must be greater than zero.');
  if(!f.purpose.trim())out.push('Funding purpose is required.');
  if(!f.effectiveFrom||!f.effectiveTo)out.push('Effective from and to dates are required.');
  else if(f.effectiveTo<f.effectiveFrom)out.push('Effective to date must be on or after the start date.');
  return out;
 },[funding,leId]);

 const planColumns:Column<PlanLine>[]=[
  {key:'cc',label:'Cost centre',value:l=>centreName(l.costCenterId)},
  {key:'class',label:'Class',value:l=>l.category},
  {key:'approved',label:'Approved',type:'number',value:l=>majorFromMinor(l.approvedMinor,currency)},
  {key:'adjust',label:'Adjustments',type:'number',value:l=>majorFromMinor(l.adjustmentsMinor,currency)},
  {key:'committed',label:'Committed',type:'number',value:l=>majorFromMinor(l.committedMinor,currency)},
  {key:'actual',label:'Actual',type:'number',value:l=>majorFromMinor(l.actualMinor,currency)},
  {key:'available',label:'Available',type:'number',value:l=>majorFromMinor(available(l),currency)},
 ];
 const agreementColumns:Column<FundingAgreement>[]=[
  {key:'ref',label:'Reference',value:a=>a.agreementReference},
  {key:'method',label:'Method',value:a=>a.method},
  {key:'provider',label:'Provider',value:a=>entityName(a.providerLegalEntityId)},
  {key:'beneficiary',label:'Beneficiary',value:a=>entityName(a.beneficiaryLegalEntityId)},
  {key:'currency',label:'Currency',value:a=>a.currency},
  {key:'limit',label:'Limit',type:'number',value:a=>majorFromMinor(a.limitMinor,a.currency)},
  {key:'status',label:'Status',value:a=>a.status.replaceAll('_',' ')},
 ];
 const chosenAgreement=agreements.find(a=>a.id===selectedAgreement);

 return <div className="min-w-0 space-y-3">
  {sheet}
  <header className="flex items-start gap-2">
   <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-brand"/>
   <p className="text-xs text-muted"><strong className="text-sm text-ink">Funding & Budgets.</strong> Legal-entity budgets, transfers, exceptions and funding policies, each approved under the Chart of Authority. No cash moves and nothing posts here.</p>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
   <SelectField id="cb-le" label="Legal entity" value={leId} onChange={e=>setLeId(e.target.value)}>
    <option value="">Select legal entity</option>{entities.map(e=><option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}
   </SelectField>
   <label className="block text-sm text-muted">Financial year
    <input type="number" inputMode="numeric" min="1900" max="2500" className={field} value={fy} onChange={e=>setFy(Number(e.target.value))}/></label>
  </div>
  <p className="text-xs text-muted">Functional currency: {currency||'not configured'} (from Finance settings).</p>
  <Segmented label="Budget sections" value={section} onChange={setSection} options={[
   {value:'plan',label:'Annual Budget'},{value:'transfers',label:'Transfers'},{value:'exceptions',label:'Exceptions'},
   {value:'funding',label:'Funding',count:agreements.length},
  ]}/>
  {loading&&<p role="status" className="text-sm text-muted">Loading finance configuration…</p>}

  {section==='plan'&&<section className="space-y-3">
   {plan?<>
    <p className="text-xs text-muted">Approved plan · version {plan.version} · reference {plan.approvalRef}</p>
    <RichTable id="corp-budget-plan" title={'Budget FY'+fy} fileName={'Budget_FY'+fy} columns={planColumns} rows={plan.lines}
     rowKey={l=>l.costCenterId+'|'+l.category} height={TABLE_HEIGHT} empty="The plan has no lines."/>
    {canEdit&&<details className="rounded-xl border border-line bg-panel p-3">
     <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold"><Plus className="h-4 w-4 text-brand"/>Governed budget revision</summary>
     <div className="mt-3 space-y-3">
      <p className="text-xs text-muted">Increase (+) or reduce (−) a line, or add a new line with a positive amount. Committed or spent budget cannot be removed. The original budget is preserved.</p>
      {centreSelect('rev-cc',revision.costCenterId,v=>setRevision(a=>({...a,costCenterId:v})),'Cost centre *')}
      {classSelect('rev-class',revision.category,v=>setRevision(a=>({...a,category:v})),'Budget class')}
      {amountField('Revision (+ increase / − decrease), '+currency+' *',revision.delta,v=>setRevision(a=>({...a,delta:v})),true)}
      <Issues items={revisionIssues}/>
      <button type="button" className={primary} disabled={revisionIssues.length>0}
       onClick={()=>submit('Propose budget revision?','Submit for approval',
        (revision.delta>0?'Increase ':'Reduce ')+centreName(revision.costCenterId)+' '+revision.category+' by '+currencyFormat(Math.abs(revision.delta),currency)+'.',
        '/api/org/corporate/budget/revision/propose',{leId,fy,changes:[revision]},()=>setRevision({costCenterId:'',category:'OPEX',delta:0}))}>
       <FileCheck2 className="h-4 w-4"/>Propose budget revision</button>
     </div>
    </details>}
   </>:<section className="space-y-3 rounded-xl border border-line bg-panel p-3">
    <h4 className="font-semibold">Prepare the annual budget</h4>
    <p className="text-xs text-muted">Budget by cost centre and class. Approval creates one immutable opening plan for the legal entity and year; later changes use governed revisions and transfers.</p>
    {lines.map((line,i)=><div className="space-y-2 rounded-lg border border-line p-3" key={i}>
     <div className="flex items-center justify-between"><strong className="text-sm">Line {i+1}</strong>
      {canEdit&&lines.length>1&&<button type="button" aria-label={'Remove line '+(i+1)} className="flex h-11 w-11 items-center justify-center rounded-lg border border-line" onClick={()=>setLines(a=>a.filter((_,j)=>j!==i))}><Trash2 className="h-4 w-4"/></button>}</div>
     {centreSelect('bud-cc-'+i,line.costCenterId,v=>setLines(a=>a.map((x,j)=>j===i?{...x,costCenterId:v}:x)),'Cost centre *')}
     {classSelect('bud-class-'+i,line.category,v=>setLines(a=>a.map((x,j)=>j===i?{...x,category:v}:x)),'Budget class')}
     {amountField('Annual amount ('+currency+') *',line.amount,v=>setLines(a=>a.map((x,j)=>j===i?{...x,amount:v}:x)))}
    </div>)}
    {canEdit&&<button type="button" className={btn} disabled={lines.length>=200} onClick={()=>setLines(a=>[...a,{costCenterId:'',category:'OPEX',amount:0}])}><Plus className="mr-1 inline h-4 w-4"/>Add budget line</button>}
    <p className="font-semibold">Proposed total: {currencyFormat(lines.reduce((s,l)=>s+(l.amount||0),0),currency)}</p>
    {canEdit&&<><Issues items={planIssues}/>
     <button type="button" disabled={planIssues.length>0||!leId} className={primary}
      onClick={()=>submit('Submit FY'+fy+' budget?','Submit for approval',
       lines.length+' lines totalling '+currencyFormat(lines.reduce((s,l)=>s+l.amount,0),currency)+'. Approval levels follow the Chart of Authority for this amount.',
       '/api/org/corporate/budget/propose',{leId,fy,lines})}>
      <FileCheck2 className="h-4 w-4"/>Submit annual budget for approval</button></>}
   </section>}
  </section>}

  {section==='transfers'&&<section className="space-y-3 rounded-xl border border-line bg-panel p-3">
   <h4 className="flex items-center gap-2 font-semibold"><ArrowLeftRight className="h-4 w-4"/>Internal budget transfer</h4>
   <p className="text-xs text-muted">Same legal entity and financial year only. No cash movement or GL posting. Cross-company funding uses Funding agreements.</p>
   {!plan?<p className="text-sm text-muted">Approve an annual budget plan first.</p>:<>
    {centreSelect('transfer-from',transfer.fromCostCenterId,v=>setTransfer(a=>({...a,fromCostCenterId:v})),'Source cost centre *')}
    {classSelect('transfer-fc',transfer.fromCategory,v=>setTransfer(a=>({...a,fromCategory:v})),'Source budget class')}
    {(()=>{const l=lineOf(transfer.fromCostCenterId,transfer.fromCategory);return l?<p className="text-xs text-muted">Available at source: {currencyFormat(majorFromMinor(available(l),currency),currency)}</p>:null;})()}
    {centreSelect('transfer-to',transfer.toCostCenterId,v=>setTransfer(a=>({...a,toCostCenterId:v})),'Destination cost centre *')}
    {classSelect('transfer-tc',transfer.toCategory,v=>setTransfer(a=>({...a,toCategory:v})),'Destination budget class')}
    {amountField('Transfer ('+currency+') *',transfer.amount,v=>setTransfer(a=>({...a,amount:v})))}
    {canEdit&&<><Issues items={transferIssues}/>
     <button type="button" className={primary} disabled={transferIssues.length>0}
      onClick={()=>submit('Submit budget transfer?','Submit for approval',
       'Move '+currencyFormat(transfer.amount,currency)+' from '+centreName(transfer.fromCostCenterId)+' '+transfer.fromCategory+' to '+centreName(transfer.toCostCenterId)+' '+transfer.toCategory+'.',
       '/api/org/corporate/budget/transfer/propose',{leId,fy,...transfer},()=>setTransfer({fromCostCenterId:'',fromCategory:'OPEX',toCostCenterId:'',toCategory:'OPEX',amount:0}))}>
      Submit transfer for approval</button></>}
   </>}
  </section>}

  {section==='exceptions'&&<section className="space-y-3 rounded-xl border border-line bg-panel p-3">
   <h4 className="font-semibold">Spending exception and availability simulator</h4>
   <p className="text-xs text-muted">An approved exception applies to one source document only. Simulator results are advisory.</p>
   {!plan?<p className="text-sm text-muted">Approve an annual budget first.</p>:<>
    {centreSelect('exc-cc',exception.costCenterId,v=>setException(a=>({...a,costCenterId:v})),'Exception cost centre *')}
    {classSelect('exc-cat',exception.category,v=>setException(a=>({...a,category:v})),'Budget class')}
    <label className="block text-sm text-muted">Source document ID *<input className={field} value={exception.sourceDocumentId} disabled={!canEdit} maxLength={80}
     onChange={e=>setException(a=>({...a,sourceDocumentId:e.target.value.trim()}))}/></label>
    {amountField('Maximum additional amount ('+currency+') *',exception.amount,v=>setException(a=>({...a,amount:v})))}
    <label className="block text-sm text-muted">Expiry *<input type="date" min={today()} className={field} value={exception.expiresOn} disabled={!canEdit}
     onChange={e=>setException(a=>({...a,expiresOn:e.target.value}))}/></label>
    {canEdit&&<><Issues items={exceptionIssues}/>
     <button type="button" className={primary} disabled={exceptionIssues.length>0}
      onClick={()=>submit('Request budget exception?','Submit for approval',
       'Allow up to '+currencyFormat(exception.amount,currency)+' over budget for document '+exception.sourceDocumentId+' until '+exception.expiresOn+'.',
       '/api/org/corporate/budget/exception/propose',{leId,fy,...exception},()=>setException({costCenterId:'',category:'OPEX',sourceDocumentId:'',expiresOn:'',amount:0}))}>
      Request budget exception</button></>}
    <div className="space-y-2 border-t border-line pt-3">
     <h5 className="text-sm font-semibold">Simulate available budget</h5>
     {centreSelect('sim-cc',simulate.costCenterId,v=>setSimulate(a=>({...a,costCenterId:v})),'Cost centre')}
     {classSelect('sim-class',simulate.category,v=>setSimulate(a=>({...a,category:v})),'Budget class')}
     {amountField('Proposed amount ('+currency+')',simulate.amount,v=>setSimulate(a=>({...a,amount:v})))}
     <label className="block text-sm text-muted">Document ID<input className={field} value={simulate.sourceDocumentId} onChange={e=>setSimulate(a=>({...a,sourceDocumentId:e.target.value.trim()}))}/></label>
     <label className="block text-sm text-muted">Approved exception request ID (optional)<input className={field} value={simulate.exceptionId} placeholder="FCR00000000" onChange={e=>setSimulate(a=>({...a,exceptionId:e.target.value.trim().toUpperCase()}))}/></label>
     <button type="button" className={btn+' w-full'} disabled={!simulate.costCenterId||!(simulate.amount>0)} onClick={async()=>{
       try{setSimulation(await callBackend<Record<string,unknown>>('/api/org/corporate/budget/simulate',{leId,fy,...simulate}));setError('')}
       catch(e){setError(errorOf(e))}
     }}>Simulate (no reservation)</button>
     {simulation&&<p className="rounded-lg border border-line p-3 text-sm">
      Result: <strong>{String(simulation.status)}</strong> · Available {currencyFormat(majorFromMinor(Number(simulation.availableMinor||0),currency),currency)} · Shortfall {currencyFormat(majorFromMinor(Number(simulation.shortfallMinor||0),currency),currency)} · advisory only</p>}
    </div>
   </>}
  </section>}

  {section==='funding'&&<section className="space-y-3">
   {chosenAgreement&&<div className="space-y-2 rounded-xl border border-line bg-panel p-3">
    <strong className="text-sm">{chosenAgreement.agreementReference} · {chosenAgreement.method}</strong>
    <p className="text-xs text-muted">{entityName(chosenAgreement.providerLegalEntityId)} → {entityName(chosenAgreement.beneficiaryLegalEntityId)} · {currencyFormat(majorFromMinor(chosenAgreement.limitMinor,chosenAgreement.currency),chosenAgreement.currency)} · {chosenAgreement.status.replaceAll('_',' ')} · no cash posted</p>
    {canEdit&&chosenAgreement.status==='awaiting_counterparty'&&chosenAgreement.beneficiaryLegalEntityId===leId&&
     <button type="button" className={btn} onClick={()=>submit('Accept '+chosenAgreement.agreementReference+'?','Submit acceptance',
      'Submits this entity’s acceptance of the bilateral funding policy for independent Finance approval.',
      '/api/org/corporate/funding/counterparty/propose',{agreementId:chosenAgreement.id})}>Propose beneficiary acceptance</button>}
   </div>}
   <RichTable id="corp-funding-agreements" title="Funding agreements" fileName="Funding_agreements" columns={agreementColumns}
    rows={agreements} rowKey={a=>a.id} onRowClick={a=>setSelectedAgreement(a.id===selectedAgreement?'':a.id)}
    rowClassName={a=>a.id===selectedAgreement?'bg-brand/10':''} height={TABLE_HEIGHT} empty="No funding policy records for this legal entity."/>
   {canEdit&&<details className="rounded-xl border border-line bg-panel p-3">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold"><Save className="h-4 w-4 text-brand"/>Propose a funding agreement</summary>
    <div className="mt-3 space-y-3">
     <p className="text-xs text-muted">Bilateral agreements need a separate beneficiary approval. Loans, equity and recharges need later accounting and Treasury steps.</p>
     <SelectField id="fund-benef" label="Beneficiary legal entity *" value={funding.beneficiaryLegalEntityId} onChange={e=>setFunding(a=>({...a,beneficiaryLegalEntityId:e.target.value}))}>
      <option value="">Select beneficiary</option>{entities.filter(e=>e.id!==leId).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
     </SelectField>
     <SelectField id="fund-method" label="Funding method" value={funding.method} onChange={e=>setFunding(a=>({...a,method:e.target.value}))}>
      {FUNDING_METHODS.map(m=><option key={m.code} value={m.code}>{m.code} — {m.label}</option>)}
     </SelectField>
     <label className="block text-sm text-muted">Agreement / contract reference *<input className={field} maxLength={80} value={funding.agreementReference} onChange={e=>setFunding(a=>({...a,agreementReference:e.target.value}))}/></label>
     <label className="block text-sm text-muted">Currency (ISO code) *<input className={field} maxLength={3} value={funding.currency} onChange={e=>setFunding(a=>({...a,currency:e.target.value.toUpperCase().replace(/[^A-Z]/g,'')}))}/></label>
     {amountField('Maximum funding amount *',funding.amount,v=>setFunding(a=>({...a,amount:v})))}
     <label className="block text-sm text-muted">Funding purpose *<textarea className={field+' min-h-20 p-3'} maxLength={500} value={funding.purpose} onChange={e=>setFunding(a=>({...a,purpose:e.target.value}))}/></label>
     <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-sm text-muted">Effective from *<input type="date" className={field} value={funding.effectiveFrom} onChange={e=>setFunding(a=>({...a,effectiveFrom:e.target.value}))}/></label>
      <label className="text-sm text-muted">Effective to *<input type="date" min={funding.effectiveFrom||undefined} className={field} value={funding.effectiveTo} onChange={e=>setFunding(a=>({...a,effectiveTo:e.target.value}))}/></label>
     </div>
     <SelectField id="fund-settlement" label="Settlement policy" value={funding.settlementPolicy} onChange={e=>setFunding(a=>({...a,settlementPolicy:e.target.value}))}>
      {['IMMEDIATE','MONTHLY','QUARTERLY','ON_DEMAND','PER_AGREEMENT'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}
     </SelectField>
     <label className="block text-sm text-muted">Budget reference<input className={field} maxLength={80} value={funding.budgetReference} onChange={e=>setFunding(a=>({...a,budgetReference:e.target.value}))}/></label>
     <Issues items={fundingIssues}/>
     <button type="button" className={primary} disabled={fundingIssues.length>0}
      onClick={()=>submit('Propose funding agreement '+funding.agreementReference+'?','Submit for approval',
       entityName(leId)+' → '+entityName(funding.beneficiaryLegalEntityId)+', up to '+currencyFormat(funding.amount,funding.currency)+'.',
       '/api/org/corporate/funding/propose',{providerLegalEntityId:leId,...funding},()=>setFunding(blankFunding(currency)))}>
      <Save className="h-4 w-4"/>Propose funding agreement</button>
    </div>
   </details>}
  </section>}

  <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0 text-brand"/>
   Each submission asks for its own reason and goes to a different authorized approver under the Chart of Authority. Commitment enforcement, exception consumption and intercompany posting are separate gated steps.</p>
 </div>;
}
function currencyDigitsSafe(c:string){try{return currencyDigits(c)}catch{return 2}}
