import {useState} from 'react';
import CorporateBudgetPage from './CorporateBudgetPage';
import CorporateAllocationPage from './CorporateAllocationPage';
import CorporateIntercompanyPage from './CorporateIntercompanyPage';
import PoBudgetPilotPage from './PoBudgetPilotPage';
import {Screen,Segmented} from '../components/screen';

type Section='budget'|'allocation'|'intercompany'|'pilot';
/** Finance-facing entry point. Organization design stays under ADM.structure.
 * Each backend mutation still enforces scoped Finance maker/checker permissions and the Chart of Authority.
 */
export default function CorporateFinancialControlsPage({canEdit,canConfigurePilot}:{canEdit:boolean;canConfigurePilot:boolean}){
 const [section,setSection]=useState<Section>('budget');
 return <Screen title="Corporate Funding & Controls" subtitle={canEdit?'Requests go to independent Finance approval':'Read-only · Finance edit rights required to submit'}
  toolbar={<Segmented label="Corporate finance sections" value={section} onChange={setSection} options={[
   {value:'budget',label:'Budgets & Funding'},{value:'allocation',label:'Cost Allocation'},
   {value:'intercompany',label:'Intercompany'},{value:'pilot',label:'PO Budget Pilot'},
  ]}/>}>
  {section==='budget'?<CorporateBudgetPage canEdit={canEdit}/>:section==='allocation'?<CorporateAllocationPage canEdit={canEdit}/>
   :section==='pilot'?<PoBudgetPilotPage canEdit={canConfigurePilot}/>:<CorporateIntercompanyPage canEdit={canEdit}/>}
 </Screen>;
}
