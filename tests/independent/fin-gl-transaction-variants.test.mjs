import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGlTransactionVariants} from '../../backend/finTransactionVariants.ts';
const account=(code,name,statement='BS',classCode='1',categoryCode='12')=>({
 code,name,statement,classCode,className:'Assets',categoryCode,categoryName:'Materials',
 groupCode:'120',groupName:'Stock',accountRole:'',accountType:''
});
test('all distinct GL posting accounts generate discoverable granular scenarios',()=>{
 const accounts=[
  account('1211','Raw materials inventory'),
  account('1212','Maintenance spares stock'),
  account('5110','Material consumption','PL','5','51'),
  account('1300','Bank account'),
  account('4400','Sales revenue','PL','4','44')
 ];
 const rows=buildGlTransactionVariants(accounts);
 for(const a of accounts) assert.ok(rows.some(r=>r.accountCode===a.code));
 assert.ok(rows.some(r=>r.accountCode==='1211'&&r.event==='GR_STOCK'&&r.role==='INVENTORY'&&r.status==='configurable'));
 assert.ok(rows.some(r=>r.accountCode==='5110'&&r.event==='GI_CC'&&r.role==='CONSUMPTION'));
 assert.ok(rows.some(r=>r.accountCode==='4400'&&r.status==='template_only'&&r.event===''));
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
});
test('unknown GL accounts are templates, never falsely described as executable',()=>{
 const rows=buildGlTransactionVariants([account('8900','Other equity adjustment')]);
 assert.equal(rows.length,1);
 assert.equal(rows[0].status,'template_only');
 assert.equal(rows[0].event,'');
});
test('GL hierarchy is retained on every generated transaction variant',()=>{
 const rows=buildGlTransactionVariants([account('2210','Inventory stock','BS','2','21')]);
 assert.ok(rows.every(r=>r.classCode==='2'&&r.categoryCode==='21'&&r.groupCode==='120'));
});
