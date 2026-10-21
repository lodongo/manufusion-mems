import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seed, snapshot, listDocs } from './maintenance-fixture.ts';
import { storage } from '../../backend/platform/sdk.ts';
import { drkmsRoutes } from '../../backend/drkmsRegistry.ts';
import { drkmsFileRoutes } from '../../backend/drkmsFiles.ts';
import { drkmsWorkflowRoutes } from '../../backend/drkmsWorkflow.ts';
import { drkmsSignatureRoutes } from '../../backend/drkmsSignatures.ts';
import { transactionPayloadHash } from '../../backend/unifiedApprovalProof.ts';

// Document handler end to end through the route handlers: template draft, upload with scanning off (released) and
// on (quarantined, no submission), release when scanning is off again, file access rules, sign-off, independent
// review, signature and the publication approval link bound to the exact revision.
const org = 'doc_fixture', r = 'organizations/' + org;
seed(r, { status: 'active', modules: { DOC: true }, domain: 'example.test' });
for (const [id, level, parentId] of [['LE', 'legal_entity', 'root'], ['SITE', 'site', 'LE'], ['OTHER', 'site', 'LE']])
    seed(r + '/structure/' + id, { code: id, name: id === 'SITE' ? 'Main plant' : id, level, parentId, status: 'active' });
const people = { author: 'UAUTHOR01', reviewer: 'UREVIEW01', signer: 'USIGNER01', outsider: 'UOUTSIDE1' };
for (const [k, uid] of Object.entries(people))
    seed('users/' + uid, { orgId: org, status: 'active', role: k === 'outsider' ? 'org_user' : 'org_super_admin', firstName: k, lastName: 'Fixture', email: k + '@example.test', assignments: [{ positionCode: 'X', nodeId: k === 'outsider' ? 'OTHER' : 'SITE', startsOn: '2020-01-01', endsOn: '' }] });
const ctx = (who, body) => {
    const uid = people[who];
    const outsider = who === 'outsider';
    const perms = outsider ? ['ADM.document_registry'] : ['ADM.*'];
    return { uid, orgId: org, role: outsider ? 'org_user' : 'org_super_admin', org: snapshot(r), me: snapshot('users/' + uid), permissions: perms, directPermissions: perms, grants: [], actor: { uid, email: who + '@example.test', role: 'x', orgId: org }, meta: { ip: 'test', userAgent: 'fixture' }, body, query: {}, claims: { email: who + '@example.test' } };
};
const all = { ...drkmsRoutes, ...drkmsFileRoutes, ...drkmsWorkflowRoutes, ...drkmsSignatureRoutes };
const call = (path, who, body = {}) => {
    const h = all['POST ' + path]?.[0];
    assert.ok(h, 'missing route ' + path);
    return h(ctx(who, body));
};
const rejects = async (p, re, label) => { await assert.rejects(p, (e) => (re.test(e.message) ? true : assert.fail(label + ': ' + e.message))); };

const objects = new Map();
storage.writeImmutable = async (items) => items.map((i) => (objects.has(i.path) ? false : (objects.set(i.path, i.content), true)));
storage.url = async (paths) => paths.map((path) => ({ path, url: objects.has(path) ? 'https://signed.example/' + path : '' }));
storage.read = async (path) => Buffer.from(objects.get(path) ?? '', 'base64');
const pdf = (text) => Buffer.from('%PDF-1.7\n' + text + '\n%%EOF').toString('base64');

