import {useMemo,useState} from 'react';
import {Button} from '../admin/kit';
export type GranularVariant={
 id:string;code:string;name:string;classCode:string;className:string;
 categoryCode:string;categoryName:string;groupCode:string;groupName:string;
 scenario:string;event:string;role:string;accountCode:string;accountName:string;
 status:'configurable'|'template_only';reason:string;
};
export default function FinGranularTransactionCatalog({variants,onConfigure,accountRules}:{variants:GranularVariant[];onConfigure:(v:GranularVariant)=>void;accountRules:Array<{event:string;role:string;account:string;enabled:boolean}>}){
 const [query,setQuery]=useState('');
 const [classCode,setClassCode]=useState('');
 const [categoryCode,setCategoryCode]=useState('');
 const [status,setStatus]=useState('all');
 const [visible,setVisible]=useState(60);
 const classes=useMemo(()=>Array.from(new Map(variants.map(v=>[v.classCode,v.className||v.classCode])).entries()),[variants]);
 const categories=useMemo(()=>Array.from(new Map(variants.filter(v=>!classCode||v.classCode===classCode).map(v=>[v.categoryCode,v.categoryName||v.categoryCode])).entries()),[variants,classCode]);
 const shown=useMemo(()=>variants.filter(v=>(!classCode||v.classCode===classCode)
  &&(!categoryCode||v.categoryCode===categoryCode)
  &&(status==='all'||v.status===status)
  &&(!query||[v.code,v.name,v.className,v.categoryName,v.groupName,v.accountCode].join(' ').toLowerCase().includes(query.toLowerCase()))),
  [variants,classCode,categoryCode,status,query]);
 const live=variants.filter(v=>v.status==='configurable').length;
 const applied=(v:GranularVariant)=>accountRules.some(r=>r.enabled&&r.event===v.event&&r.role===v.role&&r.account===v.accountCode);
 return <section className='space-y-3 rounded-xl border border-line bg-panel/40 p-3 sm:p-4'>
  <div>
   <h3 className='text-base font-semibold text-ink'>Granular transactions aligned to your GL accounts</h3>
   <p className='mt-1 text-sm text-muted'>Generated from the approved chart for this legal entity. Browse by GL class and category, then choose the scenario you want to configure. Templates are clearly separated from implemented posting events.</p>
   <p className='mt-2 text-sm font-medium text-ink'>{variants.length} account-specific scenarios · {live} configurable using existing handlers · {variants.length-live} templates without verified automated posting</p>
  </div>
  <div className='grid gap-2 sm:grid-cols-2'>
   <label className='text-sm text-soft'>GL class
    <select data-native-select='true' value={classCode} onChange={e=>{setClassCode(e.target.value);setCategoryCode('');setVisible(60);}} className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'>
      <option value=''>All classes</option>{classes.map(([id,name])=><option key={id} value={id}>{id} — {name}</option>)}
    </select>
   </label>
   <label className='text-sm text-soft'>GL category
    <select data-native-select='true' value={categoryCode} onChange={e=>{setCategoryCode(e.target.value);setVisible(60);}} className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'>
      <option value=''>All categories</option>{categories.map(([id,name])=><option key={id} value={id}>{id} — {name}</option>)}
    </select>
   </label>
   <label className='text-sm text-soft'>Search account or transaction
    <input type='search' value={query} onChange={e=>{setQuery(e.target.value);setVisible(60);}} placeholder='Account code, GL or scenario' className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'/>
   </label>
   <label className='text-sm text-soft'>Scenario availability
    <select data-native-select='true' value={status} onChange={e=>{setStatus(e.target.value);setVisible(60);}} className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'>
      <option value='all'>All scenarios</option>
      <option value='configurable'>Configurable with existing handler</option>
      <option value='template_only'>Templates requiring implementation</option>
    </select>
   </label>
  </div>
  <p className='text-xs text-muted'>{shown.length} matching scenarios · selection remains when filters change</p>
  <div className='max-h-[65dvh] space-y-2 overflow-y-auto overscroll-contain'>
    {shown.slice(0,visible).map(v=><div key={v.id} className='rounded-xl border border-line bg-panel px-3 py-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='font-mono text-xs text-muted'>{v.code}</span>
        <span className={`text-xs ${v.status==='configurable'?'text-emerald-400':'text-amber-400'}`}>{v.status==='configurable'?'Handler available':'Template only'}</span>
      </div>
      <p className='mt-1 text-sm font-semibold text-ink'>{v.scenario}</p>
      <p className='text-sm text-soft'>{v.accountCode} · {v.accountName}</p>
      <p className='text-xs text-muted'>{v.className} / {v.categoryName} / {v.groupName}</p>
      {v.status==='configurable'?<div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
        <span className='text-xs text-muted'>{applied(v)?'Has a matching approved/draft rule':'Available to map'}</span>
        <Button variant='secondary' onClick={()=>onConfigure(v)}>Configure this transaction</Button>
      </div>:<p className='mt-2 text-xs text-amber-300'>{v.reason}</p>}
    </div>)}
    {!shown.length&&<p className='p-3 text-sm text-muted'>No matching GL transaction scenarios. Change the filters to see more.</p>}
    {shown.length>visible&&<Button variant='secondary' onClick={()=>setVisible(n=>n+60)}>Show 60 more ({shown.length-visible} remaining)</Button>}
  </div>
 </section>;
}
