import {storage} from './platform/sdk';
import {HttpError,getDoc,isObj,nowIso,randomId,rateLimit,str,writeDoc,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {PERMS,allowedAt,requireAt,audited} from './scopeGuard';
import {effectiveSafetyItems} from './safConfiguration';
import {ACTIVITY_CLASSES,CLASS_PERMIT_ALTERNATIVES,meetsClassPermitMinimum} from './safActivityClasses';
import {detectImage} from './branding';
import {signedUrl} from './structure';
import {scoreMaintenanceRisk,type RiskMatrix} from './maintenanceTaskRisk';
import {energyProfile,applies,configuredField,configurationIssues,validDay} from './safEnergyProfiles';
const idRe=/^[A-Za-z0-9_-]{1,120}$/;
const array=(v:unknown):Obj[]=>Array.isArray(v)?v.filter(isObj):[];
const root=(ctx:OrgContext)=>`organizations/${ctx.orgId}`;
const ref=(x:Obj)=>({code:str(x.code),label:str(x.label),category:str(x.category),subcategory:str(x.subcategory),description:str(x.description),color:str(x.color)});
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
export const safEquipmentRoutes={
 'POST /api/org/saf/equipment-energy/read':[orgRoute('org.saf.equipment_energy.read','SAF.view',async ctx=>{
  const {id,node}=await equipment(ctx);const [master,doc]=await Promise.all([effectiveSafetyItems(ctx.orgId,'hazardousEnergy'),getDoc(energyPath(ctx,id))]);
  const today=nowIso().slice(0,10);
  const items=await Promise.all(array(doc?.data.items).map(async (x,i)=>{
   const tests=isObj(x.tests)?x.tests:{},values=isObj(x.values)?x.values:{};
   const reports=Object.fromEntries(await Promise.all(Object.entries(tests).filter(([,v])=>isObj(v)).map(async ([key,v])=>{
    const test=v as Obj,token=str(test.evidenceToken);
    return [key,{...test,evidenceUrl:evidenceValid(ctx,id,token)?await signedUrl(token):''}];
   })));
   const issues=configurationIssues(energyProfile(str(x.code)),values,tests,today);
   if(!str(x.tag)||!str(x.photoToken))issues.unshift('Tag and equipment photo');
   const status=issues.length?'incomplete':x.status==='documented'?'documented':'draft';
   return {...x,pointId:pointIdOf(x,i),values,tests:reports,status,issues,url:tokenValid(ctx,id,str(x.photoToken))?await signedUrl(str(x.photoToken)):''};
  }));
  return {equipmentName:str(node.data.name),catalogue:master.map(x=>({...ref(x),profile:energyProfile(str(x.code))})),profiles:Object.fromEntries(array(doc?.data.items).map(x=>[str(x.code),energyProfile(str(x.code))])),items,version:Number(doc?.data.version)||0,canEdit:await allowedAt(ctx,PERMS.riskAssess,id,'write')};
 })],
 'POST /api/org/saf/equipment-energy/photo':[orgRoute('org.saf.equipment_energy.photo','SAF.risk.assess',async ctx=>{
  const {id}=await equipment(ctx,true);await rateLimit('saf-energy-photo',ctx.uid,60,3600);
  const report=ctx.body.purpose==='test_evidence';
  const pointId=str(ctx.body.pointId),testCode=str(ctx.body.testCode),sourceCode=str(ctx.body.sourceCode);
  if(report&&(!idRe.test(pointId)||!energyProfile(sourceCode).tests.some(t=>t.code===testCode)||!(await effectiveSafetyItems(ctx.orgId,'hazardousEnergy')).some(x=>str(x.code)===sourceCode)))throw new HttpError(400,'Invalid test evidence reference.');
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
  const {id}=await equipment(ctx,true);const path=energyPath(ctx,id);const old=await getDoc(path);const version=Number(old?.data.version)||0;
  if(Number(ctx.body.version)!==version)throw new HttpError(409,'Energy register changed. Reload.');
  if(!Array.isArray(ctx.body.items)||ctx.body.items.length>100||array(ctx.body.items).length!==ctx.body.items.length)throw new HttpError(400,'Invalid energy register.');
  const catalogue=await effectiveSafetyItems(ctx.orgId,'hazardousEnergy');const known=new Map(catalogue.map(x=>[str(x.code),x]));const tags=new Set<string>(),ids=new Set<string>();
  const previous=array(old?.data.items);
  const finalize=ctx.body.finalize===true,today=nowIso().slice(0,10);
  const items=await Promise.all(array(ctx.body.items).map(async (x,i)=>{
   const code=str(x.code),tag=str(x.tag).trim(),photoToken=str(x.photoToken),source=known.get(code),pointId=str(x.pointId)||'legacy-'+i;
   if(!idRe.test(pointId)||ids.has(pointId))throw new HttpError(400,'Invalid or duplicate energy point ID.');
   ids.add(pointId);
   const historical=previous.find((y,j)=>pointIdOf(y,j)===pointId&&str(y.code)===code);
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
   const profile=energyProfile(code),rawValues=isObj(x.values)?x.values:{},rawTests=isObj(x.tests)?x.tests:{};
   const values:Obj={},tests:Obj={};
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
   const issues=configurationIssues(profile,values,tests,today);
   if(!tag||!photoToken)issues.unshift('Tag and equipment photo');
   if(finalize&&issues.length)throw new HttpError(400,(tag||str(source.label))+': '+issues.slice(0,5).join('; '));
   return {code,pointId,tag,photoToken,label:str(source.label),values,tests,status:finalize?'documented':'draft',profileVersion:1};
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
  return {equipmentName:str(node.data.name),classes:rows.filter(x=>x.adopted||x.record),catalogue:{hazards:hazards.map(ref),impacts:impacts.map(ref),controls:controls.map(ref),permits:permits.map(ref)},matrix:matrix?.data.configuration||null,energy:array(energy?.data.items).map(x=>({tag:str(x.tag),label:str(x.label)})),canEdit:await allowedAt(ctx,PERMS.riskAssess,id,'write')};
 })],
 'POST /api/org/saf/activity-classes/save':[orgRoute('org.saf.activity_classes.save','SAF.risk.assess',async ctx=>{
  const {id}=await equipment(ctx,true);const code=str(ctx.body.classCode),cl=ACTIVITY_CLASSES.find(x=>x.code===code);
  if(!cl||!(await effectiveSafetyItems(ctx.orgId,'activityClasses')).some(x=>str(x.code)===code))throw new HttpError(400,'Select an adopted activity class.');
  const path=classPath(ctx,id,code),old=await getDoc(path),version=Number(old?.data.version)||0;
  if(Number(ctx.body.version)!==version)throw new HttpError(409,'Assessment changed. Reload.');
  const scope=str(ctx.body.scope).trim().slice(0,3000);if(scope.length<10)throw new HttpError(400,'Describe the applicable activity and limits.');
  const permitCodes=stringList(ctx.body.permitCodes);
  const [hazards,impacts,controls,permits,matrixDoc,energyDoc]=await Promise.all([effectiveSafetyItems(ctx.orgId,'hazards'),effectiveSafetyItems(ctx.orgId,'impacts'),effectiveSafetyItems(ctx.orgId,'controlMeasures'),effectiveSafetyItems(ctx.orgId,'permitTypes'),getDoc(`${root(ctx)}/saf/risk_matrix`),getDoc(energyPath(ctx,id))]);
  const has=(a:Obj[],c:string)=>a.some(x=>str(x.code)===c);
  if(permitCodes.some(c=>!has(permits,c)))throw new HttpError(400,'Select only adopted permits.');
  // A class only sets a minimum. It cannot authorize work or exempt actual hazards.
  if(!meetsClassPermitMinimum(code,permitCodes))throw new HttpError(400,'The class requires its adopted permit(s); select the applicable permit or enable missing permit types in Safety.');
  const energyTags=stringList(ctx.body.energyTags);
  if(energyTags.some(t=>!array(energyDoc?.data.items).some(x=>str(x.tag)===t)))throw new HttpError(400,'Unknown equipment energy tag.');
  const screening=str(ctx.body.screening).trim().slice(0,3000);
  if(cl.assessmentKind!=='screening'&&screening.length<20)throw new HttpError(400,'Document the intervention limits, required verification and stop-work criteria.');
  const raw=ctx.body.rows;
  if(!Array.isArray(raw)||raw.length>100||array(raw).length!==raw.length)throw new HttpError(400,'Invalid risk rows.');
  if(cl.assessmentKind==='screening'&&(ctx.body.noExposure!==true||screening.length<20||raw.length||permitCodes.length||energyTags.length))throw new HttpError(400,'No Risk requires documented screening with no credible exposure. If there is a hazard, choose a risk-bearing class.');
  if(cl.assessmentKind!=='screening'&&!raw.length)throw new HttpError(400,'Add at least one hazard assessment.');
  const matrix=matrixDoc?.data.configuration as unknown as RiskMatrix;
  const rows=array(raw).map(r=>{
   const hazard=str(r.hazard),impact=str(r.impact),selected=stringList(r.controls);
   if(!has(hazards,hazard)||!has(impacts,impact)||!selected.length||selected.some(c=>!has(controls,c)))throw new HttpError(400,'Choose an adopted hazard, impact and mitigation control.');
   if(!matrix||!isObj(r.before)||!isObj(r.after))throw new HttpError(400,'Configure the risk matrix and provide both initial and residual ratings.');
   try{return {hazard,impact,controls:selected,before:scoreMaintenanceRisk(matrix,r.before as Record<string,number>),after:scoreMaintenanceRisk(matrix,r.after as Record<string,number>)};}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid ratings.');}
  });
  const status=rows.some(r=>r.after.tolerability==='Intolerable')?'intolerable':'recorded';
  const ok=await writeDoc(path,{classCode:code,scope,screening,noExposure:ctx.body.noExposure===true,permitCodes,energyTags,rows,status,version:version+1,updatedAt:nowIso(),updatedBy:ctx.uid},old?{updateTime:old.updateTime}:{exists:false});
  if(!ok)throw new HttpError(409,'Assessment changed. Reload.');
  await audited(ctx,'saf.activity_class_risk.save',id,{classCode:code,version:version+1,status});
  return {ok:true,status,version:version+1};
 })],
};
