/**
 * Cost-centre-owned Production Planning SKU capacity.
 * Organization Design / Finance owns hierarchy and classification, MFG owns SKU
 * masters and units, PLN owns SKU-specific commissioned throughput at each
 * manufacturing cost centre. No equipment or AST configuration is stored here.
 */
import {HttpError,commitChecked,getDoc,isObj,listDocs,nowIso,num,str,type Doc,type Obj} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';
import {canAt,nodePath,scopeOf} from './access';
import {audit} from './audit';
import {PROCUREMENT_UNITS} from './procurementUnits';
import {skuParametersForOrg} from './mfgSkuConfiguration';
import {primaryContainerCatalogueFromAdmin} from './mfgPrimaryContainerMetadata';
import {normalizePhysicalRating,derivePhysicalCapacity,physicalRatingUnits,type PhysicalRating} from './plnPhysicalCapacity';
import type {SkuParameter,SkuComponents} from './mfgSkuModel';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/;
const ROOT=(org:string)=>'organizations/'+org+'/pln_cost_center_capacity';
const STRUCTURE=(org:string)=>'organizations/'+org+'/structure';
const SKU=(org:string)=>'organizations/'+org+'/mfg_items';
type ScopeNode={id:string;parentId:string;level:string;name:string;code:string;costType:string;status:string};
export type SkuCapacity=PhysicalRating;
const identifier=(x:unknown,label:string)=>{
 const id=str(x).trim();
 if(!ID.test(id))throw new HttpError(400,'Choose a valid '+label+'.');
 return id;
};
const live=(x:Doc)=>!['inactive','deleted','disabled'].includes(str(x.data.status).toLowerCase());
const display=(x:Doc)=>str(x.data.name)||str(x.data.code)||x.id;
const asNode=(x:Doc):ScopeNode=>({
 id:x.id,parentId:str(x.data.parentId),level:str(x.data.level),name:display(x),
 code:str(x.data.code),costType:str(isObj(x.data.attributes)?x.data.attributes.costType:''),
 status:str(x.data.status)||'active',
});
const lineage=(nodes:Map<string,ScopeNode>,id:string):ScopeNode[]=>{
 const result:ScopeNode[]=[];let current=id;
 for(let i=0;i<14&&current&&current!=='root';i++){
  const n=nodes.get(current);
  if(!n||result.some(x=>x.id===current))break;
  result.unshift(n);current=n.parentId;
 }
 return result;
};
export function isManufacturingCostType(code:string,raw:unknown){
 const items=Array.isArray(raw)?raw.filter(isObj):[];
 const match=items.find(x=>str(x.code)===code&&x.active!==false);
 if(!match)return false;
 const words=[match.code,match.name,match.label,match.description,match.category].map(str).join(' ').toLowerCase();
 return /\b(manufactur(?:e|ing)?|production|factory)\b/.test(words)||/^(mfg|manuf|prod|prd)$/i.test(code);
}
const types=async()=>{
 const d=await getDoc('module_workspaces/FIN/metadata/costCenterTypes');
 return Array.isArray(d?.data.items)?d.data.items:[];
};
export function eligibleManufacturingHierarchy(all:ScopeNode[],costTypes:unknown){
 const nodes=new Map(all.map(n=>[n.id,n])),included=new Map<string,ScopeNode>();
 const centers=all.filter(n=>n.level==='cost_center'&&n.status!=='inactive'&&isManufacturingCostType(n.costType,costTypes));
 for(const cc of centers){
  const chain=lineage(nodes,cc.id);
  if(chain.slice(-4).map(x=>x.level).join('|')==='legal_entity|site|department|cost_center'&&
    chain.every(x=>x.status!=='inactive'))for(const x of chain)included.set(x.id,x);
 }
 return {legalEntities:[...included.values()].filter(x=>x.level==='legal_entity'),
  sites:[...included.values()].filter(x=>x.level==='site'),
  departments:[...included.values()].filter(x=>x.level==='department'),
  costCenters:centers.filter(x=>included.has(x.id))};
}
export function normalizeSkuCapacity(input:unknown):SkuCapacity[]{
 if(!Array.isArray(input)||input.length<1||input.length>100)
  throw new HttpError(400,'Configure between 1 and 100 SKUs for the manufacturing cost centre.');
 const seen=new Set<string>();
 return input.map(raw=>{
  const row=normalizePhysicalRating(raw);
  if(seen.has(row.skuId))throw new HttpError(400,'An SKU may be mapped only once to a cost centre.');
  seen.add(row.skuId);
  return row;
 });
}
async function authorized(ctx:OrgContext,permission:'read'|'write',id:string){
 if(ctx.role==='org_super_admin')return true;
 const path=await nodePath(ctx.orgId,id);
 if(!path.length)return false;
 const scope=await scopeOf(ctx);
 const perms=permission==='read'?['PLN.view','ADM.structure','MFG.view']:['PLN.configure','ADM.structure'];
 return perms.some(p=>hasPerm(ctx.permissions,p)&&canAt(ctx,p,path,scope));
}
async function candidate(ctx:OrgContext,costCenterId:string){
 const path=await nodePath(ctx.orgId,costCenterId);
 if(!path.length)throw new HttpError(404,'Cost centre not found.');
 const chain=await Promise.all(path.map(id=>getDoc(STRUCTURE(ctx.orgId)+'/'+id)));
 const cc=chain[chain.length-1],levels=chain.map(d=>str(d?.data.level));
 if(!cc||!live(cc)||levels.slice(-4).join('|')!=='legal_entity|site|department|cost_center'||
   chain.some(d=>!d||!live(d)))throw new HttpError(400,'Choose an active manufacturing cost centre in a complete organization hierarchy.');
 const costType=str(isObj(cc.data.attributes)?cc.data.attributes.costType:'');
 if(!isManufacturingCostType(costType,await types()))
  throw new HttpError(400,'This cost centre is not classified as Manufacturing.');
 const site=chain.find(d=>str(d?.data.level)==='site')!,le=chain.find(d=>str(d?.data.level)==='legal_entity')!;
 return {costCenterId,siteId:site.id,legalEntityId:le.id,name:display(cc),code:str(cc.data.code)};
}
type OutputSku={id:string;name:string;uom:string;siteId:string;category:string;
 status:string;skuComponents:SkuComponents;revision:number};
