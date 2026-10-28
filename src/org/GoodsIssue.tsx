import { useMemo, useState } from 'react';
import { ClipboardList, FileCheck, PackageOpen, Plus, Trash2 } from 'lucide-react';
import { VoucherQueue } from './StoresIssueVouchers';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { useConfirm } from '../components/screen';
import { Chips, Frame, Pill, fmt, go } from './finKit';

// Goods issue: stock leaves a warehouse for a cost center or a work order. The issuer needs INV.issue at the warehouse;
// the receiver is another person who signs for it. When finance is live for the legal entity the issue is valued at
// moving average and posted (Dr consumption on the receiving cost center, Cr inventory on the warehouse) in the same
// step; work order issues are also added to the work order's spares used.

interface Options {
    warehouses: Array<{ id: string; code: string; name: string }>;
    finance?: string;
    leCode?: string;
    materials?: Array<{ materialId: string; materialNumber: string; name: string; available: number; avg: number; valuedQty: number;reservations?:Array<{workOrderId:string;taskId:string;qty:number}> }>;
    costCenters?: Array<{ id: string; code: string; name: string }>;
    workOrders?: Array<{ id: string; title: string; costCenterId: string; status: string;tasks?:Array<{id:string;description:string}> }>;
    people?: Array<{ uid: string; name: string }>;
}
interface Issue {
    id: string;
    at: string;
    warehouse: string;
    costCenter: string;
    workOrderId: string;
    ref: string;
    items: number;
    total: number;
    journalId: string;
    issuedByName: string;
    receivedByName: string;
}
const COLS: Array<Column<Issue>> = [
    { key: 'id', label: 'Issue', value: (r) => r.id, render: (r) => <span className='font-mono text-xs'>{r.id}</span> },
    { key: 'at', label: 'Date', type: 'date', value: (r) => r.at, render: (r) => fmtDate(r.at) },
    { key: 'wh', label: 'Warehouse', value: (r) => r.warehouse },
    { key: 'cc', label: 'Cost center', value: (r) => r.costCenter },
    { key: 'wo', label: 'Work order', value: (r) => r.workOrderId },
    { key: 'n', label: 'Items', type: 'number', value: (r) => r.items },
    { key: 'v', label: 'Value', type: 'number', value: (r) => r.total, render: (r) => fmt(r.total) },
    { key: 'j', label: 'Journal', value: (r) => r.journalId || 'Not posted' },
    { key: 'by', label: 'Issued by', value: (r) => r.issuedByName, hidden: true },
    { key: 'to', label: 'Received by', value: (r) => r.receivedByName },
    { key: 'ref', label: 'Reference', value: (r) => r.ref, hidden: true },
];

