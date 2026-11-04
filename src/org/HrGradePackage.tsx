import {Lock} from 'lucide-react';
import type {Catalogue,CatalogueItem,Grade,GradeLeave,GradeLeaveUnit,GradeValue} from './hrGradeTypes';
import {Choice,NumField,fmt,pct} from './hrFormParts';

const UNIT_LABEL:Record<GradeLeaveUnit,string>={working_days:'working days',calendar_days:'calendar days',months:'months'};
const UNITS:Array<{value:GradeLeaveUnit;label:string}>=[{value:'working_days',label:'Working days'},{value:'calendar_days',label:'Calendar days'},{value:'months',label:'Months'}];
const GROUPS:Array<[string,string,string]>=[
 ['overtime','Overtime','Premium rates for hours worked beyond normal hours.'],
 ['allowances','Allowances','Regular extra pay such as housing, transport or meals.'],
 ['benefits','Benefits','Cover or goods such as medical insurance or a vehicle.'],
 ['incentives','Incentives and bonus','Pay linked to results.'],
];
const itemValue=(i:CatalogueItem,currency:string)=>
 i.method==='percent'?pct(i.rate)+'% of pay':i.method==='multiplier'?'× '+i.rate:i.amount>0?currency+' '+fmt(i.amount):'Set per person';

/** Problems with the pay package of one grade, for the form and for the whole list. */
export function packageIssues(g:Grade,cat:Catalogue):string[]{
 const out:string[]=[];
 const label=g.title.trim()||g.code||'New grade';
 const nameOf=(code:string)=>[...cat.benefits,...cat.leave].find(i=>i.code===code)?.name||code;
 for(const code of g.benefitCodes){
  const v=g.benefitValues[code];
  if(!v)continue;
  if(v.amount!==undefined&&(!Number.isFinite(v.amount)||v.amount<0))out.push(`${label}: enter a valid amount for ${nameOf(code)}.`);
  if(v.rate!==undefined&&(!Number.isFinite(v.rate)||v.rate<0||v.rate>2))out.push(`${label}: the rate for ${nameOf(code)} must be between 0% and 200%.`);
 }
 for(const l of g.leave){
  const name=nameOf(l.code),limit=l.unit==='months'?24:366;
  if(!Number.isFinite(l.daysPerYear)||l.daysPerYear<0||l.daysPerYear>limit)out.push(`${label}: ${name} must be between 0 and ${limit} ${UNIT_LABEL[l.unit]}.`);
  if(!Number.isFinite(l.carryForwardDays)||l.carryForwardDays<0||l.carryForwardDays>366)out.push(`${label}: carry forward for ${name} must be between 0 and 366 days.`);
  const floor=cat.leaveFloors[l.code];
  if(floor){
   if(l.unit!==floor.unit)out.push(`${label}: ${name} is measured in ${UNIT_LABEL[floor.unit]} by law.`);
   else if(Number.isFinite(l.daysPerYear)&&l.daysPerYear<floor.days)out.push(`${label}: ${name} cannot be below the legal minimum of ${floor.days} ${UNIT_LABEL[floor.unit]}.`);
  }
 }
 return [...new Set(out)];
}

