import test from 'node:test';import assert from 'node:assert/strict';import {NEXT_CYCLE_TYPES,nextCycleStart,localDate,validateCycleDates,validateStartDateMove} from '../../backend/maintenanceCycle.ts';
test('weekly cutoff and exact selected maintenance types',()=>{
 const cycle={today:'2026-11-15',nextStart:nextCycleStart('2026-11-15',1)};
 assert.equal(cycle.nextStart,'2026-11-16');assert.equal(nextCycleStart('2026-11-16',1),'2026-11-23');
 assert.equal(nextCycleStart('2026-11-15',0),'2026-11-22');
 assert.equal(localDate(new Date('2026-11-15T21:00:00Z'),'Africa/Nairobi'),'2026-11-16');
 for(const code of NEXT_CYCLE_TYPES){assert.throws(()=>validateCycleDates(code,'2026-11-15','2026-11-15',cycle),/next maintenance cycle/);assert.doesNotThrow(()=>validateCycleDates(code,'2026-11-16','2026-11-16',cycle));}
 for(const code of ['MAI-005','MAI-006','MAI-007','MAI-012'])assert.doesNotThrow(()=>validateCycleDates(code,'2026-11-15','2026-11-15',cycle));
 assert.doesNotThrow(()=>validateCycleDates('MAI-001','2026-11-15','2026-11-15',cycle,{maintenanceTypeCode:'MAI-001',scheduledStart:'2026-11-15'}));
 assert.throws(()=>validateCycleDates('MAI-001','2026-02-30','2026-03-01',cycle),/valid start/);
});

test('start date may move twice across routes; finish-only corrections do not spend a move',()=>{let order={scheduledStart:'2026-11-16',dateChanges:[]};assert.equal(validateStartDateMove(order,'2026-11-17'),1);order={...order,scheduledStart:'2026-11-17',dateChanges:[{fromStart:'2026-11-16',toStart:'2026-11-17'}]};assert.equal(validateStartDateMove(order,'2026-11-18'),2);order={...order,scheduledStart:'2026-11-18',dateChanges:[...order.dateChanges,{fromStart:'2026-11-17',toStart:'2026-11-18'}]};assert.equal(validateStartDateMove(order,'2026-11-18'),2);assert.throws(()=>validateStartDateMove(order,'2026-11-19'),/moved twice/);});
