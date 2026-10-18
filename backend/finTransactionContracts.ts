/**
 * Deterministic, read-only transaction handler contracts for every adopted GL scenario.
 * A placeholder is NEVER an executable accounting handler. It describes the required
 * module owner, event inputs and implementation gate without posting or changing balances.
 */
import type {GlTransactionVariant} from './finTransactionVariants';
export type ContractState='wired_event'|'placeholder';
export interface GlTransactionContract{
 id:string;handlerId:string;name:string;module:string;submodule:string;state:ContractState;
 event:string;role:string;glCode:string;scenario:string;
 requiredInputs:string[];postingAllowed:boolean;handlerRoute:string;
 implementationNote:string;
}
type Assignment={module:string;submodule:string;inputs:string[]};
const base=['legalEntityId','postingDate','amount','currency','sourceDocumentId','costCenterId'];
function owner(v:GlTransactionVariant):Assignment {
 const text=(v.accountName+' '+v.scenario).toLowerCase();
 if(v.event==='GR_STOCK')return {module:'INV',submodule:'Stock receipts',inputs:[...base,'materialId','warehouseId','quantity','valuationMethod']};
 if(v.event==='GR_DIRECT')return {module:'PRC',submodule:'Direct purchases',inputs:[...base,'purchaseOrderId','receiptId']};
 if(v.event==='GR_ASSET')return {module:'AST',submodule:'Asset acquisition',inputs:[...base,'assetId','purchaseOrderId']};
 if(v.event==='SVC_ACCEPT')return {module:'PRC',submodule:'Service acceptance',inputs:[...base,'serviceId','purchaseOrderId']};
 if(v.event==='GI_CC')return {module:'INV',submodule:'Goods issues',inputs:[...base,'materialId','warehouseId','quantity']};
 if(v.event==='GI_WO')return {module:'MNT',submodule:'Work order materials',inputs:[...base,'workOrderId','materialId','quantity']};
 if(v.event==='ST_ADJ')return {module:'INV',submodule:'Stock counts',inputs:[...base,'stockCountId','materialId','quantityDifference']};
 if(v.event==='STK_OPEN')return {module:'INV',submodule:'Opening stock',inputs:[...base,'materialId','warehouseId','quantity','unitCost']};
 if(v.event==='INV_RECON')return {module:'INV',submodule:'Inventory reconciliation',inputs:[...base,'reconciliationId']};
 if(v.event==='REALLOC')return {module:'CST',submodule:'Cost allocations',inputs:[...base,'sourceCostCenterId','destinationCostCenterId']};
 if(v.event==='YE_CLOSE')return {module:'FIN',submodule:'Period close',inputs:[...base,'financialYear']};
 if(/payroll|salar|wages|employee benefit/.test(text))return {module:'PAY',submodule:'Payroll posting',inputs:[...base,'payrollRunId','employeeId']};
 if(/revenue|sales|turnover|service income/.test(text))return {module:'SAL',submodule:'Sales billing',inputs:[...base,'customerId','invoiceId']};
 if(/depreciation|amortiz/.test(text))return {module:'AST',submodule:'Depreciation',inputs:[...base,'assetId','period']};
 if(/tax|vat|withhold|excise/.test(text))return {module:'FIN',submodule:'Tax accounting',inputs:[...base,'taxCode','taxBase']};
 if(/cash|bank|payment|receivable|payable/.test(text))return {module:'FIN',submodule:'Treasury and settlement',inputs:[...base,'paymentMethod','counterpartyId']};
 if(/freight|logistic|transport/.test(text))return {module:'LOG',submodule:'Freight costing',inputs:[...base,'shipmentId']};
 if(/energy|power|electricity|diesel|fuel|gas/.test(text))return {module:'MFG',submodule:'Utility consumption',inputs:[...base,'resourceId','meterReading']};
 if(/lease|rental/.test(text))return {module:'AST',submodule:'Lease accounting',inputs:[...base,'leaseContractId']};
 if(/intercompany|intra.group/.test(text))return {module:'FIN',submodule:'Intercompany accounting',inputs:[...base,'counterpartyLegalEntityId']};
 if(/manufacturing|production|work.in.progress/.test(text))return {module:'MFG',submodule:'Production costing',inputs:[...base,'productionOrderId']};
 if(/maint|repair|engineering/.test(text))return {module:'MNT',submodule:'Maintenance costs',inputs:[...base,'workOrderId']};
 if(/quality|inspection|scrap/.test(text))return {module:'QLT',submodule:'Quality costs',inputs:[...base,'inspectionId']};
 if(/purchase|supplier|procurement/.test(text))return {module:'PRC',submodule:'Procurement accounting',inputs:[...base,'purchaseOrderId']};
 return {module:'FIN',submodule:'General ledger journals',inputs:[...base,'journalDescription','counterAccountCode']};
}
export function registerGlContract(v:GlTransactionVariant):GlTransactionContract {
 const assigned=owner(v);
 const state:ContractState=v.status==='configurable'&&!!v.event?'wired_event':'placeholder';
 return {
  id:v.id,handlerId:'FIN.GL.'+v.id.replace(/[^A-Za-z0-9]/g,'_'),
  name:v.name,module:assigned.module,submodule:assigned.submodule,state,
  event:v.event,role:v.role,glCode:v.accountCode,scenario:v.scenario,
  requiredInputs:assigned.inputs,
  postingAllowed:false, // the contract itself never posts; only verified operational handlers do
  handlerRoute:state==='wired_event'?'existing_approved_operational_handler':'placeholder_only',
  implementationNote:state==='wired_event'
   ? 'An operational handler exists for this event. Use its normal authenticated business workflow. This contract cannot directly post.'
   : 'Contract and workspace are installed. Execution awaits module workflow, balanced entries, permissions, approval and verified posting adapter.'
 };
}
export function registerGlContracts(variants:ReadonlyArray<GlTransactionVariant>):GlTransactionContract[]{
 const contracts=variants.map(registerGlContract);
 if(new Set(contracts.map(x=>x.id)).size!==contracts.length)throw Error('Duplicate GL transaction contract identifiers');
 return contracts;
}
export function denyPlaceholderExecution(contract:GlTransactionContract):never{
 throw new Error(`Transaction ${contract.handlerId} is ${contract.state}. Use an approved operational handler; placeholders cannot post journal entries.`);
}
