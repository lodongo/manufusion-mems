import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAccountRule,validateRuleDraft,DETERMINATION_EVENTS} from '../../backend/finAccountRules.ts';
const basic={id:'all',event:'GR_STOCK',role:'INVENTORY',account:'1200',categoryCode:'',costCenterId:'',priority:100,enabled:true};
test('normal default rule, category rule and specific cost center rule resolve predictably',()=>{
 const rules=validateRuleDraft([
  basic,{...basic,id:'cat',account:'1210',categoryCode:'SPARE'},
  {...basic,id:'specific',account:'1220',categoryCode:'SPARE',costCenterId:'NBI01'},
 ]);
 assert.equal(resolveAccountRule(rules,'INVENTORY',{event:'GR_STOCK'})?.account,'1200');
 assert.equal(resolveAccountRule(rules,'INVENTORY',{event:'GR_STOCK',categoryCode:'SPARE'})?.account,'1210');
 assert.equal(resolveAccountRule(rules,'INVENTORY',{event:'GR_STOCK',categoryCode:'SPARE',costCenterId:'NBI01'})?.account,'1220');
 assert.equal(resolveAccountRule(rules,'INVENTORY',{event:'GI_CC',categoryCode:'SPARE'}),null);
});
test('disabled rules cannot select GL accounts',()=>{
 assert.equal(resolveAccountRule(validateRuleDraft([{...basic,enabled:false}]),'INVENTORY',{event:'GR_STOCK'}),null);
});
test('ambiguous identical conditions and priority are rejected',()=>{
 assert.throws(()=>validateRuleDraft([basic,{...basic,id:'duplicate',account:'8888'}]),/duplicated/);
});
test('invalid combinations and empty accounts rejected before approval',()=>{
 assert.throws(()=>validateRuleDraft([{...basic,role:'VAT_OUTPUT'}]),/unsupported/);
 assert.throws(()=>validateRuleDraft([{...basic,account:''}]),/approved GL/);
});
test('planned events have explicit implementation flags',()=>{
 assert.equal(DETERMINATION_EVENTS.find(e=>e.code==='AP_INVOICE')?.implemented,false);
 assert.equal(DETERMINATION_EVENTS.find(e=>e.code==='GR_STOCK')?.implemented,true);
});
