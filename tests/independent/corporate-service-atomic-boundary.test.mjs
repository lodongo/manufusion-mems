import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=path=>readFileSync(path,'utf8');
test('P5 strict service acceptance journals commit source, actual and reservations together',()=>{
 const core=source('backend/finCore.ts');
 const ops=source('backend/finOps.ts');
 const po=source('backend/poFinance.ts');
 const service=source('backend/corporateServiceBudget.ts');
 assert.match(core,/extraForJournal\?:\s*\(journalId:string\)=>Promise<Write\[\]>/);
 assert.match(core,/writes\.push\(\.\.\.await input\.extraForJournal\(id\)\)/);
 assert.match(core,/await commit\(writes\)/);
 assert.match(ops,/strictBudget\?:\s*\{/);
 assert.match(ops,/extraForJournal:\(journalId:string,accepted:/);
 assert.match(ops,/sourceKey:\s*.+SVC_/);
 assert.match(po,/strictBudget:\{postingDate:at\.slice\(0,10\)/);
 assert.match(po,/prepareServiceAcceptanceBudget\(/);
 assert.match(po,/updateTime:fresh\.updateTime!/);
 assert.match(service,/recognizedReceipts/);
 assert.match(service,/row\.committedMinor-=amount;row\.actualMinor\+=amount/);
});
test('P5 releases PO reservation on approved PO cancel, not requisition cancel',()=>{
 const src=source('backend/purchaseOrders.ts');
 const prStart=src.indexOf("'POST /api/org/procurement/requisitions/cancel':");
 const prEnd=src.indexOf("'POST /api/org/procurement/requisitions/suspend':");
 const poStart=src.indexOf("'POST /api/org/procurement/orders/cancel':");
 const poEnd=src.indexOf("'POST /api/org/procurement/orders/send':");
 assert.ok(prStart>=0&&prEnd>prStart&&poStart>=0&&poEnd>poStart);
 assert.doesNotMatch(src.slice(prStart,prEnd),/preparePoCancellationBudget/);
 assert.match(src.slice(poStart,poEnd),/preparePoCancellationBudget/);
 assert.match(src,/if\(c\.atomicJournal\)/);
});
