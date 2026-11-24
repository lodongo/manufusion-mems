import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

// The development deployment may start only from a fully validated develop commit.
const dir=new URL('../../.github/workflows/',import.meta.url);
const workflows=readdirSync(dir).filter(f=>/\.ya?ml$/.test(f)).map(f=>[f,readFileSync(new URL(f,dir),'utf8')]);

test('only the green-gated validation job may start the development deployment',()=>{
    const starters=workflows.filter(([,text])=>/deploy-development\.yml/.test(text)&&/(dispatches|workflow run)/.test(text)).map(([f])=>f);
    assert.deepEqual(starters,['check.yml'],'no other workflow may dispatch deploy-development.yml');
    const deploy=workflows.find(([f])=>f==='deploy-development.yml')[1];
    assert.match(deploy,/^on:\s*\n\s*workflow_dispatch:\s*$/m,'the deployment itself never runs on push');
});

test('the deploy job waits for both the independent and the maintenance governance validation',()=>{
    const check=workflows.find(([f])=>f==='check.yml')[1];
    const job=check.slice(check.indexOf('deploy-on-green:'));
    assert.match(job,/needs: code-check/);
    assert.match(job,/context=="mems\/maintenance-phase2-validation"/);
    assert.match(job,/failure\|error\) echo "::error::Maintenance governance validation is \$state/);
    assert.ok(job.indexOf('Wait for maintenance governance validation')<job.indexOf('Dispatch the verified current develop branch'));
    assert.match(job,/Skipping stale CI commit/,'only the current develop head deploys');
    const maintenance=workflows.find(([f])=>f==='maintenance-phase2-validation.yml')[1];
    assert.match(maintenance,/context: 'mems\/maintenance-phase2-validation'/,'the maintenance workflow publishes the status the gate reads');
});
