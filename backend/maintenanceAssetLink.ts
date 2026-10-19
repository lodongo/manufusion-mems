/** Resolve an existing one-to-one equipment↔asset link for maintenance.
 * A nearby asset is not a substitute for a configured link.
 * Legacy reverse-only links are accepted only when unique.
 */
export interface MaintenanceLinkedAsset {
    id:string;
    status:string;
    workCenterId:string;
}
const validStatuses=new Set(['active','change_pending','pending_approval']);
export function resolveMaintenanceEquipmentAsset(unitId:string,equipmentAssetTag:string,assets:MaintenanceLinkedAsset[]):string {
    if(!unitId)throw new Error('This assembly is not under an equipment unit. Configure its equipment location first.');
    const reverse=assets.filter(a=>a.workCenterId===unitId&&!['disposed','deleted','rejected'].includes(a.status));
    if(reverse.length>1)throw new Error('Multiple assets point to the same equipment unit. Repair the one-to-one asset mapping in Asset Management.');
    const forward=equipmentAssetTag?assets.find(a=>a.id===equipmentAssetTag):undefined;
    if(equipmentAssetTag&&!forward)throw new Error('The equipment references an asset that is missing from Asset Management. Repair its asset mapping.');
    if(forward&&forward.workCenterId!==unitId)throw new Error('The equipment and asset links disagree. Repair the one-to-one mapping in Asset Management.');
    if(forward&&reverse.length&&reverse[0].id!==forward.id)throw new Error('The equipment and asset links conflict. Repair the one-to-one mapping in Asset Management.');
    const asset=forward||reverse[0];
    if(!asset)throw new Error('This equipment has no linked asset. Link one in Equipment / Asset Management before raising a work request.');
    if(!validStatuses.has(asset.status))throw new Error('The equipment-linked asset is not active or awaiting approval. Check its status in Asset Management.');
    return asset.id;
}
