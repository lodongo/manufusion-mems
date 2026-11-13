import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mayDeferReplenishmentGl, requiresGlResolution } from './replenishmentGlException';

test('only organization super admin with active development override can defer blank GL', () => {
    assert.equal(mayDeferReplenishmentGl({ role: 'org_super_admin', testMode: true }, ''), true);
    assert.equal(mayDeferReplenishmentGl({ role: 'org_super_admin', testMode: true }, '  '), true);
    assert.equal(mayDeferReplenishmentGl({ role: 'org_super_admin', testMode: false }, ''), false);
    assert.equal(mayDeferReplenishmentGl({ role: 'org_user', testMode: true }, ''), false);
    assert.equal(mayDeferReplenishmentGl({ role: 'super_admin', testMode: true }, ''), false);
    assert.equal(mayDeferReplenishmentGl({ role: 'org_super_admin', testMode: true }, 'INVALID'), false);
});
test('outstanding deferred GL blocks acknowledgement until corrected', () => {
    assert.equal(requiresGlResolution([{ glResolutionRequired: true, glCode: '' }]), true);
    assert.equal(requiresGlResolution([{ glResolutionRequired: true, glCode: '  ' }]), true);
    assert.equal(requiresGlResolution([{ glResolutionRequired: true, glCode: 'GL400' }]), false);
    assert.equal(requiresGlResolution([{ glCode: '' }]), false);
});
