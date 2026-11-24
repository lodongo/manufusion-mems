import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

test('form defaults is an early visible step rather than a late planning accordion',()=>{
 const page=read('src/org/ProductionFoundation.tsx');
 const panel=read('src/org/PlnFormDefaultsPanel.tsx');
 const steps=read('src/org/plnSetupDependencies.ts');
 assert.match(page,/key:'formDefaults',label:'Form Defaults'/);
 assert.ok(page.indexOf("key:'formDefaults',label:'Form Defaults'")<page.indexOf("key:'skuSetup',label:'Product Configuration'"));
 assert.match(page,/active==='formDefaults'\?<PlnFormDefaultsPanel/);
 assert.match(page,/t\.key==='formDefaults'\|\|t\.key==='config'/);
 assert.match(steps,/formDefaults:\[\]/);
 assert.ok(!steps.includes("skuSetup:['formDefaults']"));
 assert.match(panel,/Save form defaults/);
 assert.match(panel,/expectedRevision:revision/);
 assert.match(panel,/onSaved\(result\.formDefaults,result\.revision\)/);
});
test('form default saves do not complete planning configuration or rewrite saved records',()=>{
 const backend=read('backend/plnMfgFoundation.ts');
 assert.match(backend,/'POST \/api\/org\/pln-mfg\/foundation\/form-defaults\/save'/);
 assert.match(backend,/formDefaultsRevision:revision/);
 assert.match(backend,/const revision=currentRevision\+1/);
 assert.match(backend,/formDefaultsRevision:num\(stored\.formDefaultsRevision\)\?\?0/);
 assert.match(backend,/const formDefaults=normalizePlanningFormDefaults\(prev\?\.data\.formDefaults\?\?raw\.formDefaults\)/);
 const readiness=read('src/org/plnSetupDependencies.ts');
 assert.match(readiness,/config:\{complete:input\.planningConfigurationRevision>0/);
 // Form defaults are optional: no configuration step depends on them.
 assert.match(readiness,/formDefaults:\[\],/);
 assert.doesNotMatch(readiness,/:\[[^\]]*'formDefaults'/);
});
