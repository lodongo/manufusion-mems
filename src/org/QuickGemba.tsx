import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, Camera, CheckCircle2, ClipboardCheck, ImagePlus, Plus, Search, Send, Wrench } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Button, Card, Spinner } from '../admin/kit';
import { compressPhoto } from './mntShared';
import { leaveQuick, useQuickLeave } from './quickNavigation';
import { X } from 'lucide-react';

interface Asset { tag: string; name: string }
interface Type { code: string; label: string }
interface Gemba {
    id: string; name: string; typeCode: string; typeName: string; assetTags: string[];
    assetNames: string[]; status: string; createdAt: string; closedAt: string;
    draft?: { assetTag: string; description: string; photoPath: string };
    draftPhotoUrl?: string;
}
interface Obs {
    id: string; assetTag: string; assetName: string; description: string;
    photoPath: string; photoUrl: string; reviewStatus: string;
    closureReason: string; workRequestCode: string; createdAt: string;
}
interface Assembly { id: string; code: string; name: string; unitName: string; siteName: string }
const field = 'min-h-11 w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink';
const errText = (e: unknown) => e instanceof Error ? e.message : 'Could not complete the request.';
const routeTo = (id?: string) => navigate(id ? 'organization_home/quick/gemba/' + id : 'organization_home/quick/gemba');

