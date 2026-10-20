import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link2, Link2Off, PackagePlus, Pencil, Save, Send, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { InfoTip, Screen, Segmented, messageOf, useConfirm } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';
import { restoredTableTab } from '../lib/tableTabs';
import { Badge, Button, Card, Spinner, TextArea, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { AUTOMATED_METHODS, METHODS, PARAMS, factorsOf, methodOf, routeFor } from '../../backend/replenishmentPlan';
import MaterialOverview, { type MaterialPhoto } from './MaterialOverview';

// Material detail for one warehouse (INV), opened from Inventory on hand.
//   Overview                 photos (taken on the phone), identity, stock health against min/max and key facts
//   Stock Control            the policy dimensions; the replenishment strategy chosen here is the only one that plans
//   Replenishment            follows Stock Control: RP01-RP04 and RP06 are planned automatically, every other strategy is recorded only
//   Current Status           stock position from the posted, reconciled material journal; first-time (opening) stock
//                            is posted once and cannot be reversed; restricted stock is isolated through a request that
//                            needs approval (no stock moves until it is approved)
//   Inventory / Procurement  warehouse-specific settings, validated here as on the server (numbers ≥ 0, min ≤ max,
//                            safety stock and reorder point ≤ max, lead time in whole days ≤ 3650, text ≤ 120, remarks ≤ 1000);
//                            the physical location (bin) changes only by link / delink, never through the settings form
//   Movements                the material journal for this warehouse
//   Criticality / Technical  criticality placeholder and the original material master record
// Every change is confirmed in-app and recorded by the server (journal, bin events, audit trail).

type Info = Record<string, string | number>;

interface Movement {
    id: string;
    type: string;
    status: string;
    reconciled: boolean;
    postedAt: string;
    postedBy: string;
    reference: string;
    balancesDelta: Record<string, number>;
}

interface IsolationRequest {
    id: string;
    reason: string;
    quantity: number;
    status: string;
    moveToBin: boolean;
    createdAt: string;
}

interface CurrentStatus {
    isolationRequests?: IsolationRequest[];
    canInitialize?: boolean;
    reconciled: boolean;
    entryCount: number;
    balances: Record<string, number>;
    reason: string;
}

interface BinDiagnostics {
    configured: number;
    matchingClassification: number;
    unalignedBins?: number;
    occupied: number;
    /** The material's effective warehouse restriction (RS…) for this warehouse. */
    classification: string;
    restrictionLabel?: string;
    restrictionSource?: 'stock-control' | 'material-master' | '';
    warehouseId: string;
    linkedBin: string;
    required: string[];
}

interface Detail {
    material: Record<string, unknown>;
    inventory: Info;
    procurement: Info;
    materialMovements?: Movement[];
    currentStatus?: CurrentStatus;
    warehouse: { id: string; name: string };
    currency: { local: string; alternatives: Array<{ code: string; rate: number }> };
    canEdit: boolean;
    associatedAssets: Array<{ id: string; name: string }>;
    identities: Record<string, string>;
    catalogNames: Record<string, string>;
    structureNames: Record<string, string>;
    recommendedBins: Array<{ id: string; name: string; batch: string }>;
    binDiagnostics?: BinDiagnostics;
    /** Approved vendors whose material scope covers this material's category (and subcategory). */
    supplierOptions?: SupplierOption[];
    photos?: MaterialPhoto[];
    canPhoto?: boolean;
}

interface SupplierOption {
    id: string;
    number: string;
    name: string;
    match: 'subcategory' | 'category';
    classLabel: string;
    sourcingLabel: string;
}

interface MetaOption {
    code: string;
    description: string;
    enabled: boolean;
}

interface Uom {
    code: string;
    name: string;
    description: string;
    categoryCode: string;
    categoryName: string;
    subcategoryCode: string;
    subcategoryName: string;
    enabled: boolean;
}

interface Metadata {
    incoterms: MetaOption[];
    stockingPolicies: MetaOption[];
    stockDimensions: Array<{key:string;title:string;description:string;items:Array<{code:string;label:string;description:string;enabled:boolean;category:string}>}>;
    paymentTerms: MetaOption[];
    uoms: Uom[];
}

type Section = 'inventory' | 'procurement';
type Values = Record<string, string>;
type Errors = Record<string, string>;

const TABS = ['Overview', 'Current Status', 'Inventory Information', 'Stock Control', 'Replenishment', 'Procurement Information', 'Movements', 'Criticality Analysis', 'Technical Data'] as const;
type Tab = (typeof TABS)[number];

const STOCK_FIELDS=[
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
const STOCK_FIELD_LOOKUP=new Map<string,string>(STOCK_FIELDS);
const INVENTORY_FIELDS = ['minimumLevel', 'maximumLevel', 'safetyStock', 'reorderPoint', 'reorderQuantity', 'leadTimeDays', 'remarks'];
// Strategy parameters (Replenishment tab). Which of them are shown depends on the replenishment strategy.
const REPLENISHMENT_FIELDS = ['annualDemand', 'orderCost', 'holdingCostRate', 'demandLookbackDays', 'coverageDays', 'emergencyLevel', 'strategicLevel', 'seasonalFactors', 'rotablesInRepair', 'binQuantity', 'kanbanCardQuantity', 'kanbanCards', 'reviewPeriodDays', 'forecastMonthlyDemand'];
const REPLENISHMENT_LIMITS: Record<string, { min: number; max: number; integer?: boolean }> = {
    holdingCostRate: { min: 0, max: 1000 }, demandLookbackDays: { min: 7, max: 730, integer: true }, coverageDays: { min: 0, max: 3650, integer: true },
    kanbanCards: { min: 1, max: 1000, integer: true }, reviewPeriodDays: { min: 1, max: 365, integer: true },
};
const CLASSIC_LEVELS = ['minimumLevel', 'maximumLevel', 'reorderPoint', 'reorderQuantity', 'safetyStock'];
/** Parameters of the material's strategy that live on the Replenishment tab. */
function replenishmentFieldsOf(inventory: Record<string, unknown> | undefined): string[] {
    const m = METHODS[methodOf(inventory?.replenishmentStrategy)];
    // Only an automated strategy (RP01-RP04, RP06) uses parameters; the others are recorded in Stock Control only.
    return m?.automated ? [...m.required, ...m.optional].filter((k) => REPLENISHMENT_FIELDS.includes(k)) : [];
}
const AUTOMATED_TEXT = AUTOMATED_METHODS.map((c) => `${c} ${METHODS[c].name}`).join(', ');
const PROCUREMENT_FIELDS = ['incoterms', 'preferredVendor', 'vendorPartNumber', 'purchaseUom', 'minimumOrderQuantity', 'orderMultiple', 'unitPrice', 'priceCurrency', 'paymentTerms'];
const NUMBER_FIELDS = new Set(['minimumLevel', 'maximumLevel', 'safetyStock', 'reorderPoint', 'reorderQuantity', 'leadTimeDays', 'minimumOrderQuantity', 'orderMultiple', 'unitPrice', ...REPLENISHMENT_FIELDS.filter((k) => k !== 'seasonalFactors')]);
const OPENING_KEYS = ['physicalStock', 'reservedStock', 'quarantinedStock', 'damagedStock', 'expiredStock', 'onOrder', 'onRequisition', 'inTransit', 'allocatedStock'];
const DELTA_KEYS = ['physicalStock', 'reservedStock', 'quarantinedStock', 'damagedStock', 'expiredStock', 'other', 'onOrder', 'onRequisition', 'inTransit', 'allocatedStock'];
const ISOLATION_REASONS = [
    { value: 'quarantinedStock', label: 'Quarantined' },
    { value: 'damagedStock', label: 'Damaged' },
    { value: 'expiredStock', label: 'Expired' },
    { value: 'other', label: 'Other' },
];
const IDENTITY_KEYS = ['createdBy', 'submittedBy', 'verifiedBy', 'numberAllocatedBy', 'pushedBy', 'disabledBy'];
const MAX_QUANTITY = 1e12;
const NUMBER_PATTERN = /^\d+(\.\d+)?$/;
const OPENING_PHRASE = 'POST OPENING STOCK';

const EXPLANATIONS: Record<string, string> = {
    stockingPolicy: 'Earlier stocking policy for this material and warehouse. Use Stock Control to select a codified replenishment strategy; it synchronizes this field.',
    stockOwnership: 'Default intended owner of this material at this warehouse. Actual owner must also be tracked on each balance/lot; this setting does not transfer title.',
    supplyArrangement: 'Approved supply and commercial arrangement. Consignment and VMI need a supplier agreement and separate ownership-aware transactions.',
    stockCustody: 'Expected physical custodian, independent of who owns or values the stock.',
    stockCondition: 'Default eligibility or disposition policy. Actual lot/block status must be recorded by controlled warehouse movements.',
    replenishmentStrategy: 'The strategy that plans this material in this warehouse; the Replenishment tab follows it. Only RP01 Min-Max, RP02 Reorder Point, RP03 Economic Order Quantity, RP04 Just-in-Time and RP06 MRP-controlled raise replenishment automatically (they need the stock ownership and supply arrangement). Every other strategy is recorded for planning only.',
    stockPurpose: 'Business purpose for reporting and consumption mapping; cannot replace individual GL posting rules.',
    stockAllocation: 'Default demand allocation reference for reservations, without increasing physical stock quantity.',
    financialProfile: 'Financial treatment subject to legal-entity accounting policy and actual recognition event.',
    valuationMethod: 'Approved legal-entity valuation basis. Changing this classification alone does not revalue inventory.',
    traceabilityControl: 'Default lot, serial, expiry or compliance evidence requirement; transactions enforce detailed traceability separately.',
    titleTransferTrigger: 'Contract event transferring legal title. Must agree with supplier agreement; does not itself post a financial entry.',
    specialStockProgram: 'Overlay such as rotables, bonded, emergency or consignment without changing basic ownership.',
    warehouseRestriction: 'Placement restriction from the shared warehouse restriction master. A bin can hold this material only when its storage location carries the same restriction. Not specified inherits the material master restriction.',
    stockPlanningControl: 'Planning and classification dimension supporting criticality, variability and demand.',
    ownershipSettlementTrigger: 'Contractual event for supplier settlement, which is distinct from stock movement and financial recognition.',
    minimumLevel: 'Minimum desired available stock quantity; falling below this level signals insufficient stock.',
    maximumLevel: 'Maximum planned stock quantity to limit excess inventory and working capital.',
    safetyStock: 'Buffer stock held to protect against demand variation or replenishment delays.',
    reorderPoint: 'Available stock threshold that triggers a replenishment recommendation.',
    reorderQuantity: 'Normal quantity to replenish when the reorder point is reached.',
    leadTimeDays: 'Expected calendar days between ordering and receipt of the material.',
    remarks: 'Additional warehouse-specific handling, stocking, or replenishment instructions.',
    ...Object.fromEntries(REPLENISHMENT_FIELDS.map((k) => [k, PARAMS[k as keyof typeof PARAMS].hint])),
    incoterms: 'International delivery rule defining buyer and seller responsibilities for transport, risk and costs.',
    preferredVendor: 'Chosen from approved suppliers whose scope covers this material’s category and subcategory (Procurement → Vendors).',
    vendorPartNumber: "Supplier's own part reference, which may differ from the internal material number.",
    purchaseUom: 'Unit used when ordering from suppliers. Select its category, then the unit; no subcategory is required.',
    minimumOrderQuantity: 'Smallest quantity the supplier accepts per purchase order.',
    orderMultiple: 'Quantity increment in which orders must be placed, such as multiples of 10.',
    unitPrice: 'Agreed price per purchase unit, in the recorded price currency.',
    priceCurrency: 'Currency in which the supplier price is recorded.',
    paymentTerms: 'Agreed payment conditions, for example net 30 days.',
};

const BALANCE_HELP: Record<string, string> = {
    availableStock: 'Available Stock = Physical Stock − Reserved − Quarantined − Damaged − Expired − Other.',
    physicalStock: 'Quantity physically held in the warehouse, including stock under restriction.',
    reservedStock: 'Stock committed to approved allocations or reservations.',
    onOrder: 'Quantity on open purchase orders that has not been received yet.',
    onRequisition: 'Quantity on purchase requisitions that are not yet ordered.',
    inTransit: 'Quantity shipped to this warehouse and not yet received.',
    allocatedStock: 'Physical stock allocated to demand but not yet issued.',
};

const label = (x: string) => (REPLENISHMENT_FIELDS.includes(x) ? PARAMS[x as keyof typeof PARAMS].label : x.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()));
const words = (s: string) => (s || '').replace(/_/g, ' ');
const blank = (v: unknown) => v === null || v === undefined || v === '';
const qty = (v: unknown) => Number(v || 0).toLocaleString();
const signed = (n: number) => `${n > 0 ? '+' : ''}${Number(n || 0).toLocaleString()}`;

// ---------------------------------------------------------------------------
// Validation (same rules as the server)
// ---------------------------------------------------------------------------

/** Number check for a settings or quantity field; '' is allowed (clears the value / counts as zero). */
function numberProblem(raw: string, wholeDaysMax?: number): string {
    const v = raw.trim();
    if (!v) return '';
    if (!NUMBER_PATTERN.test(v)) return 'Enter a number of 0 or more (digits and an optional decimal point).';
    const n = Number(v);
    if (n > MAX_QUANTITY) return 'This number is too large.';
    if (wholeDaysMax !== undefined && (!Number.isInteger(n) || n > wholeDaysMax)) return `Enter whole days from 0 to ${wholeDaysMax}.`;
    return '';
}

const numberOf = (raw: string | undefined) => (raw && raw.trim() && NUMBER_PATTERN.test(raw.trim()) ? Number(raw.trim()) : null);

/** Validates only the fields of the tab being edited (each tab saves its own fields). */
function validateSettings(section: Section, values: Values, fields: string[]): Errors {
    const errors: Errors = {};
    for (const key of fields) {
        const raw = values[key] ?? '';
        if (key === 'seasonalFactors') {
            if (raw.trim() && !factorsOf(raw)) errors[key] = 'Enter 12 comma-separated factors from 0 to 10 (January to December).';
        } else if (NUMBER_FIELDS.has(key)) {
            const problem = numberProblem(raw, key === 'leadTimeDays' ? 3650 : undefined);
            const limit = REPLENISHMENT_LIMITS[key];
            const n = Number(raw.trim());
            if (problem) errors[key] = problem;
            else if (limit && raw.trim() && (n < limit.min || n > limit.max || (limit.integer && !Number.isInteger(n)))) errors[key] = `Enter ${limit.integer ? 'a whole number' : 'a number'} from ${limit.min} to ${limit.max}.`;
        } else {
            const max = key === 'remarks' ? 1000 : 120;
            if (raw.trim().length > max) errors[key] = `Use at most ${max} characters.`;
        }
    }
    if (section === 'inventory' && fields.includes('maximumLevel')) {
        const max = errors.maximumLevel ? null : numberOf(values.maximumLevel);
        if (max !== null) {
            const min = numberOf(values.minimumLevel);
            const safety = numberOf(values.safetyStock);
            const reorder = numberOf(values.reorderPoint);
            if (!errors.minimumLevel && min !== null && min > max) errors.minimumLevel = 'Minimum level cannot be above the maximum level.';
            if (!errors.safetyStock && safety !== null && safety > max) errors.safetyStock = 'Safety stock cannot be above the maximum level.';
            if (!errors.reorderPoint && reorder !== null && reorder > max) errors.reorderPoint = 'Reorder point cannot be above the maximum level.';
        }
    }
    return errors;
}

/** Values sent to /material/update: numbers as numbers, empty fields as '' (cleared). Never includes binLocation. */
/** Only the fields of the tab being edited are sent, so saving one tab never clears another tab's values. */
function settingsPayload(values: Values, fields: string[]): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    for (const key of fields) {
        const raw = (values[key] ?? '').trim();
        out[key] = NUMBER_FIELDS.has(key) && raw ? Number(raw) : raw;
    }
    return out;
}

