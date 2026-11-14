import {HttpError,getDoc,isObj,nowIso,str,writeDoc,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {PERMS,holdsAnywhere,holdsDirect,audited} from './scopeGuard';
import {shortDeviceEligible} from './safSafetyDevices';
import {SAF_DEFAULT_LISTS} from './safDefaults';
import {AST_UTILITY_ITEMS} from './astUtilityDefaults';
import {loadSafetyHazardMaster} from './safHazardMaster';
import {hazardControlProfile,profileAdoption,type ProfileSelection} from './safHazardControlLibrary';
import {fieldsForPermit,normalizePermitFields} from './safPermitTemplates';
import {EXPANDED_PERMIT_REFERENCES} from './safPermitExpanded';

export const SAF_ADOPTION_KEYS=['safetyDevices','activityClasses','machineStatuses','permitTypes','hazards','mitigationHierarchy','hazardMitigations','injuryNatures','impacts','hazardousEnergy','externalEnergySources','statutoryInspections','controlMeasures','ppe','riskMethods','severityLevels','likelihoodLevels','riskAcceptance','criticalRules','emergencyScenarios'] as const;
type Key=typeof SAF_ADOPTION_KEYS[number];
const root=(orgId:string)=>`organizations/${orgId}/saf`;
const entries=(v:unknown):Obj[]=>Array.isArray(v)?v.filter(isObj) as Obj[]:[];
const asKey=(v:unknown):Key=>{const k=str(v) as Key;if(!SAF_ADOPTION_KEYS.includes(k))throw new HttpError(400,'Unknown SAF catalogue.');return k;};
const assertRead=(ctx:OrgContext)=>{
 if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.SAF!==true)throw new HttpError(403,'Safety module is not enabled for this organization.');
 if(!holdsAnywhere(ctx,PERMS.matrixView))throw new HttpError(403,'Safety view rights are required.');
};
const assertEdit=(ctx:OrgContext)=>{assertRead(ctx);if(!holdsDirect(ctx,PERMS.matrixConfigure))throw new HttpError(403,'Organization-wide SAF configuration rights are required.');};

