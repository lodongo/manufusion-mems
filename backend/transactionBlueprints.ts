/**
 * Enterprise transaction blueprint catalogue (SAP-inspired, not SAP transaction codes).
 *
 * Ring-fence: catalogued blueprints have NO executable permission. Only a
 * separately verified, implemented server handler may activate a transaction.
 * Module/submodule visibility is also gated by tenant module enablement and a
 * validated security grant. This catalogue grants nothing by itself.
 */
import { DEFAULT_MODULES } from './catalog';
import { discoverTransactionActions } from './transactionRegistry';

export type BlueprintState = 'reserved' | 'catalogued_legacy';
export interface TransactionBlueprint {
  code: string;
  module: string;
  area: string;
  name: string;
  state: BlueprintState;
  executable: false;
  requiredGate: 'verified_backend_handler_and_governance';
  kind: 'module_access' | 'submodule_access' | 'transaction';
  legacyPermissionKeys: string[];
}

/** Each module has stable two-to-four-letter submodule mnemonic + short action mnemonic. */
const AREAS: Record<string, string> = {
  ADM: 'ORG:Organization setup|USR:Users|SEC:Security roles|JBR:Job roles|GOA:Governance|AUD:Audit|TEN:Tenants|MDL:Module administration',
  FIN: 'GLA:General ledger|COA:Chart of accounts|JRN:Journals|APY:Accounts payable|ARC:Accounts receivable|BNK:Bank and cash|TAX:Tax|PER:Financial periods|BUD:Budgets|FXR:Currency rates|REC:Reconciliations',
  INV: 'MAT:Material master|STK:Stock on hand|MOV:Stock movements|TRF:Transfers|CNT:Stock counts|VAL:Valuation|RPL:Replenishment|BAT:Batches and serials',
  MFG: 'BOM:Bills of materials|ROT:Routings|POD:Production orders|JOB:Job cards|CON:Consumption|OUT:Production output|SCR:Scrap|OEE:Production performance',
  PLN: 'MPS:Master schedule|MRP:Material requirements planning|CAP:Capacity planning|DEM:Demand forecast|SHT:Shortage management',
  CST: 'STD:Standard costing|ACT:Actual costing|OVH:Overheads|VAR:Variances|MRG:Margins',
  QLT: 'INS:Inspections|SPC:Specifications|NCR:Nonconformance|CAP:Corrective actions|COA:Certificates|REL:Quality release',
  MNT: 'WRQ:Work requests|WOR:Work orders|PMS:Preventive schedules|AMS:Autonomous maintenance|RCA:Root cause analysis|RISK:Risk and permits|BOM:Maintenance BOM|REL:Reliability',
  AST: 'REG:Asset register|EQP:Equipment|ASM:Assemblies|DEP:Depreciation|TRF:Transfers|DSP:Disposals|CAP:Capitalisation|TAG:Tagging',
  PRC: 'REQ:Purchase requirements|RFQ:Quotations|PRQ:Purchase requisitions|PUR:Purchase orders|VEN:Vendors|GRN:Goods receipt|SVC:Services|CTR:Contracts|AUT:Procurement authority',
  WHS: 'WHM:Warehouse master|BIN:Bins|REC:Receiving|PUT:Putaway|PIK:Picking|PAK:Packing|DSP:Dispatch|TRF:Warehouse transfers',
  LOG: 'SHP:Shipments|FLT:Fleet|TRN:Transporters|RTE:Routes|FRT:Freight|POD:Proof of delivery',
  DST: 'DIS:Distributors|DEP:Depots|RTE:Route sales|VAN:Van stock|REP:Replenishment|PRC:Channel prices',
  SAL: 'QUO:Sales quotations|ORD:Sales orders|DEL:Deliveries|INV:Sales invoicing|CRD:Credit management|RET:Returns|COL:Collections',
  CRM: 'CUS:Customers|LEA:Leads|OPP:Opportunities|ACT:Customer activities|CAS:Service cases|CMP:Campaigns',
  POS: 'REG:Register sales|TIL:Tills|PAY:Payments|REF:Refunds|SHF:Cashier shifts|REC:Reconciliation',
  HRM: 'EMP:Employees|POS:Positions|REC:Recruitment|ONB:Onboarding|LEA:Leave|ATT:Attendance|PER:Performance|TRN:Training|SKL:Skills|DSC:Discipline',
  PAY: 'RUN:Payroll runs|ERN:Earnings|DED:Deductions|TAX:Payroll taxes|BEN:Benefits|PAY:Disbursement|REC:Payroll reconciliation',
  DOC: 'REC:Records|TMP:Templates|VER:Version control|APR:Document approvals|RET:Retention|PUB:Publication',
  RPT: 'DSH:Dashboards|RPT:Reports|AUD:Audit analytics|EXP:Exports|PUB:Publication|SCH:Scheduled reports',
  PRJ: 'PRJ:Projects|WBS:Work breakdown|TSK:Tasks|BUD:Budgets|CST:Project costs|RSK:Risks|CHG:Changes|CLS:Closure',
};

