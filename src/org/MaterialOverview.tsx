import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { Camera, ChevronLeft, ChevronRight, FileImage, ImagePlus, Loader2, MapPin, Star, Tag, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Badge } from '../admin/kit';
import { messageOf, type ConfirmOptions } from '../components/screen';
import { Alert } from '../components/ui';

// Material overview (Inventory › material detail): photo gallery taken on the phone, identity, stock health and key
// facts. Long texts (descriptions, bin codes, supplier names) are clamped or wrapped so nothing overflows the screen.

export interface MaterialPhoto {
    id: string;
    url: string;
    uploadedAt: string;
    uploadedByName: string;
    cover: boolean;
}

type Ask = (options: ConfirmOptions, run: (reason: string) => Promise<void>) => void;

export interface OverviewProps {
    id: string;
    warehouseId: string;
    warehouseName: string;
    materialNumber: string;
    description: string;
    categoryLabel: string;
    status: string;
    photos: MaterialPhoto[];
    canPhoto: boolean;
    available: number | null;
    minimum: number | null;
    maximum: number | null;
    safety: number | null;
    facts: Array<{ label: string; value: string; mono?: boolean; hint?: string }>;
    chips: Array<{ label: string; tone: 'brand' | 'muted' | 'warn' | 'danger' }>;
    ask: Ask;
    onOpen: (tab: 'Current Status' | 'Stock Control' | 'Replenishment') => void;
}

const MAX_PHOTOS = 8;
const MAX_CHARS = 1_900_000;

/** Phone photos are several MB: scale to at most 1600 px and re-encode as JPEG until it fits the 1.4 MB limit. */
async function photoData(file: File): Promise<string> {
    if (file.type && !file.type.startsWith('image/')) throw new Error(`${file.name}: choose a photo.`);
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error(`${file.name}: this photo format cannot be opened here. Use JPEG or PNG.`));
            el.src = url;
        });
        let scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        for (let attempt = 0; attempt < 6; attempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            const g = canvas.getContext('2d');
            if (!g) break;
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.drawImage(img, 0, 0, canvas.width, canvas.height);
            const out = canvas.toDataURL('image/jpeg', attempt < 3 ? 0.85 - attempt * 0.1 : 0.55);
            if (out.length <= MAX_CHARS) return out;
            scale *= 0.8;
        }
        throw new Error(`${file.name}: the photo is too large even after reducing it.`);
    } finally {
        URL.revokeObjectURL(url);
    }
}

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 3 }));

function health(available: number | null, min: number | null, max: number | null): { label: string; tone: 'brand' | 'warn' | 'danger' | 'muted' } {
    if (available === null) return { label: 'Not reconciled', tone: 'muted' };
    if (min !== null && available < min) return { label: 'Below minimum', tone: 'danger' };
    if (max !== null && available > max) return { label: 'Above maximum', tone: 'warn' };
    if (min === null && max === null) return { label: 'No min / max', tone: 'muted' };
    return { label: 'Within target', tone: 'brand' };
}

/** Bar from 0 to a little above the maximum: the target band (min–max) and a marker for available stock. */
function LevelBar({ available, min, max }: { available: number | null; min: number | null; max: number | null }) {
    if (max === null || max <= 0) return null;
    const top = Math.max(max * 1.25, available ?? 0, 1);
    const at = (v: number) => `${Math.min(100, Math.max(0, (v / top) * 100))}%`;
    return (
        <div className='mt-3' aria-hidden='true'>
            <div className='relative h-2.5 rounded-full bg-page ring-1 ring-line'>
                <div className='absolute inset-y-0 rounded-full bg-brand/25' style={{ left: at(min ?? 0), width: `calc(${at(max)} - ${at(min ?? 0)})` }} />
                {available !== null && <div className='absolute -top-1 w-1 -translate-x-1/2 rounded-full bg-ink' style={{ left: at(Math.max(0, available)), height: '1.125rem' }} />}
            </div>
            <div className='relative mt-1 h-4 text-[11px] tabular-nums text-muted'>
                <span className='absolute -translate-x-1/2' style={{ left: at(min ?? 0) }}>
                    {fmt(min ?? 0)}
                </span>
                <span className='absolute -translate-x-1/2' style={{ left: at(max) }}>
                    {fmt(max)}
                </span>
            </div>
        </div>
    );
}

