import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, messageOf } from '../components/screen';
import { Facts, Section, money } from './PoExtras';
import { openStored } from './fileTools';

// Journals posted from procurement. Today that is the journal made when a cost center owner accepts a service. A journal
// is never edited. Opening one shows its lines (cost center, GL account, amounts) and the trail back to the receipt,
// the purchase order and its version, the requisitions, the quotations and the requirements it came from.

const ROUTE = 'organization_home/finance_journals';
const PO = 'organization_home/procurement_orders';

interface JRow {
    journalId: string;
    journal: string;
    line: number;
    postingDate: string;
    side: string;
    glCode: string;
    glName: string;
    costCenter: string;
    costCenterName: string;
    currency: string;
    amount: number;
    debit: number;
    credit: number;
    baseAmount: number;
    orgCurrency: string;
    vendor: string;
    po: string;
    invoiceNo: string;
    description: string;
    acceptedBy: string;
    type: string;
    status: string;
}
interface JLine {
    no: number;
    side: string;
    glCode: string;
    glName: string;
    costCenterCode: string;
    costCenterName: string;
    description: string;
    amount: number;
    baseAmount: number;
    poLineNos: number[];
}
interface Journal {
    id: string;
    number: string;
    status: string;
    type: string;
    postingDate: string;
    postedAt: string;
    currency: string;
    orgCurrency: string;
    fxRate: number;
    totalDebit: number;
    totalCredit: number;
    baseTotal: number;
    lines: JLine[];
    vendorName: string;
    invoiceNo: string;
    invoiceDate: string;
    invoiceAmount: number;
    periodFrom: string;
    periodTo: string;
    renderedByName: string;
    acceptedByName: string;
    note: string;
    files: Array<{ id: string; kind: string; name: string }>;
    trace: {
        po: { id: string; number: string; base: string; ver: number; status: string; ownerName: string; approvedAt: string; approvals: Array<{ level: string; by: string; at: string; title: string }> };
        receipt: { id: string; renderedByName: string; renderedAt: string; decidedByName: string; decidedAt: string; lines: Array<{ no: number; itemName: string; qty: number; unit: string; amount: number }> };
        requisitions: Array<{ id: string; status: string; quotationId: string; quotationNumber: string; requirementId: string; requirementTitle: string; requesterName: string }>;
    };
}

const COLUMNS: Array<Column<JRow>> = [
    { key: 'j', label: 'Journal', value: (r) => r.journal, render: (r) => <span className='font-mono text-xs'>{r.journal}</span> },
    { key: 'date', label: 'Posting date', type: 'date', value: (r) => r.postingDate },
    { key: 'line', label: 'Line', type: 'number', value: (r) => r.line, hidden: true },
    { key: 'gl', label: 'GL account', value: (r) => `${r.glCode} ${r.glName}` },
    { key: 'cc', label: 'Cost center', value: (r) => `${r.costCenter} ${r.costCenterName}` },
    { key: 'dr', label: 'Debit', type: 'number', value: (r) => r.debit || null, render: (r) => (r.debit ? money(r.debit) : '') },
    { key: 'cr', label: 'Credit', type: 'number', value: (r) => r.credit || null, render: (r) => (r.credit ? money(r.credit) : '') },
    { key: 'cur', label: 'Currency', value: (r) => r.currency },
    { key: 'base', label: 'Amount (org currency)', type: 'number', value: (r) => r.baseAmount, hidden: true },
    { key: 'vendor', label: 'Supplier', value: (r) => r.vendor },
    { key: 'po', label: 'Purchase order', value: (r) => r.po },
    { key: 'inv', label: 'Invoice', value: (r) => r.invoiceNo },
    { key: 'desc', label: 'Description', value: (r) => r.description, hidden: true },
    { key: 'by', label: 'Accepted by', value: (r) => r.acceptedBy, hidden: true },
    { key: 'type', label: 'Type', value: (r) => r.type, hidden: true },
];

function JournalList() {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ rows: JRow[]; count: number }>('/api/org/finance/journals/list', {}));
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the journals.'}</Alert>;
    return (
        <Screen title='Journals' subtitle={`${data.count} journal(s) you can see`} onBack={() => navigate('organization_home')} actions={<Button variant='secondary' onClick={reload}>Refresh</Button>}>
            <RichTable id='fin.journals' title='Journal register' columns={COLUMNS} rows={data.rows} rowKey={(r) => `${r.journalId}-${r.line}`} onRowClick={(r) => navigate(`${ROUTE}/${r.journalId}`)} empty='No journals yet.' fileName='journal-register' height='h-[calc(100dvh-14rem)]' />
        </Screen>
    );
}

