/**
 * Financial movements: which transactions post to the general ledger, with which accounting roles, and the default GL
 * account for each role.
 *
 *  - Live events are the ones `post()` already performs (finCore TXNS). Planned events belong to reserved transaction
 *    codes and document the accounting the future handler must use, so integration is a matter of wiring, not design.
 *  - Default accounts are SUGGESTIONS drawn from a chart (the legal entity's chart, or the MEMS GL master). A legal
 *    entity's mapping still changes only through Finance's maker-checker proposal and approval. Nothing here posts.
 *
 * Matching order for a role: the account's own role tag in the GL master, then account-name rules that also respect
 * the role's statement (balance sheet or profit and loss). Ties go to the lowest account code, so results are stable.
 */
import { ROLES } from './finCore';

export type Statement = 'BS' | 'PL';

export interface RoleDefinition {
    code: string;
    label: string;
    statement: Statement;
    live: boolean;
    note: string;
}

/** Roles finance does not map yet; future handlers will need them. */
const PLANNED_ROLES: RoleDefinition[] = [
    { code: 'SUPPLIER_PAYABLE', label: 'Supplier payables (trade creditors)', statement: 'BS', live: false, note: 'Credited by supplier invoices; debited by supplier payments.' },
    { code: 'CUSTOMER_RECEIVABLE', label: 'Customer receivables (trade debtors)', statement: 'BS', live: false, note: 'Debited by customer invoices; credited by receipts.' },
    { code: 'BANK', label: 'Bank', statement: 'BS', live: false, note: 'Payments out and receipts in.' },
    { code: 'PETTY_CASH', label: 'Petty cash', statement: 'BS', live: false, note: 'Petty cash float.' },
    { code: 'REVENUE', label: 'Sales revenue', statement: 'PL', live: false, note: 'Credited by customer invoices.' },
    { code: 'COGS', label: 'Cost of goods sold', statement: 'PL', live: false, note: 'Debited when goods are delivered to customers.' },
    { code: 'STOCK_WRITE_OFF', label: 'Stock write-off and obsolescence', statement: 'PL', live: false, note: 'Scrap, damage and obsolete stock.' },
    { code: 'IN_TRANSIT', label: 'Stock in transit', statement: 'BS', live: false, note: 'Between dispatch and receipt in a transfer.' },
    { code: 'WIP', label: 'Work in progress', statement: 'BS', live: false, note: 'Production consumption until output.' },
    { code: 'FIXED_ASSET', label: 'Fixed assets at cost', statement: 'BS', live: false, note: 'Debited on capitalisation.' },
    { code: 'ACCUM_DEPRECIATION', label: 'Accumulated depreciation', statement: 'BS', live: false, note: 'Credited by depreciation runs.' },
    { code: 'DEPRECIATION_EXPENSE', label: 'Depreciation expense', statement: 'PL', live: false, note: 'Debited by depreciation runs.' },
    { code: 'ASSET_DISPOSAL', label: 'Gain or loss on asset disposal', statement: 'PL', live: false, note: 'Difference between proceeds and net book value.' },
    { code: 'FX_GAIN_LOSS', label: 'Foreign exchange gain or loss', statement: 'PL', live: false, note: 'Realised and unrealised currency differences.' },
    { code: 'BANK_CHARGES', label: 'Bank charges', statement: 'PL', live: false, note: 'Fees on bank statements.' },
    { code: 'STAFF_ADVANCES', label: 'Staff advances', statement: 'BS', live: false, note: 'Advances paid to employees.' },
    { code: 'EMPLOYEE_PAYABLE', label: 'Employee claims payable', statement: 'BS', live: false, note: 'Approved expense claims and net pay owed.' },
    { code: 'EXPENSE', label: 'Operating expense (line account)', statement: 'PL', live: false, note: 'Chosen per line from the cost center allowed accounts.' },
    { code: 'SALARIES', label: 'Salaries and wages', statement: 'PL', live: false, note: 'Payroll cost.' },
    { code: 'INTERCOMPANY', label: 'Intercompany balances', statement: 'BS', live: false, note: 'Due to and from group entities.' },
];

