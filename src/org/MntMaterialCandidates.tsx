import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Card,PageTitle,Spinner,useLoad} from '../admin/kit';
import {workspaceNavigate as navigate} from '../lib/route';
import {CatalogPicker} from './MntTaskAssessment';

type Candidate={
 id:string;woCode:string;taskId:string;spareId:string;source:string;description:string;
 qty:number;uom:string;catalogCode:string;attributes:Record<string,string>;
 status:string;materialDraftId?:string;workOrderTitle:string;workOrderStatus:string;
 equipmentName:string;siteName:string;updatedAt:string;
};
type Spec={code:string;name:string;attributes:Array<{code:string;name:string;unit:string;required:boolean}>};
const input='mt-1 w-full rounded-xl border border-line bg-panel p-3 text-base text-ink';
export default function MntMaterialCandidates(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<{items:Candidate[]}>('/api/org/mnt/material-candidates/list'));
 const [chosen,setChosen]=useState<Candidate|null>(null),[filter,setFilter]=useState('open');
 const [spec,setSpec]=useState<Spec|null>(null),[code,setCode]=useState(''),[attributes,setAttributes]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [specError,setSpecError]=useState('');
 const pick=async(nextCode:string)=>{
  setCode(nextCode);setSpec(null);setSpecError('');
  if(!nextCode)return;
  try{
   const response=await callBackend<{spec:Spec}>('/api/org/mnt/material-candidates/spec',{catalogCode:nextCode});
   setSpec(response.spec);
  }catch(e){setSpecError(e instanceof Error?e.message:'Catalogue specification unavailable.');}
 };
 useEffect(()=>{
  if(!chosen){setSpec(null);setCode('');setAttributes({});return;}
  setAttributes(chosen.attributes||{});
  void pick(chosen.catalogCode||'');
 },[chosen?.id]);
 const adopt=async()=>{
  if(!chosen||!code||!spec)return;
  setBusy(true);setMessage('');
  try{
   const r=await callBackend<{materialDraftId:string}>('/api/org/mnt/material-candidates/adopt',{
    candidateId:chosen.id,catalogCode:code,attributes
   });
   setMessage('Material draft '+r.materialDraftId+' created. Complete it in Materials Master and submit through the configured approval workflow.');
   setChosen(null);reload();
  }catch(e){setMessage(e instanceof Error?e.message:'Unable to create material draft.');}
  finally{setBusy(false);}
 };
 const items=data?.items||[];
 const shown=items.filter(x=>filter==='all'||(filter==='open'
   ?['needs_specification','ready_for_material_creation'].includes(x.status)
   :x.status==='awaiting_material_approval'));
 if(loading&&!data)return <Spinner/>;
 return <div className='space-y-4'>
  <PageTitle title='Maintenance material candidates' subtitle='Planner requests from task assessment — controlled Materials Master creation and approval'/>
  <p className='text-sm text-soft'>Maintenance planners send assessed spare descriptions or catalogue items here. A Materials Master maintainer validates the classification and attributes, creates the draft, and uses the existing material approval workflow. No purchase is automatically authorized.</p>
  {error&&<Alert tone='error'>{error}</Alert>}
  {message&&<Alert tone='info'>{message}</Alert>}
  <div className='flex flex-wrap gap-2'>
    {[['open','Awaiting creation'],['approved','Draft created'],['all','All candidates']].map(([key,label])=>
     <Button key={key} variant={filter===key?'primary':'secondary'} onClick={()=>{setFilter(key);setChosen(null);}}>{label}</Button>)}
  </div>
  <p className='text-sm text-soft'>{shown.length} requests</p>
  {shown.map(c=><Card key={c.id} className='space-y-2'>
    <div className='flex flex-wrap justify-between gap-2'><p className='font-semibold text-ink'>{c.description}</p><span className='text-xs text-amber-500'>{c.status.replaceAll('_',' ')}</span></div>
    <p className='text-sm text-soft'>{c.woCode} · {c.workOrderTitle} · task {c.taskId}</p>
    <p className='text-xs text-muted'>{c.equipmentName} · {c.siteName} · Required {c.qty} {c.uom} · {c.source} · {c.catalogCode||'Specification needed'}</p>
    {c.materialDraftId?<div className='flex flex-wrap items-center gap-2'>
     <p className='text-sm'>Material draft: {c.materialDraftId}</p>
     <Button variant='secondary' onClick={()=>navigate('organization_admin/material_catalog')}>Open Materials Master</Button>
    </div>:<Button variant='secondary' onClick={()=>{setChosen(c);setMessage('');}}>Review and create material</Button>}
  </Card>)}
  {!shown.length&&!error&&<Card><p className='text-sm text-soft'>No material creation candidates in this filter.</p></Card>}
  {chosen&&<div role='dialog' aria-modal='true' aria-label='Complete material candidate' className='fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-3' onClick={()=>setChosen(null)}>
   <section onClick={e=>e.stopPropagation()} className='max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-page p-4 text-ink'>
    <div className='flex items-start justify-between gap-2'><h3 className='text-lg font-semibold'>Create material from assessed spare</h3><button type='button' onClick={()=>setChosen(null)} className='text-sm underline'>Close</button></div>
    <p className='mt-2 text-sm text-soft'>{chosen.description} · {chosen.qty} {chosen.uom}</p>
    <p className='mt-2 text-sm text-soft'>Choose a matching technical catalogue item. Required specifications must be completed before a draft can be created.</p>
    <div className='mt-3'><CatalogPicker kind='materials' onSelect={x=>void pick(x.code)}/></div>
    {code&&<p className='mt-2 text-sm text-soft'>Selected catalogue: {code}</p>}
    {specError&&<Alert tone='error'>{specError}</Alert>}
    {spec&&<div className='mt-3 space-y-3'>
     <p className='font-semibold'>{spec.name}</p>
     {(spec.attributes||[]).map(a=><label key={a.code} className='block text-sm text-soft'>{a.name}{a.required?' *':''}{a.unit?' ('+a.unit+')':''}
      <input className={input} value={attributes[a.code]||''} onChange={e=>setAttributes(old=>({...old,[a.code]:e.target.value}))}/>
     </label>)}
    </div>}
    <div className='mt-4 flex flex-wrap gap-2'>
     <Button disabled={!spec||busy||spec.attributes.some(a=>a.required&&!attributes[a.code]?.trim())} busy={busy} onClick={()=>void adopt()}>Create controlled material draft</Button>
     <Button variant='secondary' onClick={()=>setChosen(null)}>Cancel</Button>
    </div>
    <p className='mt-3 text-xs text-amber-500'>Material creation does not approve the material or start purchasing. The normal Materials Master approval process remains mandatory.</p>
   </section>
  </div>}
 </div>;
}