// 1. Setup lists the templates and the scanning state (default: off).
const setup = await call('/api/org/drkms/setup', 'author');
assert.ok(setup.templates.some((t) => t.code === 'TPL-PRC' && t.sections.length >= 5), 'templates are offered');
assert.equal(setup.scanning.enabled, false, 'scanning is off until MEMS Admin turns it on');
await rejects(call('/api/org/drkms/documents/create-draft', 'author', { title: 'Wrong template', classCode: 'POL', scopeNodeId: 'SITE', templateCode: 'TPL-PRC' }), /template that matches/, 'template must match the class');
const { document } = await call('/api/org/drkms/documents/create-draft', 'author', { title: 'Preventive maintenance planning', classCode: 'PRC', scopeNodeId: 'SITE', templateCode: 'TPL-PRC' });
const id = document.documentId;
assert.equal(document.templateCode, 'TPL-PRC');
assert.ok(document.outline.includes('Procedure'));
let wf = await call('/api/org/drkms/documents/workflow', 'author', { documentId: id });
assert.equal(wf.steps[0].state, 'current');
assert.match(wf.steps[0].detail, /Upload/);
assert.ok(wf.document.outline.length >= 5 && wf.document.outline[0].guidance, 'outline with guidance');
await rejects(call('/api/org/drkms/documents/submit-review', 'author', { documentId: id }), /Upload the document file/, 'no file, no submission');
console.log('draft ok');

// 2. Scanning off: the upload is checked (header), fingerprinted, stored and released at once; audited.
await rejects(call('/api/org/drkms/files/stage', 'author', { documentId: id, mime: 'application/pdf', name: 'fake.pdf', data: Buffer.from('not a pdf').toString('base64') }), /does not match its declared format/, 'header check');
const first = await call('/api/org/drkms/files/stage', 'author', { documentId: id, mime: 'application/pdf', name: 'PM procedure.pdf', data: pdf('v1') });
assert.equal(first.scanStatus, 'not_required');
const stored = snapshot(`${r}/drkms_documents/${id}/files/${first.fileId}`).data;
assert.equal(stored.availability, 'verified');
assert.equal(stored.scanBypass, 'disabled_in_mems_admin');
assert.equal(stored.sha256, createHash('sha256').update(Buffer.from(pdf('v1'), 'base64')).digest('hex'));
// 3. Scanning on: the next upload waits in quarantine and blocks submission; it cannot be released by hand.
seed('system/drkms_scanning', { enabled: true, reason: 'Scanner live', version: 1 });
const second = await call('/api/org/drkms/files/stage', 'author', { documentId: id, mime: 'application/pdf', name: 'Appendix.pdf', data: pdf('appendix') });
assert.equal(second.scanStatus, 'pending');
await rejects(call('/api/org/drkms/documents/submit-review', 'author', { documentId: id }), /not released yet/, 'quarantined file blocks submission');
await rejects(call('/api/org/drkms/files/release', 'author', { documentId: id, fileId: second.fileId }), /scanning is on/i, 'no manual release while scanning is on');
await rejects(call('/api/org/drkms/files/open', 'author', { documentId: id, fileId: second.fileId }), /not released/, 'quarantined file cannot be opened');
// 4. Scanning off again: the author may release the waiting file (audited).
seed('system/drkms_scanning', { enabled: false, reason: 'Scanner maintenance', version: 2 });
await call('/api/org/drkms/files/release', 'author', { documentId: id, fileId: second.fileId });
assert.equal(snapshot(`${r}/drkms_documents/${id}/files/${second.fileId}`).data.scanStatus, 'not_required');
await rejects(call('/api/org/drkms/files/remove', 'author', { documentId: id, fileId: second.fileId, reason: 'x' }), /reason of 5/, 'removal needs a reason');
await call('/api/org/drkms/files/remove', 'author', { documentId: id, fileId: second.fileId, reason: 'Appendix belongs elsewhere' });
assert.ok(snapshot(`${r}/drkms_documents/${id}/removed_files/${second.fileId}`), 'removal kept as evidence');
console.log('scanning ok');

