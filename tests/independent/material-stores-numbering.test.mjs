import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conformingStoresNumber, materialNumberKeys, storesNumberOf, storesNumberPlan } from '../../backend/materialLifecycleIds.ts';

// Three linked numbers: request (NWREQ/EXREQ), master data (MSTD) and the stores material number used in warehouses.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('stores numbers restore the classification or category scheme', () => {
    const classified = { accounting: { catalogueClassification: { numberingPattern: 'STR-MEC-BRG-{SEQ:06d}' } } };
    const p1 = storesNumberPlan({ categoryCode: 'MECH' }, classified);
    assert.deepEqual(p1, { prefix: 'STR-MEC-BRG', separator: '-', scheme: 'CLASSIFIED-SEQ6' });
    assert.equal(storesNumberOf(p1, 1), 'STR-MEC-BRG-000001');
    const p2 = storesNumberPlan({ categoryCode: 'mech-01' }, {});
    assert.deepEqual(p2, { prefix: 'MECH01', separator: '', scheme: 'CATEGORY-SEQ6' });
    assert.equal(storesNumberOf(p2, 12), 'MECH01000012');
    assert.throws(() => storesNumberPlan({}, {}), /category code/);
});

test('request and master numbers never count as stores numbers', () => {
    for (const bad of ['', 'MSTD_000000001', 'NWREQ_000000004', 'EXREQ_000000002', 'MAT-LX8-ABCDE', 'mech000012', 'MECH12'])
        assert.equal(conformingStoresNumber(bad), false, bad);
    for (const good of ['MECH000012', 'STR-MEC-BRG-000001', 'ELEC01000003']) assert.equal(conformingStoresNumber(good), true, good);
});

test('every number a material was known by resolves to it', () => {
    const keys = materialNumberKeys('NWREQ_000000004', { materialNumber: 'MECH000012', masterDataId: 'MSTD_000000001', previousMaterialNumber: 'MSTD_000000001', materialNumberAliases: ['MECH9'] });
    assert.deepEqual(keys, ['MECH000012', 'MSTD_000000001', 'NWREQ_000000004', 'MECH9']);
});

test('approval issues MSTD and stores numbers atomically; synchronising is controlled and audited', () => {
    const backend = read('backend/procurement.ts');
    assert.match(backend, /storesNumberPlan\(data,\(await load\('materials'\)\)\.items\.get\(str\(data\.materialCode\)\)/);
    assert.match(backend, /'POST \/api\/org\/procurement\/materials\/numbers\/check'/);
    assert.match(backend, /if\(!materialNumberSyncAllowed\(ctx\)\)throw new HttpError\(403/);
    assert.match(backend, /if\(str\(ctx\.body\.confirm\)!=='SYNCHRONISE'\)/);
    assert.match(backend, /audited\(ctx,'procurement\.material\.numbers\.sync'/);
    assert.match(read('backend/materialLifecycleIds.ts'), /precondition:counter\?\{updateTime:counter\.updateTime\}:\{exists:false\}/, 'the counter is compare-and-set');
});

test('returns go back to the requester with a reason and restart the workflow on resubmission', () => {
    const backend = read('backend/procurement.ts');
    assert.match(backend, /if\(!\['approve','reject','return'\]\.includes\(decision\)\)/);
    assert.match(backend, /if\(decision!=='approve'&&str\(ctx\.body\.comment\)\.trim\(\)\.length<10\)/);
    assert.match(backend, /status:'draft',returned:true,submittedAt:'',workflowCode:'',workflowSnapshot:null/);
    assert.match(backend, /'POST \/api\/org\/procurement\/materials\/extension\/resubmit'/);
    assert.match(backend, /Only the requester can resubmit or withdraw this extension request\./);
    assert.match(backend, /Say why the material is needed in this warehouse/);
});
