import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canActivateEndpoint, validateEndpointMapping, type TransactionEndpointMapping } from './transactionEndpointMapping';

const good = ():TransactionEndpointMapping => ({
  method:'POST',route:'/api/org/procurement/po/approve',sourceFile:'backend/purchaseOrders.ts',
  canonicalCode:'PRC-PUR-AP',legacyPermission:'PRC.po.approve',
  classification:'approval_required',verification:'enforcement_verified',
  verifiedHandlerEvidenceId:'handler-test',permissionEvidenceId:'permission-test',
  scopeEvidenceId:'scope-test',sodEvidenceId:'sod-test',
  reviewer:'independent-reviewer',reviewedAt:'2026-10-18T00:00:00Z',
});
test('certification contract can accept complete evidence',()=>assert.equal(canActivateEndpoint(good()),true));
test('discovered routes are NOT certified',()=>assert.equal(canActivateEndpoint({...good(),verification:'route_discovered'}),false));
test('unclassified routes are NOT certified',()=>assert.equal(canActivateEndpoint({...good(),classification:'unclassified'}),false));
test('missing scope evidence blocks activation',()=>assert.ok(validateEndpointMapping({...good(),scopeEvidenceId:''}).length>0));
test('missing canonical mapping blocks activation',()=>assert.equal(canActivateEndpoint({...good(),canonicalCode:null}),false));
