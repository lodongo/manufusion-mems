import {useEffect,useState} from 'react';
import {BadgeCheck,ShieldCheck} from 'lucide-react';
import {callBackend} from '../lib/backend';
import RichTable,{type Column} from '../components/RichTable';
import {messageOf,useConfirm} from '../components/screen';

export type JobGradeRequest={
 id:string;legalEntityId:string;legalEntityName:string;title:string;status:string;amount:number|null;currency:string;
 draftVersion:number;gradeCount:number;enabledCount:number;lowestSalary:number;highestSalary:number;
 changes:Array<{code:string;title:string;rank:number;kind:string;from:number|null;to:number;enabled:boolean}>;
 reason:string;makerName:string;mine:boolean;createdAt:string;decidedAt:string;canDecide:boolean;whyNot:string;
 steps:Array<{level:string;title:string;positionTitle:string;status:string;byName:string;at:string}>;
 history:Array<{at:string;byName:string;action:string;note:string}>;
};
const money=(n:number|null,c:string)=>n===null?'—':(c?c+' ':'')+new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(n);
const label=(s:string)=>s.replaceAll('_',' ');

/**
 * Job grade activation requests. The maker sees their own requests; approvers see the requests they may decide.
 * Each decision is one Chart-of-Authority level and the server enforces maker-checker.
 */
export default function HrJobGradeApprovals({legalEntityId,refreshKey=0,onChanged}:{legalEntityId?:string;refreshKey?:number;onChanged?:()=>void}){
 const [rows,setRows]=useState<JobGradeRequest[]>([]),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[selected,setSelected]=useState('');
 const [canApprove,setCanApprove]=useState(false);
 const {ask,sheet}=useConfirm();
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<{requests:JobGradeRequest[];canApprove:boolean}>('/api/org/hr/job-grades/requests',{});
   setRows(r.requests.filter(x=>!legalEntityId||x.legalEntityId===legalEntityId));setCanApprove(r.canApprove);
  }catch(e){setError(messageOf(e,'Job grade approvals could not be loaded.'))}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[legalEntityId,refreshKey]);
 const chosen=rows.find(r=>r.id===selected);
 const decide=(r:JobGradeRequest,decision:'approve'|'reject')=>ask(decision==='approve'?{
   title:'Approve '+r.id+'?',confirmLabel:'Approve this level',
   message:<>You approve the current Chart of Authority level for activating job grades draft v{r.draftVersion} in {r.legalEntityName}: {r.enabledCount} enabled grades, minimum monthly salary {money(r.lowestSalary,r.currency)} to {money(r.highestSalary,r.currency)}, estimated annual cost {money(r.amount,r.currency)}. When the last level approves, the grades become active for job roles, leave eligibility and compensation.</>,
   acknowledge:'I have reviewed the grades, minimum salaries, taxes and deductions, and the cost estimate.',
  }:{
   title:'Reject '+r.id+'?',tone:'danger',confirmLabel:'Reject',
   message:'The request is closed. The draft stays as it is and can be corrected and resubmitted.',
   reason:{label:'Reason for rejection',minLength:10},
  },async reason=>{
   const res=await callBackend<{status:string}>('/api/org/hr/job-grades/decide',{id:r.id,decision,reason,acknowledge:decision==='approve'});
   setNotice(r.id+(res.status==='approved'?' approved — the job grades are now active.':res.status==='pending'?' level approved; the next level is now pending.':' rejected.'));
   await load();onChanged?.();
  });
 const withdraw=(r:JobGradeRequest)=>ask({title:'Withdraw '+r.id+'?',tone:'danger',confirmLabel:'Withdraw',
  message:'The request is cancelled. Nothing is activated.',reason:{label:'Reason for withdrawal',minLength:10}},
  async reason=>{await callBackend('/api/org/hr/job-grades/withdraw',{id:r.id,reason});setNotice(r.id+' withdrawn.');await load();onChanged?.()});
 const columns:Column<JobGradeRequest>[]=[
  {key:'id',label:'Request',value:r=>r.id},
  {key:'entity',label:'Legal entity',value:r=>r.legalEntityName},
  {key:'status',label:'Status',value:r=>r.canDecide?'Awaiting you':label(r.status)},
  {key:'amount',label:'Annual cost',type:'number',value:r=>r.amount},
  {key:'currency',label:'Currency',value:r=>r.currency},
  {key:'grades',label:'Enabled grades',type:'number',value:r=>r.enabledCount},
  {key:'draft',label:'Draft',type:'number',value:r=>r.draftVersion},
  {key:'level',label:'Current level',value:r=>r.steps.find(s=>s.status==='pending')?.positionTitle||''},
  {key:'maker',label:'Submitted by',value:r=>r.makerName},
  {key:'created',label:'Submitted',type:'date',value:r=>r.createdAt.slice(0,10)},
  {key:'reason',label:'Reason',value:r=>r.reason,hidden:true},
 ];
 return <section className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
  {sheet}
  <div className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-brand"/><h3 className="font-semibold">Job grade approvals</h3></div>
  <p className="text-xs text-muted">Activating job grades is approved level by level under the Chart of Authority, based on the estimated annual cost. Nobody approves their own request or two levels of the same request.</p>
  {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {chosen&&<div className="space-y-2 rounded-xl border border-line bg-page p-3">
   <strong className="text-sm">{chosen.id} · {chosen.title}</strong>
   <p className="text-xs text-muted">{chosen.legalEntityName} · {chosen.enabledCount} of {chosen.gradeCount} grades enabled · minimum monthly salary {money(chosen.lowestSalary,chosen.currency)} to {money(chosen.highestSalary,chosen.currency)} · estimated annual cost {money(chosen.amount,chosen.currency)}</p>
   <p className="text-xs text-muted">Reason: {chosen.reason}</p>
   {chosen.changes.length>0&&<div className="space-y-1">
    <p className="text-xs font-semibold text-ink">What changes ({chosen.changes.length})</p>
    <ul className="space-y-1 text-xs text-muted">{chosen.changes.map(c=><li key={c.code||c.title+c.rank}>
     Grade {c.rank} · {c.title} — {c.kind==='new'?'new grade':c.kind==='disabled'?'disabled':'changed'}
     {c.kind!=='disabled'&&c.from!==c.to&&<> · minimum salary {c.from===null?'not set':money(c.from,chosen.currency)} → {money(c.to,chosen.currency)}</>}
    </li>)}</ul></div>}
   <ol className="space-y-1 text-xs">{chosen.steps.map(s=><li key={s.level} className={s.status==='approved'?'text-brand':'text-muted'}>
    {s.level} · {s.positionTitle} — {s.status==='approved'?'approved by '+s.byName+' '+s.at.slice(0,10):label(s.status)}</li>)}</ol>
   {!chosen.canDecide&&chosen.status==='pending'&&chosen.whyNot&&<p className="text-xs text-muted">{chosen.whyNot}</p>}
   <div className="flex flex-wrap gap-2">
    {chosen.canDecide&&<button type="button" onClick={()=>decide(chosen,'approve')} className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand">Approve level</button>}
    {chosen.canDecide&&<button type="button" onClick={()=>decide(chosen,'reject')} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold">Reject</button>}
    {chosen.mine&&chosen.status==='pending'&&<button type="button" onClick={()=>withdraw(chosen)} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold">Withdraw</button>}
   </div>
  </div>}
  {loading?<p className="text-sm text-muted">Loading approvals…</p>:
   <RichTable id="hr-job-grade-approvals" title="Job grade approvals" fileName="Job_grade_approvals"
    columns={columns} rows={rows} rowKey={r=>r.id} onRowClick={r=>setSelected(r.id===selected?'':r.id)}
    rowClassName={r=>r.id===selected?'bg-brand/10':''} height="h-[50dvh] min-h-[280px]"
    empty={canApprove?'No job grade activation requests.':'You have no job grade activation requests.'}/>}
  <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0"/>Approving needs the HR – Job Grade Approver security role for the legal entity and the job role mapped to the current authority level.</p>
 </section>;
}
