import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceNavigate} from '../../src/lib/route.ts';

// The organization home hosts both maintenance workspaces; clicking a row must
// never leave it for the organization administration dashboard.
test('Work Assessment row opens selected assessment within organization home', () => {
    const prior = globalThis.window;
    try {
        globalThis.window = {location: {hash: '#/organization_home/work_assessments'}}; 
        workspaceNavigate('organization_admin/work_assessments/WR00000012');
        assert.equal(globalThis.window.location.hash, 'organization_home/work_assessments/WR00000012');
        workspaceNavigate('organization_admin/work_assessments');
        assert.equal(globalThis.window.location.hash, 'organization_home/work_assessments');
    } finally {
        if (prior === undefined) delete globalThis.window;
        else globalThis.window = prior;
    }
});

test('existing Work Request navigation continues to open inside organization home', () => {
    const prior = globalThis.window;
    try {
        globalThis.window = {location: {hash: '#/organization_home/work_requests'}};
        workspaceNavigate('organization_admin/work_requests/WR00000012');
        assert.equal(globalThis.window.location.hash, 'organization_home/work_requests/WR00000012');
    } finally {
        if (prior === undefined) delete globalThis.window;
        else globalThis.window = prior;
    }
});
