/**
 * Phase 2 Demand Management: tenant-scoped demand drafts, independent approval,
 * source deduplication and read-only forecast consumption. Does NOT post
 * inventory, purchase requests, customer orders or manufacturing orders.
 */
import {createHash} from 'node:crypto';
import {HttpError,commitChecked,getDoc,isObj,listDocs,nowIso,num,randomId,str,type Obj} from './core';
import {orgRoute,hasPerm,type OrgContext} from './guards';
import {canAt,nodePath,scopeOf} from './access';
import {audit} from './audit';
import {materialUnitFactor} from './plnMfgFoundation';

const ROOT=(org:string)=>'organizations/'+org+'/pln_demand';
const SOURCE_KEYS=(org:string)=>'organizations/'+org+'/pln_demand_source_keys';
const CODE=/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const TYPES=['FORECAST','FIRM_ORDER'] as const;
const SOURCES=['MANUAL','CSV_IMPORT','EXTERNAL'] as const;
export type DemandType=typeof TYPES[number];
export type DemandSource=typeof SOURCES[number];
export type DemandInput={
 skuId:string;siteId:string;needDate:string;type:DemandType;quantity:number;
 uom:string;source:DemandSource;externalId:string;market:string;customerReference:string;notes:string;
};
export type DemandDatum=DemandInput&{id:string;status:'draft'|'pending_approval'|'approved'|'rejected';
 revision:number;createdBy:string;submittedBy?:string;approvedBy?:string;};
const validDate=(v:unknown):string=>{
 const x=str(v).trim();
 if(!DAY.test(x)||!Number.isFinite(Date.parse(x))||new Date(x).toISOString().slice(0,10)!==x)
  throw new HttpError(400,'Demand date must be a valid YYYY-MM-DD date.');
 return x;
};
const code=(v:unknown,label:string)=>{
 const x=str(v).trim();
 if(!CODE.test(x))throw new HttpError(400,label+' is required and must be a valid reference.');
 return x;
};
const clean=(v:unknown,max=160)=>str(v).trim().slice(0,max);
export function normalizeDemand(input:unknown):DemandInput{
 if(!isObj(input))throw new HttpError(400,'Demand line is required.');
 const type=input.type,source=input.source??'MANUAL';
 if(!TYPES.includes(type as DemandType))throw new HttpError(400,'Select forecast or firm order.');
 if(!SOURCES.includes(source as DemandSource))throw new HttpError(400,'Unsupported demand source.');
 const quantity=Number(input.quantity);
 if(!Number.isFinite(quantity)||quantity<=0||quantity>1e12)
  throw new HttpError(400,'Demand quantity must be greater than zero.');
 const externalId=clean(input.externalId,100),customerReference=clean(input.customerReference,120);
 if(source!=='MANUAL'&&!externalId)
  throw new HttpError(400,'Imported demand must include a source reference for duplicate prevention.');
 if(type==='FIRM_ORDER'&&!customerReference)
  throw new HttpError(400,'A confirmed customer order needs a customer/order reference.');
 return {skuId:code(input.skuId,'Demand output SKU'),siteId:code(input.siteId,'Production site'),
   needDate:validDate(input.needDate),type:type as DemandType,quantity,
   uom:code(input.uom,'Demand unit'),source:source as DemandSource,
   externalId,market:clean(input.market,80),customerReference,notes:clean(input.notes,350)};
}
export type DemandSummary={
 skuId:string;siteId:string;market:string;period:string;uom:string;forecast:number;
 firmOrders:number;forecastConsumed:number;remainingForecast:number;totalDemand:number;
 sourceIds:string[];
};
/**
 * Forecast is consumed by confirmed orders within identical SKU, site, market,
 * unit and month buckets. Firm orders are not added on top of the full forecast.
 * Source records and consumed quantities remain visible for future MPS pegging.
 */
