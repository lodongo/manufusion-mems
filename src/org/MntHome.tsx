import { useState } from 'react';
import { ArrowLeft, ClipboardList, Search, Wrench } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Card, PageTitle, Spinner, useLoad } from '../admin/kit';
type Meta = {key:string;title:string;description:string;items:Array<{code:string;label:string;active:boolean;color?:string;category?:string;selectable?:boolean}>};
export default function MntHome() {
 const [chosen,setChosen]=useState('');
 const [query,setQuery]=useState('');
 const {data,error,loading}=useLoad(()=>callBackend<{lists:Meta[]}>('/api/org/mnt/references'));
 if(loading&&!data)return <Spinner/>;
 if(error)return <Alert tone='error'>{error}</Alert>;
 const lists=data?.lists||[];
 const list=lists.find(x=>x.key===chosen);
 return <div className='space-y-4'>
 <PageTitle title='Maintenance · MNT' subtitle='Maintenance operations and technical reference library'/>
 {list?<><button onClick={()=>{setChosen('');setQuery('');}} className='flex items-center gap-2 text-sm text-slate-300'><ArrowLeft size={16}/>Maintenance workspace</button><Card><h2 className='font-semibold text-white'>{list.title}</h2><p className='text-xs text-slate-400'>{list.description}</p><input aria-label='Search entries' placeholder='Search codes and descriptions' className='mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white' value={query} onChange={e=>setQuery(e.target.value)}/><div className='mt-3 max-h-[65dvh] overflow-y-auto'>{list.items.filter(x=>x.active!==false&&x.selectable!==false&&(x.label.toLowerCase().includes(query.toLowerCase())||x.code.toLowerCase().includes(query.toLowerCase()))).map(x=><div key={x.code} className='flex items-center gap-3 border-b border-slate-800 py-3'><span className='h-3 w-3 shrink-0 rounded-full' style={{background:x.color||'#64748b'}}/><span className='min-w-0 flex-1 text-sm text-white'>{x.label}</span><span className='font-mono text-[11px] text-slate-500'>{x.code}</span></div>)}</div></Card></>:<>
 <div className='grid gap-3 sm:grid-cols-2'><button onClick={()=>navigate('organization_admin/work_requests')} className='rounded-2xl border border-emerald-700 bg-slate-900 p-5 text-left'><Wrench className='mb-2 text-emerald-400'/><p className='font-semibold text-white'>Work requests</p><p className='text-sm text-slate-400'>Raise findings; review, assess and convert to work orders</p></button><button onClick={()=>navigate('organization_admin/work_orders')} className='rounded-2xl border border-emerald-700 bg-slate-900 p-5 text-left'><ClipboardList className='mb-2 text-emerald-400'/><p className='font-semibold text-white'>Work orders</p><p className='text-sm text-slate-400'>Assess tasks, secure resources, execute and reconcile, then complete safety, handover and closure</p></button></div>
 <button onClick={()=>navigate('organization_admin/maintenance_windows')} className='w-full rounded-2xl border border-emerald-700 bg-slate-900 p-5 text-left'><p className='font-semibold text-white'>Maintenance windows</p><p className='text-sm text-slate-400'>Plan one line, schedule tasks, review critical path, approve and print consolidated risks</p></button>
 <h2 className='font-semibold text-white'>MNT reference registers</h2><p className='text-sm text-slate-400'>Enabled reference values maintained centrally by MEMS administration.</p><div className='grid gap-2 sm:grid-cols-2'>{lists.map(x=><button key={x.key} onClick={()=>setChosen(x.key)} className='rounded-xl border border-slate-700 bg-slate-900 p-4 text-left'><p className='font-medium text-white'>{x.title}</p><p className='mt-1 text-xs text-slate-400'>{x.items.filter(i=>i.active!==false&&i.selectable!==false).length} active values</p></button>)}</div></>}
 </div>;
}
