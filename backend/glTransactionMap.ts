/**
 * GL account → transaction handlers.
 *
 * For every account in the MEMS GL master, the transactions that post to it (live) or will post to it (reserved
 * placeholders), with the side they post on. The default is derived deterministically from the account's own master
 * data, in this order:
 *   1. posting mode (automatic-only accounts belong to the run or subledger that owns them),
 *   2. the subledger it reconciles to (vendor, customer, employee, payroll, bank, tax, loan, lease, …),
 *   3. its IFRS category (and a few name refinements inside a category),
 *   4. its cost object (maintenance order, production order, project),
 *   5. tax relevance (input / output VAT on purchase and sales documents),
 *   6. every account open to manual posting can also take a manual journal (FIN-JRN-PS).
 * MEMS administration may adjust the default per account; legal entities may adjust it again (maker-checker); cost
 * centers may switch transactions off (maker-checker). Explicit removals are enforced at posting time; defaults are
 * advisory, so nothing that posts today stops working.
 */

export type Side = 'Dr' | 'Cr' | 'Dr/Cr';
export interface Handler { code: string; side: Side }

export interface MasterAccount {
    code: string;
    name: string;
    classCode: string;
    categoryCode: string;
    categoryName?: string;
    groupCode?: string;
    accountRole?: string;
    accountType?: string;
    postingMode?: string;
    properties?: Record<string, string>;
}

const h = (code: string, side: Side): Handler => ({ code, side });

