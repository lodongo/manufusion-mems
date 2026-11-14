import {HttpError,getDoc,isObj,nowIso,str,writeDoc,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {PERMS,holdsAnywhere,holdsDirect,audited} from './scopeGuard';
import {SAF_DEFAULT_LISTS} from './safDefaults';
import {fieldsForPermit,normalizePermitFields} from './safPermitTemplates';
import {EXPANDED_PERMIT_REFERENCES} from './safPermitExpanded';

export const SAF_ADOPTION_KEYS=['machineStatuses','permitTypes','hazards','impacts','hazardousEnergy','controlMeasures','ppe','riskMethods','severityLevels','likelihoodLevels','riskAcceptance','criticalRules','emergencyScenarios'] as const;
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
 const items=entries(Array.isArray(master?.data.items)?master?.data.items:fallback?.items);
 const active=adoptedRecords(items,policy?.data.disabledCodes);
 return {key,title:str(master?.data.title)||fallback?.title||key,items,active,policy,version:Number(policy?.data.version)||0};
}
export async function effectiveSafetyItems(orgId:string,key:Key){return (await safetyCatalogue(orgId,key)).active;}
const safeOption=(x:Obj)=>({code:str(x.code),label:str(x.label),category:str(x.category),subcategory:str(x.subcategory),description:str(x.description)});
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
export const safConfigurationRoutes={
 'POST /api/org/saf/adoption/read':[orgRoute('org.saf.adoption.read','SAF.view',async ctx=>{
  assertRead(ctx);
  const key=asKey(ctx.body.key);
  const c=await safetyCatalogue(ctx.orgId,key);
  const enabled=new Set(c.active.map(x=>str(x.code)));
  return {key,title:c.title,version:c.version,canEdit:holdsDirect(ctx,PERMS.matrixConfigure),keys:SAF_ADOPTION_KEYS,
   rows:c.items.filter(x=>x.selectable!==false).map(x=>({...safeOption(x),masterActive:x.active!==false,enabled:enabled.has(str(x.code))}))};
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
  const version=c.version+1;
  const ok=await writeDoc(`${root(ctx.orgId)}/adoption_${key}`,{key,version,disabledCodes:disabled,updatedBy:ctx.uid,updatedAt:nowIso(),reason},c.policy?{updateTime:c.policy.updateTime}:{exists:false});
  if(!ok)throw new HttpError(409,'Configuration changed. Reload before saving.');
  await audited(ctx,'saf.adoption.save',key,{version,reason,disabledCount:disabled.length,disabledCodes:disabled});
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