function validateOpening(values: Values, reason: string): Errors {
    const errors: Errors = {};
    for (const key of OPENING_KEYS) {
        const problem = numberProblem(values[key] ?? '');
        if (problem) errors[key] = problem;
    }
    const n = (key: string) => numberOf(values[key]) ?? 0;
    if (!errors.physicalStock && n('reservedStock') + n('quarantinedStock') + n('damagedStock') + n('expiredStock') > n('physicalStock')) {
        errors.physicalStock = 'Reserved, quarantined, damaged and expired together cannot exceed physical stock.';
    }
    if (!errors.allocatedStock && n('allocatedStock') > n('physicalStock')) errors.allocatedStock = 'Allocated stock cannot exceed physical stock.';
    if (reason.trim().length < 8) errors.reason = 'Give the count reference or explanation (at least 8 characters).';
    return errors;
}

/** Stock Control rules the server applies too: an automated strategy needs the ownership and the supply arrangement. */
function stockControlErrors(values: Values): Errors {
    const errors: Errors = {};
    const m = METHODS[methodOf(values.replenishmentStrategy)];
    if (!m?.automated) return errors;
    const what = `${m.code} ${m.name} is planned automatically`;
    if (!values.stockOwnership) errors.stockOwnership = `${what}: choose who owns the stock.`;
    if (!values.supplyArrangement) errors.supplyArrangement = `${what}: choose the supply arrangement.`;
    if (values.stockOwnership && values.supplyArrangement) {
        const route = routeFor(values.stockOwnership, values.supplyArrangement, m.code);
        if (route.kind === 'blocked') errors.replenishmentStrategy = route.reason;
    }
    return errors;
}

