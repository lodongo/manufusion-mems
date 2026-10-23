import { randomUUID } from 'node:crypto';
import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, runQuery, str, writeDoc } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { withLock } from './finCore';
import { hrSiteOf } from './hrHierarchy';
import { HR_SKILL_DEFAULTS } from './hrSkillsDefaults';
import { HR_SKILL_EXPANDED } from './hrSkillsExpanded';

const clean=(value:unknown,max=160)=>str(value).trim().slice(0,max);
const privatePath=(org:string,uid:string)=>`organizations/${org}/hr_private/${uid}`;
const proposalsPath=(org:string)=>`organizations/${org}/hr_skill_proposals`;
const catalogPath=(org:string)=>`organizations/${org}/hr_skill_catalog`;
const primary=(data:Record<string,unknown>)=>(Array.isArray(data.assignments)?data.assignments.filter(isObj):[]).filter(a=>str(a.type)==='primary' && !!str(a.nodeId));
const sameSite=(a:Record<string,unknown>,b:Record<string,unknown>,nodes:Map<string,Record<string,unknown>>)=>
  primary(a).some(x=>primary(b).some(y=>{const site=hrSiteOf(str(x.nodeId),nodes);return !!site && site===hrSiteOf(str(y.nodeId),nodes);}));
const nodeMap=async(org:string)=>new Map((await listDocs(`organizations/${org}/structure`)).map(d=>[d.id,d.data]));
const personnel=async(ctx:OrgContext,uid:string)=>{
  if(!/^[\w-]{1,128}$/.test(uid))throw new HttpError(400,'Select a valid employee.');
  const doc=uid===ctx.uid?ctx.me:await getDoc(`users/${uid}`);
  if(!doc||str(doc.data.orgId)!==ctx.orgId||str(doc.data.status)==='disabled')throw new HttpError(404,'Employee unavailable.');
  return doc;
};
function immediateManagerUid(data:Record<string,unknown>,nodes:Map<string,Record<string,unknown>>):string{
  // Closest configured reporting manager; no implicit seniority or arbitrary approver role.
  for(const assignment of primary(data)){
    const visited=new Set<string>();
    let id=str(assignment.nodeId);
    while(id&&!visited.has(id)){
      visited.add(id);
      const node=nodes.get(id);
      if(!node||str(node.status)==='inactive')break;
      const manager=str(node.managerUid);
      if(manager && manager!==str(data.uid))return manager;
      id=str(node.parentId);
    }
  }
  return '';
}
async function managerFor(ctx:OrgContext,employee:Record<string,unknown>,nodes:Map<string,Record<string,unknown>>){
  const uid=immediateManagerUid(employee,nodes);
  if(!uid)return '';
  const person=await getDoc(`users/${uid}`);
  if(!person||str(person.data.orgId)!==ctx.orgId||str(person.data.status)==='disabled')return '';
  // The configured manager must have a primary assignment at the responsible node.
  const responsible=new Set<string>();
  for(const assignment of primary(employee)){
    const seen=new Set<string>();let id=str(assignment.nodeId);
    while(id&&!seen.has(id)){
      seen.add(id);const node=nodes.get(id);if(!node||str(node.status)==='inactive')break;
      if(str(node.managerUid)===uid){responsible.add(id);break}
      id=str(node.parentId);
    }
  }
  return primary(person.data).some(a=>{
    const managerSite=hrSiteOf(str(a.nodeId),nodes);
    return responsible.has(str(a.nodeId)) || (!!managerSite && [...responsible].some(id=>hrSiteOf(id,nodes)===managerSite));
  })?uid:'';
}
const employeeSafe=(d:{id:string;data:Record<string,unknown>})=>({uid:d.id,name:[clean(d.data.firstName,50),clean(d.data.lastName,50)].filter(Boolean).join(' '),employeeNumber:clean(d.data.employeeNumber,40)});
function hrCanManage(ctx:OrgContext){return ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,'HRM.skills.manage')}
const skillOut=(id:string,d:Record<string,unknown>)=>({
  code:id,category:clean(d.category,100),subcategory:clean(d.subcategory,100),
  name:clean(d.name,160),description:clean(d.description,600),enabled:d.enabled!==false,
});
async function skillCatalog(ctx:OrgContext){
  const [base,metadata,local]=await Promise.all([
    listDocs('reference/skills_master/items'),getDoc('module_workspaces/HRM/metadata/skillsMaster'),
    listDocs(catalogPath(ctx.orgId)),
  ]);
  // Preserve existing standard and already-initialised MEMS skill masters.
  // Tenant HR edits live only in tenant overlays; no tenant can change the shared reference.
  const defaults=[...HR_SKILL_DEFAULTS,...HR_SKILL_EXPANDED];
  const skills=new Map(defaults.map(x=>[x.code,skillOut(x.code,{
    name:x.label,category:x.category,subcategory:x.subcategory,description:x.description,enabled:x.active,
  })]));
  const meta=Array.isArray(metadata?.data.items)?metadata.data.items.filter(isObj):[];
  for(const x of meta){const code=clean(x.code,65);if(code)skills.set(code,skillOut(code,{
    name:x.label,category:x.category,subcategory:x.subcategory,description:x.description,enabled:x.active!==false,
  }));}
  for(const d of base)skills.set(d.id,skillOut(d.id,d.data));
  for(const doc of local)skills.set(doc.id,skillOut(doc.id,{...skills.get(doc.id),...doc.data}));
  return [...skills.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function readPrivate(items:unknown,kind:'education'|'family'){
  if(!Array.isArray(items)||items.length>30)throw new HttpError(400,'Maximum 30 entries.');
  return items.map((item,i)=>{
    if(!isObj(item))throw new HttpError(400,`Entry ${i+1} is invalid.`);
    const x=kind==='education'?{
      id:clean(item.id,60)||randomUUID(),institution:clean(item.institution,160),
      qualification:clean(item.qualification,140),field:clean(item.field,140),completionYear:clean(item.completionYear,4),
    }:{
      id:clean(item.id,60)||randomUUID(),name:clean(item.name,140),
      relationship:clean(item.relationship,70),phone:clean(item.phone,32),
    };
    if(kind==='education' && (!('institution' in x)||!x.institution||!x.qualification||
       (x.completionYear&&!/^(19|20)\d{2}$/.test(x.completionYear))))
      throw new HttpError(400,'Enter an institution, qualification and valid year.');
    if(kind==='family' && (!('name' in x)||!x.name||!x.relationship))
      throw new HttpError(400,'Enter family member name and relationship.');
    return x;
  });
}
export const hrEmployeeRoutes={
  'POST /api/org/hr/private/get':[orgRoute('org.hr.private.get','HRM.shell.view',async ctx=>{
    // Only the owner can retrieve family/contact and educational self-records.
    const doc=await getDoc(privatePath(ctx.orgId,ctx.uid));
    return {education:Array.isArray(doc?.data.education)?doc.data.education:[],
      family:Array.isArray(doc?.data.family)?doc.data.family:[]};
  })],
  'POST /api/org/hr/private/save':[orgRoute('org.hr.private.save','HRM.shell.view',async ctx=>
    withLock(ctx.orgId,'hr_self_'+ctx.uid,async()=>{
      const kind=clean(ctx.body.kind,20);
      if(kind!=='education'&&kind!=='family')throw new HttpError(400,'Select education or family.');
      const values=readPrivate(ctx.body.items,kind);
      const path=privatePath(ctx.orgId,ctx.uid);
      const old=await getDoc(path);
      await writeDoc(path,{...old?.data,[kind]:values,updatedAt:nowIso(),updatedBy:ctx.uid});
      return {ok:true,items:values};
    })
  )],
  'POST /api/org/hr/skills/catalog':[orgRoute('org.hr.skills.catalog','HRM.shell.view',async ctx=>({
    skills:await skillCatalog(ctx),canManage:hrCanManage(ctx),
  }))],
  'POST /api/org/hr/skills/catalog/save':[orgRoute('org.hr.skills.catalog.save','HRM.skills.manage',async ctx=>{
    if(!hrCanManage(ctx))throw new HttpError(403,'Direct HR skills management permission required.');
    const code=clean(ctx.body.code,65),name=clean(ctx.body.name,160);
    const category=clean(ctx.body.category,100),subcategory=clean(ctx.body.subcategory,100);
    const description=clean(ctx.body.description,600),enabled=ctx.body.enabled!==false;
    if(!name||!category||!subcategory)throw new HttpError(400,'Name, category and subcategory are required.');
    const master=await getDoc(`reference/skills_master/items/${code}`);
    const old=code?await getDoc(`${catalogPath(ctx.orgId)}/${code}`):null;
    if(code && !/^(HR_SK_\d{3}_\d{3}|HR_SK_LOCAL_[A-Za-z0-9_-]{4,45})$/.test(code))
      throw new HttpError(400,'Invalid skill code.');
    if(code && !old&&!master&&!code.startsWith('HR_SK_LOCAL_'))throw new HttpError(400,'New skill code must be local.');
    const resolved=code||('HR_SK_LOCAL_'+randomUUID().replace(/-/g,'').slice(0,20));
    await writeDoc(`${catalogPath(ctx.orgId)}/${resolved}`,{
      code:resolved,name,category,subcategory,description,enabled,
      createdAt:old?.data.createdAt||nowIso(),updatedAt:nowIso(),updatedBy:ctx.uid,
    });
    return {ok:true,code:resolved};
  })],
  'POST /api/org/hr/skills/peers':[orgRoute('org.hr.skills.peers','HRM.shell.view',async ctx=>{
    const nodes=await nodeMap(ctx.orgId);
    const records=await runQuery({from:[{collectionId:'users'}],where:fieldEq('orgId',ctx.orgId)});
    const employees=records.filter(u=>u.id!==ctx.uid&&str(u.data.status)!=='disabled' &&
      (ctx.role==='org_super_admin'||sameSite(ctx.me.data,u.data,nodes))).map(employeeSafe);
    return {employees};
  })],
  'POST /api/org/hr/skills/proposals':[orgRoute('org.hr.skills.proposals','HRM.shell.view',async ctx=>{
    const target=clean(ctx.body.uid,128)||ctx.uid;
    const employee=await personnel(ctx,target);
    const nodes=await nodeMap(ctx.orgId);
    const manager=await managerFor(ctx,employee.data,nodes);
    const allowed=target===ctx.uid||ctx.role==='org_super_admin'||
      sameSite(ctx.me.data,employee.data,nodes)||
      (hasPerm(ctx.directPermissions,'HRM.manager.hierarchy.read')&&manager===ctx.uid);
    if(!allowed)throw new HttpError(403,'Skill record outside your access scope.');
    const proposals=(await listDocs(proposalsPath(ctx.orgId))).filter(d=>str(d.data.employeeUid)===target)
      .map(d=>({id:d.id,skillCode:clean(d.data.skillCode,65),skillName:clean(d.data.skillName,160),
        status:clean(d.data.status,32),proposedBy:clean(d.data.proposedBy,128),
        proposerName:clean(d.data.proposerName,140),managerUid:clean(d.data.managerUid,128),
        endorsements:Array.isArray(d.data.endorsements)?d.data.endorsements.filter(isObj).map(e=>({
          uid:clean(e.uid,128),name:clean(e.name,140)})):[],
        createdAt:clean(d.data.createdAt,40),reviewedAt:clean(d.data.reviewedAt,40),
      })).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return {proposals,canPropose:target===ctx.uid||ctx.role==='org_super_admin'||sameSite(ctx.me.data,employee.data,nodes),
      managerAssigned:!!manager};
  })],
  'POST /api/org/hr/skills/propose':[orgRoute('org.hr.skills.propose','HRM.shell.view',async ctx=>{
    const uid=clean(ctx.body.employeeUid,128)||ctx.uid;
    const employee=await personnel(ctx,uid),nodes=await nodeMap(ctx.orgId);
    if(uid!==ctx.uid&&ctx.role!=='org_super_admin'&&!sameSite(ctx.me.data,employee.data,nodes))
      throw new HttpError(403,'Only colleagues at the same site can propose another employee’s skills.');
    const code=clean(ctx.body.skillCode,65);
    const skill=(await skillCatalog(ctx)).find(x=>x.code===code&&x.enabled);
    if(!skill)throw new HttpError(400,'Choose an enabled skill in the HR catalogue.');
    const manager=await managerFor(ctx,employee.data,nodes);
    if(!manager)throw new HttpError(409,'The employee needs a verified immediate manager in Organization Structure before a skill can be proposed.');
    return withLock(ctx.orgId,'hr_skill_nomination_'+uid+'_'+code,async()=>{
      const existing=(await listDocs(proposalsPath(ctx.orgId))).some(d=>
        str(d.data.employeeUid)===uid&&str(d.data.skillCode)===code&&['pending','approved'].includes(str(d.data.status)));
      if(existing)throw new HttpError(409,'This employee already has a pending or confirmed nomination for the selected skill. Second the existing skill instead.');
      const path=`${proposalsPath(ctx.orgId)}/${randomUUID().replace(/-/g,'')}`;
      await writeDoc(path,{
        employeeUid:uid,skillCode:code,skillName:skill.name,
        status:'pending',managerUid:manager,proposedBy:ctx.uid,
        proposerName:[clean(ctx.me.data.firstName,50),clean(ctx.me.data.lastName,50)].join(' ').trim(),
        endorsements:[],createdAt:nowIso(),updatedAt:nowIso(),reviewedAt:'',reviewedBy:'',decisionNote:'',
      },{exists:false});
      return {ok:true};
    });
  })],
  'POST /api/org/hr/skills/endorse':[orgRoute('org.hr.skills.endorse','HRM.shell.view',async ctx=>{
    const id=clean(ctx.body.id,64);
    if(!/^[a-f0-9]{32}$/.test(id))throw new HttpError(400,'Invalid proposal.');
    return withLock(ctx.orgId,'hr_skill_'+id,async()=>{
      const path=`${proposalsPath(ctx.orgId)}/${id}`,doc=await getDoc(path);
      if(!doc)throw new HttpError(404,'Proposal not found.');
      if(ctx.uid===str(doc.data.employeeUid)||ctx.uid===str(doc.data.proposedBy))
        throw new HttpError(403,'You cannot second your own skill or proposal.');
      if(!['pending','approved'].includes(str(doc.data.status)))
        throw new HttpError(409,'This skill cannot be seconded in its current state.');
      const employee=await personnel(ctx,str(doc.data.employeeUid)),nodes=await nodeMap(ctx.orgId);
      if(ctx.role!=='org_super_admin'&&!sameSite(ctx.me.data,employee.data,nodes))
        throw new HttpError(403,'Skills may only be seconded by colleagues at the same site.');
      const endorsements=Array.isArray(doc.data.endorsements)?doc.data.endorsements.filter(isObj):[];
      if(endorsements.some(e=>str(e.uid)===ctx.uid))throw new HttpError(409,'You have already seconded this skill.');
      await writeDoc(path,{...doc.data,endorsements:[...endorsements,{
        uid:ctx.uid,name:[clean(ctx.me.data.firstName,50),clean(ctx.me.data.lastName,50)].join(' ').trim(),at:nowIso(),
      }],updatedAt:nowIso()});
      return {ok:true};
    });
  })],
  'POST /api/org/hr/skills/inbox':[orgRoute('org.hr.skills.inbox','HRM.shell.view',async ctx=>{
    const records=(await listDocs(proposalsPath(ctx.orgId))).filter(d=>str(d.data.status)==='pending' && str(d.data.managerUid)===ctx.uid);
    const results=[];
    const nodes=await nodeMap(ctx.orgId);
    for(const doc of records){
      const employee=await getDoc(`users/${str(doc.data.employeeUid)}`);
      if(!employee||str(employee.data.orgId)!==ctx.orgId||str(employee.data.status)==='disabled')continue;
      if(await managerFor(ctx,employee.data,nodes)!==ctx.uid)continue;
      results.push({id:doc.id,employeeUid:employee.id,employeeName:employeeSafe(employee).name,
        skillCode:clean(doc.data.skillCode,65),skillName:clean(doc.data.skillName,160),
        proposedBy:clean(doc.data.proposedBy,128),proposerName:clean(doc.data.proposerName,140),
        endorsements:Array.isArray(doc.data.endorsements)?doc.data.endorsements.length:0,
        createdAt:clean(doc.data.createdAt,40)});
    }
    return {items:results};
  })],
  'POST /api/org/hr/skills/decide':[orgRoute('org.hr.skills.decide','HRM.shell.view',async ctx=>{
    const id=clean(ctx.body.id,64),action=clean(ctx.body.action,20);
    if(!/^[a-f0-9]{32}$/.test(id)||!['approve','reject'].includes(action))throw new HttpError(400,'Invalid review action.');
    return withLock(ctx.orgId,'hr_skill_'+id,async()=>{
      const path=`${proposalsPath(ctx.orgId)}/${id}`,doc=await getDoc(path);
      if(!doc||str(doc.data.status)!=='pending')throw new HttpError(409,'The skill proposal is no longer pending.');
      if(ctx.uid===str(doc.data.employeeUid)||ctx.uid===str(doc.data.proposedBy))
        throw new HttpError(403,'A manager cannot approve their own skill or own nomination.');
      const employee=await personnel(ctx,str(doc.data.employeeUid));
      const manager=await managerFor(ctx,employee.data,await nodeMap(ctx.orgId));
      if(!manager||manager!==ctx.uid||str(doc.data.managerUid)!==ctx.uid)
        throw new HttpError(403,'Only the verified immediate manager may confirm this skill.');
      const note=clean(ctx.body.note,400);
      if(action==='reject'&&note.length<5)throw new HttpError(400,'State a reason for rejection.');
      await writeDoc(path,{...doc.data,status:action==='approve'?'approved':'rejected',decisionNote:note,
        reviewedAt:nowIso(),reviewedBy:ctx.uid,updatedAt:nowIso()});
      return {ok:true};
    });
  })],
};
