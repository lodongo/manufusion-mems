/**
 * Account-oriented configuration catalogue. GL master accounts define the destinations;
 * implemented posting events remain separate from descriptive transaction variants.
 * This creates a navigable candidate for EACH adopted posting GL account without
 * pretending that a catalogue row registers executable software.
 */
export interface GlVariantAccount{
 code:string;name:string;statement:'BS'|'PL';classCode:string;className:string;
 categoryCode:string;categoryName:string;groupCode:string;groupName:string;
 accountRole?:string;accountType?:string;
}
export interface GlTransactionVariant{
 id:string;code:string;name:string;classCode:string;className:string;
 categoryCode:string;categoryName:string;groupCode:string;groupName:string;
 scenario:string;event:string;role:string;accountCode:string;accountName:string;
 status:'configurable'|'template_only';reason:string;
}
type Pattern={re:RegExp;event:string;role:string;scenario:string};
const patterns:Pattern[]=[
 {re:/inventory|stock|raw material|finished good|work.in.progress|packing material|consumable stock|spare.part/i,event:'GR_STOCK',role:'INVENTORY',scenario:'Goods receipt into warehouse'},
 {re:/inventory|stock|raw material|finished good|work.in.progress|packing material|consumable stock|spare.part/i,event:'GI_CC',role:'INVENTORY',scenario:'Material issue from warehouse'},
 {re:/inventory|stock|raw material|finished good|work.in.progress|packing material|consumable stock|spare.part/i,event:'ST_ADJ',role:'INVENTORY',scenario:'Stock-count gain or loss'},
 {re:/consum|material usage|raw material expen|production suppl|factory suppl|manufacturing suppl/i,event:'GI_CC',role:'CONSUMPTION',scenario:'Consumption at cost center'},
 {re:/maint|repair|spare|work.order|engineering/i,event:'GI_WO',role:'MAINT_CONSUMPTION',scenario:'Maintenance work-order consumption'},
 {re:/gr.?ir|received not invoiced|accrued purchas|unbilled goods|goods receipt clearing/i,event:'GR_STOCK',role:'GRIR',scenario:'Receipt accrued against GR/IR'},
 {re:/asset clearing|capital work.in.progress|capital purchas|asset purchas/i,event:'GR_ASSET',role:'ASSET_CLEARING',scenario:'Asset receipt pending capitalization'},
 {re:/opening balanc|opening clearing/i,event:'STK_OPEN',role:'OPENING_BALANCE',scenario:'Opening inventory valuation'},
 {re:/stock difference|inventory variance|stock loss|stock gain|inventory shrink/i,event:'ST_ADJ',role:'STOCK_DIFF',scenario:'Inventory count variance'},
 {re:/reconciliation difference|recon variance/i,event:'INV_RECON',role:'RECON_DIFF',scenario:'Inventory reconciliation difference'},
 {re:/retained earning|accumulated profit/i,event:'YE_CLOSE',role:'RETAINED_EARNINGS',scenario:'Year-end closing transfer'},
];
const planned=[{re:/payroll|salar|wages|employee benefit/i,scenario:'Payroll allocation'},
 {re:/revenue|sales|turnover|service income/i,scenario:'Sales revenue posting'},
 {re:/depreciation|amortiz/i,scenario:'Depreciation or amortization'},
 {re:/tax|vat|withhold|excise/i,scenario:'Tax accounting'},
 {re:/cash|bank|payment|receivable|payable/i,scenario:'Treasury or settlement'},
 {re:/freight|logistic|transport/i,scenario:'Freight allocation'},
 {re:/energy|power|electricity|diesel|fuel|gas/i,scenario:'Energy / fuel allocation'},
 {re:/lease|rental/i,scenario:'Lease accounting'},
 {re:/intercompany|intra.group/i,scenario:'Intercompany posting'}];
export function buildGlTransactionVariants(accounts:ReadonlyArray<GlVariantAccount>):GlTransactionVariant[]{
 const result:GlTransactionVariant[]=[];
 for(const a of accounts){
  const text=[a.name,a.className,a.categoryName,a.groupName,a.accountRole||'',a.accountType||''].join(' ');
  const applicable=patterns.filter(p=>p.re.test(text) &&
    ((a.statement==='BS')===['INVENTORY','GRIR','ASSET_CLEARING','OPENING_BALANCE','RECON_DIFF','RETAINED_EARNINGS'].includes(p.role)));
  const entries=applicable.length?applicable:
    [{event:'',role:'',scenario:planned.find(p=>p.re.test(text))?.scenario||'General ledger journal allocation'}];
  for(const p of entries){
   const configurable=!!p.event;
   result.push({
    id:[a.code,p.event||'UNBOUND',p.role||'NONE'].join(':'),
    code:configurable?`${p.event}:${a.code}`:`GL:${a.code}`,
    name:`${p.scenario} — ${a.name}`,
    classCode:a.classCode,className:a.className,categoryCode:a.categoryCode,
    categoryName:a.categoryName,groupCode:a.groupCode,groupName:a.groupName,
    scenario:p.scenario,event:p.event,role:p.role,accountCode:a.code,accountName:a.name,
    status:configurable?'configurable':'template_only',
    reason:configurable?'Use the existing transaction handler after approved accounting-rule configuration. This catalogue row is not itself a posting handler.':'No verified automated transaction handler is linked to this account. It remains a configuration template.'
   });
  }
 }
 return result.sort((a,b)=>a.classCode.localeCompare(b.classCode)||a.categoryCode.localeCompare(b.categoryCode)
 ||a.accountCode.localeCompare(b.accountCode)||a.scenario.localeCompare(b.scenario));
}
