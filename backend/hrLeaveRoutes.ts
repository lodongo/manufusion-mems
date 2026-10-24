import {randomUUID} from 'node:crypto';
import {HttpError,getDoc,isObj,listDocs,nowIso,str,writeDoc} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';
import {managerFor} from './hrEmployeeRoutes';
import {withLock} from './finCore';
import {hrSiteOf} from './hrHierarchy';
import {currentHrRules} from './hrRulesRoutes';
import {hrMayAccess,hrMayChangeRecord,type HrScope} from './hrPrivacyRules';
import {leaveEligibility,leaveDays,requireLeaveType,type LeaveEligibility,type LeaveOption} from './hrLeaveEligibility';
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
 const viewScope:HrScope=isSelf?'self':isAdmin?'superadmin':manager?'manager':'hr';
 const visible=hrMayAccess(viewScope,'leave',policy);
 return {person,isSelf,isAdmin,manager,hr,
   canRead:visible&&(isAdmin||isSelf||manager||hr),
   canApply:visible&&(isSelf||hr||isAdmin||manager),
   canApprove:visible&&manager&&!isSelf};
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
const isDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'));
const overlap=(a:string,b:string,c:string,d:string)=>a<=d&&c<=b;
function daysFor(type:LeaveOption,start:string,end:string){
 if(type.unit==='months'){
  const begin=new Date(start+'T00:00:00Z');
  const limit=new Date(Date.UTC(begin.getUTCFullYear(),begin.getUTCMonth()+type.daysPerYear,begin.getUTCDate()));
  const last=new Date(limit.getTime()-86400000).toISOString().slice(0,10);
  if(end>last)throw new HttpError(400,'Requested leave exceeds the configured entitlement in calendar months.');
  return 1; // Capacity checks for month-based statutory leave use period dates, not an invented number of days.
 }
 return leaveDays(start,end,type.unit);
}
function earned(type:LeaveOption,start:string,person:Record<string,unknown>){
 if(!type.accrueMonthly||type.unit==='months')return type.daysPerYear+type.carryForwardDays;
 const year=Number(start.slice(0,4));
 const roleStart=assignments(person).map(x=>s(x.startsOn,10)).find(x=>isDate(x))||'';
 const employmentDate=s(person.employmentStartDate||person.hireDate||person.startDate||roleStart,10);
 if(!employmentDate||!isDate(employmentDate))
  throw new HttpError(409,'Monthly leave accrual requires an employee employment start date or effective primary role assignment date.');
 if(employmentDate>start)
  throw new HttpError(409,'Employee employment start is after the requested leave.');
 const fromMonth=employmentDate&&isDate(employmentDate)&&Number(employmentDate.slice(0,4))===year?
  Number(employmentDate.slice(5,7)):1;
 const endMonth=Number(start.slice(5,7));
 return Math.max(0,(endMonth-fromMonth+1)*type.monthlyAccrual)+type.carryForwardDays;
}
/** Plan stage reserves entitlement; actual applications consume approved
 * reservations. Never count an application and its plan twice.
 */