// 5. File access: the author opens released files; someone without a role on the document cannot.
assert.match((await call('/api/org/drkms/files/open', 'author', { documentId: id, fileId: first.fileId })).url, /^https:\/\/signed\.example\//);
await rejects(call('/api/org/drkms/files/open', 'outsider', { documentId: id, fileId: first.fileId }), /Only the author|outside your organizational/, 'outsider cannot open sources');
await rejects(call('/api/org/drkms/documents/workflow', 'outsider', { documentId: id }), /restricted|outside your organizational/, 'outsider cannot see the draft');
console.log('access ok');

// 6. Sign-off, submission and independent review.
await call('/api/org/drkms/signatures/assign', 'author', { documentId: id, signerUid: people.signer, label: 'Approved by', position: { page: 1, xPercent: 60, yPercent: 75, widthPercent: 35 } });
await call('/api/org/drkms/documents/submit-review', 'author', { documentId: id });
await rejects(call('/api/org/drkms/files/stage', 'author', { documentId: id, mime: 'application/pdf', name: 'late.pdf', data: pdf('late') }), /Only existing draft/, 'no uploads in review');
await rejects(call('/api/org/drkms/documents/review-decision', 'author', { documentId: id, decision: 'verify', reason: 'Looks fine to me' }), /cannot review their own/, 'no self-review');
wf = await call('/api/org/drkms/documents/workflow', 'reviewer', { documentId: id });
assert.equal(wf.can.review, true);
assert.match((await call('/api/org/drkms/files/open', 'reviewer', { documentId: id, fileId: first.fileId })).url, /signed\.example/, 'reviewer opens the source');
await call('/api/org/drkms/documents/review-decision', 'reviewer', { documentId: id, decision: 'verify', reason: 'Sections complete; procedure steps checked.' });
wf = await call('/api/org/drkms/documents/workflow', 'signer', { documentId: id });
assert.equal(wf.can.sign, true);
assert.equal(wf.steps.find((s) => s.key === 'signoff').state, 'current');
await call('/api/org/drkms/signatures/sign', 'signer', { documentId: id, slotId: wf.signatures[0].slotId, attest: true });
console.log('review ok');

// 7. Publication approval: the request must cover this exact revision; then it is linked to the document.
wf = await call('/api/org/drkms/documents/workflow', 'author', { documentId: id });
assert.equal(wf.can.requestApproval, true);
const packet = await call('/api/org/drkms/documents/approval-packet', 'author', { documentId: id });
assert.ok('transactionCode' in packet);
const approval = (name, payload, status = 'pending') => seed(`${r}/governance_approvals/${name}`, { id: name, orgId: org, code: 'DOC-X', handlerName: 'drkms.documents.publish', requestedBy: people.author, payloadHash: transactionPayloadHash(payload), status, steps: [], votes: [], createdAt: '2026-10-21T08:00:00Z' });
approval('approval-wrong', { ...packet.payload, contentFingerprint: '0'.repeat(64) });
await rejects(call('/api/org/drkms/documents/publication-request', 'author', { documentId: id, approvalId: 'approval-wrong' }), /does not cover this exact revision/, 'approval for other content');
approval('approval-right', packet.payload);
await call('/api/org/drkms/documents/publication-request', 'author', { documentId: id, approvalId: 'approval-right' });
wf = await call('/api/org/drkms/documents/workflow', 'author', { documentId: id });
assert.deepEqual([wf.publication.status, wf.publication.current, wf.can.publish], ['pending', true, false]);
approval('approval-right', packet.payload, 'approved');
wf = await call('/api/org/drkms/documents/workflow', 'author', { documentId: id });
assert.equal(wf.can.publish, true, 'publish once approved');
assert.equal(wf.steps.find((s) => s.key === 'approval').state, 'done');
const actions = (await listDocs(r + '/audit_events')).map((a) => String(a.data.action));
for (const a of ['drkms.file.staged_scan_off', 'drkms.file.quarantined', 'drkms.file.released_scan_off', 'drkms.file.removed', 'drkms.file.opened', 'drkms.document.publication_requested'])
    assert.ok(actions.includes(a), 'audited: ' + a);
console.log('approval ok');
console.log('document handler scenario passed');
