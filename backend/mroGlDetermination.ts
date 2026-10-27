/**
 * Work Order expense classification comes from the approved maintenance assessment,
 * not from a material's technical identity or an expense-account name.
 *
 * Only MEMS' existing Finance GL mapping and posting engine may choose/post accounts.
 * This module supplies stable, audited context and historical reversal references.
 */
type Data=Record<string,unknown>;
const object=(v:unknown):Data=>v&&typeof v==='object'&&!Array.isArray(v)?v as Data:{};
const text=(v:unknown):string=>typeof v==='string'?v.trim():'';
const records=(v:unknown):Data[]=>Array.isArray(v)?v.map(object):[];

export interface MroFinancialContext{
 maintenanceTypeCode:string;
 maintenanceTypeLabel:string;
 costNatureCode:string;
 taskId:string;
 source:'TASK'|'WORK_ORDER'|'UNCLASSIFIED';
}

/** A task inherits the WO type unless an explicitly assessed task override exists. */
export function mroFinancialContext(workOrder:unknown,taskId:string,material:unknown):MroFinancialContext{
 const wo=object(workOrder),m=object(material);
 const task=records(wo.assessmentTasks).find(t=>text(t.id)===taskId);
 const taskStrategy=text(task?.maintenanceTypeCode);
 const maintenanceTypeCode=taskStrategy||text(wo.maintenanceTypeCode);
 const classification=object(object(m.accounting).catalogueClassification);
 const materialClass=object(m.materialClassification);
 // A missing Stores class intentionally stays unspecified; never infer from item name.
 const costNatureCode=text(m.storesClassCode)||text(classification.storesClassCode)||text(materialClass.storesClassCode);
 return {
  maintenanceTypeCode,
  maintenanceTypeLabel:taskStrategy?text(task?.maintenanceTypeLabel)||taskStrategy:text(wo.maintenanceTypeLabel),
  costNatureCode,
  taskId,
  source:taskStrategy?'TASK':maintenanceTypeCode?'WORK_ORDER':'UNCLASSIFIED'
 };
}

/** Reverse exactly the accounts captured on the original issue. Never reclassify historical costs. */
export function originalMroIssueAccounts(issueLine:unknown,fallbackExpense:string,fallbackInventory:string){
 const entry=object(issueLine);
 return {
  expenseGlCode:text(entry.expenseGlCode)||fallbackExpense,
  inventoryGlCode:text(entry.inventoryGlCode)||fallbackInventory,
  historicalExpenseAccount:!!text(entry.expenseGlCode),
  historicalInventoryAccount:!!text(entry.inventoryGlCode)
 };
}
