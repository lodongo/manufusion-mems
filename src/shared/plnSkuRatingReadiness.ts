/** Diagnose physical-container readiness before attempting commissioned SKU capacity.
 * A provisional cost-centre tank does NOT write back to the SKU master.
 * Keep errors actionable and avoid duplicate "mismatch" messages for missing setup. */
export type SkuContainerComposition={
    containmentScope?:string;
    containerId?:string;
    containerSizeId?:string;
    productionFormId?:string;
};
export type SkuMasterForRating={
    id:string;
    name:string;
    category?:string;
    skuComponents?:SkuContainerComposition|null;
};
export type SkuContainerRatingSelection={
    containerId?:string;
    containerSizeId?:string;
};
export type SkuRatingReadiness={
    status:'READY'|'MISSING_SKU'|'SKU_SETUP_REQUIRED'|'NOT_CONTAINER_RATED'|'APPLY_SKU_SETUP';
    message:string;
};

export function skuRatingReadiness(
    sku:SkuMasterForRating|null|undefined,
    rating:SkuContainerRatingSelection,
):SkuRatingReadiness{
    if(!sku)return {status:'MISSING_SKU',message:'Choose an existing manufactured SKU before commissioning a rating.'};
    const selection=sku.skuComponents??{};
    if(selection.containmentScope==='NONE')return {
        status:'NOT_CONTAINER_RATED',
        message:'This SKU is configured for direct process flow without physical containment. A physical-container rating does not apply. Use a suitable process/resource capacity basis, or configure physical containment on the SKU first.',
    };
    if(!selection.productionFormId||!selection.containerId||!selection.containerSizeId){
        const missing=[
            !selection.productionFormId?'production form':null,
            !selection.containerId?'physical container (tank, silo, bottle, etc.)':null,
            !selection.containerSizeId?'physical container size/capacity':null,
        ].filter(Boolean).join(', ');
        return {
            status:'SKU_SETUP_REQUIRED',
            message:`Complete the SKU master in Materials & Products before commissioning a rate. Missing: ${missing}. Selecting a container here does not configure the SKU master.`,
        };
    }
    if(rating.containerId!==selection.containerId||rating.containerSizeId!==selection.containerSizeId)return {
        status:'APPLY_SKU_SETUP',
        message:'The selected cost-centre container or size differs from the saved SKU. Apply the SKU’s configured container and size; do not re-enter or guess conversions.',
    };
    return {status:'READY',message:'Physical container and capacity match the saved SKU.'};
}