/** Handlers per IFRS category for accounts open to normal posting. */
const BY_CATEGORY: Record<string, Handler[]> = {
    // ----- Assets -----
    '101': [h('FIN-BNK-RE', 'Dr/Cr'), h('FIN-RCP-PS', 'Dr'), h('FIN-APP-PY', 'Cr'), h('FIN-EXP-PY', 'Cr'), h('FIN-ADV-PY', 'Cr'), h('PAY-PAY-PS', 'Cr')],
    '102': [h('FIN-ARC-PS', 'Dr'), h('FIN-RCP-PS', 'Cr'), h('SAL-INV-PS', 'Dr')],
    '103': [h('PRC-GRN-GR', 'Dr'), h('INV-GIS-PS', 'Cr'), h('INV-CNT-PS', 'Dr/Cr'), h('INV-ADJ-PS', 'Dr/Cr'), h('INV-TRF-DI', 'Cr'), h('INV-TRF-GR', 'Dr'), h('INV-WOF-PS', 'Cr'), h('INV-VAL-PS', 'Dr/Cr'), h('FIN-OPN-PS', 'Dr'), h('FIN-REC-RE', 'Dr/Cr'), h('INV-RTN-PS', 'Dr'), h('PRC-RTV-PS', 'Cr'), h('SAL-DEL-PS', 'Cr'), h('MFG-CON-PS', 'Cr'), h('MFG-OUT-PS', 'Dr')],
    '104': [h('FIN-ACR-PS', 'Dr/Cr'), h('FIN-APY-PS', 'Dr')],
    '105': [h('FIN-APY-PS', 'Dr'), h('FIN-TAX-FL', 'Cr')],
    '106': [h('FIN-TRS-PS', 'Dr/Cr')],
    '107': [h('AST-CAP-PS', 'Dr'), h('FIN-FAS-DS', 'Cr')],
    '108': [h('FIN-FAS-DP', 'Cr'), h('AST-DEP-PS', 'Cr'), h('FIN-FAS-DS', 'Dr')],
    '109': [h('PRC-GRN-GR', 'Dr'), h('PRC-SVC-AC', 'Dr'), h('AST-CAP-PS', 'Cr')],
    '110': [h('FIN-LSE-PS', 'Dr'), h('FIN-FAS-DP', 'Cr')],
    '111': [h('AST-CAP-PS', 'Dr'), h('FIN-FAS-DP', 'Cr'), h('FIN-FAS-DS', 'Cr')],
    '112': [h('AST-CAP-PS', 'Dr'), h('FIN-FAS-DS', 'Cr')],
    '113': [h('AST-CAP-PS', 'Dr'), h('FIN-FAS-DS', 'Cr')],
    '114': [h('FIN-TRS-PS', 'Dr/Cr')],
    '115': [h('FIN-ACR-PS', 'Dr/Cr')],
    '116': [h('FIN-FAS-DS', 'Dr/Cr')],
    '117': [h('FIN-TRS-PS', 'Dr/Cr')],
    '118': [h('FIN-ICO-PS', 'Dr'), h('FIN-ICO-RE', 'Cr')],
    '119': [h('FIN-REC-RE', 'Dr/Cr'), h('FIN-BNK-RE', 'Dr/Cr')],
    // ----- Liabilities -----
    '201': [h('FIN-APY-PS', 'Cr'), h('FIN-APP-PY', 'Dr'), h('PRC-MCH-AP', 'Cr')],
    '202': [h('FIN-ACR-PS', 'Cr'), h('FIN-APY-PS', 'Dr')],
    '203': [h('PAY-RUN-PS', 'Cr'), h('PAY-PAY-PS', 'Dr'), h('FIN-EXP-AP', 'Cr'), h('FIN-EXP-PY', 'Dr')],
    '204': [h('FIN-TAX-FL', 'Dr'), h('FIN-ARC-PS', 'Cr'), h('PAY-TAX-PS', 'Cr'), h('FIN-APP-PY', 'Cr')],
    '205': [h('FIN-RCP-PS', 'Cr'), h('FIN-ARC-PS', 'Dr')],
    '206': [h('FIN-TRS-PS', 'Dr/Cr')],
    '207': [h('FIN-LSE-PS', 'Dr/Cr')],
    '208': [h('FIN-TRS-PS', 'Dr/Cr')],
    '209': [h('FIN-ACR-PS', 'Dr/Cr')],
    '210': [h('PAY-BEN-PS', 'Cr'), h('FIN-ACR-PS', 'Dr/Cr')],
    '211': [h('FIN-TAX-FL', 'Dr/Cr'), h('FIN-CLS-RN', 'Dr/Cr')],
    '212': [h('FIN-TRS-PS', 'Dr/Cr')],
    '213': [h('FIN-FAS-DS', 'Dr/Cr')],
    '214': [h('FIN-TRS-PS', 'Dr/Cr')],
    '215': [h('FIN-REC-RE', 'Dr/Cr'), h('FIN-BNK-RE', 'Dr/Cr')],
    '216': [h('FIN-ICO-PS', 'Cr'), h('FIN-ICO-RE', 'Dr')],
    // ----- Equity -----
    '301': [h('FIN-EQT-PS', 'Dr/Cr')],
    '302': [h('FIN-EQT-PS', 'Dr/Cr'), h('FIN-CLS-LK', 'Dr/Cr')],
    '303': [h('FIN-EQT-PS', 'Dr/Cr')],
    // ----- Revenue and income -----
    '401': [h('SAL-INV-PS', 'Cr'), h('FIN-ARC-PS', 'Cr')],
    '402': [h('SAL-INV-PS', 'Cr'), h('FIN-ARC-PS', 'Cr')],
    '403': [h('PRJ-PRJ-PS', 'Cr'), h('FIN-ARC-PS', 'Cr')],
    '404': [h('FIN-ARC-PS', 'Cr')],
    '405': [h('FIN-TRS-PS', 'Cr'), h('FIN-BNK-RE', 'Cr')],
    '406': [h('FIN-ARC-PS', 'Cr'), h('FIN-FAS-DS', 'Cr')],
    '407': [h('FIN-ARC-PS', 'Cr'), h('FIN-RCP-PS', 'Cr')],
    '408': [h('SAL-RET-PS', 'Dr'), h('FIN-ARC-PS', 'Dr')],
    '409': [h('FIN-ICO-PS', 'Cr')],
    // ----- Cost of sales -----
    '501': [h('INV-GIS-PS', 'Dr'), h('MFG-CON-PS', 'Dr'), h('SAL-DEL-PS', 'Dr'), h('PRC-GRN-GR', 'Dr')],
    '502': [h('PAY-RUN-PS', 'Dr'), h('PRC-SVC-AC', 'Dr'), h('INV-GIS-PS', 'Dr'), h('CST-OVH-PS', 'Dr/Cr')],
    '503': [h('INV-CNT-PS', 'Dr/Cr'), h('INV-VAL-PS', 'Dr/Cr'), h('INV-WOF-PS', 'Dr'), h('CST-VAR-PS', 'Dr/Cr'), h('MFG-OUT-PS', 'Dr/Cr')],
    '504': [h('PRC-SVC-AC', 'Dr'), h('PRJ-CST-PS', 'Dr')],
    '505': [h('PRC-SVC-AC', 'Dr'), h('LOG-FRT-PS', 'Dr')],
    '506': [h('PRC-SVC-AC', 'Dr'), h('INV-GIS-PS', 'Dr'), h('PRC-GRN-GR', 'Dr')],
    '507': [h('FIN-ICO-PS', 'Dr')],
    // ----- Operating expenses -----
    '601': [h('PAY-RUN-PS', 'Dr'), h('FIN-EXP-AP', 'Dr'), h('PRC-SVC-AC', 'Dr')],
    '610': [h('FIN-FAS-DP', 'Dr'), h('AST-DEP-PS', 'Dr')],
    '612': [h('PRC-SVC-AC', 'Dr'), h('INV-GIS-PS', 'Dr'), h('MNT-WOR-PS', 'Dr'), h('PRC-GRN-GR', 'Dr')],
    '618': [h('FIN-ACR-PS', 'Dr/Cr'), h('FIN-ARC-RV', 'Dr')],
    '620': [h('PRC-GRN-GR', 'Dr'), h('INV-GIS-PS', 'Dr'), h('FIN-APY-PS', 'Dr'), h('FIN-EXP-AP', 'Dr'), h('FIN-PTC-PY', 'Dr')],
    // ----- Finance, tax and other -----
    '701': [h('FIN-TRS-PS', 'Dr'), h('FIN-LSE-PS', 'Dr'), h('FIN-BNK-RE', 'Dr')],
    '702': [h('FIN-FXR-RV', 'Dr/Cr'), h('FIN-APP-PY', 'Dr/Cr'), h('FIN-RCP-PS', 'Dr/Cr')],
    '703': [h('FIN-FAS-DS', 'Dr/Cr'), h('FIN-TRS-PS', 'Dr/Cr')],
    '704': [h('FIN-TAX-FL', 'Dr')],
    '705': [h('FIN-CON-RN', 'Dr/Cr'), h('FIN-CLS-RN', 'Dr/Cr')],
    '706': [h('FIN-CON-RN', 'Dr/Cr')],
    '707': [h('FIN-CON-RN', 'Dr/Cr'), h('FIN-CLS-RN', 'Dr/Cr')],
    '708': [h('FIN-CLS-RN', 'Dr/Cr')],
    // ----- Memorandum, statistical, management accounting -----
    '801': [h('FIN-MEM-PS', 'Dr/Cr')],
    '802': [h('FIN-MEM-PS', 'Dr/Cr')],
    '803': [h('FIN-MEM-PS', 'Dr/Cr')],
    '901': [h('FIN-CCA-AL', 'Dr/Cr')],
    '902': [h('CST-ACT-PS', 'Dr/Cr')],
    '903': [h('CST-OVH-PS', 'Dr/Cr')],
    '904': [h('CST-ACT-CL', 'Dr/Cr'), h('PRJ-CLS-CL', 'Dr/Cr')],
    '905': [h('FIN-CCA-AL', 'Dr/Cr')],
    '906': [h('FIN-CLS-LK', 'Dr/Cr')],
};

