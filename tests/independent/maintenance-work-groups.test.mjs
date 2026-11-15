import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('Work Groups master mappings, numbering, exclusive staff and cost center membership',()=>{
 const result=spawnSync(process.execPath,['--import','tsx','--import','./tests/helpers/maintenance-register.mjs','./tests/helpers/maintenance-work-groups-scenario.mjs'],{cwd:process.cwd(),encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/work groups master and assignment scenario passed/);
});
