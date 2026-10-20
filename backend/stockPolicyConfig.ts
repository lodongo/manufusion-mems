import {UNIVERSAL_STOCK_METADATA, STOCK_META_BY_KEY, stockedPolicyToMrp} from './universalStockMetadata';
/** Field-to-master binding used by the existing material-warehouse settings tab. */
export const MATERIAL_STOCK_DIMENSIONS=[
 ['stockOwnership','stockOwnership'],
 ['supplyArrangement','supplyArrangements'],
 ['stockCustody','stockCustody'],
 ['stockCondition','stockConditions'],
 ['replenishmentStrategy','replenishmentStrategies'],
 ['stockPurpose','stockPurposes'],
 ['stockAllocation','stockAllocations'],
 ['financialProfile','financialProfiles'],
 ['valuationMethod','valuationMethods'],
 ['traceabilityControl','traceabilityControls'],
 ['titleTransferTrigger','titleTransferTriggers'],
 ['specialStockProgram','specialStockPrograms'],
 ['warehouseRestriction','warehouseRestrictions'],
 ['stockPlanningControl','stockPlanningControls'],
 ['ownershipSettlementTrigger','ownershipSettlementTriggers'],
] as const;
export const STOCK_FIELD_MASTER=new Map<string,string>(MATERIAL_STOCK_DIMENSIONS);
export {UNIVERSAL_STOCK_METADATA,STOCK_META_BY_KEY,stockedPolicyToMrp};
export const isStandardMrpSafe=(x:Record<string,unknown>):{safe:boolean;reason:string}=>{
 const arrangement=String(x.supplyArrangement||'').toUpperCase();
 const ownership=String(x.stockOwnership||'').toUpperCase();
 // Never automatically purchase against supplier-owned stock or managed vendor programs:
 // they require independently posted custody, owner lots and supplier settlement.
 if(['OW02','OW03','OW04','OW05','OW06','OW07','OW08'].includes(ownership))
  return {safe:false,reason:'MRP standard purchase is blocked for non-company, shared or unresolved ownership; configure an owner-aware replenishment and settlement agreement.'};
 if(['SA02','SA03','SA04','SA07','SA08','SA09','SA10','SA12','SA13','SA17','SA18'].includes(arrangement))
  return {safe:false,reason:'This supply arrangement needs a specialized owner/supplier replenishment workflow; standard purchase requisitions are blocked.'};
 if(arrangement&& !['SA01','SA14'].includes(arrangement))
  return {safe:false,reason:'Supply arrangement not eligible for standard purchase replenishment.'};
 return {safe:true,reason:''};
};
