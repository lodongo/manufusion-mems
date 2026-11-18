/**
 * PLN equipment and SKU commissioned throughput setup.
 * An exclusive, cost-centre-keyed planning record links one equipment unit to
 * many output SKUs. The AST equipment/asset registry remains the source of truth.
 * No asset, inventory, production or financial record is modified here.
 */
import {HttpError,commitChecked,getDoc,isObj,listDocs,nowIso,num,str,type Doc,type Obj} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';
import {canAt,nodePath,scopeOf} from './access';
import {audit} from './audit';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/;
const P=(org:string)=>'organizations/'+org+'/pln_equipment_capacity';
const nodePathDoc=(org:string,id:string)=>'organizations/'+org+'/structure/'+id;
const assetDoc=(org:string,id:string)=>'organizations/'+org+'/assets/'+id;
const skuDoc=(org:string,id:string)=>'organizations/'+org+'/mfg_items/'+id;
const name=(d:Doc)=>str(d.data.name)||str(d.data.code)||d.id;
const checkId=(x:unknown,label:string)=>{
 const id=str(x).trim();if(!ID.test(id))throw new HttpError(400,'Choose a valid '+label+'.');return id;
};
const isActive=(d:Doc)=>!['inactive','disabled','deleted'].includes(str(d.data.status).toLowerCase());
export type CapacityLine={skuId:string;commissionedRatePerHour:number;rateUom:string};
export function normalizeCapacityLines(input:unknown):CapacityLine[]{
 if(!Array.isArray(input)||input.length<1||input.length>100)
  throw new HttpError(400,'Select between 1 and 100 output SKUs for the equipment.');
 const codes=new Set<string>();
 return input.map(x=>{
  if(!isObj(x))throw new HttpError(400,'Invalid SKU throughput line.');
  const skuId=checkId(x.skuId,'output SKU');
  if(codes.has(skuId))throw new HttpError(400,'Each SKU can be configured once per equipment.');
  codes.add(skuId);
  const rate=Number(x.commissionedRatePerHour);
  if(!Number.isFinite(rate)||rate<=0||rate>1e12)
   throw new HttpError(400,'Commissioned throughput must be greater than zero per hour.');
  const rateUom=str(x.rateUom).trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,19}$/.test(rateUom))
   throw new HttpError(400,'Rate unit must match the output material unit.');
  return {skuId,commissionedRatePerHour:rate,rateUom};
 });
}
/** Cost centre classification comes from Finance's adopted metadata, not guesses from names. */
export function isManufacturingCostType(code:string,catalogue:unknown):boolean{
 const items=Array.isArray(catalogue)?catalogue.filter(isObj):[];
 const match=items.find(x=>str(x.code)===code&&x.active!==false);
 if(!match)return false;
 const fields=[match.name,match.label,match.description,match.category,match.code].map(str).join(' ').toLowerCase();
 return /\b(manufactur(?:e|ing)?|production|factory)\b/.test(fields)||/^(mfg|manuf|prod|prd)$/i.test(code);
}
const typeCatalogue=async()=>{
 const catalog=await getDoc('module_workspaces/FIN/metadata/costCenterTypes');
 return Array.isArray(catalog?.data.items)?catalog.data.items:[];
};
const view=async(ctx:OrgContext,nodeId:string)=>{
 if(ctx.role==='org_super_admin')return true;
 const path=await nodePath(ctx.orgId,nodeId),scope=await scopeOf(ctx);
 return path.length>0&&canAt(ctx,'PLN.view',path,scope);
};
const edit=async(ctx:OrgContext,nodeId:string)=>{
 if(ctx.role==='org_super_admin')return true;
 if(!hasPerm(ctx.permissions,'PLN.configure'))return false;
 const path=await nodePath(ctx.orgId,nodeId),scope=await scopeOf(ctx);
 return path.length>0&&canAt(ctx,'PLN.configure',path,scope);
};
type Node={id:string;parentId:string;level:string;code:string;name:string;costType:string;status:string;};
const asNode=(d:Doc):Node=>({
 id:d.id,parentId:str(d.data.parentId),level:str(d.data.level),
 code:str(d.data.code),name:name(d),
 costType:str(isObj(d.data.attributes)?d.data.attributes.costType:''),
 status:str(d.data.status)||'active',
});
const lineage=(nodes:Map<string,Node>,id:string)=>{
 const result:Node[]=[];let current=id;
 for(let n=0;n<12&&current&&current!=='root';n++){
  const value=nodes.get(current);
  if(!value||result.some(x=>x.id===current))break;
  result.unshift(value);current=value.parentId;
 }
 return result;
};
export function eligibleManufacturingHierarchy(all:Node[],catalogue:unknown):{
 legalEntities:Node[];sites:Node[];departments:Node[];costCenters:Node[];
}{
 const nodes=new Map(all.map(n=>[n.id,n]));const eligible=new Map<string,Node>();
 const costCenters=all.filter(n=>n.level==='cost_center'&&n.status!=='inactive'&&
   isManufacturingCostType(n.costType,catalogue));
 for(const cc of costCenters){
  const chain=lineage(nodes,cc.id);
  const correct=chain.slice(-4).map(x=>x.level).join('|')==='legal_entity|site|department|cost_center';
  if(correct&&chain.every(n=>n.status!=='inactive'))chain.forEach(n=>eligible.set(n.id,n));
 }
 return {
  legalEntities:[...eligible.values()].filter(n=>n.level==='legal_entity'),
  sites:[...eligible.values()].filter(n=>n.level==='site'),
  departments:[...eligible.values()].filter(n=>n.level==='department'),
  costCenters:costCenters.filter(n=>eligible.has(n.id)),
 };
}
async function validateCandidate(ctx:OrgContext,costCenterId:string,unitId:string){
 const cc=await getDoc(nodePathDoc(ctx.orgId,costCenterId));
 if(!cc||str(cc.data.level)!=='cost_center'||!isActive(cc))
  throw new HttpError(400,'Choose an active cost centre.');
 const types=await typeCatalogue();
 const attrs=isObj(cc.data.attributes)?cc.data.attributes:{};
 if(!isManufacturingCostType(str(attrs.costType),types))
  throw new HttpError(400,'Cost centre type must be Manufacturing.');
 const unit=await getDoc(nodePathDoc(ctx.orgId,unitId));
 if(!unit||str(unit.data.level)!=='work_center'||!isActive(unit)||
    str(unit.data.parentId)!==costCenterId)
  throw new HttpError(400,'Choose an active equipment unit under this manufacturing cost centre.');
 const unitAttrs=isObj(unit.data.attributes)?unit.data.attributes:{};
 const assetTag=str(unitAttrs.assetTag);
 if(!assetTag)throw new HttpError(409,'First link the equipment unit to an Asset Register record.');
 const asset=await getDoc(assetDoc(ctx.orgId,assetTag));
 if(!asset||str(asset.data.status)!=='active'||str(asset.data.workCenterId)!==unitId)
  throw new HttpError(409,'The equipment must have an approved, active and correctly linked asset.');
 const parents=await nodePath(ctx.orgId,costCenterId);
 const hierarchy=await Promise.all(parents.map(id=>getDoc(nodePathDoc(ctx.orgId,id))));
 const site=hierarchy.find(n=>str(n?.data.level)==='site');
 const le=hierarchy.find(n=>str(n?.data.level)==='legal_entity');
 if(!site||!le||str(asset.data.siteId)!==site.id)
  throw new HttpError(409,'The asset, equipment and cost centre must belong to the same site.');
 return {cc,unit,asset,assetTag,siteId:site.id,legalEntityId:le.id};
}
const validateSkus=async(org:string,siteId:string,lines:CapacityLine[])=>{
 const output=[];
 for(const row of lines){
  const sku=await getDoc(skuDoc(org,row.skuId));
  if(!sku||!['FINISHED','INTERMEDIATE'].includes(str(sku.data.category)))
   throw new HttpError(400,'Choose an existing manufactured output SKU.');
  if(str(sku.data.siteId)&&str(sku.data.siteId)!==siteId)
   throw new HttpError(400,'The selected SKU does not belong to this production site.');
  if(str(sku.data.uom)!==row.rateUom)
   throw new HttpError(400,'Commissioned throughput unit must equal the SKU master unit.');
  output.push({...row,skuName:name(sku),skuStatus:str(sku.data.status)});
 }
 return output;
};
const mapOut=(d:Doc)=>({
 costCenterId:d.id,unitId:str(d.data.unitId),assetTag:str(d.data.assetTag),
 siteId:str(d.data.siteId),legalEntityId:str(d.data.legalEntityId),
 skuCapacities:Array.isArray(d.data.skuCapacities)?d.data.skuCapacities:[],
 revision:num(d.data.revision)??0,updatedAt:str(d.data.updatedAt),
});
const log=(ctx:OrgContext,verb:string,id:string)=>audit([{
 category:'data',action:verb,orgId:ctx.orgId,actor:ctx.actor,meta:ctx.meta,target:{label:id},
 details:'Planning equipment/SKU commissioned throughput, without changing Asset Register or posting stock',
}]);

