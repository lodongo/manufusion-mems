import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type TouchEvent } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ClipboardList, ImagePlus, MapPin, Pencil, Send, Trash2, Undo2, Wrench, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import MntTaskAssessment,{MACHINE_STATUS,machineLabel,machineOf,type TaskAssessment} from './MntTaskAssessment';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Card, Spinner, TextArea, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { AssemblyPicker, ChoicePicker, GroupPicker, Info, useFullScreen, LEVEL_LABEL, compressPhoto, critColor, findIn, type ListGroup, type MntLists, type MntSetup, type Place } from './mntShared';
import { appConfirm } from '../components/dialogs';
import MntGateHint from './MntGateHint';

// Maintenance (MNT): work requests, numbered WR + 8 digits by the server. Raising one only needs the place (the
// equipment at least, the assembly when known); everything else is optional and is completed at review or assessment,
// which build on the request without overwriting what the requester wrote. A reviewer (Artisan) either closes it when
// no planning is needed (cause, solution, maintenance type; a supervisor confirms) or it is assessed, approved by a
// technical supervisor and converted to a work order by a planner. The requester can never review their own request.
// Mobile first: one decision per screen, big touch targets, action bar on top, content scrolls underneath.

interface Row {
    code: string;
    title: string;
    status: string;
    statusLabel: string;
    assemblyId: string;
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
    enrich: boolean;
    close: boolean;
    confirmClosure: boolean;
    ownRequest: boolean;
}
interface Closure {
    causeCode: string; causeLabel: string; causeGroup: string;
    solutionCode: string; solutionLabel: string; solutionGroup: string;
    maintenanceTypeCode: string; maintenanceTypeLabel: string;
    description: string; name: string; at: string;
    confirmedName?: string; confirmedAt?: string; confirmNote?: string;
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
        technicalEvaluation: string;
        natureCode: string;
        natureLabel: string;
        severityCode: string;
        solutions: Array<{ code: string; label: string; group: string }>;
        headerIssue: string;
    };
    titleAuto: boolean;
    unitId: string;
    assemblyOptions: Array<{ id: string; code: string; name: string }>;
    closure: Closure | null;
    closureRejections: Array<Closure & { rejectedName: string; rejectedAt: string; reason: string }>;
    assessmentReview: {status:string;version?:number;name?:string;at?:string;note?:string};
    assessmentReviewCurrent: boolean;
    assessmentReviewBlockers?: string[];
    returnNote: string;
    declineReason: string;
    history: Array<{ at: string; name: string; action: string; note: string }>;
    can: WrCan;
}

