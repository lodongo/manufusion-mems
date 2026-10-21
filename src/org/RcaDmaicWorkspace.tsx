import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card} from '../admin/kit';
type Item={documentId:string;title:string;subtypeCode?:string;status:string;dmaicStage?:string;methodCode?:string;frameworkCode?:string};
const stages=['DEFINE','MEASURE','ANALYZE','IMPROVE','CONTROL'] as const;
const prompts:Record<string,string>={
 '5WHY':'Trace the failure through consecutive Why questions, supported by evidence at each link. Distinguish symptoms from verified root causes.',
 'ISH':'Build causal branches under the selected 5M1W/6M categories. Verify candidate branches using observations and measurements.',
 'FTA':'State the top event, model AND/OR causal relationships, then validate base events.',
 'FMEA':'Identify failure modes, effects, underlying causes, controls and assess severity/occurrence/detection.',
 '8D':'Establish the team, containment, cause verification, permanent action and recurrence prevention.',
 'A3':'Capture background, current condition, target, analysis, countermeasures and follow-up.',
 'KT':'Contrast IS and IS NOT in what, where, when and extent, then test possible causes.',
 'PARETO':'Rank quantified loss or failure categories, identify the vital few and confirm causal mechanisms.',
 'CAUSAL':'Order the event sequence, conditions and defenses before identifying confirmed causes.',
 'BOWTIE':'Identify top event, threats, consequences and preventive/recovery barriers.',
 'DMAIC':'Apply structured statistical/operational analysis backed by measured baseline.',
};
const guidance:Record<string,string>={
 DEFINE:'Describe the failure, impact, affected asset, scope and desired outcome. Confirm the investigation owner.',
 MEASURE:'Document baseline performance, when and how the failure occurred, measurements, timeline, and evidence reliability.',
 ANALYZE:'Apply the selected RCA method; evaluate alternative causes and cite evidence for each verified causal conclusion.',
 IMPROVE:'Define immediate containment, corrective/preventive actions, owners, resources, milestones and residual risk.',
 CONTROL:'Specify effectiveness criteria, measurements, follow-up dates, standard updates and knowledge reuse.',
};
export default function RcaDmaicWorkspace({documents,onSaved}:{documents:Item[];onSaved:()=>void}){
 const drafts=documents.filter(x=>x.subtypeCode==='RCA'&&x.status==='draft');
 const [selected,setSelected]=useState(''),[stage,setStage]=useState<string>('DEFINE'),[findings,setFindings]=useState(''),[evidence,setEvidence]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const current=drafts.find(x=>x.documentId===selected);
 const submit=async()=>{
  setBusy(true);setNotice('');
  try{const r=await callBackend<{dmaicStage:string}>('/api/org/drkms/rca/stage',{documentId:selected,stage,findings,evidenceIds:evidence.split(',').map(x=>x.trim()).filter(Boolean)});
   setNotice('DMAIC '+r.dmaicStage+' findings saved. Advancement requires the previous stage and supporting evidence.');onSaved();
  }catch(err){setNotice(err instanceof Error?err.message:'Unable to save DMAIC findings.');}finally{setBusy(false);}
 };
 return <Card><div className='space-y-3'>
  <h2 className='font-semibold text-white'>DMAIC guided investigation</h2>
  <p className='text-sm text-slate-300'>Select an existing draft RCA. Every chosen analysis method follows Define → Measure → Analyze → Improve → Control.</p>
  <label className='block text-sm text-white'>Investigation
   <select className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white' value={selected} onChange={e=>{setSelected(e.target.value);const d=drafts.find(x=>x.documentId===e.target.value);setStage(d?.dmaicStage||'DEFINE');setFindings('');setEvidence('');}}>
    <option value=''>Choose RCA draft</option>{drafts.map(d=><option value={d.documentId} key={d.documentId}>{d.title}</option>)}
   </select>
  </label>
  {current&&<>
   <p className='text-xs text-slate-300'>Method: {current.methodCode||'5WHY'} · Reference: {current.frameworkCode||'5M1W'} · Current phase: {current.dmaicStage||'DEFINE'}</p>
   <div className='flex flex-wrap gap-1'>{stages.map((s,i)=><button key={s} type='button' onClick={()=>setStage(s)} disabled={i>stages.indexOf((current.dmaicStage||'DEFINE') as typeof stages[number])+1} className={'rounded-lg border px-2 py-2 text-xs '+(stage===s?'border-blue-500 bg-blue-900 text-white':'border-slate-600 text-slate-300 disabled:opacity-30')}>{i+1}. {s}</button>)}</div>
   <p className='text-sm text-slate-300'>{guidance[stage]}</p>
   {stage==='ANALYZE'&&<p className='rounded-lg border border-slate-700 p-2 text-sm text-slate-200'>{prompts[current.methodCode||'5WHY']||prompts['5WHY']}</p>}
   <label className='block text-sm text-white'>Findings and decision rationale<textarea className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white' rows={5} value={findings} onChange={e=>setFindings(e.target.value)}/></label>
   <label className='block text-sm text-white'>Registered evidence IDs, comma-separated<input className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white' value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder='Evidence IDs from this investigation'/></label>
   <button type='button' onClick={()=>void submit()} disabled={busy||findings.trim().length<20} className='min-h-11 w-full rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-40'>{busy?'Saving…':'Save DMAIC phase'}</button>
  </>}
  {notice&&<p role='status' className='text-sm text-slate-300'>{notice}</p>}
 </div></Card>;
}
