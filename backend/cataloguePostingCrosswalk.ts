/**
 * Read-only crosswalk between descriptive, universal JSON-master transaction events
 * and operational MEMS posting events. Neither approving a JSON file nor assigning a
 * crosswalk entry creates a posting handler or authorises a Finance account.
 *
 * REVIEW_GAP is intentionally not mapped to a supposedly equivalent posting:
 * the missing financial scenario needs a real owner, test, and accounting design.
 */
export type MasterKind='materials'|'services'|'assets';
export type CrosswalkState='LIVE'|'CONDITIONAL'|'PLANNED'|'REVIEW_GAP';
export type CrosswalkAction='RETAIN'|'REASSIGN'|'ADD_HANDLER';
export interface CataloguePostingLink{
 kind:MasterKind;catalogueEvent:string;postingEvents:string[];
 state:CrosswalkState;action:CrosswalkAction;note:string;
}
const row=(kind:MasterKind,catalogueEvent:string,postingEvents:string[],state:CrosswalkState,action:CrosswalkAction,note:string):CataloguePostingLink=>
 ({kind,catalogueEvent,postingEvents,state,action,note});

export const CATALOGUE_POSTING_CROSSWALK:readonly CataloguePostingLink[]=[
 // MATERIALS — technical master stays the same regardless of the eventual cost beneficiary.
 row('materials','GOODS_RECEIPT',['GR_STOCK'],'LIVE','RETAIN','Dr inventory / Cr GRIR for owned stock; consignment requires its ownership policy.'),
 row('materials','NON_STOCK_PURCHASE',['GR_DIRECT'],'LIVE','RETAIN','Direct to a cost centre under an approved PO line GL; do not invent an inventory receipt.'),
 row('materials','STOCK_ISSUE',['GI_CC','GI_WO'],'CONDITIONAL','REASSIGN','GI_WO uses approved WO maintenanceTypeCode including MAI-006 breakdown, task and cost nature; GI_CC is the non-WO route.'),
 row('materials','GOODS_RECEIPT_INVOICE_CLEARING',['AP_INVOICE'],'PLANNED','ADD_HANDLER','Receipt creates GRIR today; invoice clearing requires the future AP posting handler.'),
 row('materials','CONSIGNMENT_OR_IN_TRANSIT',['TRF_OUT','TRF_IN'],'REVIEW_GAP','ADD_HANDLER','Warehouse transfer handlers are planned; supplier-owned consignment must not be recognised merely because stock moved.'),
 row('materials','INVENTORY_WRITE_DOWN',['INV_WRITEOFF'],'PLANNED','ADD_HANDLER','Permanent write-down versus stock-count adjustments need distinct approved accounting treatments.'),
 row('materials','INVENTORY_ALLOWANCE',[],'REVIEW_GAP','ADD_HANDLER','Inventory provisions/allowances are not equivalent to an actual stock write-off.'),
 row('materials','PURCHASE_PRICE_VARIANCE',[],'REVIEW_GAP','ADD_HANDLER','Add a matched invoice/PO/receipt price-variance posting contract after AP matching is implemented.'),
 row('materials','SALES_DELIVERY',['SAL_COGS'],'PLANNED','ADD_HANDLER','Cost-of-sales recognition for delivered stock awaits the sales fulfilment handler.'),
 row('materials','SALES_REVENUE',['AR_INVOICE'],'PLANNED','ADD_HANDLER','Sales revenue is recognised by a valid sales invoice, not by issuing inventory.'),
 row('materials','QUALIFIED_PPE_SPARE',['AST_CAPITALIZE'],'PLANNED','ADD_HANDLER','Capitalize only qualifying equipment/spares under approved asset policy; not default maintenance expense.'),
 row('materials','QUALIFIED_SPARE_CIP',['AST_CAPITALIZE'],'PLANNED','ADD_HANDLER','CIP charge and later capitalization need verified distinct financial events.'),
 row('materials','QUALIFIED_PROJECT_WIP',[],'REVIEW_GAP','ADD_HANDLER','Project WIP has its own cost object; do not substitute manufacturing consumption.'),
 // SERVICES — accepted services retain approved PO line GL, and only inherit WO analysis dimensions.
 row('services','SERVICE_ACCEPTANCE',['SVC_ACCEPT'],'LIVE','RETAIN','Dr approved PO line account / Cr GRIR; WO/task strategy recorded in journal trace when linked.'),
 row('services','FUNCTIONAL_SERVICE_EXPENSE',['SVC_ACCEPT'],'CONDITIONAL','REASSIGN','Expense only if service is not prepaid or capitalizable and line GL is approved.'),
 row('services','CUSTOMER_DIRECT_SERVICE_COST',['SVC_ACCEPT'],'CONDITIONAL','REASSIGN','Direct-cost nature depends on beneficiary and approved PO GL; do not use one universal expense account.'),
 row('services','SERVICE_ENTRY_INVOICE_CLEARING',['AP_INVOICE'],'PLANNED','ADD_HANDLER','Service acceptance is live; supplier invoice clears GRIR through future AP.'),
 row('services','SERVICE_PREPAYMENT',[],'REVIEW_GAP','ADD_HANDLER','Prepayment recognition and amortisation require period-aware event handlers.'),
 row('services','SERVICE_ACCRUAL',[],'REVIEW_GAP','ADD_HANDLER','Period-end accrued services need reversal/matching policies.'),
 row('services','QUALIFIED_PPE_CIP',['AST_CAPITALIZE'],'PLANNED','ADD_HANDLER','Only capitalizable service costs within an approved asset/project cost object.'),
 row('services','QUALIFIED_SOFTWARE_CIP',[],'REVIEW_GAP','ADD_HANDLER','Intangible software development/CIP requires a separately approved accounting policy.'),
 row('services','SERVICE_REVENUE',['AR_INVOICE'],'PLANNED','ADD_HANDLER','Billable service revenue needs the customer invoice handler.'),
 row('services','CONTRACT_COST_AMORTISATION',[],'REVIEW_GAP','ADD_HANDLER','Contract cost asset/expense allocation requires amortisation schedule.'),
 // ASSETS — GR_ASSET receives into asset clearing; actual capitalization is not yet a live posting.
 row('assets','ASSET_ACQUISITION',['GR_ASSET','AST_CAPITALIZE'],'CONDITIONAL','REASSIGN','Asset receipt clearing is live; fixed asset recognition/capitalization is planned.'),
 row('assets','ASSET_IMPAIRMENT',[],'REVIEW_GAP','ADD_HANDLER','Impairment requires valuation, recognition and reversal policy.'),
 row('assets','CAPITAL_GOODS_RECEIPT_CLEARING',['GR_ASSET'],'LIVE','RETAIN','Dr approved asset receipt clearing / Cr GRIR for physical receipt.'),
 row('assets','ASSET_DISPOSAL_CLEARING',['AST_DISPOSAL'],'PLANNED','ADD_HANDLER','Asset disposal/retirement postings await the asset subledger handler.'),
 row('assets','ASSET_DISPOSAL_GAIN',['AST_DISPOSAL'],'PLANNED','ADD_HANDLER','Gain must be computed from net book value and proceeds; no fixed GL without event.'),
 row('assets','ASSET_DISPOSAL_LOSS',['AST_DISPOSAL'],'PLANNED','ADD_HANDLER','Loss must be computed from net book value and proceeds.'),
 row('assets','ROU_DEPRECIATION',['DEPRECIATION'],'PLANNED','ADD_HANDLER','Lease/ROU policy and periods control the amortisation.'),
 row('assets','ASSET_CIP',['AST_CAPITALIZE'],'PLANNED','ADD_HANDLER','CIP accumulation and capitalization must be distinct from procurement receipt.'),
 row('assets','ACCUMULATED_DEPRECIATION',['DEPRECIATION'],'PLANNED','ADD_HANDLER','Depreciation credit to accumulated depreciation by asset class.'),
 row('assets','DEPRECIATION_EXPENSE',['DEPRECIATION'],'PLANNED','ADD_HANDLER','Depreciation expense requires a periodic asset-run handler.'),
 row('assets','LEASE_COMMENCEMENT',[],'REVIEW_GAP','ADD_HANDLER','Initial ROU recognition and lease liability setup are not live.'),
 row('assets','INVESTMENT_PROPERTY',[],'REVIEW_GAP','ADD_HANDLER','Cost/fair value and measurement transactions must follow tenant financial policy.'),
];
export function postingLink(kind:MasterKind,event:string):CataloguePostingLink|undefined{
 return CATALOGUE_POSTING_CROSSWALK.find(x=>x.kind===kind&&x.catalogueEvent===event);
}