/** Blueprint action patterns; not a claim that an endpoint exists. */
const ACTIONS = [
  ['VW','View'], ['CR','Create'], ['ED','Edit'], ['SB','Submit'],
  ['AP','Approve'], ['RT','Return'], ['RJ','Reject'], ['CN','Cancel'],
  ['PS','Post'], ['CL','Close'], ['RV','Reverse'], ['RP','Report'],
] as const;

export function plannedTransactionBlueprints(): TransactionBlueprint[] {
  const result: TransactionBlueprint[] = [];
  for (const mod of DEFAULT_MODULES) {
    const module = mod.code;
    const root = `${module}-MOD-VW`;
    result.push({ code: root, module, area: 'MOD', name: `Access ${mod.name}`, state: 'reserved', executable: false, requiredGate: 'verified_backend_handler_and_governance', kind: 'module_access', legacyPermissionKeys: [] });
    const areas = (AREAS[module] ?? '').split('|').filter(Boolean);
    for (const item of areas) {
      const [area, label] = item.split(':');
      result.push({ code: `${module}-${area}-VW`, module, area, name: `Access ${label}`, state: 'reserved', executable: false, requiredGate: 'verified_backend_handler_and_governance', kind: 'submodule_access', legacyPermissionKeys: [] });
      for (const [suffix, verb] of ACTIONS.filter(([suffix])=>suffix!=='VW')) {
        result.push({ code: `${module}-${area}-${suffix}`, module, area, name: `${verb}: ${label}`, state: 'reserved', executable: false, requiredGate: 'verified_backend_handler_and_governance', kind: 'transaction', legacyPermissionKeys: [] });
      }
    }
  }
  // Legacy action permissions are explicitly captured, not upgraded into live
  // canonical permissions; a reviewed mapping is required before cutover.
  for (const legacy of discoverTransactionActions()) {
    const code = `${legacy.module}-LEG-${String(result.filter(r=>r.module===legacy.module&&r.area==='LEG').length+1).padStart(4,'0')}`;
    result.push({ code, module: legacy.module, area: 'LEG', name: legacy.label, state: 'catalogued_legacy', executable: false, requiredGate: 'verified_backend_handler_and_governance', kind: 'transaction', legacyPermissionKeys: [legacy.legacyPermission] });
  }
  const codes = new Set<string>();
  for (const x of result) {
    if (!/^[A-Z]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{2,4}$/.test(x.code) || codes.has(x.code)) throw new Error('Invalid/duplicate transaction code: '+x.code);
    codes.add(x.code);
  }
  return result;
}

export function assertBlueprintNotExecutable(code: string): never {
  throw new Error('Transaction '+code+' is a reserved blueprint. Implement, verify, classify, authorize and activate its backend handler first.');
}
