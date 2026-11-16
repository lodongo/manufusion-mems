import {getDoc,str} from './core';
import {PROCUREMENT_UNITS} from './procurementUnits';
const unit=(v:string)=>PROCUREMENT_UNITS.find(u=>u.code===v||u.symbol.toLowerCase()===v.toLowerCase()||u.label.toLowerCase()===v.toLowerCase())?.code||v.toLowerCase();
export async function assessmentSparePrice(orgId:string,warehouseId:string,materialId:string,stockUom:string){
 const p=(await getDoc('organizations/'+orgId+'/procurement_material_info/'+materialId+'_'+warehouseId))?.data;
 const raw=p?.unitPrice,currency=str(p?.priceCurrency).toUpperCase(),purchaseUom=str(p?.purchaseUom);
 const price=raw===null||raw===undefined||raw===''?null:Number(raw);
 const estimateUnitPrice=price!==null&&Number.isFinite(price)&&price>=0&&/^[A-Z]{3}$/.test(currency)?price:null;
 return {estimateUnitPrice,estimateCurrency:currency,estimatePurchaseUom:purchaseUom,estimateUomMatches:!!purchaseUom&&!!stockUom&&unit(purchaseUom)===unit(stockUom)};
}
