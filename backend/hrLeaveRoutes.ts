import {randomUUID} from 'node:crypto';
import {HttpError,fieldEq,getDoc,isObj,listDocs,nowIso,runQuery,str,writeDoc} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';
import {managerFor} from './hrEmployeeRoutes';
import {withLock} from './finCore';
import {hrSiteOf} from './hrHierarchy';
import {currentHrRules} from './hrRulesRoutes';
import {hrMayAccess,type HrScope} from './hrPrivacyRules';
const coll=(org:string)=>`organizations/${org}/hr_leave_requests`;
const s=(v:unknown,n=200)=>str(v).trim().slice(0,n);
const assignments=(d:Record<string,unknown>)=>Array.isArray(d.assignments)?d.assignments.filter(isObj).filter(x=>s(x.type)==='primary'):[];
const sites=(ctx:OrgContext,other:Record<string,unknown>,nodes:Map<string,Record<string,unknown>>)=>assignments(ctx.me.data).some(x=>assignments(other).some(y=>{
  const a=hrSiteOf(s(x.nodeId),nodes);return !!a&&a===hrSiteOf(s(y.nodeId),nodes);
}));
const target=async(ctx:OrgContext,uid:string)=>{
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(uid))throw new HttpError(400,'Invalid employee.');
 const person=uid===ctx.uid?ctx.me:await getDoc('users/'+uid);
 if(!person||s(person.data.orgId)!==ctx.orgId||person.data.status==='disabled')
  throw new HttpError(404,'Employee not found.');
 return person;
};
const scope=async(ctx:OrgContext,uid:string)=>{
 const person=await target(ctx,uid);
 const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
 const isSelf=uid===ctx.uid,isAdmin=ctx.role==='org_super_admin';
 const manager=(await managerFor(ctx,person.data,nodes))===ctx.uid&&!isSelf;
 const hr=hasPerm(ctx.directPermissions,'HRM.employee.site.read')&&sites(ctx,person.data,nodes);
 const policy=await currentHrRules(ctx.orgId);
 const viewScope:HrScope=isAdmin?'superadmin':isSelf?'self':manager?'manager':'hr';
 const visible=hrMayAccess(viewScope,'leave',policy);
 return {person,isSelf,isAdmin,manager,hr,canRead:visible&&(isAdmin||isSelf||manager||hr),
  canApply:visible&&(!isAdmin||!isSelf),canApprove:visible&&!isSelf&&(isAdmin||manager)};
};
function record(doc:{id:string;data:Record<string,unknown>},includePrivate:boolean){
 const d=doc.data;
 return {id:doc.id,employeeUid:s(d.employeeUid,128),employeeName:s(d.employeeName,140),
  kind:s(d.kind,30),leaveType:s(d.leaveType,60),start:s(d.start,10),end:s(d.end,10),
  status:s(d.status,40),createdAt:s(d.createdAt,40),proposedBy:s(d.proposedBy,128),
  submittedFor:s(d.submittedFor,128),managerUid:s(d.managerUid,128),
  planId:s(d.planId,50),reviewedBy:s(d.reviewedBy,128),reviewedAt:s(d.reviewedAt,40),
  note:includePrivate?s(d.note,280):'',decisionNote:s(d.decisionNote,280)};
}
export const hrLeaveRoutes={
 'POST /api/org/hr/leave/list':[orgRoute('org.hr.leave.list','HRM.shell.view',async ctx=>{
   const uid=s(ctx.body.uid,128)||ctx.uid;
   const access=await scope(ctx,uid);
   if(!access.canRead)throw new HttpError(403,'Leave records outside your authorized scope.');
   const docs=await listDocs(coll(ctx.orgId));
   return {items:docs.filter(d=>s(d.data.employeeUid)===uid).map(d=>record(d,access.isSelf||access.isAdmin))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),
    permissions:{canApply:access.canApply&&(access.isSelf||access.isAdmin||access.manager||access.hr),
      canApprove:access.canApprove,scope:access.isAdmin?'superadmin':access.isSelf?'self':access.manager?'manager':'hr'}};
 })],
 'POST /api/org/hr/leave/create':[orgRoute('org.hr.leave.create','HRM.shell.view',async ctx=>{
   const uid=s(ctx.body.employeeUid,128)||ctx.uid;
   const a=await scope(ctx,uid);
   if(!a.canRead||!a.canApply)throw new HttpError(403,'You cannot apply for this employee.');
   if(!a.isSelf&&!a.isAdmin&&!a.hr&&!a.manager)throw new HttpError(403,'No on-behalf leave permission.');
   const kind=s(ctx.body.kind,20),leaveType=s(ctx.body.leaveType,60);
   const start=s(ctx.body.start,10),end=s(ctx.body.end,10);
   if(kind==='plan'&&a.hr&&!a.isSelf&&!a.manager&&!a.isAdmin)throw new HttpError(403,'HR may submit actual leave applications on behalf, but cannot manage leave plans.');
   if(!['plan','application'].includes(kind)||!['annual','sick','compassionate','maternity','paternity','study','unpaid','other'].includes(leaveType))
    throw new HttpError(400,'Select a supported leave request and category.');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end)))
    throw new HttpError(400,'Select valid start and end dates.');
   const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
   if(days>366)throw new HttpError(400,'Leave request exceeds one year.');
   const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
   const managerUid=await managerFor(ctx,a.person.data,nodes);
   if(!managerUid&&!a.isAdmin)throw new HttpError(409,'Immediate manager must be configured before requesting leave.');
   const planId=s(ctx.body.planId,50);
   if(planId){
     const plan=await getDoc(coll(ctx.orgId)+'/'+planId);
     if(!plan||s(plan.data.employeeUid)!==uid||s(plan.data.kind)!=='plan'||s(plan.data.status)!=='approved')
      throw new HttpError(409,'Reference an approved leave plan for this employee.');
   }
   const entry={employeeUid:uid,employeeName:[s(a.person.data.firstName,55),s(a.person.data.lastName,55)].filter(Boolean).join(' '),
    kind,leaveType,start,end,status:'pending',createdAt:nowIso(),updatedAt:nowIso(),
    proposedBy:ctx.uid,submittedFor:uid,managerUid,planId,note:s(ctx.body.note,280),
    reviewedBy:'',reviewedAt:'',decisionNote:''};
   const id=randomUUID().replace(/-/g,'');
   await writeDoc(coll(ctx.orgId)+'/'+id,entry,{exists:false});
   return {ok:true,id};
 })],
 'POST /api/org/hr/leave/inbox':[orgRoute('org.hr.leave.inbox','HRM.shell.view',async ctx=>{
   const rules=await currentHrRules(ctx.orgId);
   if(ctx.role!=='org_super_admin'&&!hrMayAccess('manager','leave',rules))return {items:[]};
   const requests=(await listDocs(coll(ctx.orgId))).filter(d=>s(d.data.status)==='pending');
   const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
   const items=[];
   for(const d of requests){
     if(s(d.data.employeeUid)===ctx.uid)continue;
     const person=await getDoc('users/'+s(d.data.employeeUid,128));
     if(!person||s(person.data.orgId)!==ctx.orgId||person.data.status==='disabled')continue;
     const managerUid=await managerFor(ctx,person.data,nodes);
     if(ctx.role==='org_super_admin'||(managerUid===ctx.uid&&s(d.data.managerUid)===ctx.uid))
       items.push(record(d,false));
   }
   return {items};
 })],
 'POST /api/org/hr/leave/review':[orgRoute('org.hr.leave.review','HRM.shell.view',async ctx=>{
   const id=s(ctx.body.id,50),decision=s(ctx.body.decision,12);
   if(!/^[a-f0-9]{32}$/.test(id)||!['approve','reject'].includes(decision))
    throw new HttpError(400,'Invalid approval.');
   return withLock(ctx.orgId,'hr_leave_'+id,async()=>{
     const path=coll(ctx.orgId)+'/'+id,doc=await getDoc(path);
     if(!doc||s(doc.data.status)!=='pending')throw new HttpError(409,'Leave request no longer pending.');
     const uid=s(doc.data.employeeUid,128),a=await scope(ctx,uid);
     if(!a.canApprove)throw new HttpError(403,'Only the immediate manager or super administrator can approve, never their own record.');
     if(ctx.uid===s(doc.data.proposedBy))throw new HttpError(403,'The request submitter cannot approve the same request.');
     if(!a.isAdmin&&ctx.uid!==s(doc.data.managerUid))throw new HttpError(403,'Manager assignment has changed; reassign this request.');
     const note=s(ctx.body.note,280);
     if(decision==='reject'&&note.length<5)throw new HttpError(400,'Enter a reason for declining leave.');
     // Do not automatically post payroll or leave balances: those require separate integrations.
     await writeDoc(path,{...doc.data,status:decision==='approve'?'approved':'rejected',
       reviewedBy:ctx.uid,reviewedAt:nowIso(),decisionNote:note,updatedAt:nowIso()});
     return {ok:true};
   });
 })],
};
