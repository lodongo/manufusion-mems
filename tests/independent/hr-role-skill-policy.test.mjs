import test from 'node:test';
import assert from 'node:assert/strict';
import {HR_RULE_DEFAULTS,hrRules,hrVisibleTabs} from '../../backend/hrPrivacyRules.ts';

test('new role skill requirements tab appears for authorized employees, managers and HR',()=>{
 for(const scope of ['self','manager','hr','superadmin']){
  assert.ok(hrVisibleTabs(scope,HR_RULE_DEFAULTS).includes('roleSkills'),scope+' must see configured role requirements');
 }
});
test('existing saved skills permissions migrate to the separate requirements tab',()=>{
 const oldPolicy=hrRules({
  selfTabs:['basic','skills','roles'],managerTabs:['basic','skills'],
  hrTabs:['basic','skills'],managerIndirectReports:false,
 });
 assert.ok(oldPolicy.selfTabs.includes('roleSkills'));
 assert.ok(oldPolicy.managerTabs.includes('roleSkills'));
 assert.ok(oldPolicy.hrTabs.includes('roleSkills'));
});
test('independently approved schema-two rules may explicitly disable role requirements tab',()=>{
 const disabled=hrRules({...HR_RULE_DEFAULTS,
  selfTabs:HR_RULE_DEFAULTS.selfTabs.filter(x=>x!=='roleSkills'),
  managerTabs:HR_RULE_DEFAULTS.managerTabs.filter(x=>x!=='roleSkills'),
  hrTabs:HR_RULE_DEFAULTS.hrTabs.filter(x=>x!=='roleSkills'),
  schemaVersion:2,
 });
 for(const scope of ['self','manager','hr']){
  assert.equal(hrVisibleTabs(scope,disabled).includes('roleSkills'),false);
 }
 assert.ok(hrVisibleTabs('superadmin',disabled).includes('roleSkills'));
});
