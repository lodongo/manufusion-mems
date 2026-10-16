import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database, FileText, Folder, Home, Loader2, Lock } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { fmtDate } from './format';
import { Badge, Card, Empty, PageTitle, Spinner, useLoad } from './kit';

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

export default function ExplorerPage() {
    const [path, setPath] = useState('');
    const segments = path ? path.split('/') : [];
    const isCollection = segments.length % 2 === 1;
    const go = (next: string) => {
        setPath(next);
        window.scrollTo(0, 0);
    };

    return (
        <div>
            <PageTitle title='Database explorer' subtitle='Read-only view of Cloud Firestore (default) database' />
            <div className='mb-3 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400'>
                <Lock className='h-3.5 w-3.5 shrink-0' />
                View only. Nothing can be changed here.
            </div>
            <nav aria-label='Path' className='mb-4 flex flex-wrap items-center gap-1 text-sm'>
                <button onClick={() => go('')} className='flex items-center gap-1 rounded-lg px-2 py-1 text-emerald-300'>
                    <Home className='h-4 w-4' />
                    Root
                </button>
                {segments.map((seg, i) => (
                    <span key={`${seg}-${i}`} className='flex items-center gap-1'>
                        <ChevronRight className='h-3.5 w-3.5 text-slate-600' />
                        <button
                            onClick={() => go(segments.slice(0, i + 1).join('/'))}
                            className={`max-w-[10rem] truncate rounded-lg px-2 py-1 ${i === segments.length - 1 ? 'bg-slate-800 text-white' : 'text-emerald-300'} ${i % 2 === 1 ? 'font-mono text-xs' : ''}`}
                        >
                            {seg}
                        </button>
                    </span>
                ))}
            </nav>
            {!path ? (
                <CollectionList parent='' onOpen={(id) => go(id)} />
            ) : isCollection ? (
                <DocumentList key={path} path={path} onOpen={(id) => go(`${path}/${id}`)} />
            ) : (
                <DocumentView key={path} path={path} onOpenCollection={(c) => go(`${path}/${c}`)} />
            )}
        </div>
    );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
    return (
        <input
            type='search'
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className='mb-3 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
        />
    );
}