function Viewer({
    photos,
    start,
    canPhoto,
    busy,
    onClose,
    onCover,
    onRemove,
}: {
    photos: MaterialPhoto[];
    start: number;
    canPhoto: boolean;
    busy: boolean;
    onClose: () => void;
    onCover: (p: MaterialPhoto) => void;
    onRemove: (p: MaterialPhoto) => void;
}) {
    const [i, setI] = useState(Math.min(start, photos.length - 1));
    const touch = useRef<number | null>(null);
    useEffect(() => setI((x) => Math.min(x, photos.length - 1)), [photos.length]);
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') setI((x) => Math.min(photos.length - 1, x + 1));
            if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [photos.length, onClose]);
    const p = photos[i];
    if (!p) return null;
    const swipe = (e: TouchEvent) => {
        const start = touch.current;
        touch.current = null;
        if (start === null) return;
        const dx = e.changedTouches[0].clientX - start;
        if (dx < -40) setI((x) => Math.min(photos.length - 1, x + 1));
        if (dx > 40) setI((x) => Math.max(0, x - 1));
    };
    const iconBtn = 'flex h-11 w-11 items-center justify-center rounded-full bg-[#000000]/50 text-[#ffffff] active:bg-[#000000]/70';
    return (
        <div role='dialog' aria-modal='true' aria-label='Material photos' className='fixed inset-0 z-50 flex flex-col bg-[#000000]'>
            <div className='flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-[#ffffff]'>
                <button type='button' aria-label='Close' onClick={onClose} className={iconBtn}>
                    <X className='h-5 w-5' />
                </button>
                <div className='min-w-0 flex-1 text-sm'>
                    <p className='font-semibold'>
                        {i + 1} of {photos.length}
                        {p.cover ? ' · Cover photo' : ''}
                    </p>
                    <p className='truncate text-xs opacity-75'>
                        {p.uploadedByName || 'Unknown'} · {p.uploadedAt ? new Date(p.uploadedAt).toLocaleDateString() : ''}
                    </p>
                </div>
            </div>
            <div className='relative min-h-0 flex-1' onTouchStart={(e) => (touch.current = e.touches[0].clientX)} onTouchEnd={swipe}>
                <img src={p.url} alt={`Photo ${i + 1}`} className='absolute inset-0 h-full w-full object-contain' />
                {i > 0 && (
                    <button type='button' aria-label='Previous photo' onClick={() => setI(i - 1)} className={`${iconBtn} absolute left-3 top-1/2 -translate-y-1/2`}>
                        <ChevronLeft className='h-6 w-6' />
                    </button>
                )}
                {i < photos.length - 1 && (
                    <button type='button' aria-label='Next photo' onClick={() => setI(i + 1)} className={`${iconBtn} absolute right-3 top-1/2 -translate-y-1/2`}>
                        <ChevronRight className='h-6 w-6' />
                    </button>
                )}
            </div>
            {canPhoto && (
                <div className='grid grid-cols-2 gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
                    <button type='button' disabled={busy || p.cover} onClick={() => onCover(p)} className='flex h-12 items-center justify-center gap-2 rounded-xl bg-[#ffffff]/10 text-sm font-semibold text-[#ffffff] disabled:opacity-40'>
                        <Star className='h-4 w-4' />
                        {p.cover ? 'Cover photo' : 'Set as cover'}
                    </button>
                    <button type='button' disabled={busy} onClick={() => onRemove(p)} className='flex h-12 items-center justify-center gap-2 rounded-xl bg-red-600/80 text-sm font-semibold text-[#ffffff] disabled:opacity-40'>
                        <Trash2 className='h-4 w-4' />
                        Remove
                    </button>
                </div>
            )}
        </div>
    );
}

