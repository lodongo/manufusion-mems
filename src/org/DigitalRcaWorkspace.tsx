import {useEffect,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card} from '../admin/kit';

type Master={code:string;label:string;active?:boolean};
type MasterResponse={masters:Record<string,Master[]>};
type Dmaic={currentPhase:string;completedPhases:string[];phases:Record<string,Record<string,unknown>>};
type Workspace={documentId:string;title:string;rcaMethodCode:string;frameworkCode:string;analyzeSteps:string[];rcaDmaic:Dmaic;evidence:Array<{id:string;type:string;description:string;verificationStatus:string}>};
const PHASES=['DEFINE','MEASURE','ANALYZE','IMPROVE','CONTROL'];
const FIELDS:Record<string,[string,string][]> = {
 DEFINE:[['problem','Defined problem and desired outcome'],['impact','Impact and business significance'],['scope','Investigation scope and 5W1H description']],
 MEASURE:[['baseline','Quantified baseline, frequency, losses and timeline'],['evidence','Measurements, evidence references, reliability and data gaps']],
 ANALYZE:[['causalAnalysis','Causal reasoning: how the failure occurred'],['validatedCauses','Validated causes, competing hypotheses and evidence references']],
 IMPROVE:[['correctiveActions','Corrective / preventive actions with due dates'],['actionOwners','Accountable owners, safeguards and implementation evidence']],
 CONTROL:[['effectivenessCriteria','Effectiveness verification and recurrence criteria'],['monitoringPlan','Monitoring plan, intervals, triggers and responsible positions']]
};
export default function DigitalRcaWorkspace({documents}:{documents:Array<{documentId:string;title:string;status:string;subtypeCode?:string}>}){
 const [selected,setSelected]=useState(''),[workspace,setWorkspace]=useState<Workspace|null>(null);
 const [master,setMaster]=useState<MasterResponse|null>(null),[fields,setFields]=useState<Record<string,string>>({});
 const [analysis,setAnalysis]=useState<Record<string,string>>({});
 const [causeText,setCauseText]=useState(''),[causeStatus,setCauseStatus]=useState('hypothesis'),[causeEvidence,setCauseEvidence]=useState('');
 const [findings,setFindings]=useState<Array<{text:string;status:string;evidenceIds:string[]}>>([]);
 const [evidenceType,setEvidenceType]=useState('observation'),[evidenceDescription,setEvidenceDescription]=useState(''),[evidenceReference,setEvidenceReference]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;callBackend<MasterResponse>('/api/org/drkms/rca/masters',{}).then(v=>{if(live)setMaster(v)}).catch(()=>{});return()=>{live=false}},[]);
 const load=async(id:string)=>{setSelected(id);setNotice('');setWorkspace(null);if(!id)return;
  try{const v=await callBackend<Workspace>('/api/org/drkms/rca/workspace',{documentId:id});setWorkspace(v);
   const phase=v.rcaDmaic?.currentPhase??'DEFINE',saved=v.rcaDmaic?.phases?.[phase]??{};
   setFields(Object.fromEntries(FIELDS[phase].map(([key])=>[key,String(saved[key]??'')])));
   const rows=Array.isArray(saved.methodAnalysis)?saved.methodAnalysis as Array<{key:string;text:string}>:[];
   setAnalysis(Object.fromEntries(rows.map(r=>[r.key,r.text])));
   setFindings(Array.isArray(saved.causeFindings)?saved.causeFindings as Array<{text:string;status:string;evidenceIds:string[]}>:[]);
  }catch(e){setNotice(e instanceof Error?e.message:'Unable to open investigation.')};
 };
 const save=async(complete:boolean)=>{if(!workspace)return;setBusy(true);setNotice('');
  const phase=workspace.rcaDmaic?.currentPhase??'DEFINE';
  try{
   const methodAnalysis=phase==='ANALYZE'?Object.entries(analysis).filter(([,text])=>text.trim()).map(([key,text])=>({key,text:text.trim()})):[];
   await callBackend('/api/org/drkms/rca/dmaic/save',{documentId:workspace.documentId,phase,complete,fields:{...fields,...(phase==='ANALYZE'?{methodAnalysis,causeFindings:findings}:{})}});
   setNotice(complete?'Phase completed. Continue to the next DMAIC phase.':'Investigation phase saved.');
   await load(workspace.documentId);
  }catch(e){setNotice(e instanceof Error?e.message:'Unable to save phase.');}finally{setBusy(false)}
 };
 const addEvidence=async()=>{if(!workspace)return;setBusy(true);setNotice('');
   try{await callBackend('/api/org/drkms/rca/evidence',{documentId:workspace.documentId,type:evidenceType,description:evidenceDescription,reference:evidenceReference});
      setEvidenceDescription('');setEvidenceReference('');await load(workspace.documentId);
   }catch(e){setNotice(e instanceof Error?e.message:'Cannot register evidence.')}finally{setBusy(false)}
 };
 const phase=workspace?.rcaDmaic?.currentPhase??'DEFINE';
 const method=workspace?.rcaMethodCode??'5WHY';
 const prompts=(workspace?.analyzeSteps??[]).map(k=>[k,
   method==='ISH'?(master?.masters.rca5m1wFactors??[]).find(x=>x.code===k)?.label??k:k.replaceAll('-',' ')]);
 const candidates=documents.filter(d=>d.subtypeCode==='RCA'&&d.status==='draft');
 return <Card><div className='space-y-3'>
   <h2 className='font-semibold text-white'>Continue DMAIC investigation</h2>
   <p className='text-xs text-slate-400'>Define → Measure → Analyze (selected RCA method) → Improve → Control. Evidence and human verification remain mandatory before approval or publication.</p>
   <label className='block text-sm text-slate-200'>Draft RCA
    <select className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white' value={selected} onChange={e=>void load(e.target.value)}>
      <option value=''>Select investigation</option>
      {candidates.map(d=><option key={d.documentId} value={d.documentId}>{d.title}</option>)}
    </select>
   </label>
   {workspace&&<div className='space-y-3'>
    <div className='flex flex-wrap gap-2'>{PHASES.map(p=><span key={p} className={`rounded-full border px-2 py-1 text-xs ${p===phase?'border-blue-400 text-blue-300':workspace.rcaDmaic.completedPhases?.includes(p)?'border-green-700 text-green-400':'border-slate-700 text-slate-400'}`}>{p}</span>)}</div>
    <p className='text-sm text-white'>Analysis method: {master?.masters.rcaMethods?.find(m=>m.code===method)?.label??method} · Reference: {master?.masters.rcaFrameworks?.find(m=>m.code===workspace.frameworkCode)?.label??workspace.frameworkCode}</p>
    {(FIELDS[phase]??[]).map(([key,label])=><label key={key} className='block text-sm text-slate-200'>{label}
      <textarea rows={3} value={fields[key]??''} onChange={e=>setFields(v=>({...v,[key]:e.target.value}))} className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white'/>
    </label>)}
    {phase==='DEFINE'&&<p className='text-xs text-slate-400'>5W1H reference: {(master?.masters.rca5w1h??[]).map(x=>x.label).join(' · ')}</p>}
    {phase==='ANALYZE'&&<section className='space-y-2 rounded-lg border border-slate-700 p-3'>
      <h3 className='text-sm font-semibold text-white'>Investigation evidence</h3>
      {(workspace.evidence??[]).map(e=><p key={e.id} className='text-xs text-slate-300'>{e.id} · {e.type} · {e.description}</p>)}
      <select aria-label='Evidence type' value={evidenceType} onChange={e=>setEvidenceType(e.target.value)} className='min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 text-white'>
        {['observation','inspection','measurement','interview','maintenance_record','alarm','photo_reference','manual_reference'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}
      </select>
      <textarea aria-label='Evidence description' rows={2} value={evidenceDescription} onChange={e=>setEvidenceDescription(e.target.value)} placeholder='What was observed or measured?' className='w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white'/>
      <input aria-label='Evidence reference' value={evidenceReference} onChange={e=>setEvidenceReference(e.target.value)} placeholder='Source reference / record number' className='min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/>
      <button type='button' disabled={busy||evidenceDescription.trim().length<10} onClick={()=>void addEvidence()} className='min-h-11 rounded-lg border border-slate-600 px-3 text-sm text-white disabled:opacity-50'>Register evidence</button>
    </section>}
    {phase==='ANALYZE'&&<div className='space-y-2 rounded-lg border border-slate-700 p-3'>
       <h3 className='text-sm font-medium text-white'>Method-specific analysis</h3>
       {prompts.map(([key,label])=><label key={key} className='block text-sm text-slate-200'>{label}
         <textarea rows={2} className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white' value={analysis[key]??''} onChange={e=>setAnalysis(prev=>({...prev,[key]:e.target.value}))}/>
       </label>)}
       <h3 className='text-sm font-semibold text-white'>Root cause findings</h3>
       {findings.map((f,i)=><div key={i} className='rounded-lg border border-slate-700 p-2 text-sm text-slate-200'>
         <span>{f.status==='verified'?'Verified cause':'Hypothesis'}: {f.text} · {f.evidenceIds.join(', ')||'No evidence linked'}</span>
         <button type='button' onClick={()=>setFindings(v=>v.filter((_,j)=>j!==i))} className='ml-2 text-amber-300'>Remove</button>
       </div>)}
       <textarea aria-label='Causal finding' rows={2} value={causeText} onChange={e=>setCauseText(e.target.value)} placeholder='State the specific cause or hypothesis' className='w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white'/>
       <select aria-label='Causal finding status' value={causeStatus} onChange={e=>setCauseStatus(e.target.value)} className='min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 text-white'>
         <option value='hypothesis'>Hypothesis — not verified</option><option value='verified'>Verified root cause — evidence required</option>
       </select>
       <select aria-label='Supporting evidence' value={causeEvidence} onChange={e=>setCauseEvidence(e.target.value)} className='min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 text-white'>
         <option value=''>Choose supporting evidence</option>{(workspace.evidence??[]).map(e=><option key={e.id} value={e.id}>{e.type}: {e.description.slice(0,70)}</option>)}
       </select>
       <button type='button' disabled={causeText.trim().length<10||(causeStatus==='verified'&&!causeEvidence)} onClick={()=>{setFindings(v=>[...v,{text:causeText.trim(),status:causeStatus,evidenceIds:causeEvidence?[causeEvidence]:[]}]);setCauseText('');setCauseEvidence('')}} className='min-h-11 rounded-lg border border-slate-600 px-3 text-sm text-white disabled:opacity-50'>Add causal finding</button>
       <p className='text-xs text-slate-400'>Record source references and distinguish hypotheses from verified root causes. 5M1W/5M1E categories are centrally controlled in MEMS Admin.</p>
    </div>}
    <div className='grid grid-cols-2 gap-2'>
      <button type='button' disabled={busy} onClick={()=>void save(false)} className='min-h-11 rounded-lg border border-slate-600 text-sm text-white disabled:opacity-50'>Save progress</button>
      <button type='button' disabled={busy||workspace.rcaDmaic.completedPhases?.includes('CONTROL')} onClick={()=>void save(true)} className='min-h-11 rounded-lg bg-blue-600 text-sm font-semibold text-white disabled:opacity-50'>Complete phase</button>
    </div>
   </div>}
   {notice&&<p role='status' className='text-xs text-slate-200'>{notice}</p>}
  </div></Card>;
}
