// Inventory display valuation. Price is per PURCHASE unit; stock is held in the MATERIAL unit.
// Use the adopted PRC conversion registry and the enabled MEMS FX reference. Never guess a conversion.
import { PROCUREMENT_UNITS } from './procurementUnits';

export interface ValuationUnit {
    code?: string;
    label?: string;
    name?: string;
    symbol?: string;
    baseUnit?: string;
    categoryCode?: string;
    multiplier?: number;
    active?: boolean;
    enabled?: boolean;
    selectable?: boolean;
}

function resolveUnit(value: string, units: readonly ValuationUnit[]): ValuationUnit | null {
    const v=value.trim().toLowerCase();
    if(!v)return null;
    const active=units.filter(u=>u.active!==false&&u.enabled!==false&&u.selectable!==false);
    const codes=active.filter(u=>String(u.code||'').trim().toLowerCase()===v);
    if(codes.length===1)return codes[0];
    if(codes.length>1)return null;
    // Legacy records can store the displayed label or symbol rather than the registry code.
    // Accept these only when the matching unit is unambiguous.
    const aliases=active.filter(u=>[u.label,u.name,u.symbol].some(s=>String(s||'').trim().toLowerCase()===v));
    return aliases.length===1?aliases[0]:null;
}

export function unitPricePerStockUnit(
    price: number, purchaseUom: string, stockUom: string,
    configuredUnits?: readonly ValuationUnit[],
): number | null {
    if(!Number.isFinite(price)||price<0||!purchaseUom.trim()||!stockUom.trim())return null;
    if(purchaseUom.trim().toLowerCase()===stockUom.trim().toLowerCase())return price;
    const units=configuredUnits??PROCUREMENT_UNITS;
    const purchase=resolveUnit(purchaseUom,units), stock=resolveUnit(stockUom,units);
    if(!purchase||!stock)return null;
    const from=Number(purchase.multiplier),to=Number(stock.multiplier);
    if(!Number.isFinite(from)||from<=0||!Number.isFinite(to)||to<=0)return null;
    if(!purchase.baseUnit||!stock.baseUnit||purchase.baseUnit!==stock.baseUnit)return null;
    if(purchase.categoryCode&&stock.categoryCode&&purchase.categoryCode!==stock.categoryCode)return null;
    const cost=price*to/from;
    return Number.isFinite(cost)?cost:null;
}

export function convertStockCurrency(
    value: number, fromCurrency: string, toCurrency: string, unitsPerUsd: Record<string,number>,
): number | null {
    if(!Number.isFinite(value)||!fromCurrency.trim()||!toCurrency.trim())return null;
    const source=fromCurrency.toUpperCase(),target=toCurrency.toUpperCase();
    if(source===target)return value;
    const from=unitsPerUsd[source],to=unitsPerUsd[target];
    return Number.isFinite(from)&&from>0&&Number.isFinite(to)&&to>0?value/from*to:null;
}
