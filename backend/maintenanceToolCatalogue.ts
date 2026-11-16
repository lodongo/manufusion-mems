import {getDoc,listDocs,writeDoc,HttpError,nowIso,str,isObj,type Doc} from './core';
import {staff,orgRoute,type OrgContext} from './guards';
import {canAt,nodePath,scopeOf,canAnywhere} from './access';
import {audit} from './audit';
import {initialToolFamilies,expandToolFamily,TOOL_CATALOGUE_VERSION,type ToolFamily,type ToolCatalogueItem} from './maintenanceToolCatalogueSeed';
import type {AssessedTask} from './maintenanceTaskAssessment';
const master='module_workspaces/MNT/tool_catalogue/default';
const revision='module_workspaces/MNT/tool_catalogue/'+TOOL_CATALOGUE_VERSION;
const adoptionPath=(orgId:string)=>'organizations/'+orgId+'/maintenance_tool_catalogue/default';
let pending:Promise<{count:number;families:number;version:string}>|null=null;
export async function ensureToolCatalogue(){
 if(pending)return pending;
 pending=(async()=>{
  const current=await getDoc(master);
  if(current?.data.version===TOOL_CATALOGUE_VERSION&&Number(current.data.count)>0)return {count:Number(current.data.count),families:Number(current.data.families),version:TOOL_CATALOGUE_VERSION};
  const families=initialToolFamilies(),count=families.reduce((n,f)=>n+f.items.length,0);
  for(let i=0;i<families.length;i+=12)await Promise.all(families.slice(i,i+12).map(f=>writeDoc(revision+'/families/'+f.code,{...f,version:TOOL_CATALOGUE_VERSION})));
  await writeDoc(master,{version:TOOL_CATALOGUE_VERSION,count,families:families.length,publishedAt:nowIso()});
  return {count,families:families.length,version:TOOL_CATALOGUE_VERSION};
 })();
 try{return await pending;}finally{pending=null;}
}
type Adoption={all:boolean;familyCodes:string[]};
const emptyAdoption:Adoption={all:false,familyCodes:[]};
async function adoption(orgId:string):Promise<Adoption>{
 const d=await getDoc(adoptionPath(orgId));
 return {all:d?.data.all===true,familyCodes:Array.isArray(d?.data.familyCodes)?d.data.familyCodes.map(str).filter(Boolean):[]};
}
let cached:{version:string;at:number;families:ToolFamily[]}|null=null;
async function catalogue(){
 const manifest=await getDoc(master);
 if(!manifest)return {version:'',count:0,families:[] as ToolFamily[]};
 const version=str(manifest.data.version);
 if(!/^[a-zA-Z0-9_-]+$/.test(version))throw new HttpError(500,'Invalid catalogue revision');
 if(!cached||cached.version!==version||Date.now()-cached.at>60000){
  const docs=await listDocs('module_workspaces/MNT/tool_catalogue/'+version+'/families');
  const families=docs.map(d=>d.data as unknown as ToolFamily).filter(f=>Array.isArray(f.items)&&Array.isArray(f.attributes));
  if(families.length!==Number(manifest.data.families)||families.reduce((n,f)=>n+f.items.length,0)!==Number(manifest.data.count))throw new HttpError(503,'Catalogue publication is incomplete. Ask MEMS Admin to retry import.');
  cached={version,at:Date.now(),families};
 }
 return {version,count:Number(manifest.data.count),families:cached.families};
}
/** Read the published database catalogue without seeding, publishing, or changing adoption. */
export async function publishedToolCatalogueForReconciliation(){
 const d=await catalogue();
 return {version:d.version,items:d.families.flatMap(expandToolFamily)};
}
function enabled(ctx:OrgContext){if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'Enable Maintenance Management first.');}
function canRead(ctx:OrgContext){enabled(ctx);if(!['MNT.view','MNT.assessment.edit','MNT.assessment.review','MNT.admin','ADM.workflows'].some(p=>canAnywhere(ctx,p)))throw new HttpError(403,'Maintenance catalogue access is required.');}
const adopted=(f:ToolFamily,a:Adoption)=>a.all||a.familyCodes.includes(f.code);
function view(families:ToolFamily[]){return families.map(({items,attributes,...f})=>({...f,count:items.length,attributes})).sort((a,b)=>[a.kind,a.discipline,a.category,a.family].join('|').localeCompare([b.kind,b.discipline,b.category,b.family].join('|')));}
function search(families:ToolFamily[],body:Record<string,unknown>){
 const kind=str(body.kind),discipline=str(body.discipline),category=str(body.category),familyCode=str(body.familyCode),q=str(body.q).trim().toLowerCase().slice(0,160),offset=Math.max(0,Math.min(100000,Math.floor(Number(body.offset)||0)));
 const items=families.filter(f=>(!kind||kind===f.kind)&&(!discipline||discipline===f.discipline)&&(!category||category===f.category)&&(!familyCode||familyCode===f.code)).flatMap(expandToolFamily).filter(i=>!q||q.split(/\s+/).every(word=>[i.name,i.code,i.discipline,i.category,i.family].join(' ').toLowerCase().includes(word))).sort((a,b)=>a.name.localeCompare(b.name)||a.code.localeCompare(b.code));
 return {items:items.slice(offset,offset+60),total:items.length,offset};
}
export async function verifyToolRequirements(ctx:OrgContext,record:Doc,tasks:AssessedTask[]){
 if(!tasks.some(t=>t.toolRequirements?.length||t.services.some(s=>s.missingToolRequirements?.length)))return;
 const [masterData,a]=await Promise.all([catalogue(),adoption(ctx.orgId)]);
 const allByCode=new Map(masterData.families.flatMap(expandToolFamily).map(i=>[i.code,i])),adoptedCodes=new Set(masterData.families.filter(f=>adopted(f,a)).flatMap(f=>f.items.map(i=>i.code)));
 const previous=new Set<string>();
 if(Array.isArray(record.data.assessmentTasks))for(const t of record.data.assessmentTasks)if(isObj(t)&&Array.isArray(t.toolRequirements))for(const r of t.toolRequirements)if(isObj(r))previous.add(str(t.id)+'|'+str(r.catalogueCode));
 for(const t of tasks)for(const r of [...(t.toolRequirements||[]),...t.services.flatMap(s=>s.missingToolRequirements||[])]){
  if(r.assetClassCode){const {maintenanceAssetSpecification}=await import('./assets');const item=await maintenanceAssetSpecification(r.assetClassCode);if(r.catalogueCode!==item.code||r.kind!==item.kind)throw new HttpError(400,'Tool/equipment classification does not match the asset master.');const attrs:Record<string,string>={};for(const a of item.attributes){const value=r.attributes[a.key]?.trim();if(a.required&&!value)throw new HttpError(400,item.name+': enter '+a.label);if(value){if(a.options.length&&!a.options.some(o=>o.code===value)&&a.dataType==='enum')throw new HttpError(400,'Choose a valid '+a.label);attrs[a.key]=value;}}if(!Object.keys(attrs).length&&item.attributes.length)throw new HttpError(400,item.name+': enter the applicable technical specifications.');for(const tag of r.requestedAssetTags||[]){const a=await getDoc('organizations/'+ctx.orgId+'/assets/'+tag);if(!a||a.data.classCode!==item.code||a.data.siteId!==record.data.siteId||a.data.status!=='active'||!(await assetUsable(a)))throw new HttpError(400,'Registered asset '+tag+' is not eligible for this requirement.');}Object.assign(r,{name:item.name,kind:item.kind,discipline:item.discipline,category:item.category,family:item.family,familyCode:item.familyCode,attributes:attrs,attributeDefinitions:item.attributes});continue;}

  const item=allByCode.get(r.catalogueCode);
  if(!item||(!adoptedCodes.has(item.code)&&!previous.has(t.id+'|'+item.code)))throw new HttpError(400,'Choose an adopted tool or equipment catalogue item.');
  const attributes:Record<string,string>={};
  for(const attr of item.attributes){const val=r.attributes[attr.key];if(typeof val!=='string'||!val.trim())throw new HttpError(400,item.name+': enter '+attr.label+'.');attributes[attr.key]=val.trim().slice(0,240);}
  Object.assign(r,{name:item.name,kind:item.kind,familyCode:item.familyCode,discipline:item.discipline,category:item.category,family:item.family,attributes,attributeDefinitions:item.attributes});
 }
}
/** Registered assets must be active and in service/standby. Missing instance condition is not proof of availability. */
export async function assetUsable(a:Doc){const v=isObj(a.data.attributes)?a.data.attributes:{};return a.data.status==='active'&&['IN_SERVICE','STANDBY','IDLE'].includes(str(v['ATT-IDN-014']||v.lifecycle_status));}
export const maintenanceToolCatalogueRoutes={
 'POST /api/org/mnt/asset-resource-catalogue': [orgRoute('org.mnt.asset_resource_catalogue',null,async ctx=>{canRead(ctx);const {maintenanceAssetCatalogue}=await import('./assets');return maintenanceAssetCatalogue();})],
 'POST /api/org/mnt/asset-resource-spec': [orgRoute('org.mnt.asset_resource_spec',null,async ctx=>{canRead(ctx);const {maintenanceAssetSpecification}=await import('./assets');return maintenanceAssetSpecification(str(ctx.body.classCode));})],
 'POST /api/org/mnt/registered-resources': [orgRoute('org.mnt.registered_resources',null,async ctx=>{canRead(ctx);const root='organizations/'+ctx.orgId;const code=str(ctx.body.code);if(!/^WO\d{8}(?:_\d+)?$/.test(code))throw new HttpError(400,'Choose a work order.');const wo=await getDoc(root+'/work_orders/'+code);if(!wo)throw new HttpError(404,'Work order not found.');const path=await nodePath(ctx.orgId,str(wo.data.unitId)),scope=await scopeOf(ctx);if(!['MNT.view','MNT.assessment.edit','MNT.WO.plan'].some(p=>canAt(ctx,p,path,scope)))throw new HttpError(403,'Work order access required.');const cls=str(ctx.body.classCode),assets=await listDocs(root+'/assets'),items=[];for(const a of assets){if(a.data.classCode!==cls||a.data.siteId!==wo.data.siteId||!(await assetUsable(a)))continue;items.push({tag:a.id,name:str(a.data.name),classCode:cls});}return {items};})],

 'POST /api/admin/mnt/tool-catalogue': [staff('admin.mnt.tool_catalogue','read',async ctx=>{const d=await catalogue();return {version:d.version,count:d.count,families:view(d.families),...search(d.families,ctx.body)};})],
 'POST /api/admin/mnt/tool-catalogue/publish': [staff('admin.mnt.tool_catalogue.publish','write',async ctx=>{const result=await ensureToolCatalogue();await audit([{category:'maintenance',action:'tool_catalogue.publish',actor:ctx.actor,meta:ctx.meta,target:{label:result.version},details:String(result.count)+' catalogue items'}]);return result;})],
 'POST /api/org/mnt/tool-catalogue/adoption': [orgRoute('org.mnt.tool_catalogue.adoption','MNT.admin',async ctx=>{enabled(ctx);const [d,a]=await Promise.all([catalogue(),adoption(ctx.orgId)]);return {version:d.version,count:d.count,families:view(d.families),adoption:a};})],
 'POST /api/org/mnt/tool-catalogue/adopt': [orgRoute('org.mnt.tool_catalogue.adopt','MNT.admin',async ctx=>{enabled(ctx);const d=await catalogue();if(!d.version)throw new HttpError(409,'Global catalogue is not published.');if(typeof ctx.body.all!=='boolean'||!Array.isArray(ctx.body.familyCodes))throw new HttpError(400,'Choose catalogue families.');const codes=[...new Set(ctx.body.familyCodes.map(str))];const valid=new Set(d.families.map(f=>f.code));if(codes.some(c=>!valid.has(c)))throw new HttpError(400,'Unknown catalogue family.');const a={all:ctx.body.all===true,familyCodes:ctx.body.all?[]:codes};await writeDoc(adoptionPath(ctx.orgId),{...a,version:d.version,updatedBy:ctx.uid,updatedAt:nowIso()});await audit([{category:'maintenance',action:'tool_catalogue.adopt',actor:ctx.actor,meta:ctx.meta,target:{label:d.version},details:a.all?'All catalogue families':String(a.familyCodes.length)+' families',orgId:ctx.orgId}]);return {adoption:a};})],
 'POST /api/org/mnt/tool-catalogue/search': [orgRoute('org.mnt.tool_catalogue.search',null,async ctx=>{canRead(ctx);const [d,a]=await Promise.all([catalogue(),adoption(ctx.orgId)]);const families=d.families.filter(f=>adopted(f,a));return {version:d.version,count:families.reduce((n,f)=>n+f.items.length,0),families:view(families),...search(families,ctx.body)};})]
};
