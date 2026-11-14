// Rule 2: internal means generated within this equipment; external means supplied from another registered asset.
// Old records used the opposite flag; preserve their linking requirement and never silently discard a connection.
export function isInternalUtilitySupply(row:Record<string,unknown>):boolean{
    if(row.supplyLinkRule===2)return row.isInternalSupply===true;
    return row.isInternalSupply===false && !row.sourceAssetTag;
}
export const requiresUtilityAsset=(row:Record<string,unknown>)=>!isInternalUtilitySupply(row);
