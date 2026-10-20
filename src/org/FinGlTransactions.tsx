import { useMemo, useState } from 'react';
import { callBackend } from '../lib/backend';
import RichTable, { type Column } from '../components/RichTable';
import { Alert } from '../components/ui';
import { Segmented, useConfirm } from '../components/screen';
import Sheet from '../components/Sheet';
import GlTxnEditor, { HandlerList, changeOf, type Change, type Handler, type TxnCode } from '../components/GlTxnEditor';
import { Button, Spinner, useLoad } from '../admin/kit';
import { Card, FIN_API, Pending, Pill, type Entity } from './finKit';

// Finance › GL Accounts › Account transactions
// Every account of the legal entity's chart with the transactions that may post to it. The legal entity adopts the
// MEMS default automatically; changes are proposed (FIN.gltxn.manage) and approved by someone else (FIN.gltxn.approve).
// Cost centers inherit the result and may switch transactions off in their finance settings.

type Row = {
    account: string; name: string; categoryCode: string; categoryName: string; statement: 'BS' | 'PL'; postingMode: string; status: string; inMaster: boolean;
    memsDefault: Handler[]; change: Change | null; effective: Handler[];
};
type Data = {
    le: { id: string; code: string; name: string };
    masterVersion: string; version: number; approvedAt: string;
    rows: Row[];
    codes: Array<TxnCode & { used: boolean }>;
    pending: Array<{ id: string; title: string; makerName: string; createdAt: string }>;
    can: { manage: boolean; approve: boolean };
};
type Filter = 'all' | 'changed' | 'BS' | 'PL';

export default function FinGlTransactions({ le }: { le: Entity }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Data>(`${FIN_API}/gltxn/get`, { leId: le.id }), [le.id]);
    const [filter, setFilter] = useState<Filter>('all');
    const [selected, setSelected] = useState<Row | null>(null);
    const [done, setDone] = useState('');
    const byCode = useMemo(() => new Map((data?.codes ?? []).map((c) => [c.code, c])), [data]);
    const rows = useMemo(() => (data?.rows ?? []).filter((r) => filter === 'all' || (filter === 'changed' ? !!r.change : r.statement === filter)), [data, filter]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the GL account transactions.'}</Alert>;
    const columns: Array<Column<Row>> = [
        { key: 'account', label: 'Account', value: (r) => r.account, render: (r) => <span className='whitespace-nowrap font-mono text-xs font-semibold'>{r.account}</span> },
        { key: 'name', label: 'Name', value: (r) => r.name, render: (r) => <span className='block min-w-[11rem] max-w-[18rem] whitespace-normal'>{r.name}</span> },
        { key: 'txns', label: 'Transactions', value: (r) => r.effective.map((h) => `${h.code} ${h.side}`).join(', '), render: (r) => <span className='block min-w-[13rem] max-w-[22rem] whitespace-normal font-mono text-[11px]'>{r.effective.map((h) => h.code).join(', ')}</span> },
        { key: 'source', label: 'Source', value: (r) => (r.change ? 'Changed for this legal entity' : 'MEMS default'), render: (r) => <Pill status={r.change ? 'pending' : 'active'} label={r.change ? 'Changed' : 'MEMS default'} /> },
        { key: 'count', label: 'Count', type: 'number', value: (r) => r.effective.length },
        { key: 'category', label: 'Category', value: (r) => `${r.categoryCode} ${r.categoryName}`, render: (r) => <span className='block min-w-[9rem] whitespace-normal text-xs'>{r.categoryCode} · {r.categoryName}</span> },
        { key: 'statement', label: 'Statement', value: (r) => (r.statement === 'BS' ? 'Balance sheet' : 'Profit and loss'), hidden: true },
        { key: 'mode', label: 'Posting mode', value: (r) => r.postingMode, hidden: true },
        { key: 'status', label: 'Account status', value: (r) => r.status, hidden: true },
    ];
    return (
        <div className='space-y-3'>
            <Pending items={data.pending.map((p) => ({ ...p, typeLabel: 'GL account transactions' }))} />
            {done && <Alert tone='success'>{done}</Alert>}
            {!data.rows.length && <Alert tone='warn'>{le.code} has no accounts yet. Adopt accounts from the MEMS GL master first.</Alert>}
            <Card title='How this works'>
                <p className='text-sm text-soft'>
                    {le.code} adopts the MEMS default transactions of every account automatically{data.masterVersion ? ` (GL master ${data.masterVersion})` : ''}. Changes for this legal entity need FIN.gltxn.manage to propose and a different person with FIN.gltxn.approve to approve. Removed transactions are refused when they post to the account. Cost centers inherit the result and can switch transactions off.
                </p>
                <p className='mt-1 text-xs text-muted'>Approved version {data.version}{data.approvedAt ? ` · ${new Date(data.approvedAt).toLocaleString()}` : ''}{data.can.manage ? '' : ' · You can view only.'}</p>
            </Card>
            <Segmented label='Accounts' value={filter} onChange={setFilter} options={[
                { value: 'all', label: 'All', count: data.rows.length },
                { value: 'changed', label: 'Changed', count: data.rows.filter((r) => r.change).length },
                { value: 'BS', label: 'Balance sheet', count: data.rows.filter((r) => r.statement === 'BS').length },
                { value: 'PL', label: 'Profit and loss', count: data.rows.filter((r) => r.statement === 'PL').length },
            ]} />
            <RichTable id='fin.gltxn' title={`Account transactions of ${le.code}`} fileName={`gl-account-transactions-${le.code}`} height='h-[calc(100dvh-22rem)]' columns={columns} rows={rows} rowKey={(r) => r.account} onRowClick={setSelected} empty='No accounts in this view.' />
            {selected && (
                <AccountSheet
                    le={le}
                    row={selected}
                    codes={data.codes}
                    byCode={byCode}
                    canManage={data.can.manage}
                    onClose={() => setSelected(null)}
                    onDone={(m) => { setSelected(null); setDone(m); reload(); }}
                />
            )}
        </div>
    );
}