/** One pay model (single choice) and any number of overtime, allowance, benefit and incentive items. */
export function PayTab({grade,cat,currency,ro,onChange}:{grade:Grade;cat:Catalogue;currency:string;ro:boolean;onChange:(patch:Partial<Grade>)=>void}){
 const models=cat.payModels.filter(p=>p.enabled||p.code===grade.payModelCode);
 const toggle=(code:string,on:boolean)=>{
  const values={...grade.benefitValues};
  if(!on)delete values[code];
  onChange({benefitCodes:on?[...grade.benefitCodes,code]:grade.benefitCodes.filter(c=>c!==code),benefitValues:values});
 };
 const setValue=(code:string,v:GradeValue|null)=>{
  const values={...grade.benefitValues};
  if(v===null)delete values[code];else values[code]=v;
  onChange({benefitValues:values});
 };
 return <div className="space-y-4">
  <fieldset className="space-y-2">
   <legend className="text-sm font-semibold text-ink">Pay model</legend>
   <p className="text-xs text-muted">Choose one. It decides how people on this grade are paid.</p>
   {!models.length&&<p className="rounded-xl bg-page p-3 text-xs text-amber-600">No pay model is available. Switch one on in Benefits → Pay models first.</p>}
   <div role="radiogroup" aria-label="Pay model" className="space-y-1">{models.map(m=>{
    const on=grade.payModelCode===m.code;
    return <label key={m.code} className={'flex min-h-12 items-start gap-3 rounded-xl border border-line px-3 py-2 '+(on?'bg-brand/5':'bg-page')}>
     <input type="radio" name="grade-pay-model" className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" checked={on} disabled={ro} onChange={()=>onChange({payModelCode:m.code})}/>
     <span className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{m.name}</span>
      <span className="block font-mono text-[11px] text-muted">{m.code}</span>
      {m.description&&<span className="block text-xs text-muted">{m.description}</span>}
      {!m.enabled&&<span className="block text-[11px] text-amber-600">Switched off in Benefits</span>}</span>
    </label>;})}</div>
  </fieldset>

  {GROUPS.map(([category,title,hint])=>{
   const items=cat.benefits.filter(i=>i.category===category&&(i.enabled||grade.benefitCodes.includes(i.code)));
   const chosen=items.filter(i=>grade.benefitCodes.includes(i.code)).length;
   return <fieldset key={category} className="space-y-2">
    <legend className="text-sm font-semibold text-ink">{title} <span className="font-normal text-muted">({chosen} of {items.length})</span></legend>
    <p className="text-xs text-muted">{hint} Choose as many as apply.</p>
    {!items.length&&<p className="rounded-xl bg-page p-3 text-xs text-muted">None are switched on in Benefits yet.</p>}
    <div className="space-y-1">{items.map(i=>{
     const on=grade.benefitCodes.includes(i.code);
     const v=grade.benefitValues[i.code];
     const mode=v?.amount!==undefined?'amount':v?.rate!==undefined?'rate':'default';
     return <div key={i.code} className={'rounded-xl border border-line '+(on?'bg-brand/5':'bg-page')}>
      <label className="flex min-h-12 items-start gap-3 px-3 py-2">
       <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" checked={on} disabled={ro} onChange={e=>toggle(i.code,e.target.checked)}/>
       <span className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{i.name}</span>
        <span className="block text-xs text-muted">{itemValue(i,currency)}{i.taxable?' · taxable':''}</span>
        {!i.enabled&&<span className="block text-[11px] text-amber-600">Switched off in Benefits</span>}</span>
      </label>
      {on&&category!=='overtime'&&<div className="space-y-2 border-t border-line px-3 py-2">
       <Choice label="Value for this grade" value={mode} disabled={ro}
        options={[{value:'default',label:'Standard',hint:'Uses the value set in Benefits.'},{value:'amount',label:'Fixed amount',hint:'A fixed monthly amount for this grade.'},{value:'rate',label:'% of basic',hint:'A share of basic salary for this grade.'}]}
        onChange={m=>setValue(i.code,m==='default'?null:m==='amount'?{amount:i.method==='percent'?0:i.amount}:{rate:i.method==='percent'?i.rate:0})}/>
       {mode==='amount'&&<NumField label={'Monthly amount ('+currency+')'} value={v?.amount??0} disabled={ro} onChange={n=>setValue(i.code,{amount:n})}/>}
       {mode==='rate'&&<NumField label="Share of basic salary (%)" percent max={2} value={v?.rate??0} disabled={ro} onChange={n=>setValue(i.code,{rate:n})}/>}
      </div>}
     </div>;})}</div>
   </fieldset>;})}
 </div>;
}