export function consolidateDemand(rows:Array<Partial<DemandDatum>>):DemandSummary[]{
 const groups=new Map<string,DemandSummary>();
 for(const raw of rows){
  if(raw.status!=='approved')continue;
  const period=str(raw.needDate).slice(0,7),skuId=str(raw.skuId),
    siteId=str(raw.siteId),market=str(raw.market),uom=str(raw.uom);
  if(!/^\d{4}-\d{2}$/.test(period)||!skuId||!siteId||!uom)continue;
  if(raw.type!=='FORECAST'&&raw.type!=='FIRM_ORDER')continue;
  const q=Number(raw.quantity);
  if(!Number.isFinite(q)||q<=0)continue;
  const key=[skuId,siteId,market,period,uom].join('|');
  let group=groups.get(key);
  if(!group){
   group={skuId,siteId,market,period,uom,forecast:0,firmOrders:0,
    forecastConsumed:0,remainingForecast:0,totalDemand:0,sourceIds:[]};
   groups.set(key,group);
  }
  if(raw.type==='FORECAST')group.forecast+=q;
  else group.firmOrders+=q;
  group.sourceIds.push(str(raw.id));
 }
 return [...groups.values()].map(row=>{
  const forecastConsumed=Math.min(row.forecast,row.firmOrders);
  return {...row,forecastConsumed,
    remainingForecast:row.forecast-forecastConsumed,
    totalDemand:row.firmOrders+row.forecast-forecastConsumed};
 }).sort((a,b)=>a.period.localeCompare(b.period)||a.skuId.localeCompare(b.skuId)||
   a.siteId.localeCompare(b.siteId)||a.market.localeCompare(b.market));
}
export function demandSourceKey(data:DemandInput):string{
 if(!data.externalId)return '';
 return createHash('sha256').update(data.source+'|'+data.externalId).digest('hex').slice(0,40);
}
async function permitted(ctx:OrgContext,permission:string,siteId:string):Promise<boolean>{
 if(ctx.role==='org_super_admin')return true;
 if(!hasPerm(ctx.permissions,permission))return false;
 if(!siteId)return hasPerm(ctx.directPermissions,permission);
 const scope=await scopeOf(ctx);
 return canAt(ctx,permission,await nodePath(ctx.orgId,siteId),scope);
}
async function validateMaster(ctx:OrgContext,demand:DemandInput){
 const site=await getDoc('organizations/'+ctx.orgId+'/structure/'+demand.siteId);
 if(!site||str(site.data.level)!=='site'||str(site.data.status)==='inactive')
  throw new HttpError(400,'Choose an active production site.');
 const sku=await getDoc('organizations/'+ctx.orgId+'/mfg_items/'+demand.skuId);
 if(!sku||!['INTERMEDIATE','FINISHED'].includes(str(sku.data.category)))
  throw new HttpError(400,'Demand must reference an existing finished or intermediate output.');
 if(str(sku.data.siteId)&&str(sku.data.siteId)!==demand.siteId)
  throw new HttpError(400,'Output material is not available at this production site.');
 const baseUom=str(sku.data.uom);
 const factor=materialUnitFactor(demand.uom,baseUom);
 return {...demand,quantity:demand.quantity*factor,uom:baseUom};
}
const log=(ctx:OrgContext,action:string,id:string)=>audit([{
 category:'data',action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,
 target:{label:id},details:'Demand register; no inventory, procurement or manufacturing posting',
}]);
const allowedEdit=(ctx:OrgContext)=>ctx.role==='org_super_admin'||hasPerm(ctx.permissions,'PLN.configure');

