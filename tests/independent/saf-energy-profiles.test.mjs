import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SAF_DEFAULT_LISTS} from '../../backend/safDefaults.ts';
import {energyProfile,applies,configuredField,configurationIssues,validDay} from '../../backend/safEnergyProfiles.ts';
test('every adopted standard source has a typed profile and critical inspections',()=>{
 const catalog=SAF_DEFAULT_LISTS.find(x=>x.key==='hazardousEnergy').items;
 assert.equal(catalog.length,76);
 for(const x of catalog){const p=energyProfile(x.code);assert.ok(p.fields.length>=10,x.code);assert.ok(p.tests.length>=3,x.code);assert.equal(new Set(p.fields.map(z=>z.code)).size,p.fields.length);assert.equal(new Set(p.tests.map(z=>z.code)).size,p.tests.length);assert.ok(p.fields.some(z=>z.code==='isolation_ref'&&z.required));}
});
test('AC mains requires quantitative ratings, phase configuration, earthing and applicable leakage tests',()=>{
 const p=energyProfile('SAF_03_01_001');
 for(const key of ['voltage','current','phase','earthing','protective_earth','rcd'])assert.ok(p.fields.find(x=>x.code===key)?.required);
 assert.ok(p.fields.find(x=>x.code==='phase').options.includes('Single phase'));
 assert.equal(configuredField(p.fields.find(x=>x.code==='voltage'),-10),false);
 assert.equal(configuredField(p.fields.find(x=>x.code==='voltage'),400),true);
 assert.equal(applies(p.tests.find(x=>x.code==='earth_leakage'),{rcd:'RCD / RCCB'}),true);
 assert.equal(applies(p.tests.find(x=>x.code==='earth_leakage'),{rcd:'Not fitted — justified by design'}),false);
 assert.equal(applies(p.fields.find(x=>x.code==='rcd_exception'),{rcd:'Not fitted — justified by design'}),true);
});
test('pass requires current evidence, valid dates, scope and measurements; failure and overdue remain incomplete',()=>{
 const p={fields:[],tests:[{code:'test',label:'Critical test',critical:true}]};
 const good={result:'pass',lastDate:'2026-01-01',nextDue:'2027-01-01',tester:'Competent person',basis:'Approved plan',measurement:'Recorded results',evidenceToken:'file'};
 assert.deepEqual(configurationIssues(p,{}, {test:good},'2026-11-14'),[]);
 for(const patch of [{result:'fail'},{nextDue:'2026-05-01'},{evidenceToken:''},{measurement:''},{lastDate:'2026-02-30'},{result:'not_applicable'}])assert.ok(configurationIssues(p,{}, {test:{...good,...patch}},'2026-11-14').length);
 assert.equal(validDay('2026-02-30'),false);
});
test('server keeps evidence scoped to equipment, point and individual test, and historical revisions',()=>{
 const api=readFileSync('backend/safEquipment.ts','utf8');
 const ui=readFileSync('src/org/SafEquipment.tsx','utf8');
 assert.ok(api.includes("str(evidence.data.pointId)!==pointId"));
 assert.ok(api.includes("str(evidence.data.testCode)!==test.code"));
 assert.ok(api.includes('configurationIssues(profile,values,tests,today)'));
 assert.ok(api.includes('if(finalize&&issues.length)'));
 assert.ok(api.includes('/revisions/v'));
 assert.ok(ui.includes('All adopted subcategories'));
 assert.ok(ui.includes('Configure & tag'));
});
