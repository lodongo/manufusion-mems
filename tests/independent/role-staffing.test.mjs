import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingRoleNodes, staffingSummary, employmentCoverage } from '../../src/org/roleStaffing.ts';

const nodes = [
    {id:'LE1',code:'LE1',level:'legal_entity',tier:0,name:'Kenya'},
    {id:'NAI',code:'KEN-NAI',level:'site',tier:0,name:'Nairobi Site'},
    {id:'KSM',code:'KEN-KSM',level:'site',tier:0,name:'Kisumu Site'},
    {id:'SA',code:'HQ',level:'group',tier:0,name:'Headquarters'},
    {id:'FIN',code:'KEN-NAI-FIN',level:'department',tier:0,name:'Finance'},
];

test('site role lists every concrete site independently; other levels are separate', () => {
    assert.deepEqual(matchingRoleNodes('site',nodes).map(x=>x.id),['KSM','NAI']);
    assert.deepEqual(matchingRoleNodes('department',nodes).map(x=>x.id),['FIN']);
    assert.deepEqual(matchingRoleNodes('upper:0',nodes).map(x=>x.id),['SA']);
    assert.deepEqual(matchingRoleNodes('',nodes),[]);
});

test('per-unit staffing computes vacancies and surplus without netting away site openings', () => {
    const plan = [{nodeId:'NAI',enabled:true,required:3},{nodeId:'KSM',enabled:true,required:1}];
    const counts = [{nodeId:'NAI',filled:1,temporary:1,employees:[]},{nodeId:'KSM',filled:2,temporary:0,employees:[]}];
    assert.deepEqual(staffingSummary(plan,counts),{required:4,filled:3,vacant:2,surplus:1,enabledUnits:2});
});

test('disabled sites do not create planned vacancies', () => {
    const plan = [{nodeId:'NAI',enabled:false,required:0},{nodeId:'KSM',enabled:true,required:2}];
    assert.equal(staffingSummary(plan,[]).vacant,2);
});

test('temporary assignments do not count as primary permanent job occupancy', () => {
    const a=[{positionCode:'ROL_000001',nodeId:'NAI',type:'primary'},
        {positionCode:'ROL_000001',nodeId:'KSM',type:'acting',startsOn:'2026-10-01',endsOn:'2026-10-21'}];
    assert.equal(employmentCoverage(a,'ROL_000001','2026-10-17').length,2);
    assert.equal(employmentCoverage(a,'ROL_000001','2026-11-01').length,1);
});

test('job role configuration persists unit staffing and employee assignment guards', async () => {
    const fs = await import('node:fs');
    const backend = fs.readFileSync(new URL('../../backend/positions.ts',import.meta.url),'utf8');
    assert.match(backend,/staffingPlan: rows|staffingPlan, updatedAt/);
    assert.match(backend,/org\.positions\.staffing/);
    assert.match(backend,/Enable it under Job roles first/);
    const frontend = fs.readFileSync(new URL('../../src/org/PositionsPage.tsx',import.meta.url),'utf8');
    assert.match(frontend,/staffingPlan: rows/);
    assert.match(frontend,/Vacant positions/);
    assert.match(frontend,/Assigned employees/);
});
