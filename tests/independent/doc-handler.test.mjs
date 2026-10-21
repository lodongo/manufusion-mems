import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileReleased } from '../../backend/drkmsScanPolicy.ts';
import { lifecycleSteps } from '../../backend/drkmsWorkflow.ts';
import { DOC_TEMPLATES } from '../../backend/docTemplates.ts';
import { ROLE_TEMPLATES } from '../../backend/permissionPolicy.ts';
import { linkRouteToBlueprint } from '../../backend/transactionCatalogue.ts';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('a source file is released only when scanned clean, or released while scanning was off in MEMS Admin', () => {
    assert.equal(fileReleased({ scanStatus: 'clean', availability: 'verified' }), true);
    assert.equal(fileReleased({ scanStatus: 'not_required', availability: 'verified', scanBypass: 'disabled_in_mems_admin' }), true);
    assert.equal(fileReleased({ scanStatus: 'not_required', availability: 'verified' }), false, 'a bypass must say who allowed it');
    assert.equal(fileReleased({ scanStatus: 'pending', availability: 'quarantined' }), false);
    assert.equal(fileReleased({ scanStatus: 'infected', availability: 'quarantined' }), false);
    assert.equal(fileReleased({ scanStatus: 'clean', availability: 'quarantined' }), false);
    assert.equal(fileReleased(null), false);
});

test('every gate that used the scan verdict now uses the single release rule', () => {
    for (const f of ['drkmsForms.ts', 'drkmsRead.ts', 'drkmsSignedExport.ts', 'drkmsSignatures.ts', 'drkmsPublish.ts', 'drkmsRegistry.ts', 'drkmsFiles.ts']) {
        const src = read('backend/' + f);
        assert.doesNotMatch(src, /scanStatus\)\s*[!=]==\s*'clean'/, f + ' must not test the scan verdict directly');
        assert.match(src, /fileReleased\(/, f + ' uses fileReleased');
    }
    const policy = read('backend/drkmsScanPolicy.ts');
    assert.match(policy, /staff\('admin\.drkms\.scanning\.set', 'super'/, 'only a MEMS super admin changes scanning');
    assert.match(policy, /reason\.length < 10/);
    assert.match(policy, /action: enabled \? 'drkms\.scanning\.enabled' : 'drkms\.scanning\.disabled'/, 'changes are audited');
});

test('lifecycle steps follow the document from draft to effective', () => {
    const base = { files: 1, filesWaiting: 0, slots: 1, slotsSigned: 0, approvalStatus: '', digital: false };
    const at = (status, extra = {}) => lifecycleSteps({ ...base, status, ...extra }).map((s) => s.state).join(',');
    assert.equal(at('draft', { files: 0 }), 'current,todo,todo,todo,todo');
    assert.match(lifecycleSteps({ ...base, status: 'draft', files: 0 })[0].detail, /Upload/);
    assert.equal(at('in_review'), 'done,current,todo,todo,todo');
    assert.equal(at('technical_verified'), 'done,done,current,todo,todo');
    assert.equal(at('technical_verified', { slotsSigned: 1 }), 'done,done,done,current,todo');
    assert.equal(at('technical_verified', { slotsSigned: 1, approvalStatus: 'approved' }), 'done,done,done,done,todo');
    assert.equal(at('technical_verified', { slotsSigned: 1, approvalStatus: 'rejected' }), 'done,done,done,blocked,todo');
    assert.equal(at('effective', { slotsSigned: 1, approvalStatus: 'executed' }), 'done,done,done,done,done');
    assert.equal(at('rejected'), 'blocked,todo,todo,todo,todo');
});

test('document templates are complete and map to registry classes; standard DOC roles exist', () => {
    const registry = read('backend/drkmsRegistry.ts');
    const classes = registry.match(/const classes = new Set\(\[([^\]]+)\]\)/)[1].match(/'([A-Z]{3})'/g).map((x) => x.slice(1, -1));
    assert.equal(new Set(DOC_TEMPLATES.map((t) => t.code)).size, DOC_TEMPLATES.length, 'unique template codes');
    for (const t of DOC_TEMPLATES) {
        assert.ok(!t.classCode || classes.includes(t.classCode), t.code + ' class');
        assert.ok(t.reviewMonths >= 1 && t.reviewMonths <= 120 && t.signOff.length >= 1 && t.purpose.length > 10, t.code);
        for (const s of t.sections) assert.ok(s.heading && s.guidance, t.code + ' section');
    }
    const roles = Object.fromEntries(ROLE_TEMPLATES.filter((r) => r.module === 'DOC').map((r) => [r.id, r.permissions]));
    assert.deepEqual(roles.doc_author, ['ADM.document_registry', 'ADM.document_publish']);
    assert.deepEqual(roles.doc_reviewer, ['ADM.document_registry', 'ADM.document_review']);
    assert.ok(!roles.doc_author.includes('ADM.document_review'), 'authors cannot review');
});

