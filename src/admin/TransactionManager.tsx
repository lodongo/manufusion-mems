import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';

type Transaction = {
  code:string|null;module:string;area:string;method:string;path:string;name:string;
  permission:string|null;guard:'organization'|'staff'|'other';
  bindingStatus:'system_bound'|'unguarded_org'|'public_or_custom';
  enforcement:'role_permission'|'authenticated_handler'|'platform_staff'|'unclassified';
};
type Inventory = {
  modules:string[];count:number;items:Transaction[];
  totals:{wired:number;systemBound:number;authenticated:number;permissionGuarded:number;
    selfService:number;staff:number;unguardedOrganization:number};
};

function bindingLabel(t:Transaction) {
  if(t.bindingStatus==='unguarded_org')return 'Engineering check';
  if(t.guard==='organization'&&t.permission)return 'System-bound · role permission';
  if(t.guard==='organization')return 'System-bound · authenticated self-service';
  if(t.guard==='staff')return 'System-bound · MEMS staff';
  return 'Other installed endpoint';
}
export default function TransactionManager(){
  const [data,setData]=useState<Inventory|null>(null);
  const [module,setModule]=useState('');
  const [filter,setFilter]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [copied,setCopied]=useState('');
  const load=()=>{
    setLoading(true);setError('');
    callBackend<Inventory>('/api/admin/transactions/list',{})
      .then(setData)
      .catch(e=>setError(e instanceof Error?e.message:'Unable to load installed transaction codes.'))
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[]);
  const rows=useMemo(()=>data?.items.filter(x=>(!module||x.module===module) &&
    (!filter.trim()||[x.code,x.module,x.area,x.path,x.name,x.permission,x.method]
      .join(' ').toLowerCase().includes(filter.trim().toLowerCase())))??[],[data,module,filter]);
  async function copy(code:string){
    try{await navigator.clipboard.writeText(code);setCopied(code);}
    catch{setCopied('');}
  }
  return <section className='min-w-0 space-y-4 text-white'>
    <header className='space-y-2'>
      <h1 className='text-xl font-bold text-white'>Transactions Manager</h1>
      <p className='text-sm text-slate-300'>Permanent codes for endpoints installed in the running Manufusion server. Existing transactions are registered automatically; organizations do not submit or approve bindings.</p>
      <p className='text-xs text-slate-400'>Registration does not give employees new permissions. Existing authentication, role checks, ownership rules and business approvals remain in force.</p>
    </header>
    {data&&<div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
      {([
        ['Installed routes',data.totals.wired],
        ['System-bound',data.totals.systemBound],
        ['Role-protected',data.totals.permissionGuarded],
        ['Org routes to inspect',data.totals.unguardedOrganization],
      ] as const).map(([label,num])=><div key={label} className='rounded-xl border border-slate-700 bg-slate-900 p-3'>
        <p className='text-xs text-slate-400'>{label}</p>
        <p className='mt-1 text-xl font-semibold text-white'>{num}</p>
      </div>)}
    </div>}
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]'>
      <label className='block text-sm text-slate-200'>Module
        <select value={module} onChange={e=>setModule(e.target.value)}
          className='mt-1 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-base text-white'>
          <option value=''>All modules</option>
          {(data?.modules??[]).map(m=><option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className='block text-sm text-slate-200'>Search codes, routes, permissions
        <span className='mt-1 flex min-h-12 items-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-3'>
          <Search size={18} className='shrink-0 text-slate-400'/>
          <input type='search' value={filter} onChange={e=>setFilter(e.target.value)}
            placeholder='Search transactions' className='min-w-0 w-full bg-transparent text-base text-white outline-none placeholder:text-slate-400'/>
        </span>
      </label>
      <button type='button' onClick={load} disabled={loading}
        className='min-h-12 self-end rounded-xl border border-slate-600 px-4 text-sm font-semibold disabled:opacity-50'>
        <RefreshCw size={16} className='mr-2 inline'/>Refresh
      </button>
    </div>
    {error&&<p role='alert' className='rounded-lg border border-red-500 p-3 text-sm text-red-300'>{error}</p>}
    {loading&&<p role='status' className='text-sm text-slate-300'>Reading installed server transactions…</p>}
    <p className='text-xs text-slate-400'>Showing {rows.length} installed endpoints. Codes derive from the HTTP method and route; deployment order cannot change them.</p>
    <div className='space-y-2'>
      {rows.map(t=><article key={t.method+' '+t.path}
        className='min-w-0 rounded-xl border border-slate-700 bg-slate-900 p-3'>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs text-slate-400'>{t.module} / {t.area}</span>
              <span className='text-xs text-slate-300'>{bindingLabel(t)}</span>
            </div>
            <p className='mt-1 break-words text-sm font-semibold text-white'>{t.name}</p>
            <code className='mt-1 block break-all text-xs text-slate-400'>{t.method} {t.path}</code>
            {t.permission&&<p className='mt-1 break-words text-xs text-slate-300'>Existing role permission: <code>{t.permission}</code></p>}
            {!t.permission&&t.guard==='organization'&&<p className='mt-1 text-xs text-slate-300'>Authenticated route; access is evaluated within its handler.</p>}
          </div>
          {t.code&&<button type='button' aria-label={'Copy transaction code '+t.code} onClick={()=>void copy(t.code!)}
            className='flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-600 px-3 text-xs font-semibold text-white'>
            {copied===t.code?<Check size={16}/>:<Copy size={16}/>}
            <code>{t.code}</code>
          </button>}
        </div>
      </article>)}
      {!loading&&!error&&rows.length===0&&<p className='rounded-xl border border-slate-700 p-4 text-sm text-slate-300'>No matching installed transactions.</p>}
    </div>
    <p className='flex items-start gap-2 text-xs text-slate-400'><ShieldCheck size={16} className='shrink-0'/>Platform registration is automatic. Future routes appear here when deployed, but new role grants, scope checks, and specialist approval requirements must still be implemented by their business module.</p>
  </section>;
}
