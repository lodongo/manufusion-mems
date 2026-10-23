import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('legal-entity compensation drafts enforce Kenya statutory rules and grade scope',()=>{
 const result=spawnSync(process.execPath,
 ['--import','tsx','--import','./tests/helpers/maintenance-register.mjs','./tests/helpers/hr-compensation-scenario.mjs'],
 {cwd:process.cwd(),encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/HR compensation legal-entity policy and Kenya mandatory scenario passed/);
});
