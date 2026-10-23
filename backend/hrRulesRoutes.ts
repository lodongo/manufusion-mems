import { HttpError, fieldEq, getDoc, listDocs, nowIso, runQuery, str, writeDoc } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { managerFor } from './hrEmployeeRoutes';
import { HR_RULE_DEFAULTS, hrRules, hrVisibleTabs, type HrRules } from './hrPrivacyRules';
import { hrSiteOf } from './hrHierarchy';

const path=(org:string)=>`organizations/${org}/hr_access_rules/default`;
export const currentHrRules=async(org:string):Promise<HrRules>=>hrRules((await getDoc(path(org)))?.data);
const assigned=(d:Record<string,unknown>):string[]=>Array.isArray(d.assignments)?d.assignments.filter((a):a is Record<string,unknown>=>!!a&&typeof a==='object'&&!Array.isArray(a)).filter(a=>str(a.type)==='primary').map(a=>str(a.nodeId)).filter(Boolean):[];
const basic=(d:{id:string;data:Record<string,unknown>})=>({uid:d.id,name:[str(d.data.firstName),str(d.data.lastName)].filter(Boolean).join(' '),employeeNumber:str(d.data.employeeNumber),jobRole:str((Array.isArray(d.data.assignments)?d.data.assignments:[]).find((a):a is Record<string,unknown>=>!!a&&typeof a==='object'&&!Array.isArray(a)&&a.type==='primary')?.positionCode)});
export const hrRulesRoutes={
 'POST /api/org/hr/access-rules/get':[orgRoute('org.hr.access_rules.get','HRM.shell.view',async ctx=>({
  rules:await currentHrRules(ctx.orgId),
  canConfigure:ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,'HRM.rules.manage'),
 }))],
 'POST /api/org/hr/access-rules/save':[orgRoute('org.hr.access_rules.save','HRM.rules.manage',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'HRM.rules.manage'))
   throw new HttpError(403,'HR privacy rule administrator required.');
  const proposed=hrRules(ctx.body.rules);
  if(!proposed.selfTabs.includes('basic')||!proposed.managerTabs.includes('basic')||!proposed.hrTabs.includes('basic'))
   throw new HttpError(400,'Basic employee identity must remain visible to each authorized viewer.');
  const old=await getDoc(path(ctx.orgId));
  // Server-owned protected defaults, no HR administrator can expand superadmin self-edit rights
  // or grant family/payslip data to a manager.
  await writeDoc(path(ctx.orgId),{...proposed,version:Number(old?.data.version||0)+1,
   updatedAt:nowIso(),updatedBy:ctx.uid,previousVersion:old?.data.version||0});
  return {ok:true,rules:proposed};
 })],
 'POST /api/org/hr/reportees':[orgRoute('org.hr.reportees','HRM.shell.view',async ctx=>{
  const users=await runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)});
  const nodes=new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map(d=>[d.id,d.data]));
  const reports=[];
  for(const u of users){
    if(u.id===ctx.uid||str(u.data.status)==='disabled')continue;
    if(await managerFor(ctx,u.data,nodes)===ctx.uid)reports.push(basic(u));
  }
  return {employees:reports.sort((a,b)=>a.name.localeCompare(b.name)),scope:'direct'};
 })],
};
