import { str, type Fields } from './core';

/** Exact classification is required in both directions; a common category on its own
 * never qualifies an asset for linking to an equipment unit. */
export function identicalAssetEquipmentClass(
    asset: Pick<Fields, 'categoryCode' | 'subcategoryCode' | 'classCode'>,
    equipment: Pick<Fields, 'categoryCode' | 'subcategoryCode' | 'classCode'>,
): boolean {
    return Boolean(str(asset.classCode) && str(asset.categoryCode) && str(asset.subcategoryCode) &&
        str(asset.classCode) === str(equipment.classCode) &&
        str(asset.categoryCode) === str(equipment.categoryCode) &&
        str(asset.subcategoryCode) === str(equipment.subcategoryCode));
}

export function assetIsAssignable(asset: Fields, equipmentId = ''): boolean {
    return !['disposed', 'disposal_pending', 'rejected'].includes(str(asset.status)) &&
        (!str(asset.workCenterId) || (equipmentId !== '' && str(asset.workCenterId) === equipmentId));
}

export function unitIsAssignable(attrs: Fields, assetTag = ''): boolean {
    return !str(attrs.assetTag) || (assetTag !== '' && str(attrs.assetTag) === assetTag);
}
