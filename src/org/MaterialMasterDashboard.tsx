import { useMemo, useState } from 'react';
import { ArrowLeft, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { appConfirm, appPrompt } from '../components/dialogs';
import { Alert } from '../components/ui';
import { Badge, Button, Card, PageTitle, Spinner, useLoad } from '../admin/kit';

type Tab = 'approvals' | 'dashboard' | 'attributes' | 'warehouses' | 'availability' | 'history';

interface MaterialSummary {
    id:string; name:string; shortText:string; status:string;
    materialNumber:string; materialCode:string; categoryCode:string; subcategoryCode:string;
    familyCode:string; workflowStage:string; workflowCode:string;
    supplyType:string; uom:string; vendorId:string;
    oemPartNumber:string; ocmPartNumber:string; generalPartNumber:string;
    createdBy:string; createdAt:string; submittedAt:string; submittedBy:string; updatedAt:string;
    warehouseId:string; pushedAt:string; warehouseRestrictionCodes:string[];
    canEdit:boolean; canDelete:boolean; canSubmit:boolean; canApprove:boolean;
    canExtend:boolean; canLifecycle:boolean;testOverride:boolean;masterDataId:string;
}
interface WarehouseRow {
    warehouseId:string; warehouseName:string; warehouseCode:string;
    relation:'Created here'|'Extended'|'Existing mapping';
    status:string; requestedAt:string; approvedAt:string; requestId:string; requestedBy:string;
    mapped:boolean; accessible:boolean; canApprove?:boolean;
}
type AvailabilityRow = WarehouseRow & {
    ledgerState:'Tracked'|'Not tracked'|'Unreconciled'|'Unavailable'|'Restricted';
    physicalStock:number|null; reservedStock:number|null; quarantinedStock:number|null;
    damagedStock:number|null; expiredStock:number|null; otherStock:number|null;
    availableStock:number|null; onOrder:number|null; inTransit:number|null; journalEntries:number;
};
interface HistoryRow {
    id:string; at:string; action:string; by:string; details:string;
    origin:'Audit'|'Workflow'|'Record';
}
interface MaterialDashboardData {
    material:MaterialSummary;
    attributes:Array<{code:string;label:string;value:string;unit:string}>;
    warehouses:WarehouseRow[];
    availability:AvailabilityRow[];
    history:HistoryRow[];
    historyNote:string;ledgerNote:string;
    approvals:{
        requestId:string;masterDataId:string;code:string;name:string;
        approvalMode:string;approvalRule:string;
        steps:Array<{number:number;action:string;mode:string;assignee:string;
            decisions:Array<{decision:string;by:string;at:string;comment:string}>}>;
        extensions:Array<{requestId:string;warehouseId:string;warehouseName:string;
            status:string;canApprove:boolean;workflowCode:string;workflowStage:string;
            decisions:Array<{decision:string;by:string;at:string;comment:string;action:string;stepIndex:number}>}>;
    };
}
interface Props {
    id:string;
    onBack:()=>void;
    onChanged:()=>void;
    onEdit:(id:string)=>void;
    onExtend:(id:string)=>void;
}

const TABS:Array<{key:Tab;label:string}>=[
    {key:'approvals',label:'Approvals'},
    {key:'dashboard',label:'Dashboard'},
    {key:'attributes',label:'Attributes'},
    {key:'warehouses',label:'Warehouses'},
    {key:'availability',label:'Availability'},
    {key:'history',label:'History'},
];
const showDate=(date:string)=>date?new Date(date).toLocaleString():'—';
const number=(value:number|null|undefined)=>value===null||value===undefined?'—':value.toLocaleString(undefined,{maximumFractionDigits:3});
const textOrDash=(value:string|undefined)=>value?.trim()||'—';
const description=(status:string)=>status.replaceAll('_',' ');

function Fact({label,value}: {label:string;value:string|number|null|undefined}) {
    return <div className='min-w-0 border-b border-line/60 py-2'>
        <dt className='text-xs text-muted'>{label}</dt>
        <dd className='mt-1 break-words text-sm font-medium text-ink'>{value===null||value===undefined||value===''?'—':value}</dd>
    </div>;
}

function Metric({label,value,note}: {label:string;value:string;note?:string}) {
    return <div className='min-w-0 rounded-xl border border-line bg-page p-3'>
        <p className='text-xs text-soft'>{label}</p>
        <p className='mt-1 break-words text-xl font-semibold tabular-nums text-ink'>{value}</p>
        {note&&<p className='mt-1 text-xs text-muted'>{note}</p>}
    </div>;
}

export default function MaterialMasterDashboard({id,onBack,onChanged,onEdit,onExtend}:Props) {
    const {data,loading,error,reload}=useLoad(()=>
        callBackend<MaterialDashboardData>('/api/org/procurement/materials/dashboard',{id}));
    const [tab,setTab]=useState<Tab>('approvals');
    const [busy,setBusy]=useState(false);
    const [failure,setFailure]=useState('');
    const m=data?.material;
    const published=useMemo(()=>data?.warehouses.filter(x=>x.mapped)??[],[data]);
    const pending=useMemo(()=>data?.warehouses.filter(x=>x.relation==='Extended'&&!x.mapped&&x.status.toLowerCase()==='pending approval')??[],[data]);
    const tracked=useMemo(()=>data?.availability.filter(x=>x.ledgerState==='Tracked')??[],[data]);
    const availableTotal=tracked.reduce((n,x)=>n+(x.availableStock||0),0);
    const incomplete=(data?.availability??[]).some(x=>x.mapped&&x.ledgerState!=='Tracked');
    const headerTitle=m?.name||'Material dashboard';
    const run=async (doWork:()=>Promise<unknown>,close=false)=>{
        setBusy(true);setFailure('');
        try{
            await doWork();
            onChanged();
            if(close)onBack();
            else reload();
        }catch(e){setFailure(e instanceof Error?e.message:'Unable to complete material action.');}
        finally{setBusy(false);}
    };
    const decision=(choice:'approve'|'reject')=>{
        if(!m?.canApprove)return;
        void (async()=>{
            const comment=choice==='reject'?await appPrompt('Reason for rejection (at least 10 characters)'):'';
            if(choice==='reject'&&!comment)return;
            if(choice==='approve'&&!await appConfirm('Complete the assigned workflow stage for '+m.name+'?'))return;
            await run(()=>callBackend('/api/org/procurement/materials/approve',{id,decision:choice,comment}));
        })();
    };
    const extensionDecision=(w:WarehouseRow,choice:'approve'|'reject')=>{
        if(!w.canApprove||!w.requestId)return;
        void (async()=>{
            const comment=choice==='reject'?await appPrompt('Reason for rejecting the extension (at least 10 characters)'):'';
            if(choice==='reject'&&!comment)return;
            if(choice==='approve'&&!await appConfirm('Approve extension to '+w.warehouseName+'?'))return;
            await run(()=>callBackend('/api/org/procurement/materials/extension/approve',{
                id:w.requestId,decision:choice,comment,
            }));
        })();
    };
    const draftAction=(choice:'submit'|'delete')=>{
        if(choice==='submit'&&!m?.canSubmit)return;
        if(choice==='delete'&&!m?.canDelete)return;
        void (async()=>{
            const okay=await appConfirm(choice==='delete'?
                'Delete the unsubmitted draft '+m!.name+'? Its audit history will be preserved.':
                'Submit '+m!.name+' for approval under PRC-001? Draft editing and deletion will be locked.');
            if(!okay)return;
            await run(()=>callBackend('/api/org/procurement/materials/'+choice,{id}),choice==='delete');
        })();
    };
    const lifecycle=(action:'disable'|'delete')=>{
        if(!m?.canLifecycle)return;
        void (async()=>{
            if(!await appConfirm(
                (action==='delete'?'Delete the approved material':'Disable material')
                +' '+m.name+'?'))return;
            await run(()=>callBackend('/api/org/procurement/materials/lifecycle',{id,action}),action==='delete');
        })();
    };

    return <div className='space-y-4 pb-12'>
        <PageTitle title={headerTitle} subtitle={
            (m?.masterDataId||m?.materialNumber||'Pending MSTD approval')+' · '+(m?.shortText||'Organization Materials Master')
        } action={<div className='flex gap-2'>
            <Button variant='secondary' onClick={onBack}><ArrowLeft className='h-4 w-4'/> Materials</Button>
            <Button variant='secondary' onClick={reload} disabled={busy}><RefreshCw className='h-4 w-4'/> Refresh</Button>
        </div>}/>
        {failure&&<Alert tone='error'>{failure}</Alert>}
        {error&&<Alert tone='error'>{error}</Alert>}
        {loading&&!data&&<Spinner/>}
        {m&&data&&<>
            <Card className='space-y-3'>
                <div className='flex flex-wrap items-center gap-2'>
                    <Badge tone={m.status==='active'||m.status==='approved'?'brand':m.status==='pending_approval'?'warn':'muted'}>{description(m.status)}</Badge>
                    {m.workflowStage&&<span className='text-xs text-soft'>{m.workflowStage}</span>}
                    <span className='ml-auto text-xs text-muted'>Request: {m.id} · Master: {m.masterDataId||'Not approved'}</span>
                </div>
                <div>
                    <h2 className='text-sm font-semibold text-ink'>Material actions</h2>
                    <p className='mt-1 text-xs text-muted'>Only operations authorized for your security role and the current material status are shown.</p>
                </div>
                <div className='flex flex-wrap gap-2'>
                    {m.canEdit&&<Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={()=>onEdit(id)}><Pencil className='h-4 w-4'/> Edit draft</Button>}
                    {m.canDelete&&<Button testOverride={m.testOverride} variant='danger' disabled={busy} onClick={()=>draftAction('delete')}><Trash2 className='h-4 w-4'/> Delete draft</Button>}
                    {m.canSubmit&&<Button testOverride={m.testOverride} disabled={busy} onClick={()=>draftAction('submit')}>Submit for approval</Button>}
                    {m.canApprove&&<Button testOverride={m.testOverride} disabled={busy} onClick={()=>decision('approve')}>{!data.approvals.steps.length&&m.testOverride?'Approve · test recovery':m.workflowStage.startsWith('Review')?'Complete review':'Approve request'}</Button>}
                    {m.canApprove&&<Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={()=>decision('reject')}>Reject request</Button>}
                    {m.canExtend&&<Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={()=>onExtend(id)}><Plus className='h-4 w-4'/> Extend to warehouse</Button>}
                    {m.canLifecycle&&['approved','active'].includes(m.status)&&<Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={()=>lifecycle('disable')}>Disable</Button>}
                    {m.canLifecycle&&m.status==='approved'&&!m.pushedAt&&<Button testOverride={m.testOverride} variant='danger' disabled={busy} onClick={()=>lifecycle('delete')}>Delete approved material</Button>}
                </div>
            </Card>
            <div role='tablist' aria-label='Material dashboard sections'
                className='-mx-1 flex gap-1 overflow-x-auto overscroll-x-contain rounded-xl bg-panel p-1'>
                {TABS.map(x=><button type='button' role='tab' key={x.key}
                    aria-selected={tab===x.key} onClick={()=>setTab(x.key)}
                    className={'min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium '+(
                        tab===x.key?'bg-brand text-onbrand':'text-soft hover:bg-page'
                    )}>{x.label}</button>)}
            </div>
            <div role='tabpanel' className='space-y-4'>
                {tab==='approvals'&&<div className='space-y-3'>
                    <Card className='space-y-3'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <h2 className='font-semibold text-ink'>Material creation · {data.approvals.requestId}</h2>
                            <Badge tone={m.status==='approved'||m.status==='active'?'brand':m.status==='pending_approval'?'warn':'muted'}>{description(m.status)}</Badge>
                        </div>
                        <dl className='grid gap-x-5 sm:grid-cols-2'>
                            <Fact label='Creation request ID' value={data.approvals.requestId}/>
                            <Fact label='Approved master data ID' value={data.approvals.masterDataId||'Assigned at final approval'}/>
                            <Fact label='Approval workflow' value={data.approvals.name||data.approvals.code||(m.status==='pending_approval'?(m.testOverride?'Test recovery · PRC-001':'Snapshot missing'):'Not yet submitted')}/>
                            <Fact label='Execution and threshold' value={[data.approvals.approvalMode,data.approvals.approvalRule].filter(Boolean).join(' · ')}/>
                            <Fact label='Current stage' value={m.workflowStage||description(m.status)}/>
                            <Fact label='Submitted' value={showDate(m.submittedAt)}/>
                        </dl>
                        {m.canApprove&&<div className='flex flex-wrap gap-2 border-t border-line pt-3'>
                            <Button testOverride={m.testOverride} disabled={busy} onClick={()=>decision('approve')}>{m.workflowStage.startsWith('Review')?'Complete review':'Approve request'}</Button>
                            <Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={()=>decision('reject')}>Reject request</Button>
                        </div>}
                        {m.testOverride&&<p className='text-xs text-blue-300'>Development test mode · blue-bordered actions can bypass workflow assignment and maker–checker. All bypassed controls are audited.</p>}
                        {!data.approvals.steps.length&&m.status==='pending_approval'&&
                            (m.testOverride?
                                <Alert tone='info'>This older request has no workflow snapshot. In development test mode, Approve or Reject performs an audited one-step recovery without recreating the request. Normal approval rules remain enforced outside test mode.</Alert>:
                                <Alert tone='warn'>This request has no valid workflow snapshot. Ask a workflow administrator to resolve it under PRC-001. The normal maker–checker requirement remains active.</Alert>)}
                        {data.approvals.steps.length>0&&<div className='space-y-2 border-t border-line pt-3'>
                            <h3 className='text-sm font-semibold text-ink'>Configured approval stages</h3>
                            {data.approvals.steps.map(step=><div key={step.number} className='rounded-xl border border-line bg-page p-3'>
                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <p className='text-sm font-medium text-ink'>{step.number}. {step.action==='review'?'Review':'Approval'} · {step.assignee}</p>
                                    <Badge tone={step.decisions.some(d=>d.decision==='approve')?'brand':'muted'}>
                                        {step.decisions.length?description(step.decisions[step.decisions.length-1].decision):'Awaiting decision'}
                                    </Badge>
                                </div>
                                {step.decisions.map((d,i)=><p key={i} className='mt-2 text-xs text-soft'>{showDate(d.at)} · {d.by||'Unknown actor'} · {description(d.decision)}{d.comment?' · '+d.comment:''}</p>)}
                            </div>)}
                        </div>}
                    </Card>
                    {data.approvals.extensions.length>0&&<Card className='space-y-3'>
                        <h2 className='font-semibold text-ink'>Warehouse extension approvals</h2>
                        {data.approvals.extensions.map(ext=><div key={ext.requestId} className='space-y-2 border-b border-line pb-3'>
                            <div className='flex flex-wrap items-start justify-between gap-2'>
                                <div>
                                    <p className='font-semibold text-ink'>{ext.warehouseName}</p>
                                    <p className='text-xs text-muted'>{ext.requestId} · {ext.workflowCode||'PRC-002'}</p>
                                    <p className='text-xs text-soft'>{ext.workflowStage}</p>
                                </div>
                                <Badge tone={ext.status.toLowerCase()==='approved'?'brand':ext.status.toLowerCase().includes('pending')?'warn':'muted'}>{ext.status}</Badge>
                            </div>
                            {ext.canApprove&&<div className='flex flex-wrap gap-2'>
                                <Button testOverride={m.testOverride} disabled={busy} onClick={()=>{
                                    const target=data.warehouses.find(w=>w.requestId===ext.requestId);
                                    if(target)extensionDecision(target,'approve');
                                }}>Approve extension</Button>
                                <Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={()=>{
                                    const target=data.warehouses.find(w=>w.requestId===ext.requestId);
                                    if(target)extensionDecision(target,'reject');
                                }}>Reject extension</Button>
                            </div>}
                            {ext.decisions.map((d,i)=><p key={i} className='text-xs text-muted'>{showDate(d.at)} · {d.action||'Workflow'} · {description(d.decision)} · {d.by}{d.comment?' · '+d.comment:''}</p>)}
                        </div>)}
                    </Card>}
                </div>}
                {tab==='dashboard'&&<>
                    <div className='grid grid-cols-2 gap-2 lg:grid-cols-4'>
                        <Metric label='Published warehouses' value={String(published.length)} note='Original and extensions'/>
                        <Metric label='Pending extensions' value={String(pending.length)} note='Awaiting approval'/>
                        <Metric label='Available across accessible warehouses'
                            value={tracked.length?number(availableTotal):'—'}
                            note={incomplete?'Partial — some balances unavailable':tracked.length?'Reconciled stock only':'No tracked stock'}/>
                        <Metric label='Warehouse stock ledgers' value={tracked.length+' / '+published.length}
                            note='Published warehouses with reconciled balances'/>
                    </div>
                    <Card className='space-y-3'>
                        <h2 className='font-semibold text-ink'>Material overview</h2>
                        <dl className='grid gap-x-5 sm:grid-cols-2'>
                            <Fact label='Description' value={m.shortText}/>
                            <Fact label='Material code' value={m.materialCode}/>
                            <Fact label='Material master ID' value={m.masterDataId||m.materialNumber}/>
                            <Fact label='Creation request ID' value={m.id}/>
                            <Fact label='Classification' value={[m.categoryCode,m.subcategoryCode,m.familyCode].filter(Boolean).join(' / ')}/>
                            <Fact label='Unit of measure' value={m.uom}/>
                            <Fact label='Supply relationship' value={m.supplyType}/>
                            <Fact label='Part number' value={m.oemPartNumber||m.ocmPartNumber||m.generalPartNumber}/>
                            <Fact label='Created' value={showDate(m.createdAt)}/>
                            <Fact label='Workflow status' value={m.workflowStage||description(m.status)}/>
                            <Fact label='Original warehouse' value={data.warehouses.find(w=>w.relation==='Created here')?.warehouseName||m.warehouseId}/>
                        </dl>
                    </Card>
                    {pending.length>0&&<Alert tone='info'>Pending warehouse extensions are not included in published availability until approved.</Alert>}
                </>}
                {tab==='attributes'&&<Card className='space-y-3'>
                    <h2 className='font-semibold text-ink'>Classification and technical attributes</h2>
                    <dl className='grid gap-x-5 sm:grid-cols-2'>
                        <Fact label='Category' value={m.categoryCode}/>
                        <Fact label='Subcategory' value={m.subcategoryCode}/>
                        <Fact label='Family' value={m.familyCode}/>
                        <Fact label='Reference material' value={m.materialCode}/>
                        <Fact label='UoM' value={m.uom}/>
                        <Fact label='Supply type' value={m.supplyType}/>
                        <Fact label='Warehouse restrictions' value={m.warehouseRestrictionCodes.join(', ')}/>
                        <Fact label='Part number' value={m.oemPartNumber||m.ocmPartNumber||m.generalPartNumber}/>
                    </dl>
                    <div className='border-t border-line pt-3'>
                        <h3 className='mb-2 text-sm font-semibold text-ink'>Material attributes from master data</h3>
                        {data.attributes.length?
                            <dl className='grid gap-x-5 sm:grid-cols-2'>
                                {data.attributes.map(a=><Fact key={a.code} label={a.label} value={a.value+(a.unit?' '+a.unit:'')}/>)}
                            </dl>:
                            <p className='text-sm text-muted'>No technical attribute values have been saved for this material.</p>}
                    </div>
                </Card>}
                {tab==='warehouses'&&<div className='space-y-3'>
                    <p className='text-sm text-soft'>Original warehouse and all recorded warehouse extensions. Pending, rejected, and approved requests remain visible.</p>
                    {data.warehouses.length?data.warehouses.map(w=><Card key={w.warehouseId} className='space-y-2'>
                        <div className='flex flex-wrap items-start justify-between gap-2'>
                            <div className='min-w-0'>
                                <p className='font-semibold text-ink'>{w.warehouseName}</p>
                                <p className='text-xs text-muted'>{w.warehouseCode} · {w.relation}</p>
                            </div>
                            <Badge tone={w.mapped?'brand':w.status.toLowerCase().includes('pending')?'warn':'muted'}>
                                {w.mapped?'Published':w.status||'Not published'}
                            </Badge>
                        </div>
                        <dl className='grid gap-x-4 sm:grid-cols-2'>
                            <Fact label='Workflow state' value={w.status}/>
                            <Fact label='Created / extension requested' value={showDate(w.requestedAt)}/>
                            <Fact label='Approved' value={showDate(w.approvedAt)}/>
                            <Fact label='Request ID' value={w.requestId}/>
                            <Fact label='Requested by' value={w.requestedBy}/>
                            <Fact label='Availability visibility' value={w.accessible?'Within my warehouse scope':'Outside my warehouse scope'}/>
                        </dl>
                    </Card>):<Card>No warehouse association recorded.</Card>}
                </div>}
                {tab==='availability'&&<div className='space-y-3'>
                    <p className='text-sm text-soft'>{data.ledgerNote} Quantities are shown only for warehouses you can access; pending extensions do not provide stock availability.</p>
                    {data.availability.length?data.availability.map(w=><Card key={w.warehouseId} className='space-y-3'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <div>
                                <p className='font-semibold text-ink'>{w.warehouseName}</p>
                                <p className='text-xs text-muted'>{w.relation} · {w.status}</p>
                            </div>
                            <Badge tone={w.ledgerState==='Tracked'?'brand':w.ledgerState==='Unreconciled'?'warn':'muted'}>{w.ledgerState}</Badge>
                        </div>
                        {w.ledgerState==='Tracked'?<>
                            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                                <Metric label='Available' value={number(w.availableStock)}/>
                                <Metric label='Physical stock' value={number(w.physicalStock)}/>
                                <Metric label='Reserved' value={number(w.reservedStock)}/>
                                <Metric label='Quarantined' value={number(w.quarantinedStock)}/>
                                <Metric label='Damaged' value={number(w.damagedStock)}/>
                                <Metric label='Expired' value={number(w.expiredStock)}/>
                                <Metric label='On order' value={number(w.onOrder)}/>
                                <Metric label='In transit' value={number(w.inTransit)}/>
                                <Metric label='Other unavailable' value={number(w.otherStock)}/>
                            </div>
                            <p className='text-xs text-muted'>{w.journalEntries} reconciled posted journal entries · UoM {textOrDash(m.uom)}</p>
                        </>:<p className='text-sm text-muted'>{w.ledgerState==='Restricted'?'This warehouse is outside your read scope.':w.ledgerState==='Unavailable'?'The material is not yet published to this warehouse.':w.ledgerState==='Unreconciled'?'One or more journal entries are unreconciled or the journal result is incomplete. Quantities are withheld.':'No posted stock ledger has been recorded for this warehouse.'}</p>}
                    </Card>):<Card>No warehouse availability records.</Card>}
                </div>}
                {tab==='history'&&<div className='space-y-3'>
                    <p className='text-sm text-soft'>{data.historyNote}</p>
                    {data.history.length?data.history.map(h=><Card key={h.id} className='space-y-1'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <p className='text-sm font-semibold text-ink'>{h.action}</p>
                            <span className='text-xs tabular-nums text-soft'>{showDate(h.at)}</span>
                        </div>
                        <p className='break-words text-xs text-soft'>{h.by||'System / actor not recorded'} · {h.origin}</p>
                        {h.details&&<p className='break-words text-sm text-muted'>{h.details}</p>}
                    </Card>):<Card>No material history recorded.</Card>}
                </div>}
            </div>
        </>}
    </div>;
}
