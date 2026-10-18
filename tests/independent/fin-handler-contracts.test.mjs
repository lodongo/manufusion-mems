import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGlTransactionVariants} from '../../backend/finTransactionVariants.ts';
import {registerGlContracts,registerGlContract,denyPlaceholderExecution} from '../../backend/finTransactionContracts.ts';
const a=(code,name,statement='BS')=>({code,name,statement,classCode:'1',className:'Assets',categoryCode:'10',categoryName:'Assets',groupCode:'100',groupName:'Balances',accountRole:'',accountType:''});
test('every approved GL scenario receives one named module-owned nonposting handler contract',()=>{
 const variants=buildGlTransactionVariants([a('1200','Raw materials inventory'),a('6200','Payroll wages','PL'),a('4100','Sales revenue','PL'),a('1390','General reserve')]);
 const contracts=registerGlContracts(variants);
 assert.equal(contracts.length,variants.length);
 assert.equal(new Set(contracts.map(c=>c.id)).size,variants.length);
 assert.ok(contracts.every(c=>c.module&&c.submodule&&c.handlerId&&c.requiredInputs.length>=6&&c.postingAllowed===false));
 assert.ok(contracts.some(c=>c.module==='PAY'&&c.submodule==='Payroll posting'&&c.state==='placeholder'));
 assert.ok(contracts.some(c=>c.module==='SAL'&&c.state==='placeholder'));
 assert.ok(contracts.some(c=>c.module==='INV'&&c.state==='wired_event'));
});
test('financial placeholder execution is blocked unconditionally',()=>{
 const c=registerGlContract(buildGlTransactionVariants([a('4400','Sales revenue','PL')])[0]);
 assert.equal(c.state,'placeholder');
 assert.equal(c.postingAllowed,false);
 assert.throws(()=>denyPlaceholderExecution(c),/cannot post journal entries/);
});
test('module and submodule ownership is consistent for stock, maintenance and fixed assets',()=>{
 for(const [name,expectedModule] of [['Inventory stock','INV'],['Maintenance spares consumption','MNT'],['Asset clearing','AST']]){
   const v=buildGlTransactionVariants([a('100'+name.length,name,name.includes('consumption')?'PL':'BS')]);
   assert.ok(registerGlContracts(v).some(c=>c.module===expectedModule),name);
 }
});