export default function MaterialOverview(props: OverviewProps) {
    const { id, warehouseId, ask } = props;
    const [photos, setPhotos] = useState<MaterialPhoto[]>(props.photos);
    const [viewing, setViewing] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState(false);
    const camera = useRef<HTMLInputElement>(null);
    const gallery = useRef<HTMLInputElement>(null);
    useEffect(() => setPhotos(props.photos), [props.photos]);

    const add = async (files: FileList | null) => {
        const list = Array.from(files ?? []).slice(0, Math.max(0, MAX_PHOTOS - photos.length));
        if (!list.length) {
            if (files?.length) setError(`A material can have at most ${MAX_PHOTOS} photos. Remove one first.`);
            return;
        }
        setBusy(true);
        setError('');
        try {
            for (const file of list) {
                const data = await photoData(file);
                const res = await callBackend<{ photos: MaterialPhoto[] }>('/api/org/inventory/material/photo/add', { id, warehouseId, data });
                setPhotos(res.photos);
            }
        } catch (err) {
            setError(messageOf(err));
        } finally {
            setBusy(false);
        }
    };
    const setCover = async (p: MaterialPhoto) => {
        setBusy(true);
        setError('');
        try {
            const res = await callBackend<{ photos: MaterialPhoto[] }>('/api/org/inventory/material/photo/cover', { id, warehouseId, photoId: p.id });
            setPhotos(res.photos);
            setViewing(0);
        } catch (err) {
            setError(messageOf(err));
        } finally {
            setBusy(false);
        }
    };
    const remove = (p: MaterialPhoto) =>
        ask(
            {
                title: 'Remove photo',
                message: 'The photo is removed from this material in every warehouse. It is kept in the audit record with your reason.',
                confirmLabel: 'Remove photo',
                tone: 'danger',
                reason: { label: 'Reason for removing', minLength: 5, placeholder: 'For example: blurred, wrong part' },
            },
            async (reason) => {
                const res = await callBackend<{ photos: MaterialPhoto[] }>('/api/org/inventory/material/photo/remove', { id, warehouseId, photoId: p.id, reason });
                setPhotos(res.photos);
                setViewing(res.photos.length ? 0 : null);
            },
        );

    const cover = photos[0];
    const h = health(props.available, props.minimum, props.maximum);
    const room = photos.length < MAX_PHOTOS;
    const pickers = (
        <>
            <input ref={camera} type='file' accept='image/*' capture='environment' className='hidden' onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
            <input ref={gallery} type='file' accept='image/*' multiple className='hidden' onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
        </>
    );

    return (
        <div className='space-y-3'>
            {/* Photo + identity */}
            <section className='overflow-hidden rounded-2xl border border-line bg-panel lg:grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]'>
                {pickers}
                <div className='min-w-0 lg:border-r lg:border-line lg:pb-3'>
                <div className='relative aspect-[16/10] max-h-72 w-full bg-page sm:aspect-[21/9] lg:aspect-[4/3] lg:max-h-none'>
                    {cover ? (
                        <button type='button' aria-label='Open photos' onClick={() => setViewing(0)} className='absolute inset-0 h-full w-full'>
                            <img src={cover.url} alt={`${props.materialNumber} cover photo`} className='h-full w-full object-cover' />
                        </button>
                    ) : (
                        <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center'>
                            <span className='flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brandsoft'>
                                <Camera className='h-7 w-7' />
                            </span>
                            <p className='text-sm text-muted'>{props.canPhoto ? 'No photo yet. Take one with your phone or choose from the gallery.' : 'No photo of this material yet.'}</p>
                            {props.canPhoto && (
                                <div className='flex gap-2'>
                                    <button type='button' disabled={busy} onClick={() => camera.current?.click()} className='flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-50'>
                                        {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : <Camera className='h-4 w-4' />}
                                        Take photo
                                    </button>
                                    <button type='button' disabled={busy} onClick={() => gallery.current?.click()} className='flex h-11 items-center gap-2 rounded-xl border border-line bg-panel px-4 text-sm font-semibold text-ink disabled:opacity-50'>
                                        <FileImage className='h-4 w-4' />
                                        Gallery
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {cover && (
                        <div className='pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-[#000000]/60 to-transparent p-3'>
                            <span className='rounded-full bg-[#000000]/55 px-2.5 py-1 text-xs font-medium text-[#ffffff]'>
                                <FileImage className='mr-1 inline h-3.5 w-3.5 align-[-2px]' />
                                {photos.length} photo{photos.length === 1 ? '' : 's'}
                            </span>
                            {props.canPhoto && room && (
                                <span className='pointer-events-auto flex gap-2'>
                                    <button type='button' aria-label='Take photo' disabled={busy} onClick={() => camera.current?.click()} className='flex h-11 w-11 items-center justify-center rounded-full bg-[#000000]/55 text-[#ffffff] disabled:opacity-50'>
                                        {busy ? <Loader2 className='h-5 w-5 animate-spin' /> : <Camera className='h-5 w-5' />}
                                    </button>
                                    <button type='button' aria-label='Add from gallery' disabled={busy} onClick={() => gallery.current?.click()} className='flex h-11 w-11 items-center justify-center rounded-full bg-[#000000]/55 text-[#ffffff] disabled:opacity-50'>
                                        <ImagePlus className='h-5 w-5' />
                                    </button>
                                </span>
                            )}
                        </div>
                    )}
                </div>
                {photos.length > 1 && (
                    <div className='flex gap-2 overflow-x-auto px-3 pt-3' aria-label='All photos'>
                        {photos.map((p, i) => (
                            <button key={p.id} type='button' aria-label={`Photo ${i + 1}`} onClick={() => setViewing(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 ${p.cover ? 'ring-brand' : 'ring-transparent'}`}>
                                <img src={p.url} alt='' className='h-full w-full object-cover' />
                            </button>
                        ))}
                    </div>
                )}
                </div>
                <div className='min-w-0 space-y-2 p-4'>
                    <div className='flex min-w-0 flex-wrap items-center gap-2'>
                        <span className='max-w-full truncate rounded-md bg-brand/10 px-2 py-0.5 font-mono text-xs font-semibold text-brandsoft'>{props.materialNumber}</span>
                        {props.status && <Badge tone={/approved|active/i.test(props.status) ? 'brand' : 'muted'}>{props.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</Badge>}
                    </div>
                    <div>
                        <h2 className={`break-words text-base font-semibold leading-snug text-ink ${expanded ? '' : 'line-clamp-2'}`}>{props.description}</h2>
                        {props.description.length > 70 && (
                            <button type='button' onClick={() => setExpanded((x) => !x)} className='mt-0.5 text-xs font-medium text-brandsoft'>
                                {expanded ? 'Show less' : 'Show full description'}
                            </button>
                        )}
                    </div>
                    <div className='space-y-0.5 text-xs text-muted'>
                        <p className='flex min-w-0 items-center gap-1'>
                            <MapPin className='h-3.5 w-3.5 shrink-0' />
                            <span className='truncate'>{props.warehouseName}</span>
                        </p>
                        {props.categoryLabel && (
                            <p className='flex min-w-0 items-center gap-1'>
                                <Tag className='h-3.5 w-3.5 shrink-0' />
                                <span className='truncate'>{props.categoryLabel}</span>
                            </p>
                        )}
                    </div>
                    {props.chips.length > 0 && (
                        <div className='flex flex-wrap gap-1.5 pt-1'>
                            {props.chips.map((c) => (
                                <Badge key={c.label} tone={c.tone}>
                                    {c.label}
                                </Badge>
                            ))}
                        </div>
                    )}
                    {error && <Alert tone='error'>{error}</Alert>}
                </div>
            </section>

            <div className='grid gap-3 lg:grid-cols-2 lg:items-start'>
            {/* Stock health */}
            <button type='button' onClick={() => props.onOpen('Current Status')} className='block w-full rounded-2xl border border-line bg-panel p-4 text-left active:bg-page'>
                <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                        <p className='text-xs font-medium uppercase tracking-wide text-muted'>Available stock</p>
                        <p className='mt-0.5 truncate text-3xl font-semibold tabular-nums text-ink'>{props.available === null ? '—' : fmt(props.available)}</p>
                    </div>
                    <Badge tone={h.tone}>{h.label}</Badge>
                </div>
                <LevelBar available={props.available} min={props.minimum} max={props.maximum} />
                <dl className='mt-3 grid grid-cols-3 gap-2 text-center'>
                    {(
                        [
                            ['Minimum', props.minimum],
                            ['Maximum', props.maximum],
                            ['Safety', props.safety],
                        ] as Array<[string, number | null]>
                    ).map(([k, v]) => (
                        <div key={k} className='min-w-0 rounded-xl bg-page px-2 py-2'>
                            <dt className='text-[11px] text-muted'>{k}</dt>
                            <dd className='truncate text-sm font-semibold tabular-nums text-ink'>{v === null ? 'Not set' : fmt(v)}</dd>
                        </div>
                    ))}
                </dl>
            </button>

            {/* Key facts */}
            <section className='rounded-2xl border border-line bg-panel'>
                <h3 className='px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted'>Key facts</h3>
                <dl className='divide-y divide-line px-4'>
                    {props.facts.map((f) => (
                        <div key={f.label} className='grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-baseline gap-3 py-2.5'>
                            <dt className='text-sm text-muted'>{f.label}</dt>
                            <dd className={`min-w-0 break-words text-right text-sm font-medium text-ink ${f.mono ? 'break-all font-mono text-[13px]' : ''}`} title={f.value}>
                                {f.value}
                                {f.hint && <span className='block text-xs font-normal text-muted'>{f.hint}</span>}
                            </dd>
                        </div>
                    ))}
                </dl>
                <div className='grid grid-cols-2 gap-2 p-3'>
                    <button type='button' onClick={() => props.onOpen('Stock Control')} className='h-11 rounded-xl border border-line text-sm font-medium text-ink active:bg-page'>
                        Stock control
                    </button>
                    <button type='button' onClick={() => props.onOpen('Replenishment')} className='h-11 rounded-xl border border-line text-sm font-medium text-ink active:bg-page'>
                        Replenishment
                    </button>
                </div>
            </section>
            </div>

            {viewing !== null && photos.length > 0 && (
                <Viewer photos={photos} start={viewing} canPhoto={props.canPhoto} busy={busy} onClose={() => setViewing(null)} onCover={(p) => void setCover(p)} onRemove={remove} />
            )}
        </div>
    );
}
