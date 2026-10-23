import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('HR leave, privacy rules and manager approval are enforced server-side',()=>{
 const result=spawnSync(process.execPath,
 ['--import','tsx','--import','./tests/helpers/maintenance-register.mjs','./tests/helpers/hr-leave-scenario.mjs'],
 {cwd:process.cwd(),encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/HR leave privacy and manager approval scenario passed/);
});