function validateCapacity(type:LeaveOption,start:string,end:string,person:Record<string,unknown>,
 records:Array<{id:string;data:Record<string,unknown>}>,uid:string,kind:'plan'|'application',excludeId=''){
 const requested=daysFor(type,start,end);
 const ceiling=earned(type,start,person);
 if(type.unit==='months')return; // Calendar-month entitlement follows approved exact dates.
 if(requested>type.daysPerYear+type.carryForwardDays)
  throw new HttpError(409,'Requested days exceed the configured leave entitlement.');
 const year=start.slice(0,4);
 const matching=(d:{id:string;data:Record<string,unknown>})=>
  d.id!==excludeId&&s(d.data.employeeUid)===uid&&
  ['approved','pending'].includes(s(d.data.status))&&
  s(d.data.leaveType)===type.code&&s(d.data.start,10).startsWith(year);
 const relevant=records.filter(matching);
 if(kind==='plan'){
  const reserved=relevant.filter(d=>s(d.data.kind)==='plan')
   .reduce((sum,d)=>sum+leaveDays(s(d.data.start,10),s(d.data.end,10),type.unit),0);
  // Count unlinked legacy applications once, not applications already tied to plans.
  const legacy=relevant.filter(d=>s(d.data.kind)==='application'&&!s(d.data.planId))
   .reduce((sum,d)=>sum+leaveDays(s(d.data.start,10),s(d.data.end,10),type.unit),0);
  if(requested+reserved+legacy>ceiling+0.0001)
   throw new HttpError(409,'Planned leave exceeds the accrued/annual entitlement after existing approved and pending plans.');
 }else{
  const booked=relevant.filter(d=>s(d.data.kind)==='application')
   .reduce((sum,d)=>sum+leaveDays(s(d.data.start,10),s(d.data.end,10),type.unit),0);
  if(requested+booked>ceiling+0.0001)
   throw new HttpError(409,'Requested leave exceeds accrued/annual entitlement after existing applications.');
 }
}
function confirmPlanTerms(
 plan:Record<string,unknown>,eligibility:LeaveEligibility,type:LeaveOption
){
 if(s(plan.jobGradeCode)!==eligibility.gradeCode||s(plan.legalEntityId)!==eligibility.legalEntityId)
  throw new HttpError(409,'The employee’s grade or legal entity changed after plan approval; submit a new plan.');
 if(Number(plan.entitlementDays)!==type.daysPerYear||
   plan.accruesMonthly!==type.accrueMonthly||
   s(plan.unit)!==type.unit||
   (plan.carryForwardDays!==undefined&&Number(plan.carryForwardDays)!==type.carryForwardDays))
  throw new HttpError(409,'Configured leave entitlement changed since plan approval; a revised plan needs manager approval.');
}
export const hrLeaveRoutes={
 'POST /api/org/hr/leave/list':[orgRoute('org.hr.leave.list','HRM.shell.view',async ctx=>{
   const uid=s(ctx.body.uid,128)||ctx.uid;
   const access=await scope(ctx,uid);
   if(!access.canRead)throw new HttpError(403,'Leave records outside your authorized scope.');
   const docs=await listDocs(coll(ctx.orgId));
   let eligibility:LeaveEligibility|null=null,configurationError='';
   try{eligibility=await leaveEligibility(ctx.orgId,access.person.data)}
   catch(e){configurationError=e instanceof Error?e.message:'Leave configuration unavailable.'}
   return {items:docs.filter(d=>s(d.data.employeeUid)===uid).map(d=>record(d,access.isSelf||access.isAdmin))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),
    eligibility,configurationError,
    permissions:{canApply:access.canApply&&(access.isSelf||access.hr||access.isAdmin),
      canPlan:access.canApply&&access.isSelf,canApprove:access.canApprove,
      scope:access.isSelf?'self':access.isAdmin?'superadmin':access.manager?'manager':'hr'}};
 })],
 'POST /api/org/hr/leave/create':[orgRoute('org.hr.leave.create','HRM.shell.view',async ctx=>{
   const uid=s(ctx.body.employeeUid,128)||ctx.uid;
   const a=await scope(ctx,uid);
   if(!a.canRead||!a.canApply)throw new HttpError(403,'You cannot request leave for this employee.');
   const kind=s(ctx.body.kind,20),leaveType=s(ctx.body.leaveType,70);
   if(kind!=='plan'&&kind!=='application')throw new HttpError(400,'Select leave planning or leave application.');
   if(!hrMayChangeRecord(ctx.uid,uid,kind==='plan'?'leavePlan':'leaveApplication'))
    throw new HttpError(403,'Protected leave records cannot be modified by their owner.');
   if(kind==='plan'&&!a.isSelf)
    throw new HttpError(403,'The employee must submit their own leave plan for independent manager approval.');
   if(kind==='application'&&!a.isSelf&&!a.hr&&!a.isAdmin)
    throw new HttpError(403,'Only an employee or authorized HR administrator may apply on behalf.');
   const start=s(ctx.body.start,10),end=s(ctx.body.end,10);
   if(!isDate(start)||!isDate(end)||start>end)throw new HttpError(400,'Select valid start and end dates.');
   if(leaveDays(start,end,'calendar_days')>366)throw new HttpError(400,'Leave request exceeds one year.');
   if(start.slice(0,4)!==end.slice(0,4))throw new HttpError(400,'Split leave across calendar years for annual entitlement tracking.');
   const eligibility=await leaveEligibility(ctx.orgId,a.person.data);
   const type=requireLeaveType(eligibility,leaveType);
   const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
   const managerUid=await managerFor(ctx,a.person.data,nodes);
   if(!managerUid)throw new HttpError(409,'A unique active immediate manager is required for both leave stages.');
   const planId=s(ctx.body.planId,50);
   if(kind==='application'&&!planId)
    throw new HttpError(409,'Choose an approved leave plan before applying. Applications cannot bypass planning.');
   if(kind==='plan'&&planId)throw new HttpError(400,'A new leave plan cannot reference a previous plan.');
   return withLock(ctx.orgId,'hr_leave_employee_'+uid,async()=>{
    const records=await listDocs(coll(ctx.orgId));
    if(kind==='application'){
     const plan=records.find(d=>d.id===planId);
     if(!plan||s(plan.data.employeeUid)!==uid||s(plan.data.kind)!=='plan'||s(plan.data.status)!=='approved')
      throw new HttpError(409,'Select an approved leave plan belonging to this employee.');
     if(s(plan.data.leaveType)!==leaveType||start<s(plan.data.start,10)||end>s(plan.data.end,10))
      throw new HttpError(409,'Leave application must match the approved plan type and fall within its approved dates.');
     confirmPlanTerms(plan.data,eligibility,type);
     if(records.some(d=>s(d.data.kind)==='application'&&s(d.data.employeeUid)===uid&&
       ['pending','approved'].includes(s(d.data.status))&&
       overlap(start,end,s(d.data.start,10),s(d.data.end,10))))
      throw new HttpError(409,'A pending or approved leave application already covers these dates.');
    }else if(records.some(d=>s(d.data.kind)==='plan'&&s(d.data.employeeUid)===uid&&
       ['pending','approved'].includes(s(d.data.status))&&s(d.data.leaveType)===leaveType&&
       overlap(start,end,s(d.data.start,10),s(d.data.end,10)))){
      throw new HttpError(409,'A pending or approved leave plan already covers these dates.');
    }
    validateCapacity(type,start,end,a.person.data,records,uid,kind);
    const entry={employeeUid:uid,employeeName:[s(a.person.data.firstName,55),s(a.person.data.lastName,55)].filter(Boolean).join(' '),
     kind,leaveType,start,end,status:'pending',createdAt:nowIso(),updatedAt:nowIso(),
     proposedBy:ctx.uid,submittedFor:uid,managerUid,planId,
     legalEntityId:eligibility.legalEntityId,jobGradeCode:eligibility.gradeCode,
     compensationVersion:eligibility.payConfigVersion,entitlementDays:type.daysPerYear,carryForwardDays:type.carryForwardDays,
     accruesMonthly:type.accrueMonthly,unit:type.unit,note:s(ctx.body.note,280),
     reviewedBy:'',reviewedAt:'',decisionNote:''};
    const id=randomUUID().replace(/-/g,'');
    await writeDoc(coll(ctx.orgId)+'/'+id,entry,{exists:false});
    return {ok:true,id};
   });
 })],
 'POST /api/org/hr/leave/inbox':[orgRoute('org.hr.leave.inbox','HRM.shell.view',async ctx=>{
   const rules=await currentHrRules(ctx.orgId);
   if(!hrMayAccess('manager','leave',rules))return {items:[]};
   const requests=(await listDocs(coll(ctx.orgId))).filter(d=>s(d.data.status)==='pending');
   const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
   const items=[];
   for(const d of requests){
     if(s(d.data.employeeUid)===ctx.uid||s(d.data.proposedBy)===ctx.uid)continue;
     const person=await getDoc('users/'+s(d.data.employeeUid,128));
     if(!person||s(person.data.orgId)!==ctx.orgId||person.data.status==='disabled')continue;
     const managerUid=await managerFor(ctx,person.data,nodes);
     if(managerUid===ctx.uid)items.push(record(d,false));
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
     if(!a.canApprove||!a.manager)throw new HttpError(403,'Only the verified immediate manager may approve leave.');
     if(ctx.uid===s(doc.data.proposedBy))throw new HttpError(403,'The request submitter cannot approve the same request.');
     if(ctx.uid!==s(doc.data.managerUid))throw new HttpError(403,'Manager assignment has changed; reassign this request.');
     const note=s(ctx.body.note,280);
     if(decision==='reject'&&note.length<5)throw new HttpError(400,'Enter a reason for declining leave.');
     if(decision==='approve'){
       const eligibility=await leaveEligibility(ctx.orgId,a.person.data);
       const type=requireLeaveType(eligibility,s(doc.data.leaveType));
       confirmPlanTerms(doc.data,eligibility,type);
       const otherRecords=await listDocs(coll(ctx.orgId));
       validateCapacity(type,s(doc.data.start,10),s(doc.data.end,10),a.person.data,
        otherRecords,uid,s(doc.data.kind)==='plan'?'plan':'application',id);
       if(s(doc.data.kind)==='application'){
         const plan=await getDoc(coll(ctx.orgId)+'/'+s(doc.data.planId,50));
         if(!plan||s(plan.data.status)!=='approved'||s(plan.data.employeeUid)!==uid||
            s(plan.data.leaveType)!==type.code||s(doc.data.start)<s(plan.data.start)||s(doc.data.end)>s(plan.data.end))
          throw new HttpError(409,'The approved leave plan is no longer valid for this application.');
         confirmPlanTerms(plan.data,eligibility,type);
       }
     }
     await writeDoc(path,{...doc.data,status:decision==='approve'?'approved':'rejected',
       reviewedBy:ctx.uid,reviewedAt:nowIso(),decisionNote:note,updatedAt:nowIso()});
     return {ok:true};
   });
 })],
};