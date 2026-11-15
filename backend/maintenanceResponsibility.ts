/** Current responsibility is calculated from trusted workflow state and current HR assignments. */
import {getDoc,listDocs,isObj,str,nowIso,type Doc,type Obj} from './core';
import type {OrgContext} from './guards';
import {orgUsers} from './org';
import {WORK_GROUP_TITLES,groupAt,groupGateRole,workGroupPermission,workGroupGateAllowed,assignmentCovers,memberTitles,outsideExecutionAccess,ancestry,type WorkGroupPolicy,type ActiveGroup} from './maintenanceWorkGroupPolicy';
import {assessmentReviewCurrent,reviewAssessmentPrerequisites} from './maintenanceAssessmentReview';
import {mergedMasterTasks,memberMap,mapOfStrings} from './maintenanceWorkGroups';
const obj=(v:unknown):Obj=>isObj(v)?v:{};
const rows=(v:unknown):Obj[]=>Array.isArray(v)?v.filter(isObj):[];
const ids=(v:unknown):string[]=>Array.isArray(v)?v.map(str).filter(Boolean):[];
const fullName=(u:Doc)=>[str(u.data.firstName),str(u.data.lastName)].filter(Boolean).join(' ')||str(u.data.displayName)||str(u.data.email)||u.id;
type Responsible={uid:string;name:string;role:string;genericRole:string;positionCode:string};
type Stage={label:string;gate?:string;permission?:string;exclude?:string[];preferred?:string;allocated?:string[];external?:boolean;fixed?:string;fixedRole?:string;externalPosition?:string};
type Data={policy:WorkGroupPolicy|undefined;users:Map<string,Doc>;positions:Map<string,Doc>;drafts:Doc[];legacy:Obj;today:string;finance:Map<string,Doc>;orgId:string;savedPolicy?:WorkGroupPolicy;savedMasterVersion:number};
export async function responsibilityData(ctx:OrgContext,includeFinance=false):Promise<Data>{
 const root='organizations/'+ctx.orgId;
 const [users,positions,drafts,legacy,finance,master,nodes]=await Promise.all([orgUsers(ctx.orgId),listDocs(root+'/positions'),listDocs(root+'/maintenance_work_groups'),getDoc(root+'/maintenance_workflow_settings/default'),includeFinance?listDocs(root+'/fin_requests'):Promise.resolve([]),getDoc(root+'/maintenance_work_group_settings/default'),listDocs(root+'/structure')]);
 const today=nowIso().slice(0,10),activePositions=new Set(positions.filter(p=>p.data.status!=='inactive').map(p=>p.id)),byNode=new Map(nodes.map(n=>[n.id,n]));
 // These saved drafts are display-only: they must never be placed on OrgContext or used in authorization.
 const groups:ActiveGroup[]=drafts.filter(g=>g.data.status!=='inactive').map(g=>({id:g.id,code:str(g.data.code),name:str(g.data.name),siteId:str(g.data.siteId),version:Number(g.data.version)||0,costCenterIds:ids(g.data.costCenterIds),members:memberMap(g.data.members)}));
 const paths=new Map<string,string[]>();
 for(const g of groups)for(const cc of g.costCenterIds){const p=ancestry(byNode,cc);if(p.includes(g.siteId)&&str(byNode.get(cc)?.data.level)==='cost_center')paths.set(cc,p);}
 const savedMasterVersion=Number(master?.data.version)||0;
 const savedPolicy:WorkGroupPolicy|undefined=master?{config:{version:0,masterVersion:savedMasterVersion,roleAlignment:mapOfStrings(master.data.roleAlignment),tasks:mergedMasterTasks(master),groups},activePositions,paths,user:ctx.me,today}:undefined;
 return {policy:ctx.workGroupPolicy,users:new Map(users.filter(u=>!['disabled','inactive','suspended','deleted'].includes(str(u.data.status))).map(u=>[u.id,u])),positions:new Map(positions.filter(p=>p.data.status!=='inactive').map(p=>[p.id,p])),drafts,legacy:obj(legacy?.data.approverRoles),today,finance:new Map(finance.map(d=>[d.id,d])),orgId:ctx.orgId,savedPolicy,savedMasterVersion};
}
export function locationGroup(data:Data,path:string[]){
 const g=groupAt(data.policy,path),drafts=data.drafts.filter(x=>x.data.status!=='inactive'&&ids(x.data.costCenterIds).some(cc=>path.includes(cc)));
 const draft=!g&&drafts.length===1?drafts[0]:undefined;
 return {workGroupId:g?.id||draft?.id||'',workGroupCode:g?.code||str(draft?.data.code),workGroupName:g?.name||str(draft?.data.name),workGroupStatus:g?'active':draft?'draft':'unassigned',workGroupVersion:g?.version||Number(draft?.data.version)||0};
}
export function groupFields(policy:WorkGroupPolicy|undefined,path:string[]){
 const g=groupAt(policy,path);return {workGroupId:g?.id||'',workGroupCode:g?.code||'',workGroupName:g?.name||'',workGroupVersion:g?.version||0};
}
function positionLabel(data:Data,id:string){const p=data.positions.get(id);return str(p?.data.title)||str(p?.data.name)||id;}
function depth(data:Pick<Data,'positions'>,code:string){
 const seen=new Set<string>();let n=0;
 while(code&&!seen.has(code)&&n<50){seen.add(code);const p=data.positions.get(code);const parent=str(p?.data.parentCode)||str(p?.data.parentId)||str(p?.data.reportsToRoleCode);if(!parent||!data.positions.has(parent))break;n++;code=parent;}
 return n;
}
const rank:Record<string,number>={'Maintenance Lead':0,'Maintenance Planner':1,'Maintenance Specialist':2,'Maintenance Technician':3,'Maintenance Clerk':4,'Operator':5};
export function rankResponsible(data:Pick<Data,'positions'>,people:Responsible[]){
 return [...people].sort((a,b)=>depth(data,a.positionCode)-depth(data,b.positionCode)||(rank[a.genericRole]??99)-(rank[b.genericRole]??99)||a.name.localeCompare(b.name)||a.uid.localeCompare(b.uid));
}
function entry(data:Data,u:Doc,role:string,genericRole=''):Responsible{return {uid:u.id,name:fullName(u),role:positionLabel(data,role)||genericRole,genericRole,positionCode:role};}
function taskTitles(policy:WorkGroupPolicy,s:Stage){
 const gate=s.gate?policy.config.tasks[s.gate]||[]:undefined;
 const permission=s.permission&&s.permission!=='MNT.view'?policy.config.tasks[s.permission]||[]:undefined;
 return gate&&permission?gate.filter(t=>permission.includes(t)):gate||permission||[];
}
function actualRoles(data:Data,policy:WorkGroupPolicy,s:Stage){
 const mapped=taskTitles(policy,s),all=mapped.length?mapped:s.gate?policy.config.tasks[s.gate]||[]:policy.config.tasks[s.permission||'']||[];
 const roles=all.flatMap(t=>(policy.config.roleAlignment[t]||[]).filter(id=>data.positions.has(id)).map(id=>({uid:'',name:'',role:positionLabel(data,id),genericRole:t,positionCode:id})));
 return [...new Set(rankResponsible(data,roles).map(p=>p.role))];
}
function explain(data:Data,policy:WorkGroupPolicy,g:ActiveGroup,s:Stage,path:string[],people:Responsible[]){
 const titles=taskTitles(policy,s),roles=actualRoles(data,policy,s);
 if(!titles.length)return s.gate&&s.permission&&s.permission!=='MNT.view'&&(policy.config.tasks[s.gate]||[]).length&&(policy.config.tasks[s.permission]||[]).length?'Task and security activity allocations do not overlap. Review both in Master Setup.':'No role allocated to this action in Master Setup.';
 if(!roles.length)return 'No actual organizational job title aligned to the allocated generic role.';
 if(!g.costCenterIds.some(cc=>path.includes(cc)&&policy.paths.has(cc)))return 'Cost center is no longer valid within the Work Group site.';
 if(!titles.some(t=>(g.members[t]||[]).length))return 'No named employee assigned to the configured job title in this Work Group.';
 if(!people.length){const withoutIndependence=candidates({...data,policy},g,{...s,exclude:[]},path);if(withoutIndependence.length&&s.exclude?.length)return 'Configured employee cannot act on this record because of maker-checker independence.';return 'No named employee is currently eligible: check active job assignment, role alignment, group scope and task allocation.';}
 return '';
}
function candidates(data:Data,g:ActiveGroup,s:Stage,path:string[]){
 const policy=data.policy!,out:Responsible[]=[];
 for(const t of WORK_GROUP_TITLES){
  if(s.gate&&!(policy.config.tasks[s.gate]||[]).includes(t))continue;
  if(s.permission&&s.permission!=='MNT.view'&&!(policy.config.tasks[s.permission]||[]).includes(t))continue;
  for(const m of g.members[t]||[]){
   const u=data.users.get(m.uid);if(!u||str(u.data.orgId)!==data.orgId||s.exclude?.includes(u.id)||(s.allocated&&!s.allocated.includes(u.id)))continue;
   const p={...policy,user:u};
   if(!memberTitles(p,g).includes(t)||!policy.activePositions.has(m.positionCode)||!(policy.config.roleAlignment[t]||[]).includes(m.positionCode)||!g.costCenterIds.some(cc=>{const path=policy.paths.get(cc);return !!path&&assignmentCovers(u,m.positionCode,path,policy.today);}))continue;
   if(s.gate&&workGroupGateAllowed(p,s.gate,path)!==true)continue;
   if(s.permission&&workGroupPermission(p,s.permission,path)===false)continue;
   if(s.gate==='MNT.WR.ASSESS'&&workGroupGateAllowed(p,'MNT.ASSESS.REVIEW',path)===true)continue;
   out.push(entry(data,u,m.positionCode,t));
  }
 }
 return out;
}
function legacyPeople(data:Data,role:string,path:string[],exclude:string[]=[]){
 return role?[...data.users.values()].filter(u=>!exclude.includes(u.id)&&assignmentCovers(u,role,path,data.today)).map(u=>entry(data,u,role)):[];
}
/** The employee credited with completing a request must hold actual execution authority.
 * No test-mode or wildcard-admin bypass applies to attribution, and draft membership never grants rights. */
