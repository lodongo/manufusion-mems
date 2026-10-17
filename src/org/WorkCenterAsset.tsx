import { useState } from 'react';
import { AlertTriangle, Cog, Link2, Plus, Unlink } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Card, PageTitle, Spinner, useLoad } from '../admin/kit';
import { AssetDetail, AssetForm, STATUS, type AssetFull } from './AssetRegister';

// The asset record of an equipment unit (machine, line, utility system or facility). Its class comes from the
// organization's asset catalog; its attributes are configured here, confirmed by the person configuring them and
// approved by another user.

interface WorkCenterAssetData {
    workCenter: { id: string; code: string; name: string; classCode?: string; className?: string };
    astEnabled: boolean;
    dictionaryImported: boolean;
    can: { create: boolean; edit: boolean; approve: boolean; link: boolean };
    asset: AssetFull | null;
    candidates: Array<{ tag: string; name: string; className: string; nodeCode: string; status?: string }>;
}

export default function WorkCenterAsset({ workCenterId, configure = false, onBack }: { workCenterId: string; configure?: boolean; onBack: () => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<WorkCenterAssetData>('/api/org/assets/work-center', { workCenterId }), [workCenterId]);
    const [view, setView] = useState<'' | 'create' | 'detail' | 'link' | 'unlink'>(configure ? 'detail' : '');
    const [firstOpen, setFirstOpen] = useState(configure);
    const [tag, setTag] = useState('');
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the work center asset.'}</Alert>;
    const wc = data.workCenter;
    const back = () => {
        setView('');
        setFirstOpen(false);
        reload();
    };

    if (view === 'create') return <AssetForm workCenter={wc} onDone={() => back()} onCancel={() => setView('')} />;
    if (view === 'detail' && data.asset) return <AssetDetail tag={data.asset.tag} onBack={back} startEditing={firstOpen && (data.asset.status === 'draft' || data.asset.status === 'rejected')} />;

    const link = async (target: string) => {
        setBusy(true);
        setActionError('');
        try {
            await callBackend('/api/org/assets/link', { workCenterId: wc.id, tag: target, confirm: typed.trim() });
            setTyped('');
            setTag('');
            back();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not update the link.');
        } finally {
            setBusy(false);
        }
    };

    const a = data.asset;
    return (
        <div className='space-y-3'>
            <button type='button' onClick={onBack} className='text-sm text-slate-400'>
                ← Equipment unit {wc.code}
            </button>
            <PageTitle title={`${wc.name} · asset and attributes`} subtitle={`Equipment unit ${wc.code}. Its class and attributes come from your organization's asset catalog.`} />

            {!data.astEnabled ? (
                <Card>
                    <p className='flex items-center gap-2 text-sm text-amber-300'>
                        <AlertTriangle className='h-4 w-4' />
                        Asset Management (AST) is not enabled for your organization.
                    </p>
                    <Button variant='secondary' className='mt-3' onClick={() => navigate('organization_admin/modules')}>
                        Go to modules
                    </Button>
                </Card>
            ) : !data.dictionaryImported ? (
                <Card>
                    <p className='flex items-center gap-2 text-sm text-amber-300'>
                        <AlertTriangle className='h-4 w-4' />
                        MEMS has not loaded the asset catalog yet.
                    </p>
                    <Button variant='secondary' className='mt-3' onClick={() => navigate('organization_admin/asset_dictionary')}>
                        Open asset catalog
                    </Button>
                </Card>
            ) : a ? (
                <Card>
                    <div className='flex items-start gap-3'>
                        <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10'>
                            <Cog className='h-5 w-5 text-amber-400' />
                        </span>
                        <div className='min-w-0 flex-1'>
                            <p className='font-mono text-xs text-emerald-300'>{a.tag}</p>
                            <p className='font-medium text-white'>{a.name}</p>
                            <p className='text-xs text-slate-400'>
                                {a.classCode} · {a.className}
                            </p>
                            <div className='mt-2 flex flex-wrap gap-1'>
                                <Badge tone={STATUS[a.status]?.tone ?? 'muted'}>{STATUS[a.status]?.label ?? a.status}</Badge>
                                <Badge tone={a.completeness === 100 ? 'brand' : 'warn'}>{a.completeness}% required attributes</Badge>
                                {a.attributesConfirmedAt ? <Badge tone='brand'>Confirmed by {a.attributesConfirmedByName}</Badge> : <Badge tone='warn'>Not confirmed yet</Badge>}
                            </div>
                        </div>
                    </div>
                    <p className='mt-3 text-xs text-slate-400'>
                        {a.status === 'draft' || a.status === 'rejected'
                            ? 'Next: configure every required attribute, then review and confirm to send it for approval.'
                            : a.status === 'active'
                              ? 'Approved and in use. Changes to its attributes are proposed and approved again.'
                              : 'Waiting for another approver.'}
                    </p>
                    <div className='mt-3 flex flex-wrap gap-2'>
                        <Button onClick={() => setView('detail')}>{a.status === 'draft' || a.status === 'rejected' ? 'Configure and confirm attributes' : 'Open asset'}</Button>
                        {data.can.link && (
                            <Button variant='danger' onClick={() => setView('unlink')} aria-label='Unlink asset'>
                                <Unlink className='h-4 w-4' />
                            </Button>
                        )}
                    </div>
                    {view === 'unlink' && (
                        <div className='mt-3 space-y-3 rounded-xl border border-red-500/40 bg-red-500/5 p-3'>
                            <p className='text-sm text-slate-200'>Remove {a.tag} from equipment unit {wc.code}? The asset stays in the register.</p>
                            <Field id='unlink-confirm' label={`Type ${a.tag} to confirm`} value={typed} autoComplete='off' onChange={(e) => setTyped(e.target.value)} />
                            <div className='flex gap-2'>
                                <Button variant='danger' className='flex-1' busy={busy} disabled={typed.trim() !== a.tag} onClick={() => link('')}>
                                    Unlink
                                </Button>
                                <Button variant='secondary' onClick={() => setView('')}>
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}
                </Card>
            ) : (
                <Card className='space-y-3'>
                    <p className='text-sm text-slate-300'>This equipment unit has no linked asset. You can adopt one compatible, unassigned asset or create a new draft.</p>
                    {data.can.create && data.can.link && (
                        <button type='button' onClick={() => setView('create')} className='flex w-full items-center gap-3 rounded-2xl border border-emerald-500/40 p-4 text-left active:bg-slate-800'>
                            <Plus className='h-6 w-6 shrink-0 text-emerald-400' />
                            <span>
                                <span className='block font-medium text-white'>Choose its equipment class and configure attributes</span>
                                <span className='block text-xs text-slate-400'>Pick the class from the asset catalog, fill in its attributes, then confirm them for approval.</span>
                            </span>
                        </button>
                    )}
                    {data.can.link && (
                        <button type='button' onClick={() => setView('link')} disabled={!data.candidates.length} className='flex w-full items-center gap-3 rounded-2xl border border-slate-700 p-4 text-left active:bg-slate-800 disabled:opacity-50'>
                            <Link2 className='h-6 w-6 shrink-0 text-sky-400' />
                            <span>
                                <span className='block font-medium text-white'>Link an existing asset</span>
                                <span className='block text-xs text-slate-400'>{data.candidates.length ? `${data.candidates.length} compatible draft or approved assets are available at this site.` : 'No compatible, unassigned assets at this site.'}</span>
                            </span>
                        </button>
                    )}
                    {!data.can.link && <p className='text-xs text-slate-500'>You need the organization design permission and Asset Management create rights to configure the unit's asset.</p>}
                    {view === 'link' && (
                        <div className='space-y-3 rounded-xl border border-sky-500/40 bg-sky-500/5 p-3'>
                            <SelectField id='link-asset' label='Asset' value={tag} onChange={(e) => setTag(e.target.value)}>
                                <option value=''>Select…</option>
                                {data.candidates.map((c) => (
                                    <option key={c.tag} value={c.tag}>
                                        {c.tag} · {c.name} ({c.className}; {c.status || 'active'})
                                    </option>
                                ))}
                            </SelectField>
                            {tag && <Field id='link-confirm' label={`Type ${tag} to confirm`} value={typed} autoComplete='off' onChange={(e) => setTyped(e.target.value)} />}
                            <div className='flex gap-2'>
                                <Button className='flex-1' busy={busy} disabled={!tag || typed.trim() !== tag} onClick={() => link(tag)}>
                                    Link to {wc.code}
                                </Button>
                                <Button variant='secondary' onClick={() => setView('')}>
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}
                </Card>
            )}
            {actionError && <Alert tone='error'>{actionError}</Alert>}
        </div>
    );
}
