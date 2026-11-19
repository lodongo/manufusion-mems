/**
 * Read-only routing review and release readiness. No stock, order, asset, accounting
 * or manufacturing transactions are performed here.
 */
import {getDoc,isObj,num,str,type Obj} from './core';
import type {OrgContext} from './guards';
import {routingCommissionedCapacity,routingManufacturingCostCenter} from './plnCostCenterCapacity';
import {physicalRatingUnits} from './plnPhysicalCapacity';
import {bomClassificationCode,mfgMaterialPolicyForOrg} from './mfgMaterialPolicy';

type Issue={stageCode:string;field:string;message:string};
type StagePreview={code:string;name:string;stageType:string;producesSkuId:string;
 costCenterId:string;resourceId:string;bomId:string;capacityBasis:string;
 dependsOn:string[];setupMinutes:number;runMinutesPerUnit:number;bomComponentCount:number;
 capacity:{quantity:number;unit:string;source:string;revision?:number}|null};
const path=(org:string,name:string,id:string)=>'organizations/'+org+'/'+name+'/'+id;
const rows=(v:unknown):Obj[]=>Array.isArray(v)?v.filter(isObj):[];
const finite=(v:unknown):number=>typeof v==='number'&&Number.isFinite(v)?v:Number(v)||0;

/** Analyze complete routes; incomplete drafts return field-level issues instead of failing the screen. */
export async function reviewManufacturingRouting(ctx:OrgContext,raw:Obj){
 const issues:Issue[]=[],stagePreviews:StagePreview[]=[];
 const issue=(code:string,field:string,message:string)=>issues.push({stageCode:code,field,message});
 const siteId=str(raw.siteId),skuId=str(raw.skuId);
 const operations=rows(raw.operations).slice(0,60);
 if(!siteId)issue('HEADER','siteId','Select the production site before releasing the routing.');
 if(!skuId)issue('HEADER','skuId','Select the manufactured output SKU.');
 if(!operations.length)issue('HEADER','operations','Add at least one manufacturing stage.');
 const routed=skuId?await getDoc(path(ctx.orgId,'mfg_items',skuId)):null;
 if(skuId&&!routed)issue('HEADER','skuId','Routed manufactured SKU was not found.');
 if(routed&&str(routed.data.siteId)&&str(routed.data.siteId)!==siteId)
  issue('HEADER','skuId','Output SKU belongs to a different production site.');
 const policy=await mfgMaterialPolicyForOrg(ctx.orgId);
 const effectiveDate=str(raw.effectiveFrom)||new Date().toISOString().slice(0,10);
 const usedProducingBoms=new Map<string,string>();
 const codes=new Set<string>(),resourceCache=new Map<string,Awaited<ReturnType<typeof getDoc>>>(),
  bomCache=new Map<string,Awaited<ReturnType<typeof getDoc>>>(),
  skuCache=new Map<string,Awaited<ReturnType<typeof getDoc>>>();
 const fetchCached=async(map:Map<string,Awaited<ReturnType<typeof getDoc>>>,collection:string,id:string)=>{
  if(!map.has(id))map.set(id,await getDoc(path(ctx.orgId,collection,id)));
  return map.get(id)??null;
 };
 for(const [index,step] of operations.entries()){
  const code=str(step.code)||'STAGE-'+(index+1);
  const name=str(step.name),stageType=str(step.stageType)||'PRODUCE';
  const capacityBasis=str(step.capacityBasis)||'RESOURCE_RATE';
  const producesSkuId=str(step.producesSkuId),costCenterId=str(step.costCenterId);
  const resourceId=str(step.resourceId),bomId=str(step.bomId);
  if(!name)issue(code,'name','Stage '+(index+1)+' needs a description.');
  if(!str(step.code))issue(code,'code','Stage identifier is missing.');
  if(codes.has(code))issue(code,'code','Duplicate stage identifier.');
  codes.add(code);
  if(!['PRODUCE','INSPECT','TRANSFER','OTHER'].includes(stageType))
   issue(code,'stageType','Choose a recognized stage type.');
  if(stageType==='PRODUCE'&&!producesSkuId)
   issue(code,'producesSkuId','An output-producing stage needs a manufactured output SKU.');
  if(!resourceId)issue(code,'resourceId','Select the primary manufacturing resource.');
  if(!costCenterId)issue(code,'costCenterId','Assign a manufacturing cost centre for this stage.');
  let resource:Awaited<ReturnType<typeof getDoc>>=null;
  if(resourceId){
   resource=await fetchCached(resourceCache,'mfg_resources',resourceId);
   if(!resource)issue(code,'resourceId','Configured manufacturing resource could not be found.');
   else if(str(resource.data.siteId)&&str(resource.data.siteId)!==siteId)
    issue(code,'resourceId','Manufacturing resource belongs to another site.');
  }
  if(costCenterId){
   try{await routingManufacturingCostCenter(ctx,costCenterId,siteId);}
   catch(e){issue(code,'costCenterId',e instanceof Error?e.message:'Cost centre is not available at this site.');}
  }
  if(producesSkuId){
   const sku=await fetchCached(skuCache,'mfg_items',producesSkuId);
   if(!sku||!['FINISHED','INTERMEDIATE'].includes(str(sku.data.category)))
    issue(code,'producesSkuId','Output must be an existing finished or intermediate SKU.');
   else if(str(sku.data.siteId)&&str(sku.data.siteId)!==siteId)
    issue(code,'producesSkuId','Stage output belongs to another site.');
  }
  if(stageType==='PRODUCE'&&!bomId)
   issue(code,'bomId','Select an approved, effective BOM for this material-transforming stage.');
  if(stageType!=='PRODUCE'&&bomId)
   issue(code,'bomId','A non-transforming stage must not issue or consume a BOM.');
  if(stageType==='PRODUCE'&&bomId){
   const alreadyUsed=usedProducingBoms.get(bomId);
   if(alreadyUsed)issue(code,'bomId',
    'BOM already assigned to producing stage '+alreadyUsed+'; this could duplicate material demand.');
   else usedProducingBoms.set(bomId,code);
  }
  if(bomId){
   const bom=await fetchCached(bomCache,'mfg_boms',bomId);
   if(!bom)issue(code,'bomId','Stage BOM does not exist.');
   else{
    if(str(bom.data.parentSkuId)!==producesSkuId)
     issue(code,'bomId','BOM output must match the stage output SKU.');
    if(str(bom.data.siteId)&&str(bom.data.siteId)!==siteId)
     issue(code,'bomId','BOM is restricted to another production site.');
    if(str(bom.data.status)!=='active')
     issue(code,'bomId','Stage BOM must be approved and active before routing release.');
    if(str(bom.data.effectiveFrom)>effectiveDate)
     issue(code,'bomId','Stage BOM becomes effective after the selected routing date.');
    const cls=policy.policy.bomClassifications.find(c=>c.code===bomClassificationCode(bom.data));
    if((!cls||!cls.enabled||!cls.productionEligible)&&str(bom.data.classificationCode))
     issue(code,'bomId','BOM classification is not approved for manufacturing production.');
   }
  }
  const predecessors=Array.isArray(step.dependsOn)?step.dependsOn.map(str):[];
  const earlier=new Set(operations.slice(0,index).map(x=>str(x.code)));
  if(predecessors.some(dep=>!earlier.has(dep)||dep===code)||new Set(predecessors).size!==predecessors.length)
   issue(code,'dependsOn','Dependencies must refer to distinct earlier stages in this routing.');
  let capacity:StagePreview['capacity']=null;
  if(capacityBasis==='PHYSICAL_CONTAINER'){
   if(!producesSkuId)issue(code,'capacityBasis','Select the container-producing stage SKU first.');
   else if(costCenterId&&siteId){
    try{
     const result=await routingCommissionedCapacity(ctx,costCenterId,siteId,producesSkuId);
     if(!result.rating||!result.rating.projection){
      issue(code,'capacityBasis','No valid commissioned primary-container speed is mapped to this SKU in the selected cost centre.');
     }else{
      const rating=result.rating as Obj;
      const units=physicalRatingUnits();
      const count=units.count.find(u=>u.code===str(rating.ratingUnitCode));
      const period=units.time.find(u=>u.code===str(rating.periodUnitCode));
      const hour=units.time.find(u=>u.name==='Hour');
      const quantity=finite(rating.ratingQuantity)*(count?.multiplier||0)*
       ((hour?.multiplier||0)/(period?.multiplier||Number.POSITIVE_INFINITY));
      if(!Number.isFinite(quantity)||quantity<=0)
       issue(code,'capacityBasis','Commissioned primary-container rate cannot be normalized to containers/hour.');
      else capacity={quantity:Number(quantity.toPrecision(10)),unit:'physical containers/hour',
       source:'Commissioned cost-centre SKU rating',revision:result.revision};
     }
    }catch(e){issue(code,'capacityBasis',e instanceof Error?e.message:'Commissioned speed cannot be verified.');}
   }
  }else if(capacityBasis==='RESOURCE_RATE'){
   const rate=finite(resource?.data.rate);
   if(!rate||!str(resource?.data.rateUom))
    issue(code,'capacityBasis','Configured manufacturing resource needs a positive rated throughput and unit.');
   else capacity={quantity:rate,unit:str(resource?.data.rateUom)+'/hour',
    source:'Manufacturing resource master (nominal, before effectiveness)'};
  }else if(capacityBasis==='BATCH_CYCLE'){
   const size=finite(step.batchSize),minutes=finite(step.cycleMinutes);
   if(size<=0||minutes<=0)issue(code,'capacityBasis','Enter a positive batch size and batch cycle in minutes.');
   else {
    const item=producesSkuId?await fetchCached(skuCache,'mfg_items',producesSkuId):null;
    capacity={quantity:Number((size*60/minutes).toPrecision(10)),
     unit:(str(item?.data.uom)||'batch output units')+'/hour',source:'Configured batch size and cycle'};
   }
  }else if(capacityBasis==='TIME_PER_UNIT'){
   const minutes=finite(step.runMinutesPerUnit);
   if(minutes<=0)issue(code,'capacityBasis','Enter positive run minutes per output unit.');
   else{
    const item=producesSkuId?await fetchCached(skuCache,'mfg_items',producesSkuId):null;
    capacity={quantity:Number((60/minutes).toPrecision(10)),
     unit:(str(item?.data.uom)||'output units')+'/hour',source:'Configured run time per unit'};
   }
  }else issue(code,'capacityBasis','Select a supported capacity basis.');
  stagePreviews.push({code,name,stageType,producesSkuId,costCenterId,resourceId,bomId,
   capacityBasis,dependsOn:predecessors,setupMinutes:finite(step.setupMinutes),
   runMinutesPerUnit:finite(step.runMinutesPerUnit),
   bomComponentCount:rows(bomId?bomCache.get(bomId)?.data.components:null).length,capacity});
 }
 if(operations.length){
  // Every required parallel branch must lead to the final stage; isolated
  // stages are not a connected executable manufacturing process.
  const last=operations[operations.length-1],terminal=str(last.code);
  const reachable=new Set<string>();
  const byCode=new Map(operations.map(x=>[str(x.code),x]));
  const visit=(code:string)=>{
   if(!code||reachable.has(code))return;
   reachable.add(code);
   const step=byCode.get(code);
   for(const dep of Array.isArray(step?.dependsOn)?step.dependsOn:[])visit(str(dep));
  };
  visit(terminal);
  for(const step of operations){
   if(!reachable.has(str(step.code)))
    issue(str(step.code),'dependsOn','This stage is disconnected from the final processing chain.');
  }
  const produced=operations.filter(x=>(str(x.stageType)||'PRODUCE')==='PRODUCE');
  if(!produced.some(x=>str(x.producesSkuId)===skuId))
   issue('HEADER','skuId','At least one producing stage must output the routing final SKU.');
  else if(produced.length&&str(produced[produced.length-1].producesSkuId)!==skuId)
   issue('HEADER','skuId','The final output-producing stage must yield the routing SKU.');
 }
 // Compare capacity only for identical manufactured SKU and identical physical
 // units after explicit time normalization; unlike output quantities never mix.
 const compatible=new Map<string,StagePreview[]>();
 for(const stage of stagePreviews){
  if(stage.capacityBasis!=='PHYSICAL_CONTAINER'||!stage.capacity||!stage.producesSkuId)continue;
  const key=stage.producesSkuId;
  compatible.set(key,[...(compatible.get(key)||[]),stage]);
 }
 const bottlenecks=[...compatible].filter(([,stages])=>stages.length>1)
  .map(([outputSkuId,stages])=>{
   const limiting=stages.reduce((a,b)=>a.capacity!.quantity<=b.capacity!.quantity?a:b);
   return {outputSkuId,limitingStageCode:limiting.code,
    physicalContainersPerHour:limiting.capacity!.quantity,comparableStageCodes:stages.map(x=>x.code)};
  });
 return {ready:issues.length===0,legacy:raw.routingModelVersion!==2,
  issues,stages:stagePreviews,bottlenecks,
  comparisonNote:'Only compatible primary-container rates for the same SKU are compared. Bulk, resource and packaging unit rates remain separate.'};
}
