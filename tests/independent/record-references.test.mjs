import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES, parseQuery, participantsOf, score, haystack, tokenOf } from '../../backend/recordSearch.ts';
import { recordTokenFor } from '../../backend/workflowActions.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const src = (t) => SOURCES.find((s) => s.type === t);

test('every module record type is searchable, with a link and a view rule', () => {
    for (const t of ['PR', 'PRQ', 'PO', 'VEN', 'INV', 'WR', 'WA', 'WO', 'MAT', 'PI', 'ADJ', 'AST', 'SOP']) {
        const s = src(t);
        assert.ok(s, t);
        assert.ok(s.link && s.linkLabel && typeof s.visible === 'function', t);
    }
    assert.equal(new Set(SOURCES.map((s) => s.type)).size, SOURCES.length);
});

test('query: type prefix narrows, words must all match, exact reference ranks first', () => {
    assert.deepEqual(parseQuery('po: acme'), { type: 'PO', q: 'acme' });
    assert.deepEqual(parseQuery('WO pump'), { type: 'WO', q: 'pump' });
    assert.deepEqual(parseQuery('pump seal'), { type: '', q: 'pump seal' });
    assert.deepEqual(parseQuery('PR'), { type: 'PR', q: '' });
    const po = src('PO');
    const d = { number: 'PO000123', vendorName: 'Acme Supplies', status: 'pending_approval' };
    assert.equal(score(po, 'PO000123', d, ['po000123'], 'po000123'), 100);
    assert.equal(score(po, 'PO000123', d, ['po000'], 'po000'), 60);
    assert.ok(score(po, 'PO000123', d, ['acme', 'pending'], 'acme pending') > 0);
    assert.equal(score(po, 'PO000123', d, ['acme', 'steel'], 'acme steel'), 0);
    assert.ok(haystack(po, 'PO000123', d).includes('acme supplies'));
});

test('participants are found from the record itself (requester, approvers, assignees, history)', () => {
    const p = participantsOf({ requesterUid: 'a', createdBy: 'b', approval: { steps: [{ by: 'c' }] }, history: [{ by: 'd' }], technicianUids: ['e'], name: 'not a uid field' });
    for (const u of ['a', 'b', 'c', 'd', 'e']) assert.ok(p.has(u), u);
    assert.ok(!p.has('not a uid field'));
});

test('stores a reader-agnostic token; previews and workflow actions carry it', () => {
    assert.equal(tokenOf('PO', 'PO1'), '[[PO:PO1]]');
    const ui = read('src/lib/recordRefs.ts');
    assert.ok(ui.includes('export const REF_RE = /\\[\\[([A-Z]{2,4}):([A-Za-z0-9_.-]{1,100})\\]\\]/g;'), 'same token pattern as the server');
    assert.ok(ui.includes("export const plainRefs = (text: string) => text.replace(REF_RE, '$1 $2');"));
    assert.equal(recordTokenFor('prc.order', 'PO000123'), '[[PO:PO000123]]');
    assert.equal(recordTokenFor('gov.approval', 'x'), '', 'no record card where there is no searchable record');
});

test('wiring: routes, chat # suggestions and picker, email record button and live cards, To-do cards, proportionate quick button', () => {
    const api = read('backend/recordSearch.ts');
    assert.ok(read('backend/index.ts').includes('...recordSearchRoutes,'));
    assert.ok(api.includes("action: 'records.search'"), 'searches are audited');
    assert.ok(api.includes("hidden: true"), 'records the reader may not see show no detail');
    const chat = read('src/org/ChatThread.tsx');
    assert.ok(chat.includes('useHashSuggestions(body)') && chat.includes("label: 'MEMS record'") && chat.includes('<RecordCards text={m.text} compact max={3} />'));
    const mail = read('src/org/OrgMail.tsx');
    assert.ok(mail.includes("aria-label='Link a MEMS record'") && mail.includes('withRecordTokens(safeReadHtml(') && mail.includes("aria-label='Linked MEMS records'"));
    assert.ok(read('src/org/UnifiedActions.tsx').includes('<RecordCards'));
    assert.ok(read('src/org/QuickActions.tsx').includes('<RecordCards'));
    const chip = read('src/components/UserChip.tsx');
    assert.ok(chip.includes("<Zap className='h-5 w-5' strokeWidth={2} />") && !chip.includes('animate-pulse'));
});