const problemList = (errors: Errors) => Object.entries(errors).map(([key, message]) => `${key === 'reason' ? 'Reference' : label(key)}: ${message}`);

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** Short list of what blocks the primary action, shown next to it. */
function Problems({ items }: { items: string[] }) {
    if (!items.length) return null;
    return (
        <div role='status' className='rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300'>
            <p className='font-medium'>Fix before continuing:</p>
            <ul className='mt-1 list-disc space-y-0.5 pl-5'>
                {items.map((x) => (
                    <li key={x}>{x}</li>
                ))}
            </ul>
        </div>
    );
}

/** Label with tap-to-open help; the help wraps onto its own line when opened. */
function HelpLabel({ text, help, className = 'text-xs text-muted' }: { text: string; help?: string; className?: string }) {
    return (
        <div className='flex flex-wrap items-center gap-x-1'>
            <span className={className}>{text}</span>
            {help && <InfoTip label={text}>{help}</InfoTip>}
        </div>
    );
}

/** One figure in a stock or overview grid. */
function Stat({ name, value, help, emphasis }: { name: string; value: string; help?: string; emphasis?: boolean }) {
    return (
        <div className='min-w-0 rounded-xl border border-line bg-page p-3'>
            <HelpLabel text={name} help={help} />
            <strong className={`mt-1 block break-words font-semibold tabular-nums text-ink ${emphasis ? 'text-2xl' : 'text-lg'}`}>{value}</strong>
        </div>
    );
}

/** Bottom sheet (phone) / dialog (desktop); its primary action sits in the header so it is always reachable. */
function Sheet({ title, onClose, action, children }: { title: string; onClose: () => void; action?: ReactNode; children: ReactNode }) {
    return (
        <div className='fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4' role='presentation'>
            <button type='button' aria-label='Close' className='absolute inset-0 bg-black/60' onClick={onClose} />
            <div role='dialog' aria-modal='true' aria-label={title} className='relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-panel sm:max-w-lg sm:rounded-2xl'>
                <div className='flex items-center gap-2 border-b border-line p-3'>
                    <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-page'>
                        <X className='h-5 w-5' />
                    </button>
                    <h2 className='min-w-0 flex-1 truncate text-base font-semibold text-ink'>{title}</h2>
                    {action}
                </div>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>{children}</div>
            </div>
        </div>
    );
}

/** Readable rendering of a material master value (names for people, structure nodes, units and catalogue codes). */
function humanValue(key: string, v: unknown, data: Detail, metadata: Metadata | null): ReactNode {
    if (blank(v)) return '—';
    if (Array.isArray(v)) {
        return (
            <div className='space-y-1'>
                {v.map((x, i) => (
                    <div key={i} className='rounded bg-page px-2 py-1'>
                        {humanValue(key, x, data, metadata)}
                    </div>
                ))}
            </div>
        );
    }
    if (typeof v === 'object') {
        return (
            <div className='space-y-1'>
                {Object.entries(v as Record<string, unknown>).map(([k, x]) => (
                    <div key={k} className='flex flex-wrap gap-2'>
                        <span className='text-muted'>{label(k)}:</span>
                        <span>{humanValue(k, x, data, metadata)}</span>
                    </div>
                ))}
            </div>
        );
    }
    const value = String(v);
    if (IDENTITY_KEYS.includes(key)) return data.identities[value] || value;
    if (/(?:asset|assembly|costCenter)Id$/i.test(key)) return data.structureNames[value] || value;
    if (key === 'uom' || key === 'purchaseUom') return metadata?.uoms.find((x) => x.code === value)?.description || value;
    return data.catalogNames[value] || data.identities[value] || value;
}

function annualUsage(movements: Movement[] = []): string {
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const used = movements.filter((m) => m.status === 'posted' && m.reconciled && new Date(m.postedAt).getTime() >= cutoff && /ISSUE|CONSUMPTION|USAGE/i.test(m.type));
    if (!used.length) return 'Not available';
    return used.reduce((sum, m) => sum + Math.abs(Number(m.balancesDelta.physicalStock || m.balancesDelta.quantity || 0)), 0).toLocaleString();
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const numOrNull = (v: unknown) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));

/** Label of a Stock Control value (code and name from the stock masters). */
function stockLabel(metadata: Metadata | null, field: string, code: unknown): string {
    if (blank(code)) return '';
    const dim = metadata?.stockDimensions?.find((d) => d.key === STOCK_FIELD_LOOKUP.get(field));
    const item = dim?.items.find((x) => x.code === String(code));
    return item ? `${item.code} ${item.label}` : String(code);
}

