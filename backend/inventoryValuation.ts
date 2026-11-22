// Inventory display valuation. Price is per PURCHASE unit; stock is held in the MATERIAL unit.
// Use the adopted PRC conversion registry and the enabled MEMS FX reference. Never guess a conversion.
import { PROCUREMENT_UNITS } from './procurementUnits';

/**
 * Prices and stock control levels are persisted as Firestore numbers. Never use
 * core.str() to decide whether they are blank: str(number) returns ''.
 * Legacy numeric text is also accepted, but malformed entries are not zero.
 */
export function inventoryNumericField(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const raw=value.trim();
    if(!raw) return null;
    const normalized=raw.replace(/,/g,'');
    if(!/^[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][-+]?\\d+)?$/.test(normalized)) return null;
    if(raw.includes(',')&&!/^[-+]?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?$/.test(raw)) return null;
    const n=Number(normalized);
    return Number.isFinite(n)?n:null;
}

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
    // The administered registry may contain older records with a label/code but no
    // numeric multiplier. Enrich *matching enabled units only* from the canonical
    // PRC registry; do not guess conversions for unknown or disabled units.
    const canonical=(u:ValuationUnit|null):ValuationUnit|null=>{
        if(!u)return null;
        if(Number.isFinite(Number(u.multiplier))&&Number(u.multiplier)>0&&u.baseUnit)return u;
        const match=PROCUREMENT_UNITS.find(x=>x.code.toLowerCase()===String(u.code||'').toLowerCase());
        return match?{...match,...u,baseUnit:u.baseUnit||match.baseUnit,
            multiplier:Number(u.multiplier)>0?u.multiplier:match.multiplier,
            categoryCode:u.categoryCode||match.categoryCode}:u;
    };
    const fromUnit=canonical(purchase),toUnit=canonical(stock);
    if(!fromUnit||!toUnit)return null;
    const from=Number(fromUnit.multiplier),to=Number(toUnit.multiplier);
    if(!Number.isFinite(from)||from<=0||!Number.isFinite(to)||to<=0)return null;
    if(!fromUnit.baseUnit||!toUnit.baseUnit||fromUnit.baseUnit!==toUnit.baseUnit)return null;
    if(fromUnit.categoryCode&&toUnit.categoryCode&&fromUnit.categoryCode!==toUnit.categoryCode)return null;
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
