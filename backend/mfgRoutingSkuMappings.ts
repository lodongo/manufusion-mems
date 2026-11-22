/**
 * Shared manufacturing routing templates.
 * A routing owns the common sequence and resources. Additional assigned SKUs
 * can override only output/BOM and timing, never the graph or its cost centres.
 * Pure helpers are shared by authoring, readiness, and effective-release lookup.
 */
type Dict=Record<string,unknown>;
const object=(value:unknown):value is Dict=>!!value&&typeof value==='object'&&!Array.isArray(value);
const objects=(value:unknown):Dict[]=>Array.isArray(value)?value.filter(object):[];
const text=(value:unknown)=>typeof value==='string'?value:'';

export function routingSkuIds(route:Dict):string[]{
 const base=text(route.skuId);
 return [...new Set([base,...objects(route.skuMappings).map(m=>text(m.skuId))].filter(Boolean))];
}
export function routingForSku(route:Dict,skuId:string):Dict|null {
 if(!skuId||!routingSkuIds(route).includes(skuId))return null;
 if(text(route.skuId)===skuId)return {...route,skuId};
 const mapping=objects(route.skuMappings).find(m=>text(m.skuId)===skuId);
 if(!mapping)return null;
 const overrides=new Map(objects(mapping.stages).map(x=>[text(x.code),x]));
 const keys=['producesSkuId','bomId','setupMinutes','runMinutesPerUnit','batchSize','cycleMinutes','capacityBasis'];
 const operations=objects(route.operations).map(step=>{
  const patch=overrides.get(text(step.code));
  if(!patch)return {...step};
  const values:Dict={};
  for(const key of keys)if(Object.prototype.hasOwnProperty.call(patch,key))values[key]=patch[key];
  return {...step,...values};
 });
 return {...route,skuId,operations};
}
