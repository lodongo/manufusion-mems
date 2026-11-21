/**
 * One commissioned rating basis: physical primary-container count / configured time unit.
 * Use the organization's adopted Physical Container parameters and the SKU's own
 * approved composition to derive form, commercial and logistics capacities.
 */
import {HttpError,str} from './core';
import {PROCUREMENT_UNITS} from './procurementUnits';
import {calculateSkuConversion,skuUnitConversion,type SkuComponents,type SkuParameter} from './mfgSkuModel';
import {throughputOutput} from '../src/shared/throughputOutput';

export type PhysicalRating={
 skuId:string;containerId:string;containerSizeId:string;
 containerCategoryCode:string;containerSubcategoryCode:string;
 ratingQuantity:number;ratingUnitCode:string;periodUnitCode:string;
 ratingOutputCode:string;primaryContainersPerRatedOutput?:number;
};
export type RatedQuantity={quantity:number|null;unit:string;name:string;reason?:string};
export type CapacityProjection={
 source:{containerName:string;containerCategory:string;containerSubcategory:string;
  containerAttributes:Record<string,string>;sizeName:string;countUnit:string;timeUnit:string;
  ratedUnits:number;physicalContainers:number;ratingOutputCode:string;
  ratingOutputName:string;primaryContainersPerRatedOutput:number};
 physicalContainers:RatedQuantity;
 productionForm:RatedQuantity;
 finalProduct:RatedQuantity;
 commercialPackaging:RatedQuantity;
 transportLogistics:RatedQuantity;
 normalised:RatedQuantity;
};
const cap=(v:number):number=>Number(v.toPrecision(12));
const displayUnit=(code:string)=>PROCUREMENT_UNITS.find(u=>u.code===code)?.symbol||code;
const unit=(code:string,category:string)=>{
 const found=PROCUREMENT_UNITS.find(x=>x.code===code&&x.active&&x.selectable&&x.category===category);
 if(!found||!Number.isFinite(found.multiplier)||found.multiplier<=0)
  throw new HttpError(400,'Choose a published '+category+' unit for commissioned rating.');
 return found;
};
export function normalizePhysicalRating(raw:unknown):PhysicalRating{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpError(400,'A physical-container rating is required.');
 const x=raw as Record<string,unknown>;
 const id=(v:unknown,label:string)=>{
  const s=str(v).trim();if(!/^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$/.test(s))
   throw new HttpError(400,'Select a valid '+label+'.');
  return s;
 };
 const ratingQuantity=Number(x.ratingQuantity);
 if(!Number.isFinite(ratingQuantity)||ratingQuantity<=0||ratingQuantity>1e12)
  throw new HttpError(400,'Commissioned physical-container rating must be positive.');
 const ratingUnitCode=id(x.ratingUnitCode,'rated-output Count multiplier');
 const periodUnitCode=id(x.periodUnitCode,'Time unit');
 unit(ratingUnitCode,'Count');unit(periodUnitCode,'Time');
 // Existing commissioned rows are always the physical primary-container basis.
 // A new organization default must never silently reinterpret legacy ratings.
 const ratingOutputCode=str(x.ratingOutputCode)||'PRIMARY_CONTAINER';
 const output=throughputOutput(ratingOutputCode);
 if(!output)throw new HttpError(400,'Choose a published industrial output type for commissioned throughput.');
 const primaryContainersPerRatedOutput=Number(x.primaryContainersPerRatedOutput);
 if(output.kind==='CUSTOM'&&(!Number.isFinite(primaryContainersPerRatedOutput)||
    primaryContainersPerRatedOutput<=0||primaryContainersPerRatedOutput>1e12))
  throw new HttpError(400,'Custom output requires a positive number of physical primary units per rated output.');
 return {skuId:id(x.skuId,'manufactured SKU'),
  containerId:id(x.containerId,'adopted Physical Container'),
  // Manual SKU capacity needs no shared Container Size record.
  containerSizeId:str(x.containerSizeId)?id(x.containerSizeId,'legacy physical-container size'):'',
  containerCategoryCode:id(x.containerCategoryCode,'container category'),
  containerSubcategoryCode:id(x.containerSubcategoryCode,'container subcategory'),
  ratingQuantity,ratingUnitCode,periodUnitCode,ratingOutputCode,
  ...(output.kind==='CUSTOM'?{primaryContainersPerRatedOutput}:{})};
}
const projected=(value:number|null,unitCode:string,name:string,reason?:string):RatedQuantity=>({
 quantity:value===null?null:cap(value),unit:unitCode,name,
 ...(value===null?{reason:reason||'Not configured in this SKU'}:{}),
});
export function derivePhysicalCapacity(
 sku:{id:string;name:string;uom:string;category?:string;skuComponents:SkuComponents},
 parameters:SkuParameter[],input:PhysicalRating,
):CapacityProjection{
 if(sku.id!==input.skuId)throw new HttpError(400,'The rating must use the selected manufactured SKU.');
 if(sku.category==='INTERMEDIATE')throw new HttpError(400,
  'Intermediate/WIP SKUs do not use commissioned speeds. Keep the SKU allocated without a rate.');
 const components=sku.skuComponents;
 if(components.containmentScope==='NONE')
  throw new HttpError(400,'This SKU uses direct process flow, not physical containment. Choose a non-container capacity basis or configure a container on the SKU first.');
 const manualCapacity=components.containerCapacityQuantity!==undefined||
    components.containerCapacityUom!==undefined;
 if(!str(components.productionFormId)||!str(components.containerId)||
   (!manualCapacity&&!str(components.containerSizeId)))
  throw new HttpError(400,'Configure the SKU production form, physical container and manual capacity quantity/unit in Materials & Products first.');
 const container=parameters.find(p=>p.kind==='containers'&&p.id===input.containerId&&p.enabled!==false);
 const legacySize=!manualCapacity?parameters.find(p=>p.kind==='containerSizes'&&p.id===input.containerSizeId&&p.enabled!==false):undefined;
 if(!container||!manualCapacity&&!legacySize)
  throw new HttpError(400,'Select an active physical container and configure its capacity directly on the SKU.');
 if(input.containerId!==str(components.containerId)||
   !manualCapacity&&input.containerSizeId!==str(components.containerSizeId))
  throw new HttpError(400,'The physical container does not match the SKU master. Apply the saved SKU container.');
 if(str(container.categoryCode)!==input.containerCategoryCode||
    str(container.subcategoryCode)!==input.containerSubcategoryCode)
  throw new HttpError(400,'Physical container category or subcategory does not match its adopted configuration.');
 const conversion=calculateSkuConversion(components,parameters,{requireProductName:sku.category!=='INTERMEDIATE'});
 if(!conversion.containerSizeInProductionUom||conversion.containerSizeInProductionUom<=0)
  throw new HttpError(400,'Configure a compatible container size and production form on the SKU.');
 const countUnit=unit(input.ratingUnitCode,'Count'),time=unit(input.periodUnitCode,'Time');
 const output=throughputOutput(input.ratingOutputCode||'PRIMARY_CONTAINER');
 if(!output)throw new HttpError(400,'Selected throughput output type is not published.');
 const perPack=conversion.containersPerPackage,perTransport=conversion.primaryContainersPerTransportUnit;
 let perOutput:number|null=null;
 if(output.kind==='PRIMARY')perOutput=1;
 else if(output.kind==='COMMERCIAL')perOutput=perPack;
 else if(output.kind==='LOGISTICS')perOutput=perTransport;
 else if(output.kind==='MEASURE'){
  const converted=skuUnitConversion(output.unitCode||'',conversion.productionUom);
  if(converted!==null)perOutput=converted/conversion.containerSizeInProductionUom;
 }else if(output.kind==='CUSTOM')perOutput=input.primaryContainersPerRatedOutput??null;
 if(!perOutput||!Number.isFinite(perOutput)||perOutput<=0)
  throw new HttpError(400,
   output.kind==='COMMERCIAL'?'Configure the selected SKU commercial-packaging ratio before rating cases or packs.':
   output.kind==='LOGISTICS'?'Configure the SKU transport-packaging hierarchy before rating pallets or loads.':
   output.kind==='MEASURE'?'This measured output unit is incompatible with the SKU production form or container size.':
   'Configure a positive conversion between the rated output and physical primary units.');
 const physicalContainers=input.ratingQuantity*countUnit.multiplier*perOutput;
 if(!Number.isFinite(physicalContainers)||physicalContainers<=0||physicalContainers>1e15)
  throw new HttpError(400,'Derived primary-unit count is outside the supported range.');
 const packages=perPack&&perPack>0?physicalContainers/perPack:null;
 const transport=perTransport&&perTransport>0?physicalContainers/perTransport:null;
 const productionForm=parameters.find(p=>p.id===components.productionFormId&&p.kind==='productionForms');
 const commercial=parameters.find(p=>p.id===components.packageId&&p.kind==='packages');
 const logistics=parameters.find(p=>p.id===components.transportPackageId&&p.kind==='transportPackages');
 const norm=parameters.find(p=>p.id===components.normalizationUnitId&&p.kind==='normalizationUnits');
 const formQuantity=physicalContainers*conversion.containerSizeInProductionUom;
 const finishedUnit=commercial?.name||displayUnit(conversion.productionUom);
 // Unpackaged/bulk finished output is measured in the production-form UoM;
 // never pretend that a case or pallet exists when it was not required.
 const finalQuantity=commercial&&packages!==null?packages:formQuantity;
 const normalized=conversion.productionQtyPerNormalizationUnit&&conversion.productionQtyPerNormalizationUnit>0
  ?formQuantity/conversion.productionQtyPerNormalizationUnit:null;
 return {
  source:{containerName:container.name,containerCategory:str(container.categoryCode),
   containerSubcategory:str(container.subcategoryCode),
   containerAttributes:container.containerAttributes??{},
   sizeName:manualCapacity
    ?String(components.containerCapacityQuantity)+' '+displayUnit(str(components.containerCapacityUom))
    :legacySize?.name||'Unspecified legacy size',
   countUnit:countUnit.symbol,timeUnit:time.symbol,
   ratedUnits:input.ratingQuantity,physicalContainers:cap(physicalContainers),
   ratingOutputCode:output.code,ratingOutputName:output.name,
   primaryContainersPerRatedOutput:cap(perOutput)},
  physicalContainers:projected(physicalContainers,container.name+' / '+time.symbol,
     container.name),
  productionForm:projected(formQuantity,displayUnit(conversion.productionUom)+' / '+time.symbol,
     productionForm?.name||'Production form'),
  finalProduct:projected(finalQuantity,finishedUnit+' / '+time.symbol,sku.name,
    commercial?'Finished-product package conversion is not configured.':undefined),
  commercialPackaging:projected(packages,(commercial?.name||'commercial packages')+' / '+time.symbol,
     commercial?.name||'Commercial packaging',
     conversion.requiresCommercialPackaging?'Commercial packaging ratio is not configured.':'Commercial packaging is not required for this SKU.'),
  transportLogistics:projected(transport,(logistics?.name||'transport units')+' / '+time.symbol,
     logistics?.name||'Transport & logistics',
     conversion.requiresTransportPackaging?'Transport packaging ratio is not configured.':'Transport packaging is not required for this SKU.'),
  normalised:projected(normalized,(norm?.name||'normalized units')+' / '+time.symbol,
     norm?.name||'Normalization','Normalization reference is not configured.'),
 };
}
export function physicalRatingUnits(){
 return {count:PROCUREMENT_UNITS.filter(x=>x.active&&x.selectable&&x.category==='Count')
    .map(x=>({code:x.code,name:x.label,symbol:x.symbol,multiplier:x.multiplier,categoryCode:x.categoryCode})),
  time:PROCUREMENT_UNITS.filter(x=>x.active&&x.selectable&&x.category==='Time'&&
     ['Second','Minute','Hour','Day'].includes(x.label))
    .map(x=>({code:x.code,name:x.label,symbol:x.symbol,multiplier:x.multiplier,categoryCode:x.categoryCode}))};
}
