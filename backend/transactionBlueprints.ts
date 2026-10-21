/**
 * Enterprise transaction blueprint catalogue (SAP-inspired, not SAP transaction codes).
 *
 * Ring-fence: catalogued blueprints have NO executable permission. Only a
 * separately verified, implemented server handler may activate a transaction.
 * Module/submodule visibility is also gated by tenant module enablement and a
 * validated security grant. This catalogue grants nothing by itself.
 *
 * Code format: MODULE-AREA-ACTION, e.g. PRC-PUR-AP (approve a purchase order).
 * Codes are permanent: areas and actions may be added, never renamed or reused.
 * Finance, Procurement, Inventory and Warehousing carry curated submodules with only the actions that make sense
 * for each; other modules use the standard action set until they are designed.
 */
import { createHash } from 'node:crypto';
import { DEFAULT_MODULES } from './catalog';
import { discoverTransactionActions } from './transactionRegistry';

export type BlueprintState = 'reserved' | 'catalogued_legacy';
export interface TransactionBlueprint {
  code: string;
  module: string;
  area: string;
  areaName: string;
  action: string;
  actionName: string;
  name: string;
  state: BlueprintState;
  executable: false;
  requiredGate: 'verified_backend_handler_and_governance';
  kind: 'module_access' | 'submodule_access' | 'transaction';
  legacyPermissionKeys: string[];
}

/** Action mnemonics. Two to four capital letters; permanent once used. */
export const ACTION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  VW: 'View', CR: 'Create', ED: 'Edit', SB: 'Submit', AP: 'Approve', RT: 'Return', RJ: 'Reject',
  CN: 'Cancel', PS: 'Post', CL: 'Close', RV: 'Reverse', RP: 'Report', AM: 'Amend', SN: 'Send to supplier',
  RO: 'Reopen', DL: 'Delete', DA: 'Deactivate', AK: 'Acknowledge', CF: 'Confirm', CV: 'Convert',
  IN: 'Invite', EV: 'Evaluate', RC: 'Recommend', AW: 'Award', PB: 'Publish', OB: 'Open bids',
  GR: 'Receive', AC: 'Accept', MT: 'Match', HD: 'Hold', RL: 'Release', SU: 'Suspend', RA: 'Reinstate',
  OV: 'Override', RN: 'Run', SM: 'Simulate', LK: 'Lock', UL: 'Unlock', OP: 'Open period',
  PY: 'Pay', AL: 'Allocate', RE: 'Reconcile', FL: 'File return', DP: 'Depreciate', DS: 'Dispose',
  EX: 'Extend', BL: 'Block', RS: 'Reserve', IS: 'Issue', CT: 'Count', VF: 'Verify', RQ: 'Request recount',
  AS: 'Assign', PK: 'Pick', PA: 'Pack', DI: 'Dispatch', PT: 'Put away', LN: 'Link', DN: 'Unlink',
  PR: 'Print', RW: 'Review', WD: 'Withdraw', SP: 'Split', MG: 'Merge', TR: 'Terminate', RR: 'Renew',
  IM: 'Import', XP: 'Export', CG: 'Configure', AV: 'Activate', UP: 'Upload attachment', AN: 'Respond',
  VO: 'Vote', AR: 'Archive',
});

/** Standard action set for modules that are not yet designed in detail. */
const STANDARD = 'VW,CR,ED,SB,AP,RT,RJ,CN,PS,CL,RV,RP';
/** Platform administration, collaboration and self-service action sets. */
const PLATFORM = 'VW,CR,ED,DL,IM,XP,AP,RJ,PB,RW,CG,RN,AV,SU,RA';
const WORKSPACE = 'VW,CR,ED,DL,SN,AN,AK,AC,CL,CN,LN,UP,AR,AS,VO';
const SELF = 'VW,CR,ED,SB,UP,PY,RN';

/**
 * Submodules per module: CODE:Name[:ACTIONS]. ACTIONS defaults to the standard set.
 * Existing area codes are kept; new ones are appended.
 */