function JournalDetail({ id }: { id: string }) {
    const { data, error, loading } = useLoad(() => callBackend<Journal>('/api/org/finance/journals/get', { id }), [id]);
    const [problem, setProblem] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Journal not found.'}</Alert>;
    const j = data;
    const t = j.trace;
    return (
        <Screen title={j.number} subtitle={`${j.type} · ${j.vendorName}`} onBack={() => navigate(ROUTE)}>
            {problem && <Alert tone='error'>{problem}</Alert>}
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone='brand'>Posted {j.postingDate}</Badge>
                <Badge tone='muted'>{j.currency} {money(j.totalDebit)}</Badge>
                {j.currency !== j.orgCurrency && <Badge tone='muted'>{j.orgCurrency} {money(j.baseTotal)} at {j.fxRate}</Badge>}
            </div>
            <Section title='Lines'>
                <RichTable
                    id='fin.journal.lines'
                    columns={[
                        { key: 'no', label: 'No', type: 'number', value: (l: JLine) => l.no },
                        { key: 'side', label: 'Debit / credit', value: (l) => (l.side === 'debit' ? 'Debit' : 'Credit') },
                        { key: 'gl', label: 'GL account', value: (l) => `${l.glCode} ${l.glName}` },
                        { key: 'cc', label: 'Cost center', value: (l) => `${l.costCenterCode} ${l.costCenterName}` },
                        { key: 'amt', label: `Amount (${j.currency})`, type: 'number', value: (l) => l.amount, render: (l) => money(l.amount) },
                        { key: 'base', label: `Amount (${j.orgCurrency})`, type: 'number', value: (l) => l.baseAmount, render: (l) => money(l.baseAmount) },
                        { key: 'ln', label: 'Order lines', value: (l) => l.poLineNos.join(', ') },
                        { key: 'desc', label: 'Description', value: (l) => l.description },
                    ]}
                    rows={j.lines}
                    rowKey={(l) => String(l.no)}
                    empty='No lines.'
                    fileName={`${j.number}-lines`}
                    height='h-72'
                />
            </Section>
            <Section title='Invoice and service'>
                <Facts rows={[['Supplier', j.vendorName], ['Invoice', `${j.invoiceNo}, dated ${j.invoiceDate}`], ['Invoice amount', money(j.invoiceAmount, j.currency)], ['Service period', `${j.periodFrom} to ${j.periodTo}`], ['Recorded by', j.renderedByName], ['Accepted by', j.acceptedByName], ['Note', j.note]]} />
                <div className='flex flex-wrap gap-2'>
                    {j.files.map((f) => (
                        <Button key={f.id} variant='secondary' onClick={() => void openStored('/api/org/finance/journals/file', { id: j.id, fileId: f.id }).catch((e) => setProblem(messageOf(e)))}>
                            <Paperclip className='mr-1 h-4 w-4' /> {f.kind === 'timesheet' ? 'Timesheet' : f.kind === 'report' ? 'Report' : 'Invoice'}
                        </Button>
                    ))}
                </div>
            </Section>
            <Section title='Where this journal came from'>
                <ol className='space-y-2 text-sm'>
                    <li>
                        <p className='text-xs text-muted'>Service receipt</p>
                        <p className='text-ink'>{t.receipt.id}: recorded by {t.receipt.renderedByName}{t.receipt.renderedAt ? `, ${fmtDate(t.receipt.renderedAt)}` : ''}; accepted by {t.receipt.decidedByName || j.acceptedByName}{t.receipt.decidedAt ? `, ${fmtDate(t.receipt.decidedAt)}` : ''}</p>
                        <p className='text-xs text-soft'>{t.receipt.lines.map((l) => `${l.no} ${l.itemName}: ${l.qty} ${l.unit}`).join('; ')}</p>
                    </li>
                    <li>
                        <p className='text-xs text-muted'>Purchase order</p>
                        <button type='button' className='min-h-11 text-brand' onClick={() => navigate(`${PO}/${t.po.id}`)}>
                            {t.po.number} (version V{t.po.ver}), owner {t.po.ownerName}
                        </button>
                        <p className='text-xs text-soft'>Approved {t.po.approvedAt ? fmtDate(t.po.approvedAt) : ''}: {t.po.approvals.map((a) => `${a.level} ${a.by}`).join(' → ')}</p>
                    </li>
                    {t.requisitions.map((r) => (
                        <li key={r.id}>
                            <p className='text-xs text-muted'>Requisition, quotation and requirement</p>
                            <div className='flex flex-wrap gap-x-4'>
                                <button type='button' className='min-h-11 text-brand' onClick={() => navigate(`organization_home/procurement_requisitions/${r.id}`)}>{r.id}</button>
                                <button type='button' className='min-h-11 text-brand' onClick={() => navigate(`organization_home/procurement_quotations/${r.quotationId}`)}>{r.quotationNumber}</button>
                                <button type='button' className='min-h-11 text-brand' onClick={() => navigate(`organization_home/purchase_requirements/${r.requirementId}`)}>{r.requirementTitle || r.requirementId}</button>
                            </div>
                            <p className='text-xs text-soft'>Asked for by {r.requesterName}</p>
                        </li>
                    ))}
                </ol>
            </Section>
        </Screen>
    );
}

export default function Journals({ id }: { id?: string }) {
    return id && /^JNL\d{9}$/.test(id) ? <JournalDetail id={id} /> : <JournalList />;
}
