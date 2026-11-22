/** Universal material production/supply metadata.
 * Source records identify cost bases and meter references; they are configuration
 * only and never create purchases, water extractions or inventory transactions.
 */
import {HttpError,str,type Obj,isObj} from './core';
import {skuUnitConversion} from './mfgSkuModel';

const modes=['CONTINUOUS','BATCH','DISCRETE','NOT_PRODUCED'] as const;
const handling=['INLINE','BUFFERED_BULK','BULK_STORAGE','PACKAGED','CYLINDER'] as const;
const sources=['PURCHASED','EXTRACTED','MANUFACTURED','RECOVERED','EXTERNAL','OTHER'] as const;
const inList=(value:unknown,items:readonly string[],fallback:string)=>{
 const x=str(value).trim();
 if(!x)return fallback;
 if(!items.includes(x))throw new HttpError(400,'Unsupported material production or supply method: '+x);
 return x;
};
export function normalizeMaterialSupplyProfile(raw:unknown,materialUom:string):Obj{
 const p=isObj(raw)?raw:{};
 const productionMode=inList(p.productionMode,modes,'');
 const handlingMode=inList(p.handlingMode,handling,'');
 const qualitySpecification=str(p.qualitySpecification).trim().slice(0,500);
 const entries=Array.isArray(p.sources)?p.sources:[];
 if(entries.length>30)throw new HttpError(400,'A material may have at most 30 configured supply sources.');
 const seen=new Set<string>();
 const normalized=entries.map((source,i)=>{
  if(!isObj(source))throw new HttpError(400,'Supply source '+(i+1)+' must be an object.');
  const id=str(source.id).trim(),name=str(source.name).trim(),type=inList(source.type,sources,'OTHER');
  if(!/^[A-Za-z0-9_-]{2,40}$/.test(id))
   throw new HttpError(400,'Source identifier must be 2–40 letters, numbers, hyphens or underscores.');
  if(seen.has(id))throw new HttpError(400,'Duplicate material source identifier: '+id);
  seen.add(id);
  if(!name||name.length>120)throw new HttpError(400,'Supply source needs a name of up to 120 characters.');
  const rateUom=str(source.rateUom).trim()||materialUom;
  if(rateUom&&materialUom&&skuUnitConversion(rateUom,materialUom)===null)
   throw new HttpError(400,'Supply source price unit must be convertible to the material SKU unit.');
  const siteId=str(source.siteId).trim();
  const meterReference=str(source.meterReference).trim().slice(0,100);
  const currency=str(source.currency).trim().toUpperCase();
  const enteredCost=source.unitCost;
  const hasCost=enteredCost!==undefined&&enteredCost!==null&&enteredCost!=='';
  const unitCost=hasCost?Number(enteredCost):null;
  if(hasCost&&(!Number.isFinite(unitCost)||Number(unitCost)<0||Number(unitCost)>1e12))
   throw new HttpError(400,'Supply source cost per unit must be nonnegative.');
  if(hasCost&&!/^[A-Z]{3}$/.test(currency))
   throw new HttpError(400,'Source with a unit cost needs a 3-letter currency code.');
  return {id,name,type,siteId,rateUom,meterReference,
   unitCost,currency:hasCost?currency:'',notes:str(source.notes).trim().slice(0,300)};
 });
 return {productionMode,handlingMode,qualitySpecification,sources:normalized};
}
