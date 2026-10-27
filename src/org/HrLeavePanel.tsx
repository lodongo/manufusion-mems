import {useEffect,useMemo,useState} from 'react';
import {CalendarCheck,CheckCircle2,ClipboardList,Plus,ShieldCheck,XCircle} from 'lucide-react';
import {SelectField} from '../components/ui';
import {callBackend} from '../lib/backend';
import {firebaseAuth} from '../firebase';

type Leave={id:string;employeeUid:string;employeeName:string;kind:string;leaveType:string;start:string;end:string;
 status:string;createdAt:string;proposedBy:string;planId:string;reviewedBy:string;reviewedAt:string;decisionNote:string};
type LeaveOption={code:string;name:string;daysPerYear:number;monthlyAccrual:number;accrueMonthly:boolean;
 unit:'working_days'|'calendar_days'|'months';carryForwardDays:number;requiredPlan:true;mandatory:boolean};
type Eligibility={legalEntityId:string;legalEntityName:string;jobRoleCode:string;jobRoleTitle:string;gradeCode:string;
 options:LeaveOption[];payConfigVersion:number};
type Allowed={canApply:boolean;canPlan:boolean;canApprove:boolean;scope:string};
const button='min-h-11 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-onbrand disabled:opacity-40';
const field='min-h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
function LeaveCard({item,names,manager=false,onReview}:{
 item:Leave;names:Record<string,string>;manager?:boolean;onReview?:(id:string,decision:'approve'|'reject')=>void;
}){
 return <article className="rounded-xl border border-line bg-panel p-3">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <strong className="text-sm">{item.employeeName} · {names[item.leaveType]||item.leaveType}</strong>
   <span className="rounded-full border border-line px-2 py-1 text-xs">{item.status}</span>
  </div>
  <p className="mt-1 text-sm text-muted">{item.kind==='plan'?'Leave plan':'Leave application'} · {item.start} to {item.end}</p>
  {item.kind==='application'&&item.planId&&<p className="mt-1 text-xs text-muted">Linked to approved plan: {item.planId.slice(0,12)}</p>}
  {item.decisionNote&&<p className="mt-2 text-xs text-muted">Manager decision: {item.decisionNote}</p>}
  {manager&&onReview&&<div className="mt-3 flex flex-wrap gap-2">
   <button type="button" onClick={()=>onReview(item.id,'approve')} className={button}>
    <CheckCircle2 className="mr-1 inline h-4 w-4"/>Approve</button>
   <button type="button" onClick={()=>onReview(item.id,'reject')} className="min-h-11 rounded-xl border border-line px-4 text-sm">
    <XCircle className="mr-1 inline h-4 w-4"/>Decline</button>
  </div>}
 </article>;
}
export default function HrLeavePanel({employeeUid,showInbox=false}:{employeeUid:string;showInbox?:boolean}){
 const [items,setItems]=useState<Leave[]>([]),[inbox,setInbox]=useState<Leave[]>([]);
 const [teamItems,setTeamItems]=useState<Leave[]>([]);
 const [teamFilter,setTeamFilter]=useState<'all'|'plan'|'application'>('all');
 const [permissions,setPermissions]=useState<Allowed>({canApply:false,canPlan:false,canApprove:false,scope:''});
 const [eligibility,setEligibility]=useState<Eligibility|null>(null),[configurationError,setConfigurationError]=useState('');
 const [kind,setKind]=useState<'plan'|'application'>('plan'),[leaveType,setLeaveType]=useState('');
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[planId,setPlanId]=useState('');
 const [note,setNote]=useState(''),[reviewNote,setReviewNote]=useState('');
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const labels=useMemo(()=>Object.fromEntries((eligibility?.options||[]).map(o=>[o.code,o.name])),[eligibility]);
 const approvedPlans=useMemo(()=>items.filter(p=>p.kind==='plan'&&p.status==='approved'&&
   eligibility?.options.some(t=>t.code===p.leaveType)),[items,eligibility]);
 const selectedPlan=approvedPlans.find(p=>p.id===planId);
 const options=eligibility?.options||[];
 const selectedType=options.find(o=>o.code===leaveType);
 const reload=async()=>{
  setLoading(true);setError('');
  try{
   const [r,q,team]=await Promise.all([
    callBackend<{items:Leave[];permissions:Allowed;eligibility:Eligibility|null;configurationError:string}>('/api/org/hr/leave/list',{uid:employeeUid}),
    showInbox?callBackend<{items:Leave[]}>('/api/org/hr/leave/inbox'):Promise.resolve({items:[]}),
    showInbox?callBackend<{items:Leave[]}>('/api/org/hr/leave/team'):Promise.resolve({items:[]}),
   ]);
   setItems(r.items);setPermissions(r.permissions);setInbox(q.items);setTeamItems(team.items);
   setEligibility(r.eligibility);setConfigurationError(r.configurationError);
  }catch(e){setError(e instanceof Error?e.message:'Leave records unavailable.')}finally{setLoading(false)}
 };
 useEffect(()=>{void reload()},[employeeUid,showInbox]);
 const chooseKind=(value:'plan'|'application')=>{
  setKind(value);setPlanId('');setLeaveType('');setStart('');setEnd('');
 };
 const choosePlan=(id:string)=>{
  const plan=approvedPlans.find(p=>p.id===id);
  setPlanId(id);setLeaveType(plan?.leaveType||'');setStart(plan?.start||'');setEnd(plan?.end||'');
 };
 const create=async()=>{
  if(!eligibility)return;
  setBusy(true);setError('');setMessage('');
  try{
   await callBackend('/api/org/hr/leave/create',{employeeUid,kind,leaveType,start,end,note,planId});
   setOpen(false);setNote('');setPlanId('');setStart('');setEnd('');
   setMessage(kind==='plan'?'Leave plan submitted for direct-manager approval.':'Leave application submitted against approved plan for direct-manager approval.');
   await reload();
  }catch(e){setError(e instanceof Error?e.message:'Could not submit leave.')}finally{setBusy(false)}
 };
 const decide=async(id:string,decision:'approve'|'reject')=>{
  if(decision==='reject'&&reviewNote.trim().length<5){setError('Enter a reason of at least five characters before declining.');return}
  setBusy(true);setError('');setMessage('');
  try{
   await callBackend('/api/org/hr/leave/review',{id,decision,note:reviewNote});
   setReviewNote('');setMessage('Direct-manager decision recorded.');await reload();
  }catch(e){setError(e instanceof Error?e.message:'Approval failed.')}finally{setBusy(false)}
 };
 return <div className="space-y-4">
 {error&&<p role="alert" className="rounded-xl border border-danger/40 p-3 text-sm text-danger">{error}</p>}
 {message&&<p role="status" className="rounded-xl border border-line p-3 text-sm">{message}</p>}
 <section className="rounded-2xl border border-line bg-panel p-3 sm:p-4">
  <h3 className="flex items-center gap-2 font-semibold"><CalendarCheck className="h-5 w-5 text-brand"/>My leave eligibility & plan</h3>
  {eligibility?<div className="mt-3 space-y-2">
   <p className="text-xs text-muted">Legal entity: <strong>{eligibility.legalEntityName}</strong> · Assigned role: {eligibility.jobRoleTitle} · Grade: <strong>{eligibility.gradeCode}</strong></p>
   <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{options.map(o=><div key={o.code} className="rounded-xl border border-line bg-page p-3">
    <h4 className="text-sm font-semibold">{o.name}{o.mandatory?' · Statutory reference':''}</h4>
    <p className="mt-1 text-xs text-muted">{o.daysPerYear} {o.unit.replace('_',' ')} {o.unit==='months'?'entitlement':'per year'}</p>
    <p className="mt-1 text-xs text-muted">{o.accrueMonthly?'Accrual: '+o.monthlyAccrual.toFixed(3)+' per month':'Not accrued monthly'} · Approved plan required</p>
   </div>)}</div>
   {!options.length&&<p className="text-sm text-amber-700">No enabled leave types are configured for your assigned job grade.</p>}
  </div>:<p className="mt-3 text-sm text-amber-700">{configurationError||'Configure the job role, grade and legal-entity leave rules before creating a leave plan.'}</p>}
  <div className="mt-4 flex flex-wrap gap-2">
   {permissions.canPlan&&<button type="button" onClick={()=>{chooseKind('plan');setOpen(true)}} disabled={!options.length} className={button}>
    <Plus className="mr-1 inline h-4 w-4"/>Submit leave plan</button>}
   {permissions.canApply&&<button type="button" onClick={()=>{chooseKind('application');setOpen(true)}} disabled={!approvedPlans.length||!options.length}
    className="min-h-11 rounded-xl border border-line bg-panel px-4 font-semibold text-brand disabled:opacity-40">
    Apply from approved plan</button>}
  </div>
  {permissions.canApply&&!approvedPlans.length&&<p className="mt-2 text-xs text-amber-700">
   No approved plan is available. Submit your plan and obtain immediate-manager approval before applying.</p>}
  {loading?<p className="mt-3 text-sm text-muted">Loading leave records…</p>:items.length===0?<p className="mt-3 text-sm text-muted">No leave plans or applications recorded.</p>:<div className="mt-4 space-y-2">{items.map(x=><LeaveCard key={x.id} item={x} names={labels}/>)}</div>}
 </section>
 {open&&permissions.canApply&&<section className="rounded-2xl border border-line bg-panel p-4">
  <h3 className="mb-2 font-semibold">{kind==='plan'?'Propose leave plan':'Apply against approved leave plan'}</h3>
  <p className="mb-3 text-xs text-muted">{kind==='plan'?'The immediate manager must approve your plan before you apply.':'Choose a manager-approved plan. The actual application is separately approved by the immediate manager.'}</p>
  <div className="grid gap-3 sm:grid-cols-2">
   {kind==='plan'?<SelectField id="hr-leave-type" label="Eligible leave type" value={leaveType}
    onChange={e=>{setLeaveType(e.target.value);setStart('');setEnd('')}}>
    <option value="">Select a configured leave type</option>
    {options.map(o=><option key={o.code} value={o.code}>{o.name} ({o.daysPerYear} {o.unit})</option>)}
   </SelectField>:<div className="sm:col-span-2"><SelectField id="hr-leave-plan" label="Approved leave plan" value={planId} onChange={e=>choosePlan(e.target.value)}>
    <option value="">Select an approved plan</option>
    {approvedPlans.map(p=><option key={p.id} value={p.id}>{labels[p.leaveType]||p.leaveType} · {p.start} to {p.end}</option>)}
   </SelectField></div>}
   {kind==='application'&&selectedPlan&&<p className="sm:col-span-2 text-xs text-muted">
    Approved leave type: {labels[selectedPlan.leaveType]||selectedPlan.leaveType}. Dates must fall within {selectedPlan.start} – {selectedPlan.end}.</p>}
   <label className="text-sm text-muted">From<input type="date" value={start} min={kind==='application'?selectedPlan?.start:undefined}
    max={kind==='application'?selectedPlan?.end:undefined} onChange={e=>setStart(e.target.value)} className={field}/></label>
   <label className="text-sm text-muted">To<input type="date" value={end} min={kind==='application'?selectedPlan?.start:undefined}
    max={kind==='application'?selectedPlan?.end:undefined} onChange={e=>setEnd(e.target.value)} className={field}/></label>
   {selectedType&&<p className="sm:col-span-2 text-xs text-muted">
    {selectedType.daysPerYear} {selectedType.unit.replace('_',' ')} configured · {selectedType.accrueMonthly?'Accrues monthly':'Annual entitlement'} · Direct-manager approval</p>}
   <label className="sm:col-span-2 text-sm text-muted">Note (optional)<textarea maxLength={280} className={field+' min-h-20 p-3'} value={note}
    onChange={e=>setNote(e.target.value)} placeholder="Do not enter medical diagnoses or sensitive family details."/></label>
  </div>
  <div className="mt-3 flex flex-wrap gap-2">
   <button type="button" onClick={()=>setOpen(false)} className="min-h-11 rounded-xl border border-line px-4">Cancel</button>
   <button type="button" disabled={!start||!end||!leaveType||busy||(kind==='application'&&!planId)}
    onClick={()=>void create()} className={button}>{kind==='plan'?'Submit plan':'Submit leave application'}</button>
  </div>
 </section>}
 {showInbox&&<section className="rounded-2xl border border-line bg-panel p-4">
  <h3 className="flex items-center gap-2 font-semibold"><CalendarCheck className="h-5 w-5 text-brand"/>My Reportees — leave planning overview</h3>
  <p className="mt-1 text-xs text-muted">Approved plans reserve leave capacity. Individual applications are tracked separately. Only verified direct reportees appear here; confidential leave notes are not included.</p>
  <div className="mt-3 grid grid-cols-3 gap-2">
   {([['Approved plans',teamItems.filter(x=>x.kind==='plan'&&x.status==='approved').length],
      ['Approved applications',teamItems.filter(x=>x.kind==='application'&&x.status==='approved').length],
      ['Awaiting approval',teamItems.filter(x=>x.status==='pending').length]] as const).map(([label,count])=>
     <div key={label} className="min-w-0 rounded-xl border border-line bg-page p-2">
      <p className="text-xs text-muted">{label}</p><p className="mt-1 text-lg font-bold text-brand">{count}</p>
     </div>)}
  </div>
  <SelectField id="hr-manager-team-stage" label="Planning overview stage" value={teamFilter}
   onChange={e=>setTeamFilter(e.target.value as 'all'|'plan'|'application')}>
   <option value="all">All plans and applications</option>
   <option value="plan">Plans only</option>
   <option value="application">Applications only</option>
  </SelectField>
  <div className="mt-3 max-h-[55dvh] space-y-2 overflow-y-auto">
   {teamItems.filter(x=>teamFilter==='all'||x.kind===teamFilter).map(x=>
    <LeaveCard key={x.id} item={x} names={labels}/>)}
   {!teamItems.some(x=>teamFilter==='all'||x.kind===teamFilter)&&<p className="text-sm text-muted">No direct-report leave records for this stage.</p>}
  </div>
 </section>}
 {showInbox&&<section className="rounded-2xl border border-line bg-panel p-4">
  <h3 className="flex items-center gap-2 font-semibold"><ClipboardList className="h-5 w-5"/>Immediate-manager leave approvals ({inbox.length})</h3>
  <p className="mt-1 text-xs text-muted">Plans must be approved before applications can be submitted. Each application then requires a separate immediate-manager approval.</p>
  {inbox.length>0&&<label className="mt-3 block text-sm text-muted">Decision note<input className={field} value={reviewNote}
   maxLength={280} onChange={e=>setReviewNote(e.target.value)}/></label>}
  <div className="mt-3 space-y-2">{inbox.map(x=><LeaveCard key={x.id} item={x} names={labels} manager
    onReview={busy?undefined:(id,decision)=>void decide(id,decision)}/>)}</div>
  {!loading&&!inbox.length&&<p className="text-sm text-muted">No leave awaiting your decision.</p>}
 </section>}
 <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4"/>
  Configuration, approved planning and direct-manager decision are enforced by the server. Public holidays, historical balances and payroll posting require separate reconciliation.</p>
 </div>;
}