/**
 * Tenant-controlled, industry-neutral manufacturing material conventions.
 * This config changes labels and permitted material handling modes, not historical
 * BOM IDs, item categories, inventory ledgers or production transactions.
 */
import {HttpError, getDoc, isObj, str} from './core';

export const MFG_INDUSTRIES=['BEVERAGE','METALS','FOOTWEAR','GENERAL'] as const;
export type MfgIndustry=typeof MFG_INDUSTRIES[number];
export type MfgMaterialPolicy={
 industry:MfgIndustry;
 variantLabel:string; manufacturingBomLabel:string; packagingBomLabel:string;
 allowRawUtility:boolean;allowRawDirect:boolean;allowPackagingDirect:boolean;
 defaultIntermediateTracking:'STOCKED'|'NON_STOCKED';
};
const labels:Record<MfgIndustry,Pick<MfgMaterialPolicy,'variantLabel'|'manufacturingBomLabel'|'packagingBomLabel'>>={
 BEVERAGE:{variantLabel:'Flavor/Variant',manufacturingBomLabel:'Flavor/Variant BOM',packagingBomLabel:'Packaging BOM'},
 METALS:{variantLabel:'Grade/Specification',manufacturingBomLabel:'Manufacturing BOM',packagingBomLabel:'Packaging BOM'},
 FOOTWEAR:{variantLabel:'Style/Color/Size',manufacturingBomLabel:'Assembly BOM',packagingBomLabel:'Packaging BOM'},
 GENERAL:{variantLabel:'Product/Variant',manufacturingBomLabel:'Manufacturing BOM',packagingBomLabel:'Packaging BOM'},
};
export const MFG_INDUSTRY_LABELS=labels;
export function defaultMfgMaterialPolicy(industry:MfgIndustry='BEVERAGE'):MfgMaterialPolicy{
 return {industry,...labels[industry],allowRawUtility:true,allowRawDirect:false,
    allowPackagingDirect:false,defaultIntermediateTracking:'NON_STOCKED'};
}
const label=(input:unknown,base:string):string=>{
 const value=str(input).trim()||base;
 if(value.length>60||/[<>]/.test(value))throw new HttpError(400,'Material terminology must be plain text up to 60 characters.');
 return value;
};
export function normalizeMfgMaterialPolicy(input:unknown):MfgMaterialPolicy{
 if(!isObj(input))throw new HttpError(400,'Manufacturing material policy must be an object.');
 const industry=input.industry;
 if(!MFG_INDUSTRIES.includes(industry as MfgIndustry))throw new HttpError(400,'Choose a supported manufacturing industry profile.');
 const base=defaultMfgMaterialPolicy(industry as MfgIndustry);
 const bool=(key:'allowRawUtility'|'allowRawDirect'|'allowPackagingDirect')=>{
   if(input[key]===undefined)return base[key];
   if(typeof input[key]!=='boolean')throw new HttpError(400,key+' must be enabled or disabled.');
   return input[key] as boolean;
 };
 const intermediate=input.defaultIntermediateTracking??base.defaultIntermediateTracking;
 if(intermediate!=='STOCKED'&&intermediate!=='NON_STOCKED')
    throw new HttpError(400,'Choose stocked or non-stocked intermediate tracking.');
 return {industry:base.industry,variantLabel:label(input.variantLabel,base.variantLabel),
    manufacturingBomLabel:label(input.manufacturingBomLabel,base.manufacturingBomLabel),
    packagingBomLabel:label(input.packagingBomLabel,base.packagingBomLabel),
    allowRawUtility:bool('allowRawUtility'),allowRawDirect:bool('allowRawDirect'),
    allowPackagingDirect:bool('allowPackagingDirect'),defaultIntermediateTracking:intermediate};
}
export const mfgMaterialPolicyPath=(orgId:string)=>'organizations/'+orgId+'/mfg_material_policy/config';
export async function mfgMaterialPolicyForOrg(orgId:string):Promise<{policy:MfgMaterialPolicy;revision:number}>{
 const doc=await getDoc(mfgMaterialPolicyPath(orgId));
 if(!doc)return {policy:defaultMfgMaterialPolicy(),revision:0};
 try{return {policy:normalizeMfgMaterialPolicy(doc.data.policy),revision:Number(doc.data.revision)||0};}
 catch{throw new HttpError(409,'Saved manufacturing material policy is invalid. Contact the organization administrator.');}
}
