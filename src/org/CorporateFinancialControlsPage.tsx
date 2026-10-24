import {useState} from 'react';
import {Calculator,Wallet} from 'lucide-react';
import CorporateBudgetPage from './CorporateBudgetPage';
import CorporateAllocationPage from './CorporateAllocationPage';

/** Finance-facing entry point. Organization design stays under ADM.structure.
 * Each backend mutation still enforces scoped Finance maker/checker permissions.
 */
export default function CorporateFinancialControlsPage({canEdit}:{canEdit:boolean}){
 const [section,setSection]=useState<'budget'|'allocation'>('budget');
 return <div className="min-w-0 space-y-4">
  <header className="rounded-2xl border border-line bg-panel p-4">
    <h2 className="text-lg font-bold">Corporate Funding, Budgets & Cost Allocation</h2>
    <p className="mt-2 text-sm text-muted">Legal-entity finance workspaces. Configuration and business approvals use existing FIN permissions and delegated authority, independent of Organization Design access.</p>
  </header>
  <div className="grid grid-cols-2 gap-2">
    <button type="button" className={'min-h-12 rounded-xl border border-line px-3 text-sm font-semibold '+(section==='budget'?'bg-brand/10 text-brand':'bg-panel text-muted')}
      onClick={()=>setSection('budget')}><Wallet className="mr-1 inline h-4 w-4"/>Budgets & Funding</button>
    <button type="button" className={'min-h-12 rounded-xl border border-line px-3 text-sm font-semibold '+(section==='allocation'?'bg-brand/10 text-brand':'bg-panel text-muted')}
      onClick={()=>setSection('allocation')}><Calculator className="mr-1 inline h-4 w-4"/>Cost Allocation</button>
  </div>
  {section==='budget'?<CorporateBudgetPage canEdit={canEdit}/>:<CorporateAllocationPage canEdit={canEdit}/>}
 </div>;
}
