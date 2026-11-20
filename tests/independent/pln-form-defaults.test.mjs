import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FORM_DEFAULTS,formDefaultsFor,preferredSiteId,localRequiredDate} from '../../src/org/plnFormDefaults.ts';

test('form defaults only fill new form values, with safe partial overrides',()=>{
 const chosen=formDefaultsFor({skuCategory:'INTERMEDIATE',demandLeadDays:3});
 assert.equal(chosen.skuCategory,'INTERMEDIATE');
 assert.equal(chosen.demandLeadDays,3);
 assert.equal(chosen.bomOutputQty,1);
 assert.equal(DEFAULT_FORM_DEFAULTS.skuCategory,'FINISHED');
 assert.equal(formDefaultsFor().routingAlternativeCode,'STANDARD');
});
test('site default cannot silently choose a site outside accessible scope',()=>{
 const sites=[{id:'A'},{id:'B'}];
 assert.equal(preferredSiteId('B',sites),'B');
 assert.equal(preferredSiteId('unavailable',sites),'');
 assert.equal(preferredSiteId('unavailable',[{id:'A'}]),'A');
 assert.equal(preferredSiteId('',sites),'');
 assert.equal(preferredSiteId('A',[]),'');
});
test('demand due-date default rolls over month/year in local calendar',()=>{
 assert.equal(localRequiredDate(5,new Date(2026,11,30)),'2027-01-04');
 assert.equal(localRequiredDate(0,new Date(2026,10,20)),'2026-11-20');
 assert.equal(localRequiredDate(-1,new Date(2026,10,20)),'2026-11-27');
});
