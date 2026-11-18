/**
 * Organization-level material handling, shared across all manufacturing methods.
 * Old terminology fields are ignored when loading and never persisted by new saves.
 */
import {HttpError, getDoc, isObj} from './core';
export type MfgMaterialPolicy={
 allowRawUtility:boolean;
 allowRawDirect:boolean;
 allowPackagingDirect:boolean;
 defaultIntermediateTracking:'STOCKED'|'NON_STOCKED';
};
export function defaultMfgMaterialPolicy():MfgMaterialPolicy{
 return {allowRawUtility:true,allowRawDirect:false,allowPackagingDirect:false,
  defaultIntermediateTracking:'NON_STOCKED'};
}
export function normalizeMfgMaterialPolicy(input:unknown):MfgMaterialPolicy{
 if(!isObj(input))throw new HttpError(400,'Manufacturing material policy must be an object.');
 const d=defaultMfgMaterialPolicy();
 const bool=(key:'allowRawUtility'|'allowRawDirect'|'allowPackagingDirect')=>{
  const value=input[key];
  if(value===undefined)return d[key];
  if(typeof value!=='boolean')throw new HttpError(400,'Invalid material handling setting.');
  return value;
 };
 const tracking=input.defaultIntermediateTracking??d.defaultIntermediateTracking;
 if(tracking!=='STOCKED'&&tracking!=='NON_STOCKED')
  throw new HttpError(400,'Choose stock-managed or non-stock intermediate tracking.');
 return {allowRawUtility:bool('allowRawUtility'),allowRawDirect:bool('allowRawDirect'),
  allowPackagingDirect:bool('allowPackagingDirect'),defaultIntermediateTracking:tracking};
}
export const mfgMaterialPolicyPath=(orgId:string)=>'organizations/'+orgId+'/mfg_material_policy/config';
export async function mfgMaterialPolicyForOrg(orgId:string):Promise<{policy:MfgMaterialPolicy;revision:number}>{
 const doc=await getDoc(mfgMaterialPolicyPath(orgId));
 if(!doc)return {policy:defaultMfgMaterialPolicy(),revision:0};
 try{return {policy:normalizeMfgMaterialPolicy(doc.data.policy),revision:Number(doc.data.revision)||0};}
 catch{throw new HttpError(409,'Manufacturing material policy requires administrator review.');}
}
