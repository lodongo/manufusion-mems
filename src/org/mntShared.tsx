import { useState } from 'react';
import { Check, CheckCircle2, ChevronRight, Cog, Home, Layers, Search, Wrench, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Card, Spinner, useLoad } from '../admin/kit';

// Maintenance (MNT) building blocks shared by work requests and work orders.

export interface ListItem {
    code: string;
    label: string;
    color: string;
}
export interface ListGroup extends ListItem {
    items: ListItem[];
}

export interface MntLists {
    sources: ListGroup[];
    criticality: ListItem[];
    impacts: ListGroup[];
    failureModes: ListGroup[];
    maintenanceTypes: ListItem[];
    workTypes: ListItem[];
    priorities: ListItem[];
    disciplines: ListItem[];
    rootCauses: ListGroup[];
    solutions: ListGroup[];
    outcomes: ListItem[];
    verificationTypes: ListItem[];
    downtimeClasses: ListItem[];
    resourceTypes: ListItem[];
    executionLocations: ListItem[];
    hazards: string[];
    permits: string[];
    ppe: string[];
}

/** What the user may do somewhere in the organization (exact checks happen per record on the server). */
export interface MntSetup {
    enabled: boolean;
    can: Record<string, boolean>;
    lists: MntLists | null;
    currency: string;
}

export const money = (n: number, currency: string) => `${currency ? `${currency} ` : ''}${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function findIn(groups: ListGroup[], code: string) {
    for (const g of groups) for (const i of g.items) if (i.code === code) return { ...i, group: g.label };
    return null;
}

export interface LocNode {
    id: string;
    parentId: string;
    level: string;
    code: string;
    name: string;
    assetTag: string;
    inScope: boolean;
}
export interface Place {
    assembly: { id: string; code: string; name: string };
    unit: { id: string; code: string; name: string; equipmentClass: string; equipmentClassName: string } | null;
    costCenter: { id: string; code: string; name: string } | null;
    site: { id: string; code: string; name: string } | null;
    path: Array<{ id: string; level: string; code: string; name: string }>;
    assets: Array<{ tag: string; name: string; className: string; classCode: string; status: string; linked: boolean }>;
    linkedTag: string;
}

export const LEVEL_LABEL: Record<string, string> = { group: 'Group', legal_entity: 'Legal entity', site: 'Site', department: 'Department', cost_center: 'Cost center', work_center: 'Equipment unit', equipment: 'Equipment', assembly: 'Assembly' };
const CRIT_FALLBACK = ['#dc2626', '#ea580c', '#d97706', '#16a34a', '#64748b'];
export const critColor = (code: string, color: string, list?: ListItem[]) => color || CRIT_FALLBACK[Math.max(0, list?.findIndex((c) => c.code === code) ?? 0)] || '#64748b';

export async function compressPhoto(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('Choose a photo.');
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error('This photo format cannot be read. Take the photo again or use JPEG.');
    }
    const encode = (maxSide: number, quality: number) =>
        new Promise<Blob>((resolve, reject) => {
            const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Could not process the photo.'));
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', quality);
        });
    let blob = await encode(1600, 0.82);
    if (blob.size > 1_300_000) blob = await encode(1200, 0.7);
    if (blob.size > 1_400_000) throw new Error('The photo is too large.');
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not read the photo.'));
        reader.readAsDataURL(blob);
    });
}

/** Two-tap picker for grouped lists: choose the group (chips), then the item (big buttons). */
export function GroupPicker({ title, groups, selected, onToggle, multi = false, collapsed = false }: { title: string; groups: ListGroup[]; selected: string[]; onToggle: (code: string) => void; multi?: boolean; collapsed?: boolean }) {
    const groupOf = (code: string) => groups.find((g) => g.items.some((i) => i.code === code))?.code ?? '';
    const [open, setOpen] = useState(!collapsed || selected.length > 0);
    const [group, setGroup] = useState(selected[0] ? groupOf(selected[0]) : '');
    const [q, setQ] = useState('');
    const all = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
    const chosen = all.filter((i) => selected.includes(i.code));
    const term = q.trim().toLowerCase();
    const matches = term ? all.filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(term)).slice(0, 30) : [];
    const current = groups.find((g) => g.code === group);

    if (!open)
        return (
            <button type='button' onClick={() => setOpen(true)} className='w-full rounded-2xl border border-dashed border-slate-700 p-3 text-left text-sm text-slate-300'>
                + {title}
            </button>
        );

    const itemButton = (i: ListItem & { group?: string }) => {
        const on = selected.includes(i.code);
        return (
            <button key={i.code} type='button' onClick={() => onToggle(i.code)} className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${on ? 'border-emerald-400 bg-emerald-500/15 text-white' : 'border-slate-700 text-slate-200 active:bg-slate-800'}`}>
                {multi ? <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600'}`}>{on && <Check className='h-3.5 w-3.5 text-white' />}</span> : null}
                <span className='min-w-0 flex-1'>
                    {i.label}
                    {i.group && <span className='block text-xs text-slate-500'>{i.group}</span>}
                </span>
                {!multi && on && <CheckCircle2 className='h-5 w-5 shrink-0 text-emerald-400' />}
            </button>
        );
    };

    return (
        <Card className='space-y-3'>
            <p className='text-sm font-medium text-slate-200'>{title}</p>
            {chosen.length > 0 && (
                <div className='flex flex-wrap gap-1'>
                    {chosen.map((c) => (
                        <button key={c.code} type='button' onClick={() => onToggle(c.code)} className='flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200 ring-1 ring-emerald-500/40'>
                            {c.group} · {c.label}
                            <X className='h-3 w-3' />
                        </button>
                    ))}
                </div>
            )}
            <div className='relative'>
                <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500' />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search…' className='h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white' />
            </div>
            {term ? (
                <div className='grid gap-2 sm:grid-cols-2'>{matches.length ? matches.map(itemButton) : <p className='text-xs text-slate-500'>Nothing matches.</p>}</div>
            ) : (
                <>
                    <div className='flex gap-2 overflow-x-auto pb-1'>
                        {groups.map((g) => {
                            const count = g.items.filter((i) => selected.includes(i.code)).length;
                            return (
                                <button key={g.code} type='button' onClick={() => setGroup(g.code === group ? '' : g.code)} className={`shrink-0 rounded-full px-3 py-2 text-xs ${g.code === group ? 'bg-emerald-500 text-onbrand' : 'bg-slate-800 text-slate-300'}`}>
                                    {g.label}
                                    {count ? ` (${count})` : ''}
                                </button>
                            );
                        })}
                    </div>
                    {current ? <div className='grid gap-2 sm:grid-cols-2'>{current.items.map(itemButton)}</div> : <p className='text-xs text-slate-500'>Choose a group above, or search.</p>}
                </>
            )}
        </Card>
    );
}