const asOutput=(item:Doc):OutputSku=>({
 id:item.id,name:display(item),uom:str(item.data.uom),
 siteId:str(item.data.siteId),category:str(item.data.category),status:str(item.data.status),
 skuComponents:(isObj(item.data.skuComponents)?item.data.skuComponents:{}) as SkuComponents,
 revision:num(item.data.revision)??1,
});
const skuForSite=async(ctx:OrgContext,skuId:string,siteId:string)=>{
 const item=await getDoc(SKU(ctx.orgId)+'/'+skuId);
 if(!item||!['FINISHED','INTERMEDIATE'].includes(str(item.data.category)))
  throw new HttpError(400,'Choose an existing finished or intermediate manufactured SKU.');
 if(str(item.data.siteId)&&str(item.data.siteId)!==siteId)
  throw new HttpError(400,'The SKU is not available at this cost centre site.');
 return asOutput(item);
};
async function validatedLine(ctx:OrgContext,siteId:string,raw:unknown,params:SkuParameter[]){
 const line=normalizePhysicalRating(raw);
 const sku=await skuForSite(ctx,line.skuId,siteId);
 const projection=derivePhysicalCapacity(sku,params,line);
 return {...line,skuName:sku.name,skuRevision:sku.revision,projection};
}
async function validatedLines(ctx:OrgContext,siteId:string,raw:unknown){
 const inputs=normalizeSkuCapacity(raw),params=await skuParametersForOrg(ctx.orgId);
 const output=[];
 for(const [i,line] of inputs.entries()){
  try{
   output.push(await validatedLine(ctx,siteId,line,params));
  }catch(e){
   // Identify the precise SKU when a container, production-form or packaging
   // relationship blocks saving a multi-SKU cost-centre configuration.
   const detail=e instanceof Error?e.message:'Unable to validate this SKU rating.';
   if(e instanceof HttpError)throw new HttpError(e.status, 'SKU '+(i+1)+' ('+line.skuId+'): '+detail);
   throw e;
  }
 }
 return output;
}
const validSavedProjection=async(ctx:OrgContext,siteId:string,raw:unknown,params:SkuParameter[])=>{
 try{
  if(!isObj(raw))throw new Error('Malformed rating entry');
  const line=normalizePhysicalRating(raw);
  const sku=await skuForSite(ctx,line.skuId,siteId);
  return {...line,skuName:sku.name,skuRevision:sku.revision,
    projection:derivePhysicalCapacity(sku,params,line)};
 }catch(e){
  // Older SKU-UOM/hour ratings cannot be silently reinterpreted as
  // physical-container counts. Preserve them visibly for explicit correction.
  const kept=isObj(raw)?raw:{};
  return {...kept,projection:null,conversionIssue:
    e instanceof Error?e.message:'Configure the physical container rating basis.'};
 }
};
const expose=(row:Doc)=>({
 costCenterId:row.id,siteId:str(row.data.siteId),legalEntityId:str(row.data.legalEntityId),
 skuCapacities:Array.isArray(row.data.skuCapacities)?row.data.skuCapacities:[],
 revision:num(row.data.revision)??0,updatedAt:str(row.data.updatedAt),
});
const auditChange=(ctx:OrgContext,action:string,id:string)=>audit([{
 category:'data',action,orgId:ctx.orgId,actor:ctx.actor,meta:ctx.meta,target:{label:id},
 details:'Manufacturing cost-centre SKU/commissioned capacity; no equipment, asset or inventory write',
}]);