/** Purchased services, facilities, admin, IT, marketing, travel, fees, R&D, SHE, other, insurance, utilities, warehousing, leases, board. */
const PURCHASED_EXPENSE: Handler[] = [h('PRC-SVC-AC', 'Dr'), h('PRC-GRN-GR', 'Dr'), h('FIN-APY-PS', 'Dr'), h('FIN-EXP-AP', 'Dr'), h('FIN-PTC-PY', 'Dr')];
for (const c of ['602', '603', '604', '605', '606', '607', '608', '609', '611', '613', '614', '615', '616', '617', '619']) BY_CATEGORY[c] = PURCHASED_EXPENSE;

/** The subledger an automatic-only control account belongs to. */
const BY_SUBLEDGER: Record<string, Handler[]> = {
    vendor: [h('FIN-APY-PS', 'Cr'), h('FIN-APP-PY', 'Dr'), h('PRC-MCH-AP', 'Cr')],
    customer: [h('FIN-ARC-PS', 'Dr'), h('FIN-RCP-PS', 'Cr'), h('SAL-INV-PS', 'Dr')],
    employee: [h('FIN-EXP-AP', 'Cr'), h('FIN-EXP-PY', 'Dr'), h('FIN-ADV-PY', 'Dr'), h('FIN-ADV-RE', 'Cr')],
    payroll: [h('PAY-RUN-PS', 'Cr'), h('PAY-PAY-PS', 'Dr')],
    intercompany: [h('FIN-ICO-PS', 'Dr/Cr'), h('FIN-ICO-RE', 'Dr/Cr')],
    tax: [h('FIN-TAX-FL', 'Dr/Cr')],
    loan: [h('FIN-TRS-PS', 'Dr/Cr')],
    lease: [h('FIN-LSE-PS', 'Dr/Cr')],
    bank: [h('FIN-BNK-RE', 'Dr/Cr')],
    'cash count': [h('FIN-PTC-RE', 'Dr/Cr')],
};

