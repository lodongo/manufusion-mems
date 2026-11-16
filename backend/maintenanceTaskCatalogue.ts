import type {CatalogueReference} from './maintenanceTaskAssessment';
import {randomUUID,createHash} from 'node:crypto';
import {getDoc,listDocs,writeDoc,commitChecked,HttpError,nowIso,str,isObj,type Obj} from './core';
import {staff,orgRoute,type OrgContext} from './guards';
import {canAnywhere,canAt,nodePath,scopeOf} from './access';
import {audit} from './audit';
import {taskDecisionPath,TASK_ADDITIONAL_CLASSES,EXECUTOR_TYPES} from './safTaskDecision';
import {ACTIVITY_CLASSES,meetsClassPermitMinimum} from './safActivityClasses';
import {DEFAULT_MODULE_METADATA} from './moduleDefaults';
import {HR_SKILL_DEFAULTS} from './hrSkillsDefaults';
import {HR_SKILL_EXPANDED} from './hrSkillsExpanded';
const root='module_workspaces/MNT/task_catalogue',activePath=root+'/active';
const revision=(id:string)=>root+'/'+id;
const arr=(x:unknown):Obj[]=>Array.isArray(x)&&x.every(isObj)?x as Obj[]:[];
const codes=(x:unknown):string[]=>Array.isArray(x)&&x.every(v=>typeof v==='string')?[...new Set(x as string[])]:[];
const idOk=(x:string)=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(x);
const fail=(s:string):never=>{throw new HttpError(400,s)};
const safeId=(v:unknown)=>{const id=str(v);if(!idOk(id))fail('Invalid catalogue identifier.');return id;};
const skillSet=new Set([...HR_SKILL_DEFAULTS,...HR_SKILL_EXPANDED].filter(x=>x.active!==false).map(x=>x.code));
const permitSet=new Set((DEFAULT_MODULE_METADATA.SAF.find(x=>x.key==='permitTypes')?.items||[]).map(x=>x.code));
const typeSet=new Set((DEFAULT_MODULE_METADATA.MNT.find(x=>x.key==='maintenanceTypes')?.items||[]).map(x=>x.code));
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function validateTaskCatalogueHeader(raw:Record<string,unknown>){
 if(raw.catalogueCode!=='MEMS-GLOBAL-TASK-CATALOGUE'||!/^1\./.test(str(raw.schemaVersion)))fail('Choose the MEMS global task catalogue JSON schema v1.');
 const catalogueVersion=str(raw.catalogueVersion).trim();if(!idOk(catalogueVersion))fail('Enter a valid catalogue version.');
 const categories=arr(raw.categories),subcategories=arr(raw.subcategories),families=arr(raw.families);
 const valid=(items:Obj[],max:number)=>items.length>0&&items.length<=max&&new Set(items.map(x=>x.code)).size===items.length&&items.every(x=>idOk(str(x.code))&&str(x.name).trim().length>0&&str(x.name).length<=250);
 if(!valid(categories,100)||!valid(subcategories,1000)||!valid(families,3000))fail('Invalid or duplicate categories, subcategories or task families.');
 const cats=new Set(categories.map(x=>x.code)),subs=new Map(subcategories.map(x=>[x.code,x.categoryCode]));
 if(subcategories.some(x=>!cats.has(x.categoryCode))||families.some(x=>!subs.has(x.subcategoryCode)||subs.get(x.subcategoryCode)!==x.categoryCode))fail('Invalid hierarchy references.');
 const expectedCount=Number(raw.expectedCount);if(!Number.isInteger(expectedCount)||expectedCount<1||expectedCount>20000)fail('Invalid task count (1–20,000).');
 const header={catalogueCode:str(raw.catalogueCode),schemaVersion:str(raw.schemaVersion),catalogueVersion,title:str(raw.title).slice(0,250),categories,subcategories,families,expectedCount,sourceReferences:isObj(raw.sourceReferences)?raw.sourceReferences:{},classificationPolicy:isObj(raw.classificationPolicy)?raw.classificationPolicy:{},adoptionPolicy:isObj(raw.adoptionPolicy)?raw.adoptionPolicy:{},checkpointPolicy:isObj(raw.checkpointPolicy)?raw.checkpointPolicy:{},autonomousMaintenanceLevels:arr(raw.autonomousMaintenanceLevels),maintenanceTypes:arr(raw.maintenanceTypes),permitTypes:arr(raw.permitTypes),decisionTreeQuestionKeys:codes(raw.decisionTreeQuestionKeys),activityClassCodes:codes(raw.activityClassCodes)};
 if(Buffer.byteLength(JSON.stringify(header))>400000)fail('Catalogue hierarchy exceeds the import limit; split the release.');
 return header;
}
export function validateCatalogueTask(t:Obj,families:Obj[]):Obj{
 const code=safeId(t.code),name=str(t.name).trim(),family=families.find(f=>f.code===t.familyCode);
 const bad=(s:string):never=>fail(code+': '+s);
 if(!family||family.categoryCode!==t.categoryCode||family.subcategoryCode!==t.subcategoryCode||name.length<3||name.length>250||!Number.isInteger(t.version)||Number(t.version)<1)bad('Invalid task hierarchy, name or version.');
 const mt=codes(t.applicableMaintenanceTypeCodes),primary=str(t.primaryMaintenanceTypeCode);
 if(!mt.includes(primary)||mt.some(x=>!typeSet.has(x)))bad('Unknown maintenance type.');
 if(t.domain==='Operations'){if(!Number.isInteger(t.autonomousMaintenanceLevel)||Number(t.autonomousMaintenanceLevel)<1||Number(t.autonomousMaintenanceLevel)>5||primary!=='MAI-005')bad('Operations tasks must be autonomous maintenance levels 1–5.');}else if(t.domain!=='Maintenance'||t.autonomousMaintenanceLevel!==null)bad('Invalid domain or autonomous level.');
 if(!EXECUTOR_TYPES.includes(str(t.executor)))bad('Invalid task executor.');
 const skills=codes(t.skillCodes),refs=arr(t.requiredHRSkills);
 if(!skills.length||skills.some(x=>!skillSet.has(x))||refs.length!==skills.length||refs.some(x=>!skills.includes(str(x.skillCode)))||new Set(refs.map(x=>x.skillCode)).size!==skills.length)bad('Missing or unknown HR skill references.');
 const subtasks=arr(t.subtasks);
 if(!subtasks.length||subtasks.length>100||new Set(subtasks.map(x=>x.subtaskId)).size!==subtasks.length||subtasks.some((x,i)=>x.sequence!==i+1||!idOk(str(x.subtaskId))||str(x.name).trim().length<3||str(x.name).length>1500||!Number.isInteger(x.estimatedMinutes)||Number(x.estimatedMinutes)<1||typeof x.mandatoryWhenApplicable!=='boolean'))bad('Invalid chronological subtasks.');
 if(subtasks.reduce((n,x)=>n+Number(x.estimatedMinutes),0)!==t.durationMinutes)bad('Duration must equal the subtask total.');
 const screening=taskDecisionPath(isObj(t.answers)?t.answers as Record<string,string>:{}),tc=isObj(t.taskClassification)?t.taskClassification:{},extra=codes(t.additionalClasses),classes=codes(t.classCodes),permits=codes(t.permitCodes);
 const expected=[screening.decision.code,...extra];
 if(!screening.decision.code||screening.decision.exception||tc.recommendedPrimaryClassCode!==screening.decision.code||extra.some(c=>!TASK_ADDITIONAL_CLASSES.includes(c))||classes.length!==expected.length||expected.some(c=>!classes.includes(c))||classes.some(c=>!ACTIVITY_CLASSES.some(x=>x.code===c))||[...permits,...codes(tc.conditionalPermitCodes)].some(p=>!permitSet.has(p))||classes.some(c=>!meetsClassPermitMinimum(c,permits)))bad('Decision tree or permit references are invalid, or an exception was preauthorized.');
 if(screening.decision.code==='AC01'&&(extra.length||permits.length))bad('No Risk cannot include permits or additional classes.');
 if(t.releaseState!=='not_authorized_for_execution'||t.siteRiskReviewRequired!==true||tc.authorizationGranted!==false||t.noAdditionalRisks!==false||!Array.isArray(t.rows)||t.rows.length||!Array.isArray(t.energyPlan)||t.energyPlan.length)bad('Global tasks must remain generic; site risks, mitigations, and authorization cannot be preapproved.');
 if(Buffer.byteLength(JSON.stringify(t))>40000)bad('Task document too large.');
 return {...t,status:'draft_review',releaseState:'not_authorized_for_execution',executionAuthorized:false,siteRiskReviewRequired:true};
}
const summary=(t:Obj)=>({code:str(t.code),name:str(t.name),categoryCode:str(t.categoryCode),subcategoryCode:str(t.subcategoryCode),familyCode:str(t.familyCode),domain:str(t.domain),autonomousMaintenanceLevel:t.autonomousMaintenanceLevel??null,durationMinutes:Number(t.durationMinutes),primaryMaintenanceTypeCode:str(t.primaryMaintenanceTypeCode),version:Number(t.version),classCodes:codes(t.classCodes),...(t.organizationVariant===true?{organizationVariant:true,baseTaskCode:str(t.baseTaskCode)}:{})});
async function readRevision(id:string){const d=await getDoc(revision(safeId(id)));if(!d)throw new HttpError(404,'Catalogue release not found.');return d;}
async function published(id?:string){const a=await getDoc(activePath),target=id||str(a?.data.releaseId);if(!target)return null;const d=await readRevision(target);if(d.data.state!=='published')throw new HttpError(409,'Catalogue release is not published.');return d;}
async function index(id:string){const batches=await listDocs(revision(id)+'/batches');return batches.flatMap(b=>arr(b.data.index));}
function publicHeader(d:Awaited<ReturnType<typeof readRevision>>){return {releaseId:d.id,catalogueVersion:d.data.catalogueVersion,title:d.data.title,categories:arr(d.data.categories),subcategories:arr(d.data.subcategories),families:arr(d.data.families),count:Number(d.data.expectedCount),state:d.data.state};}
const orgRoot=(ctx:OrgContext)=>'organizations/'+ctx.orgId;
const localTasks=(ctx:OrgContext)=>orgRoot(ctx)+'/task_catalogue_variants';
const adoptionPath=(ctx:OrgContext,siteId='')=>orgRoot(ctx)+'/task_catalogue_adoption/'+(siteId||'organization');
function enabled(ctx:OrgContext){if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Maintenance Management is not enabled.');}
async function authorizeAdoption(ctx:OrgContext,siteId:string){enabled(ctx);if(!siteId){if(ctx.role!=='org_super_admin'&&(!canAnywhere(ctx,'MNT.admin')||await scopeOf(ctx)!=='all'))throw new HttpError(403,'Organization-wide maintenance administration required.');return;}safeId(siteId);const site=await getDoc(orgRoot(ctx)+'/structure/'+siteId);if(!site||site.data.level!=='site'||site.data.status==='inactive')throw new HttpError(400,'Choose an active site.');if(!canAt(ctx,'MNT.admin',await nodePath(ctx.orgId,siteId),await scopeOf(ctx)))throw new HttpError(403,'Site maintenance administration required.');}
export const adoptFilter=(items:Obj[],a:Obj|undefined)=>{if(!a||a.inherit===true)return items;const families=new Set(codes(a.familyCodes)),tasks=new Set(codes(a.taskCodes));return a.all===true?items:items.filter(t=>families.has(str(t.familyCode))||tasks.has(str(t.code)));};
function search(items:Obj[],body:Record<string,unknown>){const q=str(body.q).trim().toLowerCase().slice(0,150),family=str(body.familyCode),category=str(body.categoryCode),sub=str(body.subcategoryCode),offset=Math.max(0,Math.floor(Number(body.offset)||0));const filtered=items.filter(t=>(!family||family===t.familyCode)&&(!category||category===t.categoryCode)&&(!sub||sub===t.subcategoryCode)&&(!q||[t.name,t.code,t.domain].join(' ').toLowerCase().includes(q))).sort((a,b)=>str(a.name).localeCompare(str(b.name)));return {items:filtered.slice(offset,offset+50),total:filtered.length,offset};}
export const taskCatalogueRoutes={
 'POST /api/admin/mnt/task-catalogue/status':[staff('admin.mnt.task_catalogue.status','read',async()=>{const a=await published();const releases=(await listDocs(root)).filter(d=>d.id!=='active').map(d=>({releaseId:d.id,catalogueVersion:d.data.catalogueVersion,state:d.data.state,count:d.data.expectedCount,receivedCount:d.data.receivedCount,receivedBatches:d.data.receivedBatches,createdAt:d.data.createdAt}));return {active:a?publicHeader(a):null,releases};})],
 'POST /api/admin/mnt/task-catalogue/begin':[staff('admin.mnt.task_catalogue.begin','write',async ctx=>{const h=validateTaskCatalogueHeader(ctx.body),id='release-'+randomUUID();if(!await writeDoc(revision(id),{...h,state:'staging',receivedCount:0,receivedBatches:0,createdBy:ctx.uid,createdAt:nowIso()},{exists:false}))throw new HttpError(409,'Could not allocate staging release. Retry.');return {releaseId:id};})],
 'POST /api/admin/mnt/task-catalogue/batch':[staff('admin.mnt.task_catalogue.batch','write',async ctx=>{const d=await readRevision(str(ctx.body.releaseId));if(d.data.state!=='staging')throw new HttpError(409,'Release is not staging.');const number=Number(ctx.body.batchNumber),raw=arr(ctx.body.tasks);if(!Number.isInteger(number)||number<0||number>=Math.ceil(Number(d.data.expectedCount)/30)||raw.length!==Math.min(30,Number(d.data.expectedCount)-number*30))fail('Invalid task batch.');const verified=raw.map(t=>validateCatalogueTask(t,arr(d.data.families)));const fp=hash(raw),batchPath=revision(d.id)+'/batches/'+String(number).padStart(5,'0'),old=await getDoc(batchPath);if(old){if(old.data.hash!==fp)throw new HttpError(409,'Batch already exists with different contents.');return {receivedCount:d.data.receivedCount};}const next=Number(d.data.receivedCount)+verified.length;if(number!==Number(d.data.receivedBatches)||next>Number(d.data.expectedCount)||new Set(verified.map(x=>x.code)).size!==verified.length)fail('Duplicate, missing or out-of-order batch.');const committed=await commitChecked([...verified.map(t=>({path:revision(d.id)+'/tasks/'+str(t.code),data:t,precondition:{exists:false}})),{path:batchPath,data:{hash:fp,index:verified.map(summary),count:verified.length},precondition:{exists:false}},{path:revision(d.id),data:{...d.data,receivedCount:next,receivedBatches:number+1},precondition:{updateTime:d.updateTime}}]);if(!committed)throw new HttpError(409,'Duplicate task code or concurrent upload. Refresh and resume.');return {receivedCount:next};})],
 'POST /api/admin/mnt/task-catalogue/publish':[staff('admin.mnt.task_catalogue.publish','write',async ctx=>{const d=await readRevision(str(ctx.body.releaseId));if(d.data.state!=='staging'||Number(d.data.receivedCount)!==Number(d.data.expectedCount)||Number(d.data.receivedBatches)!==Math.ceil(Number(d.data.expectedCount)/30))throw new HttpError(409,'Complete every task batch before publication.');if(ctx.body.confirm!=='PUBLISH REFERENCE')fail('Confirm reference-only publication.');const items=await index(d.id);if(items.length!==Number(d.data.expectedCount)||new Set(items.map(t=>t.code)).size!==items.length)throw new HttpError(409,'Catalogue index incomplete or duplicated.');const a=await getDoc(activePath);if(str(ctx.body.expectedActiveReleaseId)!==str(a?.data.releaseId))throw new HttpError(409,'Active catalogue changed. Reload before publishing.');const now=nowIso();if(!await commitChecked([{path:revision(d.id),data:{...d.data,state:'published',publishedAt:now,publishedBy:ctx.uid,executionAuthorized:false},precondition:{updateTime:d.updateTime}},{path:activePath,data:{releaseId:d.id,catalogueVersion:d.data.catalogueVersion,updatedAt:now},precondition:a?{updateTime:a.updateTime}:{exists:false}}]))throw new HttpError(409,'Concurrent publication. Reload.');await audit([{category:'maintenance',action:'task_catalogue.publish',actor:ctx.actor,meta:ctx.meta,target:{label:d.id},details:String(items.length)+' generic reference tasks; not authorized for execution'}]);return {ok:true,count:items.length};})],
 'POST /api/admin/mnt/task-catalogue/search':[staff('admin.mnt.task_catalogue.search','read',async ctx=>{const d=await published();return d?{...publicHeader(d),...search(await index(d.id),ctx.body)}:{items:[],total:0};})],
 'POST /api/admin/mnt/task-catalogue/detail':[staff('admin.mnt.task_catalogue.detail','read',async ctx=>{const d=await published();if(!d)throw new HttpError(404,'No published catalogue.');const t=await getDoc(revision(d.id)+'/tasks/'+safeId(ctx.body.code));if(!t)throw new HttpError(404,'Task not found.');return t.data;})],
 'POST /api/org/mnt/task-catalogue/organization-library':[orgRoute('org.mnt.task_catalogue.organization_library','MNT.admin',async ctx=>{
  await authorizeAdoption(ctx,'');return ctx.body.taskCode?genericTaskForSite(ctx,'',str(ctx.body.releaseId),str(ctx.body.taskCode)):resolveGenericTaskScope(ctx,'');
 })],
 'POST /api/org/mnt/task-catalogue/save-variant':[orgRoute('org.mnt.task_catalogue.save_variant','MNT.admin',async ctx=>{
  await authorizeAdoption(ctx,'');const releaseId=safeId(ctx.body.releaseId),source=safeId(ctx.body.sourceTaskCode),base=await genericTaskForSite(ctx,'',releaseId,source),editing=base.organizationVariant===true&&ctx.body.editExisting===true;
  const code=editing?source:'ORG-TASK-'+randomUUID(),old=editing?await getDoc(localTasks(ctx)+'/'+source):null;
  if(editing&&(!old||Number(ctx.body.expectedVersion)!==Number(old.data.version)))throw new HttpError(409,'Organization variant changed. Reload.');
  const title=str(ctx.body.name).trim(),scope=arr(ctx.body.subtasks),original=arr(base.subtasks),byId=new Map(original.map(x=>[str(x.subtaskId),x]));
  if(title.length<3||title.length>250||!scope.length||scope.length>100)fail('Enter a task name and chronological subtasks.');
  const seen=new Set<string>();
  const subtasks=scope.map((x,i)=>{const sourceId=str(x.subtaskId),prior=byId.get(sourceId),name=str(x.name).trim(),minutes=Number(x.estimatedMinutes);
   if(!name||name.length>500||!Number.isInteger(minutes)||minutes<1||minutes>525600||sourceId&&(!prior||seen.has(sourceId)))fail('Invalid, duplicate or unknown subtask.');if(sourceId)seen.add(sourceId);
   // Keep mandatory checkpoint instructions and their evidence criteria intact; add local work around them.
   if(prior?.mandatoryWhenApplicable===true&&name!==prior.name)fail('Retain mandatory checkpoint wording. Add a local instruction as a new subtask.');
   return {...(prior||{checkpoint:'LOCAL',mandatoryWhenApplicable:false,applicability:'site_to_confirm',evidenceRequired:[]}),subtaskId:sourceId||code+'-S-'+randomUUID(),name,estimatedMinutes:minutes,sequence:i+1};
  });
  if(original.some(x=>x.mandatoryWhenApplicable===true&&!seen.has(str(x.subtaskId))))fail('Mandatory checkpoint cannot be removed.');
  const durationMinutes=subtasks.reduce((n,t)=>n+Number(t.estimatedMinutes),0),baseTaskCode=base.organizationVariant===true?str(base.baseTaskCode):source;
  const record={...base,code,name:title,subtasks,durationMinutes,estimatedDuration:{minutes:durationMinutes,basis:'sum_of_subtasks'},version:editing?Number(old?.data.version)+1:1,organizationVariant:true,baseTaskCode,baseReleaseId:releaseId,baseTaskVersion:base.version,status:'draft_review',siteRiskReviewRequired:true,executionAuthorized:false,releaseState:'not_authorized_for_execution',rows:[],energyPlan:[],noAdditionalRisks:false,updatedBy:ctx.uid,updatedAt:nowIso()};
  if(Buffer.byteLength(JSON.stringify(record))>40000)fail('Variant exceeds document size.');
  if(!await writeDoc(localTasks(ctx)+'/'+code,record,old?{updateTime:old.updateTime}:{exists:false}))throw new HttpError(409,'Organization variant changed. Reload.');
  await audit([{category:'maintenance',action:'task_catalogue.variant_save',actor:ctx.actor,meta:ctx.meta,target:{label:code},details:'Organization-local reference variant of '+baseTaskCode,orgId:ctx.orgId}]);return {code,version:record.version};
 })],
 'POST /api/org/mnt/task-catalogue/sites':[orgRoute('org.mnt.task_catalogue.sites',null,async ctx=>{enabled(ctx);if(!canAnywhere(ctx,'MNT.admin'))throw new HttpError(403,'Maintenance administration required.');const scope=await scopeOf(ctx),sites=[];for(const s of (await listDocs(orgRoot(ctx)+'/structure')).filter(s=>s.data.level==='site'&&s.data.status!=='inactive'))if(canAt(ctx,'MNT.admin',await nodePath(ctx.orgId,s.id),scope))sites.push({id:s.id,name:str(s.data.name)});return {sites,organizationEditable:ctx.role==='org_super_admin'||scope==='all'&&canAnywhere(ctx,'MNT.admin')};})],
 'POST /api/org/mnt/task-catalogue/adoption':[orgRoute('org.mnt.task_catalogue.adoption',null,async ctx=>{const siteId=str(ctx.body.siteId);await authorizeAdoption(ctx,siteId);const o=await getDoc(adoptionPath(ctx)),s=siteId?await getDoc(adoptionPath(ctx,siteId)):o,active=await published();const org=await resolveGenericTaskScope(ctx,'');const d=siteId?org.releaseId?await published(org.releaseId):null:ctx.body.useActive===true?active:org.releaseId?await published(org.releaseId):null;if(!d)return {catalogue:null,adoption:null,activeReleaseId:active?.id||'',source:'global'};const allowed=siteId?org.items:await index(d.id);const explicit=!!s&&s.data.inherit!==true;return {catalogue:{...publicHeader(d),count:allowed.length},adoption:explicit&&s?.data.releaseId===d.id?s.data:null,activeReleaseId:active?.id||'',source:explicit?(s?.data.releaseId===d.id?(siteId?'site':'organization'):'stale'):(siteId?org.source:'global'),items:allowed};})],
 'POST /api/org/mnt/task-catalogue/adopt':[orgRoute('org.mnt.task_catalogue.adopt',null,async ctx=>{const siteId=str(ctx.body.siteId);await authorizeAdoption(ctx,siteId);const o=await getDoc(adoptionPath(ctx));const active=await published(),releaseId=safeId(ctx.body.releaseId),org=await resolveGenericTaskScope(ctx,'');if(siteId&&org.releaseId!==releaseId||!siteId&&active?.id!==releaseId&&o?.data.releaseId!==releaseId)throw new HttpError(409,'Select the current permitted catalogue revision.');const d=await published(releaseId);if(!d)throw new HttpError(404,'No published catalogue.');const ix=await index(d.id),allowed=siteId?org.items:ix,taskCodes=codes(ctx.body.taskCodes),familyCodes=codes(ctx.body.familyCodes);if(typeof ctx.body.all!=='boolean'||!Array.isArray(ctx.body.taskCodes)||!Array.isArray(ctx.body.familyCodes)||ctx.body.inherit!==true&&(taskCodes.some(c=>!allowed.some(t=>t.code===c))||familyCodes.some(c=>!allowed.some(t=>t.familyCode===c))))fail('Selection contains unavailable tasks or families.');const path=adoptionPath(ctx,siteId),old=await getDoc(path),next={releaseId:d.id,inherit:ctx.body.inherit===true,all:ctx.body.all===true,taskCodes:ctx.body.inherit===true?[]:taskCodes,familyCodes:ctx.body.inherit===true?[]:familyCodes,updatedBy:ctx.uid,updatedAt:nowIso(),siteValidationRequired:true,executionAuthorized:false};if(!await writeDoc(path,next,old?{updateTime:old.updateTime}:{exists:false}))throw new HttpError(409,'Adoption changed. Reload.');await audit([{category:'maintenance',action:'task_catalogue.adopt',actor:ctx.actor,meta:ctx.meta,target:{label:siteId||'organization'},details:'Reference adoption '+d.id,orgId:ctx.orgId}]);return {adoption:next};})],
};

// Missing or explicitly inherited scopes use their parent. An explicit empty
// selection remains empty; a stale site revision never silently expands access.
export async function resolveGenericTaskScope(ctx:OrgContext,siteId:string){
 const [o,s,active]=await Promise.all([getDoc(adoptionPath(ctx)),siteId?getDoc(adoptionPath(ctx,siteId)):Promise.resolve(null),published()]);
 const explicitOrg=o&&o.data.inherit!==true?o:null,explicitSite=s&&s.data.inherit!==true?s:null;
 const d=explicitOrg?await published(str(explicitOrg.data.releaseId)):active;
 if(!d)return {releaseId:'',source:'global',items:[] as Obj[],catalogue:null};
 const baseItems=adoptFilter(await index(d.id),explicitOrg?.data);
 const eligible=new Set(baseItems.map(t=>str(t.code))),variants=(await listDocs(localTasks(ctx))).filter(v=>v.data.baseReleaseId===d.id&&eligible.has(str(v.data.baseTaskCode))&&v.data.status==='draft_review').map(v=>summary(v.data));
 const orgItems=[...baseItems,...variants];
 const stale=!!explicitSite&&explicitSite.data.releaseId!==d.id;
 const items=stale?[]:adoptFilter(orgItems,explicitSite?.data);
 return {releaseId:d.id,source:stale?'stale':explicitSite?'site':explicitOrg?'organization':'global',items,catalogue:{...publicHeader(d),count:items.length}};
}
export async function adoptedGenericTasks(ctx:OrgContext,siteId:string){return resolveGenericTaskScope(ctx,siteId);}
export async function genericTaskForSite(ctx:OrgContext,siteId:string,releaseId:string,code:string){
 const d=await resolveGenericTaskScope(ctx,siteId);
 if(d.releaseId!==safeId(releaseId)||!d.items.some(t=>t.code===code))throw new HttpError(403,'Task is not available under this organization/site catalogue configuration.');
 const t=await getDoc(code.startsWith('ORG-TASK-')?localTasks(ctx)+'/'+safeId(code):revision(releaseId)+'/tasks/'+safeId(code));if(!t)throw new HttpError(404,'Generic task not found.');
 return t.data;
}
export async function catalogueSiteForEquipment(ctx:OrgContext,id:string){
 for(const nodeId of (await nodePath(ctx.orgId,id)).reverse()){const n=await getDoc(orgRoot(ctx)+'/structure/'+nodeId);if(n?.data.level==='site')return n.id;}
 throw new HttpError(400,'Equipment has no site configuration.');
}

export async function verifyCatalogueReferences(ctx:OrgContext,siteId:string,refs:CatalogueReference[],previous:CatalogueReference[]){
 if(!refs.length)return;
 const old=new Set(previous.map(r=>JSON.stringify(r))),d=await resolveGenericTaskScope(ctx,siteId);
 for(const r of refs){
  if(old.has(JSON.stringify(r)))continue;
  if(r.releaseId!==d.releaseId)throw new HttpError(409,'Generic task catalogue has changed. Select a current task or family.');
  const f=d.catalogue?.families.find(x=>x.code===r.familyCode);
  if(!f||f.categoryCode!==r.categoryCode||f.subcategoryCode!==r.subcategoryCode||!d.items.some(x=>x.familyCode===r.familyCode))throw new HttpError(400,'Choose an eligible task family.');
  if(r.taskCode&&!d.items.some(x=>x.code===r.taskCode&&x.familyCode===r.familyCode&&x.version===r.version))throw new HttpError(400,'Choose an eligible version of the generic task.');
 }
}
