import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visibleEnergySources,isLinkedEnergySource} from '../../src/org/energySourceSelection.ts';
const records=[{code:'SAF_03_01_001',label:'AC mains',category:'Electrical',subcategory:'Supply'},{code:'UTL-01-002',label:'Three-phase AC',category:'Electrical',subcategory:'Power'},{code:'UTL-08-001',label:'Plant air',category:'Air',subcategory:'Industrial'}];
test('source catalogue remains hidden until both hierarchy levels selected',()=>{
 assert.deepEqual(visibleEnergySources(records,'','',''),[]);
 assert.deepEqual(visibleEnergySources(records,'Electrical','','AC'),[]);
 assert.deepEqual(visibleEnergySources(records,'','Supply',''),[]);
 assert.deepEqual(visibleEnergySources(records,'Electrical','Power','AC'),[records[1]]);
 assert.deepEqual(visibleEnergySources(records,'Electrical','Supply',''),[records[0]]);
});
test('linked source identification cannot depend on a missing UI flag',()=>{
 assert.equal(isLinkedEnergySource(records[0]),false);
 assert.equal(isLinkedEnergySource(records[1]),true);
 assert.equal(isLinkedEnergySource({...records[0],linkedUtility:true}),true);
 const ui=readFileSync('src/org/SafEquipment.tsx','utf8'),api=readFileSync('backend/safEquipment.ts','utf8');
 assert.ok(ui.includes('checked={isLinkedEnergySource(x)||selectedCodes.has(x.code)}'));
 assert.ok(ui.includes('disabled={!data.canEdit||blocked||isLinkedEnergySource(x)}'));
 assert.ok(api.includes('All configured utility connections must appear exactly once'));
});