export const plnEquipmentCapacityRoutes={
 'POST /api/org/pln/equipment/hierarchy':[
  orgRoute('org.pln.equipment.hierarchy','PLN.view',async ctx=>{
   const [all,types,assets,existing,skus]=await Promise.all([
    listDocs('organizations/'+ctx.orgId+'/structure'),typeCatalogue(),
    listDocs('organizations/'+ctx.orgId+'/assets'),listDocs(P(ctx.orgId)),
    listDocs('organizations/'+ctx.orgId+'/mfg_items'),
   ]);
   const visible:Node[]=[];
   for(const d of all)if(isActive(d)&&await view(ctx,d.id))visible.push(asNode(d));
   const found=eligibleManufacturingHierarchy(visible,types);
   const ccIds=new Set(found.costCenters.map(n=>n.id));
   const assetById=new Map(assets.map(a=>[a.id,a]));
   const equipment=visible.filter(n=>n.level==='work_center'&&ccIds.has(n.parentId)).map(n=>{
    const doc=all.find(d=>d.id===n.id);
    const attrs=isObj(doc?.data.attributes)?doc.data.attributes:{};
    const assetTag=str(attrs.assetTag),asset=assetById.get(assetTag);
    const eligible=Boolean(assetTag&&asset&&str(asset.data.status)==='active'&&
       str(asset.data.workCenterId)===n.id);
    return {id:n.id,parentId:n.parentId,code:n.code,name:n.name,assetTag,
       assetName:asset?name(asset):'',eligible};
   });
   const siteIds=new Set(found.sites.map(n=>n.id));
   const outputs=skus.filter(x=>['FINISHED','INTERMEDIATE'].includes(str(x.data.category))&&
      (!str(x.data.siteId)||siteIds.has(str(x.data.siteId))))
    .map(x=>({id:x.id,name:name(x),siteId:str(x.data.siteId),uom:str(x.data.uom),
      category:str(x.data.category),status:str(x.data.status)}));
   return {...found,equipment,outputs,
    mappings:existing.filter(x=>ccIds.has(x.id)).map(mapOut)};
  }),
 ],
 'POST /api/org/pln/equipment/save':[
  orgRoute('org.pln.equipment.save','PLN.configure',async ctx=>{
   const costCenterId=checkId(ctx.body.costCenterId,'manufacturing cost centre');
   const unitId=checkId(ctx.body.unitId,'equipment unit');
   if(!await edit(ctx,costCenterId))
    throw new HttpError(403,'You cannot configure planning equipment at this cost centre.');
   const location=await validateCandidate(ctx,costCenterId,unitId);
   const skuCapacities=await validateSkus(ctx.orgId,location.siteId,
     normalizeCapacityLines(ctx.body.skuCapacities));
   const path=P(ctx.orgId)+'/'+costCenterId,old=await getDoc(path);
   const revision=num(old?.data.revision)??0;
   if(Number(ctx.body.expectedRevision)!==revision)
    throw new HttpError(409,'The cost centre planning assignment changed. Reload before saving.');
   const now=nowIso(),data:Obj={
    costCenterId,unitId,assetTag:location.assetTag,siteId:location.siteId,
    legalEntityId:location.legalEntityId,skuCapacities,revision:revision+1,
    updatedBy:ctx.uid,updatedAt:now,createdAt:old?str(old.data.createdAt):now,
    createdBy:old?str(old.data.createdBy):ctx.uid,
   };
   if(!await commitChecked([{path,data,precondition:old?{updateTime:old.updateTime}:{exists:false}}]))
    throw new HttpError(409,'A different equipment mapping was saved for this cost centre. Refresh.');
   await log(ctx,'pln.equipment.capacity.save',costCenterId);
   return {mapping:{...data},exclusiveCostCenter:true};
  }),
 ],
 'POST /api/org/pln/equipment/clear':[
  orgRoute('org.pln.equipment.clear','PLN.configure',async ctx=>{
   const costCenterId=checkId(ctx.body.costCenterId,'cost centre');
   if(!await edit(ctx,costCenterId))
    throw new HttpError(403,'You cannot change this cost centre.');
   const path=P(ctx.orgId)+'/'+costCenterId,old=await getDoc(path);
   if(!old)throw new HttpError(404,'There is no planning assignment for this cost centre.');
   const revision=num(old.data.revision)??0;
   if(Number(ctx.body.expectedRevision)!==revision)
    throw new HttpError(409,'Planning mapping changed. Refresh.');
   // Retain revision trail; disabling makes equipment invisible to capacity planning.
   const data={...old.data,unitId:'',assetTag:'',skuCapacities:[],revision:revision+1,
     updatedAt:nowIso(),updatedBy:ctx.uid,disabledAt:nowIso()};
   if(!await commitChecked([{path,data,precondition:{updateTime:old.updateTime}}]))
    throw new HttpError(409,'Another user changed this planning assignment.');
   await log(ctx,'pln.equipment.capacity.clear',costCenterId);
   return {mapping:data};
  }),
 ],
 'POST /api/org/pln/equipment/asset-view':[
  orgRoute('org.pln.equipment.asset.view',null,async ctx=>{
   if(!hasPerm(ctx.permissions,'AST.view')&&!hasPerm(ctx.permissions,'PLN.view')&&ctx.role!=='org_super_admin')
    throw new HttpError(403,'Asset or Production Planning viewing permission required.');
   const assetTag=checkId(ctx.body.assetTag,'asset');
   const asset=await getDoc(assetDoc(ctx.orgId,assetTag));
   if(!asset)throw new HttpError(404,'Asset not found.');
   const unitId=str(asset.data.workCenterId);
   if(!unitId)return {configured:false,lines:[]};
   const unit=await getDoc(nodePathDoc(ctx.orgId,unitId));
   if(!unit||str(unit.data.level)!=='work_center')
    return {configured:false,lines:[]};
   const ccId=str(unit.data.parentId);
   if(ctx.role!=='org_super_admin'){
    const scope=await scopeOf(ctx),path=await nodePath(ctx.orgId,unitId);
    if(!path.length||!(canAt(ctx,'AST.view',path,scope)||canAt(ctx,'PLN.view',path,scope)))
     throw new HttpError(403,'Equipment is outside your authorized scope.');
   }
   const map=await getDoc(P(ctx.orgId)+'/'+ccId);
   if(!map||str(map.data.unitId)!==unitId||str(map.data.assetTag)!==assetTag)
    return {configured:false,lines:[]};
   const skus=[];
   for(const line of Array.isArray(map.data.skuCapacities)?map.data.skuCapacities:[]){
    if(!isObj(line))continue;
    const sku=await getDoc(skuDoc(ctx.orgId,str(line.skuId)));
    skus.push({skuId:str(line.skuId),skuName:sku?name(sku):str(line.skuName)||str(line.skuId),
      commissionedRatePerHour:num(line.commissionedRatePerHour)??0,rateUom:str(line.rateUom)});
   }
   return {configured:true,costCenterId:ccId,unitId,assetTag,lines:skus,
      revision:num(map.data.revision)??0,updatedAt:str(map.data.updatedAt)};
  }),
 ],
};
