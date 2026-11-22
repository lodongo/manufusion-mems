/**
 * AST utilities: shared cost-centre distribution for equipment and process BOMs.
 * The cost centre owns the available utility supply; source assets provide rated
 * capacity. Equipment demand is never written to the supply asset or the BOM.
 * Legacy direct asset connections remain visible until explicitly reassigned.
 */
import {HttpError,commitChecked,getDoc,isObj,listDocs,nowIso,str,type Doc,type Obj} from './core';
import {orgRoute,type OrgContext} from './guards';
import {allowedAt,PERMS,requireAt,audited} from './scopeGuard';
import {safetyCatalogue} from './safConfiguration';
import {isInternalUtilitySupply} from './utilitySupplyPolicy';
import {reviewUtilityDistribution,type UtilityConsumer,type UtilityDefinition} from '../src/shared/utilityDistributionCapacity';

const ID=/^[A-Za-z0-9_-]{1,120}$/;
const ASSET=/^AST-\d{6}$/;
const path=(org:string,cc:string)=>'organizations/'+org+'/cost_center_utility_supplies/'+cc;
const root=(org:string)=>'organizations/'+org+'/cost_center_utility_supplies';
const assetsRoot=(org:string)=>'organizations/'+org+'/assets';
const allocationLockPath=(org:string)=>'organizations/'+org+'/utility_supply_allocation_locks/global';
const structure=(org:string,id:string)=>'organizations/'+org+'/structure/'+id;
const equipmentRoot=(org:string)=>'organizations/'+org+'/equipment_utilities';
const rows=(doc:Doc|null):Obj[]=>Array.isArray(doc?.data.items)?doc.data.items.filter(isObj):[];
const number=(x:unknown):number|null=>{
 const n=typeof x==='number'?x:typeof x==='string'&&x.trim()?Number(x):NaN;
 return Number.isFinite(n)?n:null;
};
const positive=(x:unknown)=>{const n=number(x);return n!==null&&n>0?n:null;};
type ConsumerRow=UtilityConsumer&{supplyLinkRule:number};
type Source={assetTag:string;allocatedCapacity:number|null};
type SupplyItem={code:string;label:string;values:Record<string,string|number>;sources:Source[]};
async function location(org:string,node:Doc):Promise<string>{
 let next:Doc|null=node;
 for(let n=0;n<16&&next;n++){
  if(str(next.data.level)==='site')return next.id;
  const parent=str(next.data.parentId);
  next=parent&&parent!=='root'&&ID.test(parent)?await getDoc(structure(org,parent)):null;
 }
 return '';
}
async function centre(ctx:OrgContext,id:string,mode:'read'|'write'='read'){
 if(!ID.test(id))throw new HttpError(400,'Choose a valid cost centre.');
 const node=await getDoc(structure(ctx.orgId,id));
 if(!node||str(node.data.level)!=='cost_center'||str(node.data.status)==='inactive')
  throw new HttpError(404,'Cost centre is unavailable.');
 await requireAt(ctx,mode==='read'?PERMS.utilitiesView:PERMS.utilitiesEdit,id,mode,
  mode==='read'?'You cannot view cost-centre utility supply.':'You cannot edit cost-centre utility supply.');
 return {node,siteId:await location(ctx.orgId,node)};
}
export async function costCenterForEquipment(org:string,workCenterId:string){
 if(!ID.test(workCenterId))throw new HttpError(400,'Invalid equipment unit.');
 const equipment=await getDoc(structure(org,workCenterId));
 if(!equipment||str(equipment.data.level)!=='work_center')throw new HttpError(404,'Equipment unit was not found.');
 const costCenterId=str(equipment.data.parentId),cc=await getDoc(structure(org,costCenterId));
 if(!cc||str(cc.data.level)!=='cost_center'||str(cc.data.status)==='inactive')
  throw new HttpError(409,'Assign the equipment to an active cost centre before linking external utilities.');
 return {equipment,costCenterId,costCenter:cc,siteId:await location(org,cc)};
}
export async function utilityDefinitions(org:string){
 const master=await safetyCatalogue(org,'externalEnergySources');
 return master.active.filter(isObj) as Obj[];
}
async function consumers(org:string,ccId:string,code:string,replace?:{workCenterId:string;values:Record<string,unknown>}){
 const [docs,linkedAssets]=await Promise.all([listDocs(equipmentRoot(org)),listDocs(assetsRoot(org))]);
 const result:ConsumerRow[]=[];
 for(const d of docs){
  const equipment=await getDoc(structure(org,d.id));
  if(!equipment||str(equipment.data.parentId)!==ccId||str(equipment.data.level)!=='work_center')continue;
  const hasAsset=!!str(isObj(equipment.data.attributes)?equipment.data.attributes.assetTag:'')||
   linkedAssets.some(a=>str(a.data.workCenterId)===d.id&&str(a.data.status)!=='removed');
  for(const row of rows(d).filter(r=>str(r.code)===code&&!isInternalUtilitySupply(r))){
   const values=replace&&replace.workCenterId===d.id?replace.values:
    isObj(row.values)?row.values:{};
   result.push({equipmentId:d.id,name:str(equipment.data.name)||d.id,values,
    legacy:str(row.sourceCostCenterId)!==ccId||row.supplyLinkRule!==3,
    hasAsset,supplyLinkRule:Number(row.supplyLinkRule)||0});
  }
 }
 // A new equipment row may not yet be saved; include its proposed load.
 if(replace&&!result.some(x=>x.equipmentId===replace.workCenterId)){
  const n=await getDoc(structure(org,replace.workCenterId));
  const hasAsset=!!str(isObj(n?.data.attributes)?n?.data.attributes.assetTag:'')||
   linkedAssets.some(a=>str(a.data.workCenterId)===replace.workCenterId);
  result.push({equipmentId:replace.workCenterId,name:str(n?.data.name)||replace.workCenterId,
   values:replace.values,legacy:false,hasAsset,supplyLinkRule:3});
 }
 return result;
}
const supplyRows=(doc:Doc|null):Obj[]=>rows(doc);
function sourceList(raw:Obj):Source[]{
 return Array.isArray(raw.sources)?raw.sources.filter(isObj).map(x=>({
  assetTag:str(x.assetTag),allocatedCapacity:positive(x.allocatedCapacity)})):[];
}
async function capability(org:string,ccId:string,item:Obj,def:Obj,
 replace?:{workCenterId:string;values:Record<string,unknown>}){
 const sources=sourceList(item);
 const capacity=sources.length&&sources.every(s=>s.allocatedCapacity!==null)?
  sources.reduce((n,s)=>n+(s.allocatedCapacity||0),0):null;
 const centreNode=await getDoc(structure(org,ccId));
 const siteId=centreNode?await location(org,centreNode):'';
 const determinant=reviewUtilityDistribution(def as UtilityDefinition,{},null,[]).determinant;
 const sourceIssues=(await Promise.all(sources.map(async source=>{
  const asset=source.assetTag&&ASSET.test(source.assetTag)?
   await getDoc(assetsRoot(org)+'/'+source.assetTag):null;
  if(!asset)return 'Supplying asset '+source.assetTag+' was not found. Add or reassign it.';
  if(str(asset.data.siteId)!==siteId)return 'Source asset '+source.assetTag+' is no longer in this production site.';
  if(str(asset.data.status)!=='active')return 'Source asset '+source.assetTag+
   ' must be approved and active before its utility can supply production.';
  const ratings=isObj(asset.data.utilitySupplyRatings)?asset.data.utilitySupplyRatings:{};
  const rated=ratings[str(item.code)];
  if(determinant&&(!isObj(rated)||str(rated.key)!==determinant.key||
   str(rated.unit)!==determinant.unit||!positive(rated.capacity)||
   (source.allocatedCapacity||0)>Number(rated.capacity)+1e-8))
   return 'The allocated capacity of source asset '+source.assetTag+' exceeds its current valid utility rating.';
  return '';
 }))).filter(Boolean);
 const equipment=await consumers(org,ccId,str(item.code),replace);
 const review=reviewUtilityDistribution(def as UtilityDefinition,isObj(item.values)?item.values:{},
  capacity,equipment);
 const supplyValues=isObj(item.values)?item.values:{};
 const missingRequired=(Array.isArray(def.attributes)?def.attributes.filter(isObj):[])
  .filter(attr=>attr.required===true&&attr.key!==review.determinant?.key&&
   !['current','flow','feed','power','force','mass'].includes(str(attr.key)))
  .filter(attr=>supplyValues[str(attr.key)]===undefined||
   supplyValues[str(attr.key)]===null||supplyValues[str(attr.key)]==='');
 const ready=sources.length>0&&sources.every(s=>s.assetTag&&
  (!review.determinant||s.allocatedCapacity!==null))&&
  !sourceIssues.length&&!missingRequired.length&&!review.unknown&&
  review.status!=='overload'&&review.status!=='incompatible'&&
  (!review.determinant||capacity!==null);
 return {code:str(item.code),label:str(item.label)||str(def.label),values:isObj(item.values)?item.values:{},
  sources,sourceIssues,capacity,ready,review};
}
export async function getCostCenterUtilityCapability(org:string,ccId:string,code:string,
 replace?:{workCenterId:string;values:Record<string,unknown>}){
 const [doc,defs]=await Promise.all([getDoc(path(org,ccId)),utilityDefinitions(org)]);
 const item=supplyRows(doc).find(x=>str(x.code)===code);
 const def=defs.find(x=>str(x.code)===code);
 if(!item||!def)return null;
 return capability(org,ccId,item,def,replace);
}
export async function resolveEquipmentUtilitySupply(ctx:OrgContext,workCenterId:string,code:string){
 const {equipment,costCenterId,costCenter}=await costCenterForEquipment(ctx.orgId,workCenterId);
 const [supplied,assignedAssets]=await Promise.all([
  getCostCenterUtilityCapability(ctx.orgId,costCenterId,code),
  listDocs(assetsRoot(ctx.orgId)),
 ]);
 const equipmentHasAsset=!!str(isObj(equipment.data.attributes)?equipment.data.attributes.assetTag:'')||
  assignedAssets.some(a=>str(a.data.workCenterId)===workCenterId&&
   !['removed','deleted'].includes(str(a.data.status)));
 return {costCenterId,costCenterName:str(costCenter.data.name),supply:supplied,
  equipmentHasAsset,missingUtility:!supplied,missingAsset:!!supplied&&!supplied.sources.length};
}
export async function validateEquipmentUtilityDistribution(ctx:OrgContext,
 workCenterId:string,code:string,values:Record<string,unknown>){
 const {costCenterId}=await costCenterForEquipment(ctx.orgId,workCenterId);
 const cap=await getCostCenterUtilityCapability(ctx.orgId,costCenterId,code,{workCenterId,values});
 if(!cap)throw new HttpError(409,'The supplying cost centre has not configured this utility. Add it in Cost centre → Utility supply & distribution.');
 if(!cap.sources.length)throw new HttpError(409,'The cost-centre utility has no supplying asset. Add and rate an asset in Cost centre → Utility supply.');
 if(cap.review.determinant&&(!(cap.capacity&&cap.capacity>0)||cap.review.unknown))
  throw new HttpError(409,'Cost-centre utility capacity or an equipment demand is missing. Configure the rated supply and all equipment requirements.');
 if(cap.review.status==='overload')
  throw new HttpError(409,'Combined equipment utility demand exceeds the cost-centre supply allocation ('+
   (cap.review.percentage?.toFixed(1)||'?')+'%). Increase rated capacity or revise requirements.');
 if(cap.review.status==='incompatible')
  throw new HttpError(409,'The cost-centre utility is incompatible with equipment conditions: '+
   cap.review.gaps.filter(g=>!['asset','migration'].includes(g.key))
    .slice(0,3).map(g=>g.label+': '+g.message).join('; '));
 return {costCenterId,capability:cap};
}
/** Exposes only authorized, summary-level utility capabilities for BOM process supply. */
export async function costCenterUtilityOptions(ctx:OrgContext){
 const [docs,defs]=await Promise.all([listDocs(root(ctx.orgId)),utilityDefinitions(ctx.orgId)]);
 const output=[];
 for(const d of docs){
  const cc=await getDoc(structure(ctx.orgId,d.id));
  if(!cc||str(cc.data.level)!=='cost_center'||str(cc.data.status)==='inactive')continue;
  if(!await allowedAt(ctx,['MFG.view',...PERMS.utilitiesView],d.id,'read'))continue;
  const siteId=await location(ctx.orgId,cc);
  for(const item of rows(d)){
   const def=defs.find(x=>str(x.code)===str(item.code));
   if(!def)continue;
   const cap=await capability(ctx.orgId,d.id,item,def);
   output.push({costCenterId:d.id,costCenterName:str(cc.data.name),siteId,
    code:cap.code,label:cap.label,capacity:cap.capacity,
    capacityUnit:cap.review.determinant?.unit||'',determinantKey:cap.review.determinant?.key||'',
    demand:cap.review.demand,percentage:cap.review.percentage,status:cap.review.status,
    ready:cap.ready,values:cap.values,sourceCount:cap.sources.length,unknown:cap.review.unknown});
  }
 }
 return output;
}
async function listSourceAssets(ctx:OrgContext,siteId:string,code:string){
 const all=await listDocs(assetsRoot(ctx.orgId));
 const visible=await Promise.all(all.filter(a=>str(a.data.siteId)===siteId&&
  !['removed','deleted','inactive'].includes(str(a.data.status))).map(async a=>
  await allowedAt(ctx,PERMS.utilitiesView,str(a.data.nodeId),'read')?{
   tag:a.id,name:str(a.data.name)||a.id,status:str(a.data.status),
   nodeId:str(a.data.nodeId),rating:isObj(a.data.utilitySupplyRatings)?
     a.data.utilitySupplyRatings[code]??null:null,
  }:null));
 return visible.filter(x=>x!==null);
}
export const costCenterUtilityDistributionRoutes={
 'POST /api/org/ast/cost-center-utilities/read':[
  orgRoute('org.ast.cost_center_utilities.read',null,async ctx=>{
   const id=str(ctx.body.costCenterId);
   const {node,siteId}=await centre(ctx,id,'read');
   const [saved,defs]=await Promise.all([getDoc(path(ctx.orgId,id)),utilityDefinitions(ctx.orgId)]);
   const list=await Promise.all(rows(saved).map(async item=>{
    const def=defs.find(x=>str(x.code)===str(item.code));
    return def?await capability(ctx.orgId,id,item,def):{
     code:str(item.code),label:str(item.label),values:isObj(item.values)?item.values:{},
     sources:sourceList(item),capacity:null,ready:false,review:null,legacy:true};
   }));
   return {costCenterId:id,costCenterName:str(node.data.name),siteId,revision:Number(saved?.data.version)||0,
    items:list,catalogue:defs.map(d=>({code:str(d.code),label:str(d.label),
     category:str(d.category),subcategory:str(d.subcategory),
     attributes:Array.isArray(d.attributes)?d.attributes.filter(isObj):[]})),
    assets:await listSourceAssets(ctx,siteId,''),canEdit:await allowedAt(ctx,PERMS.utilitiesEdit,id,'write')};
  }),
 ],
 'POST /api/org/ast/cost-center-utilities/asset-options':[
  orgRoute('org.ast.cost_center_utilities.asset_options',null,async ctx=>{
   const id=str(ctx.body.costCenterId),code=str(ctx.body.code);
   const {siteId}=await centre(ctx,id,'read');
   const defs=await utilityDefinitions(ctx.orgId);
   if(!defs.some(d=>str(d.code)===code))throw new HttpError(400,'Choose a utility from the adopted catalogue.');
   return {assets:await listSourceAssets(ctx,siteId,code)};
  }),
 ],
 'POST /api/org/ast/cost-center-utilities/options':[
  orgRoute('org.ast.cost_center_utilities.bom_options','MFG.view',async ctx=>({
   supplies:await costCenterUtilityOptions(ctx)
  })),
 ],
 'POST /api/org/ast/cost-center-utilities/save':[
  orgRoute('org.ast.cost_center_utilities.save',null,async ctx=>{
   const id=str(ctx.body.costCenterId);
   const {siteId}=await centre(ctx,id,'write');
   const saved=await getDoc(path(ctx.orgId,id)),version=Number(saved?.data.version)||0;
   if(Number(ctx.body.version)!==version)throw new HttpError(409,'Cost-centre utility setup has changed. Refresh to edit the current revision.');
   const submitted=ctx.body.items;
   if(!Array.isArray(submitted)||submitted.length>80)throw new HttpError(400,'Choose up to 80 cost-centre utilities.');
   const defs=await utilityDefinitions(ctx.orgId);
   // Read the global allocation revision BEFORE checking other cost centres.
   // Concurrent source allocations cannot pass against the same free capacity.
   const allocationLock=await getDoc(allocationLockPath(ctx.orgId));
   const allOther=await listDocs(root(ctx.orgId));
   const seen=new Set<string>(),next:SupplyItem[]=[];
   for(const raw of submitted){
    if(!isObj(raw))throw new HttpError(400,'Invalid utility configuration.');
    const code=str(raw.code),def=defs.find(x=>str(x.code)===code);
    if(!def)throw new HttpError(400,'Choose a utility adopted in the Safety/Asset Utility master.');
    if(seen.has(code))throw new HttpError(400,'This cost-centre utility appears twice.');
    seen.add(code);
    const determinant=reviewUtilityDistribution(def as UtilityDefinition,{},null,[]).determinant;
    const values:Record<string,string|number>={};
    for(const attr of (Array.isArray(def.attributes)?def.attributes:[]).filter(isObj)){
     if(attr.key===determinant?.key)continue;
     const val=isObj(raw.values)?raw.values[str(attr.key)]:undefined;
     if(val===undefined||val===null||val==='')continue; // Incomplete draft, shown as setup opportunity
     if(attr.type==='number'){
      const n=number(val);if(n===null)throw new HttpError(400,str(attr.label)+' must be numeric.');
      values[str(attr.key)]=n;
     }else{
      const v=str(val).trim(),options=Array.isArray(attr.options)?attr.options.map(str):[];
      if(!v||v.length>180||(attr.type==='select'&&!options.includes(v)))
       throw new HttpError(400,'Invalid '+str(attr.label)+' supply condition.');
      values[str(attr.key)]=v;
     }
    }
    const sources=Array.isArray(raw.sources)?raw.sources.filter(isObj):[];
    if(sources.length>12)throw new HttpError(400,'A utility may have up to 12 linked source assets.');
    const assetSeen=new Set<string>(),validated:Source[]=[];
    for(const src of sources){
     const tag=str(src.assetTag);
     if(!ASSET.test(tag)||assetSeen.has(tag))throw new HttpError(400,'Choose a unique registered supply asset.');
     assetSeen.add(tag);
     const asset=await getDoc(assetsRoot(ctx.orgId)+'/'+tag);
     if(!asset||str(asset.data.siteId)!==siteId||
        ['removed','deleted','inactive'].includes(str(asset.data.status)))
      throw new HttpError(400,'The supplying asset must exist and belong to the cost-centre site.');
     await requireAt(ctx,PERMS.utilitiesView,str(asset.data.nodeId),'read','You cannot use this supplying asset.');
     const rating=isObj(asset.data.utilitySupplyRatings)?asset.data.utilitySupplyRatings[code]:null;
     const rated=isObj(rating)?positive(rating.capacity):null;
     const allocated=determinant?positive(src.allocatedCapacity):null;
     if(determinant&&(!rated||!isObj(rating)||str(rating.key)!==determinant.key||
         str(rating.unit)!==determinant.unit))
      throw new HttpError(409,'Rate the '+str(def.label)+' capacity on source asset '+tag+' first, using '+determinant.unit+'.');
     if(determinant&&(!allocated||allocated>rated!+1e-8))
      throw new HttpError(400,'Allocated capacity must be positive and no greater than source asset '+tag+' rating.');
     if(determinant){
      let elsewhere=0;
      for(const other of allOther.filter(d=>d.id!==id))
       for(const row of rows(other).filter(x=>str(x.code)===code))
        for(const srcRow of Array.isArray(row.sources)?row.sources.filter(isObj):[])
         if(str(srcRow.assetTag)===tag)elsewhere+=positive(srcRow.allocatedCapacity)||0;
      if(elsewhere+allocated!>rated!+1e-8)
       throw new HttpError(409,'Asset '+tag+' is over-allocated across cost centres. Available for this cost centre: '+Math.max(0,rated!-elsewhere)+' '+determinant.unit+'.');
     }
     validated.push({assetTag:tag,allocatedCapacity:allocated});
    }
    const item:SupplyItem={code,label:str(def.label),values,sources:validated};
    const cap=await capability(ctx.orgId,id,item as unknown as Obj,def);
    if(cap.review.status==='overload')
     throw new HttpError(409,str(def.label)+': total connected equipment demand exceeds the new cost-centre allocation ('+
      (cap.review.percentage?.toFixed(1)||'?')+'%).');
    const mismatch=cap.review.gaps.filter(g=>!['asset','migration',cap.review.determinant?.key].includes(g.key));
    if(mismatch.length)
     throw new HttpError(409,str(def.label)+': '+mismatch.slice(0,3).map(g=>g.message).join('; '));
    next.push(item);
   }
   // Existing equipment loads are never silently orphaned by removing a utility.
   for(const row of rows(saved)){
    if(next.some(x=>x.code===str(row.code)))continue;
    const loads=await consumers(ctx.orgId,id,str(row.code));
    if(loads.length)throw new HttpError(409,'Utility '+str(row.label)+' is used by '+loads.length+' equipment item(s). Reassign or disconnect them first.');
   }
   const newData={items:next,version:version+1,siteId,updatedAt:nowIso(),updatedBy:ctx.uid};
   const newLock={version:Number(allocationLock?.data.version||0)+1,updatedAt:nowIso(),updatedBy:ctx.uid};
   const committed=await commitChecked([
    {path:path(ctx.orgId,id),data:newData,precondition:saved?{updateTime:saved.updateTime}:{exists:false}},
    {path:allocationLockPath(ctx.orgId),data:newLock,
     precondition:allocationLock?{updateTime:allocationLock.updateTime}:{exists:false}},
   ]);
   if(!committed)throw new HttpError(409,
    'Utility allocations changed concurrently. Refresh cost-centre supplies and review remaining asset capacity.');
   await audited(ctx,'ast.cost_center.utilities.save',id,{codes:next.map(x=>x.code),version:version+1});
   return {saved:next.length,revision:version+1};
  }),
 ],
};
