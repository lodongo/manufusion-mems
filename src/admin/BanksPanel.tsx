import { useMemo, useState, type FormEvent } from 'react';
import { Landmark, Plus, Upload } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { fetchReference } from '../lib/reference';
import { Alert, Field, SelectField } from '../components/ui';
import { fmtDate } from './format';
import { Badge, Button, Card, Empty, Spinner, TextArea, Toggle, useLoad } from './kit';
import { appConfirm } from '../components/dialogs';

interface Bank {
    id: string;
    countryCode: string;
    countryName: string;
    name: string;
    shortName: string;
    type: string;
    swiftCode: string;
    website: string;
    active: boolean;
    verified: boolean;
}

interface BanksData {
    loaded: boolean;
    items: Bank[];
    loadedAt: string;
    updatedAt: string;
    types: string[];
}

const TYPE_LABELS: Record<string, string> = {
    central: 'Central bank',
    commercial: 'Commercial',
    islamic: 'Islamic',
    development: 'Development',
    microfinance: 'Microfinance',
    regional: 'Regional / pan-African',
};

export default function BanksPanel({ canWrite }: { canWrite: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<BanksData>('/api/admin/banks/list'));
    const [country, setCountry] = useState('');
    const [type, setType] = useState('');
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState<Bank | 'new' | null>(null);
    const [importing, setImporting] = useState(false);

    const countries = useMemo(() => {
        const map = new Map<string, string>();
        for (const b of data?.items ?? []) map.set(b.countryCode, b.countryName);
        return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    }, [data]);

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (data?.items ?? []).filter(
            (b) =>
                (!country || b.countryCode === country) &&
                (!type || b.type === type) &&
                (!q || `${b.name} ${b.shortName} ${b.swiftCode} ${b.countryName}`.toLowerCase().includes(q))
        );
    }, [data, country, type, search]);

    const done = () => {
        setEditing(null);
        setImporting(false);
        reload();
    };

    return (
        <Card>
            <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                <div className='flex items-center gap-2'>
                    <Landmark className='h-5 w-5 text-emerald-400' />
                    <h2 className='text-lg font-semibold text-white'>African banks</h2>
                </div>
                {canWrite && data?.loaded && !editing && !importing && (
                    <div className='flex gap-2'>
                        <Button variant='secondary' onClick={() => setImporting(true)} aria-label='Import banks from CSV'>
                            <Upload className='h-4 w-4' />
                        </Button>
                        <Button onClick={() => setEditing('new')}>
                            <Plus className='h-4 w-4' />
                            Add bank
                        </Button>
                    </div>
                )}
            </div>

            {loading && !data ? (
                <Spinner />
            ) : error ? (
                <Alert tone='error'>{error}</Alert>
            ) : !data?.loaded ? (
                <Empty>Not loaded. Use Load defaults above.</Empty>
            ) : editing ? (
                <BankForm bank={editing === 'new' ? undefined : editing} types={data.types} canWrite={canWrite} onDone={done} onCancel={() => setEditing(null)} />
            ) : importing ? (
                <BankImport onDone={done} onCancel={() => setImporting(false)} />
            ) : (
                <>
                    <p className='mb-3 text-xs text-slate-500'>
                        {data.items.length} banks in {countries.length} countries · starter list, verify against each central bank register · updated {fmtDate(data.updatedAt || data.loadedAt)}
                    </p>
                    <div className='mb-3 grid gap-2 sm:grid-cols-3'>
                        <select aria-label='Filter by country' value={country} onChange={(e) => setCountry(e.target.value)} className='h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white'>
                            <option value=''>All countries</option>
                            {countries.map(([code, name]) => (
                                <option key={code} value={code}>
                                    {name}
                                </option>
                            ))}
                        </select>
                        <select aria-label='Filter by type' value={type} onChange={(e) => setType(e.target.value)} className='h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white'>
                            <option value=''>All types</option>
                            {data.types.map((t) => (
                                <option key={t} value={t}>
                                    {TYPE_LABELS[t] ?? t}
                                </option>
                            ))}
                        </select>
                        <input
                            type='search'
                            placeholder='Search name or SWIFT'
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className='h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
                        />
                    </div>
                    {rows.length === 0 ? (
                        <Empty>No banks match.</Empty>
                    ) : (
                        <ul className='max-h-[28rem] divide-y divide-slate-800 overflow-y-auto'>
                            {rows.map((b) => (
                                <li key={b.id}>
                                    <button onClick={() => setEditing(b)} className='flex w-full items-start justify-between gap-3 py-2 text-left'>
                                        <div className='min-w-0'>
                                            <p className='truncate text-sm text-white'>{b.name}</p>
                                            <p className='truncate text-xs text-slate-500'>
                                                {b.countryName} · {TYPE_LABELS[b.type] ?? b.type}
                                                {b.shortName ? ` · ${b.shortName}` : ''}
                                            </p>
                                        </div>
                                        <div className='flex shrink-0 flex-col items-end gap-1'>
                                            {b.swiftCode && <span className='font-mono text-xs text-slate-300'>{b.swiftCode}</span>}
                                            {b.verified ? <Badge tone='brand'>Verified</Badge> : <Badge>Unverified</Badge>}
                                            {!b.active && <Badge tone='danger'>Inactive</Badge>}
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className='mt-2 text-xs text-slate-500'>{rows.length} shown</p>
                </>
            )}
        </Card>
    );
}

function BankForm({ bank, types, canWrite, onDone, onCancel }: { bank?: Bank; types: string[]; canWrite: boolean; onDone: () => void; onCancel: () => void }) {
    const ref = useLoad(() => fetchReference());
    const [countryCode, setCountryCode] = useState(bank?.countryCode ?? '');
    const [name, setName] = useState(bank?.name ?? '');
    const [shortName, setShortName] = useState(bank?.shortName ?? '');
    const [type, setType] = useState(bank?.type ?? 'commercial');
    const [swiftCode, setSwiftCode] = useState(bank?.swiftCode ?? '');
    const [website, setWebsite] = useState(bank?.website ?? '');
    const [active, setActive] = useState(bank?.active ?? true);
    const [verified, setVerified] = useState(bank?.verified ?? false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const ro = !canWrite;
    const countries = [...(ref.data?.countries ?? [])].sort((a, b) => a.name.localeCompare(b.name));

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setBusy('save');
        try {
            await callBackend('/api/admin/banks/save', { id: bank?.id, bank: { countryCode, name, shortName, type, swiftCode, website, active, verified } });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy('');
        }
    };

    const remove = async () => {
        if (!bank || !(await appConfirm(`Delete ${bank.name}?`))) return;
        setBusy('delete');
        try {
            await callBackend('/api/admin/banks/delete', { id: bank.id });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete.');
            setBusy('');
        }
    };

    return (
        <form onSubmit={submit} noValidate className='space-y-4' aria-label='Bank'>
            <SelectField id='bank-country' label='Country' value={countryCode} disabled={ro} onChange={(e) => setCountryCode(e.target.value)}>
                <option value=''>Select...</option>
                {countries.map((c) => (
                    <option key={c.iso2} value={c.iso2}>
                        {c.flag} {c.name}
                    </option>
                ))}
            </SelectField>
            <Field id='bank-name' label='Bank name' maxLength={120} value={name} disabled={ro} onChange={(e) => setName(e.target.value)} />
            <div className='grid grid-cols-2 gap-3'>
                <Field id='bank-short' label='Short name' maxLength={40} value={shortName} disabled={ro} onChange={(e) => setShortName(e.target.value)} />
                <SelectField id='bank-type' label='Type' value={type} disabled={ro} onChange={(e) => setType(e.target.value)}>
                    {types.map((t) => (
                        <option key={t} value={t}>
                            {TYPE_LABELS[t] ?? t}
                        </option>
                    ))}
                </SelectField>
            </div>
            <Field id='bank-swift' label='SWIFT / BIC (optional)' maxLength={11} autoCapitalize='characters' value={swiftCode} disabled={ro} onChange={(e) => setSwiftCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <Field id='bank-website' label='Website (optional, https://)' maxLength={200} value={website} disabled={ro} onChange={(e) => setWebsite(e.target.value)} />
            <div className='flex items-center justify-between'>
                <span className='text-sm text-slate-300'>Active</span>
                <Toggle label='Active' checked={active} disabled={ro} onChange={setActive} />
            </div>
            <div className='flex items-center justify-between'>
                <span className='text-sm text-slate-300'>Verified against central bank register</span>
                <Toggle label='Verified' checked={verified} disabled={ro} onChange={setVerified} />
            </div>
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex flex-wrap gap-2'>
                {canWrite && (
                    <Button type='submit' className='flex-1' busy={busy === 'save'} disabled={!!busy}>
                        {bank ? 'Save bank' : 'Add bank'}
                    </Button>
                )}
                <Button type='button' variant='secondary' onClick={onCancel}>
                    Back
                </Button>
                {canWrite && bank && (
                    <Button type='button' variant='danger' busy={busy === 'delete'} disabled={!!busy} onClick={remove}>
                        Delete
                    </Button>
                )}
            </div>
        </form>
    );
}

function BankImport({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
    const [csv, setCsv] = useState('');
    const [mode, setMode] = useState('append');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (mode === 'replace' && !(await appConfirm('Replace the entire bank list with these rows?'))) return;
        setBusy(true);
        setError('');
        setInfo('');
        try {
            const res = await callBackend<{ imported: number; total: number }>('/api/admin/banks/import', { csv, mode });
            setInfo(`${res.imported} banks imported. ${res.total} banks in total.`);
            setTimeout(onDone, 1200);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Import failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate className='space-y-4' aria-label='Import banks'>
            <p className='text-sm text-slate-400'>
                One bank per line: <span className='font-mono text-xs'>country_code,name,short_name,type,swift,website</span>. Types: central, commercial, islamic, development, microfinance, regional. Existing banks with the same country and name are updated.
            </p>
            <TextArea id='bank-csv' label='CSV rows' rows={10} placeholder={'KE,Example Bank Kenya,EBK,commercial,EXBKKENA,https://example.co.ke'} value={csv} onChange={(e) => setCsv(e.target.value)} />
            <SelectField id='bank-import-mode' label='Mode' value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value='append'>Add and update</option>
                <option value='replace'>Replace the whole list</option>
            </SelectField>
            {error && <Alert tone='error'>{error}</Alert>}
            {info && <Alert tone='info'>{info}</Alert>}
            <div className='flex gap-2'>
                <Button type='submit' className='flex-1' busy={busy}>
                    Import
                </Button>
                <Button type='button' variant='secondary' onClick={onCancel}>
                    Back
                </Button>
            </div>
        </form>
    );
}
