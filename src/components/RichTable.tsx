import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, BookmarkPlus, ChevronDown, ChevronUp, Columns3, Download, Eye, EyeOff, Filter, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { buildXlsx, downloadBlob, type Cell } from '../lib/xlsx';
import { firebaseAuth } from '../firebase';
import { callBackend } from '../lib/backend';

// Rich data table used everywhere MEMS shows records:
// global search, criteria filters, sortable columns, show/hide/reorder columns,
// Excel download, saved templates (per browser), lazy rendering and an always-visible action bar.
// The table body scrolls inside its own frame so the page itself never scrolls.

export interface Column<T> {
    key: string;
    label: string;
    type?: 'text' | 'number' | 'date';
    /** Value used for search, filters, sorting and Excel. */
    value: (row: T) => string | number | null | undefined;
    /** Optional custom cell rendering. */
    render?: (row: T) => ReactNode;
    /** Hidden until the user adds it from the column manager. */
    hidden?: boolean;
    className?: string;
}

type Op = 'contains' | 'not_contains' | 'eq' | 'neq' | 'starts' | 'ends' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'in' | 'empty' | 'not_empty';

interface Criterion {
    col: string;
    op: Op;
    value: string;
    value2?: string;
}

interface View {
    order: string[];
    hidden: string[];
    sort: { col: string; dir: 'asc' | 'desc' } | null;
    criteria: Criterion[];
}

interface Template extends View {
    name: string;
}

interface CloudTemplate {
    id: string;
    tableId: string;
    name: string;
    title: string;
    route: string;
    tabKey?: string;
    view: View;
    updatedAt?: string;
}

const OPS: Array<{ op: Op; label: string; needs: 0 | 1 | 2 }> = [
    { op: 'contains', label: 'Contains', needs: 1 },
    { op: 'not_contains', label: 'Does not contain', needs: 1 },
    { op: 'eq', label: 'Equals', needs: 1 },
    { op: 'neq', label: 'Not equal to', needs: 1 },
    { op: 'starts', label: 'Starts with', needs: 1 },
    { op: 'ends', label: 'Ends with', needs: 1 },
    { op: 'lt', label: 'Less than', needs: 1 },
    { op: 'lte', label: 'Less than or equal', needs: 1 },
    { op: 'gt', label: 'Greater than', needs: 1 },
    { op: 'gte', label: 'Greater than or equal', needs: 1 },
    { op: 'between', label: 'Between', needs: 2 },
    { op: 'in', label: 'In list (comma separated)', needs: 1 },
    { op: 'empty', label: 'Is empty', needs: 0 },
    { op: 'not_empty', label: 'Is not empty', needs: 0 },
];

const PAGE = 60;
const store = {
    get<T>(key: string, fallback: T): T {
        try {
            const raw = localStorage.getItem(key);
            return raw ? (JSON.parse(raw) as T) : fallback;
        } catch {
            return fallback;
        }
    },
    set(key: string, value: unknown) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            /* storage unavailable: templates simply are not kept */
        }
    },
};

function toComparable(v: string | number | null | undefined, type: Column<unknown>['type']): number | string {
    if (v === null || v === undefined) return '';
    if (type === 'number') return typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')) || 0;
    if (type === 'date') {
        const t = Date.parse(String(v));
        return Number.isNaN(t) ? String(v) : t;
    }
    return String(v).toLowerCase();
}

