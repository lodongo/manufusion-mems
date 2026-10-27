import {useMemo,useState} from 'react';
import {callBackend} from '../lib/backend';
import RichTable,{type Column} from '../components/RichTable';
import {Alert} from '../components/ui';
import {Badge,Button,Card,Spinner,useLoad} from './kit';

type PostingRow={
 event:string;label:string;configuredState:'live'|'planned';handlerState:'live'|'planned'|'not_registered';
 installedRouteEvidence:boolean;registeredCodeCount:number;missingCodes:string[];
 determinationRegistered:boolean;codes:string[];via:string[];action:'RETAIN'|'REASSIGN_REVIEW'|'ADD_HANDLER';finding:string;
};
type MasterRow={
 kind:string;catalogueEvent:string;postingEvents:string[];state:'LIVE'|'CONDITIONAL'|'PLANNED'|'REVIEW_GAP';action:string;note:string;
};
type MntRow={code:string;label:string;workOrderPostingEvent:string;accountResolution:string;separateFinancialEvent:boolean};
type Report={
 summary:{registeredPostingEvents:number;livePostingEvents:number;plannedPostingEvents:number;
 retain:number;reassignReview:number;addHandler:number;catalogueEventLinks:number;
 crosswalkLive:number;crosswalkConditional:number;crosswalkPlanned:number;crosswalkGaps:number;
 breakdownMaintenanceFound:boolean;retireRecommended:number};
 postingRows:PostingRow[];catalogueMappings:MasterRow[];maintenanceStrategies:MntRow[];policyNotes:string[];
};
const postingColumns:Column<PostingRow>[]=[
 {key:'event',label:'Event code',value:r=>r.event,render:r=><span className='font-mono text-xs font-semibold'>{r.event}</span>},
 {key:'label',label:'Financial transaction',value:r=>r.label},
 {key:'state',label:'Registry / actual',value:r=>r.configuredState+' / '+r.handlerState,
  render:r=><div className='space-y-1 text-xs'><span>{r.configuredState} / {r.handlerState}</span><span className='block text-muted'>{r.installedRouteEvidence?'Installed route declared':'No active route evidence'}</span></div>},
 {key:'action',label:'Audit recommendation',value:r=>r.action,
  render:r=><Badge tone={r.action==='RETAIN'?'brand':r.action==='ADD_HANDLER'?'muted':'warn'}>{r.action.replace(/_/g,' ')}</Badge>},
 {key:'codes',label:'Predefined codes',value:r=>r.codes.join(', '),render:r=><span className='font-mono text-xs'>{r.codes.join(', ')}</span>},
 {key:'finding',label:'Finding',value:r=>r.finding,render:r=><span className='block max-w-[24rem] whitespace-normal text-xs'>{r.finding}</span>},
];
const crosswalkColumns:Column<MasterRow>[]=[
 {key:'kind',label:'Master',value:r=>r.kind},
 {key:'event',label:'Original master event',value:r=>r.catalogueEvent,render:r=><span className='font-mono text-xs'>{r.catalogueEvent}</span>},
 {key:'posted',label:'MEMS posting events',value:r=>r.postingEvents.join(', '),render:r=><span className='font-mono text-xs'>{r.postingEvents.join(', ')||'Not implemented'}</span>},
 {key:'state',label:'Runtime readiness',value:r=>r.state,render:r=><Badge tone={r.state==='LIVE'?'brand':r.state==='REVIEW_GAP'?'warn':'muted'}>{r.state.replace('_',' ')}</Badge>},
 {key:'action',label:'Action',value:r=>r.action},
 {key:'note',label:'Accounting constraint',value:r=>r.note,render:r=><span className='block max-w-[24rem] whitespace-normal text-xs'>{r.note}</span>}
];
const maintenanceColumns:Column<MntRow>[]=[
 {key:'strategy',label:'Maintenance strategy',value:r=>r.code+' '+r.label,render:r=><span className='text-sm'><span className='font-mono'>{r.code}</span> · {r.label}</span>},
 {key:'event',label:'GL transaction',value:r=>r.workOrderPostingEvent},
 {key:'determination',label:'GL determination',value:r=>r.accountResolution,render:r=><span className='block max-w-[32rem] whitespace-normal text-xs'>{r.accountResolution}</span>},
];
export default function FinanceTransactionAudit(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<Report>('/api/admin/transactions/audit',{}),[]);
 const [view,setView]=useState<'events'|'catalogues'|'maintenance'>('events');
 const rows=useMemo(()=>data?.postingRows??[],[data]);
 if(loading&&!data)return <Spinner/>;
 if(error||!data)return <Alert tone='error'>{error||'Could not read the financial transaction audit.'}</Alert>;
 const s=data.summary;
 return <div className='space-y-3'>
  <section className='rounded-xl border border-line p-3'>
   <div className='flex flex-wrap items-center justify-between gap-2'><div>
    <h3 className='font-semibold text-ink'>Predefined financial transactions · read-only audit</h3>
    <p className='text-xs text-muted'>Cross-checks Finance posting handlers, installed route declarations, reserved transaction codes, four master-catalogue financial events and the controlled maintenance strategy list.</p>
   </div><Button variant='secondary' onClick={reload}>Recheck registry</Button></div>
   <div className='mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4'>
    {([['Live events',s.livePostingEvents],['Planned events',s.plannedPostingEvents],['Reassign / review',s.reassignReview],['Master event gaps',s.crosswalkGaps]] as const).map(([label,value])=>
      <div key={label} className='rounded-lg bg-page p-3'><p className='text-xs text-muted'>{label}</p><p className='text-lg font-semibold text-ink'>{value}</p></div>)}
   </div>
   <p className='mt-2 text-xs text-muted'>Audit recommends {s.retain} retain, {s.addHandler} new handlers and {s.reassignReview} integration reviews. No built-in transaction is automatically removed. Breakdown Maintenance (MAI-006) {s.breakdownMaintenanceFound?'is in the controlled strategy list.':'is missing and must be restored before a strategy-specific mapping can be approved.'}</p>
  </section>
  <div className='flex flex-wrap gap-2'>
   <Button variant={view==='events'?'primary':'secondary'} onClick={()=>setView('events')}>GL posting events ({rows.length})</Button>
   <Button variant={view==='catalogues'?'primary':'secondary'} onClick={()=>setView('catalogues')}>Four-master GL crosswalk ({s.catalogueEventLinks})</Button>
   <Button variant={view==='maintenance'?'primary':'secondary'} onClick={()=>setView('maintenance')}>Maintenance strategies ({data.maintenanceStrategies.length})</Button>
  </div>
  {view==='events'&&<RichTable id='fin-transaction-event-audit' title='Existing and reserved posting handlers' rows={rows} columns={postingColumns} rowKey={r=>r.event} height='h-[30rem]' fileName='mems_fin_transaction_audit'/>}
  {view==='catalogues'&&<RichTable id='fin-crosswalk-audit' title='Universal master to Finance posting crosswalk' rows={data.catalogueMappings} columns={crosswalkColumns} rowKey={r=>r.kind+'-'+r.catalogueEvent} height='h-[30rem]' fileName='mems_catalogue_gl_crosswalk'/>}
  {view==='maintenance'&&<RichTable id='fin-mnt-audit' title='Maintenance strategy financial attribution' rows={data.maintenanceStrategies} columns={maintenanceColumns} rowKey={r=>r.code} height='h-[28rem]' fileName='mems_maintenance_finance_strategies'/>}
  <Card><h4 className='font-semibold text-ink'>Approval and retirement boundaries</h4>
   <ul className='mt-2 list-disc space-y-1 pl-5 text-sm text-muted'>
    {data.policyNotes.map(x=><li key={x}>{x}</li>)}
   </ul>
  </Card>
 </div>;
}
