import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('education level and grading rules are legal-entity scoped and employee records validated',()=>{
 const result=spawnSync(process.execPath,
 ['--import','tsx','--import','./tests/helpers/maintenance-register.mjs','./tests/helpers/hr-education-scenario.mjs'],
 {cwd:process.cwd(),encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/HR legal-entity education and grading scenario passed/);
});
