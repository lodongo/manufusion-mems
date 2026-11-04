import {useCallback,useEffect,useMemo,useState} from 'react';
import {BadgeCheck,Banknote,FileWarning,Lock,Plus,Save,ShieldCheck,Trash2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import {Segmented,messageOf,useConfirm} from '../components/screen';
import Sheet from '../components/Sheet';
import RichTable,{type Column} from '../components/RichTable';
import HrCompensationApprovals from './HrCompensationApprovals';
import {Choice,NumField,btn,field,fmt,pct,primary} from './hrFormParts';
import {EXCEPTION_EFFECTS,type ExceptionEffect,type PayException} from '../shared/hrPayslip';
import type {PayBase,PayCategory,PayConfig,PayItem,PayMethod} from '../../backend/hrCompensationConfig';

type Entity={id:string;name:string;countryCode:string;currency:string};
type Activation={active:{version:number;sourceDraftVersion:number;approvalRef:string;activatedAt:string}|null;pendingRequestId:string};
type Loaded={entities:Entity[];current:Entity|null;countryCode:string;currency:string;config:PayConfig|null;saved:boolean;canEdit:boolean;activation:Activation|null};
type View=PayCategory|'activation';

/** Menu order. Each entry opens one family of components for the selected legal entity. */
const MENU:Array<[PayCategory,string,string]>=[
 ['payModels','Pay models','Pay & compensation models'],['overtime','Overtime','Overtime & premiums'],['allowances','Allowances','Allowances'],
 ['benefits','Benefits','Benefits'],['incentives','Incentives','Incentives & bonus'],['leave','Leave','Leave types'],
 ['statutory','Statutory','Statutory contributions'],['taxes','Taxes','Employment taxes'],['taxReliefs','Reliefs','Tax reliefs & exemptions'],
 ['otherDeductions','Deductions','Other deductions'],['employerCosts','Employer costs','Employer costs'],['controls','Controls','Compliance & payroll controls'],
];
const EXCEPTION_CATEGORIES:PayCategory[]=['statutory','taxes','taxReliefs','employerCosts','otherDeductions'];
const METHODS:Array<{value:PayMethod;label:string}>=[
 {value:'fixed',label:'Fixed amount'},{value:'percent',label:'Percent'},{value:'progressive',label:'Progressive bands'},{value:'multiplier',label:'Multiplier'},
 {value:'formula',label:'Formula'},{value:'days',label:'Days'},{value:'manual',label:'Manual'}];
const BASES:Array<{value:PayBase;label:string}>=[
 {value:'none',label:'None'},{value:'basic',label:'Basic pay'},{value:'gross',label:'Gross pay'},{value:'taxable',label:'Taxable pay'},{value:'pensionable',label:'Pensionable pay'},
 {value:'net',label:'Net pay'},{value:'hourly',label:'Hourly rate'},{value:'daily',label:'Daily rate'},{value:'units',label:'Units'},{value:'eligibleAmount',label:'Eligible amount'}];
const TREATMENTS:Array<{value:PayItem['payrollTreatment'];label:string}>=[
 {value:'earning',label:'Earning'},{value:'employee_deduction',label:'Employee deduction'},{value:'employer_cost',label:'Employer cost'},{value:'noncash',label:'Non-cash'},{value:'informational',label:'Informational'}];
const EFFECT_TEXT:Record<ExceptionEffect,{label:string;hint:string}>={
 exempt:{label:'Fully exempt',hint:'The person pays nothing under this item.'},
 exempt_first:{label:'First amount exempt',hint:'The first monthly amount below is not charged.'},
 not_entitled:{label:'Not entitled',hint:'The person does not get this relief.'},
 reroute:{label:'Pay a tier elsewhere',hint:'The upper tier goes to an approved scheme instead of this one.'},
 rate:{label:'Different rate',hint:'A different rate is used instead of the standard one.'},
 cap:{label:'Different monthly maximum',hint:'A different monthly maximum is used instead of the standard one.'},
};
const token=()=>Math.random().toString(36).slice(2,7).toUpperCase().replace(/[^A-Z0-9]/g,'X').padEnd(5,'X');
const EXCEPTION_CODE=/^[A-Z0-9_]{3,48}$/;
const isHttps=(s:string)=>/^https:\/\//i.test(s.trim());

const valueText=(x:PayItem)=>{
 if(x.method==='progressive')return x.bands.length+' bands';
 if(x.method==='percent')return pct(x.rate)+'%'+(x.minimum>0?' · min '+fmt(x.minimum):'')+(x.maximum>0?' · max '+fmt(x.maximum):'');
 if(x.method==='multiplier')return '× '+x.rate;
 if(x.method==='fixed'||x.method==='days')return x.amount>0?fmt(x.amount)+(x.method==='days'?' days':''):'—';
 return x.method==='manual'?'Set per person':x.method;
};
const canHaveExceptions=(x:PayItem)=>EXCEPTION_CATEGORIES.includes(x.category);
const effectsFor=(x:PayItem):ExceptionEffect[]=>EXCEPTION_EFFECTS.filter(e=>
 e==='not_entitled'?x.category==='taxReliefs':e==='rate'||e==='cap'?x.category==='statutory':e==='reroute'?x.options.tiers===true:true);

function exceptionIssues(item:PayItem,taken:Set<string>):string[]{
 const out:string[]=[];
 const list=item.exceptions||[];
 if(list.length>12)out.push('At most 12 exceptions per item.');
 const seen=new Set<string>();
 list.forEach((e,i)=>{
  const at='Exception '+(i+1)+': ';
  if(!EXCEPTION_CODE.test(e.code))out.push(at+'the code uses capital letters, numbers and underscore (3 to 48 characters).');
  else if(seen.has(e.code)||taken.has(e.code))out.push(at+'the code '+e.code+' is already used.');
  seen.add(e.code);
  if(e.name.trim().length<2)out.push(at+'enter a name.');
  if(!effectsFor(item).includes(e.effect))out.push(at+'choose what it does.');
  if((e.effect==='exempt_first'||e.effect==='cap'||e.effect==='rate')&&!(e.value>0))out.push(at+'enter the amount or rate it uses.');
  if(e.effect==='rate'&&e.value>2)out.push(at+'a rate cannot be above 200%.');
  if(e.enabled&&e.evidence.trim().length<3)out.push(at+'state the evidence a person must hold before it can be applied.');
  if(e.reference.trim()&&!isHttps(e.reference))out.push(at+'a reference must be a web address starting with https://.');
 });
 return out;
}
function itemIssues(item:PayItem,taken:Set<string>):string[]{
 const out:string[]=[];
 if(item.name.trim().length<2)out.push('Enter a name for this component.');
 (['amount','rate','minimum','maximum','employerRate','employerAmount'] as const).forEach(k=>{if(!Number.isFinite(item[k])||item[k]<0)out.push('Enter a valid number, zero or more, for every amount and rate.')});
 if(item.maximum>0&&item.minimum>item.maximum)out.push('The minimum cannot be above the maximum.');
 if(item.bands.some(b=>!Number.isFinite(b.rate)||b.rate<0||b.rate>1||(b.upTo!==null&&!(b.upTo>=0))))out.push('Fix the tax bands: a rate between 0% and 100%, and an upper limit of zero or more.');
 if(item.effectiveFrom&&item.effectiveTo&&item.effectiveTo<item.effectiveFrom)out.push('"Effective until" cannot be before "Effective from".');
 if(item.reference.trim()&&!isHttps(item.reference))out.push('The reference must be a web address starting with https://.');
 return [...new Set([...out,...exceptionIssues(item,taken)])];
}

function ExceptionEditor({item,onChange,ro}:{item:PayItem;onChange:(list:PayException[])=>void;ro:boolean}){
 const list=item.exceptions||[];
 const [open,setOpen]=useState(-1);
 const set=(i:number,patch:Partial<PayException>)=>onChange(list.map((e,j)=>j===i?{...e,...patch}:e));
 const effects=effectsFor(item);
 return <section className="space-y-2 rounded-2xl border border-line p-3">
  <div className="flex items-center gap-2">
   <h4 className="min-w-0 flex-1 text-sm font-semibold text-ink">Exceptions ({list.length})</h4>
   {!ro&&<button type="button" className={btn} disabled={list.length>=12} onClick={()=>{
    onChange([...list,{code:'EXC_'+token(),name:'',description:'',effect:effects[0]||'exempt',value:0,evidence:'',reference:'',enabled:false}]);setOpen(list.length);
   }}><Plus className="h-4 w-4"/>Add</button>}
  </div>
  <p className="text-xs text-muted">An exception changes how this item treats a person in a set circumstance, for example a person with a disability. It applies only when the person holds the evidence named here. A switched-off exception is kept but never used.</p>
  {!list.length&&<p className="rounded-xl bg-page p-3 text-xs text-muted">No exceptions for this item.</p>}
  {list.map((e,i)=>{
   const opened=open===i;
   return <div key={i} className="rounded-xl border border-line bg-page">
    <button type="button" aria-expanded={opened} onClick={()=>setOpen(opened?-1:i)} className="flex min-h-14 w-full items-center gap-2 px-3 py-2 text-left">
     <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{e.name||'New exception'}</span>
      <span className="block text-xs text-muted">{EFFECT_TEXT[e.effect]?.label||e.effect}{e.value>0?' · '+(e.effect==='rate'?pct(e.value)+'%':fmt(e.value)):''}</span></span>
     <span className={'rounded-full px-2 py-0.5 text-xs font-semibold '+(e.enabled?'bg-emerald-500/15 text-emerald-500':'bg-amber-500/15 text-amber-500')}>{e.enabled?'On':'Off'}</span>
    </button>
    {opened&&<div className="space-y-3 border-t border-line p-3">
     <label className="block text-sm text-muted">Name
      <input className={field+' mt-1'} maxLength={120} value={e.name} disabled={ro} onChange={ev=>set(i,{name:ev.target.value})}/></label>
     <label className="block text-sm text-muted">Code
      <input className={field+' mt-1 font-mono'} maxLength={48} value={e.code} disabled={ro} onChange={ev=>set(i,{code:ev.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'_')})}/></label>
     <Choice label="What it does" value={e.effect} disabled={ro} onChange={v=>set(i,{effect:v,value:v==='exempt'||v==='not_entitled'||v==='reroute'?0:e.value})}
      options={effects.map(v=>({value:v,label:EFFECT_TEXT[v].label,hint:EFFECT_TEXT[v].hint}))}/>
     {(e.effect==='exempt_first'||e.effect==='cap')&&<NumField label={e.effect==='cap'?'Monthly maximum':'Monthly amount exempt'} value={e.value} disabled={ro} onChange={n=>set(i,{value:n})}/>}
     {e.effect==='rate'&&<NumField label="Rate (%)" percent max={2} value={e.value} disabled={ro} onChange={n=>set(i,{value:n})} hint="For example 5 for 5%."/>}
     <label className="block text-sm text-muted">Evidence the person must hold
      <input className={field+' mt-1'} maxLength={300} value={e.evidence} disabled={ro} onChange={ev=>set(i,{evidence:ev.target.value})} aria-invalid={e.enabled&&e.evidence.trim().length<3}/></label>
     <label className="block text-sm text-muted">Description (optional)
      <input className={field+' mt-1'} maxLength={400} value={e.description} disabled={ro} onChange={ev=>set(i,{description:ev.target.value})}/></label>
     <label className="block text-sm text-muted">Legal reference (https://)
      <input className={field+' mt-1'} maxLength={600} inputMode="url" value={e.reference} disabled={ro} onChange={ev=>set(i,{reference:ev.target.value})} aria-invalid={!!e.reference.trim()&&!isHttps(e.reference)}/></label>
     {isHttps(e.reference)&&<a href={e.reference} target="_blank" rel="noopener noreferrer" className="block break-all text-xs font-semibold text-brand">Read the source ↗</a>}
     <div className="flex items-center gap-2">
      <label className="flex min-h-11 flex-1 items-center gap-3 rounded-xl border border-line px-3 text-sm">
       <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={e.enabled} disabled={ro} onChange={ev=>set(i,{enabled:ev.target.checked})}/>
       <span className="font-medium text-ink">Switched on</span></label>
      {!ro&&<button type="button" className={btn} aria-label="Remove this exception" onClick={()=>{onChange(list.filter((_,j)=>j!==i));setOpen(-1)}}><Trash2 className="h-4 w-4"/></button>}
     </div>
    </div>}
   </div>;
  })}
 </section>;
}

function ItemSheet({start,isNew,others,locked,ro,currency,onClose,onApply,onRemove}:{start:PayItem;isNew:boolean;others:Set<string>;locked:boolean;ro:boolean;currency:string;onClose:()=>void;onApply:(x:PayItem)=>void;onRemove?:()=>void}){
 const [x,setX]=useState<PayItem>(start);
 const [touched,setTouched]=useState(false);
 const set=(patch:Partial<PayItem>)=>{setTouched(true);setX(v=>({...v,...patch}))};
 const issues=itemIssues(x,others);
 const leave=x.category==='leave';
 return <Sheet title={isNew?'New component':x.name||'Component'} onClose={onClose}
  footer={ro?<button type="button" className={btn+' flex-1'} onClick={onClose}>Close</button>:<>
   {onRemove&&<button type="button" className={btn} onClick={onRemove} aria-label="Remove this new component"><Trash2 className="h-4 w-4"/></button>}
   <button type="button" className={primary+' flex-1'} disabled={issues.length>0} onClick={()=>{setTouched(true);if(!issues.length)onApply({...x,name:x.name.trim(),description:x.description.trim()})}}>Apply to draft</button>
  </>}>
  <p className="flex flex-wrap items-center gap-2 text-xs"><span className="font-mono text-muted">{x.code}</span>
   {x.mandatory&&<span className="inline-flex items-center gap-1 font-semibold text-amber-600"><Lock className="h-3 w-3"/>Required by law</span>}</p>
  <label className="block text-sm font-medium text-ink">Name
   <input className={field+' mt-1'} maxLength={160} value={x.name} disabled={ro} onChange={e=>set({name:e.target.value})} aria-invalid={touched&&x.name.trim().length<2}/></label>
  <label className="block text-sm font-medium text-ink">Description
   <textarea className={field+' mt-1 min-h-20 py-2'} maxLength={600} value={x.description} disabled={ro} onChange={e=>set({description:e.target.value})}/></label>
  <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 text-sm">
   <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={x.enabled} disabled={ro||locked} onChange={e=>set({enabled:e.target.checked})}/>
   <span><span className="font-medium text-ink">Enabled</span><span className="block text-xs text-muted">{locked?'Required by law, so it cannot be switched off.':'Only enabled components can be chosen for a job grade.'}</span></span></label>
  {leave?<NumField label="Default days per year" value={x.amount} disabled={ro} max={366} onChange={n=>set({amount:n})}
   hint="Each job grade sets its own days, accrual and carry-forward under Job Grades. This is the starting value."/>:<>
   <Choice label="How it is calculated" value={x.method} options={METHODS} disabled={ro} onChange={v=>set({method:v})}/>
   <Choice label="What it is calculated on" value={x.base} options={BASES} disabled={ro} onChange={v=>set({base:v})}/>
   <div className="grid min-w-0 grid-cols-2 gap-3">
    <NumField label={'Fixed amount ('+currency+')'} value={x.amount} disabled={ro} onChange={n=>set({amount:n})}/>
    <NumField label={x.method==='percent'?'Rate (%)':'Rate or multiplier'} percent={x.method==='percent'} value={x.rate} disabled={ro} onChange={n=>set({rate:n})}/>
    <NumField label="Minimum" value={x.minimum} disabled={ro} onChange={n=>set({minimum:n})}/>
    <NumField label="Maximum" value={x.maximum} disabled={ro} onChange={n=>set({maximum:n})} hint="0 means no maximum."/>
    <NumField label={x.method==='percent'?'Employer rate (%)':'Employer rate'} percent={x.method==='percent'} value={x.employerRate} disabled={ro} onChange={n=>set({employerRate:n})}/>
    <NumField label="Employer amount" value={x.employerAmount} disabled={ro} onChange={n=>set({employerAmount:n})}/>
   </div>
   {x.bands.length>0&&<section className="space-y-2 rounded-xl bg-page p-3">
    <h4 className="text-sm font-semibold text-ink">Progressive bands</h4>
    {x.bands.map((b,i)=><div key={i} className="grid grid-cols-2 gap-2">
     <label className="text-xs text-muted">Up to ({currency})
      <input type="number" inputMode="decimal" step="0.01" min={0} className={field+' mt-1'} value={b.upTo??''} placeholder="No upper limit" disabled={ro}
       onChange={e=>set({bands:x.bands.map((a,j)=>i===j?{...a,upTo:e.target.value===''?null:Number(e.target.value)}:a)})}/></label>
     <label className="text-xs text-muted">Rate (%)
      <input type="number" inputMode="decimal" step="0.01" min={0} max={100} className={field+' mt-1'} value={pct(b.rate)} disabled={ro}
       onChange={e=>set({bands:x.bands.map((a,j)=>i===j?{...a,rate:Number(e.target.value)/100}:a)})}/></label>
    </div>)}
   </section>}
  </>}
  <div className="grid grid-cols-2 gap-3">
   <label className="block text-sm text-muted">Effective from<input type="date" className={field+' mt-1'} value={x.effectiveFrom} disabled={ro} onChange={e=>set({effectiveFrom:e.target.value})}/></label>
   <label className="block text-sm text-muted">Effective until<input type="date" className={field+' mt-1'} value={x.effectiveTo} disabled={ro} onChange={e=>set({effectiveTo:e.target.value})}/></label>
  </div>
  <label className="block text-sm text-muted">Who it applies to
   <textarea className={field+' mt-1 min-h-20 py-2'} maxLength={400} value={x.applicability} disabled={ro} onChange={e=>set({applicability:e.target.value})}/></label>
  {!leave&&<>
   <label className="block text-sm text-muted">Exemptions and checks
    <textarea className={field+' mt-1 min-h-20 py-2'} maxLength={400} value={x.exemption} disabled={ro} onChange={e=>set({exemption:e.target.value})}/></label>
   <label className="block text-sm text-muted">When it is due
    <input className={field+' mt-1'} maxLength={200} value={x.dueRule} disabled={ro} onChange={e=>set({dueRule:e.target.value})}/></label>
   <Choice label="Payroll treatment" value={x.payrollTreatment} options={TREATMENTS} disabled={ro} onChange={v=>set({payrollTreatment:v})}/>
   <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 text-sm">
    <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={x.taxable} disabled={ro} onChange={e=>set({taxable:e.target.checked})}/>
    <span className="font-medium text-ink">Taxable</span></label>
  </>}
  <label className="block text-sm text-muted">Legal reference (https://)
   <input className={field+' mt-1'} maxLength={600} inputMode="url" value={x.reference} disabled={ro} onChange={e=>set({reference:e.target.value})} aria-invalid={!!x.reference.trim()&&!isHttps(x.reference)}/></label>
  {isHttps(x.reference)&&<a href={x.reference} target="_blank" rel="noopener noreferrer" className="block break-all text-xs font-semibold text-brand">Read the source ↗</a>}
  {canHaveExceptions(x)&&<ExceptionEditor item={x} ro={ro} onChange={list=>set({exceptions:list})}/>}
  {touched&&issues.length>0&&<ul role="alert" className="list-disc space-y-0.5 rounded-xl bg-danger/10 p-3 pl-7 text-xs text-danger">{issues.slice(0,6).map(m=><li key={m}>{m}</li>)}</ul>}
 </Sheet>;
}

function SubmitSheet({currency,entityName,version,onClose,onSubmit}:{currency:string;entityName:string;version:number;onClose:()=>void;onSubmit:(cost:number,reason:string)=>Promise<void>}){
 const [cost,setCost]=useState(''),[reason,setReason]=useState(''),[ack,setAck]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const costOk=cost.trim()!==''&&Number.isFinite(Number(cost))&&Number(cost)>=0;
 const ok=costOk&&reason.trim().length>=10&&ack;
 return <Sheet title="Submit benefits for approval" onClose={busy?()=>undefined:onClose}
  footer={<><button type="button" className={btn} onClick={onClose} disabled={busy}>Cancel</button>
   <button type="button" className={primary+' flex-1'} disabled={!ok||busy} onClick={async()=>{setBusy(true);setError('');try{await onSubmit(Number(cost),reason.trim())}catch(e){setError(messageOf(e,'Could not submit.'));setBusy(false)}}}>
    <ShieldCheck className="h-4 w-4"/>{busy?'Submitting…':'Submit draft v'+version}</button></>}>
  <p className="text-sm text-muted">The saved draft for {entityName} goes to the approvers set by the Chart of Authority for the cost below. You cannot approve it yourself. Pay, leave and payslip previews use the approved version only.</p>
  <label className="block text-sm font-medium text-ink">Estimated annual cost impact ({currency})
   <input className={field+' mt-1'} type="number" inputMode="decimal" min={0} step="any" value={cost} onChange={e=>setCost(e.target.value)} aria-invalid={cost!==''&&!costOk}/>
   <span className="mt-1 block text-xs font-normal text-muted">The extra yearly employer cost of this policy compared with the approved one. Enter 0 if there is none. A higher amount needs a higher approval level.</span></label>
  <label className="block text-sm font-medium text-ink">Reason for the change
   <textarea className={field+' mt-1 min-h-24 py-2'} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/>
   <span className="text-xs font-normal text-muted">{reason.trim().length}/10 characters minimum</span></label>
  <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-emerald-500" checked={ack} onChange={e=>setAck(e.target.checked)}/>
   <span>I have reviewed this draft against the law, our policies and the cost estimate.</span></label>
  {error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
 </Sheet>;
}

type EditState={item:PayItem;isNew:boolean};
export default function HrBenefits(){
 const [data,setData]=useState<Loaded|null>(null);
 const [entityId,setEntityId]=useState('');
 const [config,setConfig]=useState<PayConfig|null>(null),[baseline,setBaseline]=useState('');
 const [view,setView]=useState<View>('payModels');
 const [edit,setEdit]=useState<EditState|null>(null);
 const [submitOpen,setSubmitOpen]=useState(false),[refresh,setRefresh]=useState(0);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const {ask,sheet}=useConfirm();

 const load=useCallback(async(id:string)=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<Loaded>('/api/org/hr/compensation/get',{legalEntityId:id});
   setData(r);setEntityId(r.current?.id||'');setConfig(r.config);setBaseline(JSON.stringify(r.config));setRefresh(k=>k+1);
  }catch(e){setError(messageOf(e,'Benefits could not be loaded.'))}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{void load('')},[load]);

 const country=data?.countryCode||'',currency=data?.currency||'';
 const canEdit=!!data?.canEdit;
 const dirty=!!config&&JSON.stringify(config)!==baseline;
 const saved=!!data?.saved;
 const pending=data?.activation?.pendingRequestId||'';
 const active=data?.activation?.active||null;
 useEffect(()=>{
  if(!dirty)return;
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);

 const counts=useMemo(()=>{const c:Record<string,number>={};config?.items.forEach(i=>{c[i.category]=(c[i.category]||0)+1});return c},[config]);
 const rows=useMemo(()=>config?.items.filter(i=>i.category===view)||[],[config,view]);
 /** Exception codes across the whole policy, except those of the item being edited. */
 const takenFor=(code:string)=>new Set((config?.items||[]).filter(i=>i.code!==code).flatMap(i=>(i.exceptions||[]).map(e=>e.code)));
 const policyIssues=useMemo(()=>{
  if(!config)return [] as string[];
  const out:string[]=[];
  for(const i of config.items)out.push(...itemIssues(i,takenFor(i.code)).map(m=>i.name+': '+m));
  return [...new Set(out)];
 },[config]);// eslint-disable-line react-hooks/exhaustive-deps

 const columns:Column<PayItem>[]=useMemo(()=>[
  {key:'name',label:'Component',value:x=>x.name+' '+x.code,className:'min-w-[14rem]',render:x=><span className="block py-1"><span className="block text-sm font-semibold text-ink">{x.name}</span><span className="block font-mono text-[11px] text-muted">{x.code}</span></span>},
  {key:'status',label:'Status',value:x=>x.enabled?'Enabled':'Disabled',render:x=><span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold '+(x.enabled?'bg-emerald-500/15 text-emerald-500':'bg-amber-500/15 text-amber-500')}>{x.enabled?'Enabled':'Disabled'}</span>},
  {key:'mandatory',label:'Required by law',value:x=>x.mandatory?'Yes':'No',render:x=>x.mandatory?<span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600"><Lock className="h-3 w-3"/>Yes</span>:<span className="text-xs text-muted">No</span>},
  {key:'value',label:view==='leave'?'Default days':'Rate or amount',value:x=>view==='leave'?x.amount:valueText(x),type:view==='leave'?'number':undefined,className:'min-w-[9rem]'},
  {key:'method',label:'Method',value:x=>x.method,hidden:view==='leave'},
  {key:'base',label:'Calculated on',value:x=>x.base,hidden:view==='leave'},
  {key:'exceptions',label:'Exceptions',type:'number',value:x=>(x.exceptions||[]).filter(e=>e.enabled).length,hidden:!EXCEPTION_CATEGORIES.includes(view as PayCategory)},
  {key:'taxable',label:'Taxable',value:x=>x.taxable?'Yes':'No',hidden:true},
  {key:'treatment',label:'Payroll treatment',value:x=>x.payrollTreatment,hidden:true},
  {key:'applicability',label:'Applies to',value:x=>x.applicability,hidden:true},
  {key:'reference',label:'Legal reference',value:x=>x.reference,hidden:true},
 ],[view]);

 const save=async()=>{
  if(!config||!data?.current||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const r=await callBackend<{version:number}>('/api/org/hr/compensation/save',{legalEntityId:data.current.id,config,expectedVersion:Number(config.version||0)});
   await load(data.current.id);setNotice('Draft saved as version '+r.version+'. No salary, payroll entry or remittance was changed, and the approved policy is untouched.');
  }catch(e){setError(messageOf(e,'Could not save the draft.'))}
  finally{setBusy(false)}
 };
 const addItem=()=>{
  if(!config||view==='activation'||config.items.length>=250)return;
  const code='CUSTOM_'+Date.now().toString(36).toUpperCase();
  setEdit({isNew:true,item:{code,name:'',description:'',category:view,mandatory:false,enabled:false,gradeCodes:[],amount:0,rate:0,minimum:0,maximum:0,currency,
   method:view==='leave'?'days':'manual',base:'none',employerRate:0,employerAmount:0,effectiveFrom:'',effectiveTo:'',applicability:'',exemption:'',reference:'',dueRule:'',
   payrollTreatment:'informational',taxable:false,bands:[],options:{}}});
 };
 const apply=(x:PayItem)=>{
  if(!edit)return;
  setConfig(c=>c?{...c,items:edit.isNew?[...c.items,x]:c.items.map(i=>i.code===x.code?x:i)}:c);
  setEdit(null);setNotice('Change applied to the draft. Save the draft to keep it.');
 };
 const discard=()=>ask({title:'Discard unsaved changes?',tone:'danger',confirmLabel:'Discard changes',
  message:'Your edits since the last saved draft are lost. The saved draft and the approved policy are not affected.'},
  async()=>{setConfig(JSON.parse(baseline) as PayConfig);setNotice('Unsaved changes discarded.')});

 const entityPicker=data&&data.entities.length>1?<SelectField id="benefits-entity" label="Legal entity" hideLabel value={entityId} disabled={busy||loading||dirty}
  hint={dirty?'Save or discard your changes before switching legal entity.':undefined} onChange={e=>void load(e.target.value)}>
  {data.entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</SelectField>:null;
 const menu=useMemo(()=>[...MENU.map(([value,label])=>({value:value as View,label,count:counts[value]||0})),{value:'activation' as View,label:'Approval',count:undefined}],[counts]);
 const lockedKenya=(x:PayItem)=>x.mandatory&&country==='KE';

 return <div className="flex h-full min-h-0 flex-col">
  {sheet}
  <div className="shrink-0 space-y-2 border-b border-line bg-page pb-3">
   <div className="flex items-center gap-2">
    <div className="min-w-0 flex-1">
     <h2 className="flex items-center gap-2 truncate text-base font-semibold text-ink"><Banknote className="h-5 w-5 shrink-0 text-brand"/>Benefits{data?.current?' · '+data.current.name:''}</h2>
     <p className="truncate text-xs text-muted">{!config?'':dirty?'Unsaved changes':saved?'Draft v'+config.version+' saved':'Starting template, not saved yet'}{active?' · Approved v'+active.version:' · Nothing approved yet'}{pending?' · Awaiting approval '+pending:''}</p>
    </div>
    {config&&<div className="flex shrink-0 items-center gap-2">
     {canEdit&&view!=='activation'&&<button type="button" className={btn} onClick={addItem} disabled={busy||loading||config.items.length>=250} aria-label="Add a component"><Plus className="h-4 w-4"/><span className="hidden sm:inline">Add</span></button>}
     {canEdit&&<button type="button" className={btn} onClick={()=>void save()} disabled={busy||loading||!dirty&&saved||policyIssues.length>0||!country||!currency} aria-label="Save draft"><Save className="h-4 w-4"/><span className="hidden sm:inline">Save draft</span></button>}
     {canEdit&&<button type="button" className={primary} onClick={()=>setSubmitOpen(true)} disabled={busy||loading||dirty||!saved||!!pending} aria-label="Submit for approval"><ShieldCheck className="h-4 w-4"/><span className="hidden sm:inline">Submit</span></button>}
    </div>}
   </div>
   {entityPicker}
   {dirty&&canEdit&&<button type="button" className="text-xs font-semibold text-danger underline" onClick={discard}>Discard unsaved changes</button>}
   {config&&<Segmented label="Benefits menu" value={view} onChange={setView} options={menu}/>}
  </div>

  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3">
   {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
   {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
   {loading&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Loading benefits…</p>}
   {!loading&&data&&!data.current&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Create a legal entity under Organization design before configuring benefits.</p>}
   {!loading&&config&&!country&&<p className="rounded-xl border border-line p-3 text-sm text-amber-700">Set the legal entity's country in Organization design. No national statutory rates are guessed.</p>}
   {!loading&&config&&country&&country!=='KE'&&<p className="rounded-xl border border-line p-3 text-sm text-amber-700">This is a blank policy for {country}, not a verified statutory template. Set up and have the local tax, contributions, leave and wage rules reviewed before approval.</p>}
   {!loading&&config&&!canEdit&&<p className="rounded-xl bg-panel p-3 text-xs text-muted">You can review this policy. Preparing changes needs the HR – Benefits Maintainer role.</p>}
   {policyIssues.length>0&&canEdit&&<section role="alert" className="rounded-xl border border-line bg-amber-500/10 p-3 text-sm"><p className="font-semibold text-ink">Fix {policyIssues.length} item{policyIssues.length===1?'':'s'} before saving</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-soft">{policyIssues.slice(0,6).map(x=><li key={x}>{x}</li>)}</ul></section>}

   {!loading&&config&&view!=='activation'&&<>
    <section className="rounded-2xl border border-line bg-panel p-3 text-xs text-muted">
     {MENU.find(m=>m[0]===view)?.[2]} for {data?.current?.name}. Job grades choose from the enabled components here. {country==='KE'?'Kenya statutory rates, bands and exceptions were set up once as defaults; your changes are never overwritten.':''} Changes are drafted and take effect only once approved under the Chart of Authority.
    </section>
    <RichTable key={view} id={'hr-benefits-v1-'+view} title={MENU.find(m=>m[0]===view)?.[2]||'Benefits'} fileName={'Benefits_'+view+'_'+(data?.current?.name||'').replace(/\W+/g,'_')}
     columns={columns} rows={rows} rowKey={x=>x.code} onRowClick={x=>setEdit({isNew:false,item:structuredClone(x)})}
     allowExport height="h-[calc(100dvh-24rem)] min-h-[320px]" empty="Nothing here yet."/>
   </>}

   {!loading&&config&&view==='activation'&&<>
    <section className="space-y-2 rounded-2xl border border-line bg-panel p-3 sm:p-4">
     <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-brand"/>Approval (Chart of Authority)</h3>
     <p className="text-xs text-muted">Saving changes only the draft. Leave, job grades and payslip previews use the <strong>approved</strong> policy, which changes only after each level of the legal entity's Chart of Authority approves it, by someone other than the preparer.</p>
     <p className="rounded-xl bg-page p-3 text-sm">{active
      ?<>Approved policy v{active.version} (from draft v{active.sourceDraftVersion}) · approved under {active.approvalRef} on {active.activatedAt.slice(0,10)}</>
      :<>No approved policy yet. Employees cannot plan leave in this legal entity until one is approved.</>}</p>
     {pending&&<p className="text-sm text-muted">Request {pending} is awaiting approval. Withdraw it below to submit a different draft.</p>}
     {canEdit&&!pending&&<button type="button" className={primary+' w-full'} disabled={busy||dirty||!saved} onClick={()=>setSubmitOpen(true)}><ShieldCheck className="h-4 w-4"/>Submit draft v{config.version} for approval</button>}
     {canEdit&&!pending&&(dirty||!saved)&&<p className="text-xs text-muted">Save the draft before submitting it.</p>}
    </section>
    <div className="rounded-xl border border-line bg-panel p-3"><p className="flex items-start gap-2 text-xs text-muted"><FileWarning className="mt-0.5 h-4 w-4 shrink-0"/>Tax and pension rules are country-specific and change during the year. Before approval, have the law, effective dates, exceptions and job grade benefits reviewed, and check a sample payslip for each grade under Job Grades.</p></div>
    {data?.current&&<HrCompensationApprovals legalEntityId={data.current.id} refreshKey={refresh} onChanged={()=>void load(data.current!.id)}/>}
   </>}
   {!loading&&active&&view!=='activation'&&<p className="flex items-center gap-2 text-xs text-muted"><BadgeCheck className="h-4 w-4 shrink-0 text-brand"/>Approved version {active.version} was approved under {active.approvalRef} on {active.activatedAt.slice(0,10)}.</p>}
  </div>

  {edit&&config&&<ItemSheet key={edit.item.code} start={edit.item} isNew={edit.isNew} others={takenFor(edit.item.code)} locked={lockedKenya(edit.item)} ro={!canEdit} currency={currency}
   onClose={()=>setEdit(null)} onApply={apply} onRemove={edit.isNew?()=>setEdit(null):undefined}/>}
  {submitOpen&&data?.current&&config&&<SubmitSheet currency={currency} entityName={data.current.name} version={Number(config.version||0)} onClose={()=>setSubmitOpen(false)}
   onSubmit={async(cost,reason)=>{
    await callBackend('/api/org/hr/compensation/submit',{legalEntityId:data.current!.id,expectedVersion:Number(config.version||0),annualCostImpact:cost,reason,acknowledge:true});
    setSubmitOpen(false);setNotice('Submitted for approval. Nothing changes until every Chart of Authority level approves.');setView('activation');await load(data.current!.id);
   }}/>}
 </div>;
}
