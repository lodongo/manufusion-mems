import test from 'node:test';import assert from 'node:assert/strict';
import {timeline,events,summarize,dwell,requestTransition,ratio} from './maintenanceAnalyticsCore';
import {periodBounds,trendBuckets,type Calendar} from './maintenanceAnalyticsCalendar';
const day=(n:number)=>Date.parse('2026-11-'+String(n).padStart(2,'0')+'T00:00:00Z'),now=day(15),w={start:day(10),end:day(15)+1};
test('cohort conversion and throughput are different; retrospective closure is not conversion',()=>{
 const t=[timeline({kind:'wr',id:'a',data:{createdAt:new Date(day(1)).toISOString(),status:'confirmed',analyticsConvertedAt:new Date(day(11)).toISOString()}},now),timeline({kind:'wr',id:'b',data:{createdAt:new Date(day(10)).toISOString(),status:'closed',closedAt:new Date(day(12)).toISOString()}},now),timeline({kind:'wr',id:'c',data:{createdAt:new Date(day(10)).toISOString(),status:'confirmed',analyticsConvertedAt:new Date(day(13)).toISOString()}},now)];
 const s=summarize(t,w,now,()=>NaN);assert.equal(s.metrics.created,2);assert.equal(s.metrics.converted,2);assert.equal(s.metrics.cohort,1);assert.equal(s.metrics.cohortRate,50);assert.equal(s.metrics.throughputRate,100);assert.equal(s.metrics.closed,1);assert.equal(ratio(1,0),null);
});
test('historical missing states are unknown, even if current state is known',()=>{
 const t=timeline({kind:'wo',id:'A',data:{createdAt:new Date(day(1)).toISOString(),status:'planning',workflowCode:'WO030',workflowTransitions:[{to:'WO030',at:new Date(day(12)).toISOString()}]}},now);
 assert.equal(events(t,{start:day(2),end:day(11)}).unknown,true);assert.equal(events(t,w).backlog,true);assert.deepEqual(dwell(t,{start:day(10),end:day(13)}),[{state:'UNKNOWN',hours:48},{state:'WO030',hours:24}]);
});
test('request history records changed states only',()=>{
 assert.deepEqual(requestTransition({status:'created'},'created','2026-11-01T00:00:00Z','u','User','x'),{});
 const p=requestTransition({status:'created',maintenanceGovernance:{version:2}},'under_review','2026-11-01T00:00:00Z','u','User','review');
 assert.equal(p.analyticsTransitions?.[0]?.policyVersion,2);
});
test('financial calendar controls periods and local UTC bounds',()=>{
 const c:Calendar={id:'LE',name:'LE',zone:'Africa/Nairobi',weekEndDay:6,years:[{fy:2026,label:'FY2026',start:'2026-01-04',end:'2027-01-02',periods:[{no:10,name:'P10',start:'2026-10-04',end:'2026-10-31',special:false},{no:11,name:'P11',start:'2026-11-01',end:'2026-11-28',special:false}]}]};
 const period=periodBounds('current_month',c,now);assert.equal(period.start,new Date('2026-10-31T21:00:00Z').getTime());assert.equal(period.endDate,'2026-11-28');assert.ok(trendBuckets(period,'current_month',c).length>0);
 assert.equal(periodBounds('last_month',c,now).startDate,'2026-10-04');assert.throws(()=>periodBounds('current_year',{...c,years:[]},now));
});

import {resolveTargets,validateTargetValues,validateSharedLayout} from './maintenanceAnalyticsTargets';
test('KPI defaults inherit then scoped overrides win without fabricated defaults',()=>{const r=resolveTargets([{scope:'org',values:{woBacklog:10,woScheduleCompliance:90}},{scope:'node:site',values:{woBacklog:5}},{scope:'employee:e',values:{woScheduleCompliance:95}}],['node:site','employee:e']);assert.equal(r.woBacklog?.value,5);assert.equal(r.woScheduleCompliance?.value,95);assert.equal(r.wrCohortRate,undefined);assert.throws(()=>validateTargetValues({wrCohortRate:101}));assert.equal(validateTargetValues({wrThroughputRate:120}).wrThroughputRate,120);});
test('shared layouts contain no personal scope filters',()=>{const l=validateSharedLayout({name:'Ops',role:'*',isDefault:true,settings:{period:'today',kind:'wo',cards:['kpis','trend'],dimension:'site',employee:'secret'}});assert.deepEqual(l.settings,{period:'today',kind:'wo',cards:['kpis','trend'],dimension:'site'});});
test('unrecorded change to live state does not invent prior history',()=>{const t=timeline({kind:'wo',id:'X',data:{createdAt:new Date(day(1)).toISOString(),status:'planning',workflowCode:'WO040',workflowTransitions:[{to:'WO030',at:new Date(day(2)).toISOString()}]}},now);assert.equal(events(t,{start:day(3),end:day(12)}).unknown,true);assert.equal(events(t,w).end,'WO040');});

test('trend buckets stay inside the exact drill-through slice',()=>{const c:Calendar={id:'LE',name:'LE',zone:'UTC',weekEndDay:6,years:[]},p=periodBounds('custom',c,now,'2026-11-01','2026-11-14'),w={...p,start:day(10)+3600000,end:day(10)+7200000};const buckets=trendBuckets(w,'custom',c);assert.equal(buckets.length,1);assert.equal(buckets[0].start,w.start);assert.equal(buckets[0].end,w.end);});
