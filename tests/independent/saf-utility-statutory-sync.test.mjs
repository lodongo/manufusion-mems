import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AST_UTILITY_ITEMS} from '../../backend/astUtilityDefaults.ts';
import {STATUTORY_INSPECTIONS,statutoryProfile,mergeUtilityEnergy,utilityPointId,candidateInspectionCodes} from '../../backend/safStatutoryInspections.ts';
import {SAF_DEFAULT_LISTS} from '../../backend/safDefaults.ts';
const all=new Set(STATUTORY_INSPECTIONS.map(s=>s.code));
test('shared utility master expands coverage and preserves stable source codes',()=>{
 assert.ok(AST_UTILITY_ITEMS.length>=155);
 assert.equal(new Set(AST_UTILITY_ITEMS.map(x=>x.code)).size,AST_UTILITY_ITEMS.length);
 assert.equal(SAF_DEFAULT_LISTS.find(x=>x.key==='externalEnergySources').items.length,AST_UTILITY_ITEMS.length);
 for(const u of AST_UTILITY_ITEMS)for(const code of candidateInspectionCodes(u.code))assert.ok(all.has(code),code);
});
test('authoritative utility projection is exactly one-to-one, preserves internal points and never invents a duplicate',()=>{
 const a={code:'UTL-01-002',label:'Three-phase AC',connectionId:'A',values:{voltage:'400',current:63}};
 const b={code:'UTL-08-001',label:'Plant air',connectionId:'B',values:{pressure:6}};
 const local={code:'SAF_03_02_005',pointId:'spring1',tag:'S-01'};
 const rows=mergeUtilityEnergy([a,b],[local]);
 assert.equal(rows.length,3);
 assert.equal(rows[0].pointId,utilityPointId(a));
 assert.deepEqual(rows[0].utilityValues,a.values);
 assert.equal(rows[0].linkedUtility,true);
 const saved={...rows[0],tag:'ELEC-1',values:{legal_review:'Review',location:'Filler'},status:'documented'};
 const same=mergeUtilityEnergy([a],[saved,rows[1],local]);
 assert.equal(same.length,2);
 assert.equal(same[0].tag,'ELEC-1');
 assert.equal(same[0].status,'documented');
 const changed=mergeUtilityEnergy([{...a,values:{voltage:'415',current:63}}],[saved,local]);
 assert.equal(changed[0].status,'draft');
 assert.equal(changed[0].values.legal_review,undefined);
 assert.equal(changed[0].utilityValues.voltage,'415');
 const readded=mergeUtilityEnergy([{...a,connectionId:'NEW'}],[saved]);
 assert.notEqual(readded[0].pointId,saved.pointId);
 assert.equal(readded[0].tag,'');
 assert.equal(mergeUtilityEnergy([],[saved,local]).length,1);
});
test('statutory profiles show only adopted formal inspection types and avoid duplicate utility quantities',()=>{
 const p=statutoryProfile('UTL-01-002',new Set(['SI-EL-01','SI-EL-06']),['voltage','current','frequency','power']);
 assert.deepEqual(p.tests.map(t=>t.code),['SI-EL-01','SI-EL-06']);
 assert.ok(p.tests.every(x=>x.reference));
 assert.ok(!p.fields.some(f=>['voltage','current','frequency','power'].includes(f.code)));
 assert.ok(p.fields.some(f=>f.code==='legal_jurisdiction'&&f.required));
 assert.ok(p.fields.some(f=>f.code==='legal_review'&&f.required));
 assert.ok(p.fields.find(f=>f.code==='phase').options.every(x=>x.startsWith('Three phase')));
 assert.equal(statutoryProfile('SAF_03_02_005',all).tests.some(x=>x.code==='guard_test'),false);
 assert.equal(statutoryProfile('UTL-25-001',all).tests.length,0);
});
test('backend rejects external omissions, obsolete connection references and duplicate values',()=>{
 const api=readFileSync('backend/safEquipment.ts','utf8');
 assert.ok(api.includes('All configured utility connections must appear exactly once'));
 assert.ok(api.includes('Equipment utilities changed. Reload the energy register.'));
 assert.ok(api.includes('External connections are maintained in Utilities.'));
 assert.ok(api.includes('utilityPointId'));
 const ui=readFileSync('src/org/SafEquipment.tsx','utf8');
 assert.ok(ui.includes('Utility supply values · synchronized'));
 assert.ok(ui.includes('Historical / non-adopted test evidence'));
});

test('a supply asset relink reopens hazardous energy review without losing the connection identity',()=>{
 const a={code:'UTL-08-001',connectionId:'A',sourceAssetTag:'AST-000001',values:{flow:200}};
 const row={...mergeUtilityEnergy([a],[])[0],status:'documented',values:{legal_review:'previous source'}};
 const changed=mergeUtilityEnergy([{...a,sourceAssetTag:'AST-000002'}],[row])[0];
 assert.equal(changed.pointId,row.pointId);assert.equal(changed.status,'draft');assert.equal(changed.sourceAssetTag,'AST-000002');assert.equal(changed.values.legal_review,undefined);
});
