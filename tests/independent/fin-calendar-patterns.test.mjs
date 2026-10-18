import test from 'node:test';
import assert from 'node:assert/strict';
import {buildYear,DEFAULT_SETTINGS} from '../../backend/finCore.ts';

const utc=s=>Date.parse(s+'T00:00:00Z');
const DAY=86400000;
const standard = type=>({...DEFAULT_SETTINGS,calendarType:type,yearStartMonth:1,yearNaming:'start',yearEndRule:'nearest',weekEndDay:6,extraWeekPeriod:0});

test('Gregorian leap day occurs within generated calendar-month financial periods',()=>{
  const y=buildYear(2024,standard('month'),null);
  assert.equal(y.start,'2024-01-01');
  assert.equal(y.end,'2024-12-31');
  assert.equal(y.periods[1].end,'2024-02-29');
  assert.equal(y.periods.filter(x=>!x.special).length,12);
});
for(const type of ['445','454','544','13x4','weekly','quarterly','custom']){
 test(type+' builds 52/53-week periods with no gaps or overlap',()=>{
   const s=standard(type);
   const one=buildYear(2025,s,null);
   const two=buildYear(2026,s,one.end);
   assert.equal(utc(two.start)-utc(one.end),DAY);
   for(const y of [one,two]){
     const normal=y.periods.filter(x=>!x.special);
     assert.equal(normal[0].start,y.start);
     assert.equal(normal.at(-1).end,y.end);
     assert.equal(normal.reduce((sum,p)=>sum+(p.weeks||0),0),y.weeks);
     normal.slice(1).forEach((p,i)=>assert.equal(utc(p.start)-utc(normal[i].end),DAY));
     assert.ok([52,53].includes(y.weeks));
   }
 });
}
test('explicit week placement works in 53-week years',()=>{
  const s={...standard('445'),extraWeekPeriod:1};
  let fy=2020;
  let found=null;
  for(;fy<2035;fy++){
    const year=buildYear(fy,s,null);
    if(year.weeks===53){found=year;break;}
  }
  assert.ok(found);
  assert.equal(found.periods[0].weeks,5);
  assert.equal(found.periods[11].weeks,5);
});
test('week boundary on or after month end yields complete financial weeks',()=>{
  const s={...standard('445'),yearEndRule:'on_or_after'};
  const y=buildYear(2027,s,null);
  assert.ok([52,53].includes(y.weeks));
  assert.equal(new Date(utc(y.end)).getUTCDay(),6);
});
test('changed rules that create gaps are not accepted for a continuing fiscal year',()=>{
  const one=buildYear(2026,standard('month'),null);
  assert.throws(()=>buildYear(2027,{...standard('month'),yearStartMonth:2},one.end));
});

test('custom 52-week distribution generates the specified period count',()=>{
  const s={...standard('custom'),customWeeks:[2,3,4,5,6,7,8,9,8]};
  const year=buildYear(2025,s,null);
  assert.equal(year.periods.filter(p=>!p.special).length,9);
  assert.equal(year.periods.filter(p=>!p.special).reduce((n,p)=>n+p.weeks,0),year.weeks);
});
