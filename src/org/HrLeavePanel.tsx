import {useEffect,useState} from 'react';
import {CalendarCheck,CheckCircle2,ClipboardList,Plus,ShieldCheck,XCircle} from 'lucide-react';
import {SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
import {firebaseAuth} from '../firebase';
type Leave={id:string;employeeUid:string;employeeName:string;kind:string;leaveType:string;start:string;end:string;status:string;createdAt:string;proposedBy:string;planId:string;reviewedBy:string;reviewedAt:string;decisionNote:string};
type Allowed={canApply:boolean;canApprove:boolean;scope:string};
const button='min-h-11 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-onbrand disabled:opacity-40';
const field='min-h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
const labels:Record<string,string>={annual:'Annual',sick:'Sick',compassionate:'Compassionate',maternity:'Maternity',paternity:'Paternity',study:'Study',unpaid:'Unpaid',other:'Other'};
function LeaveCard({item,manager=false,onReview}:{item:Leave;manager?:boolean;onReview?:(id:string,decision:'approve'|'reject')=>void}){
 return <div className="rounded-xl border border-line bg-panel p-3">
 <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.employeeName} · {labels[item.leaveType]||item.leaveType}</strong><span className="rounded-full border border-line px-2 py-1 text-xs">{item.status}</span></div>
 <p className="mt-1 text-sm text-muted">{item.kind==='plan'?'Leave plan':'Leave application'} · {item.start} to {item.end}</p>
 {item.decisionNote&&<p className="mt-2 text-xs text-muted">Decision: {item.decisionNote}</p>}
 {manager&&onReview&&<div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>onReview(item.id,'approve')} className={button}><CheckCircle2 className="mr-1 inline h-4 w-4"/>Approve</button><button onClick={()=>onReview(item.id,'reject')} className="min-h-11 rounded-xl border border-line px-4 text-sm"><XCircle className="mr-1 inline h-4 w-4"/>Decline</button></div>}
 </div>;
}
export default function HrLeavePanel({employeeUid,showInbox=false}:{employeeUid:string;showInbox?:boolean}){
 const [items,setItems]=useState<Leave[]>([]),[inbox,setInbox]=useState<Leave[]>([]);
 const [permissions,setPermissions]=useState<Allowed>({canApply:false,canApprove:false,scope:''});
 const [kind,setKind]=useState('application'),[leaveType,setLeaveType]=useState('annual');
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[planId,setPlanId]=useState('');
 const [note,setNote]=useState(''),[reviewNote,setReviewNote]=useState('');
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const reload=async()=>{
  setLoading(true);setError('');
  try{
   const [r,q]=await Promise.all([
    callBackend<{items:Leave[];permissions:Allowed}>('/api/org/hr/leave/list',{uid:employeeUid}),
    showInbox?callBackend<{items:Leave[]}>('/api/org/hr/leave/inbox'):Promise.resolve({items:[]}),
   ]);
   setItems(r.items);setPermissions(r.permissions);setInbox(q.items);
  }catch(e){setError(e instanceof Error?e.message:'Leave records unavailable.')}finally{setLoading(false)}
 };
 useEffect(()=>{void reload()},[employeeUid,showInbox]);
 const create=async()=>{
  setBusy(true);setError('');setMessage('');
  try{await callBackend('/api/org/hr/leave/create',{employeeUid,kind,leaveType,start,end,note,planId});
   setOpen(false);setNote('');setPlanId('');setMessage('Leave request sent to the appropriate approval queue.');await reload()}
  catch(e){setError(e instanceof Error?e.message:'Could not submit leave.')}finally{setBusy(false)}
 };
 const decide=async(id:string,decision:'approve'|'reject')=>{
  if(decision==='reject'&&reviewNote.trim().length<5){setError('Enter a reason of at least five characters before declining.');return}
  setBusy(true);setError('');setMessage('');
  try{await callBackend('/api/org/hr/leave/review',{id,decision,note:reviewNote});setReviewNote('');setMessage('Manager decision recorded.');await reload()}
  catch(e){setError(e instanceof Error?e.message:'Approval failed.')}finally{setBusy(false)}
 };
 return <div className="space-y-4">
 {error&&<p role="alert" className="rounded-xl border border-red-500/50 p-3 text-sm text-red-600">{error}</p>}
 {message&&<p role="status" className="rounded-xl border border-line p-3 text-sm">{message}</p>}
 <section className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
  <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><CalendarCheck className="h-5 w-5 text-brand"/>Leave plans & applications</h3>{permissions.canApply&&<button onClick={()=>setOpen(true)} className={button}><Plus className="mr-1 inline h-4 w-4"/>New</button>}</div>
  {permissions.scope==='hr'&&<p className="mt-2 text-xs text-muted">HR may view and submit on behalf. Only a verified manager can approve.</p>}
  {loading?<p className="mt-3 text-sm text-muted">Loading leave records…</p>:items.length===0?<p className="mt-3 text-sm text-muted">No leave plans or applications recorded.</p>:<div className="mt-3 space-y-2">{items.map(x=><LeaveCard key={x.id} item={x}/>)}</div>}
 </section>
 {open&&permissions.canApply&&<section className="rounded-2xl border border-line bg-panel p-4">
  <h3 className="mb-3 font-semibold">Submit leave {employeeUid===firebaseAuth.currentUser?.uid?'':'on behalf of employee'}</h3>
  <div className="grid gap-3 sm:grid-cols-2">
   <SelectField id="hr-leave-kind" label="Request stage" value={kind} onChange={e=>setKind(e.target.value)}><option value="plan">Leave plan</option><option value="application">Actual application</option></SelectField>
   <SelectField id="hr-leave-type" label="Leave category" value={leaveType} onChange={e=>setLeaveType(e.target.value)}>{Object.entries(labels).map(([code,title])=><option key={code} value={code}>{title}</option>)}</SelectField>
   <label className="text-sm text-muted">From<input type="date" value={start} onChange={e=>setStart(e.target.value)} className={field}/></label>
   <label className="text-sm text-muted">To<input type="date" value={end} onChange={e=>setEnd(e.target.value)} className={field}/></label>
   {kind==='application'&&<div className="sm:col-span-2"><SelectField id="hr-leave-plan" label="Approved plan (optional)" value={planId} onChange={e=>setPlanId(e.target.value)}><option value="">No linked plan</option>{items.filter(x=>x.kind==='plan'&&x.status==='approved').map(x=><option key={x.id} value={x.id}>{x.start} to {x.end} · {labels[x.leaveType]}</option>)}</SelectField></div>}
   <label className="sm:col-span-2 text-sm text-muted">Private note (optional)<textarea maxLength={280} className={field+' min-h-20 p-3'} value={note} onChange={e=>setNote(e.target.value)} placeholder="Do not enter medical diagnoses or sensitive family circumstances here."/></label>
  </div>
  <div className="mt-3 flex gap-2"><button onClick={()=>setOpen(false)} className="min-h-11 rounded-xl border border-line px-4">Cancel</button><button disabled={!start||!end||busy} onClick={()=>void create()} className={button}>Submit</button></div>
 </section>}
 {showInbox&&<section className="rounded-2xl border border-line bg-panel p-4"><h3 className="flex items-center gap-2 font-semibold"><ClipboardList className="h-5 w-5"/>Manager leave approvals ({inbox.length})</h3>
  <p className="mt-1 text-xs text-muted">Review plans and applications for verified reportees. HR view permissions do not grant approval.</p>
  {inbox.length>0&&<label className="mt-3 block text-sm text-muted">Decision note<input className={field} value={reviewNote} maxLength={280} onChange={e=>setReviewNote(e.target.value)}/></label>}
  <div className="mt-3 space-y-2">{inbox.map(x=><LeaveCard key={x.id} item={x} manager onReview={busy?undefined:(id,decision)=>void decide(id,decision)}/>)}</div>
  {!loading&&inbox.length===0&&<p className="text-sm text-muted">No leave awaiting your decision.</p>}
 </section>}
 <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4"/>Approvals and submissions are recorded. Balances and payroll remain separate until their integration is approved.</p>
 </div>;
}
