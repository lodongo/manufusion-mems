import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type TouchEvent } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ClipboardList, ImagePlus, MapPin, Pencil, Send, Trash2, Undo2, Wrench, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import MntTaskAssessment,{type TaskAssessment} from './MntTaskAssessment';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Card, Spinner, TextArea, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { AssemblyPicker, GroupPicker, Info, LEVEL_LABEL, compressPhoto, critColor, findIn, type ListGroup, type MntLists, type MntSetup, type Place } from './mntShared';

// Maintenance (MNT): work requests. A finding raised against an assembly, numbered WR + 8 digits by the server.
// Requests are not approved: they are reviewed and assessed, then returned for information, declined, or
// converted to a work order (after which they are locked). The requester can never review their own request.
// Mobile first: one decision per screen, big touch targets, action bar on top, content scrolls underneath.

interface Row {
    code: string;
    title: string;
    status: string;
    statusLabel: string;
    assemblyCode: string;
    assemblyName: string;
    unitCode: string;
    unitName: string;
    costCenterCode: string;
    costCenterName: string;
    siteCode: string;
    assetTag: string;
    assetName: string;
    assetClass: string;
    sourceLabel: string;
    sourceGroup: string;
    criticalityCode: string;
    criticalityLabel: string;
    criticalityColor: string;
    impactLabels: string[];
    photoCount: number;
    priorityLabel: string;
    maintenanceTypeLabel: string;
    requestedBy: string;
    requestedByName: string;
    requestedAt: string;
    reviewerName: string;
    assessmentReviewStatus: string;
    woCode: string;
    updatedAt: string;
}
interface WrCan {
    view: boolean;
    edit: boolean;
    resubmit: boolean;
    cancel: boolean;
    startReview: boolean;
    assess: boolean;
    reviewAssessment: boolean;
    return: boolean;
    decline: boolean;
    convert: boolean;
    ownRequest: boolean;
}
interface Detail extends Row {
    description: string;
    sourceCode: string;
    criticalityOriginalLabel: string;
    failureModeCode: string;
    failureModeLabel: string;
    impacts: Array<{ code: string; label: string; group: string }>;
    photos: Array<{ token: string; url: string }>;
    assessmentTasks: TaskAssessment[];
    assessment: {
        maintenanceTypeCode: string;
        maintenanceTypeLabel: string;
        workTypeCode: string;
        workTypeLabel: string;
        priorityCode: string;
        priorityLabel: string;
        disciplineCode: string;
        disciplineLabel: string;
        duplicateOf: string;
        note: string;
    };
    assessmentReview: {status:string;version?:number;name?:string;at?:string;note?:string};
    assessmentReviewCurrent: boolean;
    returnNote: string;
    declineReason: string;
    history: Array<{ at: string; name: string; action: string; note: string }>;
    can: WrCan;
}

export const WR_TONE: Record<string, 'brand' | 'muted' | 'danger' | 'warn'> = { submitted: 'warn', under_review: 'warn', returned: 'danger', declined: 'muted', cancelled: 'muted', converted: 'brand' };

export function useMntSetup() {
    return useLoad(() => callBackend<MntSetup>('/api/org/mnt/setup'));
}

export function NotEnabled() {
    return (
        <Card>
            <p className='flex items-center gap-2 text-sm text-amber-300'>
                <AlertTriangle className='h-4 w-4' />
                Maintenance Management (MNT) is not enabled for your organization.
            </p>
            <Button variant='secondary' className='mt-3' onClick={() => navigate('organization_admin/modules')}>
                Go to modules
            </Button>
        </Card>
    );
}