/** Everything the overview shows, derived from the detail record. */
function overviewFacts(data: Detail, base: string, metadata: Metadata | null) {
    const inv = data.inventory;
    const proc = data.procurement;
    const price = numOrNull(proc.unitPrice);
    const code = methodOf(inv.replenishmentStrategy);
    const m = METHODS[code];
    const restriction = data.binDiagnostics?.classification || '';
    const facts: Array<{ label: string; value: string; mono?: boolean; hint?: string }> = [
        { label: 'Physical location', value: data.binDiagnostics?.linkedBin || 'Not allocated', mono: !!data.binDiagnostics?.linkedBin },
        { label: 'Unit cost', value: price === null ? 'Not set' : `${String(proc.priceCurrency || base)} ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
        { label: 'Annual usage', value: annualUsage(data.materialMovements) },
        { label: 'Lead time', value: blank(inv.leadTimeDays) ? 'Not set' : `${inv.leadTimeDays} day${Number(inv.leadTimeDays) === 1 ? '' : 's'}` },
        { label: 'Preferred supplier', value: String(proc.preferredVendorName || proc.preferredVendor || 'Not set') },
        { label: 'Replenishment', value: m ? `${m.code} ${m.name}` : 'Not set in Stock Control', hint: m ? (m.automated ? 'Planned automatically' : 'Recorded only, not automated') : undefined },
        { label: 'Warehouse restriction', value: restriction ? `${restriction} ${data.binDiagnostics?.restrictionLabel || ''}`.trim() : 'Not set', hint: data.binDiagnostics?.restrictionSource === 'material-master' ? 'From the material master' : undefined },
    ];
    const chips: Array<{ label: string; tone: 'brand' | 'muted' | 'warn' | 'danger' }> = [];
    if (m) chips.push({ label: `${m.code} ${m.name}${m.automated ? ' · auto' : ''}`, tone: m.automated ? 'brand' : 'muted' });
    else chips.push({ label: 'No replenishment strategy', tone: 'warn' });
    if (inv.stockOwnership) chips.push({ label: stockLabel(metadata, 'stockOwnership', inv.stockOwnership), tone: 'muted' });
    if (restriction) chips.push({ label: restriction, tone: 'muted' });
    const category = [data.catalogNames[String(data.material.categoryCode || '')], data.catalogNames[String(data.material.subcategoryCode || '')]].filter(Boolean).join(' › ');
    return { facts, chips, category };
}

function StockPosition({ data, onIsolate }: { data: Detail; onIsolate: (reason: string) => void }) {
    const status = data.currentStatus;
    const known = !!status?.reconciled;
    const balance = (key: string) => (known ? qty(status?.balances[key]) : '—');
    const available = Number(status?.balances.availableStock || 0);
    const { minimumLevel: min, maximumLevel: max } = data.inventory;
    const target = !known
        ? 'Not reconciled'
        : !blank(min) && available < Number(min)
          ? 'Below minimum'
          : !blank(max) && available > Number(max)
            ? 'Above maximum'
            : !blank(min) || !blank(max)
              ? 'Within target'
              : 'No min/max set';
    const targetTone = target === 'Below minimum' ? 'text-red-300' : target === 'Above maximum' ? 'text-amber-300' : 'text-soft';
    const pending = (status?.isolationRequests || []).filter((x) => x.status === 'pending_approval');

    return (
        <Card className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <h2 className='text-sm font-semibold text-ink'>Stock position</h2>
                <Badge tone={known ? 'brand' : 'warn'}>{known ? `Reconciled · ${status?.entryCount ?? 0} entries` : 'Opening pending'}</Badge>
            </div>
            {!known && <Alert tone='warn'>Reconciliation pending: {status?.reason || 'Material journal not available.'} No stock quantity is assumed to be zero.</Alert>}

            <div className='rounded-xl border border-brand/40 bg-brand/10 p-4 text-center'>
                <div className='flex justify-center'>
                    <HelpLabel text='Available stock' help={BALANCE_HELP.availableStock} className='text-sm font-semibold text-brandsoft' />
                </div>
                <p className='text-3xl font-semibold tabular-nums text-ink'>{balance('availableStock')}</p>
                <p className={`mt-1 text-xs ${targetTone}`}>{target}</p>
            </div>

            <div className='grid grid-cols-2 gap-2'>
                <Stat name='Physical stock' value={balance('physicalStock')} help={BALANCE_HELP.physicalStock} />
                <Stat name='Reserved stock' value={balance('reservedStock')} help={BALANCE_HELP.reservedStock} />
            </div>

            <div>
                <HelpLabel
                    text='Restricted stock · tap to request isolation'
                    help='Isolating stock (quarantine, damaged, expired, other) needs approval. Until it is approved, actual stock does not change. Requires reconciled opening stock.'
                    className='text-sm font-medium text-soft'
                />
                <div className='mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4'>
                    {ISOLATION_REASONS.map((r) => {
                        const waiting = pending.filter((x) => x.reason === r.value).reduce((s, x) => s + x.quantity, 0);
                        return (
                            <button
                                key={r.value}
                                type='button'
                                disabled={!known || !data.canEdit}
                                onClick={() => onIsolate(r.value)}
                                className='min-h-[44px] min-w-0 rounded-xl border border-line bg-page p-3 text-left active:bg-panel disabled:opacity-60'
                            >
                                <span className='block text-xs text-muted'>{r.label}</span>
                                <strong className='block text-lg font-semibold tabular-nums text-ink'>{balance(r.value)}</strong>
                                {waiting > 0 && <span className='block text-xs text-amber-300'>Pending: {waiting.toLocaleString()}</span>}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div>
                <p className='text-sm font-medium text-soft'>Commitments</p>
                <div className='mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4'>
                    {(['onOrder', 'onRequisition', 'inTransit', 'allocatedStock'] as const).map((k) => (
                        <Stat key={k} name={label(k)} value={balance(k)} help={BALANCE_HELP[k]} />
                    ))}
                </div>
            </div>
        </Card>
    );
}

function BinPanel({
    data,
    binChoice,
    onChoose,
    onLink,
    onUnlink,
}: {
    data: Detail;
    binChoice: string;
    onChoose: (binId: string) => void;
    onLink: () => void;
    onUnlink: () => void;
}) {
    const diag = data.binDiagnostics;
    const linked = diag?.linkedBin || '';
    return (
        <Card className='space-y-3'>
            <HelpLabel
                text='Physical location'
                help='A bin must exist in this warehouse, carry the same warehouse restriction as the material and permit its subcategory, be enabled and not be reserved by another material. Bins change only by linking and delinking here; both are recorded with a snapshot.'
                className='text-sm font-semibold text-ink'
            />
            <p className='break-all font-mono text-lg font-semibold text-ink'>{linked || 'Not allocated'}</p>
            {data.canEdit && linked && (
                <Button variant='danger' onClick={onUnlink} className='w-full sm:w-auto'>
                    <Link2Off className='h-4 w-4' />
                    Delink from bin
                </Button>
            )}
            {data.canEdit && !linked && data.recommendedBins.length > 0 && (
                <div className='flex flex-col gap-2 sm:flex-row sm:items-end'>
                    <div className='min-w-0 flex-1'>
                        <SelectField id='material-bin' label='Available bin' value={binChoice} onChange={(e) => onChoose(e.target.value)}>
                            <option value=''>Choose an available bin</option>
                            {data.recommendedBins.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                    {b.batch ? ` · Batch ${b.batch}` : ''}
                                </option>
                            ))}
                        </SelectField>
                    </div>
                    <Button disabled={!binChoice} onClick={onLink}>
                        <Link2 className='h-4 w-4' />
                        Link bin
                    </Button>
                </div>
            )}
            {!linked && !data.recommendedBins.length && (
                <div className='rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300'>
                    <p className='font-medium'>No eligible bin found.</p>
                    <dl className='mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
                        <dt>Configured bins</dt>
                        <dd>{diag?.configured ?? 0}</dd>
                        <dt>Warehouse restriction</dt>
                        <dd>{diag?.classification ? `${diag.restrictionLabel || diag.classification} (${diag.classification})${diag.restrictionSource === 'material-master' ? ' · from material master' : ''}` : 'Not set — binning blocked'}</dd>
                        <dt>Bins with this restriction</dt>
                        <dd>{diag?.matchingClassification ?? 0}</dd>
                        <dt>Bins not aligned</dt>
                        <dd>{diag?.unalignedBins ?? 0}</dd>
                        <dt>Occupied bins</dt>
                        <dd>{diag?.occupied ?? 0}</dd>
                    </dl>
                    <p className='mt-2 text-xs'>
                        {diag?.classification
                            ? 'Binning needs a cluster whose storage location carries the same warehouse restriction and the material’s subcategory, with a free position. Align storage locations in Organization design → warehouse → Edit.'
                            : 'Set the warehouse restriction in Stock Control (or on the material master) first. Materials and storage locations use the same restriction master, and binning stays blocked until both match.'}
                    </p>
                </div>
            )}
        </Card>
    );
}

/** How replenishment treats this material in this warehouse. It follows Stock Control: strategy, ownership and supply arrangement. */
function ReplenishmentSummary({ data, metadata, onStockControl }: { data: Detail; metadata: Metadata | null; onStockControl: () => void }) {
    const inv = data.inventory as Record<string, unknown>;
    const proc = data.procurement as Record<string, unknown>;
    const code = methodOf(inv.replenishmentStrategy);
    const m = METHODS[code];
    const settings: Array<[string, string]> = [
        ['Replenishment strategy', m ? `${m.code} — ${m.name}` : 'Not specified'],
        ['Stock ownership', stockLabel(metadata, 'stockOwnership', inv.stockOwnership) || 'Not specified'],
        ['Supply arrangement', stockLabel(metadata, 'supplyArrangement', inv.supplyArrangement) || 'Not specified'],
        ['Stock planning control', stockLabel(metadata, 'stockPlanningControl', inv.stockPlanningControl) || 'Not specified'],
    ];
    const fromStockControl = (
        <div className='rounded-xl border border-line bg-page p-3'>
            <div className='flex items-center justify-between gap-2'>
                <p className='text-xs font-medium uppercase tracking-wide text-muted'>From Stock Control</p>
                {data.canEdit && (
                    <button type='button' onClick={onStockControl} className='min-h-[44px] px-2 text-sm font-medium text-brandsoft'>
                        Change
                    </button>
                )}
            </div>
            <dl className='divide-y divide-line'>
                {settings.map(([k, v]) => (
                    <div key={k} className='grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 py-2 text-sm'>
                        <dt className='text-muted'>{k}</dt>
                        <dd className={`min-w-0 break-words text-right font-medium ${v === 'Not specified' ? 'font-normal italic text-muted' : 'text-ink'}`}>{v}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
    if (!m)
        return (
            <Card className='space-y-3'>
                <Badge tone='warn'>Not planned</Badge>
                <p className='text-sm text-soft'>No replenishment strategy is set in Stock Control, so this material is not replenished automatically. Automatic replenishment runs for {AUTOMATED_TEXT}.</p>
                {fromStockControl}
            </Card>
        );
    const route = routeFor(String(inv.stockOwnership || ''), String(inv.supplyArrangement || ''), code);
    const has = (k: string) => {
        const v = k === 'seasonalFactors' ? inv[k] : inv[k] ?? proc[k];
        return k === 'seasonalFactors' ? !!factorsOf(v) : v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
    };
    const missing = m.required.filter((k) => !has(k));
    const levels = [...m.required, ...m.optional].filter((k) => CLASSIC_LEVELS.includes(k));
    return (
        <Card className='space-y-3'>
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={m.automated ? 'brand' : 'muted'}>{m.automated ? 'Planned automatically' : 'Recorded only'}</Badge>
                <span className='font-mono text-xs text-muted'>{m.code}</span>
                <span className='font-semibold text-ink'>{m.name}</span>
            </div>
            <p className='text-sm text-soft'>{m.explain}</p>
            {!m.automated && (
                <Alert tone='info'>
                    {m.code} {m.name} is recorded for planning, reporting and manual buying only; it never raises a replenishment request. Automatic replenishment runs for {AUTOMATED_TEXT}.
                </Alert>
            )}
            {m.automated && (
                <p className='rounded-xl bg-page p-3 text-sm text-ink'>
                    {route.kind === 'purchase' && <>Raises an <strong>unverified purchase requirement</strong> for a planner to verify; the planner's manager then approves under the chart of authority.{route.note ? ` ${route.note}` : ''}</>}
                    {route.kind === 'signal' && <>Raises a <strong>{route.label.toLowerCase()}</strong> signal, not a purchase: {route.action}</>}
                    {route.kind === 'blocked' && <span className='text-amber-300'>{route.reason}</span>}
                </p>
            )}
            {fromStockControl}
            {m.automated && levels.length > 0 && (
                <div className='space-y-1'>
                    <p className='text-xs text-muted'>Levels used (edit them in Inventory Information)</p>
                    <ul className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                        {levels.map((k) => (
                            <li key={k} className={`min-w-0 rounded-lg border px-3 py-2 text-xs ${m.required.includes(k) && !has(k) ? 'border-amber-500/60 text-amber-200' : 'border-line text-soft'}`}>
                                {PARAMS[k as keyof typeof PARAMS].label}
                                <strong className='block truncate text-sm text-ink'>{has(k) ? String(inv[k]) : m.required.includes(k) ? 'Required' : '—'}</strong>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {missing.length > 0 && m.automated && <Alert tone='warn'>Not planned until set: {missing.map((k) => PARAMS[k as keyof typeof PARAMS].label).join(', ')}.</Alert>}
            {m.code === 'RP03' && <p className='text-xs text-muted'>Economic order quantity also uses the unit price from Procurement Information.</p>}
        </Card>
    );
}

/** Read-only value of one settings field. */
function SettingValue({
    section,
    field,
    data,
    metadata,
    base,
    displayCurrency,
}: {
    section: Section;
    field: string;
    data: Detail;
    metadata: Metadata | null;
    base: string;
    displayCurrency: string;
}) {
    const raw = (section === 'procurement' ? data.procurement : data.inventory)[field];
    if (field === 'unitPrice') {
        if (blank(raw) || !Number.isFinite(Number(raw))) return <>—</>;
        const entered = String(data.procurement.priceCurrency || base);
        const rate = (code: string) => data.currency.alternatives.find((x) => x.code === code)?.rate;
        const convert = (amount: number, from: string, to: string) => {
            if (from === to) return amount;
            const source = rate(from);
            const target = rate(to);
            return source && target ? (amount / source) * target : null;
        };
        const shown = convert(Number(raw), entered, displayCurrency || base);
        const local = convert(Number(raw), entered, base);
        return (
            <>
                {shown === null ? 'Rate unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: displayCurrency || base || 'USD' }).format(shown)}
                <span className='mt-1 block text-xs font-normal text-amber-300'>
                    Entered: {entered} {Number(raw).toLocaleString()} · Local: {base} {local === null ? 'Rate unavailable' : local.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
            </>
        );
    }
    if (blank(raw)) return <>{STOCK_FIELD_LOOKUP.has(field) ? 'Not specified' : '—'}</>;
    if (field === 'preferredVendor') {
        const chosen = data.supplierOptions?.find((v) => v.id === String(raw));
        if (chosen) return <>{chosen.number} · {chosen.name}</>;
        if (data.procurement.preferredVendorName) return <>{String(data.procurement.preferredVendorName)}<span className='mt-1 block text-xs font-normal text-amber-300'>No longer an approved supplier of this category.</span></>;
        return <>{String(raw)}<span className='mt-1 block text-xs font-normal text-amber-300'>Typed earlier, not from the supplier list. Edit to choose an approved supplier.</span></>;
    }
    const value = String(raw);
    if (STOCK_FIELD_LOOKUP.has(field)){
        const dim=metadata?.stockDimensions?.find(d=>d.key===STOCK_FIELD_LOOKUP.get(field));
        const selected=dim?.items.find(x=>x.code===value);
        return <>{selected?selected.label+' ('+value+')':value}</>;
    }
    if (field === 'stockingPolicy') return <>{metadata?.stockingPolicies.find((x) => x.code === value)?.description || value}</>;
    if (field === 'paymentTerms') return <>{metadata?.paymentTerms.find((x) => x.code === value)?.description || value}</>;
    if (field === 'incoterms') return <>{metadata?.incoterms.find((x) => x.code === value)?.description || value}</>;
    if (field === 'purchaseUom') return <>{metadata?.uoms.find((x) => x.code === value)?.name || value}</>;
    return <>{value}</>;
}

/** Edit control for one settings field, with its explanation as hint and the validation message as error. */
function SettingInput({
    field,
    values,
    errors,
    metadata,
    currencies,
    uomCategory,
    onUomCategory,
    onChange,
    suppliers,
    supplierScope,
}: {
    field: string;
    values: Values;
    errors: Errors;
    metadata: Metadata | null;
    currencies: string[];
    uomCategory: string;
    onUomCategory: (code: string) => void;
    onChange: (field: string, value: string) => void;
    suppliers: SupplierOption[];
    supplierScope: string;
}) {
    const id = `material-${field}`;
    const value = values[field] ?? '';
    const hint = EXPLANATIONS[field];
    const error = errors[field];

    if(STOCK_FIELD_LOOKUP.has(field)){
        const list=metadata?.stockDimensions?.find(x=>x.key===STOCK_FIELD_LOOKUP.get(field));
        const active=list?.items.filter(x=>x.enabled)||[];
        return <SelectField id={id} label={label(field)} value={value} hint={hint} error={error} onChange={e=>onChange(field,e.target.value)}>
            <option value=''>Not specified (inherit default)</option>
            {value&&!active.some(x=>x.code===value)&&<option value={value}>{value} (not currently enabled)</option>}
            {active.map(item=><option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}
        </SelectField>;
    }
    if (field === 'preferredVendor') {
        const listed = suppliers.some((v) => v.id === value);
        return (
            <SelectField
                id={id}
                label='Preferred supplier'
                value={value}
                error={error}
                hint={suppliers.length ? `${suppliers.length} approved supplier${suppliers.length === 1 ? '' : 's'} for ${supplierScope}.` : `No approved supplier covers ${supplierScope}. Add this category to a vendor's scope in Procurement → Vendors.`}
                onChange={(e) => onChange(field, e.target.value)}
            >
                <option value=''>No preferred supplier</option>
                {value && !listed && <option value={value}>{value} (not in the supplier list)</option>}
                {suppliers.map((v) => (
                    <option key={v.id} value={v.id}>
                        {v.number} · {v.name}
                        {v.match === 'category' ? ' (whole category)' : ''}
                    </option>
                ))}
            </SelectField>
        );
    }
    if (field === 'purchaseUom') {
        const uoms = (metadata?.uoms || []).filter((x) => x.enabled);
        const categories = Array.from(new Map(uoms.map((x) => [x.categoryCode || x.categoryName, { code: x.categoryCode || x.categoryName, name: x.categoryName || x.categoryCode }])).values()).filter((x) => x.code);
        return (
            <div className='grid gap-2 sm:grid-cols-2'>
                <SelectField id={`${id}-category`} label='Purchase UoM category' value={uomCategory} onChange={(e) => onUomCategory(e.target.value)}>
                    <option value=''>Select category</option>
                    {categories.map((c) => (
                        <option key={c.code} value={c.code}>
                            {c.name}
                        </option>
                    ))}
                </SelectField>
                <SelectField id={id} label='Purchase UoM' value={value} hint={hint} error={error} onChange={(e) => onChange(field, e.target.value)}>
                    <option value=''>Select unit of measure</option>
                    {uoms
                        .filter((x) => (x.categoryCode || x.categoryName) === uomCategory)
                        .map((x) => (
                            <option key={x.code} value={x.code}>
                                {x.name}
                            </option>
                        ))}
                </SelectField>
            </div>
        );
    }

    if (field === 'incoterms' || field === 'stockingPolicy' || field === 'paymentTerms') {
        const list = (field === 'incoterms' ? metadata?.incoterms : field === 'stockingPolicy' ? metadata?.stockingPolicies : metadata?.paymentTerms) || [];
        const options = list.filter((x) => x.enabled !== false);
        return (
            <SelectField id={id} label={label(field)} value={value} hint={hint} error={error} onChange={(e) => onChange(field, e.target.value)}>
                <option value=''>Select {label(field).toLowerCase()}</option>
                {value && !options.some((x) => x.code === value) && <option value={value}>{value} (no longer listed)</option>}
                {options.map((x) => (
                    <option key={x.code} value={x.code}>
                        {x.code} — {x.description}
                    </option>
                ))}
            </SelectField>
        );
    }

    if (field === 'priceCurrency') {
        return (
            <SelectField id={id} label='Price currency' value={value} hint={hint} error={error} onChange={(e) => onChange(field, e.target.value)}>
                {value && !currencies.includes(value) && <option value={value}>{value}</option>}
                {currencies.map((c) => (
                    <option key={c} value={c}>
                        {c}
                        {c === currencies[0] ? ' (local)' : ''}
                    </option>
                ))}
            </SelectField>
        );
    }

    if (field === 'remarks') {
        return (
            <div>
                <TextArea id={id} label='Remarks' value={value} maxLength={1000} rows={4} onChange={(e) => onChange(field, e.target.value)} />
                <p className={`mt-1 text-xs ${error ? 'text-red-300' : 'text-muted'}`} role={error ? 'alert' : undefined}>
                    {error || `${hint} ${value.trim().length}/1000`}
                </p>
            </div>
        );
    }

    if (NUMBER_FIELDS.has(field)) {
        return (
            <Field
                id={id}
                label={field === 'leadTimeDays' ? 'Lead time (days)' : label(field)}
                value={value}
                inputMode={field === 'leadTimeDays' ? 'numeric' : 'decimal'}
                autoComplete='off'
                placeholder='Not set'
                hint={hint}
                error={error}
                onChange={(e) => onChange(field, e.target.value)}
            />
        );
    }

    return <Field id={id} label={label(field)} value={value} maxLength={120} autoComplete='off' hint={hint} error={error} onChange={(e) => onChange(field, e.target.value)} />;
}