type StartDraft = { typeCode: string; name: string; assetTags: string[] };
function setupDraft(uid: string): StartDraft {
    try {
        const raw = localStorage.getItem('mems.quick.gemba.setup.' + uid);
        const value = raw ? JSON.parse(raw) as Partial<StartDraft> : {};
        return { typeCode: typeof value.typeCode === 'string' ? value.typeCode : '',
            name: typeof value.name === 'string' ? value.name : '',
            assetTags: Array.isArray(value.assetTags) ? value.assetTags.filter((x): x is string => typeof x === 'string').slice(0, 30) : [] };
    } catch { return { typeCode: '', name: '', assetTags: [] }; }
}
export default function QuickGemba({ id, uid }: { id?: string; uid: string }) {
    const [initial] = useState(() => setupDraft(uid));
    const [types, setTypes] = useState<Type[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [list, setList] = useState<Gemba[]>([]);
    const [typeCode, setTypeCode] = useState(initial.typeCode);
    const [name, setName] = useState(initial.name);
    const [assetTags, setAssetTags] = useState<string[]>(initial.assetTags);
    const [search, setSearch] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [showClosed, setShowClosed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (id) return;
        try { localStorage.setItem('mems.quick.gemba.setup.' + uid, JSON.stringify({ typeCode, name, assetTags })); }
        catch { /* Starting a Gemba still works when device storage is unavailable. */ }
    }, [uid, id, typeCode, name, assetTags]);
    useEffect(() => {
        if (id) return;
        let alive = true;
        void Promise.all([
            callBackend<{ types: Type[]; assets: Asset[] }>('/api/org/quick/gemba/options'),
            callBackend<{ items: Gemba[] }>('/api/org/quick/gemba/list'),
        ]).then(([options, sessions]) => {
            if (!alive) return;
            setTypes(options.types); setAssets(options.assets); setList(sessions.items);
            setAssetTags((prev) => prev.filter((tag) => options.assets.some((a) => a.tag === tag)));
        }).catch((e: unknown) => { if (alive) setError(errText(e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [id]);
    const begin = async () => {
        setError('');
        if (!typeCode || name.trim().length < 3 || !assetTags.length) return setError('Select a type, enter a name and choose at least one asset.');
        setBusy(true);
        try {
            const r = await callBackend<{ id: string }>('/api/org/quick/gemba/start', { name, typeCode, assetTags });
            try { localStorage.removeItem('mems.quick.gemba.setup.' + uid); } catch { /* Saved session is authoritative. */ }
            routeTo(r.id);
        } catch (e) { setError(errText(e)); } finally { setBusy(false); }
    };
    if (id) return <GembaSession key={id} id={id} uid={uid} />;
    const matching = assets.filter((a) => (a.tag + ' ' + a.name).toLowerCase().includes(search.toLowerCase()));
    const visibleSessions=list.filter(g=>g.status!=='closed'||showClosed);
    const closedCount=list.filter(g=>g.status==='closed').length;
    return (
        <div className='space-y-4'>
            <header className='flex min-h-14 items-center justify-between gap-3'>
                <div className='min-w-0'><h2 className='text-lg font-semibold text-ink'>My Gembas</h2><p className='text-xs text-muted'>Open, resume or review a session</p></div>
                <button type='button' title={showCreate?'Close new Gemba form':'Start a Gemba'} aria-label={showCreate?'Close new Gemba form':'Start a Gemba'} aria-expanded={showCreate} onClick={()=>setShowCreate(v=>!v)}
                    className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-onbrand shadow-sm transition-transform active:scale-95'>
                    {showCreate?<X className='h-6 w-6'/>:<Plus className='h-6 w-6'/>}
                </button>
            </header>
            {showCreate&&<Card className='space-y-3'>
                <h3 className='font-semibold text-ink'>New Gemba</h3>
                <label className='block text-xs font-semibold text-muted'>Type of Gemba
                    <select value={typeCode} onChange={(e) => setTypeCode(e.target.value)} className={field + ' mt-1'}>
                        <option value=''>Choose type</option>
                        {types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                    </select>
                </label>
                <label className='block text-xs font-semibold text-muted'>Gemba name
                    <input maxLength={120} className={field + ' mt-1'} value={name}
                        onChange={(e) => setName(e.target.value)} placeholder='e.g. Bottling Line 8 morning Gemba' />
                </label>
                <p className='text-xs text-muted'>Choose one or more assets from the operational level assigned to your account. Your setup stays on this device until you start a session.</p>
                <div className='relative'>
                    <Search className='absolute left-3 top-3.5 h-4 w-4 text-muted' />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} className={field + ' pl-9'}
                        placeholder='Find an asset by tag or name' aria-label='Search assigned assets' />
                </div>
                <div className='max-h-52 space-y-1 overflow-y-auto rounded-xl border border-line p-2'>
                    {loading ? <Spinner /> : matching.length === 0 ? (
                        <p className='p-3 text-sm text-muted'>No matching assets within your assigned operational area.</p>
                    ) : matching.map((a) => (
                        <label key={a.tag} className='flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm text-ink'>
                            <input type='checkbox' className='h-5 w-5 accent-[rgb(var(--c-brand))]' checked={assetTags.includes(a.tag)}
                                onChange={(e) => setAssetTags((prev) => e.target.checked ? [...prev, a.tag] : prev.filter((tag) => tag !== a.tag))} />
                            <span className='min-w-0'><span className='block font-semibold'>{a.name}</span><span className='font-mono text-xs text-muted'>{a.tag}</span></span>
                        </label>
                    ))}
                </div>
                <p className='text-xs text-muted'>{assetTags.length} asset{assetTags.length === 1 ? '' : 's'} selected (maximum 30)</p>
                {!loading&&!types.length&&<p role='alert' className='text-xs text-amber-600'>No Gemba subtypes are enabled in Maintenance → Work Request Sources. Configure the Gemba group before starting a session.</p>}
                <Button disabled={busy || loading || !typeCode || assetTags.length === 0 || assetTags.length > 30 || name.trim().length < 3}
                    busy={busy} onClick={() => { void begin(); }} className='w-full'>
                    <Plus className='h-4 w-4' /> Start Gemba
                </Button>
            </Card>}
            {error && <Alert tone='error'>{error}</Alert>}
            <label className='flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 text-xs font-semibold text-ink'>
                <span>Show closed Gembas {closedCount>0?`(${closedCount})`:''}</span>
                <input type='checkbox' checked={showClosed} onChange={e=>setShowClosed(e.target.checked)} className='h-5 w-5 accent-[rgb(var(--c-brand))]' />
            </label>
            <section className='space-y-2'>
                <h3 className='text-sm font-semibold text-ink'>Sessions ({visibleSessions.length})</h3>
                {!visibleSessions.length&&<p className='rounded-xl border border-line bg-panel p-4 text-xs text-muted'>No {showClosed?'matching':'active'} Gemba sessions. Tap + to begin a new Gemba.</p>}
                {visibleSessions.map((g) => (
                    <button type='button' onClick={() => routeTo(g.id)} key={g.id}
                        className='flex w-full items-start justify-between gap-2 rounded-xl border border-line bg-panel p-3 text-left'>
                        <span className='min-w-0'>
                            <span className='block truncate text-sm font-semibold text-ink'>{g.name}</span>
                            <span className='block text-xs text-muted'>{g.typeName} · {g.assetTags.length} assets</span>
                        </span>
                        <span className='shrink-0 rounded-full border border-line px-2 py-1 text-xs text-brand'>{g.status === 'closed' ? 'Review' : 'In progress'}</span>
                    </button>
                ))}
            </section>
        </div>
    );
}
function GembaSession({ id, uid }: { id: string; uid: string }) {
    const [gemba, setGemba] = useState<Gemba | null>(null);
    const [items, setItems] = useState<Obs[]>([]);
    const [assetTag, setAssetTag] = useState('');
    const [description, setDescription] = useState('');
    const [photo, setPhoto] = useState<{ path: string; url: string } | null>(null);
    const [captureMode,setCaptureMode]=useState(true);
    const [uploading, setUploading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [reviewId, setReviewId] = useState('');
    const [reviewMode, setReviewMode] = useState<'' | 'close' | 'wr'>('');
    const [reason, setReason] = useState('');
    const [assemblies, setAssemblies] = useState<Assembly[]>([]);
    const [assemblyId, setAssemblyId] = useState('');
    const [loading, setLoading] = useState(true);
    const hasResumed = useRef(false);
    const draftKey = 'mems.quick.gemba.observation.' + uid + '.' + id;
    useEffect(() => {
        if (!gemba || gemba.status !== 'open') return;
        try {
            localStorage.setItem(draftKey, JSON.stringify({ assetTag, description, photo }));
        } catch { /* The server draft remains available after explicit Save & exit. */ }
    }, [draftKey, gemba, assetTag, description, photo]);
    const saveDraft = async (): Promise<boolean> => {
        if (busy || uploading) {
            setError('Please wait until the current photo or observation finishes saving.');
            return false;
        }
        if (!gemba || gemba.status !== 'open') return true;
        try {
            await callBackend('/api/org/quick/gemba/draft', {
                id, assetTag: assetTag || gemba.assetTags[0],
                description, photoPath: photo?.path || '',
            });
            setInfo('Gemba draft saved. You can return to this session later.');
            return true;
        } catch (e) {
            setError(errText(e) + ' The draft is still saved on this device.');
            return false;
        }
    };
    useQuickLeave(saveDraft);
    const reload = async () => {
        try {
            const r = await callBackend<{ gemba: Gemba; observations: Obs[] }>('/api/org/quick/gemba/get', { id });
            setGemba(r.gemba);
            setItems(r.observations);
            if (!hasResumed.current) {
                let local: { assetTag?: string; description?: string; photo?: { path: string; url: string } } = {};
                try { local = JSON.parse(localStorage.getItem(draftKey) || '{}'); } catch { /* Ignore invalid local drafts. */ }
                const saved = r.gemba.draft || {
                    assetTag: local.assetTag || '', description: local.description || '',
                    photoPath: local.photo?.path || '',
                };
                const tag = r.gemba.assetTags.includes(saved.assetTag) ? saved.assetTag : r.gemba.assetTags[0];
                setAssetTag(tag || '');
                setDescription(r.gemba.status === 'open' ? saved.description || '' : '');
                setPhoto(r.gemba.status === 'open' && saved.photoPath
                    ? { path: saved.photoPath, url: r.gemba.draftPhotoUrl || local.photo?.url || '' } : null);
                hasResumed.current = true;
            }
        } catch (e) { setError(errText(e)); }
        finally { setLoading(false); }
    };
    useEffect(() => { void reload(); }, [id]);
    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        setUploading(true); setError('');
        try {
            const data = await compressPhoto(file);
            const r = await callBackend<{ path: string; url: string }>('/api/org/quick/gemba/photo', { id, data });
            setPhoto(r);
        } catch (e) { setError(errText(e)); } finally { setUploading(false); }
    };
    const add = async () => {
        if (!assetTag || (!description.trim() && !photo)) return setError('Choose an asset and add a description, photo or both.');
        setBusy(true); setError(''); setInfo('');
        try {
            await callBackend('/api/org/quick/gemba/observe', { id, assetTag, description, photoPath: photo?.path || '' });
            setDescription(''); setPhoto(null); setInfo('Observation saved. Add the next observation.');
            try { localStorage.removeItem(draftKey); } catch { /* The server cleared the draft. */ }
            await reload();
        } catch (e) { setError(errText(e)); } finally { setBusy(false); }
    };
    const close = async () => {
        if (!window.confirm('Close the Gemba and proceed to review? No further observations can be added.')) return;
        setBusy(true); setError('');
        try {
            await callBackend('/api/org/quick/gemba/close', { id });
            try { localStorage.removeItem(draftKey); } catch { /* Session is closed. */ }
            await reload();
        }
        catch (e) { setError(errText(e)); } finally { setBusy(false); }
    };
    const chooseReview = async (o: Obs, mode: 'close' | 'wr') => {
        setReviewId(o.id); setReviewMode(mode); setReason(''); setAssemblies([]); setAssemblyId(''); setError('');
        if (mode === 'wr') {
            try {
                const r = await callBackend<{ assemblies: Assembly[] }>('/api/org/quick/gemba/assemblies', { id, observationId: o.id });
                setAssemblies(r.assemblies);
            } catch (e) { setError(errText(e)); }
        }
    };
    const resolve = async () => {
        if (!reviewId) return;
        if (reason.trim().length < 5) return setError('Give a closure reason of at least five characters.');
        setBusy(true); setError('');
        try {
            await callBackend('/api/org/quick/gemba/resolve', { id, observationId: reviewId, reason });
            setReviewId(''); setReviewMode(''); await reload();
            setInfo('Observation closed with your reason.');
        } catch (e) { setError(errText(e)); } finally { setBusy(false); }
    };
    const startRequest = () => {
        const selected = items.find((item) => item.id === reviewId);
        if (!selected || !assemblyId) return setError('Select the assembly before proceeding.');
        // Carry the validated Gemba provenance and the existing photo into the work request.
        try {
            sessionStorage.setItem('mems.gemba.pending_wr', JSON.stringify({
                id, observationId: selected.id, assetTag: selected.assetTag,
                title: selected.description.trim().slice(0, 110) || 'Gemba finding · ' + selected.assetName,
                description: selected.description,
                gembaTypeCode: gemba?.typeCode || '', gembaTypeName: gemba?.typeName || '',
                photoPath: selected.photoPath || '', photoUrl: selected.photoUrl || '',
                assemblyId,
            }));
        } catch { return setError('Cannot carry the Gemba finding into the work-request wizard. Enable session storage.'); }
        navigate('organization_home/work_requests/new/' + assemblyId);
    };
    if (loading) return <Spinner />;
    if (!gemba) return <Alert tone='error'>{error || 'Gemba session not found.'}</Alert>;
    const completed = items.filter((o) => o.reviewStatus !== 'pending').length;
    if(gemba.status==='open'&&captureMode)return (
        <section className='fixed inset-0 z-[75] flex h-[100dvh] w-full flex-col overflow-hidden bg-page text-ink' aria-label='Full-screen Gemba observation capture'>
            <header className='flex min-h-16 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 pt-[env(safe-area-inset-top)] sm:px-6'>
                <button type='button' onClick={()=>{void saveDraft().then(ok=>{if(ok)setCaptureMode(false)})}} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-brand' aria-label='Return to Gemba details'><ArrowLeft className='h-5 w-5'/></button>
                <span className='min-w-0 flex-1'><strong className='block truncate text-sm text-ink'>{gemba.name}</strong><span className='block text-xs text-muted'>{gemba.typeName} · Observation {items.length+1}</span></span>
                <span className='shrink-0 rounded-full bg-brand/10 px-3 py-2 text-xs font-bold text-brand'>{items.length} saved</span>
            </header>
            <div className='min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6'>
                {error&&<Alert tone='error'>{error}</Alert>}
                {info&&<Alert tone='success'>{info}</Alert>}
                <label className='block text-sm font-semibold text-muted'>Asset being observed
                    <select value={assetTag} onChange={e=>setAssetTag(e.target.value)} className={field+' mt-2'}>
                        {gemba.assetTags.map((tag,i)=><option key={tag} value={tag}>{gemba.assetNames[i]||tag} · {tag}</option>)}
                    </select>
                </label>
                <label className='block text-sm font-semibold text-muted'>Observation (text or photo)
                    <textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={5000} rows={6}
                        placeholder='What did you see? Describe the finding or attach a photo.'
                        className={field+' mt-2 min-h-44 resize-y'} />
                </label>
                <label className='flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand/40 bg-brand/5 px-4 text-sm font-semibold text-brand'>
                    <Camera className='h-6 w-6'/>{uploading?'Uploading photo…':photo?'Replace observation photo':'Capture or attach photo'}
                    <input type='file' accept='image/*' capture='environment' onChange={e=>{void upload(e)}} disabled={uploading} className='sr-only' />
                </label>
                {photo&&<div className='flex items-start gap-3 rounded-xl border border-line p-2'>
                    <img src={photo.url} alt='Selected Gemba observation' className='max-h-48 w-36 rounded-xl object-contain'/>
                    <button type='button' onClick={()=>setPhoto(null)} className='min-h-11 text-xs font-semibold text-red-500'>Remove photo</button>
                </div>}
                <p className='text-xs text-muted'>A description, a photo, or both. Each Save & next adds one observation and immediately prepares the next.</p>
            </div>
            <footer className='shrink-0 space-y-2 border-t border-line bg-panel px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6'>
                <Button disabled={busy||uploading||(!description.trim()&&!photo)||!assetTag} busy={busy} className='w-full min-h-14'
                    onClick={()=>{void add()}}><Plus className='h-5 w-5'/> Save & next observation</Button>
                <button type='button' disabled={busy||uploading} onClick={()=>{void saveDraft().then(ok=>{if(ok)setCaptureMode(false)})}}
                    className='min-h-11 w-full rounded-xl border border-line text-xs font-semibold text-brand'>
                    Finish capturing · review observations
                </button>
            </footer>
        </section>
    );
    return (
        <div className='space-y-4'>
            <button type='button' onClick={() => leaveQuick('organization_home/quick/gemba')} className='flex h-10 items-center gap-2 text-sm font-medium text-brand'>
                <ArrowLeft className='h-4 w-4' /> All Gembas
            </button>
            <Card className='space-y-2'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <h2 className='font-semibold text-ink'>{gemba.name}</h2>
                    <span className='rounded-full border border-line px-3 py-1 text-xs text-brand'>{gemba.status === 'closed' ? 'Closed · Review' : 'Open · Recording'}</span>
                </div>
                <p className='text-xs text-muted'>{gemba.typeName} · {gemba.assetTags.length} selected assets · {items.length} observations</p>
                {gemba.status === 'closed' && <p className='text-xs text-muted'>{completed} of {items.length} observations reviewed</p>}
            </Card>
            {gemba.status === 'open' && <Button onClick={()=>setCaptureMode(true)} className='w-full'><Plus className='h-4 w-4'/> Add observation · full screen</Button>}
            {error && <Alert tone='error'>{error}</Alert>}
            {info && <Alert tone='success'>{info}</Alert>}
            <section className='space-y-2'>
                <h3 className='text-sm font-semibold text-ink'>{gemba.status === 'closed' ? 'Review observations' : 'Recorded observations'}</h3>
                {items.length === 0 && <p className='text-sm text-muted'>Observations will appear here as you save them.</p>}
                {items.map((o, index) => (
                    <Card key={o.id} className='space-y-2'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <p className='font-semibold text-ink'>{index + 1}. {o.assetName || o.assetTag}</p>
                            <span className='rounded-full border border-line px-2 py-1 text-xs text-muted'>
                                {o.reviewStatus === 'pending' ? 'Awaiting review' : o.reviewStatus === 'closed' ? 'Closed' : 'Work request created'}
                            </span>
                        </div>
                        {o.description && <p className='whitespace-pre-wrap text-sm text-soft'>{o.description}</p>}
                        {o.photoUrl && <img src={o.photoUrl} alt={'Observation ' + (index + 1)} loading='lazy' className='max-h-64 w-full rounded-xl object-contain' />}
                        {o.reviewStatus === 'closed' && <p className='text-xs text-muted'>Reason: {o.closureReason}</p>}
                        {o.workRequestCode && <button type='button' onClick={() => navigate('organization_home/work_requests/' + o.workRequestCode)}
                            className='text-sm font-semibold text-brand'>View {o.workRequestCode} →</button>}
                        {gemba.status === 'closed' && o.reviewStatus === 'pending' && (
                            <div className='grid grid-cols-2 gap-2'>
                                <Button variant='secondary' onClick={() => { void chooseReview(o, 'close'); }}>Close with reason</Button>
                                <Button onClick={() => { void chooseReview(o, 'wr'); }}><Wrench className='h-4 w-4' /> Work request</Button>
                            </div>
                        )}
                        {reviewId === o.id && reviewMode === 'close' && (
                            <div className='space-y-2 rounded-xl border border-line bg-page p-3'>
                                <label className='block text-xs font-semibold text-muted'>Reason for closure
                                    <textarea maxLength={1400} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                                        className={field + ' mt-1 resize-y'} placeholder='Explain why no work request is necessary.' />
                                </label>
                                <Button disabled={busy || reason.trim().length < 5} busy={busy} onClick={() => { void resolve(); }}>Confirm closure</Button>
                            </div>
                        )}
                        {reviewId === o.id && reviewMode === 'wr' && (
                            <div className='space-y-3 rounded-xl border border-line bg-page p-3'>
                                <p className='text-sm font-semibold text-ink'>First select the asset assembly</p>
                                <p className='text-xs text-muted'>Only assemblies you are authorized to raise a maintenance work request against are shown.</p>
                                <label className='block text-xs font-semibold text-muted'>Assembly
                                    <select value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} className={field + ' mt-1'}>
                                        <option value=''>Choose assembly</option>
                                        {assemblies.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name} · {a.unitName}</option>)}
                                    </select>
                                </label>
                                {!assemblies.length && <p className='text-xs text-muted'>No eligible assemblies were found. Ensure Maintenance is enabled and your role can create work requests at this asset.</p>}
                                <Button disabled={!assemblyId} onClick={startRequest}>
                                    <Send className='h-4 w-4' /> Continue to work request
                                </Button>
                            </div>
                        )}
                    </Card>
                ))}
            </section>
        </div>
    );
}
