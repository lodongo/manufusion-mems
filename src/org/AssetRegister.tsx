import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, DownloadCloud, Pencil, Plus, Trash2, Undo2, XCircle } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { fetchReference } from '../lib/reference';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import AssetDictionaryBrowser, { lifeText, typeLabel, type AttrDef, type ClassDetail } from '../components/AssetDictionaryBrowser';
import { Badge, Button, Card, PageTitle, Spinner, TextArea, useLoad } from '../admin/kit';

// Organization asset register (AST). Every asset belongs to one class of the organization's own copy of the
// MEMS asset master data, is located in the organization design, has its attributes confirmed by the person
// submitting it and is approved by someone else (maker-checker).

type Status = 'draft' | 'pending_approval' | 'active' | 'rejected' | 'change_pending' | 'disposal_pending' | 'disposed';

interface AssetRow {
    tag: string;
    name: string;
    classCode: string;
    className: string;
    groupCode: string;
    categoryCode: string;
    subcategoryCode: string;
    dictionaryVersion: string;
    nodeId: string;
    nodeCode: string;
    nodeName: string;
    nodeLevel: string;
    siteId: string;
    workCenterId: string;
    workCenterCode: string;
    status: Status;
    createdAt: string;
    createdByName: string;
    updatedAt: string;
    submittedByName: string;
    approvedByName: string;
    approvedAt: string;
    completeness: number;
}

export interface AssetFull extends AssetRow {
    description: string;
    attributes: Record<string, unknown>;
    pending: (Record<string, unknown> & { attributes?: Record<string, unknown> }) | null;
    pendingNote: string;
    submittedBy: string;
    createdBy: string;
    attributesConfirmedByName: string;
    attributesConfirmedAt: string;
    history: Array<{ at: string; byName: string; action: string; note: string }>;
}

interface ListData {
    assets: AssetRow[];
    scope: 'all' | 'assigned';
    can: { create: boolean; edit: boolean; approve: boolean; remove: boolean };
}

export const STATUS: Record<Status, { label: string; tone: 'brand' | 'warn' | 'danger' | 'muted' }> = {
    draft: { label: 'Draft', tone: 'muted' },
    pending_approval: { label: 'Awaiting approval', tone: 'warn' },
    active: { label: 'Active', tone: 'brand' },
    rejected: { label: 'Rejected', tone: 'danger' },
    change_pending: { label: 'Change awaiting approval', tone: 'warn' },
    disposal_pending: { label: 'Disposal awaiting approval', tone: 'warn' },
    disposed: { label: 'Disposed', tone: 'muted' },
};

const LEVEL_LABELS: Record<string, string> = { site: 'Site', department: 'Department', cost_center: 'Cost center', work_center: 'Equipment unit' };
const ACTION_LABELS: Record<string, string> = {
    created: 'Created',
    edited: 'Attributes edited',
    submitted: 'Attributes confirmed and submitted for approval',
    approved: 'Approved',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
    change_requested: 'Change confirmed and requested',
    change_approved: 'Change approved',
    disposal_requested: 'Disposal requested',
    disposal_approved: 'Disposal approved',
    linked: 'Linked to equipment unit',
    unlinked: 'Unlinked from equipment unit',
};
const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString() : '');

export default function AssetRegister({ view, id }: { view: 'register' | 'approvals' | 'dictionary'; id?: string }) {
    if (view === 'dictionary') return <OrgDictionary />;
    if (id === 'new') return <AssetForm key='new' />;
    if (id && /^AST-\d{6}$/.test(id)) return <AssetDetail key={id} tag={id} back={view === 'approvals' ? 'asset_approvals' : 'assets'} />;
    return <AssetList key={view} approvals={view === 'approvals'} />;
}

// ----- Organization copy of the asset master data -----

interface DictStatus {
    imported: boolean;
    version: string;
    importedAt: string;
    importedByName: string;
    stats: Record<string, number>;
    memsVersion: string;
    updateAvailable: boolean;
    canImport: boolean;
}

