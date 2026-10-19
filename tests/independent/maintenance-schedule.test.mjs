import test from 'node:test';
import assert from 'node:assert/strict';
import { criticalPath, reconcileQuantities, safetyDeclaration, taskCompletion } from '../../backend/maintenanceDomain.ts';
const t = (id, hours, dependencies = [], offset = 0, personnel = []) => ({
    id,
    woCode: 'WO00000001',
    taskId: id,
    description: id,
    hours,
    dependencies,
    offset,
    personnel,
    tools: [],
    safety: false,
});
test('CPM finds the longest dependency path with parallel tasks and real float', () => {
    const r = criticalPath([t('A', 2), t('B', 5, ['A']), t('C', 1, ['A']), t('D', 1, ['B', 'C'])]);
    assert.equal(r.duration, 8);
    assert.deepEqual(r.criticalTaskIds, ['A', 'B', 'D']);
    assert.equal(r.tasks.find((t) => t.id === 'C').float, 4);
});
test('CPM recalculates durations, offsets, cycles and resource conflicts', () => {
    assert.equal(criticalPath([t('A', 2), t('B', 1, ['A'], 5)]).duration, 6);
    assert.throws(() => criticalPath([t('A', 1, ['B']), t('B', 1, ['A'])]), /cycle/);
    assert.throws(() => criticalPath([t('A', 1, ['missing'])]), /selected task/);
    assert.equal(criticalPath([t('A', 2, [], 0, ['person']), t('B', 2, [], 0, ['person'])]).conflicts.length, 1);
    assert.match(criticalPath([t('A', 3)], 2).conflicts.join(), /beyond/);
});
test('actual consumption is explicit and reconciles issued, returned and used quantities', () => {
    assert.deepEqual(reconcileQuantities(4, 3, 1), { consumed: 3, returned: 1 });
    assert.throws(() => reconcileQuantities(4, 4, 1), /must equal/);
    assert.throws(() => reconcileQuantities(4, -1, 5), /quantity/);
});
test('safety declaration and task feedback cannot be assumed', () => {
    assert.throws(() => safetyDeclaration({}), /explicit/);
    assert.throws(() => safetyDeclaration({ declaration: 'none' }), /Explicitly confirm/);
    safetyDeclaration({ declaration: 'none', noIncidentsConfirmed: true });
    assert.throws(() => taskCompletion({ services: [] }, {}), /workPerformed/);
});
