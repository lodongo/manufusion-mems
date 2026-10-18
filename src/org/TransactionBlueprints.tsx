import { useState } from 'react';
import { callBackend } from '../lib/backend';

interface Blueprint {
  code: string; module: string; area: string; name: string;
  kind: 'module_access' | 'submodule_access' | 'transaction';
  state: 'reserved' | 'catalogued_legacy'; executable: false;
  legacyPermissionKeys: string[];
}
const MODULES=['ADM','FIN','INV','MFG','PLN','CST','QLT','MNT','AST','PRC','WHS','LOG','DST','SAL','CRM','POS','HRM','PAY','DOC','RPT','PRJ'];
export default function TransactionBlueprints() {
  const [module,setModule]=useState('PRC');
  const [kind,setKind]=useState('');
  const [items,setItems]=useState<Blueprint[]>([]);
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function load(nextModule=module,nextKind=kind) {
    setBusy(true);setError('');
    try {const data=await callBackend<{items:Blueprint[]}>('/api/org/governance/blueprints/list',{module:nextModule,kind:nextKind});setItems(data.items);}
    catch(e){setItems([]);setError(e instanceof Error?e.message:'Could not load transaction blueprints.');}
    finally{setBusy(false);}
  }
  const shown=items.filter(x=>(x.code+' '+x.name+' '+x.legacyPermissionKeys.join(' ')).toLowerCase().includes(search.toLowerCase()));
  return <section className='space-y-3 rounded-xl border border-[rgb(var(--c-border))] p-4'>
    <h2 className='text-lg font-semibold text-ink'>Codified transaction catalogue</h2>
    <p className='text-sm text-soft'>SAP-inspired Manufusion codes: MODULE–AREA–ACTION. Future transactions are reserved, not available for execution or assignment.</p>
    <div className='grid grid-cols-1 sm:grid-cols-3 gap-2'>
      <label className='text-sm text-ink'>Module<select className='w-full mt-1 border rounded-lg bg-transparent p-3' value={module} onChange={e=>setModule(e.target.value)}>{MODULES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label className='text-sm text-ink'>Type<select className='w-full mt-1 border rounded-lg bg-transparent p-3' value={kind} onChange={e=>setKind(e.target.value)}><option value=''>All</option><option value='module_access'>Module access</option><option value='submodule_access'>Submodule access</option><option value='transaction'>Transaction action</option></select></label>
      <div className='flex items-end'><button type='button' disabled={busy} onClick={()=>load()} className='w-full rounded-lg bg-[rgb(var(--c-brand))] p-3 text-white disabled:opacity-50'>{busy?'Loading…':'Load catalogue'}</button></div>
    </div>
    {error&&<p role='alert' className='text-sm text-red-600'>{error}</p>}
    <input aria-label='Filter transaction codes' className='w-full border rounded-lg p-3 bg-transparent' placeholder='Filter codes or names' value={search} onChange={e=>setSearch(e.target.value)}/>
    <p className='text-xs text-soft'>{shown.length} items shown. No listed blueprint authorizes a business operation.</p>
    <div className='max-h-[440px] overflow-y-auto space-y-2'>{shown.map(x=><div key={x.code} className='rounded-lg border p-3'>
      <div className='flex gap-2 justify-between items-center'><code className='text-xs font-semibold text-ink break-all'>{x.code}</code><span className='text-xs text-soft'>{x.state==='reserved'?'Reserved':'Legacy mapping needed'}</span></div>
      <p className='text-sm text-ink mt-1'>{x.name}</p><p className='text-xs text-soft mt-1'>{x.kind.replaceAll('_',' ')}</p>
    </div>)}</div>
  </section>;
}