function movementColumns(identities: Record<string, string>): Array<Column<Movement>> {
    return [
        { key: 'postedAt', label: 'Posted', type: 'date', value: (m) => m.postedAt, render: (m) => fmtDate(m.postedAt) },
        { key: 'type', label: 'Type', value: (m) => words(m.type) },
        { key: 'reference', label: 'Reference', value: (m) => m.reference || '—' },
        { key: 'status', label: 'Status', value: (m) => words(m.status) },
        { key: 'reconciled', label: 'Reconciled', value: (m) => (m.reconciled ? 'Yes' : 'No'), render: (m) => <Badge tone={m.reconciled ? 'brand' : 'warn'}>{m.reconciled ? 'Reconciled' : 'Pending'}</Badge> },
        { key: 'postedBy', label: 'Posted by', value: (m) => identities[m.postedBy] || m.postedBy || '—', hidden: true },
        ...DELTA_KEYS.map(
            (k): Column<Movement> => ({
                key: k,
                label: label(k),
                type: 'number',
                value: (m) => (Number.isFinite(Number(m.balancesDelta[k])) ? Number(m.balancesDelta[k]) : null),
                render: (m) => (blank(m.balancesDelta[k]) ? '—' : signed(Number(m.balancesDelta[k]))),
                hidden: k !== 'physicalStock' && k !== 'reservedStock',
            }),
        ),
    ];
}

