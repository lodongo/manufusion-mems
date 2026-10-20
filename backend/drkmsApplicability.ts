/** Pure applicability checks for engineering technical documentation. */
export type ModelKey={categoryCode:string;subcategoryCode:string;classCode:string;manufacturer?:string;model?:string};
export function matchingModel(document:ModelKey, equipment:ModelKey):boolean {
 if(!document.categoryCode||!document.subcategoryCode||!document.classCode)return false;
 if(document.categoryCode!==equipment.categoryCode||document.subcategoryCode!==equipment.subcategoryCode||document.classCode!==equipment.classCode)return false;
 if(document.manufacturer&&document.manufacturer!==equipment.manufacturer)return false;
 if(document.model&&document.model!==equipment.model)return false;
 return true;
}
