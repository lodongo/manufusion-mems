import type {ToolAttribute} from './maintenanceToolCatalogueSeed';
export type ToolRequirement={id:string;catalogueCode:string;name:string;kind:'Tools'|'Equipment';familyCode:string;discipline:string;category:string;family:string;quantity:number;availability:'available'|'not_available'|'';attributes:Record<string,string>;attributeDefinitions:ToolAttribute[]};
export function normalizeToolRequirements(raw:unknown):ToolRequirement[]|undefined{
 if(raw===undefined)return undefined;
 if(!Array.isArray(raw)||raw.length>100)throw Error('Select up to 100 tools and equipment requirements per task.');
 const ids=new Set<string>();
 const text=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
 return raw.map((v:any)=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid tool or equipment requirement.');
  const id=text(v.id,80),catalogueCode=text(v.catalogueCode,240),quantity=Number(v.quantity),availability=v.availability;
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(id)||ids.has(id)||!catalogueCode||!/^[a-z0-9-]+$/.test(catalogueCode)||!Number.isInteger(quantity)||quantity<1||quantity>100000||!['available','not_available'].includes(availability))throw Error('Every selected tool/equipment requires quantity and readily available or not readily available.');
  ids.add(id);
  if(!v.attributes||typeof v.attributes!=='object'||Array.isArray(v.attributes)||Object.keys(v.attributes).length>30)throw Error('Enter required technical attributes.');
  const attributes=Object.fromEntries(Object.entries(v.attributes).map(([k,val])=>[k,text(val,240)]));
  if(Object.values(attributes).some(x=>!x))throw Error('Complete all required technical attributes.');
  return {id,catalogueCode,quantity,availability,attributes,name:text(v.name),kind:v.kind==='Equipment'?'Equipment':'Tools',familyCode:text(v.familyCode,240),discipline:text(v.discipline),category:text(v.category),family:text(v.family),attributeDefinitions:[]};
 });
}