/** All roles: finance's live ones first, then planned ones. */
export function postingRoles(): RoleDefinition[] {
    return [
        ...ROLES.map((r) => ({ code: r.code, label: r.label, statement: r.statement, live: true, note: r.note })),
        ...PLANNED_ROLES.filter((p) => !ROLES.some((r) => r.code === p.code)),
    ];
}

/** Account-name rules per role, best first. `not` excludes look-alikes (e.g. "stock difference" is not inventory). */
const PATTERNS: Record<string, { match: RegExp[]; not?: RegExp }> = {
    INVENTORY: { match: [/\binventor(y|ies)\b/i, /\bstock(s)?\b/i, /\braw materials?\b/i, /\bspare parts?\b/i, /\bfinished goods\b/i, /\bconsumables?\b/i], not: /differen|variance|adjust|transit|write|obsole|provision|gain|loss|clearing|expense|consum(ed|ption)/i },
    GRIR: { match: [/gr\s*\/?\s*ir/i, /received not invoiced/i, /goods receipt clearing/i, /uninvoiced|unbilled/i, /accrued purchases?/i] },
    CONSUMPTION: { match: [/materials? consum/i, /\bconsumption\b/i, /materials? used/i, /cost of materials/i, /raw materials? (expense|used)/i], not: /maint|repair/i },
    MAINT_CONSUMPTION: { match: [/maintenance (spares|materials?|consum)/i, /repairs? (and|&) maintenance/i, /spare parts? (expense|consum)/i, /\bmaintenance\b/i] },
    ASSET_CLEARING: { match: [/assets? clearing/i, /capital work.in.progress|\bcwip\b/i, /assets? under construction/i, /assets? received/i] },
    OPENING_BALANCE: { match: [/opening balance/i, /opening clearing/i, /migration clearing/i, /take.?on/i] },
    STOCK_DIFF: { match: [/stock (count )?differen/i, /inventory (variance|adjust|shrink)/i, /stock (gain|loss|variance)/i, /count differen/i] },
    RECON_DIFF: { match: [/reconciliation differen/i, /recon(ciliation)? variance/i, /suspense/i] },
    RETAINED_EARNINGS: { match: [/retained earnings/i, /accumulated (profit|surplus)/i, /revenue reserve/i] },
    VAT_INPUT: { match: [/input (vat|tax|gst)/i, /(vat|gst|value added tax).*(input|recoverable|receivable|claimable)/i] },
    VAT_OUTPUT: { match: [/output (vat|tax|gst)/i, /(vat|gst|value added tax).*(output|payable)/i] },
    WHT_PAYABLE: { match: [/withholding tax/i, /\bwht\b/i] },
    SUPPLIER_PAYABLE: { match: [/trade (payables?|creditors)/i, /accounts payable/i, /suppliers? (control|payables?)/i, /\bcreditors\b/i], not: /vat|tax|salar|payroll|staff|employee|accrued/i },
    CUSTOMER_RECEIVABLE: { match: [/trade (receivables?|debtors)/i, /accounts receivable/i, /customers? (control|receivables?)/i, /\bdebtors\b/i], not: /vat|tax|staff|employee|other/i },
    BANK: { match: [/cash at bank/i, /\bbank\b/i, /current account/i], not: /charge|fee|loan|overdraft|interest/i },
    PETTY_CASH: { match: [/petty cash/i, /cash on hand/i, /imprest/i] },
    REVENUE: { match: [/sales revenue/i, /\brevenue\b/i, /\bsales\b/i, /\bturnover\b/i], not: /cost|return|discount|deferred/i },
    COGS: { match: [/cost of (goods )?sold/i, /cost of sales/i] },
    STOCK_WRITE_OFF: { match: [/stock write.?off/i, /inventory write.?(off|down)/i, /obsolesc/i, /scrap/i, /damaged stock/i] },
    IN_TRANSIT: { match: [/in.transit/i] },
    WIP: { match: [/work.in.progress/i, /\bwip\b/i], not: /capital/i },
    FIXED_ASSET: { match: [/property,? plant/i, /plant and (machinery|equipment)/i, /fixed assets?/i, /motor vehicles?/i, /\bbuildings?\b/i, /furniture/i, /computer equipment/i], not: /depreciation|clearing|disposal|work.in.progress|construction/i },
    ACCUM_DEPRECIATION: { match: [/accumulated depreciation/i, /provision for depreciation/i] },
    DEPRECIATION_EXPENSE: { match: [/depreciation (expense|charge)/i, /\bdepreciation\b/i, /amortis|amortiz/i], not: /accumulated|provision/i },
    ASSET_DISPOSAL: { match: [/(gain|loss|profit).*disposal/i, /disposal of (fixed )?assets?/i] },
    FX_GAIN_LOSS: { match: [/(exchange|forex|\bfx\b|currency).*(gain|loss|differen)/i] },
    BANK_CHARGES: { match: [/bank (charges|fees)/i, /bank commission/i] },
    STAFF_ADVANCES: { match: [/(staff|employee|salary) advances?/i, /staff (loans?|debtors)/i] },
    EMPLOYEE_PAYABLE: { match: [/(staff|employee) (claims|payables?|reimburse)/i, /net (pay|salar(y|ies)) payable/i, /accrued (salaries|wages)/i] },
    EXPENSE: { match: [/general (and|&) administrative/i, /operating expenses?/i, /sundry expenses?/i, /\bexpenses?\b/i], not: /depreciation|salar|wage|interest|tax|bank|consum|cost of/i },
    SALARIES: { match: [/salar(y|ies)/i, /\bwages\b/i, /payroll (cost|expense)/i, /staff costs?/i], not: /payable|advance|accrued/i },
    INTERCOMPANY: { match: [/intercompany|inter.company/i, /related part(y|ies)/i, /due (to|from) (group|related)/i] },
};

