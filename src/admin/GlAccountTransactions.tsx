import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import RichTable, { type Column } from '../components/RichTable';
import { Alert } from '../components/ui';
import { Segmented, messageOf, useConfirm } from '../components/screen';
import Sheet from '../components/Sheet';
import GlTxnEditor, { HandlerList, changeOf, type Change, type Handler, type TxnCode } from '../components/GlTxnEditor';
import { Badge, Button, Spinner } from './kit';

// MEMS admin › Transactions Manager › GL account transactions
// The MEMS default: for every account of the MEMS GL master, the transactions that post to it, derived from the account's
// posting mode, the subledger it reconciles to, its category and cost object. A super admin may change the default of an
// account (reason required, audited). Every organization adopts the default; legal entities adjust it with approval.

type Account = {
    code: string; name: string; classCode: string; categoryCode: string; categoryName: string; accountRole: string; postingMode: string;
    reconciledTo: string; costObject: string; taxRelevance: string;
    derived: Handler[]; change: Change | null; effective: Handler[];
};
type Data = {
    masterVersion: string; accounts: Account[]; codes: Array<TxnCode & { accounts: number }>; version: number; updatedBy: string; updatedAt: string;
    totals: { accounts: number; changed: number; transactions: number; uncovered: number };
};
type Filter = 'all' | 'automatic' | 'manual' | 'changed';

export default function GlAccountTransactions() {
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<Filter>('all');
    const [selected, setSelected] = useState<Account | null>(null);
    const load = () => {
        setLoading(true);
        setError('');
        callBackend<Data>('/api/admin/fin/gltxn/list', {})
            .then(setData)
            .catch((e) => setError(messageOf(e, 'Unable to load the GL account transactions.')))
            .finally(() => setLoading(false));
    };
    useEffect(load, []);
    const codes = useMemo(() => new Map((data?.codes ?? []).map((c) => [c.code, c])), [data]);
    const rows = useMemo(
        () => (data?.accounts ?? []).filter((a) => filter === 'all' || (filter === 'changed' ? !!a.change : filter === 'manual' ? /^manual/i.test(a.postingMode) : !/^manual/i.test(a.postingMode))),
        [data, filter],
    );
    const columns: Array<Column<Account>> = [
        { key: 'code', label: 'Account', value: (a) => a.code, render: (a) => <span className='whitespace-nowrap font-mono text-xs font-semibold text-ink'>{a.code}</span> },
        { key: 'name', label: 'Name', value: (a) => a.name, render: (a) => <span className='block min-w-[12rem] max-w-[18rem] whitespace-normal'>{a.name}</span> },
        { key: 'category', label: 'Category', value: (a) => `${a.categoryCode} ${a.categoryName}`, render: (a) => <span className='block min-w-[10rem] whitespace-normal text-xs'>{a.categoryCode} · {a.categoryName}</span> },
        { key: 'mode', label: 'Posting mode', value: (a) => a.postingMode, render: (a) => <span className='block min-w-[9rem] whitespace-normal text-xs'>{a.postingMode}</span> },
        { key: 'txns', label: 'Transactions', value: (a) => a.effective.map((h) => `${h.code} ${h.side}`).join(', '), render: (a) => <span className='block min-w-[14rem] max-w-[22rem] whitespace-normal font-mono text-[11px]'>{a.effective.map((h) => h.code).join(', ')}</span> },
        { key: 'count', label: 'Count', type: 'number', value: (a) => a.effective.length },
        { key: 'source', label: 'Source', value: (a) => (a.change ? 'Changed by MEMS' : 'Derived'), render: (a) => <Badge tone={a.change ? 'warn' : 'muted'}>{a.change ? 'Changed by MEMS' : 'Derived'}</Badge> },
        { key: 'recon', label: 'Reconciled to', value: (a) => a.reconciledTo, hidden: true },
        { key: 'costObject', label: 'Cost object', value: (a) => a.costObject, hidden: true },
        { key: 'tax', label: 'Tax relevance', value: (a) => a.taxRelevance, hidden: true },
        { key: 'role', label: 'Account role', value: (a) => a.accountRole, hidden: true },
    ];
    const t = data?.totals;
    return (
        <div className='space-y-3'>
            {error && <Alert tone='error'>{error}</Alert>}
            {!data && loading && <Spinner />}
            {data && !data.accounts.length && <Alert tone='warn'>The MEMS GL account master is not loaded. Upload it under Modules › FIN, then return here.</Alert>}
            {t && t.accounts > 0 && (
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                    {([
                        ['Accounts', t.accounts, `GL master ${data!.masterVersion || ''}`],
                        ['Covered', t.accounts - t.uncovered, 'Accounts with at least one transaction'],
                        ['Transactions used', t.transactions, 'Distinct codes posting to accounts'],
                        ['Changed by MEMS', t.changed, data!.updatedAt ? `Last ${new Date(data!.updatedAt).toLocaleDateString()} · ${data!.updatedBy}` : 'None yet'],
                    ] as const).map(([label, value, hint]) => (
                        <div key={label} className='rounded-xl border border-line bg-panel p-3'>
                            <p className='text-xs text-muted'>{label}</p>
                            <p className='mt-1 text-xl font-semibold text-ink'>{value}</p>
                            <p className='mt-0.5 text-[11px] leading-tight text-muted'>{hint}</p>
                        </div>
                    ))}
                </div>
            )}
            {data && data.accounts.length > 0 && (
                <>
                    <Segmented label='Accounts' value={filter} onChange={setFilter} options={[
                        { value: 'all', label: 'All', count: data.accounts.length },
                        { value: 'automatic', label: 'Automatic only', count: data.accounts.filter((a) => !/^manual/i.test(a.postingMode)).length },
                        { value: 'manual', label: 'Manual and automatic', count: data.accounts.filter((a) => /^manual/i.test(a.postingMode)).length },
                        { value: 'changed', label: 'Changed', count: t?.changed },
                    ]} />
                    <RichTable
                        id='mems-gl-account-transactions'
                        title='GL account transactions (MEMS default)'
                        fileName='mems_gl_account_transactions'
                        height='h-[calc(100dvh-16rem)]'
                        columns={columns}
                        rows={rows}
                        rowKey={(a) => a.code}
                        onRowClick={setSelected}
                        actions={<Button variant='secondary' onClick={load} disabled={loading} aria-label='Refresh'><RefreshCw className='h-4 w-4' /></Button>}
                        empty='No accounts in this view.'
                    />
                </>
            )}
            <p className='flex items-start gap-2 text-xs text-muted'>
                <ShieldCheck className='h-4 w-4 shrink-0' />
                Every organization adopts this default. A legal entity changes it only through its own proposal and approval (FIN.gltxn.manage / FIN.gltxn.approve); cost centers can switch transactions off (FIN.cc.approve).
            </p>
            {selected && data && <AccountSheet account={selected} codes={data.codes} byCode={codes} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} />}
        </div>
    );
}