function NewIssue({ onDone }: { onDone: (m: string) => void }) {
    const [wh, setWh] = useState('');
    const { data, error, loading } = useLoad(() => callBackend<Options>('/api/org/inv/issue/options', { warehouseId: wh }), [wh]);
    const [mode, setMode] = useState<'cc' | 'wo'>('cc');
    const [cc, setCc] = useState('');
    const [wo, setWo] = useState('');
    const [taskId,setTaskId]=useState('');
    const [to, setTo] = useState('');
    const [ref, setRef] = useState('');
    const [note, setNote] = useState('');
    const [lines, setLines] = useState<Array<{ materialId: string; qty: string }>>([{ materialId: '', qty: '' }]);
    const confirm = useConfirm();
    const mats = (data?.materials ?? []).map(m=>({...m,available:m.available+(mode==='wo'?(m.reservations||[]).filter(r=>r.workOrderId===wo&&r.taskId===taskId).reduce((n,r)=>n+r.qty,0):0)}));
    const tasks=data?.workOrders?.find(w=>w.id===wo)?.tasks||[];
    const est = useMemo(() => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (mats.find((m) => m.materialId === l.materialId)?.avg ?? 0), 0), [lines, mats]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load.'}</Alert>;
    if (!data.warehouses.length) return <Alert tone='info'>You cannot issue from any warehouse. Issuing needs INV.issue at the warehouse.</Alert>;
    const problems: string[] = [];
    if (!wh) problems.push('the warehouse');
    if (mode === 'cc' && !cc) problems.push('the receiving cost center');
    if (mode === 'wo' && !wo) problems.push('the work order');
    if(mode==='wo'&&tasks.length&&!taskId)problems.push('the maintenance task');
    if (!to) problems.push('the person receiving the stock');
    if (ref.trim().length < 3) problems.push('the issue slip or reference');
    lines.forEach((l, i) => {
        const m = mats.find((x) => x.materialId === l.materialId);
        if (!l.materialId) problems.push(`the material on line ${i + 1}`);
        else if (!(Number(l.qty) > 0) || Number(l.qty) > (m?.available ?? 0)) problems.push(`a quantity on line ${i + 1} up to ${m?.available ?? 0}`);
    });
    if (new Set(lines.map((l) => l.materialId)).size !== lines.length) problems.push('each material only once');
    return (
        <div className='space-y-3'>
            <SelectField id='gi-wh' label='Warehouse' value={wh} onChange={(e) => { setWh(e.target.value); setLines([{ materialId: '', qty: '' }]); setCc(''); setWo(''); }}>
                <option value=''>Choose</option>
                {data.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                        {w.code} {w.name}
                    </option>
                ))}
            </SelectField>
            {wh && data.finance && (
                <p className='text-xs'>
                    <Pill status={data.finance === 'live' ? 'active' : 'not_live'} label={data.finance === 'live' ? `Posts to the ${data.leCode} journal` : `Finance not live in ${data.leCode}: quantities only`} />
                </p>
            )}
            {wh && (
                <>
                    <Chips value={mode} onChange={(v) => { setMode(v); setCc(''); setWo(''); }} options={[{ value: 'cc', label: 'To a cost center' }, { value: 'wo', label: 'To a work order' }]} />
                    {mode === 'cc' ? (
                        <SelectField id='gi-cc' label='Receiving cost center (same legal entity)' value={cc} onChange={(e) => setCc(e.target.value)}>
                            <option value=''>Choose</option>
                            {(data.costCenters ?? []).map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.code} {c.name}
                                </option>
                            ))}
                        </SelectField>
                    ) : (
                        <SelectField id='gi-wo' label='Work order (released, scheduled or in progress)' value={wo} onChange={(e) => {setWo(e.target.value);setTaskId('');}}>
                            <option value=''>Choose</option>
                            {(data.workOrders ?? []).map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.id} {w.title}
                                </option>
                            ))}
                        </SelectField>
                    )}
                    {mode==='wo'&&tasks.length>0&&<SelectField id='gi-task' label='Maintenance task receiving these materials' value={taskId} onChange={e=>setTaskId(e.target.value)}><option value=''>Choose task</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.description}</option>)}</SelectField>}
                    {lines.map((l, i) => {
                        const m = mats.find((x) => x.materialId === l.materialId);
                        return (
                            <div key={i} className='space-y-2 rounded-xl border border-line p-2'>
                                <SelectField id={`gi-m-${i}`} label={`Material ${i + 1}`} value={l.materialId} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, materialId: e.target.value } : x)))}>
                                    <option value=''>Choose</option>
                                    {mats.map((x) => (
                                        <option key={x.materialId} value={x.materialId}>
                                            {x.materialNumber} {x.name} ({x.available} available)
                                        </option>
                                    ))}
                                </SelectField>
                                <div className='flex items-end gap-2'>
                                    <div className='min-w-0 flex-1'>
                                        <Field id={`gi-q-${i}`} label='Quantity' inputMode='decimal' value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value.replace(/[^\d.]/g, '') } : x)))} hint={m ? `Available ${m.available}${data.finance === 'live' ? ` · average cost ${fmt(m.avg, 4)}${m.valuedQty < m.available ? ` · only ${m.valuedQty} valued` : ''}` : ''}` : undefined} />
                                    </div>
                                    {lines.length > 1 && (
                                        <button type='button' aria-label='Remove line' onClick={() => setLines(lines.filter((_, k) => k !== i))} className='mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-line text-soft'>
                                            <Trash2 className='h-4 w-4' />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {lines.length < 30 && (
                        <Button variant='secondary' onClick={() => setLines([...lines, { materialId: '', qty: '' }])}>
                            <Plus className='h-4 w-4' /> Add a material
                        </Button>
                    )}
                    <SelectField id='gi-to' label='Received by (cannot be you)' value={to} onChange={(e) => setTo(e.target.value)}>
                        <option value=''>Choose</option>
                        {(data.people ?? []).map((p) => (
                            <option key={p.uid} value={p.uid}>
                                {p.name}
                            </option>
                        ))}
                    </SelectField>
                    <Field id='gi-ref' label='Issue slip or reference' value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} />
                    <Field id='gi-note' label='Note, optional' value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                    {data.finance === 'live' && est > 0 && <p className='text-sm text-soft'>Estimated value at moving average: {fmt(est)}</p>}
                    {problems.length > 0 && <p className='text-xs text-amber-300'>Still needed: {problems.join(', ')}.</p>}
                    <Button disabled={problems.length > 0} onClick={() => confirm.ask({ title: 'Issue the stock', message: `${lines.length} material(s) leave the warehouse${data.finance === 'live' ? ' and the issue is posted to the journal' : ''}. This cannot be undone; a return is a new receipt.`, confirmLabel: 'Issue', acknowledge: 'The quantities were counted and physically handed to the receiver, who signed the issue slip.' }, async () => { const r = await callBackend<{ id: string; journalId: string }>('/api/org/inv/issue/post', { warehouseId: wh, ccId: mode === 'cc' ? cc : '', workOrderId: mode === 'wo' ? wo : '', taskId:mode==='wo'?taskId:'', receivedBy: to, ref, note, lines: lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })), acknowledge: true }); setLines([{ materialId: '', qty: '' }]); setRef(''); setNote(''); onDone(`Issued as ${r.id}${r.journalId ? `, journal ${r.journalId}` : ' (not posted: finance not live)'}.`); })}>
                        Issue stock
                    </Button>
                </>
            )}
            {confirm.sheet}
        </div>
    );
}

