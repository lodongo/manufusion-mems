import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveHrManager} from '../../backend/hrManagerResolver.ts';
const profile=readFileSync(new URL('../../src/org/HrProfileOverview.tsx',import.meta.url),'utf8');
test('compact profile does not repeat identity information from its hero',()=>{
 for(const label of ['Role / title','Office / department','Employee number','Employment status']){
  assert.equal(profile.includes('label="'+label+'"'),false,label+' must not be duplicated');
 }
 assert.match(profile,/className="hr-card hr-card--compact"/);
 assert.match(profile,/Direct manager/);
});
test('manager shown from verified role assignment, not title guess',()=>{
 const nodes=new Map([
  ['A',{level:'site',status:'active',parentId:'',managerRoleCode:'MGR'}],
 ]);
 const users=[
  {id:'u1',data:{firstName:'Sam',lastName:'Lead',status:'active',assignments:[{type:'primary',nodeId:'A',positionCode:'MGR'}]}},
 ];
 const employee={assignments:[{type:'primary',nodeId:'A',positionCode:'TECH'}]};
 assert.deepEqual(resolveHrManager('u2',employee,nodes,users),{uid:'u1',reason:'resolved',roleCode:'MGR',nodeId:'A'});
 assert.equal(resolveHrManager('u1',employee,nodes,users).reason,'unassigned');
 const duplicate={id:'u3',data:{firstName:'Another',status:'active',assignments:[{type:'primary',nodeId:'A',positionCode:'MGR'}]}};
 assert.equal(resolveHrManager('u2',employee,nodes,[...users,duplicate]).reason,'ambiguous');
});