function AccountSheet({ le, row, codes, byCode, canManage, onClose, onDone }: { le: Entity; row: Row; codes: TxnCode[]; byCode: Map<string, TxnCode>; canManage: boolean; onClose: () => void; onDone: (m: string) => void }) {
    const [draft, setDraft] = useState<Handler[]>(row.effective);
    const confirm = useConfirm();
    const change = changeOf(row.memsDefault, draft);
    const dirty = JSON.stringify(change) !== JSON.stringify(changeOf(row.memsDefault, row.effective));
    const propose = (reset: boolean) =>
        confirm.ask(
            {
                title: reset ? `Return ${row.account} to the MEMS default?` : `Propose transactions for ${row.account}`,
                message: 'A person with FIN.gltxn.approve, other than you, must approve before it applies. Removed transactions are then refused when posting to this account.',
                confirmLabel: 'Propose',
                reason: { label: 'Reason', minLength: 10 },
            },
            async (reason) => {
                await callBackend(`${FIN_API}/gltxn/propose`, { leId: le.id, changes: [{ account: row.account, ...(reset ? { add: [], remove: [] } : change) }], reason });
                onDone('Proposed for approval.');
            },
        );
    return (
        <Sheet
            title={`${row.account} ${row.name}`}
            onClose={onClose}
            footer={canManage ? (
                <>
                    {row.change && <Button variant='secondary' className='flex-1' onClick={() => propose(true)}>Back to default</Button>}
                    <Button className='flex-1' disabled={!dirty || !draft.length} onClick={() => propose(false)}>Propose</Button>
                </>
            ) : undefined}
        >
            <p className='text-sm text-soft'>{row.categoryCode} · {row.categoryName} · {row.statement === 'BS' ? 'Balance sheet' : 'Profit and loss'} · {row.postingMode}</p>
            {!row.inMaster && <Alert tone='warn'>This account is not in the MEMS GL master; its default comes from its category.</Alert>}
            <section className='space-y-1'>
                <h3 className='text-sm font-semibold text-ink'>MEMS default</h3>
                <HandlerList items={row.memsDefault} codes={byCode} />
            </section>
            <section className='space-y-1'>
                <h3 className='text-sm font-semibold text-ink'>{canManage ? `For ${le.code} (edit and propose)` : `For ${le.code}`}</h3>
                {canManage ? <GlTxnEditor base={row.memsDefault} draft={draft} onChange={setDraft} codes={codes} /> : <HandlerList items={row.effective} codes={byCode} />}
            </section>
            {confirm.sheet}
        </Sheet>
    );
}