export function adoptedRecords(master:Obj[],disabled:unknown):Obj[]{
 const off=new Set(Array.isArray(disabled)?disabled.map(str):[]);
 return master.filter(x=>x.active!==false&&x.selectable!==false&&!off.has(str(x.code)));
}
export async function safetyCatalogue(orgId:string,key:Key){
 const [master,policy]=await Promise.all([getDoc(`module_workspaces/SAF/metadata/${key}`),getDoc(`${root(orgId)}/adoption_${key}`)]);
 const fallback=SAF_DEFAULT_LISTS.find(x=>x.key===key);
 // External types use the live AST utility master, never a separately edited mapping.
 const utilities=key==='externalEnergySources'?await getDoc('module_workspaces/AST/metadata/utilitySupplies'):null;
 const utilityItems=entries(Array.isArray(utilities?.data.items)?utilities?.data.items:AST_UTILITY_ITEMS);
 const shared=utilities&&str(utilities.data.source)==='MEMS defaults'&&Number(utilities.data.version)<2?[...utilityItems,...AST_UTILITY_ITEMS.filter(x=>!utilityItems.some(u=>str(u.code)===x.code))]:utilityItems;
 const raw=key==='externalEnergySources'?shared:entries(Array.isArray(master?.data.items)?master?.data.items:fallback?.items);
 const unified=['hazards','hazardousEnergy','externalEnergySources'].includes(key)?await loadSafetyHazardMaster():null;
 const items:Obj[]=unified?(key==='hazards'?unified.hazards:key==='hazardousEnergy'?unified.internal:unified.external):raw;
 const merged=(key==='activityClasses'||key==='permitTypes')?[...items.map(x=>{const def=entries(fallback?.items).find(d=>d.code===x.code);return def&&key==='activityClasses'?{...x,label:def.label,description:def.description,requiredPermits:def.requiredPermits}:x;}),...entries(fallback?.items).filter(d=>!items.some(x=>x.code===d.code))]:items;
 const active=adoptedRecords(merged,policy?.data.disabledCodes);
 return {key,title:str(master?.data.title)||fallback?.title||key,items:merged,active,policy,version:Number(policy?.data.version)||0};
}
export async function effectiveSafetyItems(orgId:string,key:Key){return (await safetyCatalogue(orgId,key)).active;}
const safeOption=(x:Obj)=>({code:str(x.code),label:str(x.label),category:str(x.category),subcategory:str(x.subcategory),description:str(x.description),color:str(x.color),hazardCategory:str(x.hazardCategory),hazardCodes:Array.isArray(x.hazardCodes)?x.hazardCodes.map(str):[],energySourceCode:str(x.energySourceCode)});
export async function safetyDeviceCatalogue(orgId:string){const c=await safetyCatalogue(orgId,'safetyDevices');const adopted=new Set(c.active.map(x=>str(x.code))),eligible=new Set(strings(c.policy?.data.shortDeviceCodes));return {...c,devices:c.items.map(x=>({...safeOption(x),role:str(x.deviceRole),shortCandidate:x.shortCandidate===true,adopted:adopted.has(str(x.code)),shortEligible:shortDeviceEligible(x,adopted.has(str(x.code)),eligible.has(str(x.code)))}))};}
const validCode=(v:unknown)=>{const x=str(v);if(!/^[A-Za-z0-9_-]{1,80}$/.test(x))throw new HttpError(400,'Invalid permit type code.');return x;};
async function permitContext(orgId:string,code:string){
 const catalogue=await safetyCatalogue(orgId,'permitTypes');
 const permit=catalogue.items.find(x=>str(x.code)===code&&x.selectable!==false);
 if(!permit)throw new HttpError(404,'Permit type not found.');
 const path=`${root(orgId)}/permit_template_${code}`;
 const doc=await getDoc(path);
 const definitions=fieldsForPermit(code,str(permit.category),str(permit.label));
 const overrides=isObj(doc?.data.overrides)?doc.data.overrides as Record<string,{enabled?:boolean;required?:boolean}>:{};
 const fields=normalizePermitFields(definitions,overrides);
 return {permit:{...safeOption(permit),adopted:catalogue.active.some(x=>str(x.code)===code)},path,doc,definitions,fields};
}
export async function lotoPolicy(orgId:string){
 const doc=await getDoc(root(orgId)+'/loto_policy');
 return {mode:str(doc?.data.mode),version:Number(doc?.data.version)||0,updatedAt:str(doc?.data.updatedAt),doc};
}
const profilePath=(orgId:string,code:string)=>root(orgId)+'/hazard_profile_'+code;
const strings=(value:unknown):string[]=>Array.isArray(value)?[...new Set(value.filter(x=>typeof x==='string'))]:[];
const localSelection=(value:Obj|undefined):ProfileSelection=>({disabledLayers:strings(value?.disabledLayers),disabledMeasures:strings(value?.disabledMeasures),disabledInjuries:strings(value?.disabledInjuries)});
export async function controlContext(orgId:string,code:string){
 const [hazards,hierarchy,measures,injuries,doc]=await Promise.all([safetyCatalogue(orgId,'hazards'),safetyCatalogue(orgId,'mitigationHierarchy'),safetyCatalogue(orgId,'hazardMitigations'),safetyCatalogue(orgId,'injuryNatures'),getDoc(profilePath(orgId,code))]);
 const hazard=hazards.items.find(h=>str(h.code)===code);
 if(!hazard)throw new HttpError(404,'Hazard master reference not found.');
 const profile=hazardControlProfile(hazard),local=localSelection(doc?.data);
 const global={hierarchy:hierarchy.active.map(x=>str(x.code)),measures:measures.active.map(x=>str(x.code)),injuries:injuries.active.map(x=>str(x.code))};
 const enabled=hazards.active.some(x=>str(x.code)===code);
 return {hazard,profile,doc,local,global,enabled,version:Number(doc?.data.version)||0};
}
export const safConfigurationRoutes={
 'POST /api/org/saf/hazard-profile/read':[orgRoute('org.saf.hazard_profile.read','SAF.view',async ctx=>{
  assertRead(ctx);const c=await controlContext(ctx.orgId,validCode(ctx.body.code));
  return {...profileAdoption(c.profile,c.local,c.global,c.enabled),version:c.version,canEdit:holdsDirect(ctx,PERMS.matrixConfigure),selection:c.local};
 })],
 'POST /api/org/saf/hazard-profile/save':[orgRoute('org.saf.hazard_profile.save','SAF.configure',async ctx=>{
  assertEdit(ctx);const code=validCode(ctx.body.code),c=await controlContext(ctx.orgId,code);
  if(Number(ctx.body.version)!==c.version)throw new HttpError(409,'Hazard adoption changed. Reload.');
  const validate=(key:string,known:ReadonlySet<string>)=>{const v=ctx.body[key];if(!Array.isArray(v)||v.length>1000||v.some(x=>typeof x!=='string'||!known.has(x)))throw new HttpError(400,'Unknown '+key+' reference.');return strings(v);};
  const disabledLayers=validate('disabledLayers',new Set(c.profile.layers.map(x=>x.code)));
  const disabledMeasures=validate('disabledMeasures',new Set(c.profile.layers.flatMap(x=>x.measures.filter(m=>!m.guidance).map(m=>m.code))));
  const disabledInjuries=validate('disabledInjuries',new Set(c.profile.injuries.map(x=>x.code)));
  const reason=str(ctx.body.reason).trim().slice(0,500);if(reason.length<10)throw new HttpError(400,'Explain the adoption change.');
  const selection={disabledLayers,disabledMeasures,disabledInjuries};
  const version=c.version+1,next={...selection,code,version,schemaVersion:c.profile.schemaVersion,updatedAt:nowIso(),updatedBy:ctx.uid,reason};
  if(!await writeDoc(profilePath(ctx.orgId,code),next,c.doc?{updateTime:c.doc.updateTime}:{exists:false}))throw new HttpError(409,'Hazard adoption changed. Reload.');
  await audited(ctx,'saf.hazard_profile.save',code,{version,reason,before:c.local,after:selection});
  return {ok:true,version};
 })],
 'POST /api/org/saf/loto/setup/read':[orgRoute('org.saf.loto.setup.read','SAF.view',async ctx=>{
  assertRead(ctx);const {doc,...policy}=await lotoPolicy(ctx.orgId);return {...policy,canEdit:holdsDirect(ctx,PERMS.matrixConfigure)};
 })],
 'POST /api/org/saf/loto/setup/save':[orgRoute('org.saf.loto.setup.save','SAF.configure',async ctx=>{
  assertEdit(ctx);const old=await lotoPolicy(ctx.orgId),mode=str(ctx.body.mode);
  if(!['group_box','individual_points'].includes(mode))throw new HttpError(400,'Select the approved lockout method.');
  if(Number(ctx.body.version)!==old.version)throw new HttpError(409,'LOTO policy changed. Reload.');
  const reason=str(ctx.body.reason).trim().slice(0,500);if(reason.length<10)throw new HttpError(400,'Record the reason for the configuration.');
  const next={mode,version:old.version+1,updatedAt:nowIso(),updatedBy:ctx.uid,reason};
  if(!await writeDoc(root(ctx.orgId)+'/loto_policy',next,old.doc?{updateTime:old.doc.updateTime}:{exists:false}))throw new HttpError(409,'Policy changed. Reload.');
  await audited(ctx,'saf.loto.setup.save','loto_policy',next);return {ok:true};
 })],
 'POST /api/org/saf/adoption/read':[orgRoute('org.saf.adoption.read','SAF.view',async ctx=>{
  assertRead(ctx);
  const key=asKey(ctx.body.key);
  const c=await safetyCatalogue(ctx.orgId,key);
  const enabled=new Set(c.active.map(x=>str(x.code)));
  return {key,title:c.title,version:c.version,canEdit:holdsDirect(ctx,PERMS.matrixConfigure),keys:SAF_ADOPTION_KEYS,
   rows:c.items.filter(x=>x.selectable!==false).map(x=>({...safeOption(x),masterActive:x.active!==false,enabled:enabled.has(str(x.code)),deviceRole:str(x.deviceRole),shortCandidate:x.shortCandidate===true,shortEnabled:shortDeviceEligible(x,enabled.has(str(x.code)),strings(c.policy?.data.shortDeviceCodes).includes(str(x.code)))}))};
 })],
 'POST /api/org/saf/adoption/save':[orgRoute('org.saf.adoption.save','SAF.configure',async ctx=>{
  assertEdit(ctx);
  const key=asKey(ctx.body.key);
  const c=await safetyCatalogue(ctx.orgId,key);
  if(Number(ctx.body.version)!==c.version)throw new HttpError(409,'Configuration changed. Reload before saving.');
  if(!Array.isArray(ctx.body.disabledCodes)||ctx.body.disabledCodes.length>5000)throw new HttpError(400,'Invalid disabled code list.');
  const known=new Set(c.items.map(x=>str(x.code)));
  const disabled=[...new Set(ctx.body.disabledCodes.map(str))];
  if(disabled.some(x=>!known.has(x)))throw new HttpError(400,'Use only codes from the MEMS SAF master.');
  const reason=str(ctx.body.reason).trim().slice(0,500);
  if(reason.length<10)throw new HttpError(400,'Explain the safety adoption change (at least 10 characters).');
  const shortDeviceCodes=key==='safetyDevices'?strings(ctx.body.shortDeviceCodes):[];
  if(key==='safetyDevices'&&(!Array.isArray(ctx.body.shortDeviceCodes)||ctx.body.shortDeviceCodes.some(x=>typeof x!=='string')||shortDeviceCodes.some(code=>!c.items.some(x=>str(x.code)===code&&shortDeviceEligible(x,x.active!==false&&x.selectable!==false&&!disabled.includes(code),true)))))throw new HttpError(400,'Short Intervention eligibility requires an adopted candidate safeguard.');
  const version=c.version+1;
  const ok=await writeDoc(`${root(ctx.orgId)}/adoption_${key}`,{key,version,disabledCodes:disabled,...(key==='safetyDevices'?{shortDeviceCodes}:{}),updatedBy:ctx.uid,updatedAt:nowIso(),reason},c.policy?{updateTime:c.policy.updateTime}:{exists:false});
  if(!ok)throw new HttpError(409,'Configuration changed. Reload before saving.');
  await audited(ctx,'saf.adoption.save',key,{version,reason,disabledCount:disabled.length,disabledCodes:disabled,...(key==='safetyDevices'?{shortDeviceCodes}:{})});
  return {ok:true,version};
 })],
 'POST /api/org/saf/permits/list':[orgRoute('org.saf.permits.list','SAF.view',async ctx=>{
  assertRead(ctx);
  const c=await safetyCatalogue(ctx.orgId,'permitTypes');
  const rows=await Promise.all(c.items.filter(x=>x.selectable!==false).map(async x=>{
    const code=str(x.code);const doc=await getDoc(`${root(ctx.orgId)}/permit_template_${code}`);
    return {...safeOption(x),adopted:c.active.some(y=>str(y.code)===code),version:Number(doc?.data.version)||0,configured:!!doc,parameterCount:fieldsForPermit(code,str(x.category),str(x.label)).length};
  }));
  return {rows,canEdit:holdsDirect(ctx,PERMS.matrixConfigure)};
 })],
 'POST /api/org/saf/permits/template/read':[orgRoute('org.saf.permits.template.read','SAF.view',async ctx=>{
  assertRead(ctx);
  const c=await permitContext(ctx.orgId,validCode(ctx.body.code));
  return {permit:c.permit,fields:c.fields,referenceBasis:['HSE HSG250',...(EXPANDED_PERMIT_REFERENCES[c.permit.code]||[])],schemaRevision:2,version:Number(c.doc?.data.version)||0,canEdit:holdsDirect(ctx,PERMS.matrixConfigure),
    policy:isObj(c.doc?.data.policy)?c.doc.data.policy:{maxHours:8,allowExtension:false,allowShiftHandover:false,requireAttachments:false},updatedAt:str(c.doc?.data.updatedAt)};
 })],
 'POST /api/org/saf/permits/template/save':[orgRoute('org.saf.permits.template.save','SAF.configure',async ctx=>{
  assertEdit(ctx);
  const code=validCode(ctx.body.code);
  const c=await permitContext(ctx.orgId,code);
  if(Number(ctx.body.version)!==(Number(c.doc?.data.version)||0))throw new HttpError(409,'Permit form changed. Reload before saving.');
  if(!Array.isArray(ctx.body.fields)||ctx.body.fields.length!==c.definitions.length)throw new HttpError(400,'Submit all permit parameters.');
  const sent=entries(ctx.body.fields);
  const overrides:Record<string,{enabled:boolean;required:boolean}>={};
  for(const f of c.definitions){
   const matches=sent.filter(x=>str(x.code)===f.code);const x=matches[0];
   if(matches.length!==1||typeof x.enabled!=='boolean'||typeof x.required!=='boolean')throw new HttpError(400,'Invalid permit parameter '+f.code);
   if(f.mandatory&&(!x.enabled||!x.required))throw new HttpError(400,'Core safety parameter cannot be disabled: '+f.label);
   if(x.required&&!x.enabled)throw new HttpError(400,'A disabled parameter cannot be required.');
   overrides[f.code]={enabled:x.enabled,required:x.required};
  }
  const p=isObj(ctx.body.policy)?ctx.body.policy:{};
  const maxHours=Number(p.maxHours);
  if(!Number.isFinite(maxHours)||maxHours<=0||maxHours>168)throw new HttpError(400,'Enter a valid proposed maximum duration in hours (up to 168).');
  const policy={maxHours,allowExtension:p.allowExtension===true,allowShiftHandover:p.allowShiftHandover===true,requireAttachments:p.requireAttachments===true};
  const reason=str(ctx.body.reason).trim().slice(0,500);
  if(reason.length<10)throw new HttpError(400,'Explain the permit form change (at least 10 characters).');
  const version=(Number(c.doc?.data.version)||0)+1;
  const fields=normalizePermitFields(c.definitions,overrides);
  // One versioned configuration document per permit type. No permit issuance takes place here.
  const oldHistory=entries(c.doc?.data.history);
  const previous=c.doc?{version:Number(c.doc.data.version)||0,overrides:c.doc.data.overrides||{},policy:c.doc.data.policy||{},updatedAt:str(c.doc.data.updatedAt),updatedBy:str(c.doc.data.updatedBy),reason:str(c.doc.data.reason)}:null;
  const ok=await writeDoc(c.path,{code,version,schemaRevision:2,overrides,policy,fields,updatedAt:nowIso(),updatedBy:ctx.uid,reason,history:previous?[...oldHistory.slice(-19),previous]:[]},c.doc?{updateTime:c.doc.updateTime}:{exists:false});
  if(!ok)throw new HttpError(409,'Permit form changed. Reload before saving.');
  await audited(ctx,'saf.permit_template.save',code,{version,reason,enabled:fields.filter(x=>x.enabled).length,policy});
  return {ok:true,version};
 })],
};