export interface ChartAccount {
    code: string;
    name: string;
    statement: Statement;
    accountRole?: string;
    accountType?: string;
    postable?: boolean;
}

export interface Suggestion {
    code: string;
    name: string;
    basis: 'gl_master_role' | 'account_name';
}

const normRole = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const ROLE_ALIASES: Record<string, string> = { GR_IR: 'GRIR', GRNI: 'GRIR', ACCOUNTS_PAYABLE: 'SUPPLIER_PAYABLE', AP: 'SUPPLIER_PAYABLE', ACCOUNTS_RECEIVABLE: 'CUSTOMER_RECEIVABLE', AR: 'CUSTOMER_RECEIVABLE', STOCK: 'INVENTORY', VAT_RECOVERABLE: 'VAT_INPUT', VAT_PAYABLE: 'VAT_OUTPUT' };

/** The best default account in `accounts` for each role, or null where nothing fits. */
export function suggestRoleAccounts(accounts: ReadonlyArray<ChartAccount>, roles: ReadonlyArray<RoleDefinition> = postingRoles()): Record<string, Suggestion | null> {
    const usable = accounts.filter((a) => a.postable !== false).slice().sort((a, b) => a.code.localeCompare(b.code));
    const out: Record<string, Suggestion | null> = {};
    for (const role of roles) {
        const tagged = usable.find((a) => a.statement === role.statement && a.accountRole && (ROLE_ALIASES[normRole(a.accountRole)] ?? normRole(a.accountRole)) === role.code);
        if (tagged) {
            out[role.code] = { code: tagged.code, name: tagged.name, basis: 'gl_master_role' };
            continue;
        }
        const rule = PATTERNS[role.code];
        let best: { account: ChartAccount; rank: number } | null = null;
        if (rule) {
            for (const a of usable) {
                if (a.statement !== role.statement) continue;
                const text = `${a.name} ${a.accountType ?? ''}`;
                if (rule.not?.test(text)) continue;
                const rank = rule.match.findIndex((re) => re.test(text));
                if (rank < 0) continue;
                if (!best || rank < best.rank) best = { account: a, rank };
            }
        }
        out[role.code] = best ? { code: best.account.code, name: best.account.name, basis: 'account_name' } : null;
    }
    return out;
}

