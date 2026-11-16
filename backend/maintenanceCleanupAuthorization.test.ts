import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cleanupGrantValid,CLEANUP_LIFETIME_MS} from './maintenanceCleanupAuthorization';
const token='a'.repeat(64),now=1700000000000;
const input={uid:'u',orgId:'o',authTime:42,token,modeVersion:3,modeEnabledAt:'v3',platformVersion:2,now};
const grant={enabled:true,uid:'u',orgId:'o',authTime:42,tokenHash:createHash('sha256').update(token).digest('hex'),modeVersion:3,modeEnabledAt:'v3',platformVersion:2,expiresAt:new Date(now+CLEANUP_LIFETIME_MS).toISOString()};
test('cleanup authorization requires a matching unexpired grant',()=>{
 assert.equal(cleanupGrantValid(grant,input),true);
 for(const bad of [{uid:'x'},{orgId:'x'},{authTime:43},{authTime:undefined},{token:''},{token:'b'.repeat(64)},{modeVersion:4},{platformVersion:3},{modeEnabledAt:'v4'},{now:now+CLEANUP_LIFETIME_MS}])assert.equal(cleanupGrantValid(grant,{...input,...bad}),false);
 assert.equal(cleanupGrantValid({...grant,enabled:false},input),false);
});