function TechnicalData({ data, metadata }: { data: Detail; metadata: Metadata | null }) {
    const entries = Object.entries(data.material).filter(([k]) => !['approvalHistory', 'workflowTermination'].includes(k));
    return (
        <>
            <h2 className='text-sm font-semibold text-ink'>Original material master information</h2>
            <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                {entries.map(([k, v]) => (
                    <div key={k} className='min-w-0 rounded-xl border border-line bg-panel p-3'>
                        <div className='text-xs text-muted'>{label(k)}</div>
                        <div className={`mt-1 break-words text-ink ${v !== null && typeof v === 'object' ? 'text-xs' : 'text-sm'}`}>{humanValue(k, v, data, metadata)}</div>
                    </div>
                ))}
            </div>
            <Card className='space-y-2'>
                <h3 className='text-sm font-semibold text-ink'>Associated assets</h3>
                {data.associatedAssets.length ? (
                    <div className='flex flex-wrap gap-2'>
                        {data.associatedAssets.map((x) => (
                            <span key={x.id} className='rounded-lg border border-line bg-page px-3 py-2 text-sm text-ink'>
                                {x.name}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className='text-sm text-muted'>No associated assets recorded.</p>
                )}
            </Card>
        </>
    );
}

// ---------------------------------------------------------------------------
// Sheets: opening stock and isolation request
// ---------------------------------------------------------------------------

function OpeningStockSheet({ onClose, onPost }: { onClose: () => void; onPost: (values: Record<string, number>, reason: string) => void }) {
    const [values, setValues] = useState<Values>({});
    const [reason, setReason] = useState('');
    const errors = validateOpening(values, reason);
    const problems = problemList(errors);
    const submit = () => {
        if (problems.length) return;
        const quantities: Record<string, number> = {};
        for (const key of OPENING_KEYS) quantities[key] = numberOf(values[key]) ?? 0;
        onPost(quantities, reason.trim());
    };
    return (
        <Sheet
            title='First-time stock loading'
            onClose={onClose}
            action={
                <Button disabled={problems.length > 0} onClick={submit}>
                    <Send className='h-4 w-4' />
                    Post
                </Button>
            }
        >
            <Alert tone='warn'>One-time opening journal entry. Blank quantities count as zero. Verify the physical count and outstanding commitments before posting; it cannot be edited or posted again.</Alert>
            <Problems items={problems} />
            <div className='grid grid-cols-2 gap-3'>
                {OPENING_KEYS.map((k) => (
                    <Field
                        key={k}
                        id={`opening-${k}`}
                        label={label(k)}
                        value={values[k] ?? ''}
                        inputMode='decimal'
                        autoComplete='off'
                        placeholder='0'
                        error={errors[k]}
                        onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                    />
                ))}
            </div>
            <Field
                id='opening-reason'
                label='Count reference / reconciliation explanation *'
                value={reason}
                maxLength={500}
                placeholder='Count sheet, date and responsible person'
                error={reason ? errors.reason : undefined}
                hint='At least 8 characters. Stored as the journal reference.'
                onChange={(e) => setReason(e.target.value)}
            />
        </Sheet>
    );
}

interface IsolationPayload {
    reason: string;
    quantity: number;
    explanation: string;
    moveToBin: boolean;
    safetyAcknowledged: boolean;
    qualityAcknowledged: boolean;
}

function IsolationSheet({
    data,
    initialReason,
    onClose,
    onSubmit,
}: {
    data: Detail;
    initialReason: string;
    onClose: () => void;
    onSubmit: (payload: IsolationPayload) => Promise<void>;
}) {
    const [reason, setReason] = useState(initialReason);
    const [quantity, setQuantity] = useState('');
    const [explanation, setExplanation] = useState('');
    const [moveToBin, setMoveToBin] = useState(false);
    const [safety, setSafety] = useState(false);
    const [quality, setQuality] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const balances = data.currentStatus?.balances || {};
    const requests = data.currentStatus?.isolationRequests || [];
    const available = Number(balances.availableStock || 0);
    const pendingAll = requests.filter((x) => x.status === 'pending_approval').reduce((s, x) => s + x.quantity, 0);
    const limit = Math.max(0, available - pendingAll);
    const reasonLabel = ISOLATION_REASONS.find((r) => r.value === reason)?.label || label(reason);

    const errors: Errors = {};
    const q = numberOf(quantity);
    if (!quantity.trim() || q === null || q <= 0) errors.quantity = 'Enter a quantity greater than 0.';
    else if (q > limit) errors.quantity = `At most ${limit.toLocaleString()} (available after pending requests).`;
    if (explanation.trim().length < 10) errors.explanation = 'Explain the isolation in at least 10 characters.';
    if (moveToBin && (!safety || !quality)) errors.acknowledgements = 'Acknowledge both safety and quality controls for a bin transfer.';
    const problems = Object.values(errors);
    // Untouched required fields are marked * and keep Submit disabled; messages appear once the person starts typing.
    const shownProblems = [quantity.trim() ? errors.quantity : '', explanation ? errors.explanation : '', errors.acknowledgements].filter((x): x is string => !!x);

    const submit = async () => {
        if (problems.length || busy) return;
        setBusy(true);
        setError('');
        try {
            await onSubmit({ reason, quantity: Number(quantity.trim()), explanation: explanation.trim(), moveToBin, safetyAcknowledged: moveToBin && safety, qualityAcknowledged: moveToBin && quality });
        } catch (err) {
            setError(messageOf(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet
            title={`Isolate stock · ${reasonLabel}`}
            onClose={() => !busy && onClose()}
            action={
                <Button busy={busy} disabled={problems.length > 0} onClick={() => void submit()}>
                    <Send className='h-4 w-4' />
                    Submit
                </Button>
            }
        >
            <p className='text-sm text-soft'>
                Actual {reasonLabel.toLowerCase()}: {qty(balances[reason])} · Available: {available.toLocaleString()} · Pending requests: {pendingAll.toLocaleString()}. A request waits for approval and does not change actual stock.
            </p>
            {requests
                .filter((x) => x.reason === reason)
                .map((x) => (
                    <p key={x.id} className='text-xs text-amber-300'>
                        {words(x.status)} · {x.quantity.toLocaleString()} · {fmtDate(x.createdAt)}
                    </p>
                ))}
            {error && <Alert tone='error'>{error}</Alert>}
            <Problems items={shownProblems} />
            <SelectField id='isolation-reason' label='Reason *' value={reason} onChange={(e) => setReason(e.target.value)}>
                {ISOLATION_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                        {r.label}
                    </option>
                ))}
            </SelectField>
            <Field
                id='isolation-quantity'
                label='Quantity *'
                value={quantity}
                inputMode='decimal'
                autoComplete='off'
                error={quantity.trim() ? errors.quantity : undefined}
                hint={`Up to ${limit.toLocaleString()}`}
                onChange={(e) => setQuantity(e.target.value)}
            />
            <div>
                <TextArea id='isolation-explanation' label='Explanation *' value={explanation} rows={3} maxLength={1000} onChange={(e) => setExplanation(e.target.value)} />
                <p className={`mt-1 text-xs ${explanation && errors.explanation ? 'text-red-300' : 'text-muted'}`}>{explanation.trim().length}/10 characters minimum</p>
            </div>
            <label className='flex min-h-[44px] items-start gap-3 rounded-xl border border-line p-3 text-sm text-ink'>
                <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={moveToBin} onChange={(e) => setMoveToBin(e.target.checked)} />
                Move to a designated temporary physical location
            </label>
            {moveToBin && (
                <div className='space-y-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-300'>
                    <p>
                        Safety first: isolate this material in a clearly designated safe area for {reasonLabel.toLowerCase()} stock. Use a compatible classification-specific temporary cluster of at least five physical
                        locations. If no such cluster exists, warehouse configuration must be completed before any physical transfer. Approval alone must not bypass safety or quality checks.
                    </p>
                    <label className='flex min-h-[44px] items-start gap-3'>
                        <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={safety} onChange={(e) => setSafety(e.target.checked)} />I acknowledge the safety controls *
                    </label>
                    <label className='flex min-h-[44px] items-start gap-3'>
                        <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={quality} onChange={(e) => setQuality(e.target.checked)} />I acknowledge the quality controls *
                    </label>
                </div>
            )}
        </Sheet>
    );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function InventoryMaterialDetail({ id, warehouseId, onBack }: { id: string; warehouseId: string; onBack: () => void }) {
    const { data, loading, error, reload } = useLoad(() => callBackend<Detail>('/api/org/inventory/material/detail', { id, warehouseId }));
    const { data: metadata } = useLoad(() => callBackend<Metadata>('/api/org/inventory/material/metadata'));
    const { ask, sheet } = useConfirm();

    const [tab, setTab] = useState<Tab>(() => restoredTableTab<Tab>([...TABS], 'Overview'));
    const [editing, setEditing] = useState(false);
    const [values, setValues] = useState<Values>({});
    const [uomCategory, setUomCategory] = useState('');
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const [currency, setCurrency] = useState('');
    const [binChoice, setBinChoice] = useState('');
    const [opening, setOpening] = useState(false);
    const [isolation, setIsolation] = useState('');
    const [movement, setMovement] = useState<Movement | null>(null);

    const section: Section | null = (tab === 'Inventory Information' || tab === 'Stock Control' || tab === 'Replenishment') ? 'inventory' : tab === 'Procurement Information' ? 'procurement' : null;
    const fields = tab === 'Stock Control' ? STOCK_FIELDS.map(([field]) => field) : tab === 'Replenishment' ? replenishmentFieldsOf(data?.inventory) : section === 'procurement' ? PROCUREMENT_FIELDS : INVENTORY_FIELDS;
    const base = data?.currency.local || '';
    const currencies = useMemo(
        () => [base, ...(data?.currency.alternatives || []).filter((x) => x.code && x.rate > 0).map((x) => x.code)].filter((x, i, a) => x && a.indexOf(x) === i),
        [data, base],
    );
    const displayCurrency = currency || base;
    const journalColumns = useMemo(() => movementColumns(data?.identities || {}), [data]);
    const materialNumber = String(data?.material.materialNumber || id);
    const materialName = String(data?.material.shortText || data?.material.name || 'Material');

    const record = section === 'procurement' ? data?.procurement : data?.inventory;
    const suppliers = data?.supplierOptions || [];
    // Only the values that actually changed are sent: an unchanged older value can never block saving another one.
    const full = section && editing ? settingsPayload(values, fields) : {};
    const payload = Object.fromEntries(Object.entries(full).filter(([k, v]) => String(record?.[k] ?? '') !== String(v ?? '')));
    const dirty = !!section && editing && Object.keys(payload).length > 0;
    // Strategy, ownership and arrangement are checked together when one of them changes (as on the server);
    // otherwise an incomplete earlier profile is shown as a warning and does not block other changes.
    const controlErrors = editing && tab === 'Stock Control' ? stockControlErrors(values) : {};
    const controlChanged = ['replenishmentStrategy', 'stockOwnership', 'supplyArrangement'].some((k) => k in payload);
    const errors: Errors = section && editing ? { ...validateSettings(section, values, fields), ...(controlChanged ? controlErrors : {}) } : {};
    if (editing && section === 'procurement' && values.preferredVendor && values.preferredVendor !== String(record?.preferredVendor ?? '') && !suppliers.some((v) => v.id === values.preferredVendor))
        errors.preferredVendor = 'Choose an approved supplier from the list.';
    const problems = problemList(errors);
    const controlWarnings = controlChanged ? [] : Object.values(controlErrors);
    const noticeRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (notice) noticeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [notice]);
    const supplierScope = [data?.catalogNames[String(data?.material.categoryCode || '')] || String(data?.material.categoryCode || ''), data?.catalogNames[String(data?.material.subcategoryCode || '')] || String(data?.material.subcategoryCode || '')].filter(Boolean).join(' › ') || 'this material';

    const flash = (tone: 'success' | 'error', text: string) => setNotice({ tone, text });

    const changeTab = (next: Tab) => {
        setTab(next);
        setEditing(false);
        setNotice(null);
    };

    const startEdit = () => {
        if (!data || !section) return;
        const source = section === 'inventory' ? data.inventory : data.procurement;
        const next: Values = {};
        for (const k of fields) next[k] = blank(source[k]) ? '' : String(source[k]);
        if (section === 'procurement' && !next.priceCurrency) next.priceCurrency = base;
        setValues(next);
        const chosen = metadata?.uoms.find((x) => x.code === next.purchaseUom);
        setUomCategory(chosen?.categoryCode || chosen?.categoryName || '');
        setNotice(null);
        setEditing(true);
    };

    const save = async () => {
        if (!section || problems.length || !dirty) return;
        setSaving(true);
        setNotice(null);
        try {
            const res = await callBackend<{ ok: boolean; changed?: number }>('/api/org/inventory/material/update', { id, warehouseId, section, values: payload });
            setEditing(false);
            reload();
            const changed = Number(res?.changed || 0);
            flash('success', changed ? `Saved ${changed} change${changed === 1 ? '' : 's'}.` : 'Nothing changed.');
        } catch (err) {
            flash('error', messageOf(err));
        } finally {
            setSaving(false);
        }
    };

    const linkBin = () => {
        const bin = data?.recommendedBins.find((b) => b.id === binChoice);
        if (!bin) return;
        ask(
            {
                title: 'Link bin to material',
                message: (
                    <>
                        Link <strong className='text-ink'>{bin.name}</strong> to {materialNumber} in {data?.warehouse.name}? The bin is reserved for this material and the link is recorded in the bin history.
                    </>
                ),
                confirmLabel: 'Link bin',
            },
            async () => {
                await callBackend('/api/org/inventory/material/bin/link', { id, warehouseId, binId: bin.id });
                setBinChoice('');
                reload();
                flash('success', 'Physical location linked and reserved for this material.');
            },
        );
    };

    const unlinkBin = () =>
        ask(
            {
                title: 'Delink material from bin',
                message: (
                    <>
                        Delink {materialNumber} from <strong className='text-ink'>{data?.binDiagnostics?.linkedBin}</strong>? The bin becomes free for other materials. The event and a snapshot of the material are recorded.
                    </>
                ),
                confirmLabel: 'Delink',
                tone: 'danger',
                reason: { label: 'Reason for delinking', minLength: 5, placeholder: 'For example: bin re-assigned after re-layout' },
            },
            async (reason) => {
                await callBackend('/api/org/inventory/material/bin/unlink', { id, warehouseId, reason });
                reload();
                flash('success', 'Physical location delinked; audit snapshot recorded.');
            },
        );

    const postOpening = (quantities: Record<string, number>, reason: string) =>
        ask(
            {
                title: 'Post opening stock',
                message: (
                    <div className='space-y-2'>
                        <p>
                            This posts a permanent, reconciled opening entry to the material journal of {materialNumber} in {data?.warehouse.name}. It can be posted only once and cannot be edited or reversed.
                        </p>
                        <ul className='space-y-0.5 text-xs'>
                            {OPENING_KEYS.map((k) => (
                                <li key={k} className='flex justify-between gap-3'>
                                    <span>{label(k)}</span>
                                    <span className='tabular-nums text-ink'>{quantities[k].toLocaleString()}</span>
                                </li>
                            ))}
                        </ul>
                        <p className='text-xs'>Reference: {reason}</p>
                    </div>
                ),
                confirmLabel: 'Post opening stock',
                tone: 'danger',
                acknowledge: 'I have verified the physical count and outstanding commitments for this material and warehouse.',
                phrase: OPENING_PHRASE,
            },
            async () => {
                await callBackend('/api/org/inventory/material/opening-stock', { id, warehouseId, ...quantities, reason });
                setOpening(false);
                reload();
                flash('success', 'Opening stock posted to the material journal.');
            },
        );

    const requestIsolation = async (p: IsolationPayload) => {
        await callBackend('/api/org/inventory/material/isolation/request', { id, warehouseId, ...p });
        setIsolation('');
        reload();
        flash('success', 'Isolation request saved as pending approval; actual stock remains unchanged.');
    };

    const actions = (() => {
        if (!data) return undefined;
        if (section && data.canEdit && fields.length) {
            return editing ? (
                <>
                    <Button variant='secondary' disabled={saving} onClick={() => setEditing(false)}>
                        Cancel
                    </Button>
                    <Button busy={saving} disabled={problems.length > 0 || !dirty} onClick={() => void save()}>
                        <Save className='h-4 w-4' />
                        Save
                    </Button>
                </>
            ) : (
                <Button variant='secondary' onClick={startEdit}>
                    <Pencil className='h-4 w-4' />
                    Edit
                </Button>
            );
        }
        if (tab === 'Current Status' && data.currentStatus?.canInitialize) {
            return (
                <Button onClick={() => setOpening(true)} aria-label='First-time stock loading'>
                    <PackagePlus className='h-4 w-4' />
                    <span className='hidden sm:inline'>Opening stock</span>
                </Button>
            );
        }
        return undefined;
    })();

    return (
        <Screen
            title={data ? materialName : 'Material'}
            eyebrow={materialNumber}
            subtitle={data?.warehouse.name || warehouseId}
            onBack={onBack}
            actions={actions}
            toolbar={<Segmented<Tab> label='Material sections' value={tab} onChange={changeTab} options={TABS.map((t) => ({ value: t, label: t }))} />}
        >
            {loading && <Spinner />}
            {!loading && error && <Alert tone='error'>{error}</Alert>}
            {notice && (
                <div ref={noticeRef}>
                    <Alert tone={notice.tone}>{notice.text}</Alert>
                </div>
            )}

            {!loading && !error && data && (
                <>
                    {tab === 'Overview' &&
                        (() => {
                            const o = overviewFacts(data, base, metadata);
                            const status = data.currentStatus;
                            return (
                                <MaterialOverview
                                    id={id}
                                    warehouseId={warehouseId}
                                    warehouseName={data.warehouse.name}
                                    materialNumber={materialNumber}
                                    description={String(data.material.shortText || data.material.name || '—')}
                                    categoryLabel={o.category}
                                    status={String(data.material.status || '')}
                                    photos={data.photos || []}
                                    canPhoto={!!data.canPhoto}
                                    available={status?.reconciled ? Number(status.balances.availableStock || 0) : null}
                                    minimum={numOrNull(data.inventory.minimumLevel)}
                                    maximum={numOrNull(data.inventory.maximumLevel)}
                                    safety={numOrNull(data.inventory.safetyStock)}
                                    facts={o.facts}
                                    chips={o.chips}
                                    ask={ask}
                                    onOpen={changeTab}
                                />
                            );
                        })()}

                    {tab === 'Current Status' && (
                        <>
                            {data.currentStatus?.canInitialize && (
                                <Alert tone='info'>No journal entries yet. Use “Opening stock” at the top to post the first-time stock loading.</Alert>
                            )}
                            <StockPosition data={data} onIsolate={setIsolation} />
                        </>
                    )}

                    {section && (
                        <>
                            {tab === 'Inventory Information' && <BinPanel data={data} binChoice={binChoice} onChoose={setBinChoice} onLink={linkBin} onUnlink={unlinkBin} />}
                            {section === 'procurement' && !editing && currencies.length > 1 && (
                                <SelectField id='material-display-currency' label='Display currency' value={displayCurrency} onChange={(e) => setCurrency(e.target.value)}>
                                    {currencies.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                            {c === base ? ' (local)' : ''}
                                        </option>
                                    ))}
                                </SelectField>
                            )}
                            {tab === 'Stock Control' && (
                                <Alert tone='info'>
                                    The Replenishment tab follows the strategy chosen here, with the stock ownership and supply arrangement. Only {AUTOMATED_TEXT} replenish automatically. These settings do not change posted stock ownership or GL balances.
                                </Alert>
                            )}
                            {tab === 'Replenishment' && <ReplenishmentSummary data={data} metadata={metadata} onStockControl={() => changeTab('Stock Control')} />}
                            {editing ? (
                                <Card className='space-y-3'>
                                    <h2 className='text-sm font-semibold text-ink'>Edit {tab.toLowerCase()}</h2>
                                    <Problems items={problems} />
                                    {controlWarnings.length > 0 && <Alert tone='warn'>Automatic replenishment is not active yet: {controlWarnings.join(' ')}</Alert>}
                                    {!problems.length && !dirty && <p className='text-xs text-muted'>Change a value to enable Save.</p>}
                                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                                        {fields.map((k) => (
                                            <div key={k} className={`min-w-0 ${k === 'purchaseUom' || k === 'remarks' ? 'sm:col-span-2' : ''}`}>
                                                <SettingInput
                                                    field={k}
                                                    values={values}
                                                    errors={errors}
                                                    metadata={metadata}
                                                    currencies={currencies}
                                                    uomCategory={uomCategory}
                                                    onUomCategory={(code) => {
                                                        setUomCategory(code);
                                                        setValues((p) => ({ ...p, purchaseUom: '' }));
                                                    }}
                                                    onChange={(field, value) => setValues((p) => ({ ...p, [field]: value }))}
                                                    suppliers={suppliers}
                                                    supplierScope={supplierScope}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            ) : (
                                <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                                    {fields.map((k) => (
                                        <div key={k} className='min-w-0 rounded-xl border border-line bg-panel p-3'>
                                            <HelpLabel text={k === 'leadTimeDays' ? 'Lead time (days)' : label(k)} help={EXPLANATIONS[k]} />
                                            <strong className='mt-1 block break-words text-sm font-semibold text-ink'>
                                                <SettingValue section={section} field={k} data={data} metadata={metadata} base={base} displayCurrency={displayCurrency} />
                                            </strong>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {section === 'procurement' && (
                                <p className='text-xs text-muted'>
                                    Prices are stored in their entered currency. Display conversion is available only where an explicit configured rate exists; changing the display currency does not rewrite stored prices.
                                </p>
                            )}
                        </>
                    )}

                    {tab === 'Movements' && (
                        <>
                            <p className='text-xs text-muted'>Chronological transaction record for this material and warehouse. Posted, reconciled entries drive Current Status.</p>
                            <RichTable<Movement>
                                id='inv.material.movements'
                                tabKey='Movements'
                                title='Material journal'
                                columns={journalColumns}
                                rows={data.materialMovements || []}
                                rowKey={(m) => m.id}
                                onRowClick={setMovement}
                                empty='No journal entries yet. Post the first-time stock loading on Current Status.'
                                fileName={`material-journal-${materialNumber}`}
                                height='h-[calc(100dvh-20rem)]'
                            />
                        </>
                    )}

                    {tab === 'Criticality Analysis' && (
                        <Card className='space-y-2'>
                            <h2 className='text-sm font-semibold text-ink'>Criticality analysis</h2>
                            <p className='text-sm text-muted'>
                                Criticality assessment is not yet configured for this material. A future assessment will record operational impact, safety, lead time, redundancy and stockout risk.
                            </p>
                        </Card>
                    )}

                    {tab === 'Technical Data' && <TechnicalData data={data} metadata={metadata} />}

                    {opening && <OpeningStockSheet onClose={() => setOpening(false)} onPost={postOpening} />}
                    {isolation && <IsolationSheet data={data} initialReason={isolation} onClose={() => setIsolation('')} onSubmit={requestIsolation} />}
                    {movement && (
                        <Sheet title={`${words(movement.type)} · ${fmtDate(movement.postedAt)}`} onClose={() => setMovement(null)}>
                            <dl className='divide-y divide-line text-sm'>
                                {(
                                    [
                                        ['Reference', movement.reference || '—'],
                                        ['Status', words(movement.status)],
                                        ['Reconciled', movement.reconciled ? 'Yes' : 'No'],
                                        ['Posted by', data.identities[movement.postedBy] || movement.postedBy || '—'],
                                        ...Object.entries(movement.balancesDelta).map(([k, v]) => [label(k), signed(Number(v))]),
                                    ] as Array<[string, string]>
                                ).map(([k, v]) => (
                                    <div key={k} className='flex justify-between gap-3 py-2'>
                                        <dt className='text-muted'>{k}</dt>
                                        <dd className='min-w-0 break-words text-right text-ink'>{v}</dd>
                                    </div>
                                ))}
                            </dl>
                        </Sheet>
                    )}
                </>
            )}
            {sheet}
        </Screen>
    );
}