/** Clearing accounts (open item matching) by what they clear. */
function clearingHandlers(a: MasterAccount): Handler[] {
    const n = a.name.toLowerCase();
    if (/goods receiv|gr\/ir|grni|received not invoiced|service.* not invoiced/.test(n)) return [h('PRC-GRN-GR', 'Cr'), h('PRC-SVC-AC', 'Cr'), h('FIN-APY-PS', 'Dr'), h('PRC-MCH-MT', 'Dr/Cr')];
    if (/asset|capital/.test(n)) return [h('PRC-GRN-GR', 'Dr'), h('AST-CAP-PS', 'Cr')];
    if (/transit|transfer/.test(n) && /stock|inventor|goods/.test(n)) return [h('INV-TRF-DI', 'Dr'), h('INV-TRF-GR', 'Cr')];
    if (/payroll|salar|wage|net pay/.test(n)) return [h('PAY-RUN-PS', 'Cr'), h('PAY-PAY-PS', 'Dr')];
    if (/bank|cash|card|mobile|wallet|deposit|cheque|remittance|payment/.test(n)) return [h('FIN-BNK-RE', 'Dr/Cr'), h('FIN-RCP-PS', 'Dr/Cr'), h('FIN-APP-PY', 'Dr/Cr')];
    if (/intercompany|inter-company/.test(n)) return [h('FIN-ICO-RE', 'Dr/Cr')];
    return [h('FIN-REC-RE', 'Dr/Cr')];
}

/** Accounts posted by inventory movements and valuation. */
function inventoryHandlers(a: MasterAccount): Handler[] {
    if (a.categoryCode === '503' || /variance|differen|revaluation|write.?down/i.test(a.name)) return BY_CATEGORY['503'];
    if (a.categoryCode === '103') return BY_CATEGORY['103'];
    if (a.categoryCode === '501') return BY_CATEGORY['501'];
    return [h('INV-VAL-PS', 'Dr/Cr'), h('INV-GIS-PS', 'Dr/Cr')];
}