const AREAS: Record<string, string> = {
  ADM: 'ORG:Organization setup|USR:Users|SEC:Security roles|JBR:Job roles|GOA:Governance|AUD:Audit|TEN:Tenants|MDL:Module administration'
    + '|SDC:Security documentation:VW,CR,ED,SB,AP,PB,RW,UP,CG|HOM:Home and setup progress:VW,ED|REF:Organization reference lists:VW',
  FIN: [
    'GLA:General ledger:VW,CR,ED,AP,PS,RV,RP',
    'COA:Chart of accounts:VW,CR,ED,SB,AP,DA,RP',
    'JRN:Journals:VW,CR,ED,SB,AP,RJ,RT,PS,RV,RP',
    'RJN:Recurring journals:VW,CR,ED,SB,AP,RN,CN',
    'APY:Supplier invoices (payables):VW,CR,ED,SB,AP,RJ,RT,MT,HD,RL,PS,CN,RV,RP',
    'APP:Supplier payments:VW,CR,SB,AP,RJ,PY,RV,RP',
    'ARC:Customer invoices (receivables):VW,CR,ED,SB,AP,PS,CN,RV,RP',
    'RCP:Customer receipts:VW,CR,AP,PS,AL,RV',
    'BNK:Bank and cash:VW,CR,ED,AP,RE,RP',
    'PTC:Petty cash:VW,CR,SB,AP,PY,RE',
    'EXP:Expense claims:VW,CR,SB,AP,RJ,RT,PY',
    'ADV:Staff advances:VW,CR,SB,AP,PY,RE',
    'TAX:Tax:VW,CR,ED,SB,AP,FL,RP',
    'PER:Financial periods:VW,CR,ED,OP,CL,LK,UL,AP',
    'BUD:Budgets:VW,CR,ED,SB,AP,AM,LK,RP',
    'FXR:Currency rates:VW,CR,AP,RV,RP',
    'REC:Reconciliations:VW,CR,SB,AP,RE,RP',
    'FAS:Fixed asset accounting:VW,CR,DP,RV,DS,RP',
    'CCA:Cost centres and allocations:VW,CR,ED,SB,AP,AL,RP',
    'ICO:Intercompany:VW,CR,AP,PS,RE',
    'CON:Consolidation:VW,RN,AP,RP',
    'CLS:Period and year-end close:VW,RN,SB,AP,LK,RO,RP',
    'MAP:Account mapping and posting rules:VW,CR,ED,SB,AP,SM',
    'OPN:Opening balances:VW,CR,SB,AP,PS',
    'SET:Finance setup and go-live:VW,ED,SB,AP',
    'APR:Finance approvals:VW,AP,RJ,WD',
    'ENT:Legal entity finance:VW,ED',
    'GLT:GL transaction catalogue:VW,SM',
    'RPT:Financial statements:VW,RP,XP',
    'ACR:Accruals, prepayments and provisions:VW,CR,SB,AP,PS,RV',
    'TRS:Treasury, borrowings and investments:VW,CR,SB,AP,PS,RV',
    'LSE:Leases:VW,CR,SB,AP,PS,RV',
    'EQT:Equity and capital:VW,CR,SB,AP,PS',
    'MEM:Memorandum and statistical entries:VW,CR,PS,RV',
    'GTX:GL account transactions:VW,SB,AP',
  ].join('|'),
  INV: [
    'MAT:Material master:VW,CR,ED,SB,AP,RJ,EX,BL,DA',
    'STK:Stock on hand:VW,RP,XP',
    'MOV:Stock movements:VW,RP',
    'TRF:Transfers between warehouses:VW,CR,SB,AP,DI,GR,CN',
    'CNT:Stock counts:VW,CR,ED,CT,VF,RQ,SB,AP,PS,CL,CN',
    'VAL:Valuation:VW,RN,AP,PS,RP',
    'RPL:Replenishment requests and signals:VW,CR,RN,VF,AK,AP,RJ,CN',
    'BAT:Batches and serials:VW,CR,ED,BL,RL',
    'RSV:Reservations:VW,RS,RL,CN',
    'GRC:Goods receipt to stock:VW,CR,PS,RV',
    'GIS:Goods issue:VW,CR,SB,AP,IS,PS,RV',
    'RTN:Returns to stock:VW,CR,AP,PS',
    'ADJ:Stock adjustments:VW,CR,SB,AP,PS,RV',
    'WOF:Write-offs and scrap:VW,CR,SB,AP,PS',
    'QRT:Quarantine and isolation:VW,SB,AP,RJ,RL',
    'CSG:Consignment stock:VW,CR,PS,RE',
    'OBS:Obsolete and slow-moving:VW,RW,AP,DS',
    'OPN:Opening stock:VW,CR,SB,AP,PS',
  ].join('|'),
  MFG: 'BOM:Bills of materials|ROT:Routings|POD:Production orders|JOB:Job cards|CON:Consumption|OUT:Production output|SCR:Scrap|OEE:Production performance',
  PLN: 'MPS:Master schedule|MRP:Material requirements planning|CAP:Capacity planning|DEM:Demand forecast|SHT:Shortage management',
  CST: 'STD:Standard costing|ACT:Actual costing|OVH:Overheads|VAR:Variances|MRG:Margins',
  QLT: 'INS:Inspections|SPC:Specifications|NCR:Nonconformance|CAP:Corrective actions|COA:Certificates|REL:Quality release',
  MNT: 'WRQ:Work requests|WOR:Work orders|PMS:Preventive schedules|AMS:Autonomous maintenance|RCA:Root cause analysis|RISK:Risk and permits|BOM:Maintenance BOM|REL:Reliability'
    + '|ASS:Work assessments:VW,ED,SB,AP,UP|TSK:Task library:VW,CR,ED,AP|MCD:Material candidates:VW,CR,SB,AP|SET:Maintenance setup and references:VW,ED,CG|WFL:Maintenance workflow configuration:VW,ED,AP',
  AST: 'REG:Asset register|EQP:Equipment|ASM:Assemblies|DEP:Depreciation|TRF:Transfers|DSP:Disposals|CAP:Capitalisation|TAG:Tagging'
    + '|DIC:Asset dictionary:VW,IM,ED|ACT:Assembly activities:VW,ED',
  PRC: [
    'REQ:Purchase requirements:VW,CR,ED,SB,AP,RJ,RT,CN,AK',
    'RFQ:Quotations and sourcing:VW,CR,ED,IN,EV,RC,AP,CN,RO',
    'TND:Tenders:VW,CR,PB,OB,EV,AW,CN',
    'PRQ:Purchase requisitions:VW,CR,ED,SB,CF,AP,RJ,RT,SU,CN,RO,CV',
    'PUR:Purchase orders:VW,CR,ED,SB,AP,RJ,RT,AM,SN,AK,AS,CN,CL,RO',
    'GRN:Goods receipt:VW,CR,GR,PS,RV,RT',
    'SVC:Service entry and acceptance:VW,CR,SB,AC,RJ,PS',
    'RTV:Returns to vendor:VW,CR,AP,PS,CN',
    'MCH:Invoice matching:VW,MT,AP,HD,RL',
    'VEN:Vendors:VW,CR,ED,SB,AP,RJ,RT,SU,RA,OV,DL',
    'VEV:Vendor performance and SRM:VW,CR,SB,AP,RP',
    'CTR:Contracts and SLAs:VW,CR,ED,SB,AP,RR,TR',
    'FWA:Framework agreements:VW,CR,SB,AP,CL',
    'CAT:Material and service catalogue:VW,CR,ED,SB,AP,RJ,EX,DA',
    'BGR:Buyer groups:VW,CR,ED,AL',
    'AUT:Procurement authority:VW,ED,SB,AP',
    'SET:Procurement setup:VW,ED,SB,AP',
    'RPT:Procurement reporting:VW,RP,XP',
  ].join('|'),
  WHS: [
    'WHM:Warehouse master:VW,CR,ED,CG,DA',
    'SLC:Storage locations:VW,CR,ED,DA',
    'BIN:Bins and clusters:VW,CR,AL,DL,LN,DN',
    'REC:Receiving:VW,CR,GR,RW,PS',
    'PUT:Putaway:VW,CR,PT,CF,RV',
    'PIK:Picking:VW,CR,AS,PK,CF,RV',
    'PAK:Packing:VW,CR,PA,CF',
    'DSP:Dispatch:VW,CR,DI,CF,RV',
    'TRF:Warehouse transfers:VW,CR,SB,AP,DI,GR',
    'XDK:Cross-docking:VW,CR,CF',
    'CYC:Cycle counting:VW,CR,CT,VF,AP',
    'RPL:Bin replenishment:VW,CR,CF',
    'YRD:Yard and docks:VW,CR,AS,CL',
    'RTN:Warehouse returns:VW,CR,RW,PS',
    'LBL:Labels:VW,PR',
    'SLT:Slotting:VW,RN,AP',
  ].join('|'),
  SAF: 'RSK:Risk assessments|MTX:Risk matrix|PTW:Permits to work|INC:Incidents|ENE:Hazardous energy',
  LOG: 'SHP:Shipments|FLT:Fleet|TRN:Transporters|RTE:Routes|FRT:Freight|POD:Proof of delivery',
  DST: 'DIS:Distributors|DEP:Depots|RTE:Route sales|VAN:Van stock|REP:Replenishment|PRC:Channel prices',
  SAL: 'QUO:Sales quotations|ORD:Sales orders|DEL:Deliveries|INV:Sales invoicing|CRD:Credit management|RET:Returns|COL:Collections',
  CRM: 'CUS:Customers|LEA:Leads|OPP:Opportunities|ACT:Customer activities|CAS:Service cases|CMP:Campaigns',
  POS: 'REG:Register sales|TIL:Tills|PAY:Payments|REF:Refunds|SHF:Cashier shifts|REC:Reconciliation',
  HRM: 'EMP:Employees|POS:Positions|REC:Recruitment|ONB:Onboarding|LEA:Leave|ATT:Attendance|PER:Performance|TRN:Training|SKL:Skills|DSC:Discipline',
  PAY: 'RUN:Payroll runs|ERN:Earnings|DED:Deductions|TAX:Payroll taxes|BEN:Benefits|PAY:Disbursement|REC:Payroll reconciliation',
  DOC: [
    'REC:Records', 'TMP:Templates', 'VER:Version control', 'APR:Document approvals', 'RET:Retention', 'PUB:Publication',
    'DRF:Controlled documents:VW,CR,ED', 'SRC:Document source files:VW,UP,RL,DL', 'RVW:Document review:VW,SB,VF,RT,RJ',
    'SGN:Document sign-off:VW,AS,EV', 'PBL:Document publication:VW,SB,PB', 'CFG:Document settings:VW,CG',
    'ENG:Engineering and equipment library:VW,CR,ED,LN,VF', 'SDS:Safety data sheets:VW,CR,ED', 'RCA:Investigations (RCA):VW,CR,ED,SB',
    'FRM:Digital forms and records:VW,CR,ED,SB,AP,RT,RJ,EV,LN,DA', 'KNW:Knowledge and troubleshooting:VW,SB',
  ].join('|'),
  RPT: 'DSH:Dashboards|RPT:Reports|AUD:Audit analytics|EXP:Exports|PUB:Publication|SCH:Scheduled reports',
  PRJ: 'PRJ:Projects|WBS:Work breakdown|TSK:Tasks|BUD:Budgets|CST:Project costs|RSK:Risks|CHG:Changes|CLS:Closure',
  WSP: [
    `CHT:Chat:${WORKSPACE}`, `CHA:Chat action requests:${WORKSPACE}`, `POL:Chat polls:${WORKSPACE}`, `MAI:Mail:${WORKSPACE}`,
    `CAL:Calendar:${WORKSPACE}`, `ACT:Action requests:${WORKSPACE}`, `TOD:To-dos:${WORKSPACE}`, `NOT:Notes:${WORKSPACE}`,
    `GEM:Gemba walks:${WORKSPACE}`, `TBL:Saved table views:${WORKSPACE}`, `HOM:Home and shortcuts:${WORKSPACE}`,
    `WGR:Work groups:${WORKSPACE}`, `ACC:My access and activity:${WORKSPACE}`,
  ].join('|'),
  PLT: [
    `TEN:Tenants:${PLATFORM}`, `APL:Applications and registrations:${PLATFORM}`, `USR:MEMS staff users:${PLATFORM}`,
    `MDL:Modules and metadata:${PLATFORM}`, `REF:Reference data:${PLATFORM}`, `ASM:Asset master data:${PLATFORM}`,
    `PRM:Procurement master data:${PLATFORM}`, `FNM:Finance master data and banks:${PLATFORM}`, `SDC:Security documentation standard:${PLATFORM}`,
    `OPS:Operations and automation:${PLATFORM}`, `FXR:Currency rates:${PLATFORM}`, `AUD:Logs and audit:${PLATFORM}`,
    `HLT:Health and dashboard:${PLATFORM}`, `TRX:Transaction catalogue:${PLATFORM}`, `BIL:Billing:${PLATFORM}`,
    `SET:Platform settings and site:${PLATFORM}`, `SKL:Skills master:${PLATFORM}`, `SEQ:Code sequences:${PLATFORM}`,
    `EXP:Data explorer:${PLATFORM}`, `BRD:Branding review:${PLATFORM}`,
  ].join('|'),
  SYS: [
    `SES:Session and context:${SELF}`, `PRF:My profile:${SELF}`, `REG:Organization registration:${SELF}`,
    `APL:Applications:${SELF}`, `AUD:Audit events:${SELF}`, `PAY:Payment callbacks:${SELF}`,
    `INT:Internal schedulers:${SELF}`, `HLT:Health check:${SELF}`, `SET:Initial setup:${SELF}`, `SIT:Public site:${SELF}`,
  ].join('|'),
};

