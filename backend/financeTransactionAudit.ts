/**
 * Audits predefined GL posting events against actual Finance handlers, installed
 * endpoints, codified transaction placeholders, four universal master event names
 * and maintenance strategy taxonomy.
 *
 * READ-ONLY: recommendations are never executed. A route's presence alone is
 * insufficient to certify its authorization, ledger write, or financial correctness.
 */
import {TXNS} from './finCore';
import {POSTING_EVENTS} from './finPostingCatalogue';
import {DETERMINATION_EVENTS} from './finAccountRules';
import {CATALOGUE_POSTING_CROSSWALK,type CrosswalkAction,type CrosswalkState} from './cataloguePostingCrosswalk';

export type PostingAuditAction='RETAIN'|'REASSIGN_REVIEW'|'ADD_HANDLER';
export interface PostingAuditRow{
 event:string;label:string;configuredState:'live'|'planned';handlerState:'live'|'planned'|'not_registered';
 installedRouteEvidence:boolean;registeredCodeCount:number;missingCodes:string[];
 determinationRegistered:boolean;codes:string[];via:string[];action:PostingAuditAction;finding:string;
}
export interface AuditCatalogueRow{
 code:string;state:string;routes:readonly string[];postings:readonly {event:string}[];
}
export interface AuditInstalledRoute{method:string;path:string}
export interface AuditReport{
 summary:{
  registeredPostingEvents:number;livePostingEvents:number;plannedPostingEvents:number;
  retain:number;reassignReview:number;addHandler:number;
  catalogueEventLinks:number;crosswalkLive:number;crosswalkConditional:number;crosswalkPlanned:number;crosswalkGaps:number;
  breakdownMaintenanceFound:boolean;retireRecommended:number;
 };
 postingRows:PostingAuditRow[];
 catalogueMappings:Array<{kind:string;catalogueEvent:string;postingEvents:string[];state:CrosswalkState;action:CrosswalkAction;note:string}>;
 maintenanceStrategies:Array<{code:string;label:string;workOrderPostingEvent:string;accountResolution:string;separateFinancialEvent:boolean}>;
 policyNotes:string[];
}
type Inputs={
 rows:readonly AuditCatalogueRow[];
 installedRoutes:readonly AuditInstalledRoute[];
 maintenanceTypes:readonly {code:string;label:string}[];
};
export function auditFinanceTransactions(input:Inputs):AuditReport {
 const known=new Map(input.rows.map(r=>[r.code,r]));
 const installed=new Set(input.installedRoutes.map(r=>r.method+' '+r.path));
 const fromCore=new Map(TXNS.map(r=>[r.code,r]));
 const fromDetermination=new Set<string>(DETERMINATION_EVENTS.map(r=>r.code));
 const seen=new Set<string>();
 const postingRows:PostingAuditRow[]=POSTING_EVENTS.map(e=>{
  const core=fromCore.get(e.event);
  const handlerState=core?(core.live?'live':'planned'):'not_registered';
  const missingCodes=e.codes.filter(c=>!known.has(c));
  const routeEvidence=(e.via??[]).some(p=>installed.has('POST '+p));
  const duplicate=seen.has(e.event);
  seen.add(e.event);
  let action:PostingAuditAction, finding:string;
  if(e.state==='live'){
   if(!core?.live||!routeEvidence||missingCodes.length||duplicate){
    action='REASSIGN_REVIEW';
    finding=[!core?.live?'No matching executable Finance TXNS contract':'',
     !routeEvidence?'No installed posting endpoint evidence':'',
     missingCodes.length?'Undefined predefined codes: '+missingCodes.join(', '):'',
     duplicate?'Duplicate posting event code':''].filter(Boolean).join('; ');
   }else{
    action='RETAIN';
    finding='Predefined live accounting event and Finance handler agree. Existing authentication, approvals, GL validation and ledger checks remain authoritative.';
   }
  }else if(core?.live){
   action='REASSIGN_REVIEW';finding='Finance core is live but posting catalogue still marks planned; reconcile and test before promoting.';
  }else{
   action='ADD_HANDLER';
   finding='Reserved design / placeholder. Do not mark live, auto-post or grant permissions until the transaction-owning module implements it.';
  }
  return {event:e.event,label:e.label,configuredState:e.state,handlerState,installedRouteEvidence:routeEvidence,
   registeredCodeCount:e.codes.length-missingCodes.length,missingCodes,determinationRegistered:fromDetermination.has(e.event),
   codes:[...e.codes],via:[...(e.via??[])],action,finding};
 });
 const present=new Map(input.maintenanceTypes.map(s=>[s.code,s.label]));
 const maintenanceStrategies=input.maintenanceTypes.map(t=>({
  code:t.code,label:t.label,workOrderPostingEvent:'GI_WO',
  accountResolution:t.code==='MAI-006'
   ?'Breakdown Maintenance: specific approved GI_WO/MAI-006 rule if configured; otherwise generic approved maintenance fallback, not an unapproved automatic corrective GL.'
   :'Approved GI_WO rule matched by exact strategy code and Stores cost nature; generic approved fallback otherwise.',
  separateFinancialEvent:false
 }));
 const total=(state:CrosswalkState)=>CATALOGUE_POSTING_CROSSWALK.filter(x=>x.state===state).length;
 const retain=postingRows.filter(x=>x.action==='RETAIN').length;
 const reassign=postingRows.filter(x=>x.action==='REASSIGN_REVIEW').length;
 const add=postingRows.filter(x=>x.action==='ADD_HANDLER').length;
 return {
  summary:{registeredPostingEvents:postingRows.length,livePostingEvents:postingRows.filter(x=>x.configuredState==='live').length,
   plannedPostingEvents:postingRows.filter(x=>x.configuredState==='planned').length,
   retain,reassignReview:reassign,addHandler:add,
   catalogueEventLinks:CATALOGUE_POSTING_CROSSWALK.length,
   crosswalkLive:total('LIVE'),crosswalkConditional:total('CONDITIONAL'),
   crosswalkPlanned:total('PLANNED'),crosswalkGaps:total('REVIEW_GAP'),
   breakdownMaintenanceFound:present.has('MAI-006'),retireRecommended:0},
  postingRows,
  catalogueMappings:CATALOGUE_POSTING_CROSSWALK.map(x=>({...x,postingEvents:[...x.postingEvents]})),
  maintenanceStrategies,
  policyNotes:[
   'Existing POSTING_EVENTS and GL account transaction defaults are preserved; this audit never renumbers or retires a transaction.',
   'A reserved transaction or a known route is not evidence of an executable ledger posting; use explicit handler checks and controlled QA.',
   'MNT MAI-006 Breakdown Maintenance is a separate analysis strategy from MAI-002 Corrective Maintenance and MAI-007 Emergency Maintenance. It shares GI_WO as an accounting event, never duplicates stock consumption.',
   'Approve only eligible mapping.save and gltxn.save requests using the existing Finance checker decision endpoint. Batch selection cannot approve journals, invoices, payments, chart changes or universal draft imports.',
   'Manual reassignment/retirement requires module-owner evidence, linked transaction references, Finance validation and approval. No built-in code is automatically removed.',
   'Descriptions in four universal masters do not directly activate operational posting events; the crosswalk carries verified runtime state and unmapped gaps explicitly.',
  ],
 };
}