/** Accounts posted by fixed asset and lease runs. */
function assetRunHandlers(a: MasterAccount): Handler[] {
    if (a.categoryCode === '207' || a.categoryCode === '110' || /lease|right.of.use/i.test(a.name)) return [h('FIN-LSE-PS', 'Dr/Cr'), h('FIN-FAS-DP', 'Dr/Cr')];
    if (a.categoryCode === '108' || /accumulated|impairment/i.test(a.name)) return BY_CATEGORY['108'];
    if (a.categoryCode === '610' || /depreciation|amortis|amortiz/i.test(a.name)) return BY_CATEGORY['610'];
    if (a.categoryCode === '703' || /disposal|gain|loss/i.test(a.name)) return [h('FIN-FAS-DS', 'Dr/Cr')];
    return BY_CATEGORY[a.categoryCode] ?? [h('AST-CAP-PS', 'Dr'), h('FIN-FAS-DP', 'Dr/Cr'), h('FIN-FAS-DS', 'Dr/Cr')];
}

/** Name refinements inside a category (petty cash, staff advances, input or output VAT, payroll taxes, bank charges). */
function refinements(a: MasterAccount): Handler[] {
    const n = a.name.toLowerCase();
    const out: Handler[] = [];
    if (a.categoryCode === '101' && /petty cash|imprest|cash float/.test(n)) out.push(h('FIN-PTC-PY', 'Cr'), h('FIN-PTC-RE', 'Dr'));
    if (a.categoryCode === '102' && /staff|employee|salary advance/.test(n)) out.push(h('FIN-ADV-PY', 'Dr'), h('FIN-ADV-RE', 'Cr'));
    if (a.categoryCode === '501' && /cost of (goods )?sold|cost of sales/.test(n)) out.push(h('SAL-DEL-PS', 'Dr'));
    if (a.categoryCode === '502' && /overhead|absorb/.test(n)) out.push(h('CST-OVH-PS', 'Dr/Cr'));
    if (a.categoryCode === '601' && /claim|travel|subsistence|per diem/.test(n)) out.push(h('FIN-EXP-AP', 'Dr'));
    if (a.categoryCode === '701' && /bank (charge|fee|commission)/.test(n)) out.push(h('FIN-BNK-RE', 'Dr'));
    if (/withholding/.test(n)) out.push(h('FIN-APP-PY', 'Cr'), h('FIN-TAX-FL', 'Dr'));
    return out;
}

const COST_OBJECT: Array<[RegExp, Handler[]]> = [
    [/maintenance order/i, [h('MNT-WOR-PS', 'Dr'), h('INV-GIS-PS', 'Dr')]],
    [/production order|production cost center/i, [h('MFG-POD-PS', 'Dr'), h('MFG-CON-PS', 'Dr')]],
    [/project/i, [h('PRJ-CST-PS', 'Dr')]],
];

const automaticOnly = (mode: string) => !/^manual/i.test(mode);

