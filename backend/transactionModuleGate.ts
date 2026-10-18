/** Shared module/submodule disable gate for existing organization routes.
 * This adds a server check without replacing the route's existing fine-grained permission,
 * organizational scope or business approval rules.
 */
const BY_PERMISSION:Record<string,string>={
  INV_ST:'INV',PRC:'PRC',MNT:'MNT',AST:'AST',WHS:'WHS',FIN:'FIN',
  ADM:'ADM',INV:'INV',HRM:'HRM',HR:'HRM',SAF:'SAF',QLT:'QLT',
  PAY:'PAY',MFG:'MFG',CRM:'CRM',SAL:'SAL',DOC:'DOC',PRJ:'PRJ',
};
const BY_ROUTE:Record<string,string>={
  mnt:'MNT',maintenance:'MNT',assets:'AST',asset:'AST',ast:'AST',
  inventory:'INV',inv:'INV',stock:'INV',stocktake:'INV',
  procurement:'PRC',prc:'PRC',warehouse:'WHS',whs:'WHS',
  finance:'FIN',fin:'FIN',quality:'QLT',saf:'SAF',hr:'HRM',hrm:'HRM',
};
export function moduleForOrgAction(name:string,permission:string|null):string|null {
  const prefix=permission?.split(/[._]/)[0].toUpperCase();
  if(prefix && BY_PERMISSION[prefix])return BY_PERMISSION[prefix];
  const namePart=name.split('.')[1]?.toLowerCase()??'';
  return BY_ROUTE[namePart]??null;
}
export function moduleDisableReason(name:string,permission:string|null,modules:unknown):string|null {
  if(!modules||typeof modules!=='object'||Array.isArray(modules))return null;
  const module=moduleForOrgAction(name,permission);
  if(!module||module==='ADM')return null;
  const status=(modules as Record<string,unknown>)[module];
  if(status===false||status==='disabled')return module+' module is disabled';
  return null;
}
