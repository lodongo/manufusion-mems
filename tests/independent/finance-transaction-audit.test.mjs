import test from 'node:test';
import assert from 'node:assert/strict';
import {POSTING_EVENTS} from '../../backend/finPostingCatalogue.ts';
import {auditFinanceTransactions} from '../../backend/financeTransactionAudit.ts';
import {CATALOGUE_POSTING_CROSSWALK,postingLink} from '../../backend/cataloguePostingCrosswalk.ts';
import {eligibleFinanceMappingApprovals,MAX_BULK_FINANCE_APPROVALS} from '../../src/org/financeBulkApproval.ts';

const mock=()=>{
 const allCodes=[...new Set(POSTING_EVENTS.flatMap(e=>e.codes))];
 return {
  rows:allCodes.map(code=>({code,state:'reserved',routes:[],postings:[]})),
  installedRoutes:[...new Set(POSTING_EVENTS.filter(e=>e.state==='live').flatMap(e=>e.via||[]))]
   .map(path=>({method:'POST',path})),
  maintenanceTypes:[{code:'MAI-001',label:'Preventive Maintenance'},{code:'MAI-002',label:'Corrective Maintenance'},
   {code:'MAI-006',label:'Breakdown Maintenance'},{code:'MAI-007',label:'Emergency Maintenance'}],
 };
};
test('All predefined posting events have individually auditable handler status and permanent codes',()=>{
 const report=auditFinanceTransactions(mock());
 assert.equal(report.summary.registeredPostingEvents,POSTING_EVENTS.length);
 assert.equal(report.summary.livePostingEvents,POSTING_EVENTS.filter(x=>x.state==='live').length);
 assert.equal(report.summary.plannedPostingEvents,POSTING_EVENTS.filter(x=>x.state==='planned').length);
 assert.equal(report.summary.reassignReview,0);
 assert.equal(report.summary.retain,report.summary.livePostingEvents);
 assert.equal(report.summary.addHandler,report.summary.plannedPostingEvents);
 assert.equal(report.summary.retireRecommended,0);
 assert.ok(report.postingRows.every(x=>x.registeredCodeCount===x.codes.length));
});
test('Breakdown MAI-006 is distinct from corrective MAI-002 and emergency MAI-007 but uses GI_WO',()=>{
 const report=auditFinanceTransactions(mock());
 assert.equal(report.summary.breakdownMaintenanceFound,true);
 const codes=report.maintenanceStrategies.map(x=>x.code);
 assert.ok(['MAI-002','MAI-006','MAI-007'].every(x=>codes.includes(x)));
 const breakdown=report.maintenanceStrategies.find(x=>x.code==='MAI-006');
 assert.equal(breakdown?.workOrderPostingEvent,'GI_WO');
 assert.equal(breakdown?.separateFinancialEvent,false);
 assert.match(breakdown?.accountResolution||'',/MAI-006/);
 assert.ok(report.postingRows.some(x=>x.event==='GI_WO'&&x.action==='RETAIN'));
});
test('Missing installed routes, invalid predefined codes and event mismatch are review items, not auto-activated',()=>{
 const fixture=mock();
 fixture.installedRoutes=fixture.installedRoutes.filter(x=>x.path!=='/api/org/inv/issue/post');
 fixture.rows=fixture.rows.filter(x=>x.code!=='INV-GIS-PS');
 const report=auditFinanceTransactions(fixture);
 const wo=report.postingRows.find(x=>x.event==='GI_WO');
 assert.equal(wo?.action,'REASSIGN_REVIEW');
 assert.ok(wo?.missingCodes.includes('INV-GIS-PS'));
 assert.equal(wo?.installedRouteEvidence,true,'Second WO-specific route still exists');
 const cc=report.postingRows.find(x=>x.event==='GI_CC');
 assert.equal(cc?.installedRouteEvidence,false);
 assert.equal(cc?.action,'REASSIGN_REVIEW');
 assert.ok(report.postingRows.find(x=>x.event==='AP_PAYMENT')?.action==='ADD_HANDLER');
});
test('Every descriptive master event has one registered crosswalk, and gaps never invent posting events',()=>{
 const keys=CATALOGUE_POSTING_CROSSWALK.map(x=>x.kind+'|'+x.catalogueEvent);
 assert.equal(keys.length,new Set(keys).size);
 assert.ok(CATALOGUE_POSTING_CROSSWALK.length>=35);
 const defined=new Set(POSTING_EVENTS.map(x=>x.event));
 for(const row of CATALOGUE_POSTING_CROSSWALK){
  assert.deepEqual(postingLink(row.kind,row.catalogueEvent),row);
  assert.ok(row.postingEvents.every(event=>defined.has(event)),row.kind+'/'+row.catalogueEvent);
  if(row.state==='REVIEW_GAP'&&row.postingEvents.length===0)
   assert.equal(row.action,'ADD_HANDLER');
 }
 assert.deepEqual(postingLink('materials','STOCK_ISSUE')?.postingEvents,['GI_CC','GI_WO']);
 assert.equal(postingLink('services','SERVICE_ACCEPTANCE')?.state,'LIVE');
 assert.equal(postingLink('assets','ASSET_IMPAIRMENT')?.state,'REVIEW_GAP');
});
test('One-click finance approval admits only separate-checker GL mapping configuration requests',()=>{
 const req=(id,type,extras={})=>({id,leId:'LE-'+id,type,status:'pending',canDecide:true,mine:false,amount:null,...extras});
 const fixture=[
  req('FCR00000001','mapping.save'),req('FCR00000002','gltxn.save'),
  req('FCR00000003','journal.post'),req('FCR00000004','chart.save'),
  req('FCR00000005','mapping.save',{mine:true}),req('FCR00000006','mapping.save',{canDecide:false}),
  req('FCR00000007','mapping.save',{amount:100}),req('FCR00000008','gltxn.save',{status:'approved'}),
  req('NOT_A_FCR','mapping.save')
 ];
 assert.deepEqual(eligibleFinanceMappingApprovals(fixture).map(x=>x.id),['FCR00000001','FCR00000002']);
 assert.equal(eligibleFinanceMappingApprovals(Array.from({length:75},(_,i)=>req('FCR'+String(i).padStart(8,'0'),'mapping.save'))).length,MAX_BULK_FINANCE_APPROVALS);
});
test('Multiple pending mappings for the same legal entity require individual conflict review',()=>{
 const requests=[
  {id:'FCR00000001',leId:'LE01',type:'mapping.save',status:'pending',canDecide:true,mine:false,amount:null},
  {id:'FCR00000002',leId:'LE01',type:'mapping.save',status:'pending',canDecide:true,mine:false,amount:null},
  {id:'FCR00000003',leId:'LE01',type:'gltxn.save',status:'pending',canDecide:true,mine:false,amount:null}
 ];
 assert.deepEqual(eligibleFinanceMappingApprovals(requests).map(x=>x.id),['FCR00000003']);
});

test('Bulk approval invokes existing safeguarded endpoint, not privileged automatic journal authorisation',async()=>{
 const {readFileSync}=await import('node:fs');
 const file=readFileSync('src/org/FinApprovals.tsx','utf8');
 assert.match(file,/eligibleFinanceMappingApprovals/);
 assert.match(file,/\/requests\/decide/);
 assert.match(file,/acknowledge:true/);
 assert.match(file,/confirm\.ask/);
 assert.doesNotMatch(file,/\/requests\/bulk\/unsafe/);
});