export const WR_TONE: Record<string, 'brand' | 'muted' | 'danger' | 'warn'> = { submitted: 'warn', under_review: 'warn', returned: 'danger', declined: 'muted', cancelled: 'muted', converted: 'brand', closure_pending: 'warn', closed: 'brand' };

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
                value: (r) => r.criticalityLabel || 'Not assessed',
                render: (r) => (
                    <span className='inline-flex items-center gap-1.5 whitespace-nowrap'>
                        <span className='h-2.5 w-2.5 rounded-full' style={{ background: r.criticalityCode ? critColor(r.criticalityCode, r.criticalityColor) : '#94a3b8' }} />
                        {r.criticalityLabel || 'Not assessed'}
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
                    <button key={k} type='button' onClick={() => setTab(k)} className={`h-11 shrink-0 rounded-lg px-3 text-sm ${tab === k ? 'bg-emerald-500 text-onbrand' : 'text-slate-300'}`}>
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

const STEPS = ['Where', 'Details', 'Photos', 'Review'] as const;
const MAX_IMPACTS = 5;
const toggleImpact = (c: string) => (cur: string[]) => (cur.includes(c) ? cur.filter((x) => x !== c) : cur.length >= MAX_IMPACTS ? cur : [...cur, c]);
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
        setImpactCodes([]);
        setPhotos([]);
        setConfirmed(false);
        setError('');
        setStep(place ? 1 : 0);
    };

    const source = findIn(lists.sources, sourceCode);
    const asset = place?.assets.find((a) => a.tag === place.defaultAssetTag && a.linked);

    // Only the place is required; everything else is optional and completed at review or assessment.
    const problems: string[][] = [
        place && asset && assetTag===place.defaultAssetTag ? [] : ['Choose the equipment (or its assembly) with a valid linked asset.'],
        [...(title.trim() && title.trim().length < 3 ? ['A title needs at least 3 characters, or leave it empty.'] : [])],
        [...(uploading ? ['Wait for the photos to finish uploading.'] : [])],
        [...(uploading ? ['Wait for the photos to finish uploading.'] : []), ...(confirmed ? [] : ['Confirm that the details are correct.'])],
    ];
    const canNext = problems[step].length === 0;
    const screen = useFullScreen(!created);
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
                assemblyId: place?.assembly?.id || '',
                equipmentId: place?.assembly ? '' : place?.unit?.id || '',
                assetTag,
                title: title.trim(),
                description: description.trim(),
                sourceCode,
                impactCodes,
                photos: photos.map((p) => p.token),
                gembaId: pendingLink?.id || '', gembaObservationId: pendingLink?.observationId || '',
                confirm: confirmed,
            });
            if (pendingLink && pendingLink.assetTag === assetTag && pendingLink.assemblyId === place?.assembly?.id) {
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
        <div className={screen.className} onFocusCapture={screen.keepInView}>
            {/* Action bar: always visible at the top */}
            <div className='sticky top-0 z-10 shrink-0 space-y-2 border-b border-line bg-page pb-2'>
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
                <p className='text-xs text-slate-500 sm:hidden mems-compact-hide'>Swipe left for next, right for back.</p>
                {place && step > 0 && (
                    <p className='flex items-center gap-1 truncate text-xs text-slate-400 mems-compact-hide'>
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
                        {loadingPlace ? <Spinner /> : <AssemblyPicker allowEquipment selected={place?.assembly?.id ?? place?.unit?.id} onPick={choose} />}
                    </>
                )}

                {step === 1 && (
                    <>
                        <p className='rounded-xl border border-line bg-panel p-3 text-sm text-soft'>Everything on this step is optional. Add what you know; the reviewer completes the rest. You can go straight to <strong className='text-ink'>Photos</strong> or <strong className='text-ink'>Review</strong>.</p>
                        <Field id='wr-title' label='Short title (optional)' maxLength={120} placeholder='e.g. Oil leak at gearbox output seal' value={title} onChange={(e) => setTitle(e.target.value)} />
                        <TextArea id='wr-desc' label='What did you find? (optional)' rows={3} maxLength={2000} placeholder='What, where exactly, since when, anything already done.' value={description} onChange={(e) => setDescription(e.target.value)} />
                        <p className='text-right text-xs text-slate-500'>{description.length}/2000</p>
                        {pendingLink?.gembaTypeName && <p className='rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand'>From {pendingLink.gembaTypeName} · linked Gemba observation</p>}
                        <GroupPicker title='Source of the finding (optional)' collapsed groups={lists.sources} selected={sourceCode ? [sourceCode] : []} onToggle={(c) => setSourceCode(c === sourceCode ? '' : c)} />
                        <ChoicePicker
                            title='Impact (optional)'
                            multi
                            max={MAX_IMPACTS}
                            hint='Up to 5 impacts: choose a category, tick the impacts, then change category to add more.'
                            groups={lists.impacts}
                            selected={impactCodes}
                            onToggle={(c) => setImpactCodes(toggleImpact(c))}
                        />
                    </>
                )}

                {step === 2 && (
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
                                    <button type='button' aria-label='Remove photo' onClick={() => setPhotos((cur) => cur.filter((x) => x.token !== p.token))} className='absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-slate-950/80 text-red-300'>
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

                {step === 3 && place && (
                    <>
                        <ReviewBlock label='Where' onEdit={() => setStep(0)}>
                            <p className='text-white'>
                                {place.assembly ? `${place.assembly.code} · ${place.assembly.name}` : `${place.unit?.code} · ${place.unit?.name}`}
                            </p>
                            {!place.assembly && <p className='text-xs text-amber-300'>Equipment only: the reviewer adds the assembly.</p>}
                            <p className='text-xs text-slate-400'>{place.path.map((p) => `${LEVEL_LABEL[p.level] ?? p.level} ${p.code}`).join(' › ')}</p>
                        </ReviewBlock>
                        <ReviewBlock label='Equipment-linked asset'>
                            <p className='text-white'>
                                {asset?.tag} · {asset?.name}
                            </p>
                            <p className='text-xs text-slate-400'>{asset?.className}</p>
                        </ReviewBlock>
                        <ReviewBlock label='Details' onEdit={() => setStep(1)}>
                            <p className='font-medium text-white'>{title.trim() || 'No title: one is made from the place'}</p>
                            <p className='whitespace-pre-wrap text-sm text-slate-300'>{description.trim() || 'No description given.'}</p>
                            <p className='mt-1 text-xs text-slate-400'>
                                Source: {source ? `${source.group} · ${source.label}` : 'not given'}
                            </p>
                        </ReviewBlock>
                        <ReviewBlock label={`Impact (${impactCodes.length}/${MAX_IMPACTS})`} onEdit={() => setStep(1)}>
                            {!impactCodes.length && <p className='text-sm text-slate-400'>None given.</p>}
                            <div className='flex flex-wrap gap-1'>
                                {impactCodes.map((c) => {
                                    const i = findIn(lists.impacts, c);
                                    return <Badge key={c}>{i ? `${i.group} · ${i.label}` : c}</Badge>;
                                })}
                            </div>
                            <p className='mt-1 text-xs text-slate-400'>Criticality is set by the assessor.</p>
                        </ReviewBlock>
                        <ReviewBlock label={`Photos (${photos.length})`} onEdit={() => setStep(2)}>
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

type Mode = '' | 'edit' | 'enrich' | 'close' | 'confirm_closure' | 'reject_closure' | 'assess' | 'review_assessment' | 'return_assessment' | 'return' | 'decline' | 'convert' | 'cancel';

function RequestDetail({ code, setup }: { code: string; setup: MntSetup }) {
    const lists = setup.lists!;
    const { data, error, loading, reload } = useLoad(() => callBackend<Detail>('/api/org/mnt/wr/get', { code }), [code]);
    const [mode, setMode] = useState<Mode>('');
    const [note, setNote] = useState('');
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [zoom, setZoom] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [section,setSection]=useState<'request'|'tasks'|'summary'>('request');
    const [tasksDirty,setTasksDirty]=useState(false);
    const goSection=async (next:'request'|'tasks'|'summary')=>{
        if(next!==section&&tasksDirty&&!(await appConfirm('You have unsaved task changes. Leave without saving them?')))return;
        setMode('');setActionError('');setSection(next);
    };
    // Phones: assessing (classification or tasks) runs full screen, above the app header and footer.
    const screen = useFullScreen(section === 'tasks' || mode === 'assess');

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
    if (mode === 'enrich') return <EnrichRequest detail={r} lists={lists} onDone={() => (setMode(''), reload())} onCancel={() => setMode('')} />;
    if (mode === 'close') return <CloseAtReview detail={r} lists={lists} onDone={() => (setMode(''), reload())} onCancel={() => setMode('')} />;

    const assessed = !!r.assessment.maintenanceTypeCode && !r.assessment.headerIssue;
    const today = new Date().toISOString().slice(0, 10);
    const datesOk = !!startDate && !!endDate && startDate >= today && endDate >= startDate;
    const buttons: Array<{ key: string; label: string; icon: ReactNode; variant?: 'primary' | 'secondary' | 'danger'; onClick: () => void }> = [];
    if (can.confirmClosure) {
        buttons.push({ key: 'confirmClosure', label: 'Confirm closure', icon: <CheckCircle2 className='h-4 w-4' />, onClick: () => setMode('confirm_closure') });
        buttons.push({ key: 'rejectClosure', label: 'Not fixed – reopen', icon: <Undo2 className='h-4 w-4' />, variant: 'secondary', onClick: () => setMode('reject_closure') });
    }
    if (can.startReview) buttons.push({ key: 'start', label: 'Start review', icon: <ClipboardList className='h-4 w-4' />, onClick: () => run('start_review') });
    if (can.close) buttons.push({ key: 'close', label: 'Close – no planning needed', icon: <Check className='h-4 w-4' />, variant: 'secondary', onClick: () => setMode('close') });
    if (can.enrich) buttons.push({ key: 'enrich', label: r.assemblyId ? 'Add details' : 'Add assembly & details', icon: <Pencil className='h-4 w-4' />, variant: r.assemblyId ? 'secondary' : 'primary', onClick: () => setMode('enrich') });
    if (can.assess && !can.reviewAssessment) buttons.push({ key: 'assess', label: assessed ? 'Update assessment' : 'Assess', icon: <ClipboardList className='h-4 w-4' />, variant: assessed ? 'secondary' : 'primary', onClick: () => setMode('assess') });
    if (can.reviewAssessment && assessed && r.assessmentTasks.length>0) buttons.push({ key: 'reviewAssessment', label: 'Approve assessment', icon: <CheckCircle2 className='h-4 w-4' />, variant: 'primary', onClick: () => {setSection('summary');setMode('review_assessment');} });
    if (can.convert) buttons.push({ key: 'convert', label: 'Convert to work order', icon: <Wrench className='h-4 w-4' />, variant: assessed ? 'primary' : 'secondary', onClick: () => setMode('convert') });
    if (can.return) buttons.push({ key: 'return', label: 'Return for information', icon: <Undo2 className='h-4 w-4' />, variant: 'secondary', onClick: () => setMode('return') });
    if (can.decline) buttons.push({ key: 'decline', label: 'Decline', icon: <X className='h-4 w-4' />, variant: 'danger', onClick: () => setMode('decline') });
    if (can.edit) buttons.push({ key: 'edit', label: 'Edit', icon: <Pencil className='h-4 w-4' />, variant: 'secondary', onClick: () => setMode('edit') });
    if (can.resubmit) buttons.push({ key: 'resubmit', label: 'Resubmit', icon: <Send className='h-4 w-4' />, onClick: () => run('resubmit') });
    if (can.cancel) buttons.push({ key: 'cancel', label: 'Cancel request', icon: <X className='h-4 w-4' />, variant: 'danger', onClick: () => setMode('cancel') });

    const typedNeeded = mode === 'decline' || mode === 'convert' || mode === 'cancel';
    const noteNeeded = mode === 'return' || mode === 'decline' || mode === 'cancel' || mode === 'review_assessment' || mode === 'return_assessment' || mode === 'reject_closure';
    const minNote = mode === 'review_assessment' || mode === 'return_assessment' || mode === 'reject_closure' ? 10 : 5;

    return (
        <div className={screen.className} onFocusCapture={screen.keepInView}>
            {/* Action bar on top */}
            <div className='shrink-0 space-y-2 border-b border-line bg-page pb-2'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' aria-label='Back' onClick={async () => { if(tasksDirty&&!(await appConfirm('You have unsaved task changes. Leave without saving?')))return; navigate('organization_admin/work_requests'); }}>
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

            <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
              <nav aria-label='Work request menu' className='flex shrink-0 gap-1 overflow-x-auto border-b border-slate-800 py-2'>
                {([
                   ['request','Request',<ClipboardList key='r' className='h-4 w-4'/>],
                   ['tasks','Tasks'+(r.assessmentTasks?.length?' ('+r.assessmentTasks.length+')':''),<Wrench key='t' className='h-4 w-4'/>],
                   ['summary','Summary',<CheckCircle2 key='s' className='h-4 w-4'/>],
                ] as const).map(([key,title,icon])=><button type='button' key={key} aria-current={section===key?'page':undefined}
                  onClick={()=>goSection(key)}
                  className={'flex min-h-[44px] flex-1 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold '+(section===key?'bg-emerald-900/50 text-emerald-200 ring-1 ring-emerald-700':'text-slate-400')}>
                  {icon}<span>{title}</span></button>)}
              </nav>
              <div className='min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain px-1 py-3 sm:px-4'>
                {actionError && !mode && <MntGateHint message={actionError} />}
                {section==='summary' && !r.assessmentReviewCurrent && !can.reviewAssessment && (r.assessmentReviewBlockers?.length||0)>0 && (
                  <Card className='space-y-2'>
                    <p className='font-semibold text-amber-200'>Why assessment approval is unavailable</p>
                    <ul className='list-disc space-y-1 pl-5 text-sm text-slate-200'>
                      {r.assessmentReviewBlockers?.map((reason,i)=><li key={i}>{reason}</li>)}
                    </ul>
                  </Card>
                )}

                {mode === 'assess' && <AssessPanel detail={r} lists={lists} onDone={() => (setMode(''), reload())} onCancel={() => setMode('')} />}

                {(mode === 'return' || mode === 'decline' || mode === 'convert' || mode === 'cancel' || mode === 'review_assessment' || mode === 'return_assessment' || mode === 'confirm_closure' || mode === 'reject_closure') && (
                    <Card className='space-y-3'>
                        <p className='font-medium text-white'>
                            {mode === 'confirm_closure' ? 'Confirm the closure made at review' : mode === 'reject_closure' ? 'Not fixed: send back to review' : mode === 'review_assessment' ? 'Approve the independently reviewed work assessment' : mode === 'return_assessment' ? 'Return assessment to the assessor for correction' : mode === 'return' ? 'Return to the requester for more information' : mode === 'decline' ? 'Decline this request' : mode === 'convert' ? 'Convert to a work order' : 'Cancel this request'}
                        </p>
                        {(mode === 'confirm_closure' || mode === 'reject_closure') && r.closure && <ClosureCard closure={r.closure} />}
                        {mode === 'convert' && (
                            <p className='text-sm text-slate-300'>
                                {r.assessmentReviewCurrent
                                    ? `A work order is created with the location, asset and the approved assessment (${r.assessment.maintenanceTypeLabel}). The request is then locked. Set when the work is scheduled to start and end.`
                                    : 'An independent authorized reviewer must approve the current task assessment before conversion.'}
                            </p>
                        )}
                        {mode === 'convert' && (
                            <div className='grid grid-cols-2 gap-2'>
                                <Field id='wr-start' type='date' label='Scheduled start *' min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                                <Field id='wr-end' type='date' label='Scheduled end *' min={startDate || today} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                                {startDate && endDate && !datesOk && <p className='col-span-2 text-xs text-amber-300'>The start cannot be in the past and the end cannot be before the start.</p>}
                            </div>
                        )}
                        {(noteNeeded || mode === 'convert' || mode === 'confirm_closure') && (
                            <TextArea
                                id='wr-note'
                                label={mode === 'review_assessment' ? 'Technical verification and approval notes *' : mode === 'return_assessment' ? 'Required corrections *' : mode === 'reject_closure' ? 'What is still wrong? *' : mode === 'return' ? 'What information is needed? *' : mode === 'convert' || mode === 'confirm_closure' ? 'Note (optional)' : 'Reason *'}
                                rows={3}
                                maxLength={500}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                            />
                        )}
                        {typedNeeded && <Field id='wr-confirm' label={`Type ${r.code} to confirm`} autoComplete='off' value={typed} onChange={(e) => setTyped(e.target.value)} />}
                        {actionError && <MntGateHint message={actionError} />}
                        <div className='flex gap-2'>
                            <Button
                                className='flex-1'
                                variant={mode === 'decline' || mode === 'cancel' ? 'danger' : 'primary'}
                                busy={busy}
                                disabled={(typedNeeded && typed.trim() !== r.code) || (noteNeeded && note.trim().length < minNote) || (mode === 'convert' && (!r.assessmentReviewCurrent || !datesOk))}
                                onClick={() => run(mode, mode === 'convert' ? { scheduledStart: startDate, scheduledEnd: endDate } : {})}
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
                {r.closure && <ClosureCard closure={r.closure} />}
                {r.closureRejections.length > 0 && r.status === 'under_review' && (
                    <Card>
                        <p className='text-xs font-semibold uppercase tracking-wider text-red-300'>Closure not accepted</p>
                        <p className='mt-1 text-sm text-slate-200'>{r.closureRejections[r.closureRejections.length - 1].reason}</p>
                        <p className='text-xs text-slate-500'>{r.closureRejections[r.closureRejections.length - 1].rejectedName} · {fmtDate(r.closureRejections[r.closureRejections.length - 1].rejectedAt)}</p>
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
                                {r.criticalityCode ? (
                                    <span className='rounded-full px-2 py-0.5 text-xs font-semibold text-white' style={{ background: critColor(r.criticalityCode, r.criticalityColor) }}>
                                        {r.criticalityLabel}
                                    </span>
                                ) : (
                                    <Badge>Criticality: set at assessment</Badge>
                                )}
                                {r.criticalityOriginalLabel && <Badge>Raised as {r.criticalityOriginalLabel}</Badge>}
                            </div>
                        </div>
                    </div>
                    <p className='mt-3 whitespace-pre-wrap text-sm text-slate-300'>{r.description || 'No description yet: added at review.'}</p>
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



                 {(r.assessment.maintenanceTypeLabel || r.assessment.note || r.assessment.technicalEvaluation) && (
                    <Card className='space-y-2 text-sm'>
                        <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Assessment</p>
                        {r.assessment.technicalEvaluation && <Info label='Technical evaluation' value={r.assessment.technicalEvaluation} />}
                        {r.assessment.natureLabel && <Info label='Nature' value={r.assessment.natureLabel} />}
                        {r.assessment.severityCode && <Info label='Severity' value={r.criticalityLabel} />}
                        {r.assessment.solutions.length > 0 && <Info label='Solution categories' value={r.assessment.solutions.map((x) => `${x.group} · ${x.label}`).join('; ')} />}
                        {r.assessment.maintenanceTypeLabel && <Info label='Maintenance type' value={r.assessment.maintenanceTypeLabel} />}
                        {r.assessment.workTypeLabel && <Info label='Work type' value={r.assessment.workTypeLabel} />}
                        {r.assessment.priorityLabel && <Info label='Priority' value={r.assessment.priorityLabel} />}
                        {r.assessment.disciplineLabel && <Info label='Discipline' value={r.assessment.disciplineLabel} />}
                        {r.assessment.note && <Info label='Reviewer note' value={r.assessment.note} />}
                        {r.reviewerName && <Info label='Reviewer' value={r.reviewerName} />}
                    </Card>
                )}

                <Card className='space-y-2 text-sm'>
                    <Info label='Asset' value={`${r.assetTag} · ${r.assetName}`} sub={r.assetClass} />
                    <Info label='Assembly' value={r.assemblyCode ? `${r.assemblyCode} · ${r.assemblyName}` : 'Not given: added at review'} />
                    <Info label='Equipment unit' value={`${r.unitCode} · ${r.unitName}`} />
                    <Info label='Cost center' value={`${r.costCenterCode} · ${r.costCenterName}`} />
                    <Info label='Source of finding' value={r.sourceLabel ? `${r.sourceGroup} · ${r.sourceLabel}` : 'Not given'} />
                    {r.failureModeLabel && <Info label='Failure mode' value={r.failureModeLabel} />}
                    <div className='border-t border-slate-800 pt-2'>
                        <p className='text-xs text-slate-500'>Impacts</p>
                        {!r.impacts.length && <p className='text-xs text-slate-400'>None given.</p>}
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
                {section==='tasks' && <MntTaskAssessment key={r.code} code={r.code} initial={r.assessmentTasks||[]} editable={can.assess&&!can.reviewAssessment} onSaved={reload} onDirtyChange={setTasksDirty}
                    context={{asset:`${r.assetTag} · ${r.assetName}`,assembly:`${r.assemblyCode} · ${r.assemblyName}`,equipment:`${r.unitCode} · ${r.unitName}`}}/>}
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
        <p className='font-semibold text-white'>Technical verification</p>
        <Info label='Technical evaluation' value={detail.assessment.technicalEvaluation||'Not yet written'}/>
        <Info label='Nature' value={detail.assessment.natureLabel||'Not yet classified'}/>
        <Info label='Severity' value={detail.assessment.severityCode?detail.criticalityLabel:'Not yet classified'}/>
        <Info label='Solution categories' value={detail.assessment.solutions.map(x=>x.group+' · '+x.label).join('; ')||'Not yet chosen'}/>
        <Info label='Maintenance type' value={detail.assessment.maintenanceTypeLabel||'Not yet classified'}/>
        {detail.assessment.workTypeLabel&&<Info label='Work type' value={detail.assessment.workTypeLabel}/>}
        {detail.assessment.priorityLabel&&<Info label='Priority' value={detail.assessment.priorityLabel}/>}
        {detail.assessment.disciplineLabel&&<Info label='Discipline' value={detail.assessment.disciplineLabel}/>}
        <Info label='Linked asset' value={detail.assetTag+' · '+detail.assetName}/>
        <Info label='Equipment' value={detail.unitCode+' · '+detail.unitName}/>
      </Card>
      <Card className='space-y-2 text-sm'>
        <p className='font-semibold text-white'>Safety overview</p>
        {MACHINE_STATUS.map(([value,title])=><Info key={value} label={title} value={String(tasks.filter(t=>machineOf(t)===value).length)+' task(s)'}/>)}
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
            <p><strong>Machine status:</strong> {machineLabel(task)}</p>
            <p><strong>Skills:</strong> {task.skillCodes?.join(', ')||task.skills||'None'}</p>
            <p><strong>Services:</strong> {task.services?.map(sv=>sv.description).join('; ')||'None'}</p>
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

/** The technical verification of the need and the proposed solution (the assessment header). */
function AssessPanel({ detail, lists, onDone, onCancel }: { detail: Detail; lists: MntLists; onDone: () => void; onCancel: () => void }) {
    const a = detail.assessment;
    const [evaluation, setEvaluation] = useState(a.technicalEvaluation);
    const [nature, setNature] = useState(a.natureCode);
    const [severity, setSeverity] = useState(a.severityCode || detail.criticalityCode);
    const [solutions, setSolutions] = useState<string[]>(a.solutions.map((x) => x.code));
    const [mtype, setMtype] = useState(a.maintenanceTypeCode);
    const [prio, setPrio] = useState(a.priorityCode);
    const [note, setNote] = useState(a.note);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const missing = [
        evaluation.trim().length >= 20 ? '' : 'technical evaluation (20+ characters)',
        nature ? '' : 'nature',
        severity ? '' : 'severity',
        solutions.length ? '' : 'solution categories',
        mtype ? '' : 'maintenance type',
    ].filter(Boolean);
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/org/mnt/wr/action', { code: detail.code, action: 'assess', technicalEvaluation: evaluation.trim(), natureCode: nature, severityCode: severity, solutionCodes: solutions, maintenanceTypeCode: mtype, priorityCode: prio, note: note.trim() });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the assessment.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <Card className='space-y-3'>
            <p className='font-medium text-white'>Work assessment</p>
            <p className='text-xs text-slate-400'>Verify the need technically and choose the solution. Add the tasks (spares, skills, people, tools, services, machine status, LOTO and permits) on the Tasks tab. A technical supervisor approves it.</p>
            <TextArea id='as-eval' label='1. Technical evaluation of the request *' rows={4} maxLength={3000} placeholder='What was verified, the condition found and why work is needed.' value={evaluation} onChange={(e) => setEvaluation(e.target.value)} />
            <ChoicePicker title='2. Nature (failure mode)' required groups={lists.failureModes} selected={nature ? [nature] : []} onToggle={(c) => setNature(c === nature ? '' : c)} />
            <div>
                <p className='mb-1 text-sm text-slate-300'>2. Severity *</p>
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
                    {lists.criticality.map((c) => {
                        const color = critColor(c.code, c.color, lists.criticality);
                        const on = severity === c.code;
                        return (
                            <button key={c.code} type='button' aria-pressed={on} onClick={() => setSeverity(c.code)} className={`min-h-12 rounded-xl border-2 text-sm font-semibold ${on ? 'text-white' : 'text-slate-200'}`} style={{ borderColor: color, background: on ? color : `${color}22` }}>
                                {c.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            <ChoicePicker title='3. Solution categories' required multi max={5} hint='Choose a category, then tick up to 5 solutions.' groups={lists.solutions} selected={solutions} onToggle={(c) => setSolutions((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : cur.length >= 5 ? cur : [...cur, c]))} />
            <SelectField id='as-mtype' label='Maintenance type * (decides the GL account)' value={mtype} onChange={(e) => setMtype(e.target.value)}>
                <option value=''>Select…</option>
                {lists.maintenanceTypes.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
            </SelectField>
            <SelectField id='as-prio' label='Priority (optional)' value={prio} onChange={(e) => setPrio(e.target.value)}>
                <option value=''>Not set</option>
                {lists.priorities.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
            </SelectField>
            <TextArea id='as-note' label='Assessment note (optional)' rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            {missing.length > 0 && <p className='text-xs text-amber-300'>Still needed: {missing.join(', ')}.</p>}
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex gap-2'>
                <Button className='flex-1' busy={busy} disabled={missing.length > 0} onClick={save}>
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

export function ClosureCard({ closure }: { closure: Closure }) {
    return (
        <Card className='space-y-2 text-sm'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Closed at review</p>
                <Badge tone={closure.confirmedAt ? 'brand' : 'warn'}>{closure.confirmedAt ? 'Confirmed' : 'Awaiting confirmation'}</Badge>
            </div>
            <Info label='Cause' value={`${closure.causeGroup} · ${closure.causeLabel}`} />
            <Info label='Solution' value={`${closure.solutionGroup} · ${closure.solutionLabel}`} />
            <Info label='Maintenance type' value={closure.maintenanceTypeLabel} />
            <Info label='What was done' value={closure.description} />
            <Info label='Closed by' value={`${closure.name} · ${fmtDate(closure.at)}`} />
            {closure.confirmedAt && <Info label='Confirmed by' value={`${closure.confirmedName} · ${fmtDate(closure.confirmedAt)}`} sub={closure.confirmNote} />}
        </Card>
    );
}

/** Fixed on the spot: close at review with cause, solution and maintenance type. A supervisor confirms. */
function CloseAtReview({ detail, lists, onDone, onCancel }: { detail: Detail; lists: MntLists; onDone: () => void; onCancel: () => void }) {
    const [cause, setCause] = useState('');
    const [solution, setSolution] = useState('');
    const [mtype, setMtype] = useState('');
    const [description, setDescription] = useState('');
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const screen = useFullScreen(true);
    const missing = [cause ? '' : 'cause', solution ? '' : 'solution', mtype ? '' : 'maintenance type', description.trim().length >= 10 ? '' : 'what was done (10+ characters)', typed.trim() === detail.code ? '' : `type ${detail.code}`].filter(Boolean);
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/org/mnt/wr/action', { code: detail.code, action: 'close_review', causeCode: cause, solutionCode: solution, maintenanceTypeCode: mtype, description: description.trim(), confirm: typed.trim() });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not close the request.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className={screen.className} onFocusCapture={screen.keepInView}>
            <div className='flex shrink-0 items-center gap-2 border-b border-line bg-page pb-3'>
                <Button variant='secondary' aria-label='Back' onClick={onCancel}><ArrowLeft className='h-4 w-4' /></Button>
                <div className='min-w-0 flex-1'><p className='truncate font-semibold text-white'>Close {detail.code}</p><p className='truncate text-xs text-slate-400'>No planning needed · a supervisor confirms</p></div>
                <Button busy={busy} disabled={missing.length > 0} onClick={save}><Check className='h-4 w-4' />Close</Button>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                <ChoicePicker title='Cause' required groups={lists.rootCauses} selected={cause ? [cause] : []} onToggle={(c) => setCause(c === cause ? '' : c)} />
                <ChoicePicker title='Solution' required groups={lists.solutions} selected={solution ? [solution] : []} onToggle={(c) => setSolution(c === solution ? '' : c)} />
                <TextArea id='cl-desc' label='What was done? *' rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
                <SelectField id='cl-mtype' label='Type of maintenance * (decides the GL account)' value={mtype} onChange={(e) => setMtype(e.target.value)}>
                    <option value=''>Select…</option>
                    {lists.maintenanceTypes.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
                </SelectField>
                <Field id='cl-confirm' label={`Type ${detail.code} to confirm`} autoComplete='off' value={typed} onChange={(e) => setTyped(e.target.value)} />
                {missing.length > 0 && <p className='text-xs text-amber-300'>Still needed: {missing.join(', ')}.</p>}
                {error && <MntGateHint message={error} />}
            </div>
        </div>
    );
}

/**
 * Review and assessment build on the request: fill what the requester left empty, add photos and add or change the
 * assembly (of the same equipment). What the requester wrote stays as written; every change is logged.
 */
function EnrichRequest({ detail, lists, onDone, onCancel }: { detail: Detail; lists: MntLists; onDone: () => void; onCancel: () => void }) {
    const [assemblyId, setAssemblyId] = useState(detail.assemblyId);
    const [title, setTitle] = useState(detail.titleAuto ? '' : detail.title);
    const [description, setDescription] = useState(detail.description);
    const [sourceCode, setSourceCode] = useState(detail.sourceCode);
    const [impactCodes, setImpactCodes] = useState(detail.impacts.map((i) => i.code));
    const [failureMode, setFailureMode] = useState(detail.failureModeCode);
    const [photos, setPhotos] = useState<Array<{ token: string; url: string }>>([]);
    const [uploading, setUploading] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const screen = useFullScreen(true);
    const fixed = { title: !detail.titleAuto && !!detail.title, description: !!detail.description, source: !!detail.sourceCode, failure: !!detail.failureModeCode };
    const had = detail.impacts.map((i) => i.code);
    const tasksSaved = detail.assessmentTasks.length > 0;
    const changed = assemblyId !== detail.assemblyId || (!fixed.title && !!title.trim()) || (!fixed.description && !!description.trim()) || (!fixed.source && !!sourceCode) || impactCodes.some((c) => !had.includes(c)) || (!fixed.failure && !!failureMode) || photos.length > 0;
    const addPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        for (const file of files.slice(0, Math.max(0, 8 - detail.photos.length - photos.length - uploading))) {
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
            await callBackend('/api/org/mnt/wr/action', {
                code: detail.code, action: 'enrich',
                assemblyId: assemblyId !== detail.assemblyId ? assemblyId : '',
                title: fixed.title ? '' : title.trim(), description: fixed.description ? '' : description.trim(),
                sourceCode: fixed.source ? '' : sourceCode, impactCodes: impactCodes.filter((c) => !had.includes(c)),
                failureModeCode: fixed.failure ? '' : failureMode, addPhotos: photos.map((p) => p.token),
            });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };
    const kept = (label: string, value: string) => (
        <div className='rounded-xl border border-line bg-panel p-3'>
            <p className='text-xs text-slate-500'>{label} · from the requester (kept)</p>
            <p className='mt-1 whitespace-pre-wrap text-sm text-slate-200'>{value}</p>
        </div>
    );
    return (
        <div className={screen.className} onFocusCapture={screen.keepInView}>
            <div className='flex shrink-0 items-center gap-2 border-b border-line bg-page pb-3'>
                <Button variant='secondary' aria-label='Back' onClick={onCancel}><ArrowLeft className='h-4 w-4' /></Button>
                <div className='min-w-0 flex-1'><p className='truncate font-semibold text-white'>Add details · {detail.code}</p><p className='truncate text-xs text-slate-400'>Empty fields only · every change is logged</p></div>
                <Button busy={busy} disabled={!changed || !!uploading} onClick={save}><Check className='h-4 w-4' />Save</Button>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                <SelectField id='en-asm' label={`Assembly of ${detail.unitCode} ${detail.unitName}`} value={assemblyId} disabled={tasksSaved} onChange={(e) => setAssemblyId(e.target.value)}>
                    <option value='' disabled={!!detail.assemblyId}>Not known yet</option>
                    {detail.assemblyOptions.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </SelectField>
                {tasksSaved && <p className='text-xs text-slate-400'>Tasks are already assessed against this assembly, so it can no longer change.</p>}
                {!detail.assemblyId && !tasksSaved && <p className='text-xs text-amber-300'>Add the assembly before assessing tasks.</p>}
                {fixed.title ? kept('Title', detail.title) : <Field id='en-title' label='Title' maxLength={120} placeholder={detail.title} value={title} onChange={(e) => setTitle(e.target.value)} />}
                {fixed.description ? kept('Description', detail.description) : <TextArea id='en-desc' label='Description' rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}
                {fixed.source ? kept('Source of the finding', `${detail.sourceGroup} · ${detail.sourceLabel}`) : <GroupPicker title='Source of the finding' collapsed groups={lists.sources} selected={sourceCode ? [sourceCode] : []} onToggle={(c) => setSourceCode(c === sourceCode ? '' : c)} />}
                <ChoicePicker title={`Impacts (add up to ${MAX_IMPACTS} in total)`} multi max={MAX_IMPACTS} groups={lists.impacts} selected={impactCodes} onToggle={(c) => { if (!had.includes(c)) setImpactCodes(toggleImpact(c)); }} />
                {fixed.failure ? kept('Failure mode', detail.failureModeLabel) : <ChoicePicker title='Failure mode' groups={lists.failureModes} selected={failureMode ? [failureMode] : []} onToggle={(c) => setFailureMode(c === failureMode ? '' : c)} />}
                <div className='grid grid-cols-3 gap-2'>
                    {photos.map((p) => (
                        <div key={p.token} className='relative overflow-hidden rounded-xl border border-slate-800'>
                            <img src={p.url} alt='New photo' className='aspect-square w-full object-cover' />
                            <button type='button' aria-label='Remove photo' onClick={() => setPhotos((cur) => cur.filter((x) => x.token !== p.token))} className='absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-slate-950/80 text-red-300'><Trash2 className='h-4 w-4' /></button>
                        </div>
                    ))}
                    {detail.photos.length + photos.length + uploading < 8 && (
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

function EditRequest({ detail, lists, onDone, onCancel }: { detail: Detail; lists: MntLists; onDone: () => void; onCancel: () => void }) {
    const [title, setTitle] = useState(detail.titleAuto ? '' : detail.title);
    const [description, setDescription] = useState(detail.description);
    const [sourceCode, setSourceCode] = useState(detail.sourceCode);
    const [impactCodes, setImpactCodes] = useState(detail.impacts.map((i) => i.code));
    const [photos, setPhotos] = useState(detail.photos);
    const [uploading, setUploading] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ok = (!title.trim() || title.trim().length >= 3) && impactCodes.length <= MAX_IMPACTS && !uploading;
    const screen = useFullScreen(true);

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
            await callBackend('/api/org/mnt/wr/action', { code: detail.code, action: 'edit', title, description, sourceCode, impactCodes, photos: photos.map((p) => p.token) });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className={screen.className} onFocusCapture={screen.keepInView}>
            <div className='flex shrink-0 items-center gap-2 border-b border-line bg-page pb-3'>
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
                <Field id='ed-title' label='Short title (optional)' maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
                <TextArea id='ed-desc' label='What did you find? (optional)' rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
                <GroupPicker title='Source of the finding (optional)' groups={lists.sources} selected={sourceCode ? [sourceCode] : []} onToggle={(c) => setSourceCode(c === sourceCode ? '' : c)} />
                <ChoicePicker title='Impact (optional)' multi max={MAX_IMPACTS} groups={lists.impacts} selected={impactCodes} onToggle={(c) => setImpactCodes(toggleImpact(c))} />
                <div className='grid grid-cols-3 gap-2'>
                    {photos.map((p) => (
                        <div key={p.token} className='relative overflow-hidden rounded-xl border border-slate-800'>
                            <img src={p.url} alt='Photo' className='aspect-square w-full object-cover' />
                            <button type='button' aria-label='Remove photo' onClick={() => setPhotos((cur) => cur.filter((x) => x.token !== p.token))} className='absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-slate-950/80 text-red-300'>
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

