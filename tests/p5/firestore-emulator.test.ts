import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {
 FIRESTORE_BASE,PROJECT_ID,getDoc,writeDoc,
 type Fields,type Obj,
} from '../../backend/core';
import {commit, type Write} from '../../backend/finCore';
import {prepareCommitmentWrites,commitmentRecordPath,planDocumentPath} from '../../backend/corporateCommitmentPersistence';
import {prepareServiceAcceptanceBudget} from '../../backend/corporateServiceBudget';
import type {BudgetPlan} from '../../backend/corporateBudget';
import type {SourceCommitment} from '../../backend/corporateCommitment';

/**
 * Real Firestore Emulator REST integration (not mocks).
 * Requires a throwaway project and loopback emulator, never remote Firebase.
 * Does not authenticate Firebase users; user-role and security-rule tests remain outstanding.
 */
assert.equal(PROJECT_ID,'mems-p5-emulator-test');
assert.equal(process.env.MEMS_P5_EMULATOR_TEST,'true');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8083');
assert.match(FIRESTORE_BASE,/^http:\/\/127\.0\.0\.1:8083\/v1\/projects\/mems-p5-emulator-test\//);

const unique=()=>randomBytes(5).toString('hex');
const org=(prefix:string)=>'E2E_'+prefix+'_'+unique();
const le='LE001',cc='CC001',fy=2027,cur='KES';
const baseBudget=():BudgetPlan=>({
 legalEntityId:le,fy,currency:cur,status:'approved',version:1,
 approvedBy:'approverB',approvedAt:'2026-10-24',approvalRef:'FCR00000009',
 lines:[{costCenterId:cc,category:'OPEX',approvedMinor:100000,adjustmentsMinor:0,committedMinor:0,actualMinor:0}],
});
const line=(amountMinor:number)=>({legalEntityId:le,fy,currency:cur,costCenterId:cc,category:'OPEX' as const,amountMinor});
const source=(name:string,minor:number,version=1,status:'reserved'|'released'='reserved'):SourceCommitment=>({
 sourceKind:'purchase_order',sourceKey:name,sourceDocumentId:name,
 version,status,lines:status==='reserved'?[line(minor)]:[],exceptionIds:[],
});
async function setup(name:string){
 const tenant=org(name),path=planDocumentPath(tenant,le,fy);
 assert.equal(await writeDoc(path,baseBudget() as unknown as Fields,{exists:false}),true);
 return {tenant,path};
}
async function create(tenant:string,s:SourceCommitment,poId:string){
 const prep=await prepareCommitmentWrites(tenant,s,'2026-11-01');
 const poPath='organizations/'+tenant+'/procurement_orders/'+poId;
 await commit([...prep.writes,{
  path:poPath,exists:false,
  fields:{id:poId,status:'approved',budgetControlled:true,budgetLegalEntityId:le,budgetCurrency:cur},
 }]);
 return poPath;
}
async function plan(tenant:string){const d=await getDoc(planDocumentPath(tenant,le,fy));assert.ok(d);return d.data as unknown as BudgetPlan;}
const reserved=(p:BudgetPlan)=>p.lines[0].committedMinor;
const actual=(p:BudgetPlan)=>p.lines[0].actualMinor;

test('two competing source approvals: one CAS winner, no partial PO or source record',async()=>{
 const {tenant}=await setup('race');
 const a=source('PO00000001',70000),b=source('PO00000002',70000);
 // Both proposals read the SAME available budget snapshot before either commits.
 const [one,two]=await Promise.all([
  prepareCommitmentWrites(tenant,a,'2026-11-01'),
  prepareCommitmentWrites(tenant,b,'2026-11-01'),
 ]);
 const outcomes=await Promise.allSettled([
  commit([...one.writes,{path:'organizations/'+tenant+'/procurement_orders/'+a.sourceKey,exists:false,fields:{status:'approved'}}]),
  commit([...two.writes,{path:'organizations/'+tenant+'/procurement_orders/'+b.sourceKey,exists:false,fields:{status:'approved'}}]),
 ]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(reserved(await plan(tenant)),70000);
 const poResults=await Promise.all([a,b].map(s=>getDoc('organizations/'+tenant+'/procurement_orders/'+s.sourceKey)));
 const recorded=await Promise.all([a,b].map(s=>getDoc(commitmentRecordPath(tenant,'purchase_order',s.sourceKey))));
 assert.equal(poResults.filter(Boolean).length,1);
 assert.equal(recorded.filter(Boolean).length,1);
 assert.equal(Boolean(poResults[0]),Boolean(recorded[0]));
});
test('invalid source precondition rolls back budget and commitment entirely',async()=>{
 const {tenant,path}=await setup('rollback');
 const s=source('PO00000003',20000),prep=await prepareCommitmentWrites(tenant,s,'2026-11-01');
 const brokenSource='organizations/'+tenant+'/procurement_orders/PO00000003';
 const stale:Write={path:brokenSource,updateTime:'2000-01-01T00:00:00.000000Z',
  fields:{id:s.sourceKey,status:'approved'}};
 await assert.rejects(()=>commit([...prep.writes,stale]));
 assert.equal(reserved(await plan(tenant)),0);
 assert.equal(await getDoc(commitmentRecordPath(tenant,'purchase_order',s.sourceKey)),null);
 assert.equal(await getDoc(brokenSource),null);
 assert.equal((await getDoc(path))?.data.version,1);
});
test('partial service acceptance atomically moves committed into actual with source and journal proof',async()=>{
 const {tenant}=await setup('part'),po='PO00000004';
 const poPath=await create(tenant,source(po,50000),po);
 const snap=await getDoc(poPath);assert.ok(snap);
 const accepted=await prepareServiceAcceptanceBudget(tenant,po,po+'_S1',[{costCenterId:cc,amountMinor:20000}],false);
 const glPath='organizations/'+tenant+'/fin_journals/TEST_GL_00001';
 await commit([...accepted.writes,
  {path:poPath,updateTime:snap.updateTime,fields:{...snap.data,status:'partial',budgetActualMinor:20000,budgetRemainingMinor:30000,lastJournal:'TEST_GL_00001'} as Obj},
  {path:glPath,exists:false,fields:{source:po+'_S1',amountMinor:20000,type:'SVC_ACCEPT_TEST_SENTINEL'}},
 ]);
 assert.equal(reserved(await plan(tenant)),30000);
 assert.equal(actual(await plan(tenant)),20000);
 assert.equal((await getDoc(poPath))?.data.lastJournal,'TEST_GL_00001');
 assert.equal((await getDoc(glPath))?.data.amountMinor,20000);
 const src=await getDoc(commitmentRecordPath(tenant,'purchase_order',po));
 assert.deepEqual(src?.data.recognizedReceipts,[po+'_S1']);
 await assert.rejects(()=>prepareServiceAcceptanceBudget(tenant,po,po+'_S1',[{costCenterId:cc,amountMinor:20000}],false));
});
test('subsequent full receipt releases residual reservation without converting unused sums to actual',async()=>{
 const {tenant}=await setup('full'),po='PO00000005';
 const path=await create(tenant,source(po,50000),po);
 const first=await prepareServiceAcceptanceBudget(tenant,po,po+'_S1',[{costCenterId:cc,amountMinor:19000}],false);
 let pd=await getDoc(path);assert.ok(pd);
 await commit([...first.writes,{path,updateTime:pd.updateTime,fields:{...pd.data,status:'partial'} as Obj}]);
 const second=await prepareServiceAcceptanceBudget(tenant,po,po+'_S2',[{costCenterId:cc,amountMinor:25000}],true);
 pd=await getDoc(path);assert.ok(pd);
 await commit([...second.writes,{path,updateTime:pd.updateTime,fields:{...pd.data,status:'full'} as Obj}]);
 assert.equal(actual(await plan(tenant)),44000);
 assert.equal(reserved(await plan(tenant)),0);
 assert.equal(second.remainingMinor,0);
 assert.equal((await getDoc(commitmentRecordPath(tenant,'purchase_order',po)))?.data.status,'released');
});
test('concurrent service receipts consume one source snapshot once; losing request changes nothing',async()=>{
 const {tenant}=await setup('receiptRace'),po='PO00000006';
 await create(tenant,source(po,50000),po);
 const [a,b]=await Promise.all([
  prepareServiceAcceptanceBudget(tenant,po,po+'_S1',[{costCenterId:cc,amountMinor:35000}],false),
  prepareServiceAcceptanceBudget(tenant,po,po+'_S2',[{costCenterId:cc,amountMinor:35000}],false),
 ]);
 const outcomes=await Promise.allSettled([commit(a.writes),commit(b.writes)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(actual(await plan(tenant)),35000);
 assert.equal(reserved(await plan(tenant)),15000);
 const src=await getDoc(commitmentRecordPath(tenant,'purchase_order',po));
 assert.equal((src?.data.recognizedReceipts as string[]).length,1);
});
test('tenant-isolated source paths: same PO reference cannot touch other organization budget',async()=>{
 const {tenant:a}=await setup('tenantA'),{tenant:b}=await setup('tenantB');
 await create(a,source('PO00000007',80000),'PO00000007');
 const first=await plan(a),second=await plan(b);
 assert.equal(reserved(first),80000);
 assert.equal(reserved(second),0);
 assert.equal(await getDoc(commitmentRecordPath(b,'purchase_order','PO00000007')),null);
 const rejected=await prepareCommitmentWrites(b,source('PO00000007',120000),'2026-11-01').then(()=>false,()=>true);
 assert.equal(rejected,true);
 assert.equal(reserved(await plan(a)),80000);
 assert.equal(reserved(await plan(b)),0);
});
