/**
 * Universal organization manufacturing configuration: material handling and governed BOM classifications.
 * Existing records with older BOM structure codes are projected into the canonical model on read.
 */
import {HttpError,getDoc,isObj,str} from './core';
export type BomClassification={code:string;name:string;enabled:boolean;mrpRelevant:boolean;productionEligible:boolean};
export const DEFAULT_BOM_CLASSIFICATIONS:BomClassification[]=[
 {code:'PRODUCTION',name:'Production',enabled:true,mrpRelevant:true,productionEligible:true},
];
const CLASS_CODE=/^[A-Z][A-Z0-9_]{1,31}$/;
/** Compatibility is private to the persistence boundary, not a user-facing BOM category. */
export function bomClassificationCode(value:unknown):string{
 const record=isObj(value)?value:{};
 const code=str(record.classificationCode).trim().toUpperCase();
 if(code){
  if(!CLASS_CODE.test(code))throw new HttpError(400,'Invalid BOM classification code.');
  return code;
 }
 const old=str(record.type);
 return old==='PACKAGING'||old==='BOM'?'PACKAGING':'PRODUCTION';
}
/** Use prior release-slot addresses for records that have already been approved. */
export function bomReleaseSlotGroup(value:unknown):string{
 const code=bomClassificationCode(value);
 return code==='PRODUCTION'?'MANUFACTURING':code==='PACKAGING'?'PACKAGING':'CLASS_'+code;
}
export function normalizeBomClassifications(input:unknown):BomClassification[]{
 if(!Array.isArray(input)||input.length<1||input.length>30)
  throw new HttpError(400,'Configure between 1 and 30 BOM classifications.');
 const seen=new Set<string>();
 const rows=input.map((raw)=>{
  if(!isObj(raw))throw new HttpError(400,'Invalid BOM classification.');
  const code=str(raw.code).trim().toUpperCase(),name=str(raw.name).trim();
  if(!CLASS_CODE.test(code)||seen.has(code))throw new HttpError(400,'BOM classification codes must be unique and contain 2–32 letters, digits or underscores.');
  if(!name||name.length>80)throw new HttpError(400,'BOM classification names must contain 1–80 characters.');
  for(const key of ['enabled','mrpRelevant','productionEligible'])
   if(typeof raw[key]!=='boolean')throw new HttpError(400,'Invalid BOM classification option: '+key);
  seen.add(code);
  return {code,name,enabled:raw.enabled as boolean,mrpRelevant:raw.mrpRelevant as boolean,
   productionEligible:raw.productionEligible as boolean};
 });
 if(!rows.some(r=>r.code==='PRODUCTION'&&r.enabled&&r.mrpRelevant&&r.productionEligible))
  throw new HttpError(400,'The Production classification must stay enabled for manufacturing and MRP.');
 return rows;
}
export type MfgMaterialPolicy={
 allowRawUtility:boolean;allowRawDirect:boolean;allowPackagingDirect:boolean;
 defaultIntermediateTracking:'STOCKED'|'NON_STOCKED';
 bomClassifications:BomClassification[];
};
export function defaultMfgMaterialPolicy():MfgMaterialPolicy{
 return {allowRawUtility:true,allowRawDirect:false,allowPackagingDirect:false,
  defaultIntermediateTracking:'NON_STOCKED',bomClassifications:DEFAULT_BOM_CLASSIFICATIONS.map(x=>({...x}))};
}
export function normalizeMfgMaterialPolicy(input:unknown):MfgMaterialPolicy{
 if(!isObj(input))throw new HttpError(400,'Manufacturing setup must be an object.');
 const d=defaultMfgMaterialPolicy();
 const bool=(key:'allowRawUtility'|'allowRawDirect'|'allowPackagingDirect')=>{
  if(input[key]===undefined)return d[key];
  if(typeof input[key]!=='boolean')throw new HttpError(400,'Invalid material handling setting.');
  return input[key] as boolean;
 };
 const tracking=input.defaultIntermediateTracking??d.defaultIntermediateTracking;
 if(tracking!=='STOCKED'&&tracking!=='NON_STOCKED')
  throw new HttpError(400,'Choose stock-managed or non-stock intermediate tracking.');
 return {allowRawUtility:bool('allowRawUtility'),allowRawDirect:bool('allowRawDirect'),
  allowPackagingDirect:bool('allowPackagingDirect'),defaultIntermediateTracking:tracking,
  bomClassifications:normalizeBomClassifications(input.bomClassifications??d.bomClassifications)};
}
export const mfgMaterialPolicyPath=(orgId:string)=>'organizations/'+orgId+'/mfg_material_policy/config';
export async function mfgMaterialPolicyForOrg(orgId:string):Promise<{policy:MfgMaterialPolicy;revision:number}>{
 const doc=await getDoc(mfgMaterialPolicyPath(orgId));
 if(!doc)return {policy:defaultMfgMaterialPolicy(),revision:0};
 try{return {policy:normalizeMfgMaterialPolicy(doc.data.policy),revision:Number(doc.data.revision)||0};}
 catch{throw new HttpError(409,'Manufacturing setup needs administrator review.');}
}
