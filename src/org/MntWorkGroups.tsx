import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Card,PageTitle,Spinner,useLoad} from '../admin/kit';
type Member={positionCode:string;uid:string};
type Task={code:string;label:string;permission:string|null;mode:string;owner:string;separation:string;external:boolean;requires:string[]};
type Group={id:string;code:string;name:string;siteId:string;costCenterIds:string[];members:Record<string,Member[]>;tasks:Record<string,string[]>;version:number;issues:string[];ready:boolean;effective:{code:string;positions:string[];employees:string[]}[]};
type Setup={titles:string[];sites:{id:string;label:string;code:string}[];costCenters:{id:string;siteId:string;label:string;code:string}[];positions:{id:string;label:string}[];staff:{uid:string;positionCode:string;name:string;costCenterIds:string[]}[];tasks:Task[];groups:Group[];authorizationMode:string};
type Draft=Pick<Group,'id'|'code'|'name'|'siteId'|'costCenterIds'|'members'|'tasks'|'version'>;
const blank=():Draft=>({id:'',code:'',name:'',siteId:'',costCenterIds:[],members:{},tasks:{},version:0});
const field='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-base text-white';
export default function MntWorkGroups(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<Setup>('/api/org/mnt/work-groups'));
 const [draft,setDraft]=useState<Draft|null>(null),[tab,setTab]=useState('scope'),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
 if(loading&&!data)return <Spinner/>;
 if(error||!data)return <Alert tone='error'>{error||'Work groups could not be loaded.'}</Alert>;
 const open=(g?:Group)=>{setDraft(g?{id:g.id,code:g.code,name:g.name,siteId:g.siteId,costCenterIds:g.costCenterIds,members:g.members,tasks:g.tasks,version:g.version}:blank());setTab('scope');setReason('');setMessage('');setQuery('');};
 const edit=(patch:Partial<Draft>)=>setDraft(old=>old?{...old,...patch}:old);
 const actual=(uid:string,role:string)=>data.staff.find(s=>s.uid===uid&&s.positionCode===role)?.name||uid;
 const roleName=(id:string)=>data.positions.find(p=>p.id===id)?.label||id;
 const save=async()=>{if(!draft)return;setBusy(true);setMessage('');try{
  const r=await callBackend<{id:string;version:number;issues:string[];ready:boolean}>('/api/org/mnt/work-groups/save',{...draft,expectedVersion:draft.version,reason});
  edit({id:r.id,version:r.version});setReason('');setMessage('Draft revision '+r.version+' saved. '+(r.ready?'Configuration checks passed.':'Resolve '+r.issues.length+' readiness issues.')+' Operational permissions are unchanged.');reload();setTab('preview');
 }catch(e){setMessage(e instanceof Error?e.message:'Unable to save work group.');}finally{setBusy(false);}};
 const views=['scope','people','tasks','preview'];
 const current=draft?data.groups.find(g=>g.id===draft.id):undefined;
 const staff=draft?data.staff.filter(s=>s.costCenterIds.some(id=>draft.costCenterIds.includes(id))):[];
 return <div className='space-y-4'>
 <PageTitle title='Work Groups' subtitle='Organize maintenance teams by site, cost center, job role and task'/>
 <Alert tone='info'>Configuration and permission preview only. Existing maintenance workflow authorizations remain active until the controlled cutover is implemented and validated. Finance, Safety, Operations and automated stock controls remain independent.</Alert>
 {!draft?<><div className='flex justify-end'><Button onClick={()=>open()}>New work group</Button></div>
 {data.groups.length===0&&<Card>No work groups configured. Create the first group to map your maintenance team.</Card>}
 <div className='grid gap-3 sm:grid-cols-2'>{data.groups.map(g=><button type='button' key={g.id} onClick={()=>open(g)} className='rounded-xl border border-slate-700 bg-slate-900 p-4 text-left'>
 <p className='text-xs text-emerald-400'>{g.code} · Revision {g.version}</p><p className='mt-1 font-semibold text-white'>{g.name}</p><p className='text-sm text-slate-400'>{data.sites.find(s=>s.id===g.siteId)?.label||g.siteId} · {g.costCenterIds.length} cost centers</p><p className='mt-2 text-xs text-amber-300'>{g.ready?'Draft checks passed':'Draft · '+g.issues.length+' readiness issues'}</p></button>)}</div></>:
 <>
 <div className='flex items-center justify-between gap-2'><button className='min-h-11 text-sm text-emerald-400' onClick={()=>{setDraft(null);setMessage('');}}>← All work groups</button><span className='text-xs text-slate-400'>Draft · revision {draft.version}</span></div>
 <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>{views.map(v=><button key={v} onClick={()=>setTab(v)} className={'min-h-11 rounded-lg border p-2 text-sm capitalize '+(tab===v?'border-emerald-500 text-emerald-300':'border-slate-700 text-slate-300')}>{v==='people'?'Roles & people':v==='tasks'?'Task permissions':v}</button>)}</div>
 {tab==='scope'&&<Card><div className='grid gap-3 sm:grid-cols-2'><label className='text-sm text-slate-300'>Code<input className={field} value={draft.code} onChange={e=>edit({code:e.target.value})}/></label><label className='text-sm text-slate-300'>Group name<input className={field} value={draft.name} onChange={e=>edit({name:e.target.value})}/></label></div>
 <label className='mt-3 block text-sm text-slate-300'>Site<select className={field} value={draft.siteId} onChange={e=>edit({siteId:e.target.value,costCenterIds:[],members:{}})}><option value=''>Select site</option>{data.sites.map(s=><option key={s.id} value={s.id}>{s.code} · {s.label}</option>)}</select></label>
 <h3 className='mt-4 text-sm font-semibold text-white'>Cost centers ({draft.costCenterIds.length})</h3>
 <div className='max-h-80 overflow-auto'>{data.costCenters.filter(c=>c.siteId===draft.siteId).map(c=>{const other=data.groups.find(g=>g.id!==draft.id&&g.costCenterIds.includes(c.id));return <label key={c.id} className='flex min-h-11 items-center gap-3 border-b border-slate-800 text-sm text-slate-200'><input type='checkbox' disabled={!!other} checked={draft.costCenterIds.includes(c.id)} onChange={e=>edit({costCenterIds:e.target.checked?[...draft.costCenterIds,c.id]:draft.costCenterIds.filter(x=>x!==c.id)})}/><span>{c.code} · {c.label}{other?' — '+other.name:''}</span></label>;})}</div></Card>}
 {tab==='people'&&<><p className='text-sm text-slate-400'>Map an organizational job role by selecting its current named employee. Multiple employees and repeated roles across titles are allowed. Each person must hold the selected role within the chosen cost centers.</p>{data.titles.map(t=><Card key={t}><h3 className='font-semibold text-white'>{t}</h3>
 {(draft.members[t]||[]).map((m,i)=><div key={m.positionCode+'|'+m.uid} className='flex items-center justify-between gap-2 border-b border-slate-800 py-2'><div><p className='text-sm text-white'>{actual(m.uid,m.positionCode)}</p><p className='text-xs text-slate-400'>{roleName(m.positionCode)}</p></div><button className='min-h-11 px-2 text-sm text-rose-300' onClick={()=>edit({members:{...draft.members,[t]:(draft.members[t]||[]).filter((_,n)=>n!==i)}})}>Remove</button></div>)}
 <select aria-label={'Add '+t} className={field} value='' onChange={e=>{const s=staff.find(x=>x.positionCode+'|'+x.uid===e.target.value);if(s)edit({members:{...draft.members,[t]:[...(draft.members[t]||[]),{uid:s.uid,positionCode:s.positionCode}]}});}}>
 <option value=''>Add organizational role & employee</option>{staff.filter(s=>!(draft.members[t]||[]).some(m=>m.uid===s.uid&&m.positionCode===s.positionCode)).map((s,i)=><option key={s.positionCode+'|'+s.uid+'|'+i} value={s.positionCode+'|'+s.uid}>{roleName(s.positionCode)} — {s.name}</option>)}</select></Card>)}</>}
 {tab==='tasks'&&<><input value={query} onChange={e=>setQuery(e.target.value)} className={field} placeholder='Search task, gate or permission'/><p className='text-xs text-slate-400'>Gate and permission rows are distinct. Existing prerequisites always apply. External authorities and employee request rights are shown but not assigned by a work group.</p>
 {data.tasks.filter(t=>(t.label+' '+t.code+' '+(t.permission||'')).toLowerCase().includes(query.toLowerCase())).map(t=><Card key={t.code}><p className='font-medium text-white'>{t.label}</p><p className='break-all text-xs text-slate-400'>{t.code} · {t.mode}</p><p className='mt-1 text-xs text-slate-400'>{t.separation}</p>{t.external?<p className='mt-2 text-xs text-amber-300'>Retained authority · {t.owner}</p>:<div className='mt-2 grid gap-1 sm:grid-cols-2'>{data.titles.map(title=><label key={title} className='flex min-h-10 items-center gap-2 text-sm text-slate-200'><input type='checkbox' checked={(draft.tasks[t.code]||[]).includes(title)} onChange={e=>edit({tasks:{...draft.tasks,[t.code]:e.target.checked?[...(draft.tasks[t.code]||[]),title]:(draft.tasks[t.code]||[]).filter(x=>x!==title)}})}/>{title}</label>)}</div>}</Card>)}</>}
 {tab==='preview'&&<><Alert tone='info'>This is a simulation, not an active security grant. The existing role mapping and independent approvals are unchanged.</Alert>
 <Card><h3 className='font-semibold text-white'>Readiness (last saved revision)</h3>{current?current.issues.length?<ul className='mt-2 space-y-1 text-sm text-amber-200'>{current.issues.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p className='text-sm text-emerald-300'>Draft configuration checks passed.</p>:<p className='text-sm text-slate-400'>Save the configuration to run server-side readiness checks.</p>}</Card>
 {data.tasks.filter(t=>!t.external&&(draft.tasks[t.code]||[]).length).map(t=><Card key={t.code}><p className='font-medium text-white'>{t.label}</p><p className='text-xs text-slate-400'>{t.code}</p>{(draft.tasks[t.code]||[]).map(k=><div className='mt-2 text-sm' key={k}><p className='text-emerald-300'>{k}</p><p className='text-slate-300'>{(draft.members[k]||[]).map(m=>roleName(m.positionCode)+' — '+actual(m.uid,m.positionCode)).join('; ')||'No named employee'}</p></div>)}</Card>)}</>}
 <Card><label className='block text-sm text-slate-300'>Reason for change<textarea className={field} rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className='mt-3'><Button disabled={busy||reason.trim().length<10||!draft.siteId||!draft.costCenterIds.length} onClick={save}>{busy?'Saving…':'Save work group draft'}</Button></div>{message&&<p className='mt-2 text-sm text-slate-200'>{message}</p>}</Card>
 </>}
 </div>;
}