/** Default handlers for one master account (deduplicated, stable order). */
export function defaultHandlers(a: MasterAccount): Handler[] {
    const mode = a.postingMode ?? 'Manual and automatic';
    const props = a.properties ?? {};
    const reconciled = (props['Reconciled to'] ?? '').trim().toLowerCase();
    const list: Handler[] = [];
    const add = (xs: Handler[] | undefined) => { for (const x of xs ?? []) list.push(x); };

    if (/subledger/i.test(mode)) add(BY_SUBLEDGER[reconciled] ?? clearingHandlers(a));
    else if (/open item/i.test(mode)) add(clearingHandlers(a));
    else if (/inventory movements/i.test(mode)) add(inventoryHandlers(a));
    else if (/fixed asset and lease/i.test(mode)) add(assetRunHandlers(a));
    else if (/allocation|activity|settlement/i.test(mode)) add(BY_CATEGORY[a.categoryCode] ?? [h('FIN-CCA-AL', 'Dr/Cr')]);
    else if (/closing programme/i.test(mode)) add([h('FIN-CLS-LK', 'Dr/Cr'), h('FIN-CLS-AP', 'Dr/Cr')]);
    else if (/revaluation/i.test(mode)) add([h('FIN-FXR-RV', 'Dr/Cr')]);
    else if (/memorandum|statistical/i.test(mode)) add([h('FIN-MEM-PS', 'Dr/Cr')]);
    else {
        add(BY_CATEGORY[a.categoryCode]);
        if (reconciled && BY_SUBLEDGER[reconciled] && !['bank'].includes(reconciled)) add(BY_SUBLEDGER[reconciled]);
    }
    add(refinements(a));
    for (const [re, hs] of COST_OBJECT) if (re.test(props['Cost object'] ?? '')) add(hs);
    const tax = props['Tax relevance'] ?? '';
    if (a.categoryCode.startsWith('6') || a.categoryCode.startsWith('5')) {
        if (/input tax/i.test(tax)) add([h('FIN-APY-PS', 'Dr')]);
    }
    if (/^4/.test(a.categoryCode) && /output tax/i.test(tax)) add([h('FIN-ARC-PS', 'Cr')]);
    if (!automaticOnly(mode)) add([h('FIN-JRN-PS', 'Dr/Cr')]);

    const seen = new Map<string, Handler>();
    for (const x of list) {
        const prev = seen.get(x.code);
        if (!prev) seen.set(x.code, x);
        else if (prev.side !== x.side) seen.set(x.code, { code: x.code, side: 'Dr/Cr' });
    }
    return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Overrides: MEMS default changes, legal entity changes, cost center switch-offs.
// ---------------------------------------------------------------------------

export interface AccountOverride { add: Handler[]; remove: string[] }
export type Overrides = Record<string, AccountOverride>;

const CODE_RE = /^[A-Z]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{2,4}$/;
const SIDES: Side[] = ['Dr', 'Cr', 'Dr/Cr'];

/** Validates overrides against known transaction codes and accounts. Throws a readable message. */
export function validateOverrides(raw: unknown, knownCodes: Set<string>, knownAccounts: Set<string>): Overrides {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Overrides = {};
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > 2500) throw new Error('Too many account changes in one proposal (maximum 2,500).');
    for (const [account, value] of entries) {
        if (!knownAccounts.has(account)) throw new Error(`Account ${account} is not in the chart.`);
        const v = (value ?? {}) as Record<string, unknown>;
        const add: Handler[] = [];
        for (const item of Array.isArray(v.add) ? v.add : []) {
            const x = (item ?? {}) as Record<string, unknown>;
            const code = String(x.code ?? ''), side = String(x.side ?? '') as Side;
            if (!CODE_RE.test(code) || !knownCodes.has(code)) throw new Error(`${account}: ${code || 'a transaction'} is not a MEMS transaction code.`);
            if (!SIDES.includes(side)) throw new Error(`${account}: choose debit, credit or both for ${code}.`);
            if (!add.some((y) => y.code === code)) add.push({ code, side });
        }
        const remove = [...new Set((Array.isArray(v.remove) ? v.remove : []).map((c) => String(c ?? '')))];
        for (const code of remove) if (!CODE_RE.test(code)) throw new Error(`${account}: ${code} is not a transaction code.`);
        if (add.length > 40 || remove.length > 40) throw new Error(`${account}: at most 40 changes per account.`);
        if (add.length || remove.length) out[account] = { add, remove };
    }
    return out;
}

/** Applies overrides in order (later layers win): base handlers, then each layer's removals and additions. */
export function applyOverrides(base: Handler[], ...layers: Array<AccountOverride | undefined>): Handler[] {
    let list = base.slice();
    for (const layer of layers) {
        if (!layer) continue;
        list = list.filter((x) => !layer.remove.includes(x.code));
        for (const x of layer.add) {
            const i = list.findIndex((y) => y.code === x.code);
            if (i >= 0) list[i] = x;
            else list.push(x);
        }
    }
    return list;
}

/** Transaction codes explicitly removed from an account by MEMS or the legal entity (enforced at posting). */
export function removedCodes(account: string, ...layers: Array<Overrides | undefined>): Set<string> {
    const out = new Set<string>();
    for (const layer of layers) for (const code of layer?.[account]?.remove ?? []) out.add(code);
    for (const layer of layers) for (const x of layer?.[account]?.add ?? []) out.delete(x.code);
    return out;
}