export function closureExecutionPeople(data:Data,path:string[]){
 const group=groupAt(data.policy,path);
 const stage:Stage={label:'Complete work',gate:'MNT.TASK.FEEDBACK',permission:'MNT.WO.execute'};
 let people:Responsible[]=[],diagnostic='';
 if(group&&data.policy){
  people=candidates(data,group,stage,path);
  if(!people.length)diagnostic=explain(data,data.policy,group,stage,path,people);
 }else if(data.policy||data.savedMasterVersion){
  diagnostic='Activate the Work Group for this cost center with named employees allocated to MNT.WO.execute.';
 }else{
  // Existing installations with no Work Groups master retain the configured legacy executor role.
  const role=str(data.legacy['MNT.TASK.FEEDBACK']);
  people=legacyPeople(data,role,path);
  if(!people.length)diagnostic='No eligible employee holds the configured legacy maintenance execution role at this location.';
 }
 const seen=new Set<string>();
 const eligible=rankResponsible(data,people).filter(p=>{if(seen.has(p.uid))return false;seen.add(p.uid);return true;});
 return {people:eligible.sort((a,b)=>a.name.localeCompare(b.name)||a.uid.localeCompare(b.uid)),diagnostic};
}
function currentAssessment(data:Data,d:Obj,path:string[]){
 const token=groupGateRole(data.policy,'MNT.ASSESS.REVIEW',path);
 const role=token===null?str(data.legacy['MNT.ASSESS.REVIEW']):token;
 return !!role&&assessmentReviewCurrent(d,role);
}
const assess=():Stage=>({label:'Technical work assessment',gate:'MNT.WR.ASSESS',permission:'MNT.assessment.edit'});
const approval=(d:Obj):Stage=>({label:'Assessment approval',gate:'MNT.ASSESS.REVIEW',permission:'MNT.assessment.review',exclude:[str(d.requestedBy),d.executionMode==='confirmed_request'?'':str(d.createdBy),str(d.assessedBy),str(d.assessmentTasksBy)].filter(Boolean)});
function assessmentStage(data:Data,d:Obj,path:string[]):Stage{
 if(obj(d.assessmentReview).status==='changes_requested'||reviewAssessmentPrerequisites(d,'__routing__')||(/^WR\d/.test(str(d.code))&&(!str(d.title)||str(d.description).length<10||!str(d.sourceCode)||!rows(d.impacts).length)))return assess();
 return approval(d);
}
function wrStage(data:Data,d:Obj,path:string[]):Stage{
 const s=str(d.status);
 if(str(d.woCode)||['closed','cancelled','declined','converted','confirmed'].includes(s))return {label:str(d.woCode)?(s==='closed'?'Closed · linked work order':s==='confirmed'?'Confirmed · Work Order created':'Converted to work order'):'Completed'};
 if(s==='returned')return {label:'Requester correction',fixed:str(d.requestedBy),fixedRole:'Requester'};
 if(s==='closure_pending')return {label:'Closure confirmation',permission:'MNT.WR.closeConfirm',exclude:[str(obj(d.closure).by)]};
 if(['created','submitted','under_review'].includes(s)&&!(s==='under_review'&&Number(d.reviewProcessVersion)<2))return {label:'Work request review',gate:'MNT.WR.REVIEW',permission:'MNT.WR.review',exclude:[str(d.requestedBy)],preferred:str(d.reviewerUid)};
 if(s==='to_be_assessed'||s==='under_review')return currentAssessment(data,d,path)?{label:'Convert to work order',gate:'MNT.WR.CONVERT',permission:'MNT.WR.convert',exclude:[str(d.requestedBy)]}:assessmentStage(data,d,path);
 return {label:'Awaiting workflow stage'};
}
function woStage(data:Data,d:Obj,path:string[]):Stage{
 const s=str(d.status);
 if(['closed','cancelled'].includes(s))return {label:'Completed'};
 if(['planning','plan_ready'].includes(s)){
  if(!currentAssessment(data,d,path))return assessmentStage(data,d,path);
  if(obj(d.costApproval).status==='pending'){
   const req=data.finance.get(str(obj(d.costApproval).requestId)),step=rows(req?.data.steps).find(x=>x.status==='pending');
   return {label:'Cost approval'+(step?' · '+str(step.level):''),external:true,gate:'MNT.WO.COST',fixedRole:str(step?.positionTitle)||'Finance · Chart of Authority',externalPosition:str(step?.positionCode),exclude:[str(req?.data.makerUid),...rows(req?.data.steps).map(x=>str(x.by))]};
  }
  return {label:s==='plan_ready'?'Confirm readiness':'Resource planning & readiness',gate:s==='plan_ready'?'MNT.WO.RELEASE':'MNT.WO.PLAN',permission:'MNT.WO.plan'};
 }
 if(s==='released')return {label:'Schedule maintenance window',gate:'MNT.WINDOW.LOCK',permission:'MNT.WO.schedule'};
 const tasks=rows(d.assessmentTasks),execution=obj(d.taskExecution),planning=obj(d.taskPlanning);
 const pending=tasks.filter(t=>obj(execution[str(t.id)]).status!=='completed');
 if(['scheduled','in_progress'].includes(s)||s==='completed'&&pending.length){
  const allocated=[...new Set(pending.flatMap(t=>{const e=obj(execution[str(t.id)]);return ids(e.performers).length?ids(e.performers):ids(obj(obj(planning[str(t.id)]).allocation).personnel);} ))];
  return {label:d.executionMode==='request_closure'?'Confirm completed work feedback':s==='scheduled'?'Execute scheduled tasks':'Task execution & feedback',gate:'MNT.TASK.FEEDBACK',permission:'MNT.WO.execute',allocated};
 }
 if(tasks.some(t=>obj(execution[str(t.id)]).reconciled!==true)&&!obj(d.safetySignoff).at)return {label:'Spare parts reconciliation',gate:'MNT.SPARES.RECONCILE',permission:'MNT.view'};
 if(!obj(d.safetySignoff).at)return {label:'Safety sign-off',gate:'MNT.SAFETY.SIGNOFF',external:true,fixedRole:'Safety signatory'};
 if(!obj(d.handover).at)return {label:'Operations handover',gate:'MNT.HANDOVER',external:true,fixedRole:'Operations receiving role'};
 return {label:'Technical closure',gate:'MNT.WO.TECHNICAL_CLOSE',permission:'MNT.WO.close',...(d.executionMode==='request_closure'?{exclude:[str(obj(obj(d.directCompletion).executor).uid),str(obj(d.directCompletion).recordedBy)]}:{})};
}
function windowStage(d:Obj):Stage{
 if(['completed','closed','cancelled'].includes(str(d.status)))return {label:'Completed'};
 if(['scheduled','in_progress','authorized'].includes(str(d.status))){
  const allocated=[...new Set(rows(d.tasks).flatMap(t=>ids(t.people||t.personnel)))];
  return {label:'Window execution',gate:'MNT.TASK.FEEDBACK',permission:'MNT.WO.execute',...(allocated.length?{allocated}:{})};
 }
 return {label:'Schedule maintenance window',gate:'MNT.WINDOW.LOCK',permission:'MNT.WO.schedule'};
}
export function responsibilityFor(data:Data,d:Obj,kind:'wr'|'wo'|'window'|'validation',overridePath?:string[]){
 const path=overridePath||[...new Set([...ids(d.path),str(d.costCenterId)].filter(Boolean))],g=groupAt(data.policy,path);
 const location=locationGroup(data,path);
 const s=kind==='wr'?wrStage(data,d,path):kind==='wo'?woStage(data,d,path):kind==='window'?windowStage(d):{label:'Asset task validation',gate:'MNT.TASK.VALIDATE',permission:'MNT.activities.edit',exclude:[str(d.createdBy)]};
 let people:Responsible[]=[],source='unassigned',fallback=s.fixedRole||'',diagnostic='',configuredRoles:string[]=[];
 if(s.fixed){const u=data.users.get(s.fixed);if(u)people=[entry(data,u,'',s.fixedRole)];source='record';}
 else if(s.external){const role=s.gate==='MNT.WO.COST'?s.externalPosition||'':str(data.legacy[s.gate||'']);people=legacyPeople(data,role,path,s.exclude);fallback=positionLabel(data,role)||fallback;source='independent_authority';}
 else if(s.gate||s.permission){
  if(g&&data.policy){
   people=candidates(data,g,s,path);source='work_group';
   configuredRoles=actualRoles(data,data.policy,s);
   fallback=configuredRoles[0]||'';
   diagnostic=explain(data,data.policy,g,s,path,people);
   if(s.allocated?.length&&s.gate==='MNT.TASK.FEEDBACK'&&kind==='wo'){
    for(const uid of s.allocated){const u=data.users.get(uid);if(!u||people.some(x=>x.uid===uid)||!outsideExecutionAccess({...data.policy,user:u},{id:str(d.code),data:d,updateTime:''} as Doc))continue;
     const roles=(data.policy.config.tasks['MNT.TASK.FEEDBACK']||[]).filter(t=>(data.policy!.config.tasks['MNT.WO.execute']||[]).includes(t));
     for(const t of roles)for(const p of data.policy.config.roleAlignment[t]||[])if(data.positions.has(p)&&rows(u.data.assignments).some(a=>str(a.positionCode)===p&&assignmentCovers(u,p,[str(a.nodeId)],data.today)))people.push(entry(data,u,p,t));
    }
   }
  }else{const role=str(data.legacy[s.gate||'']);people=legacyPeople(data,role,path,s.exclude);fallback=positionLabel(data,role);source=location.workGroupStatus==='draft'?'draft_group':'legacy';diagnostic=location.workGroupStatus==='draft'?'Work Group is saved but not activated.':'No active Work Group for this cost center.';}
 }
 const ranked=rankResponsible(data,people),seen=new Set<string>();
 const distinct=ranked.filter(p=>{if(seen.has(p.uid))return false;seen.add(p.uid);return true;});
 const principal=(s.preferred&&distinct.find(p=>p.uid===s.preferred))||distinct[0];
 const ordered=principal?[principal,...distinct.filter(p=>p.uid!==principal.uid)]:[];
 const saved=data.savedPolicy,savedGroup=groupAt(saved,path);
 const revisionPending=!!saved&&!!savedGroup&&(!g||g.id!==savedGroup.id||g.version!==savedGroup.version||data.policy?.config.masterVersion!==saved.config.masterVersion);
 let pending:{role:string;name:string;additional:number;diagnostic:string;masterVersion:number;groupVersion:number}|undefined;
 if(revisionPending&&saved&&savedGroup&&!s.external&&!s.fixed&&(s.gate||s.permission)){
  const preview=rankResponsible(data,candidates({...data,policy:saved},savedGroup,s,path)),distinctPreview=[...new Map(preview.map(p=>[p.uid,p])).values()],roles=actualRoles(data,saved,s);
  pending={role:preview[0]?.role||roles[0]||'',name:preview[0]?.name||'',additional:Math.max(0,distinctPreview.length-1),diagnostic:explain(data,saved,savedGroup,s,path,preview),masterVersion:saved.config.masterVersion,groupVersion:savedGroup.version};
 }
 return {...location,responsibility:{stage:s.label,role:principal?.role||fallback,name:principal?.name||'',uid:principal?.uid||'',additional:Math.max(0,ordered.length-1),people:ordered,source,configuredRoles,diagnostic:principal?'':diagnostic,pending,activeMasterVersion:data.policy?.config.masterVersion||0,savedMasterVersion:data.savedMasterVersion,activeGroupVersion:g?.version||0,savedGroupVersion:savedGroup?.version||0}};
}

/** Use current eligible reviewer on refresh; never silently retain a revoked or out-of-group UID. */
export function resolvedReviewDoc(data:Data,doc:Doc):Doc{
 const d=doc.data,path=ids(d.path);
 if(!groupAt(data.policy,path)||!['created','submitted','under_review'].includes(str(d.status))||str(d.status)==='under_review'&&Number(d.reviewProcessVersion)<2)return doc;
 const route=responsibilityFor(data,d,'wr'),a=route.responsibility,role=groupGateRole(data.policy,'MNT.WR.REVIEW',path)||'';
 if(a.stage!=='Work request review')return doc;
 if(str(d.reviewerUid)===a.uid&&str(d.reviewRoleCode)===role)return doc;
 return {...doc,data:{...d,reviewRoutingPreviousUid:str(d.reviewerUid),reviewRoutingChanged:true,reviewerUid:a.uid,reviewAssignedName:a.name,reviewRoleCode:role,reviewAssignmentSource:'workflow'}};
}
