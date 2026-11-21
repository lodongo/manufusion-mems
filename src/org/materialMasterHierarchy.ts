import type {DictTree} from '../components/AssetDictionaryBrowser';

/**
 * The active MEMS PRC Materials Master is the sole source of categories,
 * subcategories, families and materials. Industry recommendations are hints,
 * never eligibility filters on this classification picker.
 *
 * API nomenclature is shared with the Asset Dictionary browser:
 * groups = material categories; categories = material subcategories;
 * subcategories = material families; classes = generic materials.
 */
export function materialMasterHierarchy(
    tree:DictTree|null|undefined,
    categoryCode:string,
    subcategoryCode:string,
    familyCode:string,
    materialCode:string,
){
    const categories=tree?.groups??[];
    const subcategories=(tree?.categories??[]).filter(c=>c.groupCode===categoryCode);
    const families=(tree?.subcategories??[]).filter(f=>f.categoryCode===subcategoryCode&&
        subcategories.some(c=>c.code===subcategoryCode));
    const materials=(tree?.classes??[]).filter(m=>m.subcategoryCode===familyCode&&
        families.some(f=>f.code===familyCode));
    const validCategory=!!categoryCode&&categories.some(x=>x.code===categoryCode);
    const validSubcategory=validCategory&&!!subcategoryCode&&subcategories.some(x=>x.code===subcategoryCode);
    const validFamily=validSubcategory&&!!familyCode&&families.some(x=>x.code===familyCode);
    const validMaterial=validFamily&&!!materialCode&&materials.some(x=>x.code===materialCode);
    return {
        categories,subcategories,families,materials,
        validCategory,validSubcategory,validFamily,validMaterial,
        complete:validCategory&&validSubcategory&&validFamily&&validMaterial,
        selectionIssue:categoryCode&&!validCategory?'Selected category is not in the active Materials Master. Choose a current category.':
            subcategoryCode&&!validSubcategory?'Selected subcategory is not under this category in the active Materials Master.':
            familyCode&&!validFamily?'Selected family is not under this subcategory in the active Materials Master.':
            materialCode&&!validMaterial?'Selected material is not under this family in the active Materials Master.':'',
    };
}
