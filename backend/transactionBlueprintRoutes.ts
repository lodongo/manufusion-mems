import { orgRoute } from './guards';
import { wiredInventorySummary, wiredTransactionInventory } from './transactionRuntime';
import { plannedTransactionBlueprints } from './transactionBlueprints';
import { existingPermissionCrosswalk, existingPermissionMappingSummary } from './existingPermissionCrosswalk';

/** Read-only transaction design registry; never grants access. */
export const transactionBlueprintRoutes = {
  'POST /api/org/governance/blueprints/list': [
    orgRoute('org.governance.blueprints.list', 'ADM.workflows', async (ctx) => {
      const module = String(ctx.body.module ?? '').trim().toUpperCase();
      const kind = String(ctx.body.kind ?? '').trim();
      const items = plannedTransactionBlueprints().filter(x => (!module || x.module === module) && (!kind || x.kind === kind));
      const existingPermissions = existingPermissionCrosswalk().filter(x=>!module||x.module===module);
      const wiredEndpoints = wiredTransactionInventory(module);
      return { count: items.length, items, wiredEndpoints, wiredSummary: wiredInventorySummary(), existingPermissions, mappingSummary: existingPermissionMappingSummary(), notice: 'All blueprint records are non-executable. Permission and activation require independently verified implementation and approved governance.' };
    }),
  ],
};
