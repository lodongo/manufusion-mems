import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Save, Search } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, Segmented, useConfirm } from '../components/screen';
import { AuthorityTiers, BuyingRules } from './ProcurementRules';
import EvaluationMetrics from './EvaluationMetrics';
import { BuyerGroupsPanel } from './BuyerGroups';

// Procurement setup: which categories and subcategories of the Material, Service and Asset masters this organization
// accepts. Purchase requirements can only use what is adopted here. Saving needs a reason, is versioned and audited.
// The last tab shows the chart of authority for procurement (who may do what, and what stays apart).

interface Cat {
    code: string;
    name: string;
    subcategories: Array<{ code: string; name: string }>;
}
interface Kind {
    kind: 'material' | 'service' | 'asset';
    label: string;
    masterLoaded: boolean;
    master: Cat[];
    adopted: Cat[];
    version: number;
    updatedAt: string;
}
interface Overview {
    kinds: Kind[];
    canManage: boolean;
}
interface Rule {
    key: string;
    submodule: string;
    action: string;
    permission: string | null;
    who: string;
    approval: string;
    separation: string;
    limit: string;
    status?: string;
}
interface Authority {
    rules: Rule[];
    planned: Array<{ name: string; note: string; permissions: string[] }>;
}

type Selection = Record<string, Set<string>>;
const toSelection = (adopted: Cat[]): Selection => Object.fromEntries(adopted.map((c): [string, Set<string>] => [c.code, new Set(c.subcategories.map((s) => s.code))]));
const countOf = (s: Selection) => Object.values(s).reduce((n, x) => n + x.size, 0);

const RULE_COLUMNS: Array<Column<Rule>> = [
    { key: 'submodule', label: 'Submodule', value: (r) => r.submodule },
    { key: 'action', label: 'Action', value: (r) => r.action },
    { key: 'status', label: 'Status', value: (r) => (r.status === 'placeholder' ? 'Placeholder' : 'Live') },
    { key: 'permission', label: 'Security permission', value: (r) => r.permission ?? 'Any user', render: (r) => <span className='font-mono text-xs'>{r.permission ?? 'Any user'}</span> },
    { key: 'who', label: 'Who', value: (r) => r.who },
    { key: 'approval', label: 'Approval', value: (r) => r.approval },
    { key: 'separation', label: 'Kept apart', value: (r) => r.separation },
    { key: 'limit', label: 'Limit', value: (r) => r.limit, hidden: true },
];

function KindEditor({ kind, canManage, onSaved }: { kind: Kind; canManage: boolean; onSaved: () => void }) {
    const initial = useMemo(() => toSelection(kind.adopted), [kind]);
    const [sel, setSel] = useState<Selection>(initial);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [q, setQ] = useState('');
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();
    useEffect(() => setSel(toSelection(kind.adopted)), [kind]);

    const shape = (s: Selection) => JSON.stringify(Object.keys(s).sort().map((c) => [c, Array.from(s[c]).sort()]));
    const dirty = shape(sel) !== shape(initial);
    const term = q.trim().toLowerCase();
    const list = kind.master.filter((c) => !term || `${c.code} ${c.name}`.toLowerCase().includes(term) || c.subcategories.some((s) => `${s.code} ${s.name}`.toLowerCase().includes(term)));

    const toggleCat = (c: Cat, on: boolean) =>
        setSel((cur) => {
            const next = { ...cur };
            if (on) next[c.code] = new Set(c.subcategories.map((s) => s.code));
            else delete next[c.code];
            return next;
        });
    const toggleSub = (c: Cat, code: string, on: boolean) =>
        setSel((cur) => {
            const set = new Set(cur[c.code] ?? []);
            if (on) set.add(code);
            else set.delete(code);
            const next = { ...cur };
            if (set.size) next[c.code] = set;
            else delete next[c.code];
            return next;
        });

    const save = () =>
        confirm.ask(
            {
                title: `Save ${kind.label} categories`,
                message: `${Object.keys(sel).length} categories and ${countOf(sel)} subcategories will be accepted for purchase requirements. This creates version ${kind.version + 1}. Anything still used by an open requirement cannot be removed.`,
                confirmLabel: 'Save',
                reason: { label: 'Reason for this change', minLength: 10, placeholder: 'For example: we now buy chemicals directly' },
            },
            async (reason) => {
                await callBackend('/api/org/procurement/setup/save', {
                    kind: kind.kind,
                    reason,
                    expectedVersion: kind.version,
                    selection: Object.keys(sel).map((code) => ({ code, subcategories: Array.from(sel[code]) })),
                });
                setNotice('Saved. The change is recorded in the audit trail.');
                onSaved();
            }
        );

    if (!kind.masterLoaded) return <Alert tone='warn'>MEMS has not published the {kind.label} yet, so there is nothing to adopt.</Alert>;

    return (
        <div className='space-y-3'>
            {notice && <Alert tone='success'>{notice}</Alert>}
            <div className='flex flex-wrap items-center gap-2'>
                <label className='flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-panel px-3'>
                    <Search className='h-4 w-4 shrink-0 text-muted' />
                    <input aria-label='Search categories' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search categories and subcategories' className='h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted' />
                </label>
                <Badge tone='muted'>{Object.keys(sel).length} categories · {countOf(sel)} subcategories</Badge>
                {kind.updatedAt && <span className='text-xs text-muted'>Version {kind.version}, {fmtDate(kind.updatedAt)}</span>}
            </div>
            <ul className='divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel'>
                {list.map((c) => {
                    const chosen = sel[c.code]?.size ?? 0;
                    const expanded = term ? true : open[c.code];
                    return (
                        <li key={c.code}>
                            <div className='flex min-h-12 items-center gap-2 px-3'>
                                <input
                                    type='checkbox'
                                    aria-label={`Accept ${c.name}`}
                                    disabled={!canManage}
                                    checked={chosen === c.subcategories.length && chosen > 0}
                                    ref={(el) => {
                                        if (el) el.indeterminate = chosen > 0 && chosen < c.subcategories.length;
                                    }}
                                    onChange={(e) => toggleCat(c, e.target.checked)}
                                    className='h-5 w-5 shrink-0 accent-emerald-500'
                                />
                                <button type='button' aria-expanded={!!expanded} onClick={() => setOpen((o) => ({ ...o, [c.code]: !o[c.code] }))} className='flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left'>
                                    <span className='min-w-0 flex-1'>
                                        <span className='block truncate text-sm font-medium text-ink'>{c.name}</span>
                                        <span className='font-mono text-xs text-muted'>{c.code} · {chosen}/{c.subcategories.length} accepted</span>
                                    </span>
                                    {expanded ? <ChevronDown className='h-4 w-4 text-muted' /> : <ChevronRight className='h-4 w-4 text-muted' />}
                                </button>
                            </div>
                            {expanded && (
                                <ul className='space-y-0 border-t border-line bg-page px-3 py-1 pl-10'>
                                    {c.subcategories
                                        .filter((s) => !term || `${c.code} ${c.name} ${s.code} ${s.name}`.toLowerCase().includes(term))
                                        .map((s) => (
                                            <li key={s.code}>
                                                <label className='flex min-h-11 items-center gap-3 text-sm text-ink'>
                                                    <input type='checkbox' disabled={!canManage} checked={sel[c.code]?.has(s.code) ?? false} onChange={(e) => toggleSub(c, s.code, e.target.checked)} className='h-5 w-5 shrink-0 accent-emerald-500' />
                                                    <span className='min-w-0 flex-1 truncate'>{s.name}</span>
                                                    <span className='font-mono text-xs text-muted'>{s.code}</span>
                                                </label>
                                            </li>
                                        ))}
                                </ul>
                            )}
                        </li>
                    );
                })}
                {!list.length && <li className='p-4 text-sm text-muted'>Nothing matches your search.</li>}
            </ul>
            {canManage ? (
                <Button onClick={save} disabled={!dirty} className='w-full sm:w-auto'>
                    <Save className='mr-2 h-4 w-4' /> Save changes
                </Button>
            ) : (
                <p className='text-xs text-muted'>You can view this setup. Changing it needs the Procurement Setup Administrator role.</p>
            )}
            {confirm.sheet}
        </div>
    );
}

