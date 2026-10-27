import {useEffect,useState} from 'react';
import {FileCheck2,ShieldCheck,RefreshCcw,LockKeyhole} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {SelectField} from '../components/ui';
import {useConfirm} from '../components/screen';

type Entity={id:string;code:string;name:string};
type GateStatus={
 mode:'off'|'service_pilot';legalEntityId:string;version:number;
 category:string;scope:string;activationDate:string;
 approvalRef:string;signedOffBy:string;developmentServerEnabled:boolean;
 affectsSelectedLegalEntity:boolean;note:string;
};
const field='min-h-11 w-full min-w-0 rounded-xl border border-line bg-page px-3 text-base text-ink';
const button='min-h-12 w-full rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-ink disabled:opacity-40';
export default function PoBudgetPilotPage({canEdit}:{canEdit:boolean}){
 const [entities,setEntities]=useState<Entity[]>([]);
 const [legalEntityId,setLegalEntityId]=useState('');
 const [policy,setPolicy]=useState<GateStatus|null>(null);
 const [mode,setMode]=useState<'off'|'service_pilot'>('off');
 const [date,setDate]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const {ask,sheet}=useConfirm();
 const message=(e:unknown)=>e instanceof Error?e.message:'The Finance action failed.';
 useEffect(()=>{void (async()=>{try{
  const r=await callBackend<{entities:Entity[]}>('/api/org/corporate/budget/options');
  setEntities(r.entities||[]);setLegalEntityId(r.entities?.[0]?.id||'');
 }catch(e){setError(message(e))}})()},[]);
 const refresh=async()=>{
  if(!legalEntityId)return;
  try{
   const r=await callBackend<GateStatus>('/api/org/corporate/po-budget/status',{legalEntityId});
   setPolicy(r);
   setMode(r.affectsSelectedLegalEntity?r.mode:'off');
   setDate(r.activationDate||new Date().toISOString().slice(0,10));
   setError('');
  }catch(e){setPolicy(null);setError(message(e))}
 };
 useEffect(()=>{void refresh()},[legalEntityId]);
 const submit=()=>{
  if(!policy||!legalEntityId)return;
  setError('');setNotice('');
  ask({title:mode==='service_pilot'?'Enable the service PO budget pilot?':'Disable the service PO budget pilot?',confirmLabel:'Submit for approval',
   message:'Effective '+date+'. The current policy stays in force until an independent Finance approver decides this request.',
   reason:{label:'Finance justification',minLength:10}},
   async reason=>{
    const response=await callBackend<{id:string}>('/api/org/corporate/po-budget/propose',{
     legalEntityId,mode,category:'OPEX',activationDate:date,expectedVersion:policy.version,reason,
    });
    setNotice('Finance request '+response.id+' submitted for independent approval. The existing policy has not changed.');
    await refresh();
   });
 };
 const otherEntityPilot=policy?.mode==='service_pilot'&&!policy.affectsSelectedLegalEntity;
 const blocked=!policy?'Loading the current policy…':otherEntityPilot?'Another legal entity owns the pilot.':!date?'Choose an effective date.':
  mode===policy.mode?'Choose a mode different from the current policy.':mode==='service_pilot'&&!policy.developmentServerEnabled?'The server rollout flag is disabled, so the pilot cannot be enabled.':'';
 return <section className="min-w-0 rounded-2xl border border-line bg-panel p-4 space-y-3">
  {sheet}
  <header className="space-y-2">
   <h3 className="flex items-center gap-2 text-lg font-bold">
    <LockKeyhole className="h-5 w-5 text-brand"/> Service PO budget pilot
   </h3>
   <p className="text-sm text-muted">Development-only pilot. Budget commitments apply only to approved OPEX service orders for the selected legal entity. Material, asset, payroll and maintenance flows are not covered.</p>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-line bg-danger/10 p-3 text-sm text-danger">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-brand">{notice}</p>}
  <SelectField id="p5-le" label="Legal entity" value={legalEntityId}
    onChange={e=>setLegalEntityId(e.target.value)}>
   <option value="">Select legal entity</option>
   {entities.map(e=><option value={e.id} key={e.id}>{e.name} ({e.code})</option>)}
  </SelectField>
  <div className="rounded-xl border border-line bg-page p-3 space-y-1">
   <p className="text-sm font-semibold">Current tenant policy: {policy?.mode==='service_pilot'?'Service pilot':'Off'}</p>
   <p className="text-xs text-muted">Configuration revision: {policy?.version??'—'} · Approval: {policy?.approvalRef||'No approved activation'}</p>
   <p className="text-xs text-muted">Scope: {policy?.legalEntityId||'Not configured'} · Date: {policy?.activationDate||'—'}</p>
   <p className="text-xs text-muted">Server rollout flag: {policy?.developmentServerEnabled?'Enabled on isolated development server':'Disabled — activation unavailable'}</p>
   {otherEntityPilot&&<p className="text-xs text-muted">A different legal entity currently owns this pilot. That policy must be disabled by an independently approved Finance request before changing its scope.</p>}
  </div>
  <SelectField id="p5-mode" label="Proposed mode" value={mode}
   disabled={!canEdit||!!otherEntityPilot}
   onChange={e=>setMode(e.target.value as 'off'|'service_pilot')}>
   <option value="off">Disable future service-PO budget reservations</option>
   <option value="service_pilot">Enable OPEX service-PO budget reservations</option>
  </SelectField>
  <label className="block text-sm text-muted">Effective date
   <input type="date" className={field} value={date}
    disabled={!canEdit} onChange={e=>setDate(e.target.value)}/>
  </label>
  <button type="button" className={button} onClick={()=>void refresh()} disabled={!legalEntityId}>
   <RefreshCcw className="mr-2 inline h-4 w-4"/>Refresh pilot status
  </button>
  {canEdit&&<button type="button" className={button}
   disabled={!legalEntityId||!!blocked} onClick={submit}>
    <FileCheck2 className="mr-2 inline h-4 w-4"/>Submit change for independent Finance approval
   </button>}
  {canEdit&&blocked&&<p className="text-xs text-muted">{blocked}</p>}
  <p className="flex gap-2 text-xs text-muted">
   <ShieldCheck className="h-4 w-4 shrink-0 text-brand"/>
   Approval follows the existing Finance FCR maker-checker workflow. Turning the pilot off stops new reservations but does not release or bypass existing controlled POs.
  </p>
  <p className="text-xs text-muted">Release gates: authenticated two-tenant Firestore lifecycle/concurrency tests, invoice/tax review, approved pilot activation and strict finance-period handling. No general-purpose spending-control claim is made.</p>
 </section>;
}
