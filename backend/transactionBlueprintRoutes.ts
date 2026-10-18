import { orgRoute } from './guards';
import { wiredInventorySummary, wiredTransactionInventory } from './transactionRuntime';
import { plannedTransactionBlueprints } from './transactionBlueprints';

/** Read-only transaction design registry; never grants access. */
export const transactionBlueprintRoutes = {
  'POST /api/org/governance/blueprints/list': [
    orgRoute('org.governance.blueprints.list', 'ADM.workflows', async (ctx) => {
      const module = String(ctx.body.module ?? '').trim().toUpperCase();
      const kind = String(ctx.body.kind ?? '').trim();
      const items = plannedTransactionBlueprints().filter(x => (!module || x.module === module) && (!kind || x.kind === kind));
      const wiredEndpoints = wiredTransactionInventory(module);
      return { count: items.length, items, wiredEndpoints, wiredSummary: wiredInventorySummary(), notice: 'Installed organization endpoints receive stable platform-managed codes automatically. Reserved blueprint definitions are not installed and grant no new user permissions.' };
    }),
  ],
};