/** Modules with transactions but no subscription tile of their own. */
export const EXTRA_MODULES = [
  { code: 'SAF', name: 'Safety' },
  { code: 'WSP', name: 'Workspace and collaboration' },
  { code: 'PLT', name: 'MEMS platform administration' },
  { code: 'SYS', name: 'Sign-in and self-service' },
];

export interface AreaDefinition { module: string; area: string; name: string; actions: string[] }

/** Every submodule with its allowed actions (used by the catalogue, the route linker and the admin form). */
export function areaDefinitions(): AreaDefinition[] {
  const out: AreaDefinition[] = [];
  for (const [module, spec] of Object.entries(AREAS)) {
    for (const item of spec.split('|').filter(Boolean)) {
      const [area, name, actions] = item.split(':');
      out.push({ module, area, name, actions: (actions || STANDARD).split(',') });
    }
  }
  return out;
}

function moduleList(): Array<{ code: string; name: string }> {
  const seen = new Set<string>();
  const list: Array<{ code: string; name: string }> = [];
  for (const m of [...DEFAULT_MODULES.map((m) => ({ code: m.code, name: m.name })), ...EXTRA_MODULES]) {
    if (seen.has(m.code)) continue;
    seen.add(m.code);
    list.push(m);
  }
  return list;
}

