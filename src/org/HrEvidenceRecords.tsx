import {useCallback,useEffect,useState} from 'react';
import {BadgeCheck,ClipboardCheck,ExternalLink,FileCheck2,FileClock,FileWarning,FolderOpen,RefreshCw,ShieldCheck} from 'lucide-react';
import {callBackend} from '../lib/backend';
import './hrEvidence.css';

export type HrEvidenceFile={
 id:string;employeeUid:string;educationId:string;documentType:string;name:string;
 mime:string;size:number;sha256:string;status:string;uploadedAt:string;uploadedBy:string;
 reviewedAt:string;reviewedBy:string;reviewNote:string;employeeName?:string;
};
export type EvidenceCategory='degree_certificate'|'transcript'|'professional_certificate'|'diploma_certificate'|'other';
export const CATEGORIES:{value:EvidenceCategory;label:string}[]=[
 {value:'degree_certificate',label:'Degree certificate'},
 {value:'transcript',label:'Academic transcript'},
 {value:'professional_certificate',label:'Professional certificate'},
 {value:'diploma_certificate',label:'Diploma certificate'},
 {value:'other',label:'Other supporting document'}
];
export const categoryLabel=(key:string)=>CATEGORIES.find(c=>c.value===key)?.label||'Supporting document';
export const evidenceStatus=(status:string)=>{
 if(status==='verified')return {label:'HR verified',className:'hr-evidence__status--verified'};
 if(status==='rejected')return {label:'Rejected',className:'hr-evidence__status--rejected'};
 return {label:'Pending HR verification',className:'hr-evidence__status--pending'};
};
export async function readEvidenceFile(file:File):Promise<string>{
 return await new Promise((resolve,reject)=>{
  const r=new FileReader();
  r.onerror=()=>reject(new Error('File could not be read.'));
  r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');
  r.readAsDataURL(file);
 });
}
export const evidenceFormat=(name:string)=>name.replaceAll('_',' ');
export const shortBytes=(size:number)=>size>1000000?(size/1000000).toFixed(1)+' MB':Math.max(1,Math.ceil(size/1000))+' KB';
export function EvidenceRow({file,onChanged,allowReview=false,qualificationName}:{
 file:HrEvidenceFile;onChanged?:()=>void;allowReview?:boolean;qualificationName?:string;
}){
 const [busy,setBusy]=useState(false),[note,setNote]=useState(''),[error,setError]=useState('');
 const [decision,setDecision]=useState<'rejected'|null>(null);
 const [openUrl,setOpenUrl]=useState('');
 const review=async(action:'verified'|'rejected')=>{
  setBusy(true);setError('');
  try{
   await callBackend('/api/org/hr/evidence/review',{
    uid:file.employeeUid,id:file.id,decision:action,reason:note.trim()
   });
   setDecision(null);setNote('');
   onChanged?.();
  }catch(e){setError(e instanceof Error?e.message:'Could not review evidence.');}
  finally{setBusy(false);}
 };
 const open=async()=>{
  setBusy(true);setError('');
  try{
   const response=await callBackend<{url:string}>('/api/org/hr/evidence/open',{uid:file.employeeUid,id:file.id});
   if(!response.url)throw new Error('File is temporarily unavailable.');
   setOpenUrl(response.url);
   window.open(response.url,'_blank','noopener,noreferrer');
  }catch(e){setError(e instanceof Error?e.message:'Cannot open document.');}
  finally{setBusy(false);}
 };
 const status=evidenceStatus(file.status);
 return <article className="hr-evidence__row">
  <span className="hr-evidence__row-icon">{file.status==='verified'?<FileCheck2 size={20}/>:file.status==='rejected'?<FileWarning size={20}/>:<FileClock size={20}/>}</span>
  <div className="hr-evidence__row-content">
   {file.employeeName&&<p className="hr-evidence__employee">{file.employeeName}</p>}
   <p className="hr-evidence__file-name">{file.name}</p>
   <p className="hr-evidence__file-caption">{categoryLabel(file.documentType)} · {shortBytes(file.size)}</p>
   {qualificationName&&<p className="hr-evidence__file-caption">{qualificationName}</p>}
   <span className={'hr-evidence__status '+status.className}>{status.label}</span>
   {file.reviewNote&&<p className="hr-evidence__note">{file.status==='rejected'?'Reason: ':'HR note: '}{file.reviewNote}</p>}
   {file.reviewedAt&&<p className="hr-evidence__date">Reviewed {new Date(file.reviewedAt).toLocaleDateString()}</p>}
  </div>
  <div className="hr-evidence__row-actions">
   <button type="button" onClick={()=>void open()} disabled={busy} className="hr-evidence__open" aria-label={'Open '+file.name}><ExternalLink size={15}/> View</button>
   {allowReview&&file.status==='pending'&&<>
    <button type="button" onClick={()=>void review('verified')} disabled={busy} className="hr-evidence__verify"><BadgeCheck size={15}/> Verify</button>
    <button type="button" onClick={()=>setDecision(decision===null?'rejected':null)} disabled={busy} className="hr-evidence__reject">Reject</button>
   </>}
  </div>
  {decision==='rejected'&&<div className="hr-evidence__review">
   <label>HR rejection reason (required)
    <textarea rows={2} maxLength={500} value={note} onChange={e=>setNote(e.target.value)}
     placeholder="Explain what needs correction or replacement"/>
   </label>
   <button type="button" disabled={busy||note.trim().length<8} onClick={()=>void review('rejected')}>Confirm rejection</button>
  </div>}
  {openUrl&&<p className="hr-evidence__fallback"><a href={openUrl} target="_blank" rel="noopener noreferrer">Open document in another tab</a></p>}
  {error&&<p className="hr-evidence__error" role="alert">{error}</p>}
 </article>;
}
export default function HrEvidenceRecords({employeeUid,qualifications,reviewer=false,viewerUid}:{
 employeeUid:string;qualifications:Array<{id:string;qualification:string;field:string}>;
 reviewer?:boolean;viewerUid:string;
}){
 const [files,setFiles]=useState<HrEvidenceFile[]>([]);
 const [queue,setQueue]=useState<HrEvidenceFile[]>([]);
 const [busy,setBusy]=useState(true),[error,setError]=useState('');
 const [showQueue,setShowQueue]=useState(false);
 const refresh=useCallback(async()=>{
  setBusy(true);setError('');
  try{
   const own=await callBackend<{files:HrEvidenceFile[]}>('/api/org/hr/evidence/list',{uid:employeeUid});
   setFiles(own.files);
   if(reviewer){
    const pending=await callBackend<{files:HrEvidenceFile[]}>('/api/org/hr/evidence/inbox');
    setQueue(pending.files);
   }else setQueue([]);
  }catch(e){setError(e instanceof Error?e.message:'Could not retrieve employee records.');}
  finally{setBusy(false);}
 },[employeeUid,reviewer]);
 useEffect(()=>{void refresh();},[refresh]);
 const education=new Map(qualifications.map(q=>[q.id,q]));
 return <section className="hr-evidence">
  <div className="hr-evidence__heading">
   <span className="hr-evidence__heading-icon"><FolderOpen size={23}/></span>
   <div><h3>My supporting records</h3><p>All evidence is visible here, including documents awaiting HR verification.</p></div>
   <button type="button" disabled={busy} onClick={()=>void refresh()} className="hr-evidence__refresh" aria-label="Refresh records"><RefreshCw size={17}/></button>
  </div>
  <div className="hr-evidence__metrics">
   <span>{files.length} documents</span><span>{files.filter(f=>f.status==='verified').length} verified</span>
   <span>{files.filter(f=>f.status==='pending').length} pending</span>
  </div>
  {busy&&<p className="hr-evidence__message" role="status">Loading employee documents…</p>}
  {error&&<p className="hr-evidence__error" role="alert">{error}</p>}
  {!busy&&files.length===0&&<div className="hr-evidence__empty">No supporting documents uploaded yet. Add a certificate or transcript from the Education tab.</div>}
  {files.map(file=><EvidenceRow key={file.id} file={file} onChanged={()=>void refresh()}
   allowReview={reviewer&&viewerUid!==file.employeeUid}
   qualificationName={education.get(file.educationId)?
    [education.get(file.educationId)?.qualification,education.get(file.educationId)?.field].filter(Boolean).join(' · '):
    'Qualification not available — record retained'}/>)}
  {reviewer&&<div className="hr-evidence__queue">
   <button type="button" onClick={()=>setShowQueue(!showQueue)} className="hr-evidence__queue-toggle">
    <ClipboardCheck size={19}/> HR verification inbox ({queue.length}) <span>{showQueue?'Hide':'Show'}</span>
   </button>
   {showQueue&&<>
    <p className="hr-evidence__queue-intro">Only evidence within your authorized HR scope is listed. Your own evidence cannot be self-verified.</p>
    {!queue.length&&<p className="hr-evidence__empty">No pending evidence assigned for your verification.</p>}
    {queue.map(file=><EvidenceRow key={file.id} file={file} allowReview={viewerUid!==file.employeeUid} onChanged={()=>void refresh()}/>)}
   </>}
  </div>}
  <p className="hr-evidence__privacy"><ShieldCheck size={15}/> Documents remain private. Verification is by an independent authorized HR reviewer, not the employee.</p>
 </section>;
}