/** Leave types: pick several, and set days, whether it is earned monthly, and carry-forward for each. */
export function LeaveTab({grade,cat,ro,onChange}:{grade:Grade;cat:Catalogue;ro:boolean;onChange:(patch:Partial<Grade>)=>void}){
 const items=cat.leave.filter(l=>l.enabled||grade.leave.some(e=>e.code===l.code)||cat.forcedLeave.includes(l.code));
 const entryOf=(code:string):GradeLeave|undefined=>{
  const found=grade.leave.find(e=>e.code===code);
  if(found)return found;
  const item=cat.leave.find(l=>l.code===code);
  return cat.forcedLeave.includes(code)&&item?{code,...item.defaults}:undefined;
 };
 const upsert=(code:string,patch:Partial<GradeLeave>)=>{
  const current=entryOf(code);if(!current)return;
  const next={...current,...patch};
  onChange({leave:grade.leave.some(e=>e.code===code)?grade.leave.map(e=>e.code===code?next:e):[...grade.leave,next]});
 };
 const toggle=(code:string,on:boolean)=>{
  const item=cat.leave.find(l=>l.code===code);if(!item)return;
  onChange({leave:on?[...grade.leave,{code,...item.defaults}]:grade.leave.filter(e=>e.code!==code)});
 };
 const chosen=items.filter(i=>entryOf(i.code)).length;
 return <div className="space-y-3">
  <p className="text-xs text-muted">Choose the leave types this grade gets: {chosen} of {items.length} selected. For each, set the days, whether it is earned month by month, and what can be carried forward. Leave required by law is always included.</p>
  {!items.length&&<p className="rounded-xl bg-page p-3 text-xs text-amber-600">No leave types are switched on. Configure them in Benefits → Leave first.</p>}
  {items.map(i=>{
   const forced=cat.forcedLeave.includes(i.code);
   const e=entryOf(i.code);
   const floor=cat.leaveFloors[i.code];
   const limit=e?.unit==='months'?24:366;
   return <div key={i.code} className={'rounded-xl border border-line '+(e?'bg-brand/5':'bg-page')}>
    <label className="flex min-h-12 items-start gap-3 px-3 py-2">
     <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" checked={!!e} disabled={ro||forced} onChange={ev=>toggle(i.code,ev.target.checked)}/>
     <span className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{i.name}</span>
      <span className="block font-mono text-[11px] text-muted">{i.code}</span>
      {forced&&<span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-brand"><Lock className="h-3 w-3"/>Required by law · every grade gets it</span>}
      {!i.enabled&&<span className="block text-[11px] text-amber-600">Switched off in Benefits</span>}</span>
    </label>
    {e&&<div className="space-y-3 border-t border-line px-3 py-3">
     <NumField label={'Allowance ('+UNIT_LABEL[e.unit]+' per year)'} value={e.daysPerYear} max={limit} disabled={ro} onChange={n=>upsert(i.code,{daysPerYear:n})}
      hint={floor?'Legal minimum: '+floor.days+' '+UNIT_LABEL[floor.unit]+'.':undefined}/>
     <Choice label="Measured in" value={e.unit} options={UNITS} disabled={ro} locked={!!floor} onChange={u=>upsert(i.code,{unit:u})}/>
     {floor&&<p className="-mt-1 text-xs text-muted">The unit is fixed by law for this leave type.</p>}
     <label className="flex min-h-12 items-start gap-3 rounded-xl border border-line px-3 py-2 text-sm">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" checked={e.accrueMonthly} disabled={ro} onChange={ev=>upsert(i.code,{accrueMonthly:ev.target.checked})}/>
      <span><span className="font-medium text-ink">Earned month by month</span>
       <span className="block text-xs text-muted">{e.accrueMonthly&&Number.isFinite(e.daysPerYear)?'Adds '+fmt(e.daysPerYear/12)+' '+UNIT_LABEL[e.unit]+' each month worked.':'The whole allowance is available from the start of the year.'}</span></span>
     </label>
     <NumField label="Carry forward to next year (days)" value={e.carryForwardDays} max={366} disabled={ro} onChange={n=>upsert(i.code,{carryForwardDays:n})}/>
    </div>}
   </div>;})}
 </div>;
}