/** Stable legacy code: derived from the permission key itself, so adding or reordering permissions never renumbers. */
function legacyCode(module: string, permission: string, taken: Set<string>): string {
  for (let salt = 0; salt < 50; salt++) {
    const digest = createHash('sha256').update(permission + (salt ? '#' + salt : '')).digest();
    const tail = (digest.readUInt32BE(0) % 1679616).toString(36).toUpperCase().padStart(4, '0');
    const code = `${module}-LEG-${tail}`;
    if (!taken.has(code)) return code;
  }
  throw new Error('Could not derive a unique legacy transaction code for ' + permission);
}

export function plannedTransactionBlueprints(): TransactionBlueprint[] {
  const result: TransactionBlueprint[] = [];
  const defs = areaDefinitions();
  for (const mod of moduleList()) {
    const module = mod.code;
    result.push({ code: `${module}-MOD-VW`, module, area: 'MOD', areaName: mod.name, action: 'VW', actionName: 'View', name: `Access ${mod.name}`, state: 'reserved', executable: false, requiredGate: 'verified_backend_handler_and_governance', kind: 'module_access', legacyPermissionKeys: [] });
    for (const def of defs.filter((d) => d.module === module)) {
      result.push({ code: `${module}-${def.area}-VW`, module, area: def.area, areaName: def.name, action: 'VW', actionName: 'View', name: `Access ${def.name}`, state: 'reserved', executable: false, requiredGate: 'verified_backend_handler_and_governance', kind: 'submodule_access', legacyPermissionKeys: [] });
      for (const action of def.actions.filter((a) => a !== 'VW')) {
        const verb = ACTION_NAMES[action];
        if (!verb) throw new Error(`Unknown action ${action} in ${module}-${def.area}`);
        result.push({ code: `${module}-${def.area}-${action}`, module, area: def.area, areaName: def.name, action, actionName: verb, name: `${verb}: ${def.name}`, state: 'reserved', executable: false, requiredGate: 'verified_backend_handler_and_governance', kind: 'transaction', legacyPermissionKeys: [] });
      }
    }
  }
  // Legacy action permissions are explicitly captured, not upgraded into live
  // canonical permissions; a reviewed mapping is required before cutover.
  const taken = new Set(result.map((r) => r.code));
  for (const legacy of discoverTransactionActions()) {
    const code = legacyCode(legacy.module, legacy.legacyPermission, taken);
    taken.add(code);
    result.push({ code, module: legacy.module, area: 'LEG', areaName: 'Existing permission', action: 'LG', actionName: 'Existing permission', name: legacy.label, state: 'catalogued_legacy', executable: false, requiredGate: 'verified_backend_handler_and_governance', kind: 'transaction', legacyPermissionKeys: [legacy.legacyPermission] });
  }
  const codes = new Set<string>();
  for (const x of result) {
    if (!/^[A-Z]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{2,4}$/.test(x.code) || codes.has(x.code)) throw new Error('Invalid/duplicate transaction code: ' + x.code);
    codes.add(x.code);
  }
  return result;
}

export function assertBlueprintNotExecutable(code: string): never {
  throw new Error('Transaction ' + code + ' is a reserved blueprint. Implement, verify, classify, authorize and activate its backend handler first.');
}
