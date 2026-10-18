import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import SelectField from '../components/SearchableSelect';

type Installed = {code:string|null;module:string;area:string;method:string;path:string;name:string;
  permission:string|null;bindingStatus:'system_bound'|'unguarded_org'|'public_or_custom';
  enforcement:string;guard:string};
type Planned = {code:string;module:string;area:string;name:string;kind:string;state:string};
const modules = ['','ADM','ACT','AST','CAL','COM','DOC','DST','FIN','HRM','INV','LOG','MFG','MNT','ORG',
  'PAY','PLN','POS','PRC','PRJ','QLT','RPT','SAF','SAL','SVC','USR','WHS'];
const areaNames:Record<string,string> = {
  MAT:'Material master',STK:'Stock on hand',WO:'Work orders',WOR:'Work orders',
  WRQ:'Work requests',GOA:'Governance',SEC:'Security',COM:'Communication',
  ACT:'Actions',USR:'Users',ORG:'Organization',GEN:'Other transactions',
};
export default function TransactionBlueprints(){
  const [module,setModule]=useState('');
  const [wired,setWired]=useState<Installed[]>([]);
  const [planned,setPlanned]=useState<Planned[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [showFuture,setShowFuture]=useState(false);
  const [expanded,setExpanded]=useState<string[]>([]);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setExpanded([]);
    callBackend<{wiredEndpoints:Installed[];items:Planned[]}>('/api/org/governance/blueprints/list',{module})
      .then(res=>{if(active){setWired(res.wiredEndpoints??[]);setPlanned(res.items??[]);}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load transactions.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[module]);
  const filtered=useMemo(()=>wired.filter(e=>!search.trim()||
    [e.code,e.name,e.method,e.path,e.area,e.permission].join(' ').toLowerCase().includes(search.toLowerCase())),[wired,search]);
  const groups=useMemo(()=>{
    const map=new Map<string,Installed[]>();
    for(const item of filtered){if(!map.has(item.area))map.set(item.area,[]);map.get(item.area)!.push(item);}
    return [...map.entries()].sort(([a],[b])=>a.localeCompare(b));
  },[filtered]);
  const future=useMemo(()=>planned.filter(x=>x.kind==='transaction'&&x.state==='reserved'&&
    (!search||[x.name,x.code].join(' ').toLowerCase().includes(search.toLowerCase()))),[planned,search]);
  return <section className='space-y-3'>
    <div className='space-y-1'>
      <h2 className='text-lg font-semibold text-ink'>Installed transactions</h2>
      <p className='text-sm text-soft'>Existing server transactions are bound automatically by MEMS. Your organization does not need to map codes, submit binding evidence or approve bindings. Access still follows existing roles, ownership rules and business workflows.</p>
    </div>
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
      <SelectField id='org-transaction-module' label='Module' value={module} onChange={e=>setModule(e.target.value)}>
        <option value=''>All modules</option>
        {modules.filter(Boolean).map(m=><option key={m} value={m}>{m}</option>)}
      </SelectField>
      <label className='block text-sm text-soft'>Find transaction
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Code, name or route'
          className='mt-1 min-h-12 w-full rounded-xl border border-line bg-panel px-3 text-base text-ink placeholder:text-muted'/>
      </label>
    </div>
    {loading&&<p role='status' className='text-sm text-soft'><RefreshCw className='mr-2 inline animate-spin' size={16}/>Loading installed routes…</p>}
    {error&&<p role='alert' className='text-sm text-red-600'>{error}</p>}
    {!loading&&!error&&<p className='text-sm font-medium text-ink'>{filtered.length} installed organization transactions · automatically system-bound</p>}
    <div className='space-y-2'>
      {groups.map(([area,items])=>{
        const isOpen=!!search||expanded.includes(area);
        return <section key={area} className='overflow-hidden rounded-xl border border-line'>
          <button type='button' aria-expanded={isOpen} onClick={()=>setExpanded(prev=>prev.includes(area)?prev.filter(a=>a!==area):[...prev,area])}
            className='flex min-h-14 w-full items-center gap-3 px-4 text-left text-ink'>
            {isOpen?<ChevronDown size={18}/>:<ChevronRight size={18}/>}
            <span className='min-w-0 flex-1 font-semibold'>{areaNames[area]??area}</span>
            <span className='text-xs text-soft'>{items.length} bound</span>
          </button>
          {isOpen&&<div className='border-t border-line'>
            {items.map(e=><article key={e.method+' '+e.path} className='space-y-1 border-b border-line p-3 last:border-0'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <code className='break-all font-semibold text-ink'>{e.code}</code>
                <span className='text-xs text-soft'>System-bound</span>
              </div>
              <p className='text-sm text-ink'>{e.name}</p>
              <code className='block break-all text-xs text-soft'>{e.method} {e.path}</code>
              <p className='text-xs text-soft'>{e.permission?'Role permission: '+e.permission:'Authenticated / handler-owned rules'}</p>
            </article>)}
          </div>}
        </section>;
      })}
      {!loading&&!groups.length&&!error&&<p className='rounded-xl border border-line p-4 text-sm text-soft'>No installed transactions match this filter.</p>}
    </div>
    <label className='flex items-center gap-2 text-sm text-ink'>
      <input type='checkbox' checked={showFuture} onChange={e=>setShowFuture(e.target.checked)}/>
      Show reserved future transaction designs
    </label>
    {showFuture&&<div className='max-h-80 space-y-1 overflow-y-auto rounded-xl border border-line p-3'>
      <p className='text-xs text-soft'>Future codes are design reservations only. They are not installed or granted to any employee.</p>
      {future.map(x=><div key={x.code} className='flex flex-wrap justify-between gap-2 border-b border-line py-2 text-xs'>
        <code className='text-ink'>{x.code}</code><span className='text-soft'>{x.name} · Reserved</span>
      </div>)}
    </div>}
  </section>;
}