export interface PostingEvent {
    event: string;
    label: string;
    /** Transaction codes (MODULE-AREA-ACTION) that perform or will perform this posting. */
    codes: string[];
    debit: string[];
    credit: string[];
    state: 'live' | 'planned';
    source: string;
    /** Installed routes that perform a live posting (POST paths). */
    via?: string[];
}

/**
 * Every financial movement MEMS performs or will perform. Live events mirror finCore TXNS exactly; a line account
 * (`EXPENSE` on direct receipts and services) is chosen from the cost center's allowed accounts at entry.
 */
export const POSTING_EVENTS: PostingEvent[] = [
    // ----- Live (posted today by post()) -----
    { event: 'GR_STOCK', label: 'Goods receipt into a warehouse', codes: ['PRC-GRN-GR', 'PRC-GRN-PS'], debit: ['INVENTORY'], credit: ['GRIR'], state: 'live', source: 'Purchase order delivery', via: ['/api/org/procurement/orders/receive'] },
    { event: 'GR_DIRECT', label: 'Goods receipt direct to a cost center', codes: ['PRC-GRN-GR', 'PRC-GRN-PS'], debit: ['EXPENSE'], credit: ['GRIR'], state: 'live', source: 'Purchase order delivery (line account)', via: ['/api/org/procurement/orders/receive'] },
    { event: 'GR_ASSET', label: 'Asset receipt', codes: ['PRC-GRN-GR', 'PRC-GRN-PS'], debit: ['ASSET_CLEARING'], credit: ['GRIR'], state: 'live', source: 'Purchase order delivery', via: ['/api/org/procurement/orders/receive'] },
    { event: 'SVC_ACCEPT', label: 'Service accepted by the cost center owner', codes: ['PRC-SVC-AC', 'PRC-SVC-PS'], debit: ['EXPENSE'], credit: ['GRIR'], state: 'live', source: 'Service receipt (line account)', via: ['/api/org/procurement/orders/service/accept'] },
    { event: 'GI_CC', label: 'Goods issue to a cost center', codes: ['INV-GIS-PS', 'INV-GIS-IS'], debit: ['CONSUMPTION'], credit: ['INVENTORY'], state: 'live', source: 'Goods issue', via: ['/api/org/inv/issue/post'] },
    { event: 'GI_WO', label: 'Goods issue to a maintenance work order (and its returns)', codes: ['INV-GIS-PS', 'INV-RTN-PS'], debit: ['MAINT_CONSUMPTION'], credit: ['INVENTORY'], state: 'live', source: 'Goods issue / work order return', via: ['/api/org/inv/issue/post', '/api/org/mnt/operations'] },
    { event: 'ST_ADJ', label: 'Stock take difference', codes: ['INV-CNT-PS'], debit: ['STOCK_DIFF'], credit: ['INVENTORY'], state: 'live', source: 'Stock take posting (gains reverse the sides)', via: ['/api/org/inventory/stocktake/action'] },
    { event: 'STK_OPEN', label: 'Opening stock valuation', codes: ['FIN-OPN-PS', 'INV-OPN-PS'], debit: ['INVENTORY'], credit: ['OPENING_BALANCE'], state: 'live', source: 'Approved opening valuation', via: ['/api/org/fin/requests/decide'] },
    { event: 'INV_RECON', label: 'Inventory reconciliation adjustment', codes: ['FIN-REC-RE', 'FIN-CLS-RN'], debit: ['RECON_DIFF'], credit: ['INVENTORY'], state: 'live', source: 'Approved reconciliation (direction follows the difference)', via: ['/api/org/fin/requests/decide'] },
    { event: 'REALLOC', label: 'Cost center reallocation', codes: ['FIN-CCA-AL', 'FIN-CLS-RN'], debit: ['EXPENSE'], credit: ['EXPENSE'], state: 'live', source: 'Approved reallocation (same account, between cost centers)', via: ['/api/org/fin/requests/decide'] },
    { event: 'YE_CLOSE', label: 'Year-end close of profit and loss', codes: ['FIN-CLS-LK', 'FIN-CLS-AP'], debit: ['RETAINED_EARNINGS'], credit: ['RETAINED_EARNINGS'], state: 'live', source: 'Approved year-end close (P&L accounts against retained earnings)', via: ['/api/org/fin/requests/decide'] },
    // ----- Planned (reserved codes; handlers not built) -----
    { event: 'AP_INVOICE', label: 'Supplier invoice', codes: ['FIN-APY-PS', 'PRC-MCH-AP'], debit: ['GRIR', 'VAT_INPUT'], credit: ['SUPPLIER_PAYABLE'], state: 'planned', source: 'Accounts payable after three-way match' },
    { event: 'AP_PAYMENT', label: 'Supplier payment', codes: ['FIN-APP-PY'], debit: ['SUPPLIER_PAYABLE'], credit: ['BANK', 'WHT_PAYABLE'], state: 'planned', source: 'Approved payment run' },
    { event: 'AR_INVOICE', label: 'Customer invoice', codes: ['FIN-ARC-PS', 'SAL-INV-PS'], debit: ['CUSTOMER_RECEIVABLE'], credit: ['REVENUE', 'VAT_OUTPUT'], state: 'planned', source: 'Accounts receivable / sales invoicing' },
    { event: 'AR_RECEIPT', label: 'Customer receipt', codes: ['FIN-RCP-PS'], debit: ['BANK'], credit: ['CUSTOMER_RECEIVABLE'], state: 'planned', source: 'Receipt allocation' },
    { event: 'SAL_COGS', label: 'Cost of goods delivered to a customer', codes: ['SAL-DEL-PS'], debit: ['COGS'], credit: ['INVENTORY'], state: 'planned', source: 'Sales delivery' },
    { event: 'RTV', label: 'Return to vendor', codes: ['PRC-RTV-PS', 'PRC-GRN-RV'], debit: ['GRIR'], credit: ['INVENTORY'], state: 'planned', source: 'Return of received goods' },
    { event: 'TRF_OUT', label: 'Stock transfer dispatched', codes: ['INV-TRF-DI', 'WHS-TRF-DI'], debit: ['IN_TRANSIT'], credit: ['INVENTORY'], state: 'planned', source: 'Inter-warehouse transfer' },
    { event: 'TRF_IN', label: 'Stock transfer received', codes: ['INV-TRF-GR', 'WHS-TRF-GR'], debit: ['INVENTORY'], credit: ['IN_TRANSIT'], state: 'planned', source: 'Inter-warehouse transfer' },
    { event: 'INV_ADJ', label: 'Stock adjustment', codes: ['INV-ADJ-PS'], debit: ['STOCK_DIFF'], credit: ['INVENTORY'], state: 'planned', source: 'Approved adjustment (gains reverse the sides)' },
    { event: 'INV_WRITEOFF', label: 'Stock write-off or scrap', codes: ['INV-WOF-PS', 'INV-OBS-DS'], debit: ['STOCK_WRITE_OFF'], credit: ['INVENTORY'], state: 'planned', source: 'Approved write-off' },
    { event: 'MFG_ISSUE', label: 'Material issued to production', codes: ['MFG-CON-PS'], debit: ['WIP'], credit: ['INVENTORY'], state: 'planned', source: 'Production consumption' },
    { event: 'MFG_OUTPUT', label: 'Production output to stock', codes: ['MFG-OUT-PS'], debit: ['INVENTORY'], credit: ['WIP'], state: 'planned', source: 'Production output' },
    { event: 'AST_CAPITALIZE', label: 'Asset capitalisation', codes: ['AST-CAP-PS'], debit: ['FIXED_ASSET'], credit: ['ASSET_CLEARING'], state: 'planned', source: 'Capitalisation of received assets' },
    { event: 'DEPRECIATION', label: 'Depreciation run', codes: ['FIN-FAS-DP', 'AST-DEP-PS'], debit: ['DEPRECIATION_EXPENSE'], credit: ['ACCUM_DEPRECIATION'], state: 'planned', source: 'Monthly depreciation' },
    { event: 'AST_DISPOSAL', label: 'Asset disposal', codes: ['FIN-FAS-DS', 'AST-DSP-PS'], debit: ['ACCUM_DEPRECIATION', 'ASSET_DISPOSAL'], credit: ['FIXED_ASSET'], state: 'planned', source: 'Disposal at net book value' },
    { event: 'EXP_CLAIM', label: 'Approved expense claim', codes: ['FIN-EXP-AP'], debit: ['EXPENSE', 'VAT_INPUT'], credit: ['EMPLOYEE_PAYABLE'], state: 'planned', source: 'Expense claims' },
    { event: 'EXP_PAY', label: 'Expense claim paid', codes: ['FIN-EXP-PY'], debit: ['EMPLOYEE_PAYABLE'], credit: ['BANK'], state: 'planned', source: 'Claim payment' },
    { event: 'ADV_PAY', label: 'Staff advance paid', codes: ['FIN-ADV-PY'], debit: ['STAFF_ADVANCES'], credit: ['BANK'], state: 'planned', source: 'Advances' },
    { event: 'ADV_SETTLE', label: 'Staff advance settled', codes: ['FIN-ADV-RE'], debit: ['EXPENSE'], credit: ['STAFF_ADVANCES'], state: 'planned', source: 'Advance retirement' },
    { event: 'PTC_SPEND', label: 'Petty cash expense', codes: ['FIN-PTC-PY'], debit: ['EXPENSE'], credit: ['PETTY_CASH'], state: 'planned', source: 'Petty cash vouchers' },
    { event: 'PTC_TOPUP', label: 'Petty cash replenishment', codes: ['FIN-PTC-RE'], debit: ['PETTY_CASH'], credit: ['BANK'], state: 'planned', source: 'Imprest top-up' },
    { event: 'BANK_FEE', label: 'Bank charges', codes: ['FIN-BNK-RE'], debit: ['BANK_CHARGES'], credit: ['BANK'], state: 'planned', source: 'Bank reconciliation' },
    { event: 'FX_REVAL', label: 'Foreign currency revaluation', codes: ['FIN-FXR-RV'], debit: ['FX_GAIN_LOSS'], credit: ['SUPPLIER_PAYABLE'], state: 'planned', source: 'Period-end revaluation (sides follow the difference; also receivables and bank)' },
    { event: 'ICO_CHARGE', label: 'Intercompany charge', codes: ['FIN-ICO-PS'], debit: ['INTERCOMPANY'], credit: ['REVENUE'], state: 'planned', source: 'Intercompany billing' },
    { event: 'PAYROLL', label: 'Payroll posting', codes: ['PAY-RUN-PS'], debit: ['SALARIES'], credit: ['EMPLOYEE_PAYABLE', 'WHT_PAYABLE'], state: 'planned', source: 'Payroll run' },
];

/** Posting events performed by a transaction code. */
export function postingsFor(code: string): PostingEvent[] {
    return POSTING_EVENTS.filter((e) => e.codes.includes(code));
}