export default function WorkRequests({ id, sub }: { id?: string; sub?: string }) {
    const setup = useMntSetup();
    if (setup.loading && !setup.data) return <Spinner />;
    if (setup.error || !setup.data) return <Alert tone='error'>{setup.error || 'Could not load maintenance.'}</Alert>;
    const s = setup.data;
    if (!s.enabled) return <NotEnabled />;
    if (id === 'new') return s.can.WR_create ? <NewRequest key={sub ?? 'new'} setup={s} assemblyId={sub} /> : <Alert tone='error'>Your job role or security role does not include raising work requests.</Alert>;
    if (id && /^WR\d{8}$/.test(id)) return <RequestDetail key={id} code={id} setup={s} />;
    return <RequestList setup={s} />;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function useColumns(): Array<Column<Row>> {
    return useMemo(
        () => [
            { key: 'code', label: 'WR number', value: (r) => r.code, className: 'font-mono whitespace-nowrap' },
            { key: 'title', label: 'Title', value: (r) => r.title },
            {
                key: 'criticality',
                label: 'Criticality',
                value: (r) => r.criticalityLabel,
                render: (r) => (
                    <span className='inline-flex items-center gap-1.5 whitespace-nowrap'>
                        <span className='h-2.5 w-2.5 rounded-full' style={{ background: critColor(r.criticalityCode, r.criticalityColor) }} />
                        {r.criticalityLabel}
                    </span>
                ),
            },
            { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={WR_TONE[r.status] ?? 'muted'}>{r.statusLabel}</Badge> },
            { key: 'wo', label: 'Work order', value: (r) => r.woCode, className: 'font-mono whitespace-nowrap' },
            { key: 'asset', label: 'Asset', value: (r) => `${r.assetTag} ${r.assetName}` },
            { key: 'assembly', label: 'Assembly', value: (r) => `${r.assemblyCode} ${r.assemblyName}` },
            { key: 'unit', label: 'Equipment unit', value: (r) => `${r.unitCode} ${r.unitName}` },
            { key: 'cc', label: 'Cost center', value: (r) => `${r.costCenterCode} ${r.costCenterName}`, hidden: true },
            { key: 'source', label: 'Source', value: (r) => `${r.sourceGroup} · ${r.sourceLabel}`, hidden: true },
            { key: 'priority', label: 'Priority', value: (r) => r.priorityLabel },
            { key: 'mtype', label: 'Maintenance type', value: (r) => r.maintenanceTypeLabel, hidden: true },
            { key: 'impacts', label: 'Impacts', value: (r) => r.impactLabels.join(', '), hidden: true },
            { key: 'by', label: 'Requested by', value: (r) => r.requestedByName },
            { key: 'at', label: 'Requested', type: 'date', value: (r) => r.requestedAt, render: (r) => fmtDate(r.requestedAt) },
            { key: 'reviewer', label: 'Reviewer', value: (r) => r.reviewerName, hidden: true },
        ],
        []
    );
}

function RequestList({ setup }: { setup: MntSetup }) {
    const can = setup.can;
    type Tab = 'all' | 'open' | 'mine' | 'review';
    const [tab, setTab] = useState<Tab>(() => {
        let requested = '';
        try {
            const route = window.location.hash.replace(/^#\/?/, '');
            requested = sessionStorage.getItem('mems.table.tab.' + route) || '';
            sessionStorage.removeItem('mems.table.tab.' + route);
        } catch { /* Restoring a table is optional. */ }
        return (['all', 'open', 'mine', 'review'].includes(requested) && (requested !== 'review' || can.WR_review || can.assessment_review)
            ? requested : (can.WR_review || can.assessment_review ? 'review' : 'all')) as Tab;
    });
    const { data, error, loading } = useLoad(() => callBackend<{ rows: Row[] }>('/api/org/mnt/wr/list', { view: tab }), [tab]);
    const columns = useColumns();
    const tabs: Array<[Tab, string]> = [...((can.WR_review || can.assessment_review) ? ([['review', 'To review']] as Array<[Tab, string]>) : []), ['open', 'Open'], ['mine', 'Mine'], ['all', 'All']];
    return (
        <div className='space-y-3'>
            <div className='flex gap-1 overflow-x-auto rounded-xl border border-slate-800 p-1'>
                {tabs.map(([k, label]) => (
                    <button key={k} type='button' onClick={() => setTab(k)} className={`h-9 shrink-0 rounded-lg px-3 text-sm ${tab === k ? 'bg-emerald-500 text-onbrand' : 'text-slate-300'}`}>
                        {label}
                    </button>
                ))}
            </div>
            {error && <Alert tone='error'>{error}</Alert>}
            {loading && !data ? (
                <Spinner />
            ) : (
                <RichTable
                    id={`mnt.wr.${tab}`}
                    tabKey={tab}
                    title='Work requests'
                    fileName={`work_requests_${tab}`}
                    columns={columns}
                    rows={data?.rows ?? []}
                    rowKey={(r) => r.code}
                    onRowClick={(r) => navigate(`organization_admin/work_requests/${r.code}`)}
                    empty={tab === 'review' ? 'Nothing is waiting for your review.' : 'No work requests here.'}
                    height='h-[calc(100dvh-12rem)]'
                    actions={
                        can.WR_create ? (
                            <Button onClick={() => navigate('organization_admin/work_requests/new')}>
                                <Wrench className='h-4 w-4' />
                                New
                            </Button>
                        ) : undefined
                    }
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// New request wizard
// ---------------------------------------------------------------------------

const STEPS = ['Where', 'Finding', 'Criticality', 'Photos', 'Review'] as const;
interface GembaWrHandoff { id: string; observationId: string; assemblyId: string; assetTag: string; title: string; description: string; gembaTypeCode?: string; gembaTypeName?: string; photoPath?: string; photoUrl?: string }
function pendingGembaWr(assemblyId: string): GembaWrHandoff | null {
    try {
        const raw = sessionStorage.getItem('mems.gemba.pending_wr');
        if (!raw) return null;
        const value = JSON.parse(raw) as GembaWrHandoff;
        return value.assemblyId === assemblyId && /^[A-Za-z0-9_-]{8,40}$/.test(value.id)
            && /^[A-Za-z0-9_-]{8,40}$/.test(value.observationId) ? value : null;
    } catch { return null; }
}

function NewRequest({ setup, assemblyId }: { setup: MntSetup; assemblyId?: string }) {
    const lists = setup.lists!;
    const [step, setStep] = useState(0);
    const [place, setPlace] = useState<Place | null>(null);
    const [placeError, setPlaceError] = useState('');
    const [loadingPlace, setLoadingPlace] = useState(false);
    const [assetTag, setAssetTag] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [sourceCode, setSourceCode] = useState('');
    const [failureCode, setFailureCode] = useState('');
    const [critCode, setCritCode] = useState('');
    const [impactCodes, setImpactCodes] = useState<string[]>([]);
    const [photos, setPhotos] = useState<Array<{ token: string; url: string }>>([]);
    const [uploading, setUploading] = useState(0);
    const [photoError, setPhotoError] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [created, setCreated] = useState('');
    const [linkedGemba, setLinkedGemba] = useState('');
    const [linkError, setLinkError] = useState('');
    const [pendingLink, setPendingLink] = useState<GembaWrHandoff | null>(null);

    const linkToGemba = async (code: string, handoff: GembaWrHandoff) => {
        await callBackend('/api/org/quick/gemba/link-wr', {
            id: handoff.id, observationId: handoff.observationId, wrCode: code,
        });
        setLinkedGemba(handoff.id);
        setPendingLink(null);
        setLinkError('');
        try { sessionStorage.removeItem('mems.gemba.pending_wr'); } catch { /* Server record is authoritative. */ }
    };
    const choose = async (id: string) => {
        setLoadingPlace(true);
        setPlaceError('');
        try {
            const p = await callBackend<Place>('/api/org/mnt/assembly', { assemblyId: id, purpose: 'wr' });
            const handoff = pendingGembaWr(id);
            // Asset selection was already completed during the one-to-one
            // equipment/asset setup. It is never repeated here.
            if (handoff && handoff.assetTag!==p.defaultAssetTag)
                throw new Error('This Gemba observation references a different asset from the equipment link. Review the asset mapping before proceeding.');
            setPlace(p);
            setAssetTag(p.defaultAssetTag);
            if (handoff) {
                setTitle(handoff.title.slice(0, 120));
                setDescription((handoff.description || handoff.title).slice(0, 5000));
                setPhotos(handoff.photoPath ? [{token:handoff.photoPath,url:handoff.photoUrl||''}] : []);
                setPendingLink(handoff);
                const gembaGroup=lists.sources.find(g=>/^gemba(?:\s|$)/i.test(g.label));
                const gembaSource=gembaGroup?.items.find(item=>item.code===handoff.gembaTypeCode)
                    ||gembaGroup?.items.find(item=>item.label.toLowerCase()===(handoff.gembaTypeName || '').toLowerCase());
                if(gembaSource)setSourceCode(gembaSource.code);
            }
            setStep(1);
        } catch (err) {
            setPlaceError(err instanceof Error ? err.message : 'Could not open the assembly.');
        } finally {
            setLoadingPlace(false);
        }
    };
    useEffect(() => {
        if (assemblyId) void choose(assemblyId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assemblyId]);

    const again = () => {
        setCreated('');
        setTitle('');
        setDescription('');
        setSourceCode('');
        setFailureCode('');
        setCritCode('');
        setImpactCodes([]);
        setPhotos([]);
        setConfirmed(false);
        setError('');
        setStep(place ? 1 : 0);
    };

    const source = findIn(lists.sources, sourceCode);
    const failure = findIn(lists.failureModes, failureCode);
    const crit = lists.criticality.find((c) => c.code === critCode);
    const asset = place?.assets.find((a) => a.tag === place.defaultAssetTag && a.linked);

    const problems: string[][] = [
        place && asset && assetTag===place.defaultAssetTag ? [] : ['Choose an assembly with a valid linked equipment asset.'],
        [...(title.trim().length < 5 ? ['Give a short title (at least 5 characters).'] : []), ...(description.trim().length < 10 ? ['Describe what you found (at least 10 characters).'] : []), ...(source ? [] : ['Choose the source of the finding.'])],
        [...(crit ? [] : ['Choose the criticality.']), ...(impactCodes.length ? [] : ['Choose at least one impact.'])],
        [...(uploading ? ['Wait for the photos to finish uploading.'] : [])],
        confirmed ? [] : ['Confirm that the details are correct.'],
    ];
    const canNext = problems[step].length === 0;
    const swipeStart = useRef<{ x: number; y: number; at: number } | null>(null);
    const startSwipe = (event: TouchEvent<HTMLDivElement>) => {
        swipeStart.current = null;
        const target = event.target;
        if (busy || uploading || event.touches.length !== 1 ||
            (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="slider"]'))) return;
        const touch = event.touches[0];
        swipeStart.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    };
    const finishSwipe = (event: TouchEvent<HTMLDivElement>) => {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (!start || busy || uploading || event.touches.length || event.changedTouches.length !== 1) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
        if (Date.now() - start.at > 800 || Math.abs(dx) < 70 || Math.abs(dy) > 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (dx < 0 && canNext && step < STEPS.length - 1) setStep(step + 1);
        if (dx > 0 && step > 0) setStep(step - 1);
    };

    const addPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        setPhotoError('');
        const room = 4 - photos.length - uploading;
        if (files.length > room) setPhotoError('Up to 4 photos per request.');
        for (const file of files.slice(0, Math.max(0, room))) {
            setUploading((n) => n + 1);
            try {
                const data = await compressPhoto(file);
                const res = await callBackend<{ token: string; url: string }>('/api/org/mnt/wr/photo', { data });
                setPhotos((p) => [...p, res]);
            } catch (err) {
                setPhotoError(err instanceof Error ? err.message : 'The photo could not be uploaded.');
            } finally {
                setUploading((n) => n - 1);
            }
        }
    };

    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await callBackend<{ code: string }>('/api/org/mnt/wr/create', {
                assemblyId: place?.assembly.id,
                assetTag,
                title: title.trim(),
                description: description.trim(),
                sourceCode,
                failureModeCode: failureCode,
                criticalityCode: critCode,
                impactCodes,
                photos: photos.map((p) => p.token),
                gembaId: pendingLink?.id || '', gembaObservationId: pendingLink?.observationId || '',
                confirm: confirmed,
            });
            if (pendingLink && pendingLink.assetTag === assetTag && pendingLink.assemblyId === place?.assembly.id) {
                try { await linkToGemba(res.code, pendingLink); }
                catch (linkErr) { setLinkError(linkErr instanceof Error ? linkErr.message : 'Could not link this request to Gemba.'); }
            }
            setCreated(res.code);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The work request could not be submitted.');
        } finally {
            setBusy(false);
        }
    };

    if (created)
        return (
            <Card className='space-y-4 text-center'>
                <CheckCircle2 className='mx-auto h-14 w-14 text-emerald-400' />
                <div>
                    <p className='text-sm text-slate-400'>Work request submitted</p>
                    <p className='mt-1 font-mono text-3xl font-bold tracking-wider text-white'>{created}</p>
                    <p className='mt-2 text-sm text-slate-400'>It now waits for review by another authorised person.</p>
                    {linkedGemba && <p className='mt-2 text-xs text-emerald-300'>Linked to its Gemba observation.</p>}
                    {linkError && <p className='mt-2 text-xs text-amber-400'>Request submitted, but Gemba linking needs attention: {linkError}</p>}
                </div>
                <div className='grid gap-2 sm:grid-cols-2'>
                    <Button onClick={() => navigate(`organization_admin/work_requests/${created}`)}>View request</Button>
                    {linkedGemba ? (
                        <Button variant='secondary' onClick={() => navigate('organization_home/quick/gemba/' + linkedGemba)}>
                            Back to Gemba review
                        </Button>
                    ) : (
                        <Button variant='secondary' onClick={again}>Raise another here</Button>
                    )}
                    {linkError && pendingLink && (
                        <Button variant='secondary' onClick={() => { void linkToGemba(created, pendingLink).catch((e: unknown) => setLinkError(e instanceof Error ? e.message : 'Link failed.')); }}>
                            Retry linking to Gemba
                        </Button>
                    )}
                </div>
            </Card>
        );

    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            {/* Action bar: always visible at the top */}
            <div className='sticky top-0 z-10 shrink-0 space-y-2 border-b border-slate-800 bg-slate-950 pb-3'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' onClick={() => (step === 0 ? navigate('organization_admin/work_requests') : setStep(step - 1))} aria-label='Back'>
                        <ArrowLeft className='h-4 w-4' />
                    </Button>
                    <div className='min-w-0 flex-1'>
                        <p className='text-xs text-slate-500'>
                            New work request · step {step + 1} of {STEPS.length}
                        </p>
                        <p className='truncate font-semibold text-white'>{STEPS[step]}</p>
                    </div>
                    {step < STEPS.length - 1 ? (
                        <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
                            Next
                            <ArrowRight className='h-4 w-4' />
                        </Button>
                    ) : (
                        <Button busy={busy} disabled={!canNext} onClick={submit}>
                            <Check className='h-4 w-4' />
                            Submit
                        </Button>
                    )}
                </div>
                <div className='flex gap-1'>
                    {STEPS.map((label, i) => (
                        <button
                            key={label}
                            type='button'
                            aria-label={label}
                            disabled={i > step && problems.slice(0, i).some((p) => p.length)}
                            onClick={() => setStep(i)}
                            className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-emerald-500' : i === step ? 'bg-emerald-300' : 'bg-slate-800'}`}
                        />
                    ))}
                </div>
                <p className='text-xs text-slate-500 sm:hidden'>Swipe left for next, right for back. Submit on the final step.</p>
                {place && step > 0 && (
                    <p className='flex items-center gap-1 truncate text-xs text-slate-400'>
                        <MapPin className='h-3 w-3 shrink-0' />
                        {place.path.map((p) => p.code).join(' › ')}
                    </p>
                )}
            </div>

            {/* Step content scrolls; the page does not */}
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3' style={{ touchAction: 'pan-y' }} onTouchStart={startSwipe} onTouchEnd={finishSwipe} onTouchCancel={() => { swipeStart.current = null; }}>
                {step === 0 && (
                    <>
                        {placeError && <Alert tone='error'>{placeError}</Alert>}
                        {loadingPlace ? <Spinner /> : <AssemblyPicker selected={place?.assembly.id} onPick={choose} />}
                    </>
                )}

                {step === 1 && (
                    <>
                        <Field id='wr-title' label='Short title *' maxLength={120} placeholder='e.g. Oil leak at gearbox output seal' value={title} onChange={(e) => setTitle(e.target.value)} />
                        <TextArea id='wr-desc' label='What did you find? *' rows={4} maxLength={2000} placeholder='What, where exactly, since when, anything already done.' value={description} onChange={(e) => setDescription(e.target.value)} />
                        <p className='text-right text-xs text-slate-500'>{description.length}/2000</p>
                        {pendingLink?.gembaTypeName && <p className='rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand'>From {pendingLink.gembaTypeName} · linked Gemba observation</p>}
                        <GroupPicker title='Source of the finding *' groups={lists.sources} selected={sourceCode ? [sourceCode] : []} onToggle={(c) => setSourceCode(c === sourceCode ? '' : c)} />
                        <GroupPicker title='Failure mode (optional)' groups={lists.failureModes} selected={failureCode ? [failureCode] : []} onToggle={(c) => setFailureCode(c === failureCode ? '' : c)} collapsed />
                    </>
                )}

                {step === 2 && (
                    <>
                        <p className='text-sm font-medium text-slate-200'>Criticality *</p>
                        <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
                            {lists.criticality.map((c) => {
                                const color = critColor(c.code, c.color, lists.criticality);
                                const on = critCode === c.code;
                                return (
                                    <button
                                        key={c.code}
                                        type='button'
                                        onClick={() => setCritCode(c.code)}
                                        className={`flex h-16 flex-col items-center justify-center rounded-2xl border-2 text-sm font-semibold ${on ? 'text-white' : 'text-slate-200'}`}
                                        style={{ borderColor: color, background: on ? color : `${color}22` }}
                                    >
                                        {c.label}
                                        {on && <Check className='mt-0.5 h-4 w-4' />}
                                    </button>
                                );
                            })}
                        </div>
                        <GroupPicker title='Impact * (choose up to 6)' groups={lists.impacts} selected={impactCodes} multi onToggle={(c) => setImpactCodes((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : cur.length >= 6 ? cur : [...cur, c]))} />
                    </>
                )}

                {step === 3 && (
                    <>
                        <p className='text-sm text-slate-400'>Photos are optional. Add up to 4 if available; Gemba photos transfer without needing another upload.</p>
                        <div className='grid grid-cols-2 gap-2'>
                            <label className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-emerald-500/50 text-sm text-emerald-300 ${photos.length + uploading >= 4 ? 'pointer-events-none opacity-40' : ''}`}>
                                <Camera className='h-7 w-7' />
                                Take photo
                                <input type='file' accept='image/*' capture='environment' className='sr-only' onChange={addPhotos} />
                            </label>
                            <label className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-700 text-sm text-slate-300 ${photos.length + uploading >= 4 ? 'pointer-events-none opacity-40' : ''}`}>
                                <ImagePlus className='h-7 w-7' />
                                From gallery
                                <input type='file' accept='image/*' multiple className='sr-only' onChange={addPhotos} />
                            </label>
                        </div>
                        {photoError && <Alert tone='error'>{photoError}</Alert>}
                        <div className='grid grid-cols-2 gap-2'>
                            {photos.map((p, i) => (
                                <div key={p.token} className='relative overflow-hidden rounded-2xl border border-slate-800'>
                                    <img src={p.url} alt={`Photo ${i + 1}`} className='aspect-square w-full object-cover' />
                                    <button type='button' aria-label='Remove photo' onClick={() => setPhotos((cur) => cur.filter((x) => x.token !== p.token))} className='absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/80 text-red-300'>
                                        <Trash2 className='h-4 w-4' />
                                    </button>
                                </div>
                            ))}
                            {Array.from({ length: uploading }, (_, i) => (
                                <div key={`u${i}`} className='flex aspect-square items-center justify-center rounded-2xl border border-slate-800 bg-slate-900'>
                                    <Spinner />
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {step === 4 && place && (
                    <>
                        <ReviewBlock label='Where' onEdit={() => setStep(0)}>
                            <p className='text-white'>
                                {place.assembly.code} · {place.assembly.name}
                            </p>
                            <p className='text-xs text-slate-400'>{place.path.map((p) => `${LEVEL_LABEL[p.level] ?? p.level} ${p.code}`).join(' › ')}</p>
                        </ReviewBlock>
                        <ReviewBlock label='Equipment-linked asset'>
                            <p className='text-white'>
                                {asset?.tag} · {asset?.name}
                            </p>
                            <p className='text-xs text-slate-400'>{asset?.className}</p>
                        </ReviewBlock>
                        <ReviewBlock label='Finding' onEdit={() => setStep(1)}>
                            <p className='font-medium text-white'>{title}</p>
                            <p className='whitespace-pre-wrap text-sm text-slate-300'>{description}</p>
                            <p className='mt-1 text-xs text-slate-400'>
                                Source: {source?.group} · {source?.label}
                                {failure ? ` · Failure mode: ${failure.group} · ${failure.label}` : ''}
                            </p>
                        </ReviewBlock>
                        <ReviewBlock label='Criticality and impact' onEdit={() => setStep(2)}>
                            <span className='inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-white' style={{ background: critColor(critCode, crit?.color ?? '', lists.criticality) }}>
                                {crit?.label}
                            </span>
                            <div className='mt-2 flex flex-wrap gap-1'>
                                {impactCodes.map((c) => {
                                    const i = findIn(lists.impacts, c);
                                    return <Badge key={c}>{i ? `${i.group} · ${i.label}` : c}</Badge>;
                                })}
                            </div>
                        </ReviewBlock>
                        <ReviewBlock label={`Photos (${photos.length})`} onEdit={() => setStep(3)}>
                            <div className='flex gap-2 overflow-x-auto'>
                                {photos.map((p, i) => (
                                    <img key={p.token} src={p.url} alt={`Photo ${i + 1}`} className='h-20 w-20 shrink-0 rounded-xl object-cover' />
                                ))}
                            </div>
                        </ReviewBlock>
                        <label className='flex items-start gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-slate-200'>
                            <input type='checkbox' className='mt-0.5 h-5 w-5 accent-emerald-500' checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                            I confirm these details are correct. The request will be numbered and sent for review. You can change it only until review starts, and never after it is converted to a work order.
                        </label>
                        {error && <Alert tone='error'>{error}</Alert>}
                    </>
                )}

                {problems[step].length > 0 && step !== 0 && (
                    <ul className='space-y-0.5 text-xs text-amber-300'>
                        {problems[step].map((p) => (
                            <li key={p}>• {p}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function ReviewBlock({ label, onEdit, children }: { label: string; onEdit?: () => void; children: ReactNode }) {
    return (
        <Card>
            <div className='mb-1 flex items-center justify-between'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>{label}</p>
                {onEdit && <button type='button' onClick={onEdit} className='text-xs text-emerald-300'>
                    Change
                </button>}
            </div>
            {children}
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Detail: review, assess, return, decline, convert; requester edit, resubmit, cancel
// ---------------------------------------------------------------------------

type Mode = '' | 'edit' | 'assess' | 'review_assessment' | 'return_assessment' | 'return' | 'decline' | 'convert' | 'cancel';

function RequestDetail({ code, setup }: { code: string; setup: MntSetup }) {
    const lists = setup.lists!;
    const { data, error, loading, reload } = useLoad(() => callBackend<Detail>('/api/org/mnt/wr/get', { code }), [code]);
    const [mode, setMode] = useState<Mode>('');
    const [note, setNote] = useState('');
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [zoom, setZoom] = useState('');
    const [section,setSection]=useState<'request'|'tasks'|'summary'>('request');
    const [tasksDirty,setTasksDirty]=useState(false);
    const goSection=(next:'request'|'tasks'|'summary')=>{
        if(next!==section&&tasksDirty&&!window.confirm('You have unsaved task changes. Leave without saving them?'))return;
        setMode('');setActionError('');setSection(next);
    };

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the work request.'}</Alert>;
    const r = data;
    const can = r.can;

    const run = async (action: string, extra: Record<string, unknown> = {}) => {
        setBusy(true);
        setActionError('');
        try {
            const res = await callBackend<{ ok: boolean; woCode?: string }>('/api/org/mnt/wr/action', { code: r.code, action, note: note.trim(), confirm: typed.trim(), ...extra });
            setMode('');
            setNote('');
            setTyped('');
            if (res.woCode) navigate(`organization_admin/work_orders/${res.woCode}`);
            else reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'The action failed.');
        } finally {
            setBusy(false);
        }
    };

    if (mode === 'edit') return <EditRequest detail={r} lists={lists} onDone={() => (setMode(''), reload())} onCancel={() => setMode('')} />;

    const assessed = !!(r.assessment.maintenanceTypeCode && r.assessment.workTypeCode && r.assessment.priorityCode && r.assessment.disciplineCode);
    const buttons: Array<{ key: string; label: string; icon: ReactNode; variant?: 'primary' | 'secondary' | 'danger'; onClick: () => void }> = [];
    if (can.startReview) buttons.push({ key: 'start', label: 'Start review', icon: <ClipboardList className='h-4 w-4' />, onClick: () => run('start_review') });
    if (can.assess) buttons.push({ key: 'assess', label: assessed ? 'Update assessment' : 'Assess', icon: <ClipboardList className='h-4 w-4' />, variant: assessed ? 'secondary' : 'primary', onClick: () => setMode('assess') });
    if (can.reviewAssessment && assessed && r.assessmentTasks.length>0) buttons.push({ key: 'reviewAssessment', label: 'Review work assessment', icon: <CheckCircle2 className='h-4 w-4' />, variant: 'primary', onClick: () => {setSection('summary');setMode('review_assessment');} });
    if (can.convert) buttons.push({ key: 'convert', label: 'Convert to work order', icon: <Wrench className='h-4 w-4' />, variant: assessed ? 'primary' : 'secondary', onClick: () => setMode('convert') });
    if (can.return) buttons.push({ key: 'return', label: 'Return for information', icon: <Undo2 className='h-4 w-4' />, variant: 'secondary', onClick: () => setMode('return') });
    if (can.decline) buttons.push({ key: 'decline', label: 'Decline', icon: <X className='h-4 w-4' />, variant: 'danger', onClick: () => setMode('decline') });
    if (can.edit) buttons.push({ key: 'edit', label: 'Edit', icon: <Pencil className='h-4 w-4' />, variant: 'secondary', onClick: () => setMode('edit') });
    if (can.resubmit) buttons.push({ key: 'resubmit', label: 'Resubmit', icon: <Send className='h-4 w-4' />, onClick: () => run('resubmit') });
    if (can.cancel) buttons.push({ key: 'cancel', label: 'Cancel request', icon: <X className='h-4 w-4' />, variant: 'danger', onClick: () => setMode('cancel') });

    const typedNeeded = mode === 'decline' || mode === 'convert' || mode === 'cancel';
    const noteNeeded = mode === 'return' || mode === 'decline' || mode === 'cancel' || mode === 'review_assessment' || mode === 'return_assessment';

    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            {/* Action bar on top */}
            <div className='shrink-0 space-y-2 border-b border-slate-800 bg-slate-950 pb-3'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' aria-label='Back' onClick={() => navigate('organization_admin/work_requests')}>
                        <ArrowLeft className='h-4 w-4' />
                    </Button>
                    <div className='min-w-0 flex-1'>
                        <p className='font-mono text-sm font-bold tracking-wider text-emerald-300'>{r.code}</p>
                        <p className='truncate text-xs text-slate-400'>{r.statusLabel}</p>
                    </div>
                    {r.woCode && (
                        <Button variant='secondary' onClick={() => navigate(`organization_admin/work_orders/${r.woCode}`)}>
                            {r.woCode}
                        </Button>
                    )}
                </div>

            </div>

            <div className='grid min-h-0 min-w-0 flex-1 grid-cols-[64px_minmax(0,1fr)] overflow-hidden'>
              <nav aria-label='Assessment sections' className='flex min-h-0 flex-col gap-2 overflow-y-auto border-r border-slate-700 bg-slate-900/70 px-1 py-3'>
                {([
                   ['request','Request',<ClipboardList className='h-5 w-5'/>],
                   ['tasks','Tasks',<Wrench className='h-5 w-5'/>],
                   ['summary','Summary',<CheckCircle2 className='h-5 w-5'/>],
                ] as const).map(([key,title,icon])=><button type='button' key={key} aria-current={section===key?'page':undefined}
                  aria-label={title==='Request'?'Review work request':title==='Tasks'?'Tasks and task assessments':'Assessment summary'}
                  onClick={()=>goSection(key)}
                  className={'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[10px] font-semibold leading-tight '+(section===key?'bg-emerald-900/50 text-emerald-200 ring-1 ring-emerald-700':'text-slate-400')}>
                  {icon}<span>{title}</span></button>)}
                <span className='mt-auto break-words text-center text-[9px] text-slate-500'>{r.code.slice(-4)}</span>
              </nav>
              <div className='min-w-0 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-3 sm:px-4'>
                {actionError && !mode && <Alert tone='error'>{actionError}</Alert>}

                {mode === 'assess' && <AssessPanel detail={r} lists={lists} onDone={() => (setMode(''), reload())} onCancel={() => setMode('')} />}

                {(mode === 'return' || mode === 'decline' || mode === 'convert' || mode === 'cancel' || mode === 'review_assessment' || mode === 'return_assessment') && (
                    <Card className='space-y-3'>
                        <p className='font-medium text-white'>
                            {mode === 'review_assessment' ? 'Approve the independently reviewed work assessment' : mode === 'return_assessment' ? 'Return assessment to the assessor for correction' : mode === 'return' ? 'Return to the requester for more information' : mode === 'decline' ? 'Decline this request' : mode === 'convert' ? 'Convert to a work order' : 'Cancel this request'}
                        </p>
                        {mode === 'convert' && (
                            <p className='text-sm text-slate-300'>
                                {r.assessmentReviewCurrent
                                    ? `A work order is created with the location, asset and your assessment (${r.assessment.maintenanceTypeLabel}, ${r.assessment.priorityLabel}). The request is then locked.`
                                    : 'An independent authorized reviewer must approve the current task assessment before conversion.'}
                            </p>
                        )}
                        {(noteNeeded || mode === 'convert') && (
                            <TextArea
                                id='wr-note'
                                label={mode === 'review_assessment' ? 'Technical verification and approval notes *' : mode === 'return_assessment' ? 'Required corrections *' : mode === 'return' ? 'What information is needed? *' : mode === 'convert' ? 'Note (optional)' : 'Reason *'}
                                rows={3}
                                maxLength={500}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                            />
                        )}
                        {typedNeeded && <Field id='wr-confirm' label={`Type ${r.code} to confirm`} autoComplete='off' value={typed} onChange={(e) => setTyped(e.target.value)} />}
                        {actionError && <Alert tone='error'>{actionError}</Alert>}
                        <div className='flex gap-2'>
                            <Button
                                className='flex-1'
                                variant={mode === 'decline' || mode === 'cancel' ? 'danger' : 'primary'}
                                busy={busy}
                                disabled={(typedNeeded && typed.trim() !== r.code) || (noteNeeded && note.trim().length < (mode === 'review_assessment'||mode === 'return_assessment'?10:5)) || (mode === 'convert' && !r.assessmentReviewCurrent)}
                                onClick={() => run(mode)}
                            >
                                Confirm
                            </Button>
                            <Button variant='secondary' onClick={() => setMode('')}>
                                Back
                            </Button>
                        </div>
                    </Card>
                )}

                {section==='request' && !mode && <>
                  <div className='space-y-1'>
                    <p className='text-xs font-semibold uppercase tracking-wider text-emerald-300'>Work request</p>
                    <h2 className='text-lg font-semibold text-white'>Request details</h2>
                  </div>
                  {buttons.length>0&&<div className='grid grid-cols-2 gap-2'>
                    {buttons.map(b=><Button key={b.key} variant={b.variant??'primary'} busy={busy&&b.key!=='edit'} className='min-w-0 justify-center text-xs' onClick={b.onClick}>
                      {b.icon}<span className='min-w-0 break-words text-center'>{b.label}</span>
                    </Button>)}
                  </div>}
                  {can.ownRequest&&['submitted','under_review'].includes(r.status)&&<p className='text-xs text-slate-400'>You raised this request. Independent review is handled by another authorized person.</p>}
                {r.status === 'returned' && r.returnNote && (
                    <Card>
                        <p className='text-xs font-semibold uppercase tracking-wider text-red-300'>Information requested</p>
                        <p className='mt-1 text-sm text-slate-200'>{r.returnNote}</p>
                    </Card>
                )}
                {r.status === 'declined' && r.declineReason && (
                    <Card>
                        <p className='text-xs font-semibold uppercase tracking-wider text-slate-400'>Declined</p>
                        <p className='mt-1 text-sm text-slate-200'>{r.declineReason}</p>
                    </Card>
                )}

                <Card>
                    <div className='flex items-start gap-3'>
                        <span className='mt-1 h-10 w-2 shrink-0 rounded-full' style={{ background: critColor(r.criticalityCode, r.criticalityColor) }} />
                        <div className='min-w-0 flex-1'>
                            <h2 className='text-lg font-semibold text-white'>{r.title}</h2>
                            <div className='mt-2 flex flex-wrap gap-1'>
                                <Badge tone={WR_TONE[r.status] ?? 'muted'}>{r.statusLabel}</Badge>
                                <span className='rounded-full px-2 py-0.5 text-xs font-semibold text-white' style={{ background: critColor(r.criticalityCode, r.criticalityColor) }}>
                                    {r.criticalityLabel}
                                </span>
                                {r.criticalityOriginalLabel && <Badge>Raised as {r.criticalityOriginalLabel}</Badge>}
                            </div>
                        </div>
                    </div>
                    <p className='mt-3 whitespace-pre-wrap text-sm text-slate-300'>{r.description}</p>
                </Card>

                {r.photos.length > 0 && (
                    <div className='flex gap-2 overflow-x-auto pb-1'>
                        {r.photos.map((p, i) => (
                            <button key={p.token} type='button' onClick={() => setZoom(p.url)} className='shrink-0'>
                                <img src={p.url} alt={`Photo ${i + 1}`} className='h-28 w-28 rounded-2xl object-cover' />
                            </button>
                        ))}
                    </div>
                )}



                 {(r.assessment.maintenanceTypeLabel || r.assessment.note) && (
                    <Card className='space-y-2 text-sm'>
                        <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Assessment</p>
                        {r.assessment.maintenanceTypeLabel && <Info label='Maintenance type' value={r.assessment.maintenanceTypeLabel} />}
                        {r.assessment.workTypeLabel && <Info label='Work type' value={r.assessment.workTypeLabel} />}
                        {r.assessment.priorityLabel && <Info label='Priority' value={r.assessment.priorityLabel} />}
                        {r.assessment.disciplineLabel && <Info label='Discipline' value={r.assessment.disciplineLabel} />}
                        {r.assessment.duplicateOf && <Info label='Related request' value={r.assessment.duplicateOf} />}
                        {r.assessment.note && <Info label='Reviewer note' value={r.assessment.note} />}
                        {r.reviewerName && <Info label='Reviewer' value={r.reviewerName} />}
                    </Card>
                )}

                <Card className='space-y-2 text-sm'>
                    <Info label='Asset' value={`${r.assetTag} · ${r.assetName}`} sub={r.assetClass} />
                    <Info label='Assembly' value={`${r.assemblyCode} · ${r.assemblyName}`} />
                    <Info label='Equipment unit' value={`${r.unitCode} · ${r.unitName}`} />
                    <Info label='Cost center' value={`${r.costCenterCode} · ${r.costCenterName}`} />
                    <Info label='Source of finding' value={`${r.sourceGroup} · ${r.sourceLabel}`} />
                    {r.failureModeLabel && <Info label='Failure mode' value={r.failureModeLabel} />}
                    <div className='border-t border-slate-800 pt-2'>
                        <p className='text-xs text-slate-500'>Impacts</p>
                        <div className='mt-1 flex flex-wrap gap-1'>
                            {r.impacts.map((i) => (
                                <Badge key={i.code}>
                                    {i.group} · {i.label}
                                </Badge>
                            ))}
                        </div>
                    </div>
                    <Info label='Requested by' value={`${r.requestedByName} · ${fmtDate(r.requestedAt)}`} />
                </Card>

                <HistoryCard history={r.history} />
                </>}
                {section==='tasks' && <MntTaskAssessment key={r.code} code={r.code} initial={r.assessmentTasks||[]} editable={can.assess} onSaved={reload} onDirtyChange={setTasksDirty}/>}
                {section==='summary' && <AssessmentSummary
                    detail={r}
                    canReview={!!can.reviewAssessment&&assessed&&r.assessmentTasks.length>0}
                    busy={busy}
                    onApprove={()=>{setMode('review_assessment');setNote('');}}
                    onReturn={()=>{setMode('return_assessment');setNote('');}}
                    />}
              </div>
            </div>

            {zoom && (
                <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3' onClick={() => setZoom('')} role='dialog' aria-label='Photo'>
                    <img src={zoom} alt='Photo' className='max-h-full max-w-full rounded-xl object-contain' />
                    <button type='button' aria-label='Close' className='absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white'>
                        <X className='h-5 w-5' />
                    </button>
                </div>
            )}
        </div>
    );
}

/** The summary is an independent, read-only snapshot of the saved assessment. */
function AssessmentSummary({detail,canReview,busy,onApprove,onReturn}:{detail:Detail;canReview:boolean;busy:boolean;onApprove:()=>void;onReturn:()=>void}){
    const tasks=detail.assessmentTasks||[];
    const spares=tasks.reduce((sum,t)=>sum+(t.spares?.length||0),0);
    const duration=tasks.reduce((sum,t)=>sum+(Number(t.hours)||0),0);
    const people=tasks.reduce((sum,t)=>sum+(Number(t.persons)||0)+(Number(t.externalResource?.persons)||0),0);
    const hazards=tasks.reduce((sum,t)=>sum+(t.risk?.filter(x=>x.hazard)?.length||0),0);
    const status=detail.assessmentReviewCurrent?'Approved':detail.assessmentReview.status==='changes_requested'?'Returned for correction':'Awaiting review';
    return <div className='min-w-0 space-y-3'>
      <div><p className='text-xs font-semibold uppercase tracking-wide text-emerald-300'>Assessment summary</p>
        <h2 className='mt-1 text-lg font-semibold text-white'>Scope and requirements</h2>
        <p className='mt-1 text-xs text-slate-400'>Saved assessment only. Reviewers can inspect details, approve or return; they cannot modify tasks.</p>
      </div>
      <div className='grid min-w-0 grid-cols-2 gap-2'>
        {([['Tasks',tasks.length],['Work hours',duration],['Spare items',spares],['People',people]] as const).map(([name,value])=>
        <div key={name} className='min-w-0 rounded-xl border border-slate-700 bg-slate-900 p-3'>
          <strong className='block text-xl text-white'>{value}</strong>
          <span className='text-xs text-slate-400'>{name}</span>
        </div>)}
      </div>
      <Card className='space-y-2 text-sm'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <p className='font-semibold text-white'>Independent review</p>
          <Badge tone={detail.assessmentReviewCurrent?'brand':detail.assessmentReview.status==='changes_requested'?'danger':'warn'}>{status}</Badge>
        </div>
        {detail.assessmentReview.name&&<Info label='Reviewed by' value={detail.assessmentReview.name}/>}
        {detail.assessmentReview.note&&<Info label='Review notes' value={detail.assessmentReview.note}/>}
        {canReview&&<div className='grid grid-cols-1 gap-2 pt-2'>
          <Button busy={busy} onClick={onApprove}>Approve assessment</Button>
          <Button variant='secondary' busy={busy} onClick={onReturn}>Return for correction</Button>
        </div>}
      </Card>
      <Card className='space-y-2 text-sm'>
        <p className='font-semibold text-white'>Work classification</p>
        <Info label='Maintenance type' value={detail.assessment.maintenanceTypeLabel||'Not yet classified'}/>
        <Info label='Work type' value={detail.assessment.workTypeLabel||'Not yet classified'}/>
        <Info label='Priority' value={detail.assessment.priorityLabel||'Not yet classified'}/>
        <Info label='Discipline' value={detail.assessment.disciplineLabel||'Not yet classified'}/>
        <Info label='Linked asset' value={detail.assetTag+' · '+detail.assetName}/>
        <Info label='Equipment' value={detail.unitCode+' · '+detail.unitName}/>
      </Card>
      <Card className='space-y-2 text-sm'>
        <p className='font-semibold text-white'>Safety overview</p>
        <Info label='Tasks requiring LOTO' value={String(tasks.filter(t=>t.lotoRequired).length)}/>
        <Info label='Tasks requiring live work' value={String(tasks.filter(t=>t.liveEquipment).length)}/>
        <Info label='Identified hazards' value={String(hazards)}/>
        <Info label='Permit selections' value={String(tasks.reduce((sum,t)=>sum+(t.permitCodes?.length||0),0))}/>
      </Card>
      <div className='space-y-2'>
        <p className='text-sm font-semibold text-white'>Saved task details</p>
        {!tasks.length&&<p className='rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400'>No tasks saved. The assessor must add and save tasks first.</p>}
        {tasks.map((task,i)=><details key={task.id} className='min-w-0 rounded-xl border border-slate-700 bg-slate-900 p-3'>
          <summary className='cursor-pointer text-sm font-semibold text-white'>{i+1}. {task.title||task.description}</summary>
          <div className='mt-3 space-y-2 break-words text-xs text-slate-300'>
            <p>{task.description}</p>
            <p><strong>Duration:</strong> {task.hours} hours · <strong>Internal people:</strong> {task.persons}</p>
            <p><strong>Internal roles:</strong> {task.internalRoles?.join(', ')||'None'}</p>
            <p><strong>External:</strong> {task.externalResource?.type?task.externalResource.type+' ('+task.externalResource.persons+' people)':'None'}</p>
            <p><strong>Special tools:</strong> {task.tools||'None'}</p>
            <p><strong>Spares:</strong> {task.spares?.map(sp=>sp.qty+' × '+sp.description).join('; ')||'None'}</p>
            <p><strong>LOTO:</strong> {task.lotoRequired?'Yes':'No'} · <strong>Live equipment:</strong> {task.liveEquipment?'Yes':'No'}</p>
            <p><strong>Hazardous energy:</strong> {task.energySourceCodes?.join(', ')||'None selected'}</p>
            <p><strong>Permits:</strong> {task.permitCodes?.join(', ')||'None selected'}</p>
            {task.risk?.filter(x=>x.hazard).map((risk,j)=><div key={j} className='rounded-lg border border-slate-700 p-2'>
              <p className='font-semibold text-white'>{risk.hazard}</p><p>Impact: {risk.impact}</p><p>Controls: {risk.controls}</p>
              <p>Before: {risk.before||'—'} · After: {risk.after||'—'}</p>
            </div>)}
          </div>
        </details>)}
      </div>
    </div>;
}

export function HistoryCard({ history }: { history: Array<{ at: string; name: string; action: string; note: string }> }) {
    return (
        <Card>
            <p className='mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'>History</p>
            <ol className='space-y-2'>
                {[...history].reverse().map((h, i) => (
                    <li key={i} className='border-l-2 border-emerald-500/40 pl-3 text-sm'>
                        <p className='text-white'>
                            {h.action} · {h.name}
                        </p>
                        <p className='text-xs text-slate-500'>{fmtDate(h.at)}</p>
                        {h.note && <p className='text-xs text-slate-300'>{h.note}</p>}
                    </li>
                ))}
            </ol>
        </Card>
    );
}

function AssessPanel({ detail, lists, onDone, onCancel }: { detail: Detail; lists: MntLists; onDone: () => void; onCancel: () => void }) {
    const a = detail.assessment;
    const [mtype, setMtype] = useState(a.maintenanceTypeCode);
    const [wtype, setWtype] = useState(a.workTypeCode);
    const [prio, setPrio] = useState(a.priorityCode);
    const [disc, setDisc] = useState(a.disciplineCode);
    const [crit, setCrit] = useState(detail.criticalityCode);
    const [dup, setDup] = useState(a.duplicateOf);
    const [note, setNote] = useState(a.note);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ok = mtype && wtype && prio && disc && crit && (!dup || /^WR\d{8}$/.test(dup.trim().toUpperCase()));
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/org/mnt/wr/action', { code: detail.code, action: 'assess', maintenanceTypeCode: mtype, workTypeCode: wtype, priorityCode: prio, disciplineCode: disc, criticalityCode: crit, duplicateOf: dup.trim().toUpperCase(), note: note.trim() });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the assessment.');
        } finally {
            setBusy(false);
        }
    };
    const select = (id: string, label: string, value: string, set: (v: string) => void, items: Array<{ code: string; label: string }>) => (
        <SelectField id={id} label={label} value={value} onChange={(e) => set(e.target.value)}>
            <option value=''>Select…</option>
            {items.map((i) => (
                <option key={i.code} value={i.code}>
                    {i.label}
                </option>
            ))}
        </SelectField>
    );
    return (
        <Card className='space-y-3'>
            <p className='font-medium text-white'>Assess the request</p>
            <p className='text-xs text-slate-400'>Check it is valid and not a duplicate, confirm the criticality and classify the work.</p>
            <div>
                <p className='mb-1 text-sm text-slate-300'>Criticality (confirm or adjust)</p>
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
                    {lists.criticality.map((c) => {
                        const color = critColor(c.code, c.color, lists.criticality);
                        const on = crit === c.code;
                        return (
                            <button key={c.code} type='button' onClick={() => setCrit(c.code)} className={`h-12 rounded-xl border-2 text-sm font-semibold ${on ? 'text-white' : 'text-slate-200'}`} style={{ borderColor: color, background: on ? color : `${color}22` }}>
                                {c.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {select('as-mtype', 'Maintenance type *', mtype, setMtype, lists.maintenanceTypes)}
            {select('as-wtype', 'Work type *', wtype, setWtype, lists.workTypes)}
            {select('as-prio', 'Priority *', prio, setPrio, lists.priorities)}
            {select('as-disc', 'Discipline *', disc, setDisc, lists.disciplines)}
            <Field id='as-dup' label='Related or duplicate request (optional)' placeholder='WR00000000' value={dup} onChange={(e) => setDup(e.target.value)} />
            <TextArea id='as-note' label='Assessment note (optional)' rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex gap-2'>
                <Button className='flex-1' busy={busy} disabled={!ok} onClick={save}>
                    <Check className='h-4 w-4' />
                    Save assessment
                </Button>
                <Button variant='secondary' onClick={onCancel}>
                    Back
                </Button>
            </div>
        </Card>
    );
}

function EditRequest({ detail, lists, onDone, onCancel }: { detail: Detail; lists: MntLists; onDone: () => void; onCancel: () => void }) {
    const [title, setTitle] = useState(detail.title);
    const [description, setDescription] = useState(detail.description);
    const [sourceCode, setSourceCode] = useState(detail.sourceCode);
    const [failureCode, setFailureCode] = useState(detail.failureModeCode);
    const [critCode, setCritCode] = useState(detail.criticalityCode);
    const [impactCodes, setImpactCodes] = useState(detail.impacts.map((i) => i.code));
    const [photos, setPhotos] = useState(detail.photos);
    const [uploading, setUploading] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ok = title.trim().length >= 5 && description.trim().length >= 10 && sourceCode && critCode && impactCodes.length > 0 && !uploading;

    const addPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        for (const file of files.slice(0, Math.max(0, 4 - photos.length - uploading))) {
            setUploading((n) => n + 1);
            try {
                const res = await callBackend<{ token: string; url: string }>('/api/org/mnt/wr/photo', { data: await compressPhoto(file) });
                setPhotos((p) => [...p, res]);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'The photo could not be uploaded.');
            } finally {
                setUploading((n) => n - 1);
            }
        }
    };
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/org/mnt/wr/action', { code: detail.code, action: 'edit', title, description, sourceCode, failureModeCode: failureCode, criticalityCode: critCode, impactCodes, photos: photos.map((p) => p.token) });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <div className='flex shrink-0 items-center gap-2 border-b border-slate-800 pb-3'>
                <Button variant='secondary' aria-label='Back' onClick={onCancel}>
                    <ArrowLeft className='h-4 w-4' />
                </Button>
                <p className='min-w-0 flex-1 truncate font-semibold text-white'>Edit {detail.code}</p>
                <Button busy={busy} disabled={!ok} onClick={save}>
                    <Check className='h-4 w-4' />
                    Save
                </Button>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                {detail.returnNote && <Alert tone='info'>Requested: {detail.returnNote}</Alert>}
                <Field id='ed-title' label='Short title *' maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
                <TextArea id='ed-desc' label='What did you find? *' rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
                <GroupPicker title='Source of the finding *' groups={lists.sources} selected={sourceCode ? [sourceCode] : []} onToggle={(c) => setSourceCode(c === sourceCode ? '' : c)} />
                <GroupPicker title='Failure mode (optional)' groups={lists.failureModes} selected={failureCode ? [failureCode] : []} onToggle={(c) => setFailureCode(c === failureCode ? '' : c)} collapsed />
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
                    {lists.criticality.map((c) => {
                        const color = critColor(c.code, c.color, lists.criticality);
                        const on = critCode === c.code;
                        return (
                            <button key={c.code} type='button' onClick={() => setCritCode(c.code)} className={`h-12 rounded-xl border-2 text-sm font-semibold ${on ? 'text-white' : 'text-slate-200'}`} style={{ borderColor: color, background: on ? color : `${color}22` }}>
                                {c.label}
                            </button>
                        );
                    })}
                </div>
                <GroupPicker title='Impact * (up to 6)' groups={lists.impacts} selected={impactCodes} multi onToggle={(c) => setImpactCodes((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : cur.length >= 6 ? cur : [...cur, c]))} />
                <div className='grid grid-cols-3 gap-2'>
                    {photos.map((p) => (
                        <div key={p.token} className='relative overflow-hidden rounded-xl border border-slate-800'>
                            <img src={p.url} alt='Photo' className='aspect-square w-full object-cover' />
                            <button type='button' aria-label='Remove photo' onClick={() => setPhotos((cur) => cur.filter((x) => x.token !== p.token))} className='absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/80 text-red-300'>
                                <Trash2 className='h-4 w-4' />
                            </button>
                        </div>
                    ))}
                    {photos.length + uploading < 4 && (
                        <label className='flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-500/50 text-xs text-emerald-300'>
                            <Camera className='h-6 w-6' />
                            Add photo
                            <input type='file' accept='image/*' capture='environment' className='sr-only' onChange={addPhotos} />
                        </label>
                    )}
                </div>
                {error && <Alert tone='error'>{error}</Alert>}
            </div>
        </div>
    );
}

