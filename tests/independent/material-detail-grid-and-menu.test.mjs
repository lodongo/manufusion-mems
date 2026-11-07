import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('Material detail: one menu button in the header, on every tab', () => {
    const ui = read('src/org/InventoryMaterialDetail.tsx');
    assert.equal((ui.match(/aria-label='Menu'/g) || []).length, 1, 'exactly one menu button is defined');
    assert.match(ui, /actions=\{\s*<>\s*\{actions\}\s*\{menuButton\}\s*<\/>\s*\}/, 'the menu sits beside the Edit / Save action in the always-visible bar');
    assert.match(ui, /onClick=\{\(\) => \(tab === 'Movements' \? setTableMenu\(true\) : setMenu\(true\)\)\}/, 'on Movements the same button opens the table menu');
    assert.match(ui, /function MenuSheet\(/);
    assert.match(ui, /MenuSection title='Needs attention'/);
    assert.match(ui, /MenuSection title='Key information'/);
    assert.match(ui, /MenuSection title='Notes'/);
    assert.match(ui, /MenuSection title='Actions'/);
    assert.match(ui, /MenuSection title='Display currency'/);
    assert.match(ui, /MenuSection title='Physical location'/);
    assert.match(ui, /MenuSection title='Field guide'/, 'field explanations are in the menu while editing, not under every input');
});

test('Material detail: notes and key information are no longer printed on the page', () => {
    const ui = read('src/org/InventoryMaterialDetail.tsx');
    for (const note of [
        'Chronological transaction record for this material and warehouse',
        'The Replenishment tab follows the strategy chosen here',
        'Prices are stored in their entered currency',
        'No journal entries yet. Use Opening stock at the top',
    ]) {
        const at = ui.indexOf(note);
        assert.ok(at > 0, `${note} is kept`);
        assert.match(ui.slice(Math.max(0, at - 90), at), /notes\.push\(/, `${note} is a menu note`);
    }
    assert.doesNotMatch(ui, /<ReplenishmentSummary/, 'the strategy summary lives in the menu');
    assert.match(ui, /<ReplenishmentInfo data=\{data\} metadata=\{metadata\} \/>/);
    assert.match(ui, /\{!loading && error && <Alert tone='error'>\{error\}<\/Alert>\}/, 'errors that need an answer stay visible');
    assert.match(ui, /compact\s*\/>/, 'inputs in the edit grid carry no inline hint');
});

test('Material detail: the boxes are a two-column grid that scrolls on its own', () => {
    const ui = read('src/org/InventoryMaterialDetail.tsx');
    const screen = read('src/components/screen.tsx');
    assert.match(ui, /grid grid-cols-2 \$\{gap\}/);
    assert.doesNotMatch(ui, /sm:grid-cols-2 lg:grid-cols-3/, 'no three-column layout');
    assert.match(ui, /className='h-full overflow-y-auto overscroll-contain py-2'/, 'the grid is its own scroll area');
    assert.match(ui, /<Screen[\s\S]*bodyFlush[\s\S]*toolbar=/, 'the page body does not scroll; header and tabs stay put');
    assert.match(screen, /bodyFlush = false/);
    assert.match(screen, /bodyFlush \? `min-h-0 flex-1 overflow-hidden/);
    assert.match(ui, /function FieldBox\(/);
    assert.match(ui, /aria-label=\{`Help: \$\{title\}`\}/, 'each box keeps its help, opened in a sheet');
    assert.match(ui, /dense=\{editing\}/, 'wide fields do not leave holes in the edit grid');
});

test('Material detail: Movements table uses the header menu and the full width', () => {
    const ui = read('src/org/InventoryMaterialDetail.tsx');
    const table = read('src/components/RichTable.tsx');
    assert.match(ui, /menuTop=\{menuBody\}\s+menuOpen=\{tableMenu\}\s+onMenuOpenChange=\{setTableMenu\}\s+hideMenuButton/);
    assert.match(ui, /height='h-full'/);
    assert.match(table, /menuOpen\?: boolean;/);
    assert.match(table, /onMenuOpenChange\?: \(open: boolean\) => void;/);
    assert.match(table, /hideMenuButton\?: boolean;/);
    assert.match(table, /const mobileToolsOpen = menuOpen \?\? toolsOpenLocal;/);
    assert.match(table, /\{!hideMenuButton && \(/);
    assert.match(table, /\$\{rows\.length === 1 \? 'row' : 'rows'\}/, '"1 row", not "1 rows"');
});

test('Material detail: saving, validation and audit paths are untouched', () => {
    const ui = read('src/org/InventoryMaterialDetail.tsx');
    assert.match(ui, /Object\.entries\(full\)\.filter\(\(\[k, v\]\) => String\(record\?\.\[k\] \?\? ''\) !== String\(v \?\? ''\)\)/);
    assert.match(ui, /callBackend<\{ ok: boolean; changed\?: number \}>\('\/api\/org\/inventory\/material\/update'/);
    assert.match(ui, /'\/api\/org\/inventory\/material\/bin\/link'/);
    assert.match(ui, /'\/api\/org\/inventory\/material\/bin\/unlink'/);
    assert.match(ui, /'\/api\/org\/inventory\/material\/opening-stock'/);
    assert.match(ui, /ask\(\s*\{\s*title: 'Link bin to material'/, 'linking a bin still asks for confirmation');
    // The menu closes before a confirmation opens so the two sheets never stack.
    assert.match(ui, /onLink=\{\(\) => \{\s*close\(\);\s*linkBin\(\);/);
    assert.match(ui, /onUnlink=\{\(\) => \{\s*close\(\);\s*unlinkBin\(\);/);
});
