/**
 * Controlled manufacturing packaging-type metadata. Includes secondary
 * packaging, unit-load consolidation, transport/logistics and returnable
 * handling units. The categories are platform master data; organizations
 * adopt an appropriate type and configure the quantity per layer and layers.
 */
import { HttpError, str } from './core';

export type PackagingLevel='SECONDARY'|'TERTIARY'|'TRANSPORT'|'BULK'|'SERVICE';
export type PackagingContents='PRIMARY'|'PACKAGING';
export type MfgPackagingType={
    code:string;name:string;category:string;subcategory:string;
    level:PackagingLevel;containedUnit:PackagingContents;
    description:string;defaultUnitCode:string;
};
const GROUPS:Array<{code:string;category:string;level:PackagingLevel;containedUnit:PackagingContents;names:string[]}>= [
    {code:'SEC',category:'Secondary / retail packaging',level:'SECONDARY',containedUnit:'PRIMARY',
        names:['Corrugated case','Cardboard carton','Shrink-wrapped pack','Tray','Tray with shrink film','Cluster pack','Multipack carrier','Six-pack ring','Basket carrier','Sleeve pack','Display-ready case','Retail box','Blister card pack','Bundled bottles','Bottle divider case','Returnable bottle crate','Transit carton','Pouch multipack','Folding carton','Rigid retail box']},
    {code:'TER',category:'Tertiary / consolidated packaging',level:'TERTIARY',containedUnit:'PACKAGING',
        names:['Master carton','Outer case','Transit shipper','Overpack','Consolidation tote','Distribution crate','Pallet display','Mixed-SKU shipping box','Bulk parcel','Nested crate','Shipping cage','Roll-container tote','Collapsible bulk bin','Transport dolly','Pallet box']},
    {code:'PAL',category:'Pallets and unit loads',level:'TRANSPORT',containedUnit:'PACKAGING',
        names:['Wooden pallet','Plastic pallet','Metal pallet','Euro pallet','Industrial pallet','Export pallet','CHEP pallet','Block pallet','Stringer pallet','Half pallet','Quarter pallet','Slip sheet unit load','Pallet with stretch wrap','Pallet with shrink hood','Pallet with corner boards','Strapped pallet load','Pallet cage','Pallet collar load','Stackable bulk pallet','Palletized IBC']},
    {code:'LOG',category:'Transport and logistics',level:'TRANSPORT',containedUnit:'PACKAGING',
        names:['Roll cage','Roll container','Pallet jack compatible dolly','Shipping rack','Returnable transit rack','Stillage','Metal tote','Plastic bulk tote','Collapsible IBC','Freight cage','ULD air cargo container','Cargo skid','Unit load device','Shipping container unit load','Vehicle loading unit','Reusable transport case','Insulated shipper','Cold chain shipper']},
    {code:'BUL',category:'Bulk and densified loads',level:'BULK',containedUnit:'PACKAGING',
        names:['Flexible intermediate bulk container','Big bag on pallet','Bulk super sack','Bulk bin','Bag-in-box bulk shipper','Bulk drum pallet','Drum bundling rack','Jumbo roll shipping frame','Coil cradle','Sheet material stillage','Bagged grain pallet','Compressed bale','Baled textile load','Baled recyclable load','Strapped timber bundle','Pipe bundle','Long-product shipping rack','Heavy machinery transport frame','Bulk liquid tote']},
    {code:'RET',category:'Returnable and reverse logistics',level:'SERVICE',containedUnit:'PACKAGING',
        names:['Returnable crate stack','Returnable pallet','Pooled pallet','Reusable tray stack','Stackable tote set','Nesting tote set','Returnable folding bin','Bottle crate pallet','Refrigerated returnable container','Reverse logistics cage','Folding plastic crate','Returnable steel rack','Reclosable delivery box']},
];
export const MFG_PACKAGING_TYPES:MfgPackagingType[]=GROUPS.flatMap(group=>group.names.map((name,i)=>{
    const code=group.code+'_'+String(i+1).padStart(3,'0');
    return {code,name,category:group.category,subcategory:name,
        level:group.level,containedUnit:group.containedUnit,
        description:group.category+' · '+name,defaultUnitCode:'UOM-20-001'};
}));
export const MFG_PACKAGING_CATEGORIES=GROUPS.map(x=>({code:x.code,name:x.category,level:x.level}));
export function normalizePackagingTypes(source:unknown):MfgPackagingType[]{
    if(!Array.isArray(source))return MFG_PACKAGING_TYPES;
    const result:MfgPackagingType[]=[],codes=new Set<string>();
    for(const item of source){
        if(!item||typeof item!=='object'||Array.isArray(item))continue;
        const row=item as Record<string,unknown>;
        if(row.active===false||row.selectable===false)continue;
        const code=str(row.code),name=str(row.label),category=str(row.category),
            level=str(row.level),containedUnit=str(row.containedUnit);
        if(!/^[A-Z]{3}_\d{3}$/.test(code)||!name||!category||codes.has(code)||
            !['SECONDARY','TERTIARY','TRANSPORT','BULK','SERVICE'].includes(level)||
            !['PRIMARY','PACKAGING'].includes(containedUnit))continue;
        codes.add(code);
        result.push({code,name,category,subcategory:str(row.subcategory)||name,
            level:level as PackagingLevel,containedUnit:containedUnit as PackagingContents,
            description:str(row.description),defaultUnitCode:str(row.defaultUnitCode)||'UOM-20-001'});
    }
    return result.length?result:MFG_PACKAGING_TYPES;
}
export function packagingHierarchyRank(typeCode:string):number{
    const prefix=typeCode.slice(0,3);
    return ({SEC:1,TER:2,PAL:3,LOG:4,RET:4,BUL:5} as Record<string,number>)[prefix]??0;
}
export function validatePackagingLayout(raw:Record<string,unknown>,types:MfgPackagingType[]=MFG_PACKAGING_TYPES){
    const type=types.find(x=>x.code===str(raw.packagingTypeCode));
    if(!type)throw new HttpError(400,'Select a published MEMS packaging type.');
    const unitsPerLayer=Number(raw.containersPerLayer),layers=Number(raw.numberOfLayers);
    if(!Number.isSafeInteger(unitsPerLayer)||unitsPerLayer<1||unitsPerLayer>1000000)
        throw new HttpError(400,'Containers or packaged units per layer must be a positive whole number.');
    if(!Number.isSafeInteger(layers)||layers<1||layers>100000)
        throw new HttpError(400,'Number of layers must be a positive whole number.');
    const quantity=unitsPerLayer*layers;
    if(!Number.isSafeInteger(quantity)||quantity>10000000)
        throw new HttpError(400,'Consolidated load exceeds the supported unit count.');
    const containedPackagingId=str(raw.containedPackagingId);
    if(type.containedUnit==='PACKAGING'&&!containedPackagingId)
        throw new HttpError(400,'Select the lower-level container packaging consolidated into this load.');
    if(type.containedUnit==='PRIMARY'&&containedPackagingId)
        throw new HttpError(400,'Secondary packaging contains primary containers, not a separate package record.');
    return {packagingTypeCode:type.code,level:type.level,containedUnit:type.containedUnit,
        containedPackagingId:type.containedUnit==='PACKAGING'?containedPackagingId:'',
        containersPerLayer:unitsPerLayer,numberOfLayers:layers,quantity,
        uom:type.defaultUnitCode};
}