/** Drill down the organization design to an assembly, or search assemblies directly. */
export function AssemblyPicker({ selected, onPick, purpose = 'wr' }: { selected?: string; onPick: (id: string) => void; purpose?: 'wr' | 'wo' }) {
    const { data, error, loading } = useLoad(() => callBackend<{ nodes: LocNode[] }>('/api/org/mnt/locations', { purpose }), [purpose]);
    const [at, setAt] = useState('root');
    const [q, setQ] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load your locations.'}</Alert>;
    const nodes = data.nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const roots = nodes.filter((n) => !byId.has(n.parentId));
    const children = at === 'root' ? roots : nodes.filter((n) => n.parentId === at);
    const trail: LocNode[] = [];
    for (let cur = byId.get(at); cur; cur = byId.get(cur.parentId)) trail.unshift(cur);
    const assemblies = nodes.filter((n) => n.level === 'assembly' && n.inScope);
    const label = (n: LocNode) => {
        const parent = byId.get(n.parentId);
        return parent ? `${parent.code} ${parent.name}` : '';
    };
    const term = q.trim().toLowerCase();
    const hits = term ? assemblies.filter((a) => `${a.code} ${a.name} ${label(a)}`.toLowerCase().includes(term)).slice(0, 40) : [];
    const countAssemblies = (id: string): number => nodes.filter((n) => n.parentId === id).reduce((s, n) => s + (n.level === 'assembly' ? 1 : countAssemblies(n.id)), 0);

    if (!assemblies.length)
        return (
            <Card>
                <p className='text-sm text-amber-300'>There are no assemblies where your job roles allow this. Assemblies are added under equipment units in Organization design, and rights come from your job roles.</p>
            </Card>
        );

    return (
        <div className='space-y-3'>
            <p className='text-sm text-slate-400'>Open the assembly. Go through your sites and equipment units, or search.</p>
            <div className='relative'>
                <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500' />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${assemblies.length} assemblies…`} className='h-12 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white' />
            </div>
            {term ? (
                <ul className='space-y-2'>
                    {hits.length ? (
                        hits.map((a) => (
                            <li key={a.id}>
                                <AssemblyButton node={a} sub={label(a)} selected={selected === a.id} onPick={onPick} />
                            </li>
                        ))
                    ) : (
                        <p className='text-xs text-slate-500'>No assembly matches.</p>
                    )}
                </ul>
            ) : (
                <>
                    <nav aria-label='Path' className='flex flex-wrap items-center gap-1 text-sm'>
                        <button type='button' onClick={() => setAt('root')} className='flex items-center gap-1 rounded-lg px-2 py-1 text-emerald-300'>
                            <Home className='h-4 w-4' />
                            All
                        </button>
                        {trail.map((n, i) => (
                            <span key={n.id} className='flex items-center gap-1'>
                                <ChevronRight className='h-3.5 w-3.5 text-slate-600' />
                                <button type='button' onClick={() => setAt(n.id)} className={`rounded-lg px-2 py-1 font-mono text-xs ${i === trail.length - 1 ? 'bg-slate-800 text-white' : 'text-emerald-300'}`}>
                                    {n.code}
                                </button>
                            </span>
                        ))}
                    </nav>
                    <ul className='space-y-2'>
                        {children.map((n) =>
                            n.level === 'assembly' ? (
                                n.inScope && (
                                    <li key={n.id}>
                                        <AssemblyButton node={n} sub='Assembly' selected={selected === n.id} onPick={onPick} />
                                    </li>
                                )
                            ) : (
                                <li key={n.id}>
                                    <button type='button' onClick={() => setAt(n.id)} className='flex w-full items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-left active:bg-slate-800'>
                                        {n.level === 'work_center' || n.level === 'equipment' ? <Cog className='h-5 w-5 shrink-0 text-amber-400' /> : <Layers className='h-5 w-5 shrink-0 text-emerald-400' />}
                                        <span className='min-w-0 flex-1'>
                                            <span className='block truncate text-sm text-white'>{n.name}</span>
                                            <span className='block truncate text-xs text-slate-500'>
                                                <span className='font-mono'>{n.code}</span> · {LEVEL_LABEL[n.level] ?? n.level} · {countAssemblies(n.id)} assemblies
                                            </span>
                                        </span>
                                        <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                                    </button>
                                </li>
                            )
                        )}
                        {children.length === 0 && <p className='text-xs text-slate-500'>Nothing here.</p>}
                    </ul>
                </>
            )}
        </div>
    );
}

function AssemblyButton({ node, sub, selected, onPick }: { node: LocNode; sub: string; selected: boolean; onPick: (id: string) => void }) {
    return (
        <button type='button' onClick={() => onPick(node.id)} className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${selected ? 'border-emerald-400 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/5 active:bg-slate-800'}`}>
            <Wrench className='h-5 w-5 shrink-0 text-amber-300' />
            <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium text-white'>{node.name}</span>
                <span className='block truncate text-xs text-slate-400'>
                    <span className='font-mono'>{node.code}</span> · {sub}
                </span>
            </span>
            <span className='shrink-0 text-xs font-semibold text-amber-300'>Choose</span>
        </button>
    );
}

export function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className='grid grid-cols-[8.5rem_1fr] gap-2'>
            <span className='text-xs text-slate-500'>{label}</span>
            <span className='text-slate-200'>
                {value}
                {sub && <span className='block text-xs text-slate-500'>{sub}</span>}
            </span>
        </div>
    );
}