export const plnDemandRoutes={
 'POST /api/org/pln/demand/references':[
  orgRoute('org.pln.demand.references','PLN.view',async ctx=>{
   const [nodes,skus]=await Promise.all([
    listDocs('organizations/'+ctx.orgId+'/structure'),
    listDocs('organizations/'+ctx.orgId+'/mfg_items'),
   ]);
   const sites=[];
   for(const node of nodes){
    if(str(node.data.level)==='site'&&str(node.data.status)!=='inactive'&&
        await permitted(ctx,'PLN.view',node.id))
     sites.push({id:node.id,name:str(node.data.name)||node.id});
   }
   const validSites=new Set(sites.map(x=>x.id));
   const outputs=skus.filter(x=>['FINISHED','INTERMEDIATE'].includes(str(x.data.category))&&
        (!str(x.data.siteId)||validSites.has(str(x.data.siteId))))
    .map(x=>({id:x.id,name:str(x.data.name)||x.id,uom:str(x.data.uom),
       siteId:str(x.data.siteId),category:str(x.data.category)}));
   return {sites,outputs};
  }),
 ],
 'POST /api/org/pln/demand/list':[
  orgRoute('org.pln.demand.list','PLN.view',async ctx=>{
   const all=await listDocs(ROOT(ctx.orgId)),visible=[];
   for(const row of all){
    if(await permitted(ctx,'PLN.view',str(row.data.siteId)))
     visible.push({id:row.id,...row.data});
   }
   return {records:visible};
  }),
 ],
 'POST /api/org/pln/demand/save':[
  orgRoute('org.pln.demand.save','PLN.configure',async ctx=>{
   if(!allowedEdit(ctx))throw new HttpError(403,'Planning configuration permission is required.');
   const data=normalizeDemand(ctx.body.record);
   if(!await permitted(ctx,'PLN.configure',data.siteId))
    throw new HttpError(403,'Demand editing is outside your site scope.');
   const valid=await validateMaster(ctx,data),requestId=str(ctx.body.id).trim();
   const old=requestId?await getDoc(ROOT(ctx.orgId)+'/'+code(requestId,'Demand ID')):null;
   if(requestId&&!old)throw new HttpError(404,'Demand record not found.');
   if(old&&str(old.data.status)!=='draft'&&str(old.data.status)!=='rejected')
    throw new HttpError(409,'Submitted and approved demand is immutable. Create a new version.');
   if(old&&(!await permitted(ctx,'PLN.configure',str(old.data.siteId))||
      Number(ctx.body.expectedRevision)!==(num(old.data.revision)??1)))
    throw new HttpError(409,'Demand scope or revision changed.');
   const id=old?.id||'DMD_'+randomId(9).toUpperCase();
   const dedupeKey=demandSourceKey(valid);
   if(old&&(str(old.data.source)!==valid.source||str(old.data.externalId)!==valid.externalId))
    throw new HttpError(409,'Demand source reference cannot change within a revision.');
   const now=nowIso(),revision=old?(num(old.data.revision)??1)+1:1;
   const stored:Obj={...valid,id,status:'draft',revision,
    createdAt:old?str(old.data.createdAt):now,createdBy:old?str(old.data.createdBy):ctx.uid,
    updatedAt:now,updatedBy:ctx.uid};
   const writes=[{path:ROOT(ctx.orgId)+'/'+id,data:stored,
     precondition:old?{updateTime:old.updateTime}:{exists:false}}];
   if(!old&&dedupeKey)writes.push({path:SOURCE_KEYS(ctx.orgId)+'/'+dedupeKey,
     data:{demandId:id,source:valid.source,externalId:valid.externalId,createdAt:now},
     precondition:{exists:false}});
   if(!await commitChecked(writes))throw new HttpError(409,'Demand or source reference already exists. Reload to avoid double counting.');
   await log(ctx,'pln.demand.save',id);
   return {record:stored};
  }),
 ],
 'POST /api/org/pln/demand/submit':[
  orgRoute('org.pln.demand.submit','PLN.configure',async ctx=>{
   if(!allowedEdit(ctx))throw new HttpError(403,'Planning permission required.');
   const id=code(ctx.body.id,'Demand ID'),path=ROOT(ctx.orgId)+'/'+id,old=await getDoc(path);
   if(!old||str(old.data.status)!=='draft')throw new HttpError(409,'Only draft demand can be submitted.');
   if(!await permitted(ctx,'PLN.configure',str(old.data.siteId)))
    throw new HttpError(403,'Demand is outside your site scope.');
   // Recheck authoring assumptions at submission.
   await validateMaster(ctx,normalizeDemand(old.data));
   const updated={...old.data,status:'pending_approval',submittedAt:nowIso(),submittedBy:ctx.uid};
   if(!await commitChecked([{path,data:updated,precondition:{updateTime:old.updateTime}}]))
    throw new HttpError(409,'Demand changed before submission.');
   await log(ctx,'pln.demand.submit',id);return {record:updated};
  }),
 ],
 'POST /api/org/pln/demand/decide':[
  orgRoute('org.pln.demand.decide','PLN.configure',async ctx=>{
   if(!allowedEdit(ctx))throw new HttpError(403,'Planning permission required.');
   const id=code(ctx.body.id,'Demand ID'),path=ROOT(ctx.orgId)+'/'+id,old=await getDoc(path);
   if(!old||str(old.data.status)!=='pending_approval')
    throw new HttpError(409,'Only submitted demand can be decided.');
   if(!await permitted(ctx,'PLN.configure',str(old.data.siteId)))
    throw new HttpError(403,'Demand approval is outside your site scope.');
   if(ctx.uid===str(old.data.createdBy)||ctx.uid===str(old.data.submittedBy)){
    if(ctx.role==='org_super_admin'&&ctx.testMode===true)
     ctx.bypassed?.push('pln.demand.independent_checker');
    else throw new HttpError(403,'Demand requires an independent reviewer.');
   }
   const decision=str(ctx.body.decision);
   if(!['approve','reject'].includes(decision))throw new HttpError(400,'Choose approval or rejection.');
   const reason=clean(ctx.body.reason,350);
   if(decision==='reject'&&!reason)throw new HttpError(400,'A rejection reason is required.');
   if(decision==='approve')await validateMaster(ctx,normalizeDemand(old.data));
   const now=nowIso(),updated={...old.data,status:decision==='approve'?'approved':'rejected',
     decidedAt:now,decidedBy:ctx.uid,decisionReason:reason,
     ...(decision==='approve'?{approvedAt:now,approvedBy:ctx.uid}:{})};
   if(!await commitChecked([{path,data:updated,precondition:{updateTime:old.updateTime}}]))
    throw new HttpError(409,'Demand changed before decision.');
   await log(ctx,'pln.demand.'+decision,id);return {record:updated};
  }),
 ],
 'POST /api/org/pln/demand/summary':[
  orgRoute('org.pln.demand.summary','PLN.view',async ctx=>{
   const all=await listDocs(ROOT(ctx.orgId)),visible=[];
   for(const row of all){
    if(str(row.data.status)==='approved'&&await permitted(ctx,'PLN.view',str(row.data.siteId)))
     visible.push({id:row.id,...row.data});
   }
   return {period:'MONTH',approvedOnly:true,rows:consolidateDemand(visible)};
  }),
 ],
};
