/** Diagnose physical-container readiness before attempting commissioned SKU capacity.
 * A provisional cost-centre tank does NOT write back to the SKU master.
 * Keep errors actionable and avoid duplicate "mismatch" messages for missing setup. */
export type SkuContainerComposition={
    containmentScope?:string;
    containerId?:string;
    containerSizeId?:string;
    containerCapacityQuantity?:number;
    containerCapacityUom?:string;
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
    status:'READY'|'MISSING_SKU'|'SKU_SETUP_REQUIRED'|'NOT_CONTAINER_RATED'|'APPLY_SKU_SETUP'|'INTERMEDIATE_NO_SPEED';
    message:string;
};

export function skuRatingReadiness(
    sku:SkuMasterForRating|null|undefined,
    rating:SkuContainerRatingSelection,
):SkuRatingReadiness{
    if(!sku)return {status:'MISSING_SKU',message:'Choose an existing manufactured SKU before commissioning a rating.'};
    if(sku.category==='INTERMEDIATE')return {
        status:'INTERMEDIATE_NO_SPEED',
        message:'Intermediate/WIP SKUs are allocated without commissioned-speed calculations. Enter physical container capacity in Materials & Products only when containment applies.',
    };
    const selection=sku.skuComponents??{};
    const manualCapacity=selection.containerCapacityQuantity!==undefined||
        selection.containerCapacityUom!==undefined;
    const capacityReady=manualCapacity
        ?typeof selection.containerCapacityQuantity==='number'&&Number.isFinite(selection.containerCapacityQuantity)&&
            selection.containerCapacityQuantity>0&&!!selection.containerCapacityUom
        :!!selection.containerSizeId;
    if(selection.containmentScope==='NONE')return {
        status:'NOT_CONTAINER_RATED',
        message:'This SKU is configured for direct process flow without physical containment. A physical-container rating does not apply. Use a suitable process/resource capacity basis, or configure physical containment on the SKU first.',
    };
    if(!selection.productionFormId||!selection.containerId||!capacityReady){
        const missing=[
            !selection.productionFormId?'production form':null,
            !selection.containerId?'physical container (tank, silo, bottle, etc.)':null,
            !capacityReady?'manually entered physical container capacity and unit':null,
        ].filter(Boolean).join(', ');
        return {
            status:'SKU_SETUP_REQUIRED',
            message:`Complete the SKU master in Materials & Products before commissioning a rate. Missing: ${missing}. Selecting a container here does not configure the SKU master.`,
        };
    }
    if(rating.containerId!==selection.containerId||
        !manualCapacity&&rating.containerSizeId!==selection.containerSizeId)return {
        status:'APPLY_SKU_SETUP',
        message:'The selected cost-centre physical container differs from the saved SKU. Apply the SKU’s configured container; its capacity is defined directly on the SKU.',
    };
    return {status:'READY',message:'Physical container matches the saved SKU. Capacity comes from the SKU master.'};
}
