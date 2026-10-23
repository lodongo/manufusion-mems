import {createHash} from 'node:crypto';
import {withLock} from './finCore';
import { HttpError, fieldEq, getDoc, listDocs, nowIso, runQuery, str, writeDoc } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { managerFor } from './hrEmployeeRoutes';
import { HR_RULE_DEFAULTS, hrRules, hrVisibleTabs, type HrRules } from './hrPrivacyRules';
import { hrSiteOf } from './hrHierarchy';
import { buildFitIndex } from './hrSkillFit';

const path=(org:string)=>`organizations/${org}/hr_access_rules/default`;
export const currentHrRules=async(org:string):Promise<HrRules>=>hrRules((await getDoc(path(org)))?.data);
const assigned=(d:Record<string,unknown>):string[]=>Array.isArray(d.assignments)?d.assignments.filter((a):a is Record<string,unknown>=>!!a&&typeof a==='object'&&!Array.isArray(a)).filter(a=>str(a.type)==='primary').map(a=>str(a.nodeId)).filter(Boolean):[];
const basic=(d:{id:string;data:Record<string,unknown>})=>({uid:d.id,name:[str(d.data.firstName),str(d.data.lastName)].filter(Boolean).join(' '),employeeNumber:str(d.data.employeeNumber),jobRole:str((Array.isArray(d.data.assignments)?d.data.assignments:[]).find((a):a is Record<string,unknown>=>!!a&&typeof a==='object'&&!Array.isArray(a)&&a.type==='primary')?.positionCode)});
export const hrRulesRoutes={
 'POST /api/org/hr/access-rules/get':[orgRoute('org.hr.access_rules.get','HRM.shell.view',async ctx=>{
  const canConfigure=ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,'HRM.rules.manage');
  const canApprove=ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,'HRM.rules.approve');
  const pending=canConfigure||canApprove?await getDoc(`organizations/${ctx.orgId}/hr_access_rules/pending`):null;
  return {rules:await currentHrRules(ctx.orgId),canConfigure,canApprove,
   pending:pending?.data.status==='pending'?{
    rules:hrRules(pending.data.rules),proposedBy:str(pending.data.proposedBy),
    proposedAt:str(pending.data.proposedAt),status:'pending',
   }:null};
 })],
 'POST /api/org/hr/access-rules/simulate':[orgRoute('org.hr.access_rules.simulate','HRM.rules.manage',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'HRM.rules.manage'))
    throw new HttpError(403,'HR privacy rule administrator required.');
  const proposed=hrRules(ctx.body.rules);
  if(!proposed.selfTabs.includes('basic')||!proposed.managerTabs.includes('basic')||!proposed.hrTabs.includes('basic'))
    throw new HttpError(400,'Basic identity may not be hidden.');
  const digest=createHash('sha256').update(JSON.stringify(proposed)).digest('hex');
  return {digest,preview:{
   employee:hrVisibleTabs('self',proposed),manager:hrVisibleTabs('manager',proposed),
   hr:hrVisibleTabs('hr',proposed),superadmin:hrVisibleTabs('superadmin',proposed),
   managerFamilyDenied:true,managerPayslipsDenied:true,superadminRestrictedSelfWriteDenied:true,superadminStandardSelfServiceAllowed:true,
  }};
 })],
 'POST /api/org/hr/access-rules/save':[orgRoute('org.hr.access_rules.save','HRM.rules.manage',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'HRM.rules.manage'))
    throw new HttpError(403,'HR privacy rule administrator required.');
  const proposed=hrRules(ctx.body.rules);
  if(!proposed.selfTabs.includes('basic')||!proposed.managerTabs.includes('basic')||!proposed.hrTabs.includes('basic'))
    throw new HttpError(400,'Basic employee identity must remain visible to each authorized viewer.');
  const expected=createHash('sha256').update(JSON.stringify(proposed)).digest('hex');
  if(str(ctx.body.simulationDigest)!==expected)
    throw new HttpError(428,'Simulate these exact HR access rules before submitting for approval.');
  return withLock(ctx.orgId,'hr_access_rules_change',async()=>{
    const path=`organizations/${ctx.orgId}/hr_access_rules/pending`;
    const prior=await getDoc(path);
    if(prior?.data.status==='pending')
      throw new HttpError(409,'Privacy rules already have a pending independent approval.');
    await writeDoc(path,{rules:proposed,proposedBy:ctx.uid,proposedAt:nowIso(),
      status:'pending',simulationDigest:expected,reviewedBy:'',reviewedAt:'',reviewNote:''});
    return {ok:true,status:'pending',message:'Submitted for independent HR privacy approval.'};
  });
 })],
 'POST /api/org/hr/access-rules/review':[orgRoute('org.hr.access_rules.review','HRM.rules.approve',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'HRM.rules.approve'))
    throw new HttpError(403,'Independent HR privacy approver role required.');
  const decision=str(ctx.body.decision),note=str(ctx.body.note).trim().slice(0,400);
  if(!['approve','reject'].includes(decision))throw new HttpError(400,'Choose an approval decision.');
  if(decision==='reject'&&note.length<5)throw new HttpError(400,'Give a reason for rejection.');
  return withLock(ctx.orgId,'hr_access_rules_change',async()=>{
    const p=`organizations/${ctx.orgId}/hr_access_rules/pending`;
    const pending=await getDoc(p);
    if(!pending||pending.data.status!=='pending')throw new HttpError(409,'No pending rule change.');
    if(str(pending.data.proposedBy)===ctx.uid)throw new HttpError(403,'You cannot approve your own privacy rule changes.');
    if(decision==='approve'){
      const old=await getDoc(path(ctx.orgId)),validated=hrRules(pending.data.rules);
      await writeDoc(path(ctx.orgId),{...validated,version:Number(old?.data.version||0)+1,
        updatedAt:nowIso(),updatedBy:ctx.uid,previousVersion:old?.data.version||0,
        proposedBy:str(pending.data.proposedBy)});
    }
    await writeDoc(p,{...pending.data,status:decision==='approve'?'approved':'rejected',
      reviewedBy:ctx.uid,reviewedAt:nowIso(),reviewNote:note});
    return {ok:true,status:decision==='approve'?'approved':'rejected'};
  });
 })],
 'POST /api/org/hr/reportees':[orgRoute('org.hr.reportees','HRM.shell.view',async ctx=>{
  const [users,nodeDocs,positionDocs,skillDocs]=await Promise.all([
    runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)}),
    listDocs(`organizations/${ctx.orgId}/structure`),
    listDocs(`organizations/${ctx.orgId}/positions`),
    listDocs(`organizations/${ctx.orgId}/hr_skill_proposals`),
  ]);
  const nodes=new Map(nodeDocs.map(d=>[d.id,d.data]));
  const fit=buildFitIndex(users,positionDocs,skillDocs);
  const reports=[];
  for(const u of users){
    if(u.id===ctx.uid||str(u.data.status)==='disabled')continue;
    if(await managerFor(ctx,u.data,nodes,users)===ctx.uid)reports.push({...basic(u),skillFit:fit.get(u.id)});
  }
  return {employees:reports.sort((a,b)=>a.name.localeCompare(b.name)),scope:'direct'};
 })],
};
