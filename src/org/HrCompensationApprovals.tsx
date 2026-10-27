import {useEffect,useState} from 'react';
import {BadgeCheck,ShieldCheck} from 'lucide-react';
import {callBackend} from '../lib/backend';
import RichTable,{type Column} from '../components/RichTable';
import {useConfirm} from '../components/screen';

export type CompensationRequest={
 id:string;legalEntityId:string;legalEntityName:string;title:string;status:string;amount:number|null;currency:string;
 draftVersion:number;enabledCount:number;leaveTypes:string[];reason:string;makerName:string;mine:boolean;
 createdAt:string;decidedAt:string;canDecide:boolean;whyNot:string;
 steps:Array<{level:string;title:string;positionTitle:string;status:string;byName:string;at:string}>;
 history:Array<{at:string;byName:string;action:string;note:string}>;
};
const money=(n:number|null,c:string)=>n===null?'—':(c?c+' ':'')+new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(n);
const label=(s:string)=>s.replaceAll('_',' ');

/**
 * Compensation policy activation requests. Shows the maker their own requests and approvers the requests
 * they may decide. Each decision is one Chart-of-Authority level; the server enforces maker-checker.
 */
export default function HrCompensationApprovals({legalEntityId,refreshKey=0,onChanged}:{legalEntityId?:string;refreshKey?:number;onChanged?:()=>void}){
 const [rows,setRows]=useState<CompensationRequest[]>([]),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[selected,setSelected]=useState('');
 const [canApprove,setCanApprove]=useState(false);
 const {ask,sheet}=useConfirm();
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const r=await callBackend<{requests:CompensationRequest[];canApprove:boolean}>('/api/org/hr/compensation/requests');
   setRows(r.requests.filter(x=>!legalEntityId||x.legalEntityId===legalEntityId));setCanApprove(r.canApprove);
  }catch(e){setError(e instanceof Error?e.message:'Compensation approvals could not be loaded.')}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[legalEntityId,refreshKey]);
 const chosen=rows.find(r=>r.id===selected);
 const decide=(r:CompensationRequest,decision:'approve'|'reject')=>ask(decision==='approve'?{
   title:'Approve '+r.id+'?',confirmLabel:'Approve this level',
   message:<>You approve the current Chart of Authority level for activating draft v{r.draftVersion} in {r.legalEntityName}, estimated annual cost {money(r.amount,r.currency)}. When the last level is approved the policy becomes active for leave entitlement.</>,
   acknowledge:'I have reviewed the policy items, legal compliance and the cost estimate.',
  }:{
   title:'Reject '+r.id+'?',tone:'danger',confirmLabel:'Reject',
   message:'The request is closed. The draft stays as it is and can be corrected and resubmitted.',
   reason:{label:'Reason for rejection',minLength:10},
  },async reason=>{
   const res=await callBackend<{status:string}>('/api/org/hr/compensation/decide',{id:r.id,decision,reason,acknowledge:decision==='approve'});
   setNotice(r.id+(res.status==='approved'?' approved — the policy is now active.':res.status==='pending'?' level approved; the next level is now pending.':' rejected.'));
   await load();onChanged?.();
  });
 const withdraw=(r:CompensationRequest)=>ask({title:'Withdraw '+r.id+'?',tone:'danger',confirmLabel:'Withdraw',
  message:'The request is cancelled. Nothing is activated.',reason:{label:'Reason for withdrawal',minLength:10}},
  async reason=>{await callBackend('/api/org/hr/compensation/withdraw',{id:r.id,reason});setNotice(r.id+' withdrawn.');await load();onChanged?.();});
 const columns:Column<CompensationRequest>[]=[
  {key:'id',label:'Request',value:r=>r.id},
  {key:'entity',label:'Legal entity',value:r=>r.legalEntityName},
  {key:'status',label:'Status',value:r=>r.canDecide?'Awaiting you':label(r.status)},
  {key:'amount',label:'Annual cost',type:'number',value:r=>r.amount},
  {key:'currency',label:'Currency',value:r=>r.currency},
  {key:'draft',label:'Draft',type:'number',value:r=>r.draftVersion},
  {key:'level',label:'Current level',value:r=>r.steps.find(s=>s.status==='pending')?.positionTitle||''},
  {key:'maker',label:'Submitted by',value:r=>r.makerName},
  {key:'created',label:'Submitted',type:'date',value:r=>r.createdAt.slice(0,10)},
  {key:'reason',label:'Reason',value:r=>r.reason,hidden:true},
 ];
 return <section className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
  {sheet}
  <div className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-brand"/><h3 className="font-semibold">Compensation policy approvals</h3></div>
  <p className="text-xs text-muted">Activation of pay, benefit and leave-entitlement policy is approved level by level under the Chart of Authority. Nobody approves their own request or two levels of the same request.</p>
  {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  {chosen&&<div className="space-y-2 rounded-xl border border-line bg-page p-3">
   <strong className="text-sm">{chosen.id} · {chosen.title}</strong>
   <p className="text-xs text-muted">{chosen.legalEntityName} · {chosen.enabledCount} enabled items · leave types {chosen.leaveTypes.join(', ')||'none'} · estimated annual cost {money(chosen.amount,chosen.currency)}</p>
   <p className="text-xs text-muted">Reason: {chosen.reason}</p>
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
   <RichTable id="hr-compensation-approvals" title="Compensation policy approvals" fileName="Compensation_policy_approvals"
    columns={columns} rows={rows} rowKey={r=>r.id} onRowClick={r=>setSelected(r.id===selected?'':r.id)}
    rowClassName={r=>r.id===selected?'bg-brand/10':''} height="h-[50dvh] min-h-[280px]"
    empty={canApprove?'No compensation activation requests.':'You have no compensation activation requests.'}/>}
  <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 shrink-0"/>Approving needs the HR – Compensation Approver security role for the legal entity and the job role mapped to the current authority level.</p>
 </section>;
}
