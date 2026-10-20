import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FormulaError, QUICK, evaluate, parseFormula, toNumber } from '../../src/lib/tableFormula.ts';
import { MAX_GROUP_LEVELS, aggregate, allPaths, buildGroups, detectValueColumns, flatten } from '../../src/lib/tableGroups.ts';

const cols = { quantity: 'Quantity', price: 'Unit price', budget: 'Budget', actual: 'Actual' };
const resolve = (n) => Object.entries(cols).find(([, l]) => l.toLowerCase() === n.trim().toLowerCase())?.[0] ?? (cols[n] ? n : undefined);
const run = (expr, row) => evaluate(parseFormula(expr, resolve).node, (k) => toNumber(row[k]));

test('formulas: arithmetic, precedence, functions and column references', () => {
  const row = { quantity: 4, price: '1,250.50', budget: 200, actual: 150 };
  assert.equal(run('[Quantity] * [Unit price]', row), 5002);
  assert.equal(run('1 + 2 * 3', row), 7);
  assert.equal(run('(1 + 2) * 3', row), 9);
  assert.equal(run('-[Budget] + 10', row), -190);
  assert.equal(run('SUM([Budget], [Actual])', row), 350);
  assert.equal(run('AVG([Budget], [Actual])', row), 175);
  assert.equal(run('average([Budget], [Actual], 100)', row), 150);
  assert.equal(run('MIN([Budget], [Actual])', row), 150);
  assert.equal(run('MAX([Budget], [Actual])', row), 200);
  assert.equal(run('ROUND([Actual] / 7, 2)', row), 21.43);
  assert.equal(run('PCT([Actual], [Budget])', row), 75);
  assert.equal(run('ABS([Actual] - [Budget])', row), 50);
  assert.equal(run('COUNT([Budget], [Actual], [Quantity])', { budget: 1, actual: '', quantity: null }), 1);
});

test('formulas: empty cells count as 0 in arithmetic, are ignored by SUM/AVG, division by zero is empty', () => {
  assert.equal(run('[Budget] - [Actual]', { budget: 100, actual: '' }), 100);
  assert.equal(run('AVG([Budget], [Actual])', { budget: 100, actual: '' }), 100);
  assert.equal(run('[Budget] / [Actual]', { budget: 100, actual: 0 }), null);
  assert.equal(run('[Budget] + [Actual]', { budget: '', actual: '' }), null);
  assert.equal(run('PCT([Actual], [Budget])', { budget: 0, actual: 5 }), null);
});

test('formulas are parsed, never executed: unknown names, code and bad syntax are refused', () => {
  for (const bad of ['', '[Nope] + 1', 'alert(1)', 'constructor', '1 +', '(1 + 2', 'SUM(', 'ROUND(1,2,3)', '[Budget] ; 1', '<script>', '`x`', '1 $ 2', '__proto__']) {
    assert.throws(() => parseFormula(bad, resolve), FormulaError, bad);
  }
  assert.throws(() => parseFormula('1+'.repeat(200) + '1', resolve), FormulaError);
  assert.throws(() => parseFormula('('.repeat(60) + '1' + ')'.repeat(60), resolve), /nested/);
});

test('quick formulas build valid expressions', () => {
  for (const q of QUICK) {
    const expr = q.build(['[Budget]', '[Actual]'].slice(0, Math.max(q.min, 2)));
    assert.doesNotThrow(() => parseFormula(expr, resolve), q.id);
  }
  assert.equal(run(QUICK.find((q) => q.id === 'avg').build(['[Budget]', '[Actual]']), { budget: 10, actual: 20 }), 15);
});

test('number detection reads formatted amounts but not codes', () => {
  assert.equal(toNumber('KES 1,200.50'), 1200.5);
  assert.equal(toNumber('12%'), 12);
  assert.equal(toNumber('-3.5'), -3.5);
  assert.equal(toNumber('12 pcs'), null);
  assert.equal(toNumber('2026-10-20'), null);
  const columns = [
    { key: 'code', label: 'Account code' }, { key: 'amount', label: 'Amount' }, { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'date', label: 'Posted', type: 'date' }, { key: 'name', label: 'Name' }, { key: 'gl', label: 'GL' },
  ];
  const rows = [
    { code: '61201010', amount: '1,000', qty: 2, date: '2026-01-01', name: 'A', gl: '61201010' },
    { code: '61201020', amount: '250.5', qty: 3, date: '2026-01-02', name: 'B', gl: '61201020' },
  ];
  assert.deepEqual(detectValueColumns(columns, rows, (k, r) => r[k]), ['amount', 'qty']);
});

test('group by up to four levels with sum, simple average and count per group', () => {
  const rows = [
    { site: 'Nairobi', dept: 'Stores', type: 'A', amt: 100 },
    { site: 'Nairobi', dept: 'Stores', type: 'B', amt: 50 },
    { site: 'Nairobi', dept: 'Maint', type: 'A', amt: '' },
    { site: 'Mombasa', dept: 'Stores', type: 'A', amt: 30 },
    { site: '', dept: 'Stores', type: 'A', amt: 20 },
  ];
  const get = (k, r) => r[k];
  const tree = buildGroups(rows, ['site', 'dept', 'type', 'amt', 'extra'], ['amt'], get);
  assert.equal(MAX_GROUP_LEVELS, 4);
  assert.deepEqual(tree.map((g) => [g.value, g.totals.rows]), [['Nairobi', 3], ['Mombasa', 1], ['(empty)', 1]]);
  assert.deepEqual(tree[0].totals.values.amt, { sum: 150, avg: 75, n: 2 });
  assert.deepEqual(tree[0].children.map((g) => g.value), ['Stores', 'Maint']);
  // Four levels deep, never five.
  let depth = 0;
  for (let n = tree[0]; n; n = n.children[0]) depth++;
  assert.equal(depth, 4);
  // Collapsed shows top groups only; expanding shows children; leaf rows appear under the last level.
  assert.equal(flatten(tree, new Set()).length, 3);
  const open = new Set([tree[0].path]);
  assert.deepEqual(flatten(tree, open).map((i) => i.kind === 'group' ? i.node.value : 'row'), ['Nairobi', 'Stores', 'Maint', 'Mombasa', '(empty)']);
  const everything = flatten(tree, new Set(allPaths(tree)));
  assert.equal(everything.filter((i) => i.kind === 'row').length, rows.length);
  assert.deepEqual(aggregate(rows, ['amt'], get), { rows: 5, values: { amt: { sum: 200, avg: 50, n: 4 } } });
});

test('saved views keep groups and formulas, validated on the server', () => {
  const src = fs.readFileSync(new URL('../../backend/personalWorkspace.ts', import.meta.url), 'utf8');
  assert.match(src, /groupBy = \[\.\.\.new Set\(stringList\(raw\.groupBy\)\.filter\(\(v\) => IDENT\.test\(v\)\)\)\]\.slice\(0, 4\)/);
  assert.match(src, /raw\.formulas : \[\]\)\.filter\(isObj\)\.slice\(0, 6\)/);
  assert.match(src, /\^fx_\[A-Za-z0-9\]\{4,30\}\$/);
  const table = fs.readFileSync(new URL('../../src/components/RichTable.tsx', import.meta.url), 'utf8');
  assert.ok(!/\beval\(|new Function/.test(table + fs.readFileSync(new URL('../../src/lib/tableFormula.ts', import.meta.url), 'utf8')));
});