function AccountSheet({ account, codes, byCode, onClose, onSaved }: { account: Account; codes: TxnCode[]; byCode: Map<string, TxnCode>; onClose: () => void; onSaved: () => void }) {
    const [draft, setDraft] = useState<Handler[]>(account.effective);
    const { ask, sheet } = useConfirm();
    const change = changeOf(account.derived, draft);
    const current = JSON.stringify(changeOf(account.derived, account.effective));
    const dirty = JSON.stringify(change) !== current;
    const save = (reset = false) =>
        ask(
            {
                title: reset ? `Reset ${account.code} to the derived default?` : `Change the MEMS default of ${account.code}?`,
                message: 'Every organization that has adopted this account inherits the change. Removed transactions are refused when posting to this account, unless a legal entity adds them back with approval.',
                confirmLabel: reset ? 'Reset' : 'Save change',
                reason: { label: 'Reason', minLength: 10, placeholder: 'Why the default changes' },
            },
            async (reason) => {
                await callBackend('/api/admin/fin/gltxn/save', { changes: [{ account: account.code, ...(reset ? { add: [], remove: [] } : change) }], reason });
                onSaved();
            },
        );
    return (
        <Sheet
            title={`${account.code} ${account.name}`}
            onClose={onClose}
            footer={
                <>
                    {account.change && <Button variant='secondary' className='flex-1' onClick={() => save(true)}>Reset</Button>}
                    <Button className='flex-1' disabled={!dirty || !draft.length} onClick={() => save(false)}>Save change</Button>
                </>
            }
        >
            <dl className='grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm'>
                <dt className='text-muted'>Category</dt><dd className='text-ink'>{account.categoryCode} · {account.categoryName}</dd>
                <dt className='text-muted'>Posting mode</dt><dd className='text-ink'>{account.postingMode}</dd>
                {account.reconciledTo && <><dt className='text-muted'>Reconciled to</dt><dd className='text-ink'>{account.reconciledTo}</dd></>}
                {account.costObject && <><dt className='text-muted'>Cost object</dt><dd className='text-ink'>{account.costObject}</dd></>}
                {account.taxRelevance && <><dt className='text-muted'>Tax relevance</dt><dd className='text-ink'>{account.taxRelevance}</dd></>}
            </dl>
            <section className='space-y-1'>
                <h3 className='text-sm font-semibold text-ink'>Derived from the GL master</h3>
                <HandlerList items={account.derived} codes={byCode} />
            </section>
            <section className='space-y-1'>
                <h3 className='text-sm font-semibold text-ink'>MEMS default (edit)</h3>
                <p className='text-xs text-muted'>Only a MEMS super admin can save. The change is audited with your reason.</p>
                <GlTxnEditor base={account.derived} draft={draft} onChange={setDraft} codes={codes} />
            </section>
            {sheet}
        </Sheet>
    );
}
