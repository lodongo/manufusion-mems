import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('HR skill nominations require verified direct manager, allow peer endorsements, and protect personal records',()=>{
 const result=spawnSync(process.execPath,
   ['--import','tsx','--import','./tests/helpers/maintenance-register.mjs','./tests/helpers/hr-skills-scenario.mjs'],
   {cwd:process.cwd(),encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/HR skills and self-service scenario passed/);
});