/** Read-only, site- and scope-checked references for MFG routing stages.
 * The manufacturing cost-centre master remains authoritative for SKU speed. */
export async function routingManufacturingCostCenter(ctx:OrgContext,costCenterId:string,siteId:string){
 const id=identifier(costCenterId,'routing manufacturing cost centre');
 if(!await authorized(ctx,'read',id))
  throw new HttpError(403,'Routing cost centre is outside your authorized manufacturing scope.');
 const location=await candidate(ctx,id);
 if(!siteId||location.siteId!==siteId)
  throw new HttpError(400,'Routing cost centre must belong to the routing production site.');
 return location;
}
export async function routingCommissionedCapacity(
 ctx:OrgContext,costCenterId:string,siteId:string,skuId:string,
){
 const location=await routingManufacturingCostCenter(ctx,costCenterId,siteId);
 const record=await getDoc(ROOT(ctx.orgId)+'/'+costCenterId);
 const source=(Array.isArray(record?.data.skuCapacities)?record.data.skuCapacities:[])
  .find(row=>isObj(row)&&str(row.skuId)===skuId);
 if(!source)return {location,rating:null,revision:num(record?.data.revision)??0};
 const params=await skuParametersForOrg(ctx.orgId);
 const rating=await validSavedProjection(ctx,siteId,source,params);
 return {location,rating,revision:num(record?.data.revision)??0};
}

