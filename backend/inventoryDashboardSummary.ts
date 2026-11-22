// Inventory Dashboard summarizes the exact reconciled, unit/currency-normalized
// material × warehouse records served by Inventory on Hand. Never recalculate by
// multiplying supplier purchase-unit prices against raw stock quantities.
import { convertStockCurrency } from './inventoryValuation';

export interface DashboardStockItem {
    warehouseId: string;
    id: string;
    uom: string;
    stockCurrency: string;
    stockStatus: string;
    stockLedgerAvailable: boolean;
    netAvailable: number | null;
    quantityOnHand: number | null;
    netStockValue: number | null;
    unitCostLocal: number | null;
    maximumLevel: number | null;
    emptyBin?: boolean;
    hasLinkedBin?: boolean;
}
export interface DashboardStockWarehouse { id: string; name: string; code: string }
export interface DashboardStockCurrency { code: string; rate: number }
export interface DashboardStockSnapshot {
    items: DashboardStockItem[];
    warehouses: DashboardStockWarehouse[];
    currencies: DashboardStockCurrency[];
}
export interface CurrencyTotals {
    stockValue: number;
    overstockValue: number;
    valued: number;
}
export interface QuantityTotals {
    uom: string;
    netAvailable: number;
    overstockQuantity: number;
}
export interface InventoryDashboardResult {
    warehouses: DashboardStockWarehouse[];
    currencies: DashboardStockCurrency[];
    warehouseId: string;
    displayCurrency: string;
    totalRows: number;
    tracked: number;
    valued: number;
    unvalued: number;
    missingExchangeRate: number;
    unreconciled: number;
    notTracked: number;
    emptyBins: number;
    linkedBins: number;
    overstockCount: number;
    withoutMaximum: number;
    byCurrency: Record<string,CurrencyTotals>;
    quantities: QuantityTotals[];
}

/** Warehouse access must be verified by the backend before this pure calculation. */
export function summarizeInventoryDashboard(
    snapshot: DashboardStockSnapshot, warehouseId = '', displayCurrency = '',
): InventoryDashboardResult {
    const rows=snapshot.items.filter(r=>!warehouseId||warehouseId==='all'||r.warehouseId===warehouseId);
    const rates=Object.fromEntries(snapshot.currencies.filter(c=>Number.isFinite(c.rate)&&c.rate>0).map(c=>[c.code,c.rate]));
    const byCurrency: Record<string,CurrencyTotals>={};
    const quantityByUom=new Map<string,QuantityTotals>();
    let tracked=0,valued=0,unvalued=0,missingExchangeRate=0,unreconciled=0,notTracked=0;
    let emptyBins=0,linkedBins=0,overstockCount=0,withoutMaximum=0;
    for(const r of rows){
        if(r.hasLinkedBin)linkedBins++;
        if(!r.stockLedgerAvailable){
            if(r.stockStatus==='Unreconciled')unreconciled++;
            else notTracked++;
            continue;
        }
        tracked++;
        if(r.emptyBin===true||r.stockStatus==='Empty bin')emptyBins++;
        const uom=r.uom||'Unit not configured';
        let quantity=quantityByUom.get(uom);
        if(!quantity){quantity={uom,netAvailable:0,overstockQuantity:0};quantityByUom.set(uom,quantity);}
        if(r.netAvailable!==null&&Number.isFinite(r.netAvailable))quantity.netAvailable+=r.netAvailable;
        const hasMax=r.maximumLevel!==null&&Number.isFinite(r.maximumLevel);
        if(!hasMax)withoutMaximum++;
        const excess=hasMax&&r.quantityOnHand!==null&&Number.isFinite(r.quantityOnHand)
            ?Math.max(0,r.quantityOnHand-r.maximumLevel!):0;
        if(excess>0){overstockCount++;quantity.overstockQuantity+=excess;}
        if(r.netStockValue===null||!Number.isFinite(r.netStockValue)||!r.stockCurrency){
            unvalued++;continue;
        }
        const currency=displayCurrency||r.stockCurrency;
        const converted=convertStockCurrency(r.netStockValue,r.stockCurrency,currency,rates);
        const overstock=excess>0&&r.unitCostLocal!==null&&Number.isFinite(r.unitCostLocal)
            ?convertStockCurrency(excess*r.unitCostLocal,r.stockCurrency,currency,rates):0;
        if(converted===null||overstock===null){
            unvalued++;missingExchangeRate++;continue;
        }
        const totals=byCurrency[currency]||(byCurrency[currency]={stockValue:0,overstockValue:0,valued:0});
        totals.stockValue+=converted;
        totals.overstockValue+=overstock;
        totals.valued++;
        valued++;
    }
    const round=(n:number)=>Math.round((n+Number.EPSILON)*1e6)/1e6;
    for(const x of Object.values(byCurrency)){
        x.stockValue=round(x.stockValue);x.overstockValue=round(x.overstockValue);
    }
    const quantities=Array.from(quantityByUom.values()).map(x=>({...x,netAvailable:round(x.netAvailable),overstockQuantity:round(x.overstockQuantity)}))
        .sort((a,b)=>a.uom.localeCompare(b.uom));
    return {warehouses:snapshot.warehouses,currencies:snapshot.currencies,
        warehouseId:warehouseId||'all',displayCurrency,totalRows:rows.length,
        tracked,valued,unvalued,missingExchangeRate,unreconciled,notTracked,
        emptyBins,linkedBins,overstockCount,withoutMaximum,byCurrency,quantities};
}
