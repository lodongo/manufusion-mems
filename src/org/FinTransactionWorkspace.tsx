import {useMemo,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Button,Spinner,useLoad} from '../admin/kit';
import {Alert} from '../components/ui';
import {FinScreen,go,useEntity,type Entity} from './finKit';
type Contract={id:string;handlerId:string;name:string;module:string;submodule:string;state:'wired_event'|'placeholder';
 event:string;role:string;glCode:string;scenario:string;requiredInputs:string[];postingAllowed:boolean;handlerRoute:string;implementationNote:string};
type Payload={contracts:Contract[]};
function Board({le,module}:{le:Entity;module:string}){
 const {data,error,loading}=useLoad(()=>callBackend<Payload>('/api/org/fin/mapping/get',{leId:le.id}),[le.id]);
 const [area,setArea]=useState('');
 const [query,setQuery]=useState('');
 const [selected,setSelected]=useState<string|null>(null);
 const [show,setShow]=useState(80);
 const contracts=data?.contracts??[];
 const moduleCodes=useMemo(()=>Array.from(new Set(contracts.map(c=>c.module))).sort(),[data]);
 const currentModule=moduleCodes.includes(module)?module:'';
 const areas=useMemo(()=>Array.from(new Set(contracts.filter(c=>!currentModule||c.module===currentModule).map(c=>c.submodule))).sort(),[data,currentModule]);
 const filtered=useMemo(()=>contracts.filter(c=>(!currentModule||c.module===currentModule)&&(!area||c.submodule===area)
   &&(!query||[c.handlerId,c.name,c.glCode,c.scenario,c.module,c.submodule].join(' ').toLowerCase().includes(query.toLowerCase()))),[data,currentModule,area,query]);
 const detail=contracts.find(c=>c.id===selected);
 if(loading&&!data)return <Spinner/>;
 if(error||!data)return <Alert tone='error'>{error||'Transaction handler contracts could not be loaded.'}</Alert>;
 return <div className='space-y-4'>
  <div className='rounded-xl border border-line p-3'>
    <h3 className='font-semibold text-ink'>GL-linked transaction handler contracts</h3>
    <p className='mt-1 text-sm text-muted'>Every approved posting GL account has at least one registered scenario. The owning module and submodule are shown below. A placeholder has a registered contract and inputs, but no financial posting execution until its operational handler is implemented and validated.</p>
    <div className='mt-2 flex flex-wrap gap-3 text-sm'>
      <span>{contracts.length} registered contracts</span>
      <span className='text-emerald-400'>{contracts.filter(c=>c.state==='wired_event').length} linked to existing events</span>
      <span className='text-amber-400'>{contracts.filter(c=>c.state==='placeholder').length} placeholders</span>
    </div>
  </div>
  <div className='grid gap-3 sm:grid-cols-3'>
    <label className='text-sm text-soft'>Module
      <select data-native-select='true' value={currentModule} onChange={e=>go('fin_transactions/'+(e.target.value||'ALL'))} className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'>
        <option value=''>All modules</option>{moduleCodes.map(code=><option key={code} value={code}>{code}</option>)}
      </select>
    </label>
    <label className='text-sm text-soft'>Submodule
      <select data-native-select='true' value={areas.includes(area)?area:''} onChange={e=>{setArea(e.target.value);setShow(80);}} className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'>
        <option value=''>All submodules</option>{areas.map(a=><option key={a} value={a}>{a}</option>)}
      </select>
    </label>
    <label className='text-sm text-soft'>Find a handler / GL account
      <input type='search' value={query} onChange={e=>{setQuery(e.target.value);setShow(80);}} placeholder='Transaction, GL code or name' className='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink'/>
    </label>
  </div>
  <div className='space-y-2'>
    <p className='text-xs text-muted'>{filtered.length} matching contracts</p>
    {filtered.slice(0,show).map(c=><div key={c.id} className='rounded-xl border border-line bg-panel p-3'>
      <div className='flex flex-wrap justify-between gap-2'>
        <span className='text-xs font-medium text-muted'>{c.module} / {c.submodule}</span>
        <span className={c.state==='placeholder'?'text-xs text-amber-400':'text-xs text-emerald-400'}>
          {c.state==='placeholder'?'Placeholder, not posting':'Linked event, use operational workflow'}
        </span>
      </div>
      <p className='mt-1 font-medium text-ink'>{c.scenario}</p>
      <p className='text-sm text-soft'>{c.glCode} · {c.name}</p>
      <div className='mt-2'><Button variant='secondary' onClick={()=>setSelected(c.id)}>View handler contract</Button></div>
    </div>)}
    {filtered.length>show&&<Button variant='secondary' onClick={()=>setShow(n=>n+80)}>Show more</Button>}
    {!filtered.length&&<p className='p-4 text-sm text-muted'>No transactions in this module and submodule for the legal entity's approved accounts.</p>}
  </div>
  {detail&&<div role='dialog' aria-modal='true' aria-label='Transaction handler contract' className='fixed inset-0 z-[1300] flex items-center justify-center bg-black/70 p-3' onClick={()=>setSelected(null)}>
    <section onClick={e=>e.stopPropagation()} className='max-h-[90dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-2xl border border-line bg-page p-4 text-ink'>
      <div className='flex justify-between gap-3'><h3 className='text-lg font-semibold'>{detail.scenario}</h3><button type='button' className='text-sm underline' onClick={()=>setSelected(null)}>Close</button></div>
      <p className='text-sm'>Handler: <code>{detail.handlerId}</code></p>
      <p className='text-sm'>Owner: <strong>{detail.module} / {detail.submodule}</strong></p>
      <p className='text-sm'>GL account: <strong>{detail.glCode}</strong></p>
      <p className='text-sm'>State: {detail.state==='placeholder'?'Safe placeholder':'Linked to existing operational event'}</p>
      <p className='text-sm'>{detail.implementationNote}</p>
      <h4 className='font-semibold'>Expected transaction attributes</h4>
      <ul className='list-disc space-y-1 pl-5 text-sm'>{detail.requiredInputs.map(x=><li key={x}>{x}</li>)}</ul>
      <p className='text-xs text-amber-400'>Posting is disabled from this contract view. No transaction can bypass actual module security, maker/checker approvals or double-entry validation.</p>
      <Button variant='secondary' onClick={()=>{setSelected(null);go('fin_gl/mapping');}}>Open GL account determination</Button>
    </section>
  </div>}
 </div>;
}
export default function FinTransactionWorkspace({module='ALL'}:{module?:string}){
 const entity=useEntity();
 return <FinScreen title='Transaction handlers' subtitle='Module / submodule transaction contracts tied to your legal entity GL accounts'
   onBack={()=>go('module/'+(module&&module!=='ALL'?module:'FIN'))} entityState={entity}>
   {le=><Board le={le} module={module}/>}
 </FinScreen>;
}
