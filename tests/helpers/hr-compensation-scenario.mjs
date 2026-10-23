import assert from 'node:assert/strict';
import {seed,snapshot} from './maintenance-fixture.ts';
import {hrCompensationRoutes} from '../../backend/hrCompensationConfig.ts';
const org='hr_compensation_fixture',root='organizations/'+org;
seed(root,{status:'active',countryCode:'KE',currencyCode:'KES',modules:{HRM:true}});
seed(root+'/structure/LE_KE',{level:'legal_entity',name:'Kenya Manufacturing',status:'active',
 attributes:{countryCode:'KE',currencyCode:'KES'}});
seed(root+'/structure/LE_UG',{level:'legal_entity',name:'Uganda Trading',status:'active',
 attributes:{countryCode:'UG',currencyCode:'UGX'}});
seed('users/admin',{uid:'admin',orgId:org,status:'active',role:'org_super_admin',assignments:[]});
seed('users/member',{uid:'member',orgId:org,status:'active',role:'member',assignments:[]});
const ctx=(uid,body={})=>({
 uid,orgId:org,role:uid==='admin'?'org_super_admin':'member',
 me:snapshot('users/'+uid),org:snapshot(root),body,actor:{uid,orgId:org},
 permissions:uid==='admin'?['ADM.settings','HRM.shell.view']:['HRM.shell.view'],
 directPermissions:uid==='admin'?['ADM.settings','HRM.shell.view']:['HRM.shell.view'],
 meta:{},claims:{email:'test@example.com'},
});
const call=(uid,path,body={})=>{
 const route=hrCompensationRoutes['POST '+path]?.[0];
 assert.ok(route,path);
 return route(ctx(uid,body));
};
await assert.rejects(()=>call('member','/api/org/hr/compensation/get',{legalEntityId:'LE_KE'}),/permission/i);
const read=await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_KE'});
assert.equal(read.currency,'KES');
assert.equal(read.countryCode,'KE');
assert.equal(read.saved,false);
assert.equal(read.config.items.find(x=>x.code==='KE_NSSF').maximum,6480);
const ug=await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_UG'});
assert.equal(ug.currency,'UGX');
assert.equal(ug.countryCode,'UG');
assert.equal(ug.config.items.some(x=>x.code.startsWith('KE_')),false);
const policy=structuredClone(read.config);
const incentive=policy.items.find(x=>x.code==='INC_KPI');
incentive.enabled=true;
incentive.method='percent';
incentive.rate=0.1;
incentive.gradeCodes=['JG05','JG06'];
let saved=await call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:policy});
assert.equal(saved.status,'draft');
assert.equal(saved.version,1);
assert.equal(saved.config.items.find(x=>x.code==='INC_KPI').gradeCodes.length,2);
const after=await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_KE'});
assert.equal(after.saved,true);
assert.equal(after.config.items.find(x=>x.code==='INC_KPI').rate,0.1);
assert.equal((await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_UG'})).saved,false);
const wrong=structuredClone(policy);
wrong.currency='UGX';
await assert.rejects(()=>call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:wrong}),/Country and currency/);
const illegal=structuredClone(policy);
illegal.items.find(x=>x.code==='KE_AHL').enabled=false;
await assert.rejects(()=>call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:illegal}),/Mandatory Kenya/);
const wronglyScoped=structuredClone(policy);
wronglyScoped.items.find(x=>x.code==='INC_KPI').gradeCodes=['FOREIGN_GRADE'];
await assert.rejects(()=>call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:wronglyScoped}),/job grades/);
await assert.rejects(()=>call('member','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:policy}),/permission/i);
console.log('HR compensation legal-entity policy and Kenya mandatory scenario passed');
