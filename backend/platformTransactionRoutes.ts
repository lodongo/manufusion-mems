/**
 * Read-only MEMS platform Transaction Manager.
 * Route bindings are compiled from the actual server router on every boot.
 * Binding a handler NEVER assigns access to an employee or disables the route's
 * existing authentication, ownership, role, site or business workflow checks.
 */
import { staff } from './guards';
import { allSystemTransactions } from './transactionRuntime';

export const platformTransactionRoutes = {
  'POST /api/admin/transactions/list': [
    staff('admin.transactions.list','read',async ctx=>{
      const module=String(ctx.body.module??'').trim().toUpperCase();
      const search=String(ctx.body.search??'').trim().toLowerCase().slice(0,120);
      const all=allSystemTransactions();
      const modules=[...new Set(all.map(r=>r.module))].sort();
      const filtered=all.filter(r=>(!module||r.module===module)&&(!search||
        [r.code??'',r.name,r.path,r.module,r.area,r.permission??'',r.method]
          .join(' ').toLowerCase().includes(search)));
      const totals={
        wired:all.length,
        systemBound:all.filter(r=>r.bindingStatus==='system_bound'||r.guard==='staff').length,
        authenticated:all.filter(r=>r.guard==='organization').length,
        permissionGuarded:all.filter(r=>r.enforcement==='role_permission').length,
        selfService:all.filter(r=>r.enforcement==='authenticated_handler').length,
        staff:all.filter(r=>r.enforcement==='platform_staff').length,
        unguardedOrganization:all.filter(r=>r.bindingStatus==='unguarded_org').length,
      };
      return {modules,totals,count:filtered.length,items:filtered};
    }),
  ],
};