test('new DOC routes are guarded, audited and linked to transaction placeholders', () => {
    const files = read('backend/drkmsFiles.ts');
    for (const name of ['release', 'remove', 'open']) assert.match(files, new RegExp(`orgRoute\\('drkms\\.files\\.${name}','ADM\\.document_registry'`));
    assert.match(files, /record\(ctx,'drkms\.file\.released_scan_off'/);
    assert.match(files, /record\(ctx,'drkms\.file\.removed'/);
    assert.match(files, /record\(ctx,'drkms\.file\.opened'/);
    const wf = read('backend/drkmsWorkflow.ts');
    assert.match(wf, /orgRoute\('drkms\.documents\.workflow', 'ADM\.document_registry'/);
    assert.match(wf, /orgRoute\('drkms\.documents\.publication_request', 'ADM\.document_publish'/);
    for (const p of ['/api/org/drkms/files/release', '/api/org/drkms/files/remove', '/api/org/drkms/files/open', '/api/org/drkms/documents/workflow', '/api/org/drkms/documents/publication-request'])
        assert.ok(linkRouteToBlueprint({ path: p }), 'linked: ' + p);
});

test('documents screens: register table, start-here guide, template flow, lifecycle detail, settings and admin switch', () => {
    const page = read('src/org/DocumentRegistryPage.tsx');
    assert.match(page, /<DocumentList/);
    assert.match(page, /<DocumentDetail/);
    assert.match(page, /<NewDocumentSheet/);
    const list = read('src/org/docs/DocumentList.tsx');
    assert.match(list, /<RichTable<DocRow>/, 'rich table with search, filters, Excel and templates');
    assert.match(list, /How documents work — start here/);
    const detail = read('src/org/docs/DocumentDetail.tsx');
    for (const t of ['Overview', 'Files', 'Sign-off', 'Review', 'Publish', 'History']) assert.ok(detail.includes(`'${t}'`), t);
    assert.match(detail, /<Stepper steps=\{data\.steps\} \/>/);
    assert.match(detail, /Next step/);
    assert.match(read('src/admin/ModulesPage.tsx'), /module\?\.code === 'DOC' && <div className='mt-4'><DocScanningCard/);
    const home = read('src/org/OrgHomePage.tsx');
    assert.match(home, /\{label:'Documents',path:'doc_register'/);
    assert.match(home, /documentId=\{id \?\? ''\}/);
});

test('integration: template draft, scanning off/on, access, review, sign-off and publication approval through the route handlers', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/doc-handler-scenario.mjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 90000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr.split('\n').filter((l) => !/SECURITY_RATE_LIMIT_UNAVAILABLE|^\s+at |status: 404|^\}/.test(l)).join('\n'));
    for (const stage of ['draft ok', 'scanning ok', 'access ok', 'review ok', 'approval ok', 'document handler scenario passed']) assert.match(result.stdout, new RegExp(stage));
});
