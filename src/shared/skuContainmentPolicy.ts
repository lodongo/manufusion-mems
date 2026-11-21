/** Shared per-SKU containment and optional packaging rules.
 * Do not confuse this with physical asset classification or stock ownership.
 * Legacy records infer requirements from their configured package references. */
export type SkuContainmentScope='PRIMARY_CONTAINER'|'BULK_STORAGE'|'NONE';
export type SkuPackagingNeeds={
    containmentScope?:SkuContainmentScope;
    requiresCommercialPackaging?:boolean;
    requiresTransportPackaging?:boolean;
    containerId?:string;containerSizeId?:string;packageId?:string;
    packagingSizeId?:string;packageCountId?:string;transportPackageId?:string;
};
export const BULK_STORAGE_CONTAINER_CATEGORY='BST';
export const SKU_CONTAINMENT_SCOPES=[
    {code:'PRIMARY_CONTAINER',label:'Packaged / primary container'},
    {code:'BULK_STORAGE',label:'Bulk storage (tank, silo, hopper, vessel, etc.)'},
    {code:'NONE',label:'No physical container (direct / process flow)'},
] as const;

export function skuContainmentNeeds(values:SkuPackagingNeeds){
    if(values.containmentScope!==undefined&&!SKU_CONTAINMENT_SCOPES.some(x=>x.code===values.containmentScope))
        throw new Error('Choose a valid physical containment scope.');
    if(values.requiresCommercialPackaging!==undefined&&typeof values.requiresCommercialPackaging!=='boolean')
        throw new Error('Commercial packaging requirement must be Yes or No.');
    if(values.requiresTransportPackaging!==undefined&&typeof values.requiresTransportPackaging!=='boolean')
        throw new Error('Transport packaging requirement must be Yes or No.');
    const containmentScope=values.containmentScope||(values.containerId?'PRIMARY_CONTAINER':'NONE');
    return {
        containmentScope,
        requiresCommercialPackaging:values.requiresCommercialPackaging
            ??!!(values.packageId||values.packagingSizeId||values.packageCountId),
        requiresTransportPackaging:values.requiresTransportPackaging??!!values.transportPackageId,
    };
}
