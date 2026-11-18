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

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/;
const ROOT=(org:string)=>'organizations/'+org+'/pln_cost_center_capacity';
const STRUCTURE=(org:string)=>'organizations/'+org+'/structure';
const SKU=(org:string)=>'organizations/'+org+'/mfg_items';
type ScopeNode={id:string;parentId:string;level:string;name:string;code:string;costType:string;status:string};
export type SkuCapacity={skuId:string;commissionedRatePerHour:number;rateUom:string};
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
  if(!isObj(raw))throw new HttpError(400,'Invalid SKU capacity configuration.');
  const skuId=identifier(raw.skuId,'manufactured SKU');
  if(seen.has(skuId))throw new HttpError(400,'An SKU may be mapped only once to a cost centre.');
  seen.add(skuId);
  const commissionedRatePerHour=Number(raw.commissionedRatePerHour);
  if(!Number.isFinite(commissionedRatePerHour)||commissionedRatePerHour<=0||commissionedRatePerHour>1e12)
   throw new HttpError(400,'Commissioned throughput must be a positive quantity per hour.');
  const rateUom=str(raw.rateUom);
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,19}$/.test(rateUom))
   throw new HttpError(400,'Use the SKU output unit for commissioned throughput.');
  return {skuId,commissionedRatePerHour,rateUom};
 });
}
async function authorized(ctx:OrgContext,permission:'read'|'write',id:string){
 if(ctx.role==='org_super_admin')return true;
 const path=await nodePath(ctx.orgId,id);
 if(!path.length)return false;
 const scope=await scopeOf(ctx);
 const perms=permission==='read'?['PLN.view','ADM.structure']:['PLN.configure','ADM.structure'];
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
async function validatedLines(ctx:OrgContext,siteId:string,raw:unknown){
 const lines=normalizeSkuCapacity(raw);
 const output=[];
 for(const row of lines){
  const item=await getDoc(SKU(ctx.orgId)+'/'+row.skuId);
  if(!item||!['FINISHED','INTERMEDIATE'].includes(str(item.data.category)))
   throw new HttpError(400,'Choose an existing finished or intermediate manufacturing SKU.');
  if(str(item.data.siteId)&&str(item.data.siteId)!==siteId)
   throw new HttpError(400,'The SKU is not available at the cost centre site.');
  if(str(item.data.uom)!==row.rateUom)
   throw new HttpError(400,'Commissioned throughput must use the SKU material-master unit.');
  output.push({...row,skuName:display(item)});
 }
 return output;
}
const expose=(row:Doc)=>({
 costCenterId:row.id,siteId:str(row.data.siteId),legalEntityId:str(row.data.legalEntityId),
 skuCapacities:Array.isArray(row.data.skuCapacities)?row.data.skuCapacities:[],
 revision:num(row.data.revision)??0,updatedAt:str(row.data.updatedAt),
});
const auditChange=(ctx:OrgContext,action:string,id:string)=>audit([{
 category:'data',action,orgId:ctx.orgId,actor:ctx.actor,meta:ctx.meta,target:{label:id},
 details:'Manufacturing cost-centre SKU/commissioned capacity; no equipment, asset or inventory write',
}]);

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
   const rows=await listDocs(SKU(ctx.orgId));
   const outputs=rows.filter(d=>['FINISHED','INTERMEDIATE'].includes(str(d.data.category))&&
      (!str(d.data.siteId)||str(d.data.siteId)===location.siteId))
    .map(d=>({id:d.id,name:display(d),siteId:str(d.data.siteId),uom:str(d.data.uom),
      category:str(d.data.category),status:str(d.data.status)}));
   const saved=await getDoc(ROOT(ctx.orgId)+'/'+id);
   return {location,outputs,mapping:saved?expose(saved):null,canConfigure:await authorized(ctx,'write',id)};
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
