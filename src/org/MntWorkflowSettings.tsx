import MntSelect from './MntSelect';
import {useEffect,useMemo,useState} from 'react';
import {callBackend} from '../lib/backend';
import { Alert, TextArea } from '../components/ui';
import {Button,Card,PageTitle,Spinner,useLoad} from '../admin/kit';
import {workspaceNavigate as navigate} from '../lib/route';
import {suggestGateRoles} from './mntGateSuggest';
type Gate={code:string;stage:string;label:string;owner:string;permission?:string|null;status:'existing'|'pending_implementation';requires:string[];configuredRole:string;roleRequired:boolean;ready:boolean;legacyOnly?:boolean};
type Response={gates:Gate[];jobRoles:{id:string;label:string}[];revision:number;configuredAt:string;note:string;workflowSchema?:number;retiredKeys?:string[]};
const stages=['request','assessment','conversion','planning','scheduling','execution','closure'];
export default function MntWorkflowSettings(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<Response>('/api/org/mnt/workflow/configuration'));
 const [roles,setRoles]=useState<Record<string,string>|null>(null);
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [cleaned,setCleaned]=useState<number|null>(null);
 const current=useMemo(()=>roles??Object.fromEntries((data?.gates||[]).map(g=>[g.code,g.configuredRole||''])),[roles,data]);
 useEffect(()=>{setRoles(null);},[data?.revision]);
 const changed=!!data&&(!!data.retiredKeys?.length||data.gates.some(g=>(current[g.code]||'')!==(g.configuredRole||'')));
 const [suggested,setSuggested]=useState<string[]>([]);
 useEffect(()=>{setSuggested([]);},[data?.revision]);
 if(loading&&!data)return <Spinner/>;
 if(error||!data)return <Alert tone='error'>{error||'Workflow setup could not be loaded.'}</Alert>;
 const save=async()=>{
  setBusy(true);setMessage('');
  try{
   const result=await callBackend<{version:number}>('/api/org/mnt/workflow/configuration/save',{
     approverRoles:current,expectedVersion:data.revision,reason
   });
   setMessage('Saved role assignments as configuration revision '+result.version+'. Operational transitions enforce these organizational role assignments.');
   setReason('');setRoles(null);reload();
  }catch(e){setMessage(e instanceof Error?e.message:'Unable to save workflow.');}
  finally{setBusy(false);}
 };
 const cleanup=async()=>{setBusy(true);setMessage('');setCleaned(null);try{const r=await callBackend<{changed:number;receipt?:string}>('/api/org/mnt/workflow/configuration/cleanup',{reason,confirm:true});setCleaned(r.changed);setMessage(r.changed?r.changed+' configuration documents cleaned. Receipt: '+r.receipt:'No obsolete role mappings or explicit permission grants remain.');reload();}catch(e){setMessage(e instanceof Error?e.message:'Cleanup failed');}finally{setBusy(false);}};
 return <div className='space-y-4'>
   <button type='button' onClick={()=>navigate('organization_admin/mnt_home')} className='text-sm text-emerald-400 underline'>← Maintenance</button>
   <PageTitle title='Maintenance workflows & approvals' subtitle='Operational responsibility, independent approvals and configuration'/>
   <Alert tone='info'>Active Work Groups govern maintenance duties at covered cost centers. This screen assigns independent Safety authority and fallback job roles for locations without active groups; Finance cost approvals follow the Chart of Authority. There is no Technical Manager closure or equipment handover approval.</Alert>
   {!!data.retiredKeys?.length&&<Alert tone='warn'>Obsolete role mappings detected: {data.retiredKeys.join(', ')}. Save with a reason to remove these dormant mappings from the database.</Alert>}
   {(()=>{
    const required=data.gates.filter(g=>g.roleRequired&&!g.legacyOnly);
    const missing=required.filter(g=>!current[g.code]);
    const label=(id:string)=>data.jobRoles.find(r=>r.id===id)?.label||id;
    const suggest=()=>{
     const picks=suggestGateRoles(data.gates,data.jobRoles,current);
     const codes=Object.keys(picks);
     setSuggested(codes);
     if(codes.length){setRoles({...current,...picks});if(!reason.trim())setReason('Assigning accountable job roles to unconfigured maintenance workflow gates.');}
     setMessage(codes.length?`Suggested ${codes.length} job role${codes.length===1?'':'s'} by title. Review each one, then save with a reason.`:'No job role titles matched. Choose the roles yourself below.');
    };
    return <Card>
     <div className='flex flex-wrap items-center justify-between gap-2'>
      <div><p className='text-sm font-semibold text-white'>{missing.length?`${missing.length} of ${required.length} fallback / independent roles are not configured`:`All ${required.length} fallback / independent roles are configured`}</p>
       <p className='text-xs text-slate-400'>For uncovered locations or independent Safety approval, required roles must be configured. Active Work Group allocations are maintained in Work Groups.</p></div>
      {missing.length>0&&data.jobRoles.length>0&&<Button variant='secondary' onClick={suggest}>Suggest job roles</Button>}
     </div>
     {missing.length>0&&<ul className='mt-2 flex flex-wrap gap-1.5'>{missing.map(g=><li key={g.code}><a href={'#gate-'+g.code.replace(/\./g,'-')} className='inline-flex min-h-9 items-center rounded-full border border-amber-500/50 px-3 text-xs text-amber-200'>{g.code}</a></li>)}</ul>}
     {suggested.length>0&&<ul className='mt-2 space-y-1 text-xs text-slate-300'>{suggested.map(c=><li key={c}><span className='font-mono'>{c}</span> → {label(current[c])}</li>)}</ul>}
     {!data.jobRoles.length&&<div className='mt-2'><Alert tone='warn'>No job roles exist yet. Create job roles first, then assign them here.</Alert><button type='button' onClick={()=>navigate('organization_admin/positions')} className='mt-2 min-h-11 text-sm text-emerald-400 underline'>Open job roles</button></div>}
     <p className='mt-2 text-xs text-slate-400'>People must also hold the chosen job role at the maintenance location (assigned in HR or job roles).</p>
    </Card>;
   })()}
   {stages.map(stage=>{
    const gates=data.gates.filter(g=>g.stage===stage);
    if(!gates.length)return null;
    return <Card key={stage}>
      <h2 className='mb-3 text-base font-semibold capitalize text-white'>{stage==='conversion'?'Historical compatibility only':stage}</h2>
      <div className='space-y-3'>{gates.map(g=><div key={g.code} id={'gate-'+g.code.replace(/\./g,'-')} className={'scroll-mt-24 rounded-xl border p-3 '+(g.roleRequired&&!current[g.code]?'border-amber-500/60':suggested.includes(g.code)?'border-emerald-500/60':'border-slate-700')}>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div><p className='text-sm font-semibold text-white'>{g.label}</p><p className='text-xs text-slate-400'>{g.code} · {g.owner}{g.permission?` · Security activity: ${g.permission}`:''}</p></div>
          <span className={g.status==='existing'?'text-xs text-emerald-400':'text-xs text-amber-400'}>{g.status==='existing'?'Operational handler':'Pending implementation'}</span>
        </div>
        {g.roleRequired&&<div className='mt-2 block text-sm text-soft'>Assigned organizational job role
          <MntSelect label={'Assigned organizational job role'} hideLabel value={current[g.code]||''} onChange={e=>setRoles({...current,[g.code]:e.target.value})}>
            <option value=''>Not configured</option>
            {data.jobRoles.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}
          </MntSelect>
          {suggested.includes(g.code)&&<span className='mt-1 block text-xs text-emerald-400'>Suggested from the job role title. Check it before saving.</span>}
        </div>}
        <p className='mt-2 text-xs text-slate-400'>Prerequisites: {g.requires.length?g.requires.map(x=>x.replaceAll('_',' ')).join(' · '):'None'}</p>
      </div>)}</div>
    </Card>;
   })}
   <Card>
    <p className='text-sm text-slate-300'>Revision {data.revision}. {changed?'Unsaved configuration changes':'No pending changes'}.</p>
    <TextArea label='Reason for changes' className='mt-2' value={reason} onChange={e=>setReason(e.target.value)} rows={3} placeholder='Why are these approval role assignments appropriate?'/>
    <div className='mt-3'><Button disabled={busy||!changed||reason.trim().length<10} onClick={save}>{busy?'Saving…':'Save workflow configuration'}</Button></div>
    <div className='mt-3 border-t border-line pt-3'><p className='text-sm font-semibold'>Remove obsolete workflow configuration</p><p className='text-xs text-soft'>Remove retired handover, technical closure, reopening and duplicate confirmation mappings from saved workflow settings, Work Groups and explicit security roles. Active role assignments and historical audit records are retained. Organization Super Admin only.</p><Button variant='secondary' disabled={busy||reason.trim().length<10} onClick={cleanup}>Clean obsolete settings and permissions</Button>{cleaned!==null&&<p className='text-xs text-soft'>{cleaned} documents changed</p>}</div>
    {message&&<p className='mt-2 text-sm text-slate-200'>{message}</p>}
   </Card>
 </div>;
}