function matches(raw: string | number | null | undefined, c: Criterion, type: Column<unknown>['type']): boolean {
    const text = raw === null || raw === undefined ? '' : String(raw);
    const lower = text.toLowerCase();
    const q = c.value.trim().toLowerCase();
    const num = (s: string) => (type === 'date' ? Date.parse(s) : Number(s.replace(/,/g, '')));
    const left = type === 'date' ? Date.parse(text) : typeof raw === 'number' ? raw : Number(text.replace(/,/g, ''));
    switch (c.op) {
        case 'contains':
            return lower.includes(q);
        case 'not_contains':
            return !lower.includes(q);
        case 'eq':
            return lower === q;
        case 'neq':
            return lower !== q;
        case 'starts':
            return lower.startsWith(q);
        case 'ends':
            return lower.endsWith(q);
        case 'lt':
        case 'lte':
        case 'gt':
        case 'gte': {
            const right = num(c.value);
            if (Number.isNaN(left) || Number.isNaN(right)) {
                if (c.op === 'lt') return lower < q;
                if (c.op === 'lte') return lower <= q;
                if (c.op === 'gt') return lower > q;
                return lower >= q;
            }
            if (c.op === 'lt') return left < right;
            if (c.op === 'lte') return left <= right;
            if (c.op === 'gt') return left > right;
            return left >= right;
        }
        case 'between': {
            const a = num(c.value);
            const b = num(c.value2 ?? '');
            if (Number.isNaN(left) || Number.isNaN(a) || Number.isNaN(b)) return false;
            return left >= Math.min(a, b) && left <= Math.max(a, b);
        }
        case 'in':
            return q
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .includes(lower);
        case 'empty':
            return text.trim() === '';
        case 'not_empty':
            return text.trim() !== '';
        default:
            return true;
    }
}