export const plnCostCenterCapacityRoutes={
 'POST /api/org/pln/cost-center/eligibility':[
  orgRoute('org.pln.cost_center.eligibility',null,async ctx=>{
   const id=identifier(ctx.body.costCenterId,'cost centre');
   if(!await authorized(ctx,'read',id))
    throw new HttpError(403,'Cost centre is outside your planning or organization scope.');
   const cc=await getDoc(STRUCTURE(ctx.orgId)+'/'+id);
   if(!cc||str(cc.data.level)!=='cost_center'||!live(cc))
    return {manufacturing:false};
   const costType=str(isObj(cc.data.attributes)?cc.data.attributes.costType:'');
   return {manufacturing:isManufacturingCostType(costType,await types())};
  }),
 ],
 'POST /api/org/pln/cost-center/hierarchy':[
  orgRoute('org.pln.cost_center.hierarchy',null,async ctx=>{
   if(!hasPerm(ctx.permissions,'PLN.view')&&!hasPerm(ctx.permissions,'ADM.structure')&&ctx.role!=='org_super_admin')
    throw new HttpError(403,'Planning or organization-design viewing permission required.');
   const [raw,costTypes,records,allSku]=await Promise.all([
    listDocs(STRUCTURE(ctx.orgId)),types(),listDocs(ROOT(ctx.orgId)),listDocs(SKU(ctx.orgId)),
   ]);
   const allNodes=raw.filter(live).map(asNode);
   const index=new Map(allNodes.map(n=>[n.id,n]));
   const included=new Set<string>();
   for(const n of allNodes){
    if(n.level!=='cost_center'||!isManufacturingCostType(n.costType,costTypes)||
       !await authorized(ctx,'read',n.id))continue;
    for(const ancestor of lineage(index,n.id))included.add(ancestor.id);
   }
   const result=eligibleManufacturingHierarchy(allNodes.filter(n=>included.has(n.id)),costTypes);
   const centerIds=new Set(result.costCenters.map(n=>n.id));
   const siteIds=new Set(result.sites.map(n=>n.id));
   const outputs=allSku.filter(d=>['FINISHED','INTERMEDIATE'].includes(str(d.data.category))&&
      (!str(d.data.siteId)||siteIds.has(str(d.data.siteId))))
    .map(d=>({id:d.id,name:display(d),siteId:str(d.data.siteId),uom:str(d.data.uom),
       category:str(d.data.category),status:str(d.data.status)}));
   return {...result,outputs,mappings:records.filter(d=>centerIds.has(d.id)).map(expose)};
  }),
 ],
 'POST /api/org/pln/cost-center/get':[
  orgRoute('org.pln.cost_center.get',null,async ctx=>{
   const id=identifier(ctx.body.costCenterId,'cost centre');
   if(!await authorized(ctx,'read',id))throw new HttpError(403,'Cost centre is outside your planning or organization scope.');
   const location=await candidate(ctx,id);
   const [rows,params,metadata,saved]=await Promise.all([
    listDocs(SKU(ctx.orgId)),skuParametersForOrg(ctx.orgId),
    getDoc('module_workspaces/MFG/metadata/primaryContainers'),getDoc(ROOT(ctx.orgId)+'/'+id),
   ]);
   const outputs=rows.filter(d=>['FINISHED','INTERMEDIATE'].includes(str(d.data.category))&&
      (!str(d.data.siteId)||str(d.data.siteId)===location.siteId)).map(asOutput);
   const catalogue=primaryContainerCatalogueFromAdmin(metadata?.data.items);
   const byMetadata=new Map(catalogue.map(t=>[t.code,t]));
   const containers=params.filter(x=>x.kind==='containers'&&x.enabled!==false).map(x=>{
    const type=byMetadata.get(str(x.metadataCode));
    return {id:x.id,name:x.name,categoryCode:x.categoryCode,subcategoryCode:x.subcategoryCode,
     categoryName:type?.category||str(x.categoryCode),subcategoryName:type?.subcategory||x.name,
     containerAttributes:x.containerAttributes||{},metadataCode:x.metadataCode,
     ratingCountUnitCode:str(x.ratingCountUnitCode)||'UOM-20-001',
     ratingOutputCode:str(x.ratingOutputCode)||'PRIMARY_CONTAINER'};
   });
   const sizes=params.filter(x=>x.kind==='containerSizes'&&x.enabled!==false)
      .map(x=>({id:x.id,name:x.name,quantity:x.quantity,uom:x.uom,
       uomSymbol:PROCUREMENT_UNITS.find(u=>u.code===x.uom)?.symbol||str(x.uom)}));
   const ratings=saved?await Promise.all(
      (Array.isArray(saved.data.skuCapacities)?saved.data.skuCapacities:[])
       .map(line=>validSavedProjection(ctx,location.siteId,line,params))):[];
   return {location,outputs,containers,sizes,units:physicalRatingUnits(),
    mapping:saved?{...expose(saved),skuCapacities:ratings}:null,
    canConfigure:await authorized(ctx,'write',id)};
  }),
 ],
 'POST /api/org/pln/cost-center/sku-mappings':[
  orgRoute('org.pln.cost_center.sku_mappings',null,async ctx=>{
   // The SKU detail is readable by manufacturing viewers. Filter *each* cost
   // centre by its own hierarchy scope before returning any mapping or speed.
   if(ctx.role!=='org_super_admin'&&
      !['MFG.view','PLN.view','ADM.structure'].some(p=>hasPerm(ctx.permissions,p)))
    throw new HttpError(403,'Manufacturing or planning viewing permission required.');
   const skuId=identifier(ctx.body.skuId,'manufactured SKU');
   const skuDoc=await getDoc(SKU(ctx.orgId)+'/'+skuId);
   if(!skuDoc||!live(skuDoc)||!['FINISHED','INTERMEDIATE'].includes(str(skuDoc.data.category)))
    throw new HttpError(404,'Finished or intermediate manufactured SKU not available.');
   const sku=asOutput(skuDoc);
   const [saved,params]=await Promise.all([listDocs(ROOT(ctx.orgId)),skuParametersForOrg(ctx.orgId)]);
   const units=physicalRatingUnits();
   const costCenters:Array<Record<string,unknown>>=[];
   for(const record of saved){
    const row=(Array.isArray(record.data.skuCapacities)?record.data.skuCapacities:[])
      .find(x=>isObj(x)&&str(x.skuId)===skuId);
    if(!row||!await authorized(ctx,'read',record.id))continue;
    let location:Awaited<ReturnType<typeof candidate>>;
    try{location=await candidate(ctx,record.id);}
    catch(e){
     if(e instanceof HttpError&&[400,404].includes(e.status))continue;
     throw e;
    }
    if(sku.siteId&&sku.siteId!==location.siteId)continue;
    const [site,legalEntity,rating]=await Promise.all([
     getDoc(STRUCTURE(ctx.orgId)+'/'+location.siteId),
     getDoc(STRUCTURE(ctx.orgId)+'/'+location.legalEntityId),
     validSavedProjection(ctx,location.siteId,row,params),
    ]);
    const fields=rating as Record<string,unknown>;
    const count=units.count.find(u=>u.code===str(fields.ratingUnitCode));
    const period=units.time.find(u=>u.code===str(fields.periodUnitCode));
    costCenters.push({
     costCenterId:location.costCenterId,costCenterName:location.name,
     costCenterCode:location.code,siteId:location.siteId,siteName:site?display(site):location.siteId,
     legalEntityId:location.legalEntityId,legalEntityName:legalEntity?display(legalEntity):location.legalEntityId,
     revision:num(record.data.revision)??0,updatedAt:str(record.data.updatedAt),
     countUnit:count?{name:count.name,symbol:count.symbol,multiplier:count.multiplier}:null,
     periodUnit:period?{name:period.name,symbol:period.symbol}:null,rating,
    });
   }
   costCenters.sort((a,b)=>String(a.legalEntityName).localeCompare(String(b.legalEntityName))||
    String(a.siteName).localeCompare(String(b.siteName))||
    String(a.costCenterName).localeCompare(String(b.costCenterName)));
   return {skuId,skuName:sku.name,costCenters};
  }),
 ],
 'POST /api/org/pln/cost-center/rating':[
  orgRoute('org.pln.cost_center.rating',null,async ctx=>{
   const id=identifier(ctx.body.costCenterId,'manufacturing cost centre');
   const skuId=identifier(ctx.body.skuId,'manufactured SKU');
   if(!await authorized(ctx,'read',id))
    throw new HttpError(403,'This cost centre is outside your authorized scope.');
   const location=await candidate(ctx,id);
   const saved=await getDoc(ROOT(ctx.orgId)+'/'+id);
   if(!saved)throw new HttpError(404,'No commissioned capacity is configured for this cost centre.');
   const source=(Array.isArray(saved.data.skuCapacities)?saved.data.skuCapacities:[])
     .find(x=>isObj(x)&&str(x.skuId)===skuId);
   if(!source)throw new HttpError(404,'This SKU is not commissioned for the selected cost centre.');
   const params=await skuParametersForOrg(ctx.orgId);
   const rating=await validSavedProjection(ctx,location.siteId,source,params);
   if(rating.projection===null)
    throw new HttpError(409,'This rating requires updated physical-container configuration before planning.');
   return {costCenterId:id,skuId,revision:num(saved.data.revision)??0,rating};
  }),
 ],
 'POST /api/org/pln/cost-center/preview':[
  orgRoute('org.pln.cost_center.preview',null,async ctx=>{
   const id=identifier(ctx.body.costCenterId,'manufacturing cost centre');
   if(!await authorized(ctx,'read',id))
    throw new HttpError(403,'This cost centre is outside your authorized scope.');
   const location=await candidate(ctx,id);
   const params=await skuParametersForOrg(ctx.orgId);
   return {line:await validatedLine(ctx,location.siteId,ctx.body.rating,params)};
  }),
 ],
 'POST /api/org/pln/cost-center/save':[
  orgRoute('org.pln.cost_center.save',null,async ctx=>{
   const id=identifier(ctx.body.costCenterId,'manufacturing cost centre');
   if(!await authorized(ctx,'write',id))
    throw new HttpError(403,'You do not have permission to configure this manufacturing cost centre.');
   const location=await candidate(ctx,id);
   const skuCapacities=await validatedLines(ctx,location.siteId,ctx.body.skuCapacities);
   const path=ROOT(ctx.orgId)+'/'+id,old=await getDoc(path);
   const revision=num(old?.data.revision)??0;
   if(Number(ctx.body.expectedRevision)!==revision)
    throw new HttpError(409,'Cost-centre SKU configuration changed. Reload before saving.');
   const at=nowIso();
   const data:Obj={costCenterId:id,siteId:location.siteId,legalEntityId:location.legalEntityId,
    skuCapacities,revision:revision+1,
    createdAt:old?str(old.data.createdAt):at,createdBy:old?str(old.data.createdBy):ctx.uid,
    updatedAt:at,updatedBy:ctx.uid};
   if(!await commitChecked([{path,data,precondition:old?{updateTime:old.updateTime}:{exists:false}}]))
    throw new HttpError(409,'Another user updated this cost-centre SKU configuration. Reload.');
   await auditChange(ctx,'pln.cost_center.sku_capacity.save',id);
   return {mapping:{...data}};
  }),
 ],
 'POST /api/org/pln/cost-center/clear':[
  orgRoute('org.pln.cost_center.clear',null,async ctx=>{
   const id=identifier(ctx.body.costCenterId,'manufacturing cost centre');
   if(!await authorized(ctx,'write',id))throw new HttpError(403,'Cost centre is outside your configuration scope.');
   const path=ROOT(ctx.orgId)+'/'+id,old=await getDoc(path);
   if(!old)throw new HttpError(404,'No SKU mapping exists for this cost centre.');
   const revision=num(old.data.revision)??0;
   if(Number(ctx.body.expectedRevision)!==revision)throw new HttpError(409,'Mapping changed. Reload.');
   const data={...old.data,skuCapacities:[],revision:revision+1,
     updatedAt:nowIso(),updatedBy:ctx.uid};
   if(!await commitChecked([{path,data,precondition:{updateTime:old.updateTime}}]))
    throw new HttpError(409,'Mapping changed during the reset.');
   await auditChange(ctx,'pln.cost_center.sku_capacity.clear',id);
   return {mapping:data};
  }),
 ],
};
