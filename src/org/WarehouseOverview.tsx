import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Spinner, useLoad } from '../admin/kit';
import { Screen, Segmented } from '../components/screen';

// The warehouses this person can see, the material categories each accepts, and the subcategories its clusters hold.
// Where buyer groups are used, the group that buys each subcategory is shown. Read only: the server returns only the
// warehouses the person has access to.

interface Sub {
    code: string;
    name: string;
    categoryCode: string;
    categoryName: string;
    clusters: number;
    positions: number;
    buyerGroup: string;
}
interface Warehouse {
    id: string;
    code: string;
    name: string;
    configured: boolean;
    categories: Array<{ code: string; name: string }>;
    subcategories: Sub[];
}
interface FlatRow {
    key: string;
    warehouse: string;
    code: string;
    category: string;
    subcategory: string;
    subCode: string;
    clusters: number;
    positions: number;
    buyerGroup: string;
}

const COLUMNS: Array<Column<FlatRow>> = [
    { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse },
    { key: 'code', label: 'Code', value: (r) => r.code, hidden: true },
    { key: 'category', label: 'Category', value: (r) => r.category },
    { key: 'subcategory', label: 'Subcategory', value: (r) => r.subcategory },
    { key: 'subCode', label: 'Subcategory code', value: (r) => r.subCode, hidden: true },
    { key: 'clusters', type: 'number', label: 'Clusters', value: (r) => r.clusters },
    { key: 'positions', type: 'number', label: 'Positions', value: (r) => r.positions },
    { key: 'buyerGroup', label: 'Buyer group', value: (r) => r.buyerGroup || 'Not assigned' },
];

export default function WarehouseOverview({ back }: { back: string }) {
    const { data, error, loading } = useLoad(() => callBackend<{ warehouses: Warehouse[] }>('/api/org/warehouse/overview', {}));
    const [view, setView] = useState<'cards' | 'table'>('cards');
    const [q, setQ] = useState('');
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const term = q.trim().toLowerCase();

    const list = useMemo(
        () => (data?.warehouses ?? []).filter((w) => !term || `${w.code} ${w.name} ${w.categories.map((c) => c.name).join(' ')} ${w.subcategories.map((s) => s.name).join(' ')}`.toLowerCase().includes(term)),
        [data, term]
    );
    const flat: FlatRow[] = useMemo(
        () => (data?.warehouses ?? []).flatMap((w) => w.subcategories.map((s) => ({ key: `${w.id}|${s.code}`, warehouse: w.name, code: w.code, category: s.categoryName, subcategory: s.name, subCode: s.code, clusters: s.clusters, positions: s.positions, buyerGroup: s.buyerGroup }))),
        [data]
    );

    return (
        <Screen
            title='Warehouses'
            subtitle='What each warehouse you can see accepts'
            onBack={() => navigate(back)}
            toolbar={
                <div className='space-y-2'>
                    <Segmented label='Warehouse views' value={view} options={[{ value: 'cards', label: 'Warehouses', count: data?.warehouses.length }, { value: 'table', label: 'Subcategory table', count: flat.length }]} onChange={setView} />
                    {view === 'cards' && (
                        <div className='relative'>
                            <Search className='pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted' />
                            <input aria-label='Search warehouses' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search warehouse, category or subcategory' className='h-12 w-full rounded-xl border border-line bg-panel pl-9 pr-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none' />
                        </div>
                    )}
                </div>
            }
        >
            {loading && !data ? (
                <Spinner />
            ) : error || !data ? (
                <Alert tone='error'>{error || 'Could not load the warehouses.'}</Alert>
            ) : view === 'table' ? (
                <RichTable id='whs.overview' title='Warehouse subcategories' columns={COLUMNS} rows={flat} rowKey={(r) => r.key} empty='No warehouse has clusters with subcategories yet.' fileName='warehouse-subcategories' height='h-[calc(100dvh-20rem)]' />
            ) : list.length === 0 ? (
                <p className='text-sm text-muted'>{data.warehouses.length === 0 ? 'No warehouse is visible to you. Warehouses are cost centers of type Inventory or Warehousing that you have access to.' : 'Nothing matches your search.'}</p>
            ) : (
                list.map((w) => {
                    const isOpen = open[w.id] ?? !!term;
                    return (
                        <section key={w.id} className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                            <button type='button' aria-expanded={isOpen} onClick={() => setOpen({ ...open, [w.id]: !isOpen })} className='flex min-h-11 w-full items-center gap-2 text-left'>
                                {isOpen ? <ChevronDown className='h-4 w-4 shrink-0' /> : <ChevronRight className='h-4 w-4 shrink-0' />}
                                <span className='min-w-0 flex-1'>
                                    <span className='block font-mono text-xs text-brandsoft'>{w.code}</span>
                                    <span className='block truncate text-sm font-semibold text-ink'>{w.name}</span>
                                </span>
                                <Badge tone={w.configured ? 'brand' : 'warn'}>{w.configured ? `${w.subcategories.length} subcategories` : 'Not set up'}</Badge>
                            </button>
                            <div className='flex flex-wrap gap-1'>
                                {w.categories.map((c) => (
                                    <Badge key={c.code} tone='muted'>{c.name}</Badge>
                                ))}
                                {w.configured && w.categories.length === 0 && <span className='text-xs text-muted'>No material categories chosen.</span>}
                            </div>
                            {isOpen && (
                                <ul className='max-h-72 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                                    {w.subcategories.length === 0 && <li className='px-3 py-2 text-xs text-muted'>{w.configured ? 'No cluster holds subcategories yet.' : 'Storage has not been set up for this warehouse.'}</li>}
                                    {w.subcategories.map((s) => (
                                        <li key={s.code} className='px-3 py-2 text-xs'>
                                            <p className='text-ink'>{s.name} <span className='text-muted'>· {s.categoryName}</span></p>
                                            <p className='text-muted'>{s.clusters} cluster{s.clusters === 1 ? '' : 's'} · {s.positions} positions · {s.buyerGroup ? `Buyer group ${s.buyerGroup}` : 'No buyer group'}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    );
                })
            )}
        </Screen>
    );
}
