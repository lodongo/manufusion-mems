/**
 * One manufacturing resource per eligible production cost centre.
 * Core fields are owned by mfg_resources. All SKU allocations/commissioned
 * ratings are read and saved exclusively in pln_cost_center_capacity, shared
 * by Product Configuration, Asset and Manufacturing Resources entry points.
 */
import {commitChecked,getDoc,HttpError,isObj,listDocs,nowIso,num,str,type Obj} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';
import {canAt,nodePath,scopeOf} from './access';
import {audit} from './audit';
import {PROCUREMENT_UNITS} from './procurementUnits';
import {isManufacturingCostType} from './plnCostCenterCapacity';
import {selectedCostCenterSubcategories} from '../src/shared/costCenterTaxonomy';

const ROOT=(orgId:string)=>'organizations/'+orgId;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/;
const validId=(v:unknown)=>{const s=str(v).trim();if(!ID.test(s))throw new HttpError(400,'Invalid production cost centre.');return s;};
const store=(org:string)=>ROOT(org)+'/mfg_resources';
const link=(org:string,cc:string)=>ROOT(org)+'/mfg_resource_cost_centers/'+cc;
const isActive=(status:unknown)=>!['inactive','disabled','deleted'].includes(str(status).toLowerCase());
export function resourceCoreRecord(data:Obj,ccId:string,siteId:string,actor:string,prior?:Obj):Obj{
 const name=str(data.name).trim(),rateUom=str(data.rateUom).trim(),notes=str(data.notes).trim();
 if(name.length<2||name.length>160)throw new HttpError(400,'Resource name must have 2–160 characters.');
 if(notes.length>600)throw new HttpError(400,'Resource notes must be at most 600 characters.');
 const unit=PROCUREMENT_UNITS.find(u=>u.code===rateUom&&u.active&&u.selectable);
 if(!unit)throw new HttpError(400,'Choose an enabled rate unit from the MEMS UoM master.');
 const at=nowIso();
 return {
   ...prior,id:str(prior?.id),name,rateUom,description:notes,notes,
   siteId,costCenterId:ccId,sourceKind:'PRODUCTION_COST_CENTER',
   type:'WORK_CENTER',rate:0,efficiency:100,assetId:'',
   status:'active',revision:(num(prior?.revision)??0)+1,
   createdAt:prior?str(prior.createdAt):at,createdBy:prior?str(prior.createdBy):actor,
   updatedAt:at,updatedBy:actor,
 };
}
async function permitted(ctx:OrgContext,ccId:string,write:boolean){
 if(ctx.role==='org_super_admin')return true;
 const path=await nodePath(ctx.orgId,ccId);
 if(!path.length)return false;
 const perms=write?['MFG.master.edit','PLN.configure','ADM.structure']:
    ['MFG.view','PLN.view','ADM.structure','MFG.master.edit','PLN.configure'];
 const scope=await scopeOf(ctx);
 return perms.some(p=>hasPerm(ctx.permissions,p)&&canAt(ctx,p,path,scope));
}
async function location(ctx:OrgContext,ccId:string){
 const path=await nodePath(ctx.orgId,ccId);
 if(!path.length)throw new HttpError(404,'Cost centre not found.');
 const records=await Promise.all(path.map(id=>getDoc(ROOT(ctx.orgId)+'/structure/'+id)));
 const cc=records[records.length-1];
 if(!cc||str(cc.data.level)!=='cost_center'||records.some(x=>!x||!isActive(x.data.status)))
    throw new HttpError(400,'Only active production cost centres may be added.');
 const type=str(isObj(cc.data.attributes)?cc.data.attributes.costType:'');
 const config=await getDoc('module_workspaces/FIN/metadata/costCenterTypes');
 if(!isManufacturingCostType(type,config?.data.items))
    throw new HttpError(400,'This cost centre is not classified as Production/Manufacturing.');
 const site=records.find(x=>str(x?.data.level)==='site');
 if(!site)throw new HttpError(409,'Production cost centre has no configured site.');
 return {costCenterId:ccId,siteId:site.id,
    name:str(cc.data.name)||ccId,code:str(cc.data.code),
    costCenterCategory:type,
    costCenterSubcategories:selectedCostCenterSubcategories(isObj(cc.data.attributes)?cc.data.attributes:{})};
}
async function resolve(ctx:OrgContext,ccId:string){
 const pinned=await getDoc(link(ctx.orgId,ccId));
 if(pinned){
   const doc=await getDoc(store(ctx.orgId)+'/'+str(pinned.data.resourceId));
   if(doc&&str(doc.data.costCenterId)===ccId)return doc;
 }
 const rows=await listDocs(store(ctx.orgId));
 return rows.find(x=>str(x.data.costCenterId)===ccId&&str(x.data.sourceKind)==='PRODUCTION_COST_CENTER')||null;
}
const auditResource=async(ctx:OrgContext,action:string,ccId:string,id:string)=>audit([{
 category:'data',action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,
 target:{label:id},details:'Resource '+id+' at production cost centre '+ccId+'; SKU ratings remain in the shared cost-centre capacity registry',
}]);
export const plnManufacturingResourceRoutes={
 'POST /api/org/pln/resource/list':[orgRoute('org.pln.resource.list',null,async ctx=>{
   if(ctx.role!=='org_super_admin'&&
      !['MFG.view','PLN.view','ADM.structure','MFG.master.edit','PLN.configure']
          .some(p=>hasPerm(ctx.permissions,p)))
      throw new HttpError(403,'Manufacturing or Planning viewing permission required.');
   const [nodes,config,resources]=await Promise.all([
       listDocs(ROOT(ctx.orgId)+'/structure'),
       getDoc('module_workspaces/FIN/metadata/costCenterTypes'),
       listDocs(store(ctx.orgId)),
   ]);
   const classifications=config?.data.items;
   const eligible=nodes.filter(n=>str(n.data.level)==='cost_center'&&isActive(n.data.status)&&
       isManufacturingCostType(str(isObj(n.data.attributes)?n.data.attributes.costType:''),classifications));
   const accessible=[];
   for(const cc of eligible){
       if(!await permitted(ctx,cc.id,false))continue;
       const parents=await nodePath(ctx.orgId,cc.id);
       const chain=parents.map(id=>nodes.find(n=>n.id===id)).filter((n):n is NonNullable<typeof n>=>!!n);
       if(chain.slice(-4).map(n=>str(n.data.level)).join('|')!=='legal_entity|site|department|cost_center'||
           chain.some(n=>!isActive(n.data.status)))continue;
       const linked=resources.find(r=>str(r.data.costCenterId)===cc.id&&
            str(r.data.sourceKind)==='PRODUCTION_COST_CENTER');
       accessible.push({
           costCenterId:cc.id,costCenterCode:str(cc.data.code),
           costCenterName:str(cc.data.name)||cc.id,siteId:chain[chain.length-3].id,
           costCenterCategory:str(isObj(cc.data.attributes)?cc.data.attributes.costType:''),
           costCenterSubcategories:selectedCostCenterSubcategories(isObj(cc.data.attributes)?cc.data.attributes:{}),
           legalEntityId:chain[chain.length-4].id,departmentId:chain[chain.length-2].id,
           path:chain.map(x=>({id:x.id,name:str(x.data.name)||str(x.data.code)||x.id,
               code:str(x.data.code),level:str(x.data.level)})),
           resource:linked?{id:linked.id,name:str(linked.data.name),rateUom:str(linked.data.rateUom),
               notes:str(linked.data.notes||linked.data.description),revision:num(linked.data.revision)??1,
               active:str(linked.data.status)!=='removed'}:null,
           canConfigure:await permitted(ctx,cc.id,true),
       });
   }
   const ids=accessible.map(x=>x.path.map(p=>p.id));
   const common=ids.length?ids[0].filter((id,i)=>ids.every(path=>path[i]===id)).slice(-1)[0]||'':'';
   const highest=accessible[0]?.path.find(p=>p.id===common)||null;
   return {costCenters:accessible,highestPermittedScope:highest,
      testOverride:ctx.testMode===true&&ctx.role==='org_super_admin',
      unitOptions:PROCUREMENT_UNITS.filter(u=>u.active&&u.selectable)
        .map(u=>({code:u.code,name:u.label,symbol:u.symbol,category:u.category}))};
 })],
 'POST /api/org/pln/resource/get':[orgRoute('org.pln.resource.get',null,async ctx=>{
   const ccId=validId(ctx.body.costCenterId);
   if(!await permitted(ctx,ccId,false))throw new HttpError(403,'Cost centre outside permitted scope.');
   const cc=await location(ctx,ccId),doc=await resolve(ctx,ccId);
   return {location:cc,resource:doc&&str(doc.data.status)!=='removed'?
       {id:doc.id,name:str(doc.data.name),rateUom:str(doc.data.rateUom),
           notes:str(doc.data.notes||doc.data.description),revision:num(doc.data.revision)??1}:null,
       canConfigure:await permitted(ctx,ccId,true),
       testOverride:ctx.testMode===true&&ctx.role==='org_super_admin',
       unitOptions:PROCUREMENT_UNITS.filter(u=>u.active&&u.selectable)
           .map(u=>({code:u.code,name:u.label,symbol:u.symbol,category:u.category}))};
 })],
 'POST /api/org/pln/resource/save':[orgRoute('org.pln.resource.save',null,async ctx=>{
   const ccId=validId(ctx.body.costCenterId);
   if(!await permitted(ctx,ccId,true))throw new HttpError(403,'Cannot edit this cost centre.');
   const cc=await location(ctx,ccId);
   const old=await resolve(ctx,ccId);
   const expected=Number(ctx.body.expectedRevision);
   if(expected!==(num(old?.data.revision)??0))
       throw new HttpError(409,'Manufacturing resource changed. Reload before saving.');
   const core=resourceCoreRecord({
       name:str(ctx.body.name),rateUom:str(ctx.body.rateUom),notes:str(ctx.body.notes),
   },ccId,cc.siteId,ctx.uid,old?.data);
   if(old){
       const updated=await commitChecked([{path:store(ctx.orgId)+'/'+old.id,
           data:{...core,id:old.id},precondition:{updateTime:old.updateTime}}]);
       if(!updated)throw new HttpError(409,'Resource changed concurrently. Reload.');
       await auditResource(ctx,'pln.manufacturing_resource.core_update',ccId,old.id);
       return {resource:{id:old.id,name:core.name,rateUom:core.rateUom,
           notes:core.notes,revision:core.revision},costCenterId:ccId};
   }
   // The RSC counter and one-per-cost-centre reservation are committed together.
   // No rate or packaging conversion is duplicated on a resource.
   for(let attempt=0;attempt<35;attempt++){
       const seqPath=ROOT(ctx.orgId)+'/mfg_code_sequences/RSC';
       const counter=await getDoc(seqPath);
       const next=(num(counter?.data.lastSequence)??0)+1;
       if(next>999999999)throw new HttpError(409,'Manufacturing resource code sequence exhausted.');
       const id='RSC_'+String(next).padStart(9,'0'),at=nowIso();
       const success=await commitChecked([
           {path:seqPath,data:{prefix:'RSC',lastSequence:next,lastCode:id,updatedAt:at},
               precondition:counter?{updateTime:counter.updateTime}:{exists:false}},
           {path:store(ctx.orgId)+'/'+id,data:{...core,id},
               precondition:{exists:false}},
           {path:link(ctx.orgId,ccId),data:{resourceId:id,costCenterId:ccId,createdAt:at},
               precondition:{exists:false}},
       ]);
       if(success){
           await auditResource(ctx,'pln.manufacturing_resource.add',ccId,id);
           return {resource:{id,name:core.name,rateUom:core.rateUom,
               notes:core.notes,revision:core.revision},costCenterId:ccId};
       }
       if(await resolve(ctx,ccId))throw new HttpError(409,'This cost centre already has a manufacturing resource. Refresh.');
   }
   throw new HttpError(409,'Unable to allocate manufacturing resource after concurrent updates.');
 })],
 'POST /api/org/pln/resource/remove':[orgRoute('org.pln.resource.remove',null,async ctx=>{
   const ccId=validId(ctx.body.costCenterId);
   if(!await permitted(ctx,ccId,true))throw new HttpError(403,'Cannot remove this resource.');
   const existing=await resolve(ctx,ccId);
   if(!existing||str(existing.data.status)==='removed')throw new HttpError(404,'No active resource mapped.');
   if(Number(ctx.body.expectedRevision)!==(num(existing.data.revision)??0))
       throw new HttpError(409,'Resource changed. Reload before removing.');
   // Prevent orphaned routing references before removing a resource from its list.
   const routes=await listDocs(ROOT(ctx.orgId)+'/mfg_routings');
   if(routes.some(x=>Array.isArray(x.data.operations)&&x.data.operations.some(
       op=>isObj(op)&&str(op.resourceId)===existing.id&&
          !['deleted','cancelled','rejected'].includes(str(x.data.status)))))
       throw new HttpError(409,'Resource is used by a manufacturing routing. Remove or reassign its routing stages first.');
   if(!await commitChecked([{path:store(ctx.orgId)+'/'+existing.id,data:{
       ...existing.data,status:'removed',revision:(num(existing.data.revision)??0)+1,
       removedBy:ctx.uid,removedAt:nowIso(),updatedBy:ctx.uid,updatedAt:nowIso(),
   },precondition:{updateTime:existing.updateTime}}]))
       throw new HttpError(409,'Resource changed concurrently. Reload.');
   await auditResource(ctx,'pln.manufacturing_resource.remove',ccId,existing.id);
   return {ok:true};
 })],
 'POST /api/org/pln/resource/asset-context':[orgRoute('org.pln.resource.asset_context',null,async ctx=>{
   const workCenterId=validId(ctx.body.workCenterId);
   const path=await nodePath(ctx.orgId,workCenterId);
   const docs=await Promise.all(path.map(id=>getDoc(ROOT(ctx.orgId)+'/structure/'+id)));
   if(str(docs[docs.length-1]?.data.level)!=='work_center')
       return {costCenterId:'',eligible:false};
   const costCenter=docs.find(x=>str(x?.data.level)==='cost_center');
   if(!costCenter||!await permitted(ctx,costCenter.id,false))
       return {costCenterId:'',eligible:false};
   try{await location(ctx,costCenter.id);}
   catch{return {costCenterId:'',eligible:false};}
   const resource=await resolve(ctx,costCenter.id);
   return {costCenterId:costCenter.id,eligible:true,
       resourceId:resource&&str(resource.data.status)!=='removed'?resource.id:''};
 })],
};
