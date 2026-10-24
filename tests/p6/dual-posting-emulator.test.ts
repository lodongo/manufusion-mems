import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {FIRESTORE_BASE,PROJECT_ID,getDoc} from '../../backend/core';
import {commit,type Write} from '../../backend/finCore';
import {hashKey} from '../../backend/finCore';
assert.equal(PROJECT_ID,'mems-p5-emulator-test');
assert.equal(process.env.MEMS_P5_EMULATOR_TEST,'true');
assert.match(FIRESTORE_BASE,/^http:\/\/127\.0\.0\.1:8083/);
const tenant=()=> 'P6IC_'+randomBytes(5).toString('hex');
const base=(t:string)=>'organizations/'+t;
const item=(path:string,fields:Record<string,unknown>):Write=>({path,fields,exists:false});
const pairWrites=(t:string,id:string):Write[]=>{
 const root=base(t);
 const p=root+'/fin_journal/LEA-2027-00000001';
 const b=root+'/fin_journal/LEB-2027-00000001';
 return [
  item(p,{id:'LEA-2027-00000001',leId:'LEA',totalDebit:500,totalCredit:500,source:{id},trace:{pairId:id,party:'provider'}}),
  item(b,{id:'LEB-2027-00000001',leId:'LEB',totalDebit:500,totalCredit:500,source:{id},trace:{pairId:id,party:'beneficiary'}}),
  item(root+'/fin_postkeys/'+hashKey('P6-IC-'+id+'-provider'),{journalId:'LEA-2027-00000001'}),
  item(root+'/fin_postkeys/'+hashKey('P6-IC-'+id+'-beneficiary'),{journalId:'LEB-2027-00000001'}),
  item(root+'/corp_ic_pairs/'+id,{id,providerJournalId:'LEA-2027-00000001',beneficiaryJournalId:'LEB-2027-00000001',status:'posted'}),
  item(root+'/fin_bal/LEA-OPEX-2027',{leId:'LEA',drC:50000,crC:50000}),
  item(root+'/fin_bal/LEB-OPEX-2027',{leId:'LEB',drC:50000,crC:50000}),
 ];
};
test('P6 both IC journals, postkeys, balances and pair proof commit together',async()=>{
 const t=tenant(),id='V001',writes=pairWrites(t,id);
 await commit(writes);
 for(const w of writes)assert.ok(await getDoc(w.path),w.path);
});
test('P6 stale beneficiary journal CAS prevents the provider posting and all pair proof',async()=>{
 const t=tenant(),id='V002',writes=pairWrites(t,id);
 const wrong=4;writes[wrong].exists=false;
 writes[1]={...writes[1],exists:undefined,updateTime:'2001-01-01T00:00:00.000000Z'};
 await assert.rejects(()=>commit(writes));
 for(const w of pairWrites(t,id))assert.equal(await getDoc(w.path),null,w.path);
});
test('P6 concurrent submission of same pair idempotency key has only one winner',async()=>{
 const t=tenant(),id='V003';
 const results=await Promise.allSettled([commit(pairWrites(t,id)),commit(pairWrites(t,id))]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const proof=await getDoc(base(t)+'/corp_ic_pairs/'+id);
 assert.ok(proof);
});
test('P6 tenant-isolated pair source docs and journals do not collide',async()=>{
 const t=tenant(),other=tenant(),id='V004';
 await commit(pairWrites(t,id));
 for(const w of pairWrites(other,id))assert.equal(await getDoc(w.path),null);
});
test('P6 allocation source line claim and annual cap have same-CAS conflict',async()=>{
 const t=tenant(),dir=base(t),pool=dir+'/corp_allocation_policies/POOL1';
 await commit([item(pool,{code:'POOL1',allocatedToDateMinor:0})]);
 const current=await getDoc(pool);assert.ok(current);
 const claim=dir+'/corp_allocation_source_claims/SRC001';
 const build=(runId:string):Write[]=>[
  {path:pool,updateTime:current.updateTime,fields:{allocatedToDateMinor:6000},mask:['allocatedToDateMinor']},
  item(claim,{runId}),item(dir+'/corp_allocation_runs/'+runId,{id:runId,totalMinor:6000})
 ];
 const results=await Promise.allSettled([commit(build('RUN1')),commit(build('RUN2'))]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await getDoc(pool))?.data.allocatedToDateMinor,6000);
 assert.equal(Number(!!await getDoc(dir+'/corp_allocation_runs/RUN1'))+Number(!!await getDoc(dir+'/corp_allocation_runs/RUN2')),1);
});
