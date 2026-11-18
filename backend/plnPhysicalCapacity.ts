/**
 * One commissioned rating basis: physical primary-container count / configured time unit.
 * Use the organization's adopted Physical Container parameters and the SKU's own
 * approved composition to derive form, commercial and logistics capacities.
 */
import {HttpError,str} from './core';
import {PROCUREMENT_UNITS} from './procurementUnits';
import {calculateSkuConversion,type SkuComponents,type SkuParameter} from './mfgSkuModel';

export type PhysicalRating={
 skuId:string;containerId:string;containerSizeId:string;
 containerCategoryCode:string;containerSubcategoryCode:string;
 ratingQuantity:number;ratingUnitCode:string;periodUnitCode:string;
};
export type RatedQuantity={quantity:number|null;unit:string;name:string;reason?:string};
export type CapacityProjection={
 source:{containerName:string;containerCategory:string;containerSubcategory:string;
  containerAttributes:Record<string,string>;sizeName:string;countUnit:string;timeUnit:string;
  ratedUnits:number;physicalContainers:number};
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
 const ratingUnitCode=id(x.ratingUnitCode,'physical-container Count unit');
 const periodUnitCode=id(x.periodUnitCode,'Time unit');
 unit(ratingUnitCode,'Count');unit(periodUnitCode,'Time');
 return {skuId:id(x.skuId,'manufactured SKU'),
  containerId:id(x.containerId,'adopted Physical Container'),
  containerSizeId:id(x.containerSizeId,'physical-container size'),
  containerCategoryCode:id(x.containerCategoryCode,'container category'),
  containerSubcategoryCode:id(x.containerSubcategoryCode,'container subcategory'),
  ratingQuantity,ratingUnitCode,periodUnitCode};
}
const projected=(value:number|null,unitCode:string,name:string,reason?:string):RatedQuantity=>({
 quantity:value===null?null:cap(value),unit:unitCode,name,
 ...(value===null?{reason:reason||'Not configured in this SKU'}:{}),
});
export function derivePhysicalCapacity(
 sku:{id:string;name:string;uom:string;skuComponents:SkuComponents},
 parameters:SkuParameter[],input:PhysicalRating,
):CapacityProjection{
 if(sku.id!==input.skuId)throw new HttpError(400,'The rating must use the selected manufactured SKU.');
 const components=sku.skuComponents;
 const container=parameters.find(p=>p.kind==='containers'&&p.id===input.containerId&&p.enabled!==false);
 const size=parameters.find(p=>p.kind==='containerSizes'&&p.id===input.containerSizeId&&p.enabled!==false);
 if(!container||!size)throw new HttpError(400,'Select active physical-container properties and size.');
 if(input.containerId!==str(components.containerId)||input.containerSizeId!==str(components.containerSizeId))
  throw new HttpError(400,'Physical container and size must match the selected SKU composition.');
 if(str(container.categoryCode)!==input.containerCategoryCode||
    str(container.subcategoryCode)!==input.containerSubcategoryCode)
  throw new HttpError(400,'Physical container category or subcategory does not match its adopted configuration.');
 const conversion=calculateSkuConversion(components,parameters);
 if(!conversion.containerSizeInProductionUom||conversion.containerSizeInProductionUom<=0)
  throw new HttpError(400,'Configure a compatible container size and production form on the SKU.');
 const countUnit=unit(input.ratingUnitCode,'Count'),time=unit(input.periodUnitCode,'Time');
 const physicalContainers=input.ratingQuantity*countUnit.multiplier;
 if(!Number.isFinite(physicalContainers)||physicalContainers<=0||physicalContainers>1e15)
  throw new HttpError(400,'Commissioned count is outside the supported range.');
 const perPack=conversion.containersPerPackage,perTransport=conversion.primaryContainersPerTransportUnit;
 const packages=perPack&&perPack>0?physicalContainers/perPack:null;
 const transport=perTransport&&perTransport>0?physicalContainers/perTransport:null;
 const productionForm=parameters.find(p=>p.id===components.productionFormId&&p.kind==='productionForms');
 const commercial=parameters.find(p=>p.id===components.packageId&&p.kind==='packages');
 const logistics=parameters.find(p=>p.id===components.transportPackageId&&p.kind==='transportPackages');
 const norm=parameters.find(p=>p.id===components.normalizationUnitId&&p.kind==='normalizationUnits');
 const formQuantity=physicalContainers*conversion.containerSizeInProductionUom;
 const rateUnit=displayUnit(sku.uom);
 // Finished goods are commercial-packaged units when a package is selected;
 // count codes alone are not sufficient to infer whether each means a bottle or a case.
 const finalQuantity=commercial&&packages!==null?packages:null;
 const normalized=conversion.productionQtyPerNormalizationUnit&&conversion.productionQtyPerNormalizationUnit>0
  ?formQuantity/conversion.productionQtyPerNormalizationUnit:null;
 return {
  source:{containerName:container.name,containerCategory:str(container.categoryCode),
   containerSubcategory:str(container.subcategoryCode),
   containerAttributes:container.containerAttributes??{},sizeName:size.name,
   countUnit:countUnit.symbol,timeUnit:time.symbol,
   ratedUnits:input.ratingQuantity,physicalContainers:cap(physicalContainers)},
  physicalContainers:projected(physicalContainers,'primary containers / '+time.symbol,
     container.name),
  productionForm:projected(formQuantity,displayUnit(conversion.productionUom)+' / '+time.symbol,
     productionForm?.name||'Production form'),
  finalProduct:projected(finalQuantity,rateUnit+' / '+time.symbol,sku.name,
    'Finished-product package conversion is not configured.'),
  commercialPackaging:projected(packages,displayUnit(commercial?.uom||'commercial packages')+' / '+time.symbol,
     commercial?.name||'Commercial packaging','Commercial packaging ratio is not configured.'),
  transportLogistics:projected(transport,displayUnit(logistics?.uom||'transport units')+' / '+time.symbol,
     logistics?.name||'Transport & logistics','Transport packaging ratio is not configured.'),
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