export default function GoodsIssue() {
    const [tab, setTab] = useState<'vouchers' | 'new' | 'history'>(() => {
        try {
            const key = 'mems.table.tab.' + window.location.hash.replace(/^#\/?/, '');
            const value = sessionStorage.getItem(key);
            sessionStorage.removeItem(key);
            return value === 'history' ? 'history' : value === 'new' ? 'new' : 'vouchers';
        } catch { return 'vouchers'; }
    });
    const [msg, setMsg] = useState('');
    const hist = useLoad(() => callBackend<{ issues: Issue[] }>('/api/org/inv/issue/list'), [tab, msg]);
    return (
        <Frame title='Goods issue' subtitle='Issue against stores issue vouchers (SIV), or stock out to a cost center or work order' onBack={() => go('module/INV')} nav={[{ value: 'vouchers', label: 'Issue vouchers', icon: FileCheck }, { value: 'new', label: 'Issue stock', icon: PackageOpen }, { value: 'history', label: 'Issues', icon: ClipboardList }]} navValue={tab} onNav={setTab}>
            {msg && <Alert tone='success'>{msg}</Alert>}
            {tab === 'vouchers' ? (
                <VoucherQueue />
            ) : tab === 'new' ? (
                <NewIssue onDone={(m) => { setMsg(m); setTab('history'); }} />
            ) : hist.loading && !hist.data ? (
                <Spinner />
            ) : hist.error ? (
                <Alert tone='error'>{hist.error}</Alert>
            ) : (
                <RichTable id='inv.issues' tabKey='history' columns={COLS} rows={hist.data?.issues ?? []} rowKey={(r) => r.id} onRowClick={(r) => r.journalId && go(`fin_journal/${r.journalId}`)} empty='No goods issues yet.' fileName='goods-issues' height='h-[calc(100dvh-11rem)]' />
            )}
        </Frame>
    );
}