function CollectionList({ parent, onOpen }: { parent: string; onOpen: (id: string) => void }) {
    const { data, error, loading } = useLoad(() => callBackend<{ collections: string[] }>('/api/admin/explorer/collections', { path: parent }), [parent]);
    const [q, setQ] = useState('');
    const rows = (data?.collections ?? []).filter((c) => c.toLowerCase().includes(q.trim().toLowerCase()));
    if (loading && !data) return <Spinner />;
    if (error) return <Alert tone='error'>{error}</Alert>;
    return (
        <div>
            <SearchBox value={q} onChange={setQ} placeholder='Filter collections' />
            {rows.length === 0 ? (
                <Empty>No collections.</Empty>
            ) : (
                <Card className='p-0'>
                    <ul className='divide-y divide-slate-800'>
                        {rows.map((c) => (
                            <li key={c}>
                                <button onClick={() => onOpen(c)} className='flex w-full items-center gap-3 px-4 py-3 text-left'>
                                    <Folder className='h-5 w-5 shrink-0 text-amber-400' />
                                    <span className='flex-1 truncate text-sm text-white'>{c}</span>
                                    <ChevronRight className='h-4 w-4 text-slate-500' />
                                </button>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}

interface DocRow {
    id: string;
    exists: boolean;
    fieldCount: number;
    label: string;
    updateTime: string;
}

function DocumentList({ path, onOpen }: { path: string; onOpen: (id: string) => void }) {
    const [rows, setRows] = useState<DocRow[]>([]);
    const [token, setToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [q, setQ] = useState('');

    const load = async (pageToken: string) => {
        setLoading(true);
        setError('');
        try {
            const res = await callBackend<{ documents: DocRow[]; nextPageToken: string }>('/api/admin/explorer/documents', { path, pageToken });
            setRows((prev) => (pageToken ? [...prev, ...res.documents] : res.documents));
            setToken(res.nextPageToken);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load documents.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path]);

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return rows.filter((r) => !s || `${r.id} ${r.label}`.toLowerCase().includes(s));
    }, [rows, q]);

    if (loading && rows.length === 0) return <Spinner />;
    if (error && rows.length === 0) return <Alert tone='error'>{error}</Alert>;

    return (
        <div>
            <SearchBox value={q} onChange={setQ} placeholder='Filter loaded documents' />
            <p className='mb-2 text-xs text-slate-500'>
                {rows.length} document{rows.length === 1 ? '' : 's'} loaded{token ? ' · more available' : ''}
            </p>
            {filtered.length === 0 ? (
                <Empty>No documents.</Empty>
            ) : (
                <Card className='p-0'>
                    <ul className='divide-y divide-slate-800'>
                        {filtered.map((r) => (
                            <li key={r.id}>
                                <button onClick={() => onOpen(r.id)} className='flex w-full items-center gap-3 px-4 py-3 text-left'>
                                    <FileText className={`h-5 w-5 shrink-0 ${r.exists ? 'text-sky-400' : 'text-slate-600'}`} />
                                    <div className='min-w-0 flex-1'>
                                        <p className='truncate font-mono text-xs text-white'>{r.id}</p>
                                        <p className='truncate text-xs text-slate-500'>
                                            {r.exists ? `${r.label ? `${r.label} · ` : ''}${r.fieldCount} fields` : 'No fields, sub-collections only'}
                                        </p>
                                    </div>
                                    <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                                </button>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
            {token && (
                <button onClick={() => void load(token)} disabled={loading} className='mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm text-slate-200 disabled:opacity-50'>
                    {loading && <Loader2 className='h-4 w-4 animate-spin' />}
                    Load more
                </button>
            )}
            {error && rows.length > 0 && <div className='mt-3'><Alert tone='error'>{error}</Alert></div>}
        </div>
    );
}

interface DocData {
    exists: boolean;
    fields: { [key: string]: Value };
    createTime: string;
    updateTime: string;
    subcollections: string[];
}

function DocumentView({ path, onOpenCollection }: { path: string; onOpenCollection: (c: string) => void }) {
    const { data, error, loading } = useLoad(() => callBackend<DocData>('/api/admin/explorer/document', { path }), [path]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the document.'}</Alert>;
    const keys = Object.keys(data.fields);
    return (
        <div className='space-y-4'>
            <Card>
                <div className='flex items-center gap-2'>
                    <Database className='h-4 w-4 text-sky-400' />
                    <p className='break-all font-mono text-xs text-white'>{path}</p>
                </div>
                <p className='mt-1 text-xs text-slate-500'>
                    {data.exists ? `Created ${fmtDate(data.createTime)} · Updated ${fmtDate(data.updateTime)}` : 'This document has no fields, only sub-collections.'}
                </p>
            </Card>
            {data.subcollections.length > 0 && (
                <Card className='p-0'>
                    <p className='px-4 pt-3 text-xs font-medium uppercase tracking-wide text-slate-500'>Sub-collections</p>
                    <ul className='divide-y divide-slate-800'>
                        {data.subcollections.map((c) => (
                            <li key={c}>
                                <button onClick={() => onOpenCollection(c)} className='flex w-full items-center gap-3 px-4 py-3 text-left'>
                                    <Folder className='h-5 w-5 shrink-0 text-amber-400' />
                                    <span className='flex-1 truncate text-sm text-white'>{c}</span>
                                    <ChevronRight className='h-4 w-4 text-slate-500' />
                                </button>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
            {data.exists && (
                <Card>
                    <p className='mb-2 text-xs font-medium uppercase tracking-wide text-slate-500'>Fields ({keys.length})</p>
                    {keys.length === 0 ? (
                        <Empty>No fields.</Empty>
                    ) : (
                        <div className='space-y-1'>
                            {keys.sort().map((k) => (
                                <ValueView key={k} name={k} value={data.fields[k]} depth={0} />
                            ))}
                        </div>
                    )}
                    <p className='mt-3 text-xs text-slate-500'>Long text is shortened and long lists show their first 50 items.</p>
                </Card>
            )}
        </div>
    );
}

function typeLabel(value: Value): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `array · ${value.length}`;
    if (typeof value === 'object') return `map · ${Object.keys(value).length}`;
    return typeof value;
}

function ValueView({ name, value, depth }: { name: string; value: Value; depth: number }) {
    const [open, setOpen] = useState(false);
    const nested = value !== null && typeof value === 'object';
    if (!nested) {
        const tone = typeof value === 'number' ? 'text-amber-300' : typeof value === 'boolean' ? 'text-sky-300' : value === null ? 'text-slate-500' : 'text-white';
        return (
            <div className='flex gap-2 py-1 text-sm'>
                <span className='shrink-0 font-mono text-xs text-emerald-300'>{name}</span>
                <span className={`min-w-0 break-words ${tone}`}>{value === null ? 'null' : value === '' ? '—' : String(value)}</span>
            </div>
        );
    }
    const entries: Array<[string, Value]> = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    return (
        <div>
            <button onClick={() => setOpen(!open)} className='flex w-full items-center gap-1 py-1 text-left text-sm'>
                {open ? <ChevronDown className='h-4 w-4 text-slate-500' /> : <ChevronRight className='h-4 w-4 text-slate-500' />}
                <span className='font-mono text-xs text-emerald-300'>{name}</span>
                <Badge>{typeLabel(value)}</Badge>
            </button>
            {open && (
                <div className='ml-2 border-l border-slate-800 pl-3'>
                    {entries.length === 0 ? <p className='py-1 text-xs text-slate-500'>Empty</p> : entries.map(([k, v]) => <ValueView key={k} name={k} value={v} depth={depth + 1} />)}
                </div>
            )}
        </div>
    );
}
