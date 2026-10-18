import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { callBackend } from '../lib/backend';
import SelectField from '../components/SearchableSelect';

interface Blueprint {
  code: string;
  module: string;
  area: string;
  name: string;
  kind: 'module_access' | 'submodule_access' | 'transaction';
  state: 'reserved' | 'catalogued_legacy';
  executable: false;
  legacyPermissionKeys: string[];
}
type WiredEndpoint = {method:string;path:string;name:string;permission:string|null;module:string;area:string;code:string|null;guard:string;handlerWired:true;activationCertified:false};
const MODULES: Array<[string,string]> = [
 ['ADM','Administration & Security'],['FIN','Finance & Accounting'],['INV','Inventory'],['MFG','Manufacturing'],
 ['PLN','Production Planning'],['CST','Product Costing'],['QLT','Quality'],['SAF','Safety'],['MNT','Maintenance'],
 ['AST','Asset Management'],['PRC','Procurement'],['WHS','Warehousing'],['LOG','Logistics'],
 ['DST','Distribution'],['SAL','Sales'],['CRM','Customer Management'],['POS','Point of Sale'],
 ['HRM','Human Resources'],['PAY','Payroll'],['DOC','Documentation'],['RPT','Reporting'],['PRJ','Projects'],
];
const suffix: Record<string,string> = {
 VW:'View / access',CR:'Create',ED:'Edit',SB:'Submit',AP:'Approve',RT:'Return',
 RJ:'Reject',CN:'Cancel',PS:'Post',CL:'Close',RV:'Reverse',RP:'Report',
};
export default function TransactionBlueprints() {
  const [module,setModule]=useState('ADM');
  const [items,setItems]=useState<Blueprint[]>([]);
  const [wired,setWired]=useState<WiredEndpoint[]>([]);
  const [existingPermissions,setExistingPermissions]=useState<Array<{existingPermission:string;label:string;suggestedCode:string|null;status:string}>>([]);
  const [mappingSummary,setMappingSummary]=useState<{total:number;proposed:number;collisions:number;manualReview:number;certified:number}|null>(null);
  const [search,setSearch]=useState('');
  const [showFuture,setShowFuture]=useState(false);
  const [expanded,setExpanded]=useState<string[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setError('');setItems([]);setWired([]);setExistingPermissions([]);setMappingSummary(null);setExpanded([]);
    callBackend<{items:Blueprint[];wiredEndpoints:WiredEndpoint[];existingPermissions:Array<{existingPermission:string;label:string;suggestedCode:string|null;status:string}>;mappingSummary:{total:number;proposed:number;collisions:number;manualReview:number;certified:number}}>('/api/org/governance/blueprints/list',{module})
      .then(response=>{if(!cancelled){setItems(response.items);setWired(response.wiredEndpoints??[]);setExistingPermissions(response.existingPermissions??[]);setMappingSummary(response.mappingSummary??null);}})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Could not load the transaction catalogue.');})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[module]);
  const groups=useMemo(()=>{
    const filter=search.trim().toLowerCase();
    const lookup=new Map<string,{title:string;code:string;actions:Blueprint[];live:WiredEndpoint[]}>();
    for(const item of items) {
      if(item.kind==='module_access')continue;
      if(item.kind==='submodule_access') {
        lookup.set(item.area,{title:item.name.replace(/^Access /,''),code:item.code,actions:[],live:[]});
      }
    }
    for(const item of items.filter(x=>x.kind==='transaction' && x.state==='reserved')) {
      if(!lookup.has(item.area))lookup.set(item.area,{title:item.area==='LEG'?'Existing transaction permissions':item.area,code:item.module+'-'+item.area+'-VW',actions:[],live:[]});
      lookup.get(item.area)!.actions.push(item);
    }
    for(const endpoint of wired) {
      if(!lookup.has(endpoint.area))lookup.set(endpoint.area,{title:endpoint.area+' — Installed endpoints',code:endpoint.module+'-'+endpoint.area+'-VW',actions:[],live:[]});
      lookup.get(endpoint.area)!.live.push(endpoint);
    }
    return [...lookup.entries()].filter(([area,g])=>!filter||
      (area+' '+g.title+' '+g.code).toLowerCase().includes(filter)||
      g.actions.some(a=>(a.code+' '+a.name+' '+a.legacyPermissionKeys.join(' ')).toLowerCase().includes(filter))||g.live.some(e=>(e.code+' '+e.path+' '+e.name+' '+e.permission).toLowerCase().includes(filter))
    ).map(([area,g])=>({...g,area,actions:filter&&!(area+' '+g.title+' '+g.code).toLowerCase().includes(filter)?
      g.actions.filter(a=>(a.code+' '+a.name+' '+a.legacyPermissionKeys.join(' ')).toLowerCase().includes(filter)):g.actions,
      live: filter&&!(area+' '+g.title+' '+g.code).toLowerCase().includes(filter)?g.live.filter(e=>(e.code+' '+e.path+' '+e.name+' '+e.permission).toLowerCase().includes(filter)):g.live}));
  },[items,wired,search]);
  const selected=MODULES.find(x=>x[0]===module);
  const proposedByCode=useMemo(()=>new Map(existingPermissions.filter(x=>x.suggestedCode).map(x=>[x.suggestedCode!,x])),[existingPermissions]);
  const expand=(area:string)=>setExpanded(old=>old.includes(area)?old.filter(x=>x!==area):[...old,area]);
  return <section className='space-y-4'>
    <div>
      <h2 className='text-xl font-semibold text-ink'>Enterprise transaction catalogue</h2>
      <p className='text-sm text-soft'>Browse by module, submodule and SAP-inspired Manufusion transaction code. All blueprints are read-only and non-executable until independently implemented and verified.</p>
    </div>
    <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
      <SelectField id='transaction-catalogue-module' label='Module' value={module} onChange={e=>setModule(e.target.value)}>
        {MODULES.map(([code,name])=><option key={code} value={code}>{code} — {name}</option>)}
      </SelectField>
      <label className='text-sm font-medium text-ink'>Search this module
        <span className='relative mt-1 block'><Search size={16} className='absolute left-3 top-3.5 text-soft'/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Code, submodule or transaction' className='w-full rounded-lg border border-[rgb(var(--c-border))] bg-transparent py-3 pl-10 pr-3 text-base'/>
        </span>
      </label>
    </div>
    <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-soft'>
      <span>{selected?.[1]} · {groups.length} submodules · {items.filter(x=>x.kind==='transaction').length} transaction blueprints</span>
      <span>{wired.length} server-wired organization endpoints found; workflow certification separate</span>
    </div>
    {loading&&<p role='status' className='text-sm text-soft'><RefreshCw className='inline mr-2 animate-spin' size={16}/>Loading module catalogue…</p>}
    {error&&<p role='alert' className='text-sm text-red-600'>{error}</p>}
    <div className='rounded-lg border border-[rgb(var(--c-border))] p-3 space-y-2'>
      <h3 className='font-semibold text-ink'>Existing permission crosswalk — engineering review</h3>
      <p className='text-xs text-soft'>{existingPermissions.length} existing permission definitions in {module}. These are suggestions for the engineering team to reconcile against real backend routes, not a task for employees or tenant administrators. No legacy permissions are changed here.</p>
      {mappingSummary&&<p className='text-xs text-soft'>Platform-wide engineering inventory: {mappingSummary.proposed} suggestions · {mappingSummary.collisions} collisions · {mappingSummary.manualReview} legacy keys still need reconciliation · {mappingSummary.certified} technically certified. These figures are across all modules, not just {module}.</p>}
      <p className='text-xs text-soft'>Next: engineering verifies handler code, role permission, tenant/site scope and separation of duties. Then use the Security tab to submit an audited binding proposal. A second authorized governance administrator approves it.</p>
      <div className='max-h-52 overflow-y-auto space-y-1'>{existingPermissions.filter(x=>(x.existingPermission+' '+x.label+' '+(x.suggestedCode??'')).toLowerCase().includes(search.toLowerCase())).map(x=><div key={x.existingPermission} className='flex flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--c-border))] py-2 text-xs'><span className='text-ink'>{x.label} <code className='text-soft'>({x.existingPermission})</code></span><span className='text-soft'>{x.status==='collision_review_required'?'Conflicting mapping · review needed':x.suggestedCode??'Engineering review required'}</span></div>)}</div>
    </div>
    <label className='flex items-center gap-2 text-sm text-ink'><input type='checkbox' checked={showFuture} onChange={e=>setShowFuture(e.target.checked)}/> Include future reserved actions</label>
    <div className='space-y-2'>
      {groups.map(g=>{
        const open=search.trim()!==''||expanded.includes(g.area);
        return <div key={g.area} className='overflow-hidden rounded-xl border border-[rgb(var(--c-border))]'>
          <button type='button' aria-expanded={open} onClick={()=>expand(g.area)} className='flex w-full items-center gap-3 px-3 py-4 text-left hover:bg-[rgb(var(--c-border)/0.08)]'>
            {open?<ChevronDown size={18}/>:<ChevronRight size={18}/>}
            <span className='min-w-0 flex-1'><strong className='block text-sm text-ink'>{g.title}</strong><code className='text-xs text-soft'>{g.code}</code></span>
            <span className='shrink-0 text-xs text-soft'>{g.live.length} installed · {g.actions.length} planned</span>
          </button>
          {open&&<div className='border-t border-[rgb(var(--c-border))]'>
            {g.live.map(e=><div key={e.method+' '+e.path} className='flex flex-col gap-1 border-b border-[rgb(var(--c-border))] px-4 py-3 sm:flex-row sm:items-center sm:gap-4'>
              <code className='shrink-0 text-xs font-semibold text-ink'>{e.code??'Code unassigned'}</code>
              <span className='flex-1 text-sm text-ink'>{e.name||e.method+' '+e.path}<span className='block text-xs text-soft'>{e.method} {e.path}</span></span>
              <span className='text-xs text-soft'>Handler installed · {e.permission?'Permission bound':'In-handler controls'} · approval verification pending</span>
            </div>)}
            {showFuture&&g.actions.map(a=><div key={a.code} className='flex flex-col gap-1 border-b border-[rgb(var(--c-border))] px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4'>
              <code className='min-w-0 shrink-0 text-xs font-semibold text-ink'>{a.code}</code>
              <span className='flex-1 text-sm text-ink'>{a.area==='LEG'?a.name:suffix[a.code.split('-').slice(-1)[0]??'']||a.name}</span>
              <span className='text-xs text-soft'>{proposedByCode.has(a.code)?'Existing permission match · verification pending':a.state==='reserved'?'Planned action · not verified':'Existing permission · verification pending'}</span>
            </div>)}
            {!g.live.length&&(!showFuture||!g.actions.length)&&<p className='px-4 py-3 text-sm text-soft'>No installed backend handlers currently listed for this submodule.</p>}
          </div>}
        </div>;
      })}
      {!loading&&!error&&!groups.length&&<p className='rounded-lg border p-4 text-sm text-soft'>No matching submodules.</p>}
    </div>
  </section>;
}
