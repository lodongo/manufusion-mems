import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, BookmarkPlus, ChevronDown, ChevronRight, ChevronUp, Columns3, Download, Eye, EyeOff, Filter, Layers, Plus, RotateCcw, Search, Sigma, Trash2, X } from 'lucide-react';
import { FUNCTIONS, FormulaError, QUICK, evaluate, parseFormula, toNumber } from '../lib/tableFormula';
import { MAX_GROUP_LEVELS, aggregate, allPaths, buildGroups, detectValueColumns, flatten, fmtNumber, type Agg, type FlatItem } from '../lib/tableGroups';
import { buildXlsx, downloadBlob, type Cell } from '../lib/xlsx';
import { firebaseAuth } from '../firebase';
import { callBackend } from '../lib/backend';

// Rich data table used everywhere MEMS shows records:
// global search, criteria filters, sortable columns, show/hide/reorder columns, group by up to four levels with sum,
// average and count of value columns (detected automatically), formula columns, Excel download, saved templates,
// lazy rendering and an always-visible action bar.
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

interface Formula {
    key: string;
    label: string;
    expr: string;
}

interface View {
    order: string[];
    hidden: string[];
    sort: { col: string; dir: 'asc' | 'desc' } | null;
    criteria: Criterion[];
    /** Group-by columns, outermost first (up to four). */
    groupBy?: string[];
    /** Columns to sum and average; null means detected automatically. */
    valueCols?: string[] | null;
    formulas?: Formula[];
}
const MAX_FORMULAS = 6;

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
    allowExport = true,
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
    /** Set false when data export is restricted pending a server-audited export handler. */
    allowExport?: boolean;
}) {
    // Keep device templates isolated by the authenticated account. Older browser-only
    // templates are available to import explicitly rather than silently assigning
    // another person's saved filters to the current user on a shared device.
    const ownerUid = firebaseAuth.currentUser?.uid || 'public';
    const storeKey = `mems.table.${ownerUid}.${id}`;
    const legacyKey = `mems.table.${id}`;
    const route = window.location.hash.replace(/^#\/?/, '');
    const canSync = !!firebaseAuth.currentUser && /^organization_(home|admin)\/[A-Za-z0-9_/-]{1,145}$/.test(route);
    const defaults = useMemo<View>(() => ({ order: columns.map((c) => c.key), hidden: columns.filter((c) => c.hidden).map((c) => c.key), sort: null, criteria: [], groupBy: [], valueCols: null, formulas: [] }), [columns]);
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
    const [panel, setPanel] = useState<'' | 'filters' | 'columns' | 'templates' | 'group' | 'formulas'>('');
    const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [limit, setLimit] = useState(PAGE);
    const scroller = useRef<HTMLDivElement>(null);

    // Formula columns: parsed once, evaluated per row against the base columns (never against other formulas).
    const baseByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
    const formulaState = useMemo(() => {
        const resolve = (name: string) => {
            const n = name.trim().toLowerCase();
            return columns.find((c) => c.label.trim().toLowerCase() === n)?.key ?? (baseByKey.has(name.trim()) ? name.trim() : undefined);
        };
        return (view.formulas ?? []).slice(0, MAX_FORMULAS).map((f) => {
            try {
                return { f, parsed: parseFormula(f.expr, resolve), error: '' };
            } catch (e) {
                return { f, parsed: null, error: e instanceof FormulaError ? e.message : 'The formula is not valid.' };
            }
        });
    }, [view.formulas, columns, baseByKey]);
    const formulaColumns = useMemo<Array<Column<T>>>(
        () =>
            formulaState.map(({ f, parsed }) => ({
                key: f.key,
                label: f.label,
                type: 'number' as const,
                value: (r: T) => (parsed ? evaluate(parsed.node, (k) => toNumber(baseByKey.get(k)?.value(r))) : null),
                render: (r: T) => {
                    const v = parsed ? evaluate(parsed.node, (k) => toNumber(baseByKey.get(k)?.value(r))) : null;
                    return <span className='tabular-nums'>{fmtNumber(v)}</span>;
                },
            })),
        [formulaState, baseByKey],
    );
    const allColumns = useMemo(() => [...columns, ...formulaColumns], [columns, formulaColumns]);

    // Keep the view consistent with the current column set (new columns appear, removed ones drop out).
    const byKey = useMemo(() => new Map(allColumns.map((c) => [c.key, c])), [allColumns]);
    const order = useMemo(() => {
        const known = view.order.filter((k) => byKey.has(k));
        return [...known, ...allColumns.map((c) => c.key).filter((k) => !known.includes(k))];
    }, [view.order, byKey, allColumns]);
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
    }, [search, view.criteria, view.sort, view.groupBy, rows]);
    useEffect(() => setExpanded(new Set()), [view.groupBy]);

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

    // Value columns (summed and averaged) and groups.
    const getValue = (key: string, r: T) => byKey.get(key)?.value(r);
    const detected = useMemo(() => detectValueColumns(allColumns, rows as unknown[], (k, r) => byKey.get(k)?.value(r as T)), [allColumns, rows, byKey]);
    const valueKeys = useMemo(() => (view.valueCols ?? detected).filter((k) => byKey.has(k)), [view.valueCols, detected, byKey]);
    const groupBy = useMemo(() => (view.groupBy ?? []).filter((k) => byKey.has(k)).slice(0, MAX_GROUP_LEVELS), [view.groupBy, byKey]);
    const groups = useMemo(() => (groupBy.length ? buildGroups(filtered, groupBy, valueKeys, getValue) : []), [filtered, groupBy, valueKeys, byKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const items = useMemo<FlatItem<T>[]>(() => (groupBy.length ? flatten(groups, expanded) : filtered.map((row) => ({ kind: 'row' as const, row, level: 0 }))), [groupBy, groups, expanded, filtered]);
    const totals = useMemo(() => aggregate(filtered, valueKeys, getValue), [filtered, valueKeys, byKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const visibleValues = visible.filter((c) => valueKeys.includes(c.key));

    const onScroll = () => {
        const el = scroller.current;
        if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 300 && limit < items.length) setLimit((l) => l + PAGE);
    };
    const toggleGroup = (path: string) =>
        setExpanded((cur) => {
            const next = new Set(cur);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

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
        const cellOf = (c: Column<T>, r: T): Cell => c.value(r) ?? '';
        const aggRow = (label: string, values: Record<string, Agg>): Cell[] => visible.map((c, i) => (valueKeys.includes(c.key) ? values[c.key]?.sum ?? '' : i === 0 ? label : ''));
        const data: Cell[][] = groupBy.length
            ? flatten(groups, new Set(), true).map((it) =>
                  it.kind === 'group'
                      ? aggRow(`${'  '.repeat(it.node.level)}${byKey.get(it.node.col)?.label ?? it.node.col}: ${it.node.value} (${it.node.totals.rows})`, it.node.totals.values)
                      : visible.map((c) => cellOf(c, it.row)),
              )
            : filtered.map((r) => visible.map((c) => cellOf(c, r)));
        if (visibleValues.length) data.push(aggRow(`Total (${totals.rows} rows)`, totals.values));
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
                    groupBy: template.groupBy ?? [],
                    valueCols: template.valueCols ?? null,
                    formulas: template.formulas ?? [],
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
                <div className='flex flex-wrap items-center gap-2'>
                    <label className='relative min-w-0 basis-full sm:basis-auto sm:flex-1'>
                        <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500' />
                        <input
                            type='search'
                            aria-label='Search all columns'
                            placeholder='Search everything'
                            value={search}
                            maxLength={100}
                            onChange={(e) => setSearch(e.target.value)}
                            className='h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none sm:text-sm'
                        />
                    </label>
                    <div className='relative w-full sm:hidden'>
                        <button type='button' aria-expanded={mobileToolsOpen} aria-label='Table options' onClick={() => setMobileToolsOpen(!mobileToolsOpen)} className='flex h-11 w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-white'>
                            <span>Table options</span><ChevronDown className='h-4 w-4' />
                        </button>
                        {mobileToolsOpen && <div className='grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2'>
                            {([['filters','Filters'],['group','Group by'],['formulas','Formula columns'],['columns','Columns'],['templates','Saved templates']] as const).map(([key,label])=><button key={key} type='button' onClick={()=>{setPanel(panel===key?'':key);setMobileToolsOpen(false)}} className='min-h-11 rounded-lg border border-slate-700 px-2 text-left text-sm text-white'>{label}{key==='filters'&&view.criteria.length>0?' ('+view.criteria.length+')':''}</button>)}
                            {allowExport&&<button type='button' onClick={()=>{setMobileToolsOpen(false);exportExcel()}} disabled={!filtered.length} className='min-h-11 rounded-lg border border-slate-700 px-2 text-left text-sm text-white disabled:opacity-40'>Export Excel</button>}
                        </div>}
                    </div>
                    <div className='hidden items-center gap-2 sm:flex'>
                    <button type='button' aria-label='Filters' title='Filter by criteria' onClick={() => setPanel(panel === 'filters' ? '' : 'filters')} className={iconBtn(panel === 'filters' || view.criteria.length > 0)}>
                        <Filter className='h-4 w-4' />
                        {view.criteria.length > 0 && <span className='absolute -right-1 -top-1 rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-onbrand'>{view.criteria.length}</span>}
                    </button>
                    <button type='button' aria-label='Group by' title='Group by up to four columns' onClick={() => setPanel(panel === 'group' ? '' : 'group')} className={iconBtn(panel === 'group' || groupBy.length > 0)}>
                        <Layers className='h-4 w-4' />
                        {groupBy.length > 0 && <span className='absolute -right-1 -top-1 rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-onbrand'>{groupBy.length}</span>}
                    </button>
                    <button type='button' aria-label='Formula columns' title='Formula columns' onClick={() => setPanel(panel === 'formulas' ? '' : 'formulas')} className={iconBtn(panel === 'formulas' || formulaColumns.length > 0)}>
                        <Sigma className='h-4 w-4' />
                        {formulaColumns.length > 0 && <span className='absolute -right-1 -top-1 rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-onbrand'>{formulaColumns.length}</span>}
                    </button>
                    <button type='button' aria-label='Columns' title='Show, hide and move columns' onClick={() => setPanel(panel === 'columns' ? '' : 'columns')} className={iconBtn(panel === 'columns')}>
                        <Columns3 className='h-4 w-4' />
                    </button>
                    <button type='button' aria-label='Templates' title='Saved templates' onClick={() => setPanel(panel === 'templates' ? '' : 'templates')} className={iconBtn(panel === 'templates')}>
                        <BookmarkPlus className='h-4 w-4' />
                    </button>
                    {allowExport && <button type='button' aria-label='Download Excel' title='Download Excel' onClick={exportExcel} disabled={!filtered.length} className={`${iconBtn(false)} disabled:opacity-40`}>
                        <Download className='h-4 w-4' />
                    </button>}
                    </div>
                </div>
                <div className='flex items-center justify-between gap-2'>
                    <p className='truncate text-xs text-slate-500'>
                        {title ? <span className='font-medium text-slate-300'>{title} · </span> : null}
                        {filtered.length === rows.length ? `${rows.length} rows` : `${filtered.length} of ${rows.length} rows`}
                        {groupBy.length ? ` · ${groups.length} groups` : ''}
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
                {panel === 'group' && (
                    <GroupPanel
                        columns={order.map((k) => byKey.get(k) as Column<T>)}
                        groupBy={groupBy}
                        valueKeys={valueKeys}
                        auto={!view.valueCols}
                        onGroupBy={(g) => setView((v) => ({ ...v, groupBy: g.slice(0, MAX_GROUP_LEVELS) }))}
                        onValues={(vals) => setView((v) => ({ ...v, valueCols: vals }))}
                        onExpandAll={() => setExpanded(new Set(allPaths(groups)))}
                        onCollapseAll={() => setExpanded(new Set())}
                    />
                )}
                {panel === 'formulas' && (
                    <FormulaPanel
                        columns={columns}
                        formulas={formulaState}
                        onChange={(formulas) =>
                            setView((v) => {
                                const removed = (v.formulas ?? []).filter((f) => !formulas.some((x) => x.key === f.key)).map((f) => f.key);
                                return {
                                    ...v,
                                    formulas,
                                    hidden: v.hidden.filter((k) => !removed.includes(k)),
                                    groupBy: (v.groupBy ?? []).filter((k) => !removed.includes(k)),
                                    criteria: v.criteria.filter((c) => !removed.includes(c.col)),
                                    sort: v.sort && removed.includes(v.sort.col) ? null : v.sort,
                                };
                            })
                        }
                    />
                )}
                {panel === 'columns' && (
                    <div className='max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-950 p-2'>
                        <div className='mb-1 flex items-center justify-between px-1'>
                            <p className='text-xs text-slate-400'>Tap the eye to add or remove a column. Arrows move it.</p>
                            <button type='button' onClick={() => setView((v) => ({ ...defaults, formulas: v.formulas, groupBy: v.groupBy, valueCols: v.valueCols }))} className='flex min-h-11 items-center gap-1 text-xs text-emerald-300'>
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
                        <p className='mb-2 text-xs text-slate-400'>{canSync ? 'Save your columns, filters, sorting, groups and formulas to My Tables and this device.' : 'This table template is saved on this device.'}</p>
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
                                                setView({ order: t.order, hidden: t.hidden, sort: t.sort, criteria: t.criteria, groupBy: t.groupBy ?? [], valueCols: t.valueCols ?? null, formulas: t.formulas ?? [] });
                                                setPanel('');
                                            }}
                                            className='min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm text-white active:bg-slate-800'
                                        >
                                            {t.name}{t.online && <span className='ml-1 text-[11px] text-emerald-300'>· My Tables</span>}
                                            <span className='ml-2 text-xs text-slate-500'>
                                                {t.order.length - t.hidden.length} columns{t.criteria.length ? ` · ${t.criteria.length} filters` : ''}{t.groupBy?.length ? ` · grouped ${t.groupBy.length}` : ''}{t.formulas?.length ? ` · ${t.formulas.length} formulas` : ''}
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
                                        className='mb-1 flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-700 px-3 text-left text-xs text-emerald-300 disabled:opacity-40'>
                                        Import & save {t.name} to My Tables
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
                {items.length === 0 ? (
                    <p className='py-10 text-center text-sm text-slate-500'>{rows.length ? 'No rows match your search or filters.' : empty}</p>
                ) : (
                    <table className='w-full min-w-max border-separate border-spacing-0 text-sm'>
                        <thead>
                            <tr>
                                {visible.map((c) => (
                                    <th key={c.key} scope='col' className='sticky top-0 z-10 border-b border-slate-800 bg-slate-900 px-3 py-2 text-left font-medium text-slate-400'>
                                        <button type='button' onClick={() => toggleSort(c.key)} className='flex min-h-11 items-center gap-1 whitespace-nowrap text-xs uppercase tracking-wide'>
                                            {c.label}
                                            {view.sort?.col === c.key ? view.sort.dir === 'asc' ? <ArrowUp className='h-3 w-3 text-emerald-400' /> : <ArrowDown className='h-3 w-3 text-emerald-400' /> : <ArrowUpDown className='h-3 w-3 opacity-40' />}
                                        </button>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {items.slice(0, limit).map((it) => {
                                if (it.kind === 'group') {
                                    const g = it.node;
                                    const open = expanded.has(g.path);
                                    return (
                                        <tr key={`g${g.path}`} onClick={() => toggleGroup(g.path)} className='cursor-pointer bg-slate-800/40 active:bg-slate-800'>
                                            {visible.map((c, i) => (
                                                <td key={c.key} className={`border-b border-slate-800 px-3 py-2 align-top ${valueKeys.includes(c.key) ? 'text-right' : ''}`}>
                                                    {i === 0 && (
                                                        <button type='button' aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${g.value}`} onClick={(e) => { e.stopPropagation(); toggleGroup(g.path); }} className='flex min-h-11 items-center gap-1 whitespace-nowrap text-left font-semibold text-white' style={{ paddingLeft: `${g.level * 1}rem` }}>
                                                            {open ? <ChevronDown className='h-4 w-4 shrink-0 text-emerald-400' /> : <ChevronRight className='h-4 w-4 shrink-0 text-emerald-400' />}
                                                            <span className='text-xs font-normal text-slate-400'>{byKey.get(g.col)?.label}:</span>
                                                            <span className='max-w-[14rem] truncate'>{g.value}</span>
                                                            <span className='rounded-full bg-slate-700 px-2 text-[11px] font-normal text-slate-200'>{g.totals.rows}</span>
                                                        </button>
                                                    )}
                                                    {valueKeys.includes(c.key) && <AggCell agg={g.totals.values[c.key]} />}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                }
                                const r = it.row;
                                return (
                                    <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={`${onRowClick ? 'cursor-pointer active:bg-slate-800 hover:bg-slate-800/50' : ''} ${rowClassName?.(r) ?? ''}`}>
                                        {visible.map((c, i) => (
                                            <td key={c.key} style={i === 0 && it.level ? { paddingLeft: `${0.75 + it.level * 1}rem` } : undefined} className={`max-w-[22rem] border-b border-slate-800/70 px-3 py-2 align-top text-slate-200 ${c.type === 'number' || valueKeys.includes(c.key) ? 'text-right tabular-nums' : ''} ${c.className ?? ''}`}>
                                                {c.render ? c.render(r) : <span className='line-clamp-2'>{String(c.value(r) ?? '')}</span>}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                        {visibleValues.length > 0 && (
                            <tfoot>
                                <tr>
                                    {visible.map((c, i) => (
                                        <td key={c.key} className={`sticky bottom-0 z-10 border-t border-slate-700 bg-slate-900 px-3 py-2 align-top ${valueKeys.includes(c.key) ? 'text-right' : ''}`}>
                                            {i === 0 && <span className='block whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-300'>Total · {totals.rows} rows</span>}
                                            {valueKeys.includes(c.key) && <AggCell agg={totals.values[c.key]} strong />}
                                        </td>
                                    ))}
                                </tr>
                            </tfoot>
                        )}
                    </table>
                )}
                {limit < items.length && <p className='py-3 text-center text-xs text-slate-500'>Scroll for more…</p>}
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
    const select = 'h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-2 text-base text-white sm:text-sm';

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
                            <button type='button' aria-label='Remove filter' onClick={() => onChange(criteria.filter((_, j) => j !== i))} className='-my-2 -mr-1 flex h-11 w-11 items-center justify-center rounded-full'>
                                <X className='h-3 w-3' />
                            </button>
                        </li>
                    ))}
                    <li>
                        <button type='button' onClick={() => onChange([])} className='flex min-h-11 items-center px-2 text-xs text-slate-400 underline'>
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
            <button type='button' onClick={add} className='flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/50 text-sm font-medium text-emerald-300'>
                <Plus className='h-4 w-4' />
                Add filter
            </button>
        </div>
    );
}

/** Sum, simple average and count of a value column. */
function AggCell({ agg, strong }: { agg: Agg | undefined; strong?: boolean }) {
    if (!agg || !agg.n) return <span className='text-xs text-slate-600'>—</span>;
    return (
        <span className='block whitespace-nowrap text-right tabular-nums'>
            <span className={`block ${strong ? 'font-semibold text-white' : 'font-medium text-slate-100'}`} title='Sum'>
                Σ {fmtNumber(agg.sum)}
            </span>
            <span className='block text-[11px] text-slate-400'>
                <span title='Simple average'>x̄ {fmtNumber(agg.avg)}</span> · <span title='Number of values'>n {agg.n}</span>
            </span>
        </span>
    );
}

function GroupPanel<T>({ columns, groupBy, valueKeys, auto, onGroupBy, onValues, onExpandAll, onCollapseAll }: { columns: Array<Column<T>>; groupBy: string[]; valueKeys: string[]; auto: boolean; onGroupBy: (g: string[]) => void; onValues: (v: string[] | null) => void; onExpandAll: () => void; onCollapseAll: () => void }) {
    const select = 'h-11 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-2 text-base text-white sm:text-sm';
    const choices = (level: number) => columns.filter((c) => !groupBy.some((g, i) => g === c.key && i !== level));
    return (
        <div className='max-h-[60dvh] space-y-3 overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-950 p-2'>
            <div className='space-y-2'>
                <p className='text-xs text-slate-400'>Group rows by up to {MAX_GROUP_LEVELS} columns. Each group shows its sum (Σ), simple average (x̄) and number of values (n).</p>
                {groupBy.map((key, level) => (
                    <div key={level} className='flex items-center gap-2'>
                        <span className='w-14 shrink-0 text-xs text-slate-400'>Level {level + 1}</span>
                        <select aria-label={`Group level ${level + 1}`} value={key} onChange={(e) => onGroupBy(groupBy.map((g, i) => (i === level ? e.target.value : g)))} className={select}>
                            {choices(level).map((c) => (
                                <option key={c.key} value={c.key}>
                                    {c.label}
                                </option>
                            ))}
                        </select>
                        <button type='button' aria-label={`Remove group level ${level + 1}`} onClick={() => onGroupBy(groupBy.filter((_, i) => i !== level))} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-400'>
                            <X className='h-4 w-4' />
                        </button>
                    </div>
                ))}
                {groupBy.length < MAX_GROUP_LEVELS && choices(groupBy.length).length > 0 && (
                    <select aria-label='Add a group level' value='' onChange={(e) => e.target.value && onGroupBy([...groupBy, e.target.value])} className={`${select} w-full`}>
                        <option value=''>{groupBy.length ? `Add level ${groupBy.length + 1}…` : 'Group by…'}</option>
                        {choices(groupBy.length).map((c) => (
                            <option key={c.key} value={c.key}>
                                {c.label}
                            </option>
                        ))}
                    </select>
                )}
                {groupBy.length > 0 && (
                    <div className='flex flex-wrap gap-2'>
                        <button type='button' onClick={onExpandAll} className='flex min-h-11 items-center rounded-xl border border-slate-700 px-3 text-xs text-slate-200'>Expand all</button>
                        <button type='button' onClick={onCollapseAll} className='flex min-h-11 items-center rounded-xl border border-slate-700 px-3 text-xs text-slate-200'>Collapse all</button>
                        <button type='button' onClick={() => onGroupBy([])} className='flex min-h-11 items-center rounded-xl px-3 text-xs text-slate-400 underline'>Remove grouping</button>
                    </div>
                )}
            </div>
            <div className='space-y-2 border-t border-slate-800 pt-2'>
                <div className='flex items-center justify-between gap-2'>
                    <p className='text-xs text-slate-400'>Value columns {auto ? '(detected automatically)' : '(chosen)'}</p>
                    {!auto && (
                        <button type='button' onClick={() => onValues(null)} className='flex min-h-11 items-center gap-1 text-xs text-emerald-300'>
                            <RotateCcw className='h-3 w-3' /> Detect again
                        </button>
                    )}
                </div>
                <ul className='flex flex-wrap gap-1'>
                    {columns.map((c) => {
                        const on = valueKeys.includes(c.key);
                        return (
                            <li key={c.key}>
                                <button type='button' aria-pressed={on} onClick={() => onValues(on ? valueKeys.filter((k) => k !== c.key) : [...valueKeys, c.key])} className={`flex min-h-11 items-center rounded-full px-3 text-xs ring-1 ${on ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40' : 'text-slate-400 ring-slate-700'}`}>
                                    {on ? 'Σ ' : ''}
                                    {c.label}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}

function FormulaPanel<T>({ columns, formulas, onChange }: { columns: Array<Column<T>>; formulas: Array<{ f: Formula; error: string }>; onChange: (f: Formula[]) => void }) {
    const [name, setName] = useState('');
    const [mode, setMode] = useState<'quick' | 'custom'>('quick');
    const [quick, setQuick] = useState(QUICK[0].id);
    const [picked, setPicked] = useState<string[]>([]);
    const [expr, setExpr] = useState('');
    const [error, setError] = useState('');
    const q = QUICK.find((x) => x.id === quick) ?? QUICK[0];
    const select = 'h-11 min-w-0 w-full rounded-xl border border-slate-700 bg-slate-950 px-2 text-base text-white sm:text-sm';
    const ref = (key: string) => `[${columns.find((c) => c.key === key)?.label ?? key}]`;
    const built = mode === 'quick' ? (picked.length >= q.min ? q.build(picked.slice(0, q.max).map(ref)) : '') : expr;
    const add = () => {
        setError('');
        const label = name.trim();
        if (!label) return setError('Name the column.');
        if (label.length > 40) return setError('Use up to 40 characters for the name.');
        if (/[\u0000-\u001f<>`\\]/.test(label)) return setError('The name has characters that are not allowed.');
        if (columns.some((c) => c.label.toLowerCase() === label.toLowerCase()) || formulas.some((x) => x.f.label.toLowerCase() === label.toLowerCase())) return setError('A column with this name already exists.');
        if (formulas.length >= MAX_FORMULAS) return setError(`You can add up to ${MAX_FORMULAS} formula columns.`);
        if (mode === 'quick' && picked.length < q.min) return setError(`Choose at least ${q.min} columns.`);
        if (mode === 'quick' && picked.length > q.max) return setError(`Choose at most ${q.max} columns.`);
        try {
            parseFormula(built, (n) => columns.find((c) => c.label.trim().toLowerCase() === n.trim().toLowerCase())?.key ?? columns.find((c) => c.key === n.trim())?.key);
        } catch (e) {
            return setError(e instanceof FormulaError ? e.message : 'The formula is not valid.');
        }
        const key = `fx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        onChange([...formulas.map((x) => x.f), { key, label, expr: built.trim() }]);
        setName('');
        setPicked([]);
        setExpr('');
    };
    return (
        <div className='max-h-[60dvh] space-y-3 overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-950 p-2'>
            {formulas.length > 0 && (
                <ul className='space-y-1'>
                    {formulas.map(({ f, error: err }) => (
                        <li key={f.key} className='flex items-start gap-2 rounded-lg border border-slate-800 px-3 py-2'>
                            <div className='min-w-0 flex-1'>
                                <p className='truncate text-sm font-medium text-white'>{f.label}</p>
                                <p className='break-words font-mono text-[11px] text-slate-400'>{f.expr}</p>
                                {err && <p className='text-xs text-red-400'>{err}</p>}
                            </div>
                            <button type='button' aria-label={`Remove formula ${f.label}`} onClick={() => onChange(formulas.filter((x) => x.f.key !== f.key).map((x) => x.f))} className='-my-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-400'>
                                <Trash2 className='h-4 w-4' />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <div className='space-y-2'>
                <p className='text-xs text-slate-400'>Add a column calculated from each row. Formula columns can be grouped, filtered, sorted and totalled like any other.</p>
                <input aria-label='Formula column name' value={name} maxLength={40} placeholder='Column name, e.g. Line total' onChange={(e) => setName(e.target.value)} className={select} />
                <div className='grid grid-cols-2 gap-2'>
                    {(['quick', 'custom'] as const).map((m) => (
                        <button key={m} type='button' aria-pressed={mode === m} onClick={() => setMode(m)} className={`flex min-h-11 items-center justify-center rounded-xl border text-xs ${mode === m ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 text-slate-300'}`}>
                            {m === 'quick' ? 'Simple' : 'Formula'}
                        </button>
                    ))}
                </div>
                {mode === 'quick' ? (
                    <>
                        <select aria-label='Calculation' value={quick} onChange={(e) => setQuick(e.target.value)} className={select}>
                            {QUICK.map((x) => (
                                <option key={x.id} value={x.id}>
                                    {x.label}
                                </option>
                            ))}
                        </select>
                        <p className='text-xs text-slate-400'>Choose {q.min === q.max ? q.min : `${q.min} to ${q.max}`} columns{q.min === 2 && q.max === 2 ? ' in order' : ''}:</p>
                        <ul className='flex flex-wrap gap-1'>
                            {columns.map((c) => {
                                const i = picked.indexOf(c.key);
                                return (
                                    <li key={c.key}>
                                        <button type='button' aria-pressed={i >= 0} onClick={() => setPicked((cur) => (i >= 0 ? cur.filter((k) => k !== c.key) : [...cur, c.key]))} className={`flex min-h-11 items-center rounded-full px-3 text-xs ring-1 ${i >= 0 ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40' : 'text-slate-400 ring-slate-700'}`}>
                                            {i >= 0 ? `${i + 1}. ` : ''}
                                            {c.label}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                ) : (
                    <>
                        <textarea aria-label='Formula' rows={2} maxLength={300} value={expr} placeholder='e.g. [Quantity] * [Unit price]' onChange={(e) => setExpr(e.target.value)} className='w-full rounded-xl border border-slate-700 bg-slate-950 p-2 font-mono text-base text-white sm:text-sm' />
                        <select aria-label='Insert a column' value='' onChange={(e) => e.target.value && setExpr((x) => `${x}${x && !/[\s(,+\-*/]$/.test(x) ? ' ' : ''}${ref(e.target.value)}`)} className={select}>
                            <option value=''>Insert a column…</option>
                            {columns.map((c) => (
                                <option key={c.key} value={c.key}>
                                    {c.label}
                                </option>
                            ))}
                        </select>
                        <p className='text-[11px] leading-snug text-slate-500'>
                            Use + − × (*) ÷ (/) and brackets. Functions: {Object.entries(FUNCTIONS).filter(([k]) => k !== 'AVERAGE').map(([k, v]) => `${k} – ${v.help}`).join('; ')}. Empty cells count as 0 in arithmetic.
                        </p>
                    </>
                )}
                {built && <p className='break-words rounded-lg bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-300'>= {built}</p>}
                {error && <p role='alert' className='text-xs text-red-400'>{error}</p>}
                <button type='button' onClick={add} disabled={formulas.length >= MAX_FORMULAS} className='flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/50 text-sm font-medium text-emerald-300 disabled:opacity-40'>
                    <Plus className='h-4 w-4' />
                    Add formula column
                </button>
            </div>
        </div>
    );
}
