import test from 'node:test';import assert from 'node:assert/strict';
import {timeline,liveWorkOrderHealth,matchLiveWorkOrder} from '../../backend/maintenanceAnalyticsCore.ts';
const now=Date.parse('2026-11-15T12:00:00Z'),day=(_,at)=>new Date(at).toISOString().slice(0,10);
const order=(id,extra)=>timeline({kind:'wo',id,data:{createdAt:'2026-11-01T12:00:00Z',status:'released',workflowCode:'WO150',scheduledEnd:'2026-11-08',...extra}},now);
test('live overdue is calendar-day based, seven days inclusive; counts distinct open orders with task or legacy spares',()=>{
const h=liveWorkOrderHealth([order('A',{assessmentTasks:[{spares:[{}]},{spares:[{}]}]}),order('B',{scheduledEnd:'2026-11-07',workflowCode:'WO030',spares:[{}]}),order('C',{scheduledEnd:'2026-11-15'}),order('D',{scheduledEnd:''}),order('E',{status:'closed'}),order('F',{status:'cancelled'}),order('G',{scheduledEnd:'2026-11-16'})],now,day);
assert.equal(h.open,5);assert.equal(h.overdue,2);assert.equal(h.over7,1);assert.equal(h.maxOverdueDays,8);assert.equal(h.withSpares,2);assert.equal(h.missingSchedule,1);assert.equal(h.openStates.reduce((n,x)=>n+x.value,0),h.open);assert.equal(h.records.filter(r=>matchLiveWorkOrder(r,'live_spares_status','WO030')).length,1);assert.equal(h.records.filter(r=>matchLiveWorkOrder(r,'live_over7')).length,1);
});
test('unknown schedule is not zero overdue age; no dated work yields N/A',()=>{const h=liveWorkOrderHealth([order('A',{scheduledEnd:'2026-02-30'})],now,day);assert.equal(h.maxOverdueDays,null);assert.equal(h.missingSchedule,1);});

import {validateTargetValues} from '../../backend/maintenanceAnalyticsTargets.ts';
test('seven days is the upper bound for configured overdue age targets',()=>{assert.deepEqual(validateTargetValues({woMaxOverdueDays:7}),{woMaxOverdueDays:7});assert.deepEqual(validateTargetValues({woMaxOverdueDays:3}),{woMaxOverdueDays:3});assert.throws(()=>validateTargetValues({woMaxOverdueDays:8}),/seven days/);});