export default function ProcurementSetup({ back }: { back: string }) {
    const overview = useLoad(() => callBackend<Overview>('/api/org/procurement/setup/overview'));
    const authority = useLoad(() => callBackend<Authority>('/api/org/procurement/authority').catch(() => null));
    const [tab, setTab] = useState<string>('material');

    const kinds = overview.data?.kinds ?? [];
    const short: Record<string, string> = { material: 'Materials', service: 'Services', asset: 'Assets' };
    const options = [...kinds.map((k) => ({ value: k.kind as string, label: short[k.kind] ?? k.label })), { value: 'buying', label: 'Buying rules' }, { value: 'limits', label: 'Authority limits' }, { value: 'metrics', label: 'Evaluation metrics' }, { value: 'buyers', label: 'Buyer groups' }, { value: 'chart', label: 'Chart of authority' }];
    const kind = kinds.find((k) => k.kind === tab);

    return (
        <Screen title='Procurement setup' subtitle='Accepted categories and chart of authority' onBack={() => navigate(back)} toolbar={<Segmented label='Setup sections' value={tab} options={options} onChange={setTab} />}>
            {tab === 'buying' ? (
                <BuyingRules />
            ) : tab === 'limits' ? (
                <AuthorityTiers />
            ) : tab === 'metrics' ? (
                <EvaluationMetrics />
            ) : tab === 'buyers' ? (
                <BuyerGroupsPanel />
            ) : tab === 'chart' ? (
                !authority.data ? (
                    authority.loading ? <Spinner /> : <Alert tone='error'>{authority.error || 'You do not have permission to view the chart of authority.'}</Alert>
                ) : (
                    <div className='space-y-4'>
                        <RichTable id='prc.authority' title='Chart of authority' columns={RULE_COLUMNS} rows={authority.data.rules} rowKey={(r) => r.key} fileName='procurement-chart-of-authority' height='h-[calc(100dvh-20rem)]' />
                        <section className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                            <h2 className='text-sm font-semibold text-ink'>Placeholders</h2>
                            <p className='text-xs text-muted'>Security roles and chart of authority rules are configured for these submodules. Their functions are not built yet.</p>
                            <ul className='divide-y divide-line'>
                                {authority.data.planned.map((p) => (
                                    <li key={p.name} className='py-2 text-sm'>
                                        <p className='font-medium text-ink'>{p.name}</p>
                                        <p className='text-xs text-muted'>{p.note}</p>
                                        <p className='font-mono text-xs text-soft'>{p.permissions.join(', ')}</p>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </div>
                )
            ) : overview.loading && !overview.data ? (
                <Spinner />
            ) : overview.error || !kind ? (
                <Alert tone='error'>{overview.error || 'Could not load setup.'}</Alert>
            ) : (
                <KindEditor key={kind.kind} kind={kind} canManage={!!overview.data?.canManage} onSaved={overview.reload} />
            )}
        </Screen>
    );
}
