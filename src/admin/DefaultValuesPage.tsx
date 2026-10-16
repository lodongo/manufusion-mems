import { useMemo, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { formatRate } from '../lib/reference';
import { Alert, Field } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import BanksPanel from './BanksPanel';
import SequencesCard from './SequencesCard';
import { fmtDate } from './format';
import { Badge, Button, Card, PageTitle, Spinner, useLoad } from './kit';

// One page per default value list. Each list is restored, cleared and edited on its own,
// every change needs a typed confirmation and is written to the audit trail by the backend.

type Row = Record<string, unknown>;

interface ListData {
    key: string;
    label: string;
    appliesTo?: string;
    loaded: boolean;
    hasDefault: boolean;
    loadedAt: string;
    updatedAt: string;
    ratesUpdatedAt?: string;
    ratesSource?: string;
    items: Row[];
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown) => (typeof v === 'number' ? v : null);

const DESCRIPTIONS: Record<string, string> = {
    countries: 'African countries with codes, dialing codes, capitals, currencies and time zones. Used in registration, legal entities and addresses.',
    currencies: 'ISO 4217 currencies with exchange rates against the US dollar. Used for functional currencies and pricing.',
    publicEmailDomains: 'Public webmail domains that cannot register an organization or be used for organization accounts.',
    banks: 'Starter list of banks per African country, used when setting up legal entity bank details.',
    sequences: 'Number sequences used to code records such as organizations.',
};

export default function DefaultValuesPage({ listKey, canWrite, isSuper }: { listKey: string; canWrite: boolean; isSuper: boolean }) {
    if (listKey === 'sequences') {
        return (
            <div>
                <PageTitle title='Code sequences' subtitle={DESCRIPTIONS.sequences} />
                <SequencesCard isSuper={isSuper} />
            </div>
        );
    }
    return <ListPage key={listKey} listKey={listKey} canWrite={canWrite} />;
}

type Pending = { kind: 'restore' | 'clear' } | { kind: 'remove'; code: string; label: string } | null;

function ListPage({ listKey, canWrite }: { listKey: string; canWrite: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<ListData>('/api/admin/reference/list/get', { key: listKey }), [listKey]);
    const [pending, setPending] = useState<Pending>(null);
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState('');
    const [info, setInfo] = useState('');
    const isMeta = listKey.startsWith('meta.');
    const editable = isMeta || listKey === 'publicEmailDomains';

    const columns = useMemo<Array<Column<Row>>>(() => {
        if (listKey === 'countries')
            return [
                { key: 'name', label: 'Country', value: (r) => s(r.name), render: (r) => <span className='whitespace-nowrap'>{s(r.flag)} {s(r.name)}</span> },
                { key: 'iso2', label: 'ISO 2', value: (r) => s(r.iso2) },
                { key: 'iso3', label: 'ISO 3', value: (r) => s(r.iso3) },
                { key: 'dialCode', label: 'Dialing code', value: (r) => s(r.dialCode) },
                { key: 'capital', label: 'Capital', value: (r) => s(r.capital) },
                { key: 'region', label: 'Region', value: (r) => s(r.region) },
                { key: 'currencyCode', label: 'Currency', value: (r) => s(r.currencyCode) },
                { key: 'timezone', label: 'Time zone', value: (r) => s(r.timezone) },
                { key: 'languages', label: 'Languages', value: (r) => (Array.isArray(r.languages) ? r.languages.join(', ') : ''), hidden: true },
            ];
        if (listKey === 'currencies')
            return [
                { key: 'code', label: 'Code', value: (r) => s(r.code), className: 'font-mono' },
                { key: 'name', label: 'Name', value: (r) => s(r.name) },
                { key: 'symbol', label: 'Symbol', value: (r) => s(r.symbol) },
                { key: 'decimals', label: 'Decimals', type: 'number', value: (r) => n(r.decimals) },
                { key: 'usedInAfrica', label: 'Used in Africa', value: (r) => (r.usedInAfrica ? 'Yes' : 'No') },
                { key: 'unitsPerUsd', label: 'Per 1 USD', type: 'number', value: (r) => n(r.unitsPerUsd), render: (r) => formatRate(n(r.unitsPerUsd)) },
                { key: 'usdPerUnit', label: 'USD per unit', type: 'number', value: (r) => n(r.usdPerUnit), render: (r) => formatRate(n(r.usdPerUnit)), hidden: true },
            ];
        if (listKey === 'publicEmailDomains') return [{ key: 'domain', label: 'Domain', value: (r) => s(r.domain), className: 'font-mono' }];
        return [
            { key: 'code', label: 'Code', value: (r) => s(r.code), className: 'font-mono' },
            { key: 'label', label: 'Label', value: (r) => s(r.label) },
        ];
    }, [listKey]);

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load this list.'}</Alert>;

    const run = async (path: string, body: Record<string, unknown>, done: string) => {
        setBusy(path);
        setActionError('');
        setInfo('');
        try {
            await callBackend(path, { key: listKey, ...body });
            setPending(null);
            setAdding(false);
            setInfo(done);
            reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Action failed.');
        } finally {
            setBusy('');
        }
    };

    const updateRates = () => run('/api/admin/reference/rates', {}, 'Exchange rates updated.');
    const subtitle = DESCRIPTIONS[listKey] ?? (data.appliesTo ? `Selectable values for ${data.appliesTo} forms.` : '');

    return (
        <div>
            <PageTitle title={data.label} subtitle={subtitle} />
            <Card className='mb-3'>
                <div className='flex flex-wrap items-center gap-2 text-xs text-slate-400'>
                    {data.loaded ? <Badge tone='brand'>Loaded</Badge> : <Badge tone='danger'>Empty</Badge>}
                    {data.hasDefault ? <Badge>MEMS default available</Badge> : <Badge tone='warn'>Custom list</Badge>}
                    <span className='font-mono text-slate-500'>{listKey}</span>
                    {(data.updatedAt || data.loadedAt) && <span>Updated {fmtDate(data.updatedAt || data.loadedAt)}</span>}
                    {listKey === 'currencies' && data.ratesUpdatedAt && (
                        <span>
                            Rates {fmtDate(data.ratesUpdatedAt)} · {data.ratesSource}
                        </span>
                    )}
                </div>
                {canWrite && (
                    <div className='mt-3 flex flex-wrap gap-2'>
                        {data.hasDefault && (
                            <Button variant={data.loaded ? 'secondary' : 'primary'} onClick={() => setPending({ kind: 'restore' })} disabled={!!busy}>
                                <RotateCcw className='h-4 w-4' />
                                {data.loaded ? 'Restore defaults' : 'Load defaults'}
                            </Button>
                        )}
                        {listKey === 'currencies' && data.loaded && (
                            <Button variant='secondary' busy={busy === '/api/admin/reference/rates'} onClick={updateRates}>
                                <RefreshCw className='h-4 w-4' />
                                Update rates
                            </Button>
                        )}
                        {editable && data.loaded && (
                            <Button variant='secondary' onClick={() => setAdding(true)} disabled={!!busy}>
                                <Plus className='h-4 w-4' />
                                Add entry
                            </Button>
                        )}
                        {data.loaded && (
                            <Button variant='danger' onClick={() => setPending({ kind: 'clear' })} disabled={!!busy}>
                                <Trash2 className='h-4 w-4' />
                                Clear
                            </Button>
                        )}
                    </div>
                )}
                {pending && (
                    <Confirm
                        expected={pending.kind === 'remove' ? pending.code : listKey}
                        title={
                            pending.kind === 'restore'
                                ? `Replace "${data.label}" with the MEMS defaults? Entries added or removed by hand will be lost.`
                                : pending.kind === 'clear'
                                  ? `Remove every entry of "${data.label}"? Forms that use it will have nothing to choose until it is loaded again.`
                                  : `Remove "${pending.label}" from ${data.label}?`
                        }
                        busy={!!busy}
                        danger={pending.kind !== 'restore'}
                        onCancel={() => setPending(null)}
                        onConfirm={(typed) =>
                            pending.kind === 'restore'
                                ? run('/api/admin/reference/list/restore', { confirm: typed }, 'Defaults restored.')
                                : pending.kind === 'clear'
                                  ? run('/api/admin/reference/list/clear', { confirm: typed }, 'List cleared.')
                                  : run('/api/admin/reference/list/entry', { op: 'remove', code: pending.code }, 'Entry removed.')
                        }
                    />
                )}
                {adding && <AddEntry domain={listKey === 'publicEmailDomains'} busy={!!busy} onCancel={() => setAdding(false)} onAdd={(code, label) => run('/api/admin/reference/list/entry', { op: 'add', code, label }, 'Entry added.')} />}
                {actionError && <div className='mt-3'><Alert tone='error'>{actionError}</Alert></div>}
                {info && <div className='mt-3'><Alert tone='info'>{info}</Alert></div>}
            </Card>

            {listKey === 'banks' ? (
                data.loaded ? <BanksPanel canWrite={canWrite} /> : null
            ) : (
                <RichTable<Row>
                    id={`defaults.${listKey}`}
                    title={data.label}
                    fileName={`MEMS_${listKey}`}
                    columns={columns}
                    rows={data.items}
                    rowKey={(r) => s(r.code ?? r.iso2 ?? r.domain)}
                    empty={data.hasDefault ? 'Empty. Use Load defaults above.' : 'Empty.'}
                    height='h-[calc(100dvh-22rem)]'
                    onRowClick={canWrite && editable ? (r) => setPending({ kind: 'remove', code: s(r.code ?? r.domain), label: s(r.label ?? r.domain) }) : undefined}
                />
            )}
            {canWrite && editable && data.loaded && <p className='mt-2 text-xs text-slate-500'>Tap an entry to remove it.</p>}
        </div>
    );
}

function Confirm({ expected, title, busy, danger, onCancel, onConfirm }: { expected: string; title: string; busy: boolean; danger: boolean; onCancel: () => void; onConfirm: (typed: string) => void }) {
    const [typed, setTyped] = useState('');
    const ok = typed.trim() === expected;
    return (
        <div className={`mt-3 space-y-3 rounded-xl border p-3 ${danger ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/40 bg-emerald-500/5'}`}>
            <p className='text-sm text-slate-200'>{title}</p>
            <Field id='confirm-typed' label={`Type ${expected} to confirm`} value={typed} autoComplete='off' autoCapitalize='none' spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
            <div className='flex gap-2'>
                <Button variant={danger ? 'danger' : 'primary'} className='flex-1' busy={busy} disabled={!ok} onClick={() => onConfirm(typed.trim())}>
                    Confirm
                </Button>
                <Button variant='secondary' onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}

function AddEntry({ domain, busy, onAdd, onCancel }: { domain: boolean; busy: boolean; onAdd: (code: string, label: string) => void; onCancel: () => void }) {
    const [code, setCode] = useState('');
    const [label, setLabel] = useState('');
    const [error, setError] = useState('');
    const submit = (e: FormEvent) => {
        e.preventDefault();
        setError('');
        if (domain) {
            const d = code.trim().toLowerCase();
            if (!/^(?=.{4,100}$)([a-z0-9-]+\.)+[a-z]{2,24}$/.test(d)) return setError('Enter a valid domain such as example.com.');
            return onAdd(d, '');
        }
        if (label.trim().length < 1 || label.trim().length > 80) return setError('Enter a label of 1 to 80 characters.');
        if (code && !/^[A-Za-z0-9_ ]{1,60}$/.test(code)) return setError('The code can only use letters, numbers and underscores.');
        onAdd(code.trim(), label.trim());
    };
    return (
        <form onSubmit={submit} noValidate className='mt-3 space-y-3 rounded-xl border border-slate-700 p-3'>
            {domain ? (
                <Field id='entry-domain' label='Domain to block' placeholder='example.com' maxLength={100} value={code} onChange={(e) => setCode(e.target.value)} />
            ) : (
                <>
                    <Field id='entry-label' label='Label' maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
                    <Field id='entry-code' label='Code (optional, made from the label if empty)' maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />
                </>
            )}
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex gap-2'>
                <Button type='submit' className='flex-1' busy={busy}>
                    Add
                </Button>
                <Button type='button' variant='secondary' onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}
