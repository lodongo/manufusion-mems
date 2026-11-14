import {storage} from './platform/sdk';
import {HttpError,getDoc,isObj,nowIso,randomId,rateLimit,str,writeDoc,listDocs,nextSequence,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {PERMS,allowedAt,requireAt,audited,holdsDirect} from './scopeGuard';
import {effectiveSafetyItems,safetyCatalogue,lotoPolicy,controlContext,safetyDeviceCatalogue} from './safConfiguration';
import {ACTIVITY_CLASSES,CLASS_PERMIT_ALTERNATIVES,meetsClassPermitMinimum} from './safActivityClasses';
import {detectImage} from './branding';
import {signedUrl} from './structure';
import {scoreMaintenanceRisk,type RiskMatrix} from './maintenanceTaskRisk';
import {configuredField,configurationIssues,validDay} from './safEnergyProfiles';
import {readLotoProcedure,normalizeLotoProcedure,lotoProcedureRequired,lotoProcedureIssues} from './safLotoProcedure';
import {statutoryProfile,mergeUtilityEnergy,utilityDefinition,candidateInspectionCodes,utilityPointId} from './safStatutoryInspections';
import {utilityLinkIssue} from './astUtilities';
import {energyColor} from './safEnergyColors';
import {profileAdoption} from './safHazardControlLibrary';
import {taskDecisionPath,TASK_ADDITIONAL_CLASSES,EXECUTOR_TYPES,TASK_PLAN_STATES,taskRiskAssessmentPending} from './safTaskDecision';
import {injuryCodes,combinedControlCodes} from './safInjurySelection';
const idRe=/^[A-Za-z0-9_-]{1,120}$/;
const array=(v:unknown):Obj[]=>Array.isArray(v)?v.filter(isObj):[];
const root=(ctx:OrgContext)=>`organizations/${ctx.orgId}`;
const ref=(x:Obj)=>({code:str(x.code),label:str(x.label),category:str(x.category),subcategory:str(x.subcategory),description:str(x.description),color:str(x.color),hazardCategory:str(x.hazardCategory),hazardCodes:Array.isArray(x.hazardCodes)?x.hazardCodes.map(str):[],relatedHazards:Array.isArray(x.relatedHazards)?x.relatedHazards:[]});
async function equipment(ctx:OrgContext,write=false){
 const id=str(ctx.body.workCenterId);
 if(!idRe.test(id))throw new HttpError(400,'Invalid equipment.');
 const node=await getDoc(`${root(ctx)}/structure/${id}`);
 if(!node||str(node.data.level)!=='work_center')throw new HttpError(404,'Equipment not found.');
 await requireAt(ctx,write?PERMS.riskAssess:PERMS.riskView,id,write?'write':'read','Safety rights at this equipment are required.');
 return {id,node};
}
const energyPath=(ctx:OrgContext,id:string)=>`${root(ctx)}/equipment_energy_sources/${id}`;
const classPath=(ctx:OrgContext,id:string,code:string)=>`${root(ctx)}/equipment_activity_class_risks/${id}_${code}`;
const photoPrefix=(ctx:OrgContext,id:string)=>`${root(ctx)}/saf/equipment_energy/${id}/`;
const tokenValid=(ctx:OrgContext,id:string,token:string)=>token.startsWith(photoPrefix(ctx,id))&&/^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(token.slice(photoPrefix(ctx,id).length));
const evidenceValid=(ctx:OrgContext,id:string,token:string)=>token.startsWith(photoPrefix(ctx,id))&&/^report_[A-Za-z0-9_-]+\.(pdf|jpg|png)$/.test(token.slice(photoPrefix(ctx,id).length));
const pointIdOf=(x:Obj,i:number)=>idRe.test(str(x.pointId))?str(x.pointId):'legacy-'+i;
const stringList=(v:unknown):string[]=>Array.isArray(v)?[...new Set(v.map(str).filter(Boolean))]:[];
async function energyContext(ctx:OrgContext,id:string,saved:Obj[]){
 const [internal,external,statutory,utilityDoc]=await Promise.all([
  safetyCatalogue(ctx.orgId,'hazardousEnergy'),safetyCatalogue(ctx.orgId,'externalEnergySources'),
  safetyCatalogue(ctx.orgId,'statutoryInspections'),getDoc(`${root(ctx)}/equipment_utilities/${id}`)]);
 const utilities=array(utilityDoc?.data.items);
 const rows=mergeUtilityEnergy(utilities,saved);
 const allowedExternal=new Set(external.active.map(x=>str(x.code)));
 const adoptedTests=new Set(statutory.active.map(x=>str(x.code)));
 const utilityByCode=new Map(utilities.map(x=>[str(x.code),x]));
 const defs=new Map(external.items.map(x=>[str(x.code),x]));
 const attrs=(code:string)=>array(defs.get(code)?.attributes||utilityDefinition(code)?.attributes);
 const profile=(code:string)=>statutoryProfile(code,adoptedTests,attrs(code).map(a=>str(a.key)));
 const linked=utilities.map(u=>{
  const code=str(u.code),def=defs.get(code);
  return {...ref(def||u),code,label:str(def?.label)||str(u.label)||code,category:str(def?.category)||'External utility',subcategory:str(def?.subcategory)||'Existing connection',
   linkedUtility:true,adopted:allowedExternal.has(code),profile:profile(code)};
 });
 const catalogue=[...internal.active.map(x=>({...ref(x),linkedUtility:false,adopted:true,profile:profile(str(x.code))})),...linked];
 const metadata=new Map([...internal.items,...external.items].map(x=>[str(x.code),x]));
 return {rows,catalogue,metadata,profile,utilityByCode,attrs,adoptedTests,allowedExternal,utilityVersion:Number(utilityDoc?.data.version)||0};
}
function reviewIssues(profile:ReturnType<typeof statutoryProfile>,values:Obj,tests:Obj,today:string){
 return configurationIssues(profile,values,tests,today);
}
async function taskClassBaseline(ctx:OrgContext,id:string,code:string){
 const d=await getDoc(classPath(ctx,id,code));
 return {code,version:Number(d?.data.version)||0,status:str(d?.data.status)||'not_assessed',scope:str(d?.data.scope),screening:str(d?.data.screening),permitCodes:stringList(d?.data.permitCodes),energyTags:stringList(d?.data.energyTags),rows:array(d?.data.rows)};
}
const taskCollection=(ctx:OrgContext,id:string)=>root(ctx)+'/equipment_task_register/'+id+'/tasks';
const taskCodeRe=/^TSK_\d{9}$/;
async function taskSkills(){
 const d=await getDoc('module_workspaces/HRM/metadata/skillsMaster');
 return array(d?.data.items).filter(x=>x.active!==false&&x.selectable!==false).map(ref);
}
async function currentTaskEnergy(ctx:OrgContext,id:string){
 const doc=await getDoc(energyPath(ctx,id)),c=await energyContext(ctx,id,array(doc?.data.items));
 return c.rows.map((x,i)=>({pointId:pointIdOf(x,i),tag:str(x.tag),code:str(x.code),label:str(c.metadata.get(str(x.code))?.label)||str(x.label)||str(x.code),color:str(c.metadata.get(str(x.code))?.color),status:str(x.status)||'incomplete'}));
}
async function adoptedHazardProfile(org:string,code:string){
 const c=await controlContext(org,code);
 return profileAdoption(c.profile,c.local,c.global,c.enabled);
}
async function scoreHazardRows(ctx:OrgContext,raw:unknown,matrix:RiskMatrix,prior:Obj[]=[]){
 if(!Array.isArray(raw)||raw.length>100||array(raw).length!==raw.length)throw new HttpError(400,'Invalid hazard rows.');
 const profiles=new Map<string,ReturnType<typeof adoptedHazardProfile>>();
 const legacyImpacts=await effectiveSafetyItems(ctx.orgId,'impacts'),legacyControls=await effectiveSafetyItems(ctx.orgId,'controlMeasures');
 const has=(a:Obj[],c:string)=>a.some(x=>str(x.code)===c);
 return Promise.all(array(raw).map(async r=>{
  const hazard=str(r.hazard),impacts=injuryCodes(r),selected=stringList(r.controls);
  if(r.impactCodes!==undefined&&(!Array.isArray(r.impactCodes)||r.impactCodes.length>300||r.impactCodes.some(v=>typeof v!=='string'||!v.trim())))throw new HttpError(400,'Invalid potential injuries.');
  const hazardCodes=r.hazardCodes===undefined?[hazard]:stringList(r.hazardCodes);
  if(!hazardCodes.length||hazardCodes.length>100||hazardCodes[0]!==hazard)throw new HttpError(400,'Invalid selected hazards.');
  const group=await Promise.all(hazardCodes.map(code=>{if(!profiles.has(code))profiles.set(code,adoptedHazardProfile(ctx.orgId,code));return profiles.get(code)!;}));
  const profile={hazardEnabled:group.every(p=>p.hazardEnabled),injuries:group.flatMap(p=>p.injuries),layers:group.flatMap(p=>p.layers)};
  const oldRows=prior.filter(p=>p.hazard===hazard&&injuryCodes(p).some(c=>impacts.includes(c)));
  const oldInjuries=new Set(oldRows.flatMap(injuryCodes));
  const oldControls=oldRows.flatMap(p=>stringList(p.controls));
  const injuryOk=impacts.length>0&&impacts.every(code=>profile.injuries.some(x=>x.code===code&&x.effective)||oldInjuries.has(code)&&has(legacyImpacts,code));
  const allowed=combinedControlCodes(profile,impacts);
  // Existing still-adopted controls remain visible and valid for historical records only.
  const historicalAllowed=new Set(profile.layers.flatMap(l=>l.measures.filter(m=>m.effective&&!m.guidance).map(m=>m.code)));
  if(!profile.hazardEnabled||!injuryOk||!selected.length||selected.some(c=>!allowed.has(c)&&!(oldControls.includes(c)&&(has(legacyControls,c)||historicalAllowed.has(c)))))throw new HttpError(400,'Choose adopted injury and hazard-specific mitigation controls. Historical selections may be retained only if still adopted.');
  if(!matrix||!isObj(r.before)||!isObj(r.after))throw new HttpError(400,'Configure the risk matrix and provide initial and residual ratings.');
  try{return {hazard,hazardCodes,impact:impacts[0],impactCodes:impacts,impactLabels:impacts.map(c=>profile.injuries.find(i=>i.code===c)?.label||str(legacyImpacts.find(i=>i.code===c)?.label)||c),controls:selected,before:scoreMaintenanceRisk(matrix,r.before as Record<string,number>),after:scoreMaintenanceRisk(matrix,r.after as Record<string,number>)};}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid ratings.');}
 }));
}
const devicePath=(ctx:OrgContext,id:string)=>root(ctx)+'/equipment_safety_devices/'+id;
const devicePhotoPrefix=(ctx:OrgContext,id:string)=>root(ctx)+'/saf/equipment_devices/'+id+'/';
const devicePhotoValid=(ctx:OrgContext,id:string,token:string)=>token.startsWith(devicePhotoPrefix(ctx,id))&&/^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(token.slice(devicePhotoPrefix(ctx,id).length));
export const safEquipmentRoutes={
 'POST /api/org/saf/equipment-devices/read':[orgRoute('org.saf.equipment_devices.read','SAF.view',async ctx=>{
  const {id,node}=await equipment(ctx);const path=devicePath(ctx,id);
  const [doc,master,policy]=await Promise.all([getDoc(path),safetyDeviceCatalogue(ctx.orgId),lotoPolicy(ctx.orgId)]);
  const items=await Promise.all(array(doc?.data.items).map(async r=>{const def=master.devices.find(d=>d.code===r.code),photoToken=str(r.photoToken),eligible=def?.shortEligible===true;return {...r,safetyCategory:str(r.safetyCategory),categoryCompliant:['B','1','2','3','4'].indexOf(str(r.safetyCategory))>=['B','1','2','3','4'].indexOf(policy.minimumSafetyCategory),label:def?.label||str(r.label),category:def?.category||str(r.category),role:def?.role||'unknown',adopted:def?.adopted===true,shortEligible:eligible,url:devicePhotoValid(ctx,id,photoToken)?await signedUrl(photoToken):'',status:r.shortSelected===true?(eligible&&str(r.tag)&&photoToken&&str(r.procedure)?'documented_review_required':'incomplete_or_eligibility_withdrawn'):'registered'};}));
  return {equipmentName:str(node.data.name),equipmentCode:str(node.data.code),version:Number(doc?.data.version)||0,policyVersion:master.version,minimumSafetyCategory:policy.minimumSafetyCategory,catalogue:master.devices.filter(d=>d.adopted),items,canEdit:await allowedAt(ctx,PERMS.riskAssess,id,'write')};
 })],
 'POST /api/org/saf/equipment-devices/program-photo':[orgRoute('org.saf.equipment_devices.program_photo','SAF.view',async ctx=>{
  const {id}=await equipment(ctx);await rateLimit('saf-program-photo',ctx.uid,240,3600);const deviceId=str(ctx.body.deviceId);
  const doc=await getDoc(devicePath(ctx,id));const row=array(doc?.data.items).find(r=>r.deviceId===deviceId&&r.shortSelected===true);const token=str(row?.photoToken);
  if(!row||!devicePhotoValid(ctx,id,token))throw new HttpError(404,'Program photo not found.');
  const metadata=await getDoc(devicePath(ctx,id)+'/photos/'+token.slice(devicePhotoPrefix(ctx,id).length));if(metadata?.data.pointId!==deviceId)throw new HttpError(404,'Program photo not found.');
  const bytes=await storage.read(token),image=detectImage(bytes);if(!image||bytes.length>1500000)throw new HttpError(400,'Invalid program photo.');return {data:bytes.toString('base64'),contentType:image.contentType};
 })],
 'POST /api/org/saf/equipment-devices/photo':[orgRoute('org.saf.equipment_devices.photo','SAF.risk.assess',async ctx=>{
  const {id}=await equipment(ctx,true);await rateLimit('saf-device-photo',ctx.uid,60,3600);
  const data=str(ctx.body.data),pointId=str(ctx.body.deviceId);
  if(!idRe.test(pointId)||!data||data.length>2000000||!/^[A-Za-z0-9+/=]+$/.test(data))throw new HttpError(400,'Upload a compressed image.');
  const bytes=Buffer.from(data,'base64'),detected=detectImage(bytes);
  if(!detected||bytes.length>1500000)throw new HttpError(400,'Upload a supported image up to 1.5 MB.');
  const token=devicePhotoPrefix(ctx,id)+randomId(16)+'.'+detected.ext;
  if(!(await storage.write([{path:token,content:data,contentType:detected.contentType}]))[0])throw new HttpError(502,'Photo upload failed.');
  if(!await writeDoc(devicePath(ctx,id)+'/photos/'+token.slice(devicePhotoPrefix(ctx,id).length),{token,pointId,uploadedBy:ctx.uid,uploadedAt:nowIso()},{exists:false}))throw new HttpError(409,'Photo metadata could not be recorded.');
  return {token,url:await signedUrl(token)};
 })],
 'POST /api/org/saf/equipment-devices/save':[orgRoute('org.saf.equipment_devices.save','SAF.risk.assess',async ctx=>{
  const {id}=await equipment(ctx,true);const path=devicePath(ctx,id),[old,master]=await Promise.all([getDoc(path),safetyDeviceCatalogue(ctx.orgId)]);
  const version=Number(old?.data.version)||0;
  if(Number(ctx.body.version)!==version||Number(ctx.body.policyVersion)!==master.version)throw new HttpError(409,'Register or Safety adoption changed. Reload.');
  if(!Array.isArray(ctx.body.items)||ctx.body.items.length>180||array(ctx.body.items).length!==ctx.body.items.length)throw new HttpError(400,'Invalid safety device register.');
  const previous=array(old?.data.items),ids=new Set<string>(),tags=new Set<string>();
  const items=await Promise.all(array(ctx.body.items).map(async r=>{
   const deviceId=str(r.deviceId),code=str(r.code),def=master.devices.find(d=>d.code===code),prior=previous.find(p=>p.deviceId===deviceId);
   if(!idRe.test(deviceId)||ids.has(deviceId)||prior&&prior.code!==code)throw new HttpError(400,'Invalid or duplicate device identity.');ids.add(deviceId);
   const tag=str(r.tag).trim().slice(0,120),photoToken=str(r.photoToken),procedure=str(r.procedure).trim().slice(0,6000),location=str(r.location).trim().slice(0,300),shortSelected=r.shortSelected===true;
   if(tag){const t=tag.toUpperCase();if(tags.has(t))throw new HttpError(400,'Device tags must be unique on this equipment.');tags.add(t);}
   if(!def?.adopted&&(!prior||shortSelected&&prior.shortSelected!==true))throw new HttpError(400,'Select an adopted safety device type.');
   if(!def?.adopted&&prior&&(tag!==str(prior.tag)||photoToken!==str(prior.photoToken)||procedure!==str(prior.procedure)||location!==str(prior.location)))throw new HttpError(400,'Historical device is no longer adopted.');
   if(shortSelected&&!def?.shortEligible&&(!prior||prior.shortSelected!==true||tag!==str(prior.tag)||photoToken!==str(prior.photoToken)||procedure!==str(prior.procedure)||location!==str(prior.location)))throw new HttpError(400,'Safety must explicitly enable this candidate for Short Intervention.');
   if(shortSelected&&(!tag||!photoToken||procedure.length<20))throw new HttpError(400,'Short Intervention requires a physical tag, photo and documented procedure.');
   if(photoToken){const photo=devicePhotoValid(ctx,id,photoToken)?await getDoc(path+'/photos/'+photoToken.slice(devicePhotoPrefix(ctx,id).length)):null;if(!photo||photo.data.pointId!==deviceId)throw new HttpError(400,'Photo must belong to this equipment device.');}
   const technical=Object.fromEntries(['manufacturer','make','model','safetyCategory','validationReference'].map(k=>[k,str((def?.adopted&&r[k]!==undefined)?r[k]:prior?.[k]).trim().slice(0,500)]));
   if(technical.safetyCategory&&!['B','1','2','3','4','NA'].includes(technical.safetyCategory))throw new HttpError(400,'Invalid safety category.');
   return {...technical,deviceId,code,label:def?.label||str(prior?.label),category:def?.category||str(prior?.category),tag,photoToken,procedure,location,shortSelected};
  }));
  const next={items,version:version+1,updatedAt:nowIso(),updatedBy:ctx.uid,policyVersion:master.version};
  if(!await writeDoc(path,next,old?{updateTime:old.updateTime}:{exists:false}))throw new HttpError(409,'Register changed. Reload.');
  await audited(ctx,'saf.equipment_devices.save',id,{version:version+1,items:items.map(r=>({deviceId:r.deviceId,code:r.code,tag:r.tag,shortSelected:r.shortSelected})),removed:previous.filter(p=>!ids.has(str(p.deviceId))).map(p=>str(p.deviceId))});
  return {ok:true,version:version+1};
 })],
 'POST /api/org/saf/equipment-tasks/read':[orgRoute('org.saf.equipment_tasks.read','SAF.view',async ctx=>{
  const {id,node}=await equipment(ctx);
  const [docs,classes,hazards,permits,skills,matrix,energy]=await Promise.all([listDocs(taskCollection(ctx,id)),effectiveSafetyItems(ctx.orgId,'activityClasses'),effectiveSafetyItems(ctx.orgId,'hazards'),effectiveSafetyItems(ctx.orgId,'permitTypes'),taskSkills(),getDoc(root(ctx)+'/saf/risk_matrix'),currentTaskEnergy(ctx,id)]);
  const reportCatalogue=ctx.body.includeRiskReport===true?await Promise.all([safetyCatalogue(ctx.orgId,'hazards'),safetyCatalogue(ctx.orgId,'injuryNatures'),safetyCatalogue(ctx.orgId,'impacts'),safetyCatalogue(ctx.orgId,'hazardMitigations'),safetyCatalogue(ctx.orgId,'controlMeasures'),safetyCatalogue(ctx.orgId,'mitigationHierarchy'),safetyCatalogue(ctx.orgId,'permitTypes')]):null;
  const reportReferences=reportCatalogue?{hazards:reportCatalogue[0].items.map(ref),injuries:[...reportCatalogue[1].items,...reportCatalogue[2].items].map(ref),controls:[...reportCatalogue[3].items,...reportCatalogue[4].items].map(x=>({...ref(x),hierarchyCode:str(x.hierarchyCode)})),hierarchy:reportCatalogue[5].items.map(x=>({...ref(x),rank:Number(x.rank)||0})),permits:reportCatalogue[6].items.map(ref)}:null;
  return {reportReferences,equipmentName:str(node.data.name),tasks:docs.map(d=>({...d.data,taskId:d.id})).sort((a,b)=>String(b.taskId).localeCompare(String(a.taskId))),classes:await Promise.all(ACTIVITY_CLASSES.filter(c=>classes.some(x=>x.code===c.code)).map(async c=>({...c,permitAlternatives:CLASS_PERMIT_ALTERNATIVES[c.code]||[],baseline:await taskClassBaseline(ctx,id,c.code)}))),hazards:hazards.map(ref),permits:permits.map(ref),skills,matrix:matrix?.data.configuration||null,energy,canEdit:await allowedAt(ctx,PERMS.riskAssess,id,'write'),canCreate:holdsDirect(ctx,['ADM.structure'])&&await allowedAt(ctx,PERMS.riskAssess,id,'write')};
 })],
 'POST /api/org/saf/equipment-tasks/save':[orgRoute('org.saf.equipment_tasks.save','SAF.risk.assess',async ctx=>{
  const {id}=await equipment(ctx,true);
  const requested=str(ctx.body.taskId);
  // Safety can update existing risk records but may not allocate new task IDs.
  // A source label is not a permission: creation additionally needs direct design rights.
  if(!requested&&(ctx.body.source==='safety'||!holdsDirect(ctx,['ADM.structure'])))throw new HttpError(403,'Create tasks in Organization Design with authorized design rights.');
  if(requested&&!taskCodeRe.test(requested))throw new HttpError(400,'Invalid task ID.');
  const col=taskCollection(ctx,id),old=requested?await getDoc(col+'/'+requested):null;
  if(requested&&!old)throw new HttpError(404,'Task not found on this equipment.');
  const version=Number(old?.data.version)||0;
  if(Number(ctx.body.version)!==version)throw new HttpError(409,'Task changed. Reload.');
  const name=str(ctx.body.name).trim().slice(0,250),executor=str(ctx.body.executor),skillCodes=stringList(ctx.body.skillCodes),duration=Number(ctx.body.durationMinutes);
  if(name.length<3||!EXECUTOR_TYPES.includes(executor)||!Number.isFinite(duration)||duration<=0||duration>525600||!skillCodes.length||skillCodes.length>2000)throw new HttpError(400,'Enter task name, executor, positive duration in minutes and HR skills.');
  const path=taskDecisionPath(isObj(ctx.body.answers)?ctx.body.answers as Record<string,string>:{});
  const {answers,decision}=path;
  if(!decision.code)throw new HttpError(400,decision.reason);
  const additional=stringList(ctx.body.additionalClasses);
  if(additional.some(c=>!TASK_ADDITIONAL_CLASSES.includes(c)))throw new HttpError(400,'Invalid additional task class.');
  if(decision.code==='AC01'&&additional.length)throw new HttpError(400,'Additional hazards conflict with No Risk. Revisit the screening.');
  const classCodes=[...new Set([decision.code,...additional])],permitCodes=stringList(ctx.body.permitCodes),justification=str(ctx.body.justification).trim().slice(0,3000);
  if(justification.length<20)throw new HttpError(400,'Document screening, technical basis, safeguards and work limits.');
  const [classes,permits,skills,matrixDoc,energy]=await Promise.all([effectiveSafetyItems(ctx.orgId,'activityClasses'),effectiveSafetyItems(ctx.orgId,'permitTypes'),taskSkills(),getDoc(root(ctx)+'/saf/risk_matrix'),currentTaskEnergy(ctx,id)]);
  if(skillCodes.some(c=>!skills.some(s=>s.code===c)))throw new HttpError(400,'Select active HR master skills.');
  if(classCodes.some(c=>!classes.some(s=>s.code===c)))throw new HttpError(400,'Adopt the applicable task class in Safety.');
  if(permitCodes.some(c=>!permits.some(s=>s.code===c))||classCodes.some(c=>!meetsClassPermitMinimum(c,permitCodes)))throw new HttpError(400,'Select the adopted required and applicable permits.');
  const plan=array(ctx.body.energyPlan).map(x=>({pointId:str(x.pointId),state:str(x.state),reason:str(x.reason).trim().slice(0,1000)}));
  if(new Set(plan.map(x=>x.pointId)).size!==plan.length||plan.some(x=>!energy.some(e=>e.pointId===x.pointId)||!TASK_PLAN_STATES.includes(x.state)))throw new HttpError(400,'Invalid equipment energy plan.');
  if(['AC03','AC05','AC06','AC22'].includes(decision.code)){
   if(plan.length!==energy.length||plan.some(p=>(p.state==='retained'||p.state==='not_applicable')&&p.reason.length<10))throw new HttpError(400,'Classify every equipment energy point and justify retained or non-applicable energy.');
   if(decision.code==='AC03'&&energy.length&&!plan.some(p=>p.state==='isolate'))throw new HttpError(400,'Identify at least one isolation point, or correct the classification and energy register.');
   if(decision.code==='AC03'&&plan.some(p=>p.state==='retained'))throw new HttpError(400,'Full LOTO cannot retain hazardous energy.');
   if(decision.code==='AC06'&&(!plan.some(p=>p.state==='isolate')||!plan.some(p=>p.state==='retained')))throw new HttpError(400,'Partial LOTO needs isolation and retained-energy points.');
   if(['AC05','AC22'].includes(decision.code)&&plan.some(p=>p.state==='isolate')&&!permitCodes.includes('SAF_08_01_003'))throw new HttpError(400,'LOTO permit is required for isolated energy points.');
   if(['AC05','AC22'].includes(decision.code)&&energy.length&&!plan.some(p=>p.state==='retained'))throw new HttpError(400,'Identify the technically necessary retained energy.');
  }
  const baseline=await Promise.all(classCodes.map(c=>taskClassBaseline(ctx,id,c)));
  const noAdditionalRisks=ctx.body.noAdditionalRisks===true;
  const raw=ctx.body.rows;
  if(!Array.isArray(raw))throw new HttpError(400,'Invalid risk rows.');
  if(decision.code==='AC01'&&(raw.length||permitCodes.length||plan.some(x=>x.state!=='not_applicable')))throw new HttpError(400,'No Risk conflicts with recorded hazards, permits or energy intervention. Re-screen.');
  const hasGlobalRisks=baseline.some(b=>b.rows.length>0);
  if(decision.code!=='AC01'&&noAdditionalRisks&&!hasGlobalRisks)throw new HttpError(400,'No global risks are recorded; assess applicable activity-specific risks or save with assessment pending.');
  const assessmentPending=taskRiskAssessmentPending(decision.code,raw.length,hasGlobalRisks,noAdditionalRisks);
  if(raw.length&&noAdditionalRisks)throw new HttpError(400,'Additional risks and no-additional-risks confirmation conflict.');
  if(baseline.some(b=>b.permitCodes.some(c=>!permitCodes.includes(c))))throw new HttpError(400,'Retain the class-level permit requirements or correct the class assessment.');
  const inherited=new Set(baseline.flatMap(b=>b.rows.flatMap(r=>Array.isArray(r.hazardCodes)?stringList(r.hazardCodes):[str(r.hazard)])));
  const seen=new Set<string>();
  for(const r of array(raw))for(const h of r.hazardCodes===undefined?[str(r.hazard)]:stringList(r.hazardCodes)){if(inherited.has(h)||seen.has(h))throw new HttpError(400,'Hazard already covered by a task class or another additional row. Review the inherited assessment instead.');seen.add(h);}
  const rows=await scoreHazardRows(ctx,raw,matrixDoc?.data.configuration as unknown as RiskMatrix,array(old?.data.rows));
  const n=requested?0:await nextSequence('equipmentTask');
  if(!requested&&n>999999999)throw new HttpError(409,'Task sequence exhausted.');
  const taskId=requested||'TSK_'+String(n).padStart(9,'0');
  const status=rows.some(r=>r.after.tolerability==='Intolerable')||baseline.some(b=>b.status==='intolerable')?'intolerable':(!energy.length||energy.some(e=>!e.tag))&&['AC03','AC05','AC06','AC22'].includes(decision.code)?'energy_register_incomplete':assessmentPending?'task_assessment_pending':'review_required';
  const next={taskId,workCenterId:id,name,executor,skillCodes,durationMinutes:duration,answers,decision,classCodes,additionalClasses:additional,permitCodes,justification,energyPlan:plan.map(p=>({...p,tag:energy.find(e=>e.pointId===p.pointId)?.tag||'',label:energy.find(e=>e.pointId===p.pointId)?.label||''})),rows,classBaseline:baseline,noAdditionalRisks,status,executionAuthorized:false,version:version+1,createdAt:str(old?.data.createdAt)||nowIso(),updatedAt:nowIso(),updatedBy:ctx.uid};
  if(!(await writeDoc(col+'/'+taskId,next,old?{updateTime:old.updateTime}:{exists:false})))throw new HttpError(409,'Task changed. Reload.');
  await audited(ctx,'saf.equipment_task.save',id,{taskId,version:version+1,classCodes,status});
  return {ok:true,taskId,status};
 })],
 'POST /api/org/saf/equipment-energy/read':[orgRoute('org.saf.equipment_energy.read','SAF.view',async ctx=>{
  const {id,node}=await equipment(ctx);const doc=await getDoc(energyPath(ctx,id));
  const context=await energyContext(ctx,id,array(doc?.data.items));
  if(ctx.body.programPhotoPointId!==undefined){
   await rateLimit('saf-loto-program-photo',ctx.uid,240,3600);
   if(Number(ctx.body.version)!==(Number(doc?.data.version)||0)||Number(ctx.body.utilityVersion)!==context.utilityVersion)throw new HttpError(409,'Energy register changed. Refresh LOTO Program before exporting.');
   const pointId=str(ctx.body.programPhotoPointId),row=context.rows.find((x,i)=>pointIdOf(x,i)===pointId),token=str(row?.photoToken);
   if(!idRe.test(pointId)||!row||!tokenValid(ctx,id,token))throw new HttpError(404,'Energy point photo not found.');
   const meta=await getDoc(energyPath(ctx,id)+'/photos/'+token.slice(photoPrefix(ctx,id).length));
   if(!meta||meta.data.purpose==='test_evidence')throw new HttpError(404,'Energy point photo not found.');
   const bytes=await storage.read(token),image=detectImage(bytes);
   if(!image||bytes.length>1500000)throw new HttpError(400,'Invalid energy point photo.');
   return {data:bytes.toString('base64'),contentType:image.contentType};
  }
  const today=nowIso().slice(0,10);
  const items=await Promise.all(context.rows.map(async (x,i)=>{
   const tests=isObj(x.tests)?x.tests:{},values=isObj(x.values)?x.values:{};
   const reports=Object.fromEntries(await Promise.all(Object.entries(tests).filter(([,v])=>isObj(v)).map(async ([key,v])=>{
    const test=v as Obj,token=str(test.evidenceToken);
    return [key,{...test,evidenceUrl:evidenceValid(ctx,id,token)?await signedUrl(token):''}];
   })));
   const code=str(x.code),profile=context.profile(code),def=context.metadata.get(code)||x;
   const procedure=readLotoProcedure(x);
   const issues=[...reviewIssues(profile,values,tests,today),...lotoProcedureIssues(procedure,lotoProcedureRequired(x.linkedUtility===true,values))];
   if(!x.linkedUtility&&!context.catalogue.some(s=>s.code===code))issues.push('Historical source is no longer adopted in Safety.');
   if(x.linkedUtility&&!context.allowedExternal.has(code))issues.push('Existing utility is not currently adopted in Safety.');
   if(x.linkedUtility){const issue=await utilityLinkIssue(ctx.orgId,node,context.utilityByCode.get(code)!,{attributes:context.attrs(code)});if(issue)issues.push(issue);}
   if(!str(x.tag)||!str(x.photoToken))issues.unshift('Tag and equipment photo');
   const status=issues.length?'incomplete':x.status==='documented'?'documented':'draft';
   return {...x,...procedure,pointId:pointIdOf(x,i),label:str(def.label)||str(x.label)||code,category:str(def.category)||'Unclassified',color:str(def.color)||energyColor(def),hazardCategory:str(def.hazardCategory),hazardCodes:Array.isArray(def.hazardCodes)?def.hazardCodes:[],relatedHazards:Array.isArray(def.relatedHazards)?def.relatedHazards:[],values,tests:reports,status,issues,utilityAttrs:context.attrs(code).map(a=>({key:str(a.key),label:str(a.label),unit:str(a.unit)})),unadoptedInspections:candidateInspectionCodes(code).filter(c=>!context.adoptedTests.has(c)),url:tokenValid(ctx,id,str(x.photoToken))?await signedUrl(str(x.photoToken)):''};
  }));
  return {equipmentName:str(node.data.name),lotoPolicy:await lotoPolicy(ctx.orgId).then(({doc,...p})=>p),catalogue:context.catalogue,profiles:Object.fromEntries(context.rows.map(x=>[str(x.code),context.profile(str(x.code))])),items,utilityVersion:context.utilityVersion,version:Number(doc?.data.version)||0,canEdit:await allowedAt(ctx,PERMS.riskAssess,id,'write')};
 })],
 'POST /api/org/saf/equipment-energy/photo':[orgRoute('org.saf.equipment_energy.photo','SAF.risk.assess',async ctx=>{
  const {id}=await equipment(ctx,true);await rateLimit('saf-energy-photo',ctx.uid,60,3600);
  const report=ctx.body.purpose==='test_evidence';
  const pointId=str(ctx.body.pointId),testCode=str(ctx.body.testCode),sourceCode=str(ctx.body.sourceCode);
  if(report){
   const sources=await energyContext(ctx,id,[]);
   if(!idRe.test(pointId)||!sources.profile(sourceCode).tests.some(t=>t.code===testCode)||!sources.catalogue.some(x=>x.code===sourceCode)||sourceCode.startsWith('UTL-')&&(!sources.utilityByCode.has(sourceCode)||pointId!==utilityPointId(sources.utilityByCode.get(sourceCode)!)))throw new HttpError(400,'Invalid or non-adopted statutory test evidence reference.');
  }
  const data=str(ctx.body.data);if(!data||data.length>2_000_000||!/^[A-Za-z0-9+/=]+$/.test(data))throw new HttpError(400,'Upload a compressed image or a PDF up to 1.5 MB.');
  const bytes=Buffer.from(data,'base64');const detected=detectImage(bytes)||(report&&bytes.subarray(0,5).toString()==='%PDF-'?{ext:'pdf',contentType:'application/pdf'}:null);
  if(!detected||bytes.length>1_500_000)throw new HttpError(400,'Upload a supported image or PDF up to 1.5 MB.');
  const token=photoPrefix(ctx,id)+(report?'report_':'')+randomId(16)+'.'+detected.ext;
  if(!(await storage.write([{path:token,content:data,contentType:detected.contentType}]))[0])throw new HttpError(502,'Photo could not be stored.');
  const key=token.slice(photoPrefix(ctx,id).length);
  if(!(await writeDoc(`${energyPath(ctx,id)}/photos/${key}`,{token,purpose:report?'test_evidence':'point_photo',pointId:report?pointId:'',sourceCode:report?sourceCode:'',testCode:report?testCode:'',uploadedAt:nowIso(),uploadedBy:ctx.uid},{exists:false})))throw new HttpError(409,'Evidence metadata could not be recorded.');
  return {token,url:await signedUrl(token)};
 })],
 'POST /api/org/saf/equipment-energy/save':[orgRoute('org.saf.equipment_energy.save','SAF.risk.assess',async ctx=>{
  const {id,node}=await equipment(ctx,true);const path=energyPath(ctx,id);const old=await getDoc(path);const version=Number(old?.data.version)||0;
  if(Number(ctx.body.version)!==version)throw new HttpError(409,'Energy register changed. Reload.');
  if(!Array.isArray(ctx.body.items)||ctx.body.items.length>100||array(ctx.body.items).length!==ctx.body.items.length)throw new HttpError(400,'Invalid energy register.');
  const previous=array(old?.data.items);
  const context=await energyContext(ctx,id,previous),catalogue=context.catalogue;
  if(Number(ctx.body.utilityVersion)!==context.utilityVersion&&(ctx.body.utilityVersion!==undefined||context.utilityByCode.size))throw new HttpError(409,'Equipment utilities changed. Reload the energy register.');
  const known=new Map(catalogue.map(x=>[str(x.code),x]));const tags=new Set<string>(),ids=new Set<string>();
  const submitted=array(ctx.body.items);
  // An existing utility is neither selectable nor removable from Safety. Require the exact same set.
  for(const code of context.utilityByCode.keys())if(submitted.filter(x=>str(x.code)===code&&str(x.pointId)===utilityPointId(context.utilityByCode.get(code)!)).length!==1)throw new HttpError(400,'All configured utility connections must appear exactly once. Refresh the register.');
  const finalize=ctx.body.finalize===true,today=nowIso().slice(0,10);
  const items:Obj[]=await Promise.all(array(ctx.body.items).map(async (x,i):Promise<Obj>=>{
   const code=str(x.code),tag=str(x.tag).trim(),photoToken=str(x.photoToken),source=known.get(code),pointId=str(x.pointId)||'legacy-'+i;
   if(!idRe.test(pointId)||ids.has(pointId))throw new HttpError(400,'Invalid or duplicate energy point ID.');
   ids.add(pointId);
   const linked=code.startsWith('UTL-');
   if(linked&&(!context.utilityByCode.has(code)||pointId!==utilityPointId(context.utilityByCode.get(code)!)))throw new HttpError(400,'External connections are maintained in Utilities.');
   const current=linked?context.rows.find(y=>str(y.pointId)===pointId):null;
   const historical=linked?current:previous.find((y,j)=>pointIdOf(y,j)===pointId&&str(y.code)===code);
   if(linked&&finalize){const issue=await utilityLinkIssue(ctx.orgId,node,context.utilityByCode.get(code)!,{attributes:context.attrs(code)});if(issue)throw new HttpError(400,issue);}
   if(linked&&finalize&&!context.allowedExternal.has(code))throw new HttpError(400,'Adopt the existing utility in Safety before marking the register documented.');
   // Existing clients must not erase newer technical records by omitting profile data.
   if(historical&&(!isObj(x.values)||!isObj(x.tests))&&(isObj(historical.values)||isObj(historical.tests)))throw new HttpError(409,'Refresh MEMS before editing the expanded energy register.');
   if(!source){
    if(!historical)throw new HttpError(400,'Select an adopted energy source.');
    if(tag!==str(historical.tag)||photoToken!==str(historical.photoToken))throw new HttpError(400,'A disabled historical source cannot be edited.');
    if(tag&&tags.has(tag.toLowerCase()))throw new HttpError(400,'Duplicate energy tag name.');
    if(tag)tags.add(tag.toLowerCase());
    return {...historical,pointId};
   }
   if(tag.length>120||tag&&tags.has(tag.toLowerCase()))throw new HttpError(400,'Each energy point needs a unique tag name (up to 120 characters).');
   if(tag)tags.add(tag.toLowerCase());
   if(photoToken){
    const photo=tokenValid(ctx,id,photoToken)?await getDoc(`${path}/photos/${photoToken.slice(photoPrefix(ctx,id).length)}`):null;
    if(!photo||photo.data.purpose==='test_evidence')throw new HttpError(400,'Add a photo for each energy point.');
   }
   const profile=context.profile(code),rawValues=isObj(x.values)?x.values:{},rawTests=isObj(x.tests)?x.tests:{};
   const values:Obj={},tests:Obj={};
   // Retain removed fields for historical records; they are no longer editable or validation gates.
   if(isObj(historical?.values))for(const k of ['exposure_basis','legal_jurisdiction','legal_review'])if(historical.values[k]!==undefined)values[k]=historical.values[k];
   // Preserve former routine tests and non-adopted statutory reports without treating them as current obligations.
   if(isObj(historical?.tests))for(const [k,v] of Object.entries(historical.tests))if(!profile.tests.some(t=>t.code===k))tests[k]=v;
   for(const field of profile.fields){
    const value=rawValues[field.code];
    if(value===undefined||value===null||value==='')continue;
    if(!configuredField(field,value))throw new HttpError(400,'Invalid value: '+field.label);
    values[field.code]=typeof value==='string'?value.trim():value;
   }
   for(const test of profile.tests){
    const value=rawTests[test.code];
    if(!isObj(value))continue;
    const result=str(value.result),lastDate=str(value.lastDate),nextDue=str(value.nextDue),tester=str(value.tester).trim().slice(0,200),basis=str(value.basis).trim().slice(0,500),justification=str(value.justification).trim().slice(0,1000),evidenceToken=str(value.evidenceToken),measurement=str(value.measurement).trim().slice(0,1000);
    if(!['','pass','fail','pending','not_applicable'].includes(result)||result==='not_applicable'&&!test.conditional)throw new HttpError(400,'Invalid test disposition: '+test.label);
    if(lastDate&&(!validDay(lastDate)||lastDate>today)||nextDue&&!validDay(nextDue)||lastDate&&nextDue&&nextDue<=lastDate)throw new HttpError(400,'Invalid test dates: '+test.label);
    if(evidenceToken){
     const evidence=evidenceValid(ctx,id,evidenceToken)?await getDoc(`${path}/photos/${evidenceToken.slice(photoPrefix(ctx,id).length)}`):null;
     if(!evidence||str(evidence.data.pointId)!==pointId||str(evidence.data.sourceCode)!==code||str(evidence.data.testCode)!==test.code||evidence.data.purpose!=='test_evidence')throw new HttpError(400,'Evidence must belong to this energy point and test.');
    }
    tests[test.code]={result,lastDate,nextDue,tester,basis,justification,evidenceToken,measurement};
   }
   const oldProcedure=readLotoProcedure(historical||{});
   let procedure;try{procedure=normalizeLotoProcedure(x.procedureSteps===undefined?oldProcedure.procedureSteps:x.procedureSteps,x.verification===undefined?oldProcedure.verification:x.verification);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid LOTO instructions.');}
   const issues=[...reviewIssues(profile,values,tests,today),...lotoProcedureIssues(procedure,lotoProcedureRequired(linked,values))];
   if(!tag||!photoToken)issues.unshift('Tag and equipment photo');
   if(finalize&&issues.length)throw new HttpError(400,(tag||str(source.label))+': '+issues.slice(0,5).join('; '));
   return {code,pointId,tag,photoToken,label:str(source.label),values,tests,...procedure,status:finalize?'documented':'draft',profileVersion:2,...(linked?{utilityFingerprint:str(current?.utilityFingerprint),utilityConnectionId:str(current?.utilityConnectionId)}:{})};
  }));
  if(finalize&&!items.length)throw new HttpError(400,'Record at least one actual energy point; an empty register does not establish zero energy.');
  // Preserve the previous register in a bounded-size separate revision document when changed.
  if(old&&version>0){
   const revPath=`${path}/revisions/v${version}`;
   if(!(await getDoc(revPath)))await writeDoc(revPath,{items:previous,version,updatedAt:str(old.data.updatedAt),updatedBy:str(old.data.updatedBy)},{exists:false});
  }
  const ok=await writeDoc(path,{items,version:version+1,updatedAt:nowIso(),updatedBy:ctx.uid},old?{updateTime:old.updateTime}:{exists:false});
  if(!ok)throw new HttpError(409,'Energy register changed. Reload.');
  await audited(ctx,'saf.equipment_energy.save',id,{version:version+1,points:items.map(x=>({code:x.code,tag:x.tag})),finalize});
  return {ok:true,version:version+1};
 })],
 'POST /api/org/saf/activity-classes/read':[orgRoute('org.saf.activity_classes.read','SAF.view',async ctx=>{
  const {id,node}=await equipment(ctx);const [classes,hazards,impacts,controls,permits,matrix,energy]=await Promise.all([
   effectiveSafetyItems(ctx.orgId,'activityClasses'),effectiveSafetyItems(ctx.orgId,'hazards'),effectiveSafetyItems(ctx.orgId,'impacts'),effectiveSafetyItems(ctx.orgId,'controlMeasures'),effectiveSafetyItems(ctx.orgId,'permitTypes'),getDoc(`${root(ctx)}/saf/risk_matrix`),getDoc(energyPath(ctx,id))]);
  const adopted=new Set(classes.map(x=>str(x.code)));
  const rows=await Promise.all(ACTIVITY_CLASSES.map(async cl=>{const doc=await getDoc(classPath(ctx,id,cl.code));return {...cl,permitAlternatives:CLASS_PERMIT_ALTERNATIVES[cl.code]||[],adopted:adopted.has(cl.code),record:doc?.data||null};}));
  return {equipmentName:str(node.data.name),classes:rows.filter(x=>x.adopted||x.record),catalogue:{hazards:hazards.map(ref),impacts:impacts.map(ref),controls:controls.map(ref),permits:permits.map(ref)},matrix:matrix?.data.configuration||null,energy:(await energyContext(ctx,id,array(energy?.data.items))).rows.filter(x=>str(x.tag)).map(x=>({tag:str(x.tag),label:str(x.label)})),canEdit:await allowedAt(ctx,PERMS.riskAssess,id,'write')};
 })],
 'POST /api/org/saf/activity-classes/save':[orgRoute('org.saf.activity_classes.save','SAF.risk.assess',async ctx=>{
  const {id}=await equipment(ctx,true);const code=str(ctx.body.classCode),cl=ACTIVITY_CLASSES.find(x=>x.code===code);
  if(!cl||!(await effectiveSafetyItems(ctx.orgId,'activityClasses')).some(x=>str(x.code)===code))throw new HttpError(400,'Select an adopted activity class.');
  const path=classPath(ctx,id,code),old=await getDoc(path),version=Number(old?.data.version)||0;
  if(Number(ctx.body.version)!==version)throw new HttpError(409,'Assessment changed. Reload.');
  // Legacy notes remain available on previously recorded class assessments. Task-specific limits belong to the task decision and risk assessment.
  const scope=str(old?.data.scope);
  const permitCodes=stringList(ctx.body.permitCodes);
  const [hazards,impacts,controls,permits,matrixDoc,energyDoc]=await Promise.all([effectiveSafetyItems(ctx.orgId,'hazards'),effectiveSafetyItems(ctx.orgId,'impacts'),effectiveSafetyItems(ctx.orgId,'controlMeasures'),effectiveSafetyItems(ctx.orgId,'permitTypes'),getDoc(`${root(ctx)}/saf/risk_matrix`),getDoc(energyPath(ctx,id))]);
  const has=(a:Obj[],c:string)=>a.some(x=>str(x.code)===c);
  if(permitCodes.some(c=>!has(permits,c)))throw new HttpError(400,'Select only adopted permits.');
  // A class only sets a minimum. It cannot authorize work or exempt actual hazards.
  const energyTags=stringList(ctx.body.energyTags);
  const currentEnergy=(await energyContext(ctx,id,array(energyDoc?.data.items))).rows;
  if(energyTags.some(t=>!currentEnergy.some(x=>str(x.tag)===t)))throw new HttpError(400,'Unknown equipment energy tag.');
  const screening=cl.assessmentKind==='screening'?str(ctx.body.screening).trim().slice(0,3000):str(old?.data.screening);
  const raw=ctx.body.rows;
  if(!Array.isArray(raw)||raw.length>100||array(raw).length!==raw.length)throw new HttpError(400,'Invalid risk rows.');
  if(cl.assessmentKind==='screening'&&(raw.length||permitCodes.length||energyTags.length||((ctx.body.noExposure===true||!!screening)&&(ctx.body.noExposure!==true||screening.length<20))))throw new HttpError(400,'No Risk requires documented screening when a screening is recorded, with no credible exposure. If there is a hazard, choose a risk-bearing class.');
  if(raw.length&&!meetsClassPermitMinimum(code,permitCodes))throw new HttpError(400,'The class requires its adopted permit(s) when recording global risks.');
  const matrix=matrixDoc?.data.configuration as unknown as RiskMatrix;
  const rows=await scoreHazardRows(ctx,raw,matrix,array(old?.data.rows));
  const status=rows.some(r=>r.after.tolerability==='Intolerable')?'intolerable':rows.length||cl.assessmentKind==='screening'&&ctx.body.noExposure===true?'recorded':'not_assessed';
  const ok=await writeDoc(path,{classCode:code,scope,screening,noExposure:ctx.body.noExposure===true,permitCodes,energyTags,rows,status,version:version+1,updatedAt:nowIso(),updatedBy:ctx.uid},old?{updateTime:old.updateTime}:{exists:false});
  if(!ok)throw new HttpError(409,'Assessment changed. Reload.');
  await audited(ctx,'saf.activity_class_risk.save',id,{classCode:code,version:version+1,status});
  return {ok:true,status,version:version+1};
 })],
};