function OrgDictionary() {
    const { data, error, loading, reload } = useLoad(() => callBackend<DictStatus>('/api/org/assets/dictionary/status'));
    const [confirming, setConfirming] = useState(false);
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the asset master data.'}</Alert>;

    const runImport = async () => {
        setBusy(true);
        setActionError('');
        try {
            await callBackend('/api/org/assets/dictionary/import', { confirm: typed.trim() });
            setConfirming(false);
            setTyped('');
            reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Import failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className='space-y-3'>
            <PageTitle title='Asset catalog' subtitle='The MEMS asset catalog: groups, categories, equipment classes and their attributes. Use it to classify equipment units and configure your assets.' />
            <Card>
                {data.imported ? (
                    <p className='flex items-center gap-2 text-sm text-emerald-300'>
                        <CheckCircle2 className='h-4 w-4' />
                        Asset catalog{data.version ? ` ${data.version}` : ''} available · loaded by MEMS {fmt(data.importedAt)}
                    </p>
                ) : (
                    <p className='flex items-center gap-2 text-sm text-amber-300'>
                        <AlertTriangle className='h-4 w-4' />
                        MEMS has not loaded the asset catalog yet.
                    </p>
                )}
                {data.imported && data.stats.assetClasses ? (
                    <p className='mt-1 text-xs text-slate-400'>
                        {data.stats.groups} groups · {data.stats.categories} categories · {data.stats.subcategories} subcategories · {data.stats.assetClasses} classes · {data.stats.attributes} attributes
                    </p>
                ) : null}
                {!data.memsVersion && <p className='mt-2 text-xs text-slate-500'>MEMS has not published an asset master dictionary yet.</p>}
                {data.memsVersion && (!data.imported || data.updateAvailable) && (
                    <div className='mt-3'>
                        {data.canImport ? (
                            <Button onClick={() => setConfirming(true)}>
                                <DownloadCloud className='h-4 w-4' />
                                {data.imported ? `Update to version ${data.memsVersion}` : `Import version ${data.memsVersion}`}
                            </Button>
                        ) : (
                            <p className='text-xs text-slate-400'>Ask your asset administrator to import version {data.memsVersion}.</p>
                        )}
                    </div>
                )}
                {confirming && (
                    <div className='mt-3 space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3'>
                        <p className='text-sm text-slate-200'>
                            Save MEMS asset master data version {data.memsVersion} to your organization? New assets will use it. Existing assets keep their class and the version they were created with.
                        </p>
                        <Field id='dict-confirm' label={`Type ${data.memsVersion} to confirm`} value={typed} autoComplete='off' onChange={(e) => setTyped(e.target.value)} />
                        {actionError && <Alert tone='error'>{actionError}</Alert>}
                        <div className='flex gap-2'>
                            <Button className='flex-1' busy={busy} disabled={typed.trim() !== data.memsVersion} onClick={runImport}>
                                Confirm import
                            </Button>
                            <Button variant='secondary' onClick={() => setConfirming(false)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
            </Card>
            {data.imported && <AssetDictionaryBrowser key={data.version} treePath='/api/org/assets/dictionary/tree' classPath='/api/org/assets/dictionary/class' />}
        </div>
    );
}

// ----- Register -----

function AssetList({ approvals }: { approvals: boolean }) {
    const { data, error, loading } = useLoad(() => callBackend<ListData>('/api/org/assets/list'));
    const rows = useMemo(() => (data?.assets ?? []).filter((a) => !approvals || ['pending_approval', 'change_pending', 'disposal_pending'].includes(a.status)), [data, approvals]);
    const columns = useMemo<Array<Column<AssetRow>>>(
        () => [
            { key: 'tag', label: 'Asset tag', value: (r) => r.tag, className: 'font-mono whitespace-nowrap' },
            { key: 'name', label: 'Name', value: (r) => r.name },
            { key: 'status', label: 'Status', value: (r) => STATUS[r.status]?.label ?? r.status, render: (r) => <Badge tone={STATUS[r.status]?.tone ?? 'muted'}>{STATUS[r.status]?.label ?? r.status}</Badge> },
            { key: 'class', label: 'Asset class', value: (r) => `${r.classCode} ${r.className}` },
            { key: 'location', label: 'Location', value: (r) => `${r.nodeCode} ${r.nodeName}` },
            { key: 'workCenter', label: 'Equipment unit', value: (r) => r.workCenterCode },
            { key: 'completeness', label: 'Required data', type: 'number', value: (r) => r.completeness, render: (r) => `${r.completeness}%` },
            { key: 'group', label: 'Group', value: (r) => r.groupCode, hidden: true },
            { key: 'category', label: 'Category', value: (r) => r.categoryCode, hidden: true },
            { key: 'createdBy', label: 'Created by', value: (r) => r.createdByName, hidden: true },
            { key: 'createdAt', label: 'Created', type: 'date', value: (r) => r.createdAt.slice(0, 10), hidden: true },
            { key: 'approvedBy', label: 'Approved by', value: (r) => r.approvedByName, hidden: true },
            { key: 'updatedAt', label: 'Updated', type: 'date', value: (r) => r.updatedAt.slice(0, 10) },
            { key: 'dictionary', label: 'Dictionary', value: (r) => r.dictionaryVersion, hidden: true },
        ],
        []
    );
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the asset register.'}</Alert>;
    return (
        <div>
            <p className='mb-2 text-xs text-slate-500'>{data.scope === 'all' ? 'Showing the whole organization.' : 'Showing only assets inside your assigned scope.'}</p>
            <RichTable
                id={approvals ? 'assets.approvals' : 'assets.register'}
                title={approvals ? 'Awaiting approval' : 'Asset register'}
                fileName={approvals ? 'MEMS_assets_awaiting_approval' : 'MEMS_asset_register'}
                columns={columns}
                rows={rows}
                rowKey={(r) => r.tag}
                onRowClick={(r) => navigate(`organization_admin/${approvals ? 'asset_approvals' : 'assets'}/${r.tag}`)}
                empty={approvals ? 'Nothing is waiting for approval.' : 'No assets registered yet.'}
                height='h-[calc(100dvh-10rem)]'
                actions={
                    !approvals && data.can.create ? (
                        <button type='button' onClick={() => navigate('organization_admin/assets/new')} className='flex h-8 items-center gap-1 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-onbrand'>
                            <Plus className='h-4 w-4' />
                            New asset
                        </button>
                    ) : null
                }
            />
        </div>
    );
}

function valueText(a: AttrDef, v: unknown): string {
    if (v === undefined || v === null || v === '') return '';
    if (a.dataType === 'boolean') return v === true ? 'Yes' : 'No';
    if (a.dataType === 'enum') return a.options.find((o) => o.code === v)?.label ?? String(v);
    if (a.dataType === 'multi_select' && Array.isArray(v)) return v.map((c) => a.options.find((o) => o.code === c)?.label ?? String(c)).join(', ');
    return `${String(v)}${a.unit ? ` ${a.unit}` : ''}`;
}

const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

export function AssetDetail({ tag, back, onBack, startEditing = false }: { tag: string; back?: string; onBack?: () => void; startEditing?: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ asset: AssetFull; myUid: string; can: ListData['can'] }>('/api/org/assets/get', { tag }), [tag]);
    const classCode = data?.asset.classCode ?? '';
    const cls = useLoad(async () => (classCode ? callBackend<ClassDetail>('/api/org/assets/dictionary/class', { code: classCode }) : null), [classCode]);
    const [editing, setEditing] = useState(startEditing);
    const [acting, setActing] = useState<'' | 'reject' | 'request_disposal' | 'delete' | 'confirm'>('');
    const [note, setNote] = useState('');
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState('');
    const [showAll, setShowAll] = useState(false);

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Asset not found.'}</Alert>;
    const a = data.asset;
    const can = data.can;
    const mine = a.submittedBy === data.myUid || (a.status === 'pending_approval' && a.createdBy === data.myUid);
    const awaiting = ['pending_approval', 'change_pending', 'disposal_pending'].includes(a.status);
    const goBack = () => (onBack ? onBack() : navigate(`organization_admin/${back ?? 'assets'}`));

    if (editing && cls.data)
        return (
            <AssetForm
                asset={a}
                cls={cls.data}
                onDone={() => {
                    setEditing(false);
                    reload();
                }}
                onCancel={() => setEditing(false)}
            />
        );

    const run = async (action: string, extra: Record<string, unknown> = {}) => {
        setBusy(action);
        setActionError('');
        try {
            if (action === 'delete') {
                await callBackend('/api/org/assets/delete', { tag, confirm: note.trim() });
                goBack();
                return;
            }
            await callBackend('/api/org/assets/action', { tag, action, note: note.trim(), ...extra });
            setActing('');
            setNote('');
            setChecked(false);
            reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Action failed.');
        } finally {
            setBusy('');
        }
    };

    const attrs = (cls.data?.attributes ?? []).filter((x) => x.code !== 'ATT-IDN-001' && x.dataType !== 'file');
    const shown = attrs.filter((x) => showAll || hasValue(a.attributes[x.code]) || x.required);
    const byDomain = new Map<string, AttrDef[]>();
    for (const x of shown) byDomain.set(x.domainName, [...(byDomain.get(x.domainName) ?? []), x]);
    const pendingAttrs = a.pending?.attributes ?? null;
    const missing = attrs.filter((x) => x.required && !hasValue(a.attributes[x.code]));
    const filled = attrs.filter((x) => hasValue(a.attributes[x.code]));

    return (
        <div className='space-y-3'>
            <button type='button' onClick={goBack} className='text-sm text-slate-400'>
                ← {onBack ? 'Back' : back === 'asset_approvals' ? 'Awaiting approval' : 'Asset register'}
            </button>
            <Card>
                <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                        <p className='font-mono text-xs text-emerald-300'>{a.tag}</p>
                        <h1 className='text-lg font-semibold text-white'>{a.name}</h1>
                        <p className='text-sm text-slate-400'>
                            {a.classCode} · {a.className}
                        </p>
                    </div>
                    <Badge tone={STATUS[a.status]?.tone ?? 'muted'}>{STATUS[a.status]?.label ?? a.status}</Badge>
                </div>
                <dl className='mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2'>
                    <Item label='Location' value={`${LEVEL_LABELS[a.nodeLevel] ?? a.nodeLevel} ${a.nodeCode} · ${a.nodeName}`} />
                    <Item label='Equipment unit' value={a.workCenterCode || 'Not linked'} />
                    <Item label='Required attributes complete' value={`${a.completeness}%`} />
                    <Item label='Asset master data version' value={a.dictionaryVersion} />
                    <Item label='Created' value={`${fmt(a.createdAt)} by ${a.createdByName}`} />
                    {a.attributesConfirmedAt && <Item label='Attributes confirmed' value={`${fmt(a.attributesConfirmedAt)} by ${a.attributesConfirmedByName}`} />}
                    {a.approvedAt && <Item label='Last approved' value={`${fmt(a.approvedAt)} by ${a.approvedByName}`} />}
                    {cls.data?.usefulLifeYears && <Item label='Typical useful life' value={lifeText(cls.data.usefulLifeYears)} />}
                </dl>
                {a.description && <p className='mt-2 text-sm text-slate-300'>{a.description}</p>}
                {awaiting && (
                    <div className='mt-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-200'>
                        {STATUS[a.status].label} · submitted by {a.submittedByName}
                        {a.pendingNote ? ` · "${a.pendingNote}"` : ''}
                        {mine && <span className='block text-xs text-amber-300/80'>Another approver must decide. You can withdraw it.</span>}
                    </div>
                )}

                <div className='mt-3 flex flex-wrap gap-2'>
                    {(a.status === 'draft' || a.status === 'rejected' || a.status === 'active') && can.edit && (
                        <Button variant='secondary' disabled={!cls.data} onClick={() => setEditing(true)}>
                            <Pencil className='h-4 w-4' />
                            {a.status === 'active' ? 'Propose change' : 'Configure attributes'}
                        </Button>
                    )}
                    {(a.status === 'draft' || a.status === 'rejected') && (can.create || can.edit) && (
                        <Button disabled={!cls.data} onClick={() => setActing('confirm')}>
                            <ClipboardCheck className='h-4 w-4' />
                            Review and confirm
                        </Button>
                    )}
                    {awaiting && can.approve && !mine && (
                        <>
                            <Button busy={busy === 'approve'} onClick={() => run('approve')}>
                                <CheckCircle2 className='h-4 w-4' />
                                Approve
                            </Button>
                            <Button variant='danger' onClick={() => setActing('reject')}>
                                <XCircle className='h-4 w-4' />
                                Reject
                            </Button>
                        </>
                    )}
                    {awaiting && mine && (
                        <Button variant='secondary' busy={busy === 'withdraw'} onClick={() => run('withdraw')}>
                            <Undo2 className='h-4 w-4' />
                            Withdraw
                        </Button>
                    )}
                    {a.status === 'active' && can.edit && (
                        <Button variant='danger' onClick={() => setActing('request_disposal')}>
                            Propose disposal
                        </Button>
                    )}
                    {(a.status === 'draft' || a.status === 'rejected') && !a.approvedAt && can.remove && (
                        <Button variant='danger' onClick={() => setActing('delete')} aria-label='Delete draft'>
                            <Trash2 className='h-4 w-4' />
                        </Button>
                    )}
                </div>

                {acting === 'confirm' && (
                    <div className='mt-3 space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3'>
                        <p className='text-sm font-semibold text-white'>Review the attributes before submitting</p>
                        {missing.length > 0 ? (
                            <div className='rounded-lg bg-red-500/10 p-2 text-xs text-red-300'>
                                {missing.length} required attribute{missing.length === 1 ? ' is' : 's are'} still empty: {missing.map((m) => m.name).join(', ')}. Use Configure attributes to complete them.
                            </div>
                        ) : (
                            <p className='text-xs text-emerald-300'>All {attrs.filter((x) => x.required).length} required attributes are filled.</p>
                        )}
                        <dl className='max-h-72 divide-y divide-slate-800 overflow-y-auto overscroll-contain rounded-xl border border-slate-800'>
                            {filled.map((x) => (
                                <div key={x.code} className='flex items-start justify-between gap-3 px-3 py-2'>
                                    <dt className='min-w-0 text-xs text-slate-400'>
                                        {x.name}
                                        {x.required && <span className='text-red-400'> *</span>}
                                    </dt>
                                    <dd className='text-right text-sm text-white'>{valueText(x, a.attributes[x.code])}</dd>
                                </div>
                            ))}
                        </dl>
                        <label className='flex items-start gap-2 text-sm text-slate-200'>
                            <input type='checkbox' className='mt-1' checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={missing.length > 0} />I have checked these {filled.length} attributes against the physical asset and its documents and confirm they are correct.
                        </label>
                        <div className='flex gap-2'>
                            <Button className='flex-1' busy={busy === 'submit'} disabled={!checked || missing.length > 0} onClick={() => run('submit', { confirmed: true })}>
                                Confirm and submit for approval
                            </Button>
                            <Button variant='secondary' onClick={() => setActing('')}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
                {(acting === 'reject' || acting === 'request_disposal' || acting === 'delete') && (
                    <div className='mt-3 space-y-3 rounded-xl border border-red-500/40 bg-red-500/5 p-3'>
                        {acting === 'delete' ? (
                            <Field id='asset-confirm' label={`Type ${a.tag} to delete this draft`} value={note} autoComplete='off' onChange={(e) => setNote(e.target.value)} />
                        ) : (
                            <TextArea id='asset-note' label={acting === 'reject' ? 'Reason for rejecting (required)' : 'Reason for disposal (required)'} rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                        )}
                        <div className='flex gap-2'>
                            <Button variant='danger' className='flex-1' busy={busy === acting} disabled={acting === 'delete' ? note.trim() !== a.tag : note.trim().length < 5} onClick={() => run(acting)}>
                                Confirm
                            </Button>
                            <Button
                                variant='secondary'
                                onClick={() => {
                                    setActing('');
                                    setNote('');
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
                {actionError && <div className='mt-3'><Alert tone='error'>{actionError}</Alert></div>}
            </Card>

            <Card>
                <div className='mb-2 flex items-center justify-between'>
                    <h2 className='font-semibold text-white'>Attributes</h2>
                    <button type='button' onClick={() => setShowAll(!showAll)} className='text-xs text-emerald-300'>
                        {showAll ? 'Show filled and required' : `Show all ${attrs.length}`}
                    </button>
                </div>
                {cls.loading && !cls.data ? (
                    <Spinner />
                ) : (
                    <div className='max-h-[60vh] space-y-3 overflow-y-auto overscroll-contain pr-1'>
                        {Array.from(byDomain.entries()).map(([domain, items]) => (
                            <div key={domain}>
                                <p className='mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500'>{domain}</p>
                                <dl className='divide-y divide-slate-800 rounded-xl border border-slate-800'>
                                    {items.map((x) => {
                                        const current = valueText(x, a.attributes[x.code]);
                                        const proposed = pendingAttrs ? valueText(x, pendingAttrs[x.code]) : current;
                                        return (
                                            <div key={x.code} className='flex items-start justify-between gap-3 px-3 py-2'>
                                                <dt className='min-w-0 text-xs text-slate-400'>
                                                    {x.name}
                                                    {x.required && <span className='text-red-400'> *</span>}
                                                </dt>
                                                <dd className='text-right text-sm text-white'>
                                                    {current || <span className={x.required ? 'text-red-400' : 'text-slate-600'}>{x.required ? 'Missing' : '—'}</span>}
                                                    {pendingAttrs && proposed !== current && <span className='block text-xs text-amber-300'>→ {proposed || 'cleared'}</span>}
                                                </dd>
                                            </div>
                                        );
                                    })}
                                </dl>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <Card>
                <h2 className='mb-2 font-semibold text-white'>History</h2>
                <ol className='max-h-72 space-y-2 overflow-y-auto overscroll-contain'>
                    {[...a.history].reverse().map((h, i) => (
                        <li key={i} className='border-l-2 border-emerald-500/40 pl-3 text-sm'>
                            <p className='text-white'>{ACTION_LABELS[h.action] ?? h.action}</p>
                            <p className='text-xs text-slate-500'>
                                {fmt(h.at)} · {h.byName}
                            </p>
                            {h.note && <p className='text-xs text-slate-400'>{h.note}</p>}
                        </li>
                    ))}
                </ol>
            </Card>
        </div>
    );
}

function Item({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className='text-xs text-slate-500'>{label}</dt>
            <dd className='text-slate-200'>{value}</dd>
        </div>
    );
}

type Val = string | string[];

function toInput(a: AttrDef, v: unknown): Val {
    if (v === undefined || v === null) return a.dataType === 'multi_select' ? [] : '';
    if (a.dataType === 'multi_select') return Array.isArray(v) ? v.map(String) : [];
    if (a.dataType === 'boolean') return v === true ? 'true' : v === false ? 'false' : '';
    return String(v);
}

/** Client-side verification mirrors the server rules so mistakes are caught before sending. */
function checkValue(a: AttrDef, v: Val): string {
    if (Array.isArray(v) || v.trim() === '') return '';
    const val = a.validation ?? {};
    if (a.dataType === 'integer' || a.dataType === 'decimal') {
        const n = Number(v.replace(/,/g, ''));
        if (!Number.isFinite(n) || (a.dataType === 'integer' && !Number.isInteger(n))) return a.dataType === 'integer' ? 'Enter a whole number.' : 'Enter a number.';
        if (typeof val.minimum === 'number' && n < val.minimum) return `At least ${val.minimum}.`;
        if (typeof val.maximum === 'number' && n > val.maximum) return `At most ${val.maximum}.`;
    }
    if (a.dataType === 'text') {
        if (v.length > (val.maxLength ?? 500)) return `Up to ${val.maxLength ?? 500} characters.`;
        if (val.pattern) {
            try {
                if (!new RegExp(val.pattern).test(v.trim())) return 'Not in the expected format.';
            } catch {
                /* pattern checked on the server */
            }
        }
    }
    return '';
}

const isBlank = (v: Val | undefined) => (Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim());

export function AssetForm({
    asset,
    cls: initialCls,
    workCenter,
    onDone,
    onCancel,
}: {
    asset?: AssetFull;
    cls?: ClassDetail;
    /** When set, the new asset is created at and attributed to this work center. */
    workCenter?: { id: string; code: string; name: string };
    onDone?: (tag: string) => void;
    onCancel?: () => void;
}) {
    const [cls, setCls] = useState<ClassDetail | null>(initialCls ?? null);
    const locations = useLoad(() => (workCenter ? Promise.resolve({ locations: [] as Array<{ id: string; code: string; name: string; level: string }> }) : callBackend<{ locations: Array<{ id: string; code: string; name: string; level: string }> }>('/api/org/assets/locations')));
    const ref = useLoad(() => fetchReference());
    const [name, setName] = useState(asset?.name ?? (workCenter ? workCenter.name : ''));
    const [description, setDescription] = useState(asset?.description ?? '');
    const [nodeId, setNodeId] = useState(asset?.nodeId ?? workCenter?.id ?? '');
    const [eligibleEquipment, setEligibleEquipment] = useState<Array<{ id: string; code: string; name: string }>>([]);
    const [selectedEquipmentId, setSelectedEquipmentId] = useState('');
    const [equipmentLoading, setEquipmentLoading] = useState(false);
    const [note, setNote] = useState('');
    const [changeConfirmed, setChangeConfirmed] = useState(false);
    const [values, setValues] = useState<Record<string, Val>>(() => {
        const out: Record<string, Val> = {};
        if (initialCls && asset) for (const x of initialCls.attributes) out[x.code] = toInput(x, asset.attributes[x.code]);
        return out;
    });
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [requiredOnly, setRequiredOnly] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const isActive = asset?.status === 'active';
    useEffect(() => {
        if (asset || workCenter || !cls?.code || !nodeId) {
            setEligibleEquipment([]); setSelectedEquipmentId(''); return;
        }
        let current = true;
        setEquipmentLoading(true);
        setSelectedEquipmentId('');
        callBackend<{ candidates: Array<{ id: string; code: string; name: string }> }>(
            '/api/org/assets/eligible-equipment', { classCode: cls.code, nodeId }
        ).then((res) => { if (current) setEligibleEquipment(res.candidates); })
            .catch(() => { if (current) setEligibleEquipment([]); })
            .finally(() => { if (current) setEquipmentLoading(false); });
        return () => { current = false; };
    }, [asset?.tag, workCenter?.id, cls?.code, nodeId]);
    const cancel = () => (onCancel ? onCancel() : navigate('organization_admin/assets'));

    if (!cls) {
        return (
            <div>
                <PageTitle
                    title={workCenter ? `Equipment unit ${workCenter.code} · choose the equipment class` : 'New asset · choose the asset class'}
                    subtitle="Find the class that best describes the machine, line or equipment. Its attributes come from your organization's asset master data."
                />
                <AssetDictionaryBrowser
                    treePath='/api/org/assets/dictionary/tree'
                    classPath='/api/org/assets/dictionary/class'
                    onPick={(c) => {
                        setCls(c);
                        setValues(Object.fromEntries(c.attributes.map((x) => [x.code, toInput(x, undefined)])));
                        const first = c.attributes.find((x) => x.required && x.code !== 'ATT-IDN-001');
                        setOpen(first ? { [first.domainName]: true } : {});
                    }}
                />
                <button type='button' onClick={cancel} className='mt-3 text-sm text-slate-400'>
                    Cancel
                </button>
            </div>
        );
    }

    const editable = cls.attributes.filter((x) => x.code !== 'ATT-IDN-001' && x.dataType !== 'file');
    const shown = editable.filter((x) => !requiredOnly || x.required);
    const groups = new Map<string, AttrDef[]>();
    for (const x of shown) groups.set(x.domainName, [...(groups.get(x.domainName) ?? []), x]);
    const requiredTotal = editable.filter((x) => x.required).length;
    const requiredMissing = editable.filter((x) => x.required && isBlank(values[x.code])).length;

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        const errs: Record<string, string> = {};
        if (name.trim().length < 2 || name.trim().length > 80) errs.name = 'Enter a name of 2 to 80 characters.';
        if (!nodeId) errs.nodeId = 'Choose the location.';
        if (isActive && note.trim().length < 5) errs.note = 'Explain the change (at least 5 characters).';
        if (isActive && !changeConfirmed) errs.changeConfirmed = 'Confirm the changed attributes.';
        if (isActive && requiredMissing) errs.name = errs.name ?? 'Complete every required attribute before proposing a change.';
        const attributes: Record<string, unknown> = {};
        for (const x of editable) {
            const v = values[x.code] ?? '';
            const msg = checkValue(x, v);
            if (msg) errs[x.code] = msg;
            if (Array.isArray(v)) {
                if (v.length) attributes[x.code] = v;
            } else if (v.trim()) {
                attributes[x.code] = x.dataType === 'integer' || x.dataType === 'decimal' ? Number(v.replace(/,/g, '')) : x.dataType === 'boolean' ? v === 'true' : v.trim();
            }
        }
        setFieldErrors(errs);
        if (Object.keys(errs).length) {
            const firstDomain = editable.find((x) => errs[x.code])?.domainName;
            if (firstDomain) setOpen((o) => ({ ...o, [firstDomain]: true }));
            setError('Please correct the highlighted fields.');
            return;
        }
        setBusy(true);
        try {
            const res = await callBackend<{ tag: string }>('/api/org/assets/save', {
                tag: asset?.tag,
                classCode: cls.code,
                name: name.trim(),
                description: description.trim(),
                nodeId,
                workCenterId: !asset ? (workCenter?.id || selectedEquipmentId || undefined) : undefined,
                attributes,
                note: note.trim(),
                confirmed: isActive ? changeConfirmed : undefined,
            });
            if (onDone) onDone(res.tag);
            else navigate(`organization_admin/assets/${res.tag}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy(false);
        }
    };

    const input = 'h-11 w-full rounded-xl border bg-slate-950 px-3 text-base text-white focus:border-emerald-500 focus:outline-none';
    const renderInput = (x: AttrDef) => {
        const v = values[x.code] ?? '';
        const set = (nv: Val) => setValues((st) => ({ ...st, [x.code]: nv }));
        const border = fieldErrors[x.code] ? 'border-red-500' : 'border-slate-700';
        const id = `att-${x.code}`;
        if (x.dataType === 'multi_select') {
            const list = Array.isArray(v) ? v : [];
            return (
                <div className='flex flex-wrap gap-1'>
                    {x.options.map((o) => {
                        const on = list.includes(o.code);
                        return (
                            <button key={o.code} type='button' onClick={() => set(on ? list.filter((c) => c !== o.code) : [...list, o.code])} className={`rounded-full px-3 py-1 text-xs ring-1 ${on ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/50' : 'text-slate-300 ring-slate-700'}`}>
                                {o.label}
                            </button>
                        );
                    })}
                </div>
            );
        }
        const sv = Array.isArray(v) ? '' : v;
        if (x.dataType === 'enum' || x.dataType === 'boolean' || x.dataType === 'country' || x.dataType === 'currency') {
            const opts =
                x.dataType === 'enum'
                    ? x.options.map((o) => ({ value: o.code, label: o.label }))
                    : x.dataType === 'boolean'
                      ? [
                            { value: 'true', label: 'Yes' },
                            { value: 'false', label: 'No' },
                        ]
                      : x.dataType === 'country'
                        ? (ref.data?.countries ?? []).map((c) => ({ value: c.iso2, label: `${c.flag} ${c.name}` }))
                        : (ref.data?.currencies ?? []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }));
            return (
                <select id={id} value={sv} onChange={(e) => set(e.target.value)} className={`${input} ${border}`}>
                    <option value=''>—</option>
                    {opts.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
            );
        }
        const numeric = x.dataType === 'integer' || x.dataType === 'decimal';
        return (
            <div className='flex items-center gap-2'>
                <input
                    id={id}
                    type={x.dataType === 'date' ? 'date' : 'text'}
                    inputMode={numeric ? 'decimal' : undefined}
                    maxLength={numeric ? 24 : Math.min(x.validation?.maxLength ?? 500, 2000)}
                    value={sv}
                    onChange={(e) => set(e.target.value)}
                    className={`${input} ${border}`}
                />
                {x.unit && <span className='shrink-0 text-xs text-slate-400'>{x.unit}</span>}
            </div>
        );
    };

    return (
        <form onSubmit={submit} noValidate className='space-y-3'>
            <div className='sticky top-14 z-10 -mx-4 flex items-center gap-2 border-b border-slate-800 bg-slate-950/95 px-4 py-2 backdrop-blur lg:top-0'>
                <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-semibold text-white'>{asset ? `${asset.tag} · ${isActive ? 'propose change' : 'configure attributes'}` : workCenter ? `New asset for ${workCenter.code}` : 'New asset'}</p>
                    <p className='truncate text-xs text-slate-500'>
                        {cls.code} · {cls.name} · required {requiredTotal - requiredMissing}/{requiredTotal}
                    </p>
                </div>
                <Button type='submit' busy={busy}>
                    {isActive ? 'Send for approval' : 'Save'}
                </Button>
                <Button type='button' variant='secondary' onClick={cancel}>
                    Cancel
                </Button>
            </div>
            {error && <Alert tone='error'>{error}</Alert>}
            <Card className='space-y-3'>
                {!asset && (
                    <button type='button' onClick={() => setCls(null)} className='text-xs text-emerald-300'>
                        Change asset class
                    </button>
                )}
                <Field id='asset-name' label='Asset name *' maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                {fieldErrors.name && <p className='text-xs text-red-400'>{fieldErrors.name}</p>}
                {workCenter && !asset ? (
                    <div>
                        <span className='mb-1 block text-sm text-slate-300'>Location</span>
                        <p className='rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm text-slate-300'>
                            Equipment unit {workCenter.code} · {workCenter.name}
                        </p>
                    </div>
                ) : (
                    <>
                        <SelectField id='asset-location' label='Location *' value={nodeId} onChange={(e) => setNodeId(e.target.value)} disabled={!!asset?.workCenterId}>
                            <option value={asset ? asset.nodeId : ''}>{locations.loading ? 'Loading…' : asset ? `${asset.nodeCode} · ${asset.nodeName}` : 'Select…'}</option>
                            {(locations.data?.locations ?? [])
                                .filter((l) => (asset || l.level !== 'work_center') && (!asset || l.id !== asset.nodeId))
                                .map((l) => (
                                    <option key={l.id} value={l.id}>
                                        {l.code} · {l.name} ({LEVEL_LABELS[l.level] ?? l.level})
                                    </option>
                                ))}
                        </SelectField>
                        {asset?.workCenterId && <p className='text-xs text-slate-500'>Located at its equipment unit {asset.workCenterCode}.</p>}
                    </>
                )}
                {fieldErrors.nodeId && <p className='text-xs text-red-400'>{fieldErrors.nodeId}</p>}
                {!asset && !workCenter && nodeId && (
                    <div className='space-y-2 rounded-xl border border-line bg-panel p-3'>
                        <h3 className='text-sm font-semibold text-ink'>Assign an existing equipment unit (optional)</h3>
                        <p className='text-xs text-soft'>Only unassigned equipment at the same site with the exact category, subcategory and class can be selected. One asset ↔ one equipment.</p>
                        <SelectField id='asset-match-equipment' label='Compatible equipment' value={selectedEquipmentId}
                            disabled={equipmentLoading} onChange={(e)=>setSelectedEquipmentId(e.target.value)}>
                            <option value=''>{equipmentLoading ? 'Checking compatible equipment…' : 'No equipment mapping — register asset only'}</option>
                            {eligibleEquipment.map((u)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
                        </SelectField>
                        <p className='text-xs text-soft'>{selectedEquipmentId ? 'This equipment and asset will be mapped together when saved.' :
                            `${eligibleEquipment.length} compatible unassigned equipment unit(s) available at the selected site.`}</p>
                    </div>
                )}
                <TextArea id='asset-description' label='Description (optional)' rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
                {isActive && (
                    <>
                        <TextArea id='asset-change-note' label='Reason for the change *' rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                        {fieldErrors.note && <p className='text-xs text-red-400'>{fieldErrors.note}</p>}
                        <label className='flex items-start gap-2 text-sm text-slate-200'>
                            <input type='checkbox' className='mt-1' checked={changeConfirmed} onChange={(e) => setChangeConfirmed(e.target.checked)} />I confirm the changed attributes are correct.
                        </label>
                        {fieldErrors.changeConfirmed && <p className='text-xs text-red-400'>{fieldErrors.changeConfirmed}</p>}
                        <p className='text-xs text-amber-300'>Changes to an active asset are applied only after another approver accepts them.</p>
                    </>
                )}
            </Card>

            <div className='flex items-center justify-between gap-3'>
                <p className='text-xs text-slate-400'>Save as often as you like. Before approval, every required attribute (*) must be filled and confirmed.</p>
                <label className='flex shrink-0 items-center gap-2 text-xs text-slate-300'>
                    <input type='checkbox' checked={requiredOnly} onChange={(e) => setRequiredOnly(e.target.checked)} />
                    Required only
                </label>
            </div>

            {Array.from(groups.entries()).map(([domain, items]) => {
                const isOpen = open[domain] ?? false;
                const missing = items.filter((x) => x.required && isBlank(values[x.code])).length;
                const errors = items.filter((x) => fieldErrors[x.code]).length;
                return (
                    <Card key={domain}>
                        <button type='button' onClick={() => setOpen((o) => ({ ...o, [domain]: !isOpen }))} className='flex w-full items-center justify-between gap-2 text-left'>
                            <span className='min-w-0'>
                                <span className='block text-sm font-medium text-white'>{domain}</span>
                                <span className={`text-xs ${missing || errors ? 'text-amber-300' : 'text-slate-500'}`}>
                                    {items.length} fields{missing ? ` · ${missing} required left` : ''}
                                    {errors ? ` · ${errors} to fix` : ''}
                                </span>
                            </span>
                            {isOpen ? <ChevronDown className='h-4 w-4 text-slate-400' /> : <ChevronRight className='h-4 w-4 text-slate-400' />}
                        </button>
                        {isOpen && (
                            <div className='mt-3 space-y-3'>
                                {items.map((x) => (
                                    <div key={x.code}>
                                        <label htmlFor={`att-${x.code}`} className='mb-1 block text-sm text-slate-300'>
                                            {x.name}
                                            {x.required && <span className='text-red-400'> *</span>}
                                            <span className='ml-1 text-[10px] text-slate-600'>{typeLabel(x.dataType)}</span>
                                        </label>
                                        {renderInput(x)}
                                        {fieldErrors[x.code] ? <p className='mt-1 text-xs text-red-400'>{fieldErrors[x.code]}</p> : x.description ? <p className='mt-1 text-xs text-slate-500'>{x.description}</p> : null}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                );
            })}
        </form>
    );
}