export default function RichTable<T>({
    id,
    title,
    tabKey,
    columns,
    rows,
    rowKey,
    onRowClick,
    actions,
    empty = 'Nothing to show.',
    fileName,
    height = 'h-[calc(100dvh-12rem)]',
    rowClassName,
}: {
    /** Unique id used to remember templates for this table. */
    id: string;
    title?: string;
    /** Visible tab within the page, persisted with personal table views. */
    tabKey?: string;
    columns: Array<Column<T>>;
    rows: T[];
    rowKey: (row: T) => string;
    onRowClick?: (row: T) => void;
    /** Extra buttons shown in the action bar (e.g. Add). */
    actions?: ReactNode;
    empty?: string;
    fileName?: string;
    height?: string;
    rowClassName?: (row: T) => string;
}) {
    // Keep device templates isolated by the authenticated account. Older browser-only
    // templates are available to import explicitly rather than silently assigning
    // another person's saved filters to the current user on a shared device.
    const ownerUid = firebaseAuth.currentUser?.uid || 'public';
    const storeKey = `mems.table.${ownerUid}.${id}`;
    const legacyKey = `mems.table.${id}`;
    const route = window.location.hash.replace(/^#\/?/, '');
    const canSync = !!firebaseAuth.currentUser && /^organization_(home|admin)\/[A-Za-z0-9_/-]{1,145}$/.test(route);
    const defaults = useMemo<View>(() => ({ order: columns.map((c) => c.key), hidden: columns.filter((c) => c.hidden).map((c) => c.key), sort: null, criteria: [] }), [columns]);
    const [view, setView] = useState<View>(() => {
        const saved = store.get<View | null>(`${storeKey}.current`, null);
        return saved ? { ...defaults, ...saved } : defaults;
    });
    const [templates, setTemplates] = useState<Template[]>(() => store.get<Template[]>(`${storeKey}.templates`, []));
    const [legacyTemplates] = useState<Template[]>(() => store.get<Template[]>(`${legacyKey}.templates`, []));
    const [cloudTemplates, setCloudTemplates] = useState<CloudTemplate[]>([]);
    const [syncBusy, setSyncBusy] = useState('');
    const [templateInfo, setTemplateInfo] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [templateError, setTemplateError] = useState('');
    const [search, setSearch] = useState('');
    const [panel, setPanel] = useState<'' | 'filters' | 'columns' | 'templates'>('');
    const [limit, setLimit] = useState(PAGE);
    const scroller = useRef<HTMLDivElement>(null);

    // Keep the view consistent with the current column set (new columns appear, removed ones drop out).
    const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
    const order = useMemo(() => {
        const known = view.order.filter((k) => byKey.has(k));
        return [...known, ...columns.map((c) => c.key).filter((k) => !known.includes(k))];
    }, [view.order, byKey, columns]);
    const visible = useMemo(() => order.filter((k) => !view.hidden.includes(k)).map((k) => byKey.get(k) as Column<T>), [order, view.hidden, byKey]);

    useEffect(() => store.set(`${storeKey}.current`, view), [storeKey, view]);
    useEffect(() => {
        if (!canSync) return;
        let alive = true;
        void callBackend<{ items: CloudTemplate[] }>('/api/org/my-tables/list')
            .then((r) => {
                if (alive) setCloudTemplates(r.items.filter((entry) => entry.tableId === id));
            })
            .catch(() => undefined);
        return () => { alive = false; };
    }, [id, canSync]);

    useEffect(() => {
        if (!canSync || !cloudTemplates.length) return;
        let pending = '';
        try { pending = sessionStorage.getItem('mems.table.open.' + id) || ''; }
        catch { /* Session storage may be unavailable. */ }
        if (!pending) return;
        const selected = cloudTemplates.find((entry) => entry.id === pending);
        if (!selected) return;
        setView({ ...defaults, ...selected.view });
        setPanel('');
        try { sessionStorage.removeItem('mems.table.open.' + id); } catch { /* Nothing else required. */ }
    }, [cloudTemplates, canSync, id, defaults]);
    useEffect(() => {
        setLimit(PAGE);
        scroller.current?.scrollTo({ top: 0 });
    }, [search, view.criteria, view.sort, rows]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let out = rows.filter((r) => {
            if (q && !visible.some((c) => String(c.value(r) ?? '').toLowerCase().includes(q))) return false;
            for (const cr of view.criteria) {
                const col = byKey.get(cr.col);
                if (!col) continue;
                if (!matches(col.value(r), cr, col.type)) return false;
            }
            return true;
        });
        if (view.sort) {
            const col = byKey.get(view.sort.col);
            if (col) {
                const dir = view.sort.dir === 'asc' ? 1 : -1;
                out = [...out].sort((a, b) => {
                    const x = toComparable(col.value(a), col.type);
                    const y = toComparable(col.value(b), col.type);
                    return x < y ? -dir : x > y ? dir : 0;
                });
            }
        }
        return out;
    }, [rows, search, view.criteria, view.sort, byKey, visible]);

    const onScroll = () => {
        const el = scroller.current;
        if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 300 && limit < filtered.length) setLimit((l) => l + PAGE);
    };

    const toggleSort = (key: string) =>
        setView((v) => ({
            ...v,
            sort: v.sort?.col !== key ? { col: key, dir: 'asc' } : v.sort.dir === 'asc' ? { col: key, dir: 'desc' } : null,
        }));

    const move = (key: string, delta: number) =>
        setView((v) => {
            const next = [...order];
            const i = next.indexOf(key);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= next.length) return v;
            [next[i], next[j]] = [next[j], next[i]];
            return { ...v, order: next };
        });

    const toggleHidden = (key: string) =>
        setView((v) => {
            const isHidden = v.hidden.includes(key);
            if (!isHidden && order.length - v.hidden.length <= 1) return v;
            return { ...v, hidden: isHidden ? v.hidden.filter((k) => k !== key) : [...v.hidden, key] };
        });

    const exportExcel = () => {
        const header = visible.map((c) => c.label);
        const data: Cell[][] = filtered.map((r) => visible.map((c) => c.value(r) ?? ''));
        const stamp = new Date().toISOString().slice(0, 10);
        downloadBlob(buildXlsx(title || 'Data', header, data), `${(fileName || title || id).replace(/[^A-Za-z0-9_-]+/g, '_')}_${stamp}.xlsx`);
    };

    const saveCloud = async (template: Template) => {
        if (!canSync) return;
        setSyncBusy(template.name);
        setTemplateError('');
        try {
            const response = await callBackend<{ item: CloudTemplate }>('/api/org/my-tables/save', {
                tableId: id,
                title: title || fileName || id,
                route,
                tabKey: tabKey || '',
                name: template.name,
                view: {
                    order: template.order,
                    hidden: template.hidden,
                    sort: template.sort,
                    criteria: template.criteria,
                },
            });
            setCloudTemplates((previous) => [
                ...previous.filter((t) => t.name.toLowerCase() !== template.name.toLowerCase()),
                response.item,
            ]);
            setTemplateInfo('Saved in My Tables. Your view is available after signing in on another device.');
        } catch (error) {
            setTemplateError('Saved on this device only. Could not sync to My Tables: ' +
                (error instanceof Error ? error.message : 'Please retry.'));
        } finally {
            setSyncBusy('');
        }
    };

    // Save the current table configuration for this account and sync it to My Tables.
    const saveTemplate = () => {
        const name = templateName.trim();
        if (!name) return setTemplateError('Enter a template name.');
        if (name.length > 40) return setTemplateError('Use up to 40 characters.');
        const template = { ...view, order, name };
        const next = [...templates.filter((t) => t.name !== name), template];
        setTemplates(next);
        store.set(`${storeKey}.templates`, next);
        setTemplateName('');
        setTemplateError('');
        setTemplateInfo(canSync ? 'Saved on this device; syncing to My Tables…' : 'Saved on this device.');
        if (canSync) void saveCloud(template);
    };

    const deleteTemplate = (name: string, cloudId?: string) => {
        const next = templates.filter((t) => t.name !== name);
        setTemplates(next);
        store.set(`${storeKey}.templates`, next);
        if (cloudId && canSync) {
            void callBackend('/api/org/my-tables/delete', { id: cloudId })
                .then(() => setCloudTemplates((saved) => saved.filter((entry) => entry.id !== cloudId)))
                .catch((error: unknown) => setTemplateError(error instanceof Error ? error.message : 'Could not remove saved view from My Tables.'));
        }
    };

    const onlineTemplates: Array<Template & { cloudId?: string; online: boolean }> = cloudTemplates.map((t) => ({
        ...t.view,
        name: t.name,
        cloudId: t.id,
        online: true,
    }));
    const allTemplates = [
        ...onlineTemplates,
        ...templates.filter((t) => !onlineTemplates.some((saved) => saved.name.toLowerCase() === t.name.toLowerCase()))
            .map((t) => ({ ...t, online: false, cloudId: undefined as string | undefined })),
    ];
    const olderTemplates = legacyTemplates.filter((t) =>
        !!t && typeof t.name === 'string' && !allTemplates.some((saved) => saved.name === t.name));


    const iconBtn = (active: boolean) =>
        `relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${active ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-300'}`;

    return (
        <div className={`flex ${height} min-h-[22rem] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900`}>
            {/* Action bar: always visible */}
            <div className='shrink-0 space-y-2 border-b border-slate-800 p-2'>
                <div className='flex items-center gap-2'>
                    <label className='relative min-w-0 flex-1'>
                        <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500' />
                        <input
                            type='search'
                            aria-label='Search all columns'
                            placeholder='Search everything'
                            value={search}
                            maxLength={100}
                            onChange={(e) => setSearch(e.target.value)}
                            className='h-10 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none sm:text-sm'
                        />
                    </label>
                    <button type='button' aria-label='Filters' title='Filter by criteria' onClick={() => setPanel(panel === 'filters' ? '' : 'filters')} className={iconBtn(panel === 'filters' || view.criteria.length > 0)}>
                        <Filter className='h-4 w-4' />
                        {view.criteria.length > 0 && <span className='absolute -right-1 -top-1 rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-onbrand'>{view.criteria.length}</span>}
                    </button>
                    <button type='button' aria-label='Columns' title='Show, hide and move columns' onClick={() => setPanel(panel === 'columns' ? '' : 'columns')} className={iconBtn(panel === 'columns')}>
                        <Columns3 className='h-4 w-4' />
                    </button>
                    <button type='button' aria-label='Templates' title='Saved templates' onClick={() => setPanel(panel === 'templates' ? '' : 'templates')} className={iconBtn(panel === 'templates')}>
                        <BookmarkPlus className='h-4 w-4' />
                    </button>
                    <button type='button' aria-label='Download Excel' title='Download Excel' onClick={exportExcel} disabled={!filtered.length} className={`${iconBtn(false)} disabled:opacity-40`}>
                        <Download className='h-4 w-4' />
                    </button>
                </div>
                <div className='flex items-center justify-between gap-2'>
                    <p className='truncate text-xs text-slate-500'>
                        {title ? <span className='font-medium text-slate-300'>{title} · </span> : null}
                        {filtered.length === rows.length ? `${rows.length} rows` : `${filtered.length} of ${rows.length} rows`}
                        {view.sort ? ` · sorted by ${byKey.get(view.sort.col)?.label ?? ''} ${view.sort.dir === 'asc' ? '↑' : '↓'}` : ''}
                    </p>
                    {actions && <div className='flex shrink-0 items-center gap-2'>{actions}</div>}
                </div>

                {panel === 'filters' && (
                    <FiltersPanel
                        columns={order.map((k) => byKey.get(k) as Column<T>)}
                        criteria={view.criteria}
                        onChange={(criteria) => setView((v) => ({ ...v, criteria }))}
                    />
                )}
                {panel === 'columns' && (
                    <div className='max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-950 p-2'>
                        <div className='mb-1 flex items-center justify-between px-1'>
                            <p className='text-xs text-slate-400'>Tap the eye to add or remove a column. Arrows move it.</p>
                            <button type='button' onClick={() => setView({ ...defaults })} className='flex items-center gap-1 text-xs text-emerald-300'>
                                <RotateCcw className='h-3 w-3' />
                                Reset
                            </button>
                        </div>
                        <ul className='divide-y divide-slate-800'>
                            {order.map((k, i) => {
                                const c = byKey.get(k) as Column<T>;
                                const hidden = view.hidden.includes(k);
                                return (
                                    <li key={k} className='flex items-center gap-2 py-1.5'>
                                        <button type='button' aria-label={hidden ? `Add ${c.label}` : `Remove ${c.label}`} onClick={() => toggleHidden(k)} className='flex h-11 w-11 items-center justify-center rounded-lg text-slate-300'>
                                            {hidden ? <EyeOff className='h-4 w-4 text-slate-600' /> : <Eye className='h-4 w-4 text-emerald-400' />}
                                        </button>
                                        <span className={`min-w-0 flex-1 truncate text-sm ${hidden ? 'text-slate-500' : 'text-white'}`}>{c.label}</span>
                                        <button type='button' aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(k, -1)} className='flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 disabled:opacity-30'>
                                            <ChevronUp className='h-4 w-4' />
                                        </button>
                                        <button type='button' aria-label={`Move ${c.label} down`} disabled={i === order.length - 1} onClick={() => move(k, 1)} className='flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 disabled:opacity-30'>
                                            <ChevronDown className='h-4 w-4' />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
                {panel === 'templates' && (
                    <div className='rounded-xl border border-slate-800 bg-slate-950 p-2'>
                        <div className='mb-2 flex gap-2'>
                            <input
                                aria-label='Template name'
                                maxLength={40}
                                value={templateName}
                                placeholder='Name this table view'
                                onChange={(e) => {
                                    setTemplateName(e.target.value);
                                    setTemplateError('');
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveTemplate();
                                }}
                                className='h-11 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
                            />
                            <button type='button' onClick={saveTemplate} disabled={!templateName.trim()} className='flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-onbrand disabled:opacity-50'>
                                <BookmarkPlus className='h-4 w-4' />
                                Save
                            </button>
                        </div>
                        <p className='mb-2 text-xs text-slate-400'>{canSync ? 'Save your columns, filters and sorting to My Tables and this device.' : 'This table template is saved on this device.'}</p>
                        {templateInfo && <p role='status' className='mb-2 text-xs text-emerald-300'>{templateInfo}</p>}
                        {templateError && (
                            <p role='alert' className='mb-2 text-xs text-red-300'>
                                {templateError}
                            </p>
                        )}
                        {allTemplates.length === 0 ? (
                            <p className='py-2 text-center text-xs text-slate-500'>No templates saved yet.</p>
                        ) : (
                            <ul className='max-h-48 divide-y divide-slate-800 overflow-y-auto overscroll-contain'>
                                {allTemplates.map((t) => (
                                    <li key={t.name} className='flex items-center gap-2 py-1.5'>
                                        <button
                                            type='button'
                                            onClick={() => {
                                                setView({ order: t.order, hidden: t.hidden, sort: t.sort, criteria: t.criteria });
                                                setPanel('');
                                            }}
                                            className='min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm text-white active:bg-slate-800'
                                        >
                                            {t.name}{t.online && <span className='ml-1 text-[10px] text-emerald-300'>· My Tables</span>}
                                            <span className='ml-2 text-xs text-slate-500'>
                                                {t.order.length - t.hidden.length} columns{t.criteria.length ? ` · ${t.criteria.length} filters` : ''}
                                            </span>
                                        </button>
                                        {!t.online && canSync && (
                                            <button type='button' disabled={!!syncBusy} aria-label={`Add ${t.name} to My Tables`}
                                                onClick={() => { void saveCloud(t); }}
                                                className='flex h-11 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold text-emerald-300 disabled:opacity-40'>
                                                Add to My Tables
                                            </button>
                                        )}
                                        <button type='button' aria-label={`Delete template ${t.name}`}
                                            onClick={() => deleteTemplate(t.name, t.cloudId)}
                                            className='flex h-11 w-11 items-center justify-center rounded-lg text-red-400'>
                                            <Trash2 className='h-4 w-4' />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {canSync && olderTemplates.length > 0 && (
                            <div className='mt-3 border-t border-slate-800 pt-2'>
                                <p className='mb-2 text-xs text-slate-400'>Older saved views on this browser are not automatically assigned to your account on a shared device.</p>
                                {olderTemplates.map((t) => (
                                    <button key={t.name} type='button' disabled={!!syncBusy}
                                        onClick={() => { void saveCloud(t); }}
                                        className='mb-1 flex min-h-10 w-full items-center justify-between rounded-lg border border-slate-700 px-3 text-left text-xs text-emerald-300 disabled:opacity-40'>
                                        Import & save ${t.name} to My Tables
                                        <BookmarkPlus className='h-4 w-4' />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Scrollable content: only this area scrolls */}
            <div ref={scroller} onScroll={onScroll} className='min-h-0 flex-1 overflow-auto overscroll-contain'>
                {filtered.length === 0 ? (
                    <p className='py-10 text-center text-sm text-slate-500'>{rows.length ? 'No rows match your search or filters.' : empty}</p>
                ) : (
                    <table className='w-full min-w-max border-separate border-spacing-0 text-sm'>
                        <thead>
                            <tr>
                                {visible.map((c) => (
                                    <th key={c.key} scope='col' className='sticky top-0 z-10 border-b border-slate-800 bg-slate-900 px-3 py-2 text-left font-medium text-slate-400'>
                                        <button type='button' onClick={() => toggleSort(c.key)} className='flex items-center gap-1 whitespace-nowrap text-xs uppercase tracking-wide'>
                                            {c.label}
                                            {view.sort?.col === c.key ? view.sort.dir === 'asc' ? <ArrowUp className='h-3 w-3 text-emerald-400' /> : <ArrowDown className='h-3 w-3 text-emerald-400' /> : <ArrowUpDown className='h-3 w-3 opacity-40' />}
                                        </button>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.slice(0, limit).map((r) => (
                                <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={`${onRowClick ? 'cursor-pointer active:bg-slate-800 hover:bg-slate-800/50' : ''} ${rowClassName?.(r) ?? ''}`}>
                                    {visible.map((c) => (
                                        <td key={c.key} className={`max-w-[22rem] border-b border-slate-800/70 px-3 py-2 align-top text-slate-200 ${c.type === 'number' ? 'text-right tabular-nums' : ''} ${c.className ?? ''}`}>
                                            {c.render ? c.render(r) : <span className='line-clamp-2'>{String(c.value(r) ?? '')}</span>}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {limit < filtered.length && <p className='py-3 text-center text-xs text-slate-500'>Scroll for more…</p>}
            </div>
        </div>
    );
}

function FiltersPanel<T>({ columns, criteria, onChange }: { columns: Array<Column<T>>; criteria: Criterion[]; onChange: (c: Criterion[]) => void }) {
    const [col, setCol] = useState(columns[0]?.key ?? '');
    const [op, setOp] = useState<Op>('contains');
    const [value, setValue] = useState('');
    const [value2, setValue2] = useState('');
    const [error, setError] = useState('');
    const needs = OPS.find((o) => o.op === op)?.needs ?? 1;
    const select = 'h-10 min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-2 text-base text-white sm:text-sm';

    const add = () => {
        setError('');
        if (!col) return;
        if (needs >= 1 && !value.trim()) return setError('Enter a value.');
        if (needs === 2 && !value2.trim()) return setError('Enter both values.');
        if (value.length > 200 || value2.length > 200) return setError('Values can be up to 200 characters.');
        onChange([...criteria, { col, op, value: value.trim(), value2: needs === 2 ? value2.trim() : undefined }]);
        setValue('');
        setValue2('');
    };

    const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
    return (
        <div className='space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-2'>
            {criteria.length > 0 && (
                <ul className='flex flex-wrap gap-1'>
                    {criteria.map((c, i) => (
                        <li key={i} className='flex items-center gap-1 rounded-full bg-emerald-500/10 py-1 pl-3 pr-1 text-xs text-emerald-200 ring-1 ring-emerald-500/30'>
                            {label(c.col)} {OPS.find((o) => o.op === c.op)?.label.toLowerCase()} {c.value}
                            {c.value2 ? ` and ${c.value2}` : ''}
                            <button type='button' aria-label='Remove filter' onClick={() => onChange(criteria.filter((_, j) => j !== i))} className='flex h-5 w-5 items-center justify-center rounded-full'>
                                <X className='h-3 w-3' />
                            </button>
                        </li>
                    ))}
                    <li>
                        <button type='button' onClick={() => onChange([])} className='px-2 py-1 text-xs text-slate-400 underline'>
                            Clear all
                        </button>
                    </li>
                </ul>
            )}
            <div className='grid grid-cols-2 gap-2'>
                <select aria-label='Column' value={col} onChange={(e) => setCol(e.target.value)} className={select}>
                    {columns.map((c) => (
                        <option key={c.key} value={c.key}>
                            {c.label}
                        </option>
                    ))}
                </select>
                <select aria-label='Condition' value={op} onChange={(e) => setOp(e.target.value as Op)} className={select}>
                    {OPS.map((o) => (
                        <option key={o.op} value={o.op}>
                            {o.label}
                        </option>
                    ))}
                </select>
                {needs >= 1 && <input aria-label='Value' value={value} maxLength={200} placeholder={op === 'in' ? 'a, b, c' : 'Value'} onChange={(e) => setValue(e.target.value)} className={`${select} ${needs === 1 ? 'col-span-2' : ''}`} />}
                {needs === 2 && <input aria-label='Second value' value={value2} maxLength={200} placeholder='and' onChange={(e) => setValue2(e.target.value)} className={select} />}
            </div>
            {error && <p className='text-xs text-red-400'>{error}</p>}
            <button type='button' onClick={add} className='flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/50 text-sm font-medium text-emerald-300'>
                <Plus className='h-4 w-4' />
                Add filter
            </button>
        </div>
    );
}
