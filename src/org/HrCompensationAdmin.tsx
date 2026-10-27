import {useEffect,useMemo,useState} from 'react';
import {Banknote,BookOpenText,CheckCircle2,ChevronDown,Copy,FileWarning,Plus,Save,Search,ShieldCheck,SlidersHorizontal} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import HrCompensationApprovals from './HrCompensationApprovals';
import {estimateKenyaMonthly} from './hrPayPreview';
import {defaultLeaveEntitlement,type LeaveGradeEntitlement} from '../shared/hrLeaveDefaults';
import type {PayBase,PayCategory,PayConfig,PayItem,PayMethod} from '../../backend/hrCompensationConfig';

type Entity={id:string;name:string;countryCode:string;currency:string};
type Grade={code:string;title:string;rank:number;enabled:boolean};
const labels:Record<PayCategory,string>={
 payModels:'Pay & compensation models',overtime:'Overtime & premiums',allowances:'Allowances',
 benefits:'Benefits',incentives:'Incentives & bonus',leave:'Leave configuration',
 statutory:'Statutory contributions',taxes:'Employment taxes',taxReliefs:'Tax reliefs & exemptions',
 otherDeductions:'Other deductions',employerCosts:'Employer costs',controls:'Compliance & payroll controls',
};
const payBases:PayBase[]=['none','basic','gross','taxable','pensionable','net','hourly','daily','units','eligibleAmount'];
const methods:PayMethod[]=['fixed','percent','progressive','multiplier','formula','days','manual'];
const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const action='min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
const templateTitles=['payModels','overtime','allowances','benefits','incentives','leave','statutory','taxes','taxReliefs','otherDeductions','employerCosts','controls'] as PayCategory[];
const toPercent=(x:number)=>Number((x*100).toFixed(5));
export default function HrCompensationAdmin(){
 const [entity,setEntity]=useState(''),[entities,setEntities]=useState<Entity[]>([]);
 const [country,setCountry]=useState(''),[currency,setCurrency]=useState('');
 const [config,setConfig]=useState<PayConfig|null>(null),[grades,setGrades]=useState<Grade[]>([]);
 const [tab,setTab]=useState<PayCategory>('payModels');
 const [openCode,setOpenCode]=useState(''),[query,setQuery]=useState('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[saved,setSaved]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [exampleGross,setExampleGross]=useState(100000),[resident,setResident]=useState(true);
 type Activation={active:{version:number;sourceDraftVersion:number;approvalRef:string;activatedAt:string}|null;pendingRequestId:string};
 const [activation,setActivation]=useState<Activation|null>(null),[baseline,setBaseline]=useState('');
 const [cost,setCost]=useState(''),[submitReason,setSubmitReason]=useState(''),[ack,setAck]=useState(false),[refreshKey,setRefreshKey]=useState(0);
 const dirty=!!config&&JSON.stringify(config)!==baseline;
 const load=async(id='')=>{
  setLoading(true);setError('');
  try{
   const [r,g]=await Promise.all([
    callBackend<{entities:Entity[];current:Entity|null;countryCode:string;currency:string;config:PayConfig|null;saved:boolean;activation:Activation|null}>('/api/org/hr/compensation/get',{legalEntityId:id}),
    callBackend<{config:{jobGrades:Grade[]}|null}>('/api/org/hr/education/admin',{legalEntityId:id}),
   ]);
   setEntities(r.entities);setEntity(r.current?.id||'');setCountry(r.countryCode);
   setCurrency(r.currency);setConfig(r.config);setBaseline(JSON.stringify(r.config));setSaved(r.saved);setGrades(g.config?.jobGrades||[]);
   setActivation(r.activation);setCost('');setSubmitReason('');setAck(false);setRefreshKey(k=>k+1);
   setOpenCode('');setQuery('');
  }catch(e){setError(e instanceof Error?e.message:'Could not load compensation settings.')}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const update=(code:string,patch:Partial<PayItem>)=>setConfig(c=>c?{...c,items:c.items.map(x=>x.code===code?{...x,...patch}:x)}:c);
 const entitlement=(entry:PayItem,grade:string):LeaveGradeEntitlement=>
  entry.leaveEntitlements?.[grade]||defaultLeaveEntitlement(entry.mandatory,entry.amount,entry.code);
 const setEntitlement=(entry:PayItem,grade:string,change:Partial<LeaveGradeEntitlement>)=>{
  update(entry.code,{leaveEntitlements:{
   ...(entry.leaveEntitlements||{}),
   [grade]:{...entitlement(entry,grade),...change,requiresApprovedPlan:true},
  }});
 };
 const visible=useMemo(()=>config?.items.filter(x=>x.category===tab&&
  (!query.trim()||[x.name,x.code,x.description,x.applicability].some(v=>v.toLowerCase().includes(query.toLowerCase()))))||[],[config,tab,query]);
 const mandatory=useMemo(()=>config?.items.filter(x=>x.mandatory).length||0,[config]);
 const changeTab=(v:string)=>{setTab(v as PayCategory);setOpenCode('');setQuery('')};
 const save=async()=>{
  if(!entity||!config||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const r=await callBackend<{version:number;status:string}>('/api/org/hr/compensation/save',
    {legalEntityId:entity,config,expectedVersion:Number(config.version||0)});
   setConfig(c=>{const next=c?{...c,version:r.version}:c;setBaseline(JSON.stringify(next));return next;});
   setNotice('Saved draft revision '+r.version+'. No employee salary, payroll ledger or statutory remittance was changed.');
   setSaved(true);
  }catch(e){setError(e instanceof Error?e.message:'Could not save compensation draft.')}
  finally{setBusy(false)}
 };
 const create=()=>{
  if(!config||config.items.length>=250)return;
  const code='CUSTOM_'+Date.now().toString(36).toUpperCase();
  const entry:PayItem={code,name:'New component',description:'',category:tab,mandatory:false,
   enabled:false,gradeCodes:[],amount:0,rate:0,minimum:0,maximum:0,currency,
   method:'manual',base:'none',employerRate:0,employerAmount:0,
   effectiveFrom:'',effectiveTo:'',applicability:'',exemption:'',reference:'',dueRule:'',
   payrollTreatment:'informational',taxable:false,bands:[],options:{}};
  setConfig(c=>c?{...c,items:[...c.items,entry]}:c);
  setOpenCode(code);setQuery('');
 };
 const preview=useMemo(()=>{
  try{return config?.countryCode==='KE'?estimateKenyaMonthly(exampleGross,config,resident):null}
  catch{return null}
 },[config,exampleGross,resident]);
 const money=(value:number)=>new Intl.NumberFormat('en-KE',{maximumFractionDigits:2,minimumFractionDigits:2}).format(value);
 return <div className="min-w-0 space-y-4">
  <section className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
   <h2 className="flex items-center gap-2 text-lg font-bold"><Banknote className="h-5 w-5 text-brand"/>Pay, compensation & benefits</h2>
   <p className="mt-2 text-sm text-muted">Legal-entity policies, job-grade eligibility and country statutory reference rules. All configuration changes save as drafts only; this does not activate or post payroll.</p>
  </section>
  {loading&&<p role="status" className="text-sm text-muted">Loading compensation rules…</p>}
  {error&&<p role="alert" className="rounded-xl border border-line p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  <SelectField id="comp-legal-entity" label="Legal entity" value={entity} onChange={e=>void load(e.target.value)}>
   <option value="">Select legal entity</option>
   {entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
  </SelectField>
  {config&&<div className="grid grid-cols-2 gap-2">
   {[
    ['Country / currency',(country||'Unspecified')+' / '+(currency||'Unspecified')],
    ['Job grade options',String(grades.filter(g=>g.enabled).length)],
    ['Mandatory reference rows',String(mandatory)],
    ['Configuration',saved?'Draft saved':'Template only'],
   ].map(([label,value])=><div key={label} className="min-w-0 rounded-xl border border-line bg-panel p-3">
    <p className="text-xs text-muted">{label}</p><p className="mt-1 break-words text-sm font-bold">{value}</p>
   </div>)}
  </div>}
  {config&&!country&&<p className="rounded-xl border border-line p-3 text-sm text-amber-700">
   Set the legal entity country in Organization Structure. No national statutory rates will be guessed.
  </p>}
  {config&&country!=='KE'&&<p className="rounded-xl border border-line p-3 text-sm text-amber-700">
   This is an Africa-ready blank policy model, not a verified statutory template for {country||'this jurisdiction'}. Configure and legally review local tax, contributions, leave and wage orders before activation.
  </p>}
  {config&&country==='KE'&&<section className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
   <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-brand"/>Kenya reference set</h3>
   <p className="mt-2 text-xs text-muted">PAYE bands, NSSF, SHIF, Housing Levy and employer NITA levy include sources and calculation bases. These are legally governed reference defaults; mandatory rows cannot be disabled by job grade. Verify future amendments before use.</p>
  </section>}
  {config&&<>
   <div className="space-y-2">
    <SelectField id="comp-section-select" label="Configuration section" value={tab} onChange={e=>changeTab(e.target.value)}>
     {templateTitles.map(x=><option key={x} value={x}>{labels[x]} ({config.items.filter(i=>i.category===x).length})</option>)}
    </SelectField>
    <label className="relative block"><span className="sr-only">Search compensation components</span>
     <Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted"/>
     <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search component, code or applicability" autoComplete="off"
      className={field+' pl-10'}/>
    </label>
   </div>
   <div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="text-base font-bold">{labels[tab]} <span className="text-xs font-normal text-muted">({visible.length})</span></h3>
    <button type="button" className={action} onClick={create} disabled={config.items.length>=250}><Plus className="mr-1 inline h-4 w-4"/>Add</button>
   </div>
   <div className="space-y-2">{visible.map(x=>{
    const opened=openCode===x.code,locked=x.mandatory&&country==='KE';
    return <section key={x.code} className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel">
     <button type="button" aria-expanded={opened} onClick={()=>setOpenCode(opened?'':x.code)}
      className="flex min-h-16 w-full items-start gap-3 p-3 text-left">
      <span className="min-w-0 flex-1"><strong className="block break-words text-sm">{x.name}</strong>
       <span className="mt-1 block break-all font-mono text-xs text-brand">{x.code}</span>
       <span className="mt-1 block text-xs text-muted">{x.base} · {x.method}{x.gradeCodes.length?' · '+x.gradeCodes.length+' selected grades':' · All grades'}</span>
       <span className="mt-1 flex flex-wrap gap-1">
        {x.mandatory&&<span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700">Mandatory reference</span>}
        <span className="rounded-lg border border-line px-2 py-0.5 text-xs text-muted">{x.enabled?'Enabled':'Disabled'}</span>
       </span></span>
      <ChevronDown className={`mt-2 h-4 w-4 shrink-0 text-muted ${opened?'rotate-180':''}`}/>
     </button>
     {opened&&<div className="space-y-3 border-t border-line p-3">
      <p className="whitespace-pre-wrap break-words text-sm text-muted">{x.description||'Configure this component.'}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
       <label className="block text-sm text-muted">Component name<input maxLength={160} className={field} value={x.name} onChange={e=>update(x.code,{name:e.target.value})}/></label>
       <label className="block text-sm text-muted">Code <input className={field} readOnly value={x.code}/></label>
       <SelectField id={'comp-method-'+x.code} label="Calculation method" value={x.method} onChange={e=>update(x.code,{method:e.target.value as PayMethod})}>
        {methods.map(m=><option key={m} value={m}>{m}</option>)}
       </SelectField>
       <SelectField id={'comp-base-'+x.code} label="Calculation reference / base" value={x.base} onChange={e=>update(x.code,{base:e.target.value as PayBase})}>
        {payBases.map(b=><option key={b} value={b}>{b}</option>)}
       </SelectField>
       {([['amount','Fixed amount / entitlement'],['rate','Rate or multiplier'],['minimum','Minimum amount'],['maximum','Maximum / cap'],['employerRate','Employer rate'],['employerAmount','Employer fixed amount']] as const).map(([key,label])=>
        <label key={key} className="min-w-0 text-sm text-muted">{label}
         <input type="number" min={0} step="any" className={field}
          value={x[key]} onChange={e=>update(x.code,{[key]:Number(e.target.value)})}/>
         {(key==='rate'||key==='employerRate')&&x.method==='percent'&&<span className="text-xs text-muted">{toPercent(x[key])}% (enter 0.015 for 1.5%)</span>}
        </label>)}
       <label className="block text-sm text-muted">Effective from<input type="date" className={field} value={x.effectiveFrom} onChange={e=>update(x.code,{effectiveFrom:e.target.value})}/></label>
       <label className="block text-sm text-muted">Effective until<input type="date" className={field} value={x.effectiveTo} onChange={e=>update(x.code,{effectiveTo:e.target.value})}/></label>
      </div>
      {x.bands.length>0&&<div className="rounded-xl bg-page p-3">
       <h4 className="font-semibold">Progressive tax bands</h4>
       <div className="mt-2 space-y-2">{x.bands.map((b,i)=><div key={i} className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">Upper taxable income (KES)<input type="number" step="0.01" min={0}
         className={field} value={b.upTo??''} placeholder="No upper limit" onChange={e=>update(x.code,{bands:x.bands.map((a,j)=>i===j?{...a,upTo:e.target.value?Number(e.target.value):null}:a)})}/></label>
        <label className="text-xs text-muted">Tax rate (%)<input type="number" step="0.01" min={0} max={100} className={field}
         value={toPercent(b.rate)} onChange={e=>update(x.code,{bands:x.bands.map((a,j)=>i===j?{...a,rate:Number(e.target.value)/100}:a)})}/></label>
       </div>)}</div>
      </div>}
      <label className="block text-sm text-muted">Description<textarea rows={2} className={field+' min-h-20 p-3'} maxLength={600}
       value={x.description} onChange={e=>update(x.code,{description:e.target.value})}/></label>
      <label className="block text-sm text-muted">Eligibility / applicability<textarea rows={2} className={field+' min-h-20 p-3'}
       value={x.applicability} maxLength={400} onChange={e=>update(x.code,{applicability:e.target.value})}/></label>
      <label className="block text-sm text-muted">Exemptions and verification<textarea rows={2} className={field+' min-h-20 p-3'}
       value={x.exemption} maxLength={400} onChange={e=>update(x.code,{exemption:e.target.value})}/></label>
      <label className="block text-sm text-muted">Legal reference URL / source<input className={field} maxLength={600} value={x.reference}
       onChange={e=>update(x.code,{reference:e.target.value})}/></label>
      {x.reference.startsWith('https://')&&<a href={x.reference} target="_blank" rel="noopener noreferrer"
        className="block break-all text-xs font-semibold text-brand">Read legal source ↗</a>}
      <label className="block text-sm text-muted">Remittance / operational due rule<input className={field} maxLength={200}
       value={x.dueRule} onChange={e=>update(x.code,{dueRule:e.target.value})}/></label>
      <SelectField id={'comp-treatment-'+x.code} label="Payroll treatment" value={x.payrollTreatment}
       onChange={e=>update(x.code,{payrollTreatment:e.target.value as PayItem['payrollTreatment']})}>
       {['earning','employee_deduction','employer_cost','noncash','informational'].map(p=><option key={p} value={p}>{p}</option>)}
      </SelectField>
      {tab==='leave'?<div className="space-y-3 rounded-xl border border-line bg-page p-3">
       <h4 className="font-semibold">Leave entitlement by job grade</h4>
       <p className="text-xs text-muted">For every enabled grade, configure eligibility, annual entitlement, whether to accrue monthly and carry-forward. Employees must have an approved plan before applying. Statutory minimum leave types cannot be disabled by grade.</p>
       {grades.filter(g=>g.enabled).map(g=>{
        const e=entitlement(x,g.code);
        return <section key={g.code} className="space-y-3 rounded-xl border border-line bg-panel p-3">
         <strong className="text-sm">Grade {g.rank} · {g.title}</strong>
         <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-brand"
           disabled={locked} checked={e.eligible}
           onChange={event=>setEntitlement(x,g.code,{eligible:event.target.checked})}/>Eligible for this leave type
         </label>
         <div className="grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs text-muted">Entitlement per year
           <input type="number" min={0} max={366} step="0.25" className={field}
            value={e.daysPerYear} onChange={event=>setEntitlement(x,g.code,{daysPerYear:Number(event.target.value)})}/>
          </label>
          <SelectField id={'leave-unit-'+x.code+'-'+g.code} label="Entitlement unit"
           value={e.unit} onChange={event=>setEntitlement(x,g.code,{unit:event.target.value as LeaveGradeEntitlement['unit']})}>
           <option value="working_days">Working days</option><option value="calendar_days">Calendar days</option><option value="months">Calendar months</option>
          </SelectField>
          <label className="min-w-0 text-xs text-muted">Carry-forward allowance
           <input type="number" min={0} max={366} step="0.25" className={field}
            value={e.carryForwardDays} onChange={event=>setEntitlement(x,g.code,{carryForwardDays:Number(event.target.value)})}/>
          </label>
          <label className="flex items-center gap-2 text-sm">
           <input type="checkbox" className="h-5 w-5 accent-brand"
            checked={e.accrueMonthly} onChange={event=>setEntitlement(x,g.code,{accrueMonthly:event.target.checked})}/>
           Accrue monthly
          </label>
         </div>
         <p className="text-xs text-muted">{e.accrueMonthly?
          'Monthly accrual: '+(e.daysPerYear/12).toFixed(3)+' '+e.unit+' per month':
          'Entitlement made available annually (subject to employment and statutory eligibility)'} · Approved plan required</p>
        </section>;
       })}
       {!grades.some(g=>g.enabled)&&<p className="text-xs text-amber-700">Configure enabled job grades first under Education & Job Grades.</p>}
      </div>:<div className="rounded-xl border border-line bg-page p-3">
       <h4 className="text-sm font-semibold">Job grade applicability</h4>
       {locked?<p className="mt-2 text-xs text-amber-700">Legally mandatory reference applies regardless of grade; employee-specific statutory exemptions require verified evidence.</p>
       :<p className="mt-2 text-xs text-muted">No selected grades = all eligible grades. Select grades for a company-specific policy.</p>}
       <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {grades.filter(g=>g.enabled).map(g=><label key={g.code} className="flex min-h-11 items-center gap-2 rounded-lg border border-line p-2 text-xs">
         <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand" disabled={locked}
          checked={x.gradeCodes.includes(g.code)}
          onChange={e=>update(x.code,{gradeCodes:e.target.checked?[...x.gradeCodes,g.code]:x.gradeCodes.filter(c=>c!==g.code)})}/>
         <span className="min-w-0 break-words">Grade {g.rank} · {g.title}</span>
        </label>)}
       </div>
      </div>}
      <div className="flex flex-wrap items-center gap-4">
       <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand" disabled={locked}
        checked={x.enabled} onChange={e=>update(x.code,{enabled:e.target.checked})}/> Enabled</label>
       <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand"
        checked={x.taxable} onChange={e=>update(x.code,{taxable:e.target.checked})}/> Taxable component</label>
      </div>
     </div>}
    </section>;
   })}</div>
   {visible.length===0&&<p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">No items match this section and search.</p>}
   {country==='KE'&&preview&&<section className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
    <h3 className="flex items-center gap-2 font-bold"><SlidersHorizontal className="h-5 w-5 text-brand"/>Kenya illustrative salary scenario</h3>
    <p className="text-xs text-muted">Preview only: one monthly employee, regular cash gross only. Excludes additional allowances, insurance relief, loans, voluntary pension, noncash benefits, exemptions and other variable pay. No payroll postings or submissions.</p>
    <div className="grid grid-cols-2 gap-3">
     <label className="text-sm text-muted">Gross monthly pay (KES)<input className={field} type="number" min={0} max={100000000} step={500}
      value={exampleGross} onChange={e=>setExampleGross(Number(e.target.value))}/></label>
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand" checked={resident} onChange={e=>setResident(e.target.checked)}/> Resident personal relief</label>
    </div>
    <div className="grid grid-cols-2 gap-2">
     {[
      ['Gross','KES '+money(preview.gross)],['Employee NSSF','KES '+money(preview.nssf)],
      ['Employee SHIF','KES '+money(preview.shif)],['Employee Housing Levy','KES '+money(preview.ahl)],
      ['PAYE taxable base','KES '+money(preview.taxable)],['PAYE after personal relief','KES '+money(preview.paye)],
      ['Estimated net salary','KES '+money(preview.net)],['Total employer cost','KES '+money(preview.employerTotal)],
     ].map(([label,value])=><div key={label} className="rounded-xl bg-page p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 break-words font-semibold">{value}</p></div>)}
    </div>
    <p className="text-xs text-muted">Employer cost includes matched NSSF and Housing Levy plus NITA KES {money(preview.nita)}. The preview is not evidence of statutory filing correctness or a final payslip.</p>
   </section>}
   <div className="rounded-xl border border-line bg-panel p-3">
    <p className="flex items-start gap-2 text-xs text-muted"><FileWarning className="mt-0.5 h-4 w-4 shrink-0"/>
     Tax and pension obligations are country-specific and may change mid-year. Before payroll activation, require legal review, jurisdiction-specific test cases, effective dates, employer exemptions, approved job-grade mapping, GL and governance simulation.</p>
   </div>
   <button type="button" onClick={()=>void save()} disabled={busy||loading||!country||!currency}
    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-onbrand disabled:opacity-40">
    <Save className="h-5 w-5"/>Save compensation configuration as draft
   </button>
   <section className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
    <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-brand"/>Activation (Chart of Authority)</h3>
    <p className="text-xs text-muted">Saving changes only the draft. Leave entitlements and later payroll use the <strong>active</strong> policy, which changes only after approval level by level under this legal entity's Chart of Authority, by someone other than you.</p>
    <p className="rounded-xl bg-page p-3 text-sm">{activation?.active
     ?<>Active policy v{activation.active.version} (from draft v{activation.active.sourceDraftVersion}) · approved under {activation.active.approvalRef} on {activation.active.activatedAt.slice(0,10)}</>
     :<>No approved policy yet. Employees cannot plan leave in this legal entity until a policy is activated.</>}</p>
    {activation?.pendingRequestId?<p className="text-sm text-muted">Request {activation.pendingRequestId} is awaiting approval. Withdraw it below to submit a different draft.</p>
    :<div className="space-y-3">
     {dirty&&<p className="text-xs text-muted">Save the draft before submitting it for activation.</p>}
     <label className="block text-sm text-muted">Estimated annual cost impact ({currency||'legal entity currency'}) *
      <input className={field} type="number" inputMode="decimal" min={0} step="any" value={cost} onChange={e=>setCost(e.target.value)}
       placeholder="Additional yearly employer cost of this policy versus the active one"/></label>
     <label className="block text-sm text-muted">Reason for approval *
      <textarea className={field+' min-h-20 p-3'} maxLength={300} value={submitReason} onChange={e=>setSubmitReason(e.target.value)}/>
      <span className="text-xs">{submitReason.trim().length}/10 characters minimum</span></label>
     <label className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand" checked={ack} onChange={e=>setAck(e.target.checked)}/>
      <span>I have reviewed this draft against the law, our policies and the cost estimate.</span></label>
     <button type="button" disabled={busy||dirty||!saved||!(cost!==''&&Number(cost)>=0)||submitReason.trim().length<10||!ack}
      onClick={async()=>{
       setBusy(true);setError('');setNotice('');
       try{
        const r=await callBackend<{id:string}>('/api/org/hr/compensation/submit',{legalEntityId:entity,expectedVersion:Number(config.version||0),
         annualCostImpact:Number(cost),reason:submitReason.trim(),acknowledge:true});
        setNotice('Submitted '+r.id+' for approval under the Chart of Authority.');await load(entity);
       }catch(e){setError(e instanceof Error?e.message:'Could not submit for activation.')}
       finally{setBusy(false)}
      }}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-brand px-4 font-semibold text-brand disabled:opacity-40">
      <ShieldCheck className="h-5 w-5"/>Submit draft v{config.version} for activation</button>
    </div>}
   </section>
   <HrCompensationApprovals legalEntityId={entity} refreshKey={refreshKey} onChanged={()=>void load(entity)}/>
  </>}
 </div>;
}