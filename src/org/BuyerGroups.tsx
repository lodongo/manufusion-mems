import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Power, Save, Search, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, useConfirm } from '../components/screen';

// Buyer groups. A buyer group is a team of procurement people who handle the purchase requirements and quotations of
// the subcategories given to it. A subcategory belongs to one active group only, so it never appears in another
// group's choices. The master switch turns the whole function off: then anyone with procurement authority handles
// everything. Every change needs a reason, is versioned and is audited. The server enforces all of this.

const API = '/api/org/procurement/buyers';

type Kind = 'material' | 'service' | 'asset';
interface Member {
    uid: string;
    name: string;
    lead: boolean;
}
interface Scope {
    kind: Kind;
    categoryCode: string;
    subcategoryCode: string;
    categoryName: string;
    subcategoryName: string;
}
interface Group {
    id: string;
    number: string;
    name: string;
    description: string;
    active: boolean;
    version: number;
    members: Member[];
    scopeCount: number;
    share: number;
    byKind: Array<{ kind: Kind; label: string; count: number }>;
    scopes: Scope[];
    updatedAt: string;
}
interface Free {
    categoryCode: string;
    categoryName: string;
    subcategoryCode: string;
    subcategoryName: string;
}
interface Overview {
    enabled: boolean;
    version: number;
    updatedAt: string;
    canManage: boolean;
    groups: Group[];
    activeGroups: number;
    coverage: { total: number; assigned: number; pct: number; perKind: Array<{ kind: Kind; label: string; total: number; assigned: number; pct: number; unassigned: Free[] }> };
    users: Array<{ uid: string; name: string; email: string }>;
    mine: string[];
}
interface Available {
    kinds: Array<{ kind: Kind; label: string; categories: Array<{ code: string; name: string; subcategories: Array<{ code: string; name: string }> }> }>;
}

const keyOf = (kind: string, c: string, s: string) => `${kind}|${c}|${s}`;

function Bar({ pct, label }: { pct: number; label: string }) {
    const w = Math.max(0, Math.min(100, pct));
    return (
        <div role='progressbar' aria-label={label} aria-valuenow={w} aria-valuemin={0} aria-valuemax={100} className='h-2 w-full overflow-hidden rounded-full bg-page'>
            <div className='h-full rounded-full bg-brand' style={{ width: `${w}%` }} />
        </div>
    );
}

function Editor({ group, users, onClose, onSaved }: { group: Group | null; users: Overview['users']; onClose: () => void; onSaved: () => void }) {
    const avail = useLoad(() => callBackend<Available>(`${API}/available`, { id: group?.id ?? '' }), [group?.id]);
    const [name, setName] = useState(group?.name ?? '');
    const [description, setDescription] = useState(group?.description ?? '');
    const [members, setMembers] = useState<Member[]>(group?.members ?? []);
    const [picked, setPicked] = useState<Set<string>>(new Set((group?.scopes ?? []).map((s) => keyOf(s.kind, s.categoryCode, s.subcategoryCode))));
    const [person, setPerson] = useState('');
    const [q, setQ] = useState('');
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const confirm = useConfirm();

    const term = q.trim().toLowerCase();
    const nameErr = name.trim().length > 0 && name.trim().length < 3 ? 'Use at least 3 characters.' : '';
    const people = useMemo(() => users.filter((u) => !members.some((m) => m.uid === u.uid) && (!person.trim() || `${u.name} ${u.email}`.toLowerCase().includes(person.trim().toLowerCase()))).slice(0, 8), [users, members, person]);

    const toggle = (k: string, on: boolean) =>
        setPicked((cur) => {
            const next = new Set(cur);
            if (on) next.add(k);
            else next.delete(k);
            return next;
        });

    const valid = name.trim().length >= 3 && picked.size > 0 && members.length > 0;
    const save = () => {
        if (!avail.data) return;
        const scopes = avail.data.kinds.flatMap((k) => k.categories.flatMap((c) => c.subcategories.filter((s) => picked.has(keyOf(k.kind, c.code, s.code))).map((s) => ({ kind: k.kind, categoryCode: c.code, subcategoryCode: s.code }))));
        confirm.ask(
            {
                title: group ? `Save ${group.number}` : 'Create the buyer group',
                message: `${name.trim()} will handle ${scopes.length} subcategor${scopes.length === 1 ? 'y' : 'ies'} with ${members.length} member${members.length === 1 ? '' : 's'}. Those subcategories will not be available to any other buyer group.`,
                confirmLabel: group ? 'Save' : 'Create',
                reason: { label: 'Reason for this change', minLength: 10, placeholder: 'For example: spares and consumables now sit with the stores buyers' },
            },
            async (reason) => {
                await callBackend(`${API}/save`, { id: group?.id ?? '', expectedVersion: group?.version ?? 0, name: name.trim(), description: description.trim(), scopes, members, reason });
                onSaved();
            }
        );
    };

    return (
        <Screen
            title={group ? group.number : 'New buyer group'}
            eyebrow='Buyer group'
            subtitle={group ? group.name : 'Name, people and subcategories'}
            onBack={onClose}
            actions={
                <Button disabled={!valid || !avail.data} onClick={save}>
                    <Save className='mr-1 h-4 w-4' /> Save
                </Button>
            }
        >
            <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                <Field id='bg-name' label='Name' value={name} maxLength={60} error={nameErr} onChange={(e) => setName(e.target.value)} />
                <Field id='bg-desc' label='What this group buys (optional)' value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
            </section>

            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>People ({members.length})</h2>
                <p className='text-xs text-muted'>These people see and handle the requirements and quotations of this group&apos;s subcategories. They still need the procurement permissions to act.</p>
                {members.map((m) => (
                    <div key={m.uid} className='flex min-h-11 items-center gap-2 rounded-xl border border-line px-3'>
                        <span className='min-w-0 flex-1 truncate text-sm text-ink'>{m.name}</span>
                        <label className='flex min-h-11 items-center gap-1 text-xs text-soft'>
                            <input type='radio' name='bg-lead' checked={m.lead} onChange={() => setMembers(members.map((x) => ({ ...x, lead: x.uid === m.uid })))} className='h-4 w-4 accent-emerald-500' /> Lead
                        </label>
                        <button type='button' aria-label={`Remove ${m.name}`} onClick={() => setMembers(members.filter((x) => x.uid !== m.uid))} className='flex h-11 w-11 items-center justify-center text-red-400'>
                            <X className='h-4 w-4' />
                        </button>
                    </div>
                ))}
                <Field id='bg-person' label='Add a person' placeholder='Search by name or email' value={person} onChange={(e) => setPerson(e.target.value)} />
                {person.trim() !== '' &&
                    (people.length === 0 ? (
                        <p className='text-xs text-muted'>No one else matches.</p>
                    ) : (
                        <ul className='divide-y divide-line rounded-xl border border-line'>
                            {people.map((u) => (
                                <li key={u.uid}>
                                    <button
                                        type='button'
                                        onClick={() => {
                                            setMembers([...members, { uid: u.uid, name: u.name, lead: false }]);
                                            setPerson('');
                                        }}
                                        className='flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-ink active:bg-page'
                                    >
                                        <Plus className='h-4 w-4 shrink-0 text-brand' />
                                        <span className='min-w-0 flex-1 truncate'>{u.name}</span>
                                        <span className='truncate text-xs text-muted'>{u.email}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ))}
            </section>

            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 className='text-sm font-semibold text-ink'>Subcategories ({picked.size})</h2>
                </div>
                <p className='text-xs text-muted'>Only subcategories your organization has approved, and that no other buyer group holds, are shown.</p>
                <div className='relative'>
                    <Search className='pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted' />
                    <input aria-label='Search subcategories' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search' className='h-12 w-full rounded-xl border border-line bg-panel pl-9 pr-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none' />
                </div>
                {avail.loading && !avail.data ? (
                    <Spinner />
                ) : avail.error || !avail.data ? (
                    <Alert tone='error'>{avail.error || 'Could not load the subcategories.'}</Alert>
                ) : (
                    avail.data.kinds.map((k) => {
                        const cats = k.categories.filter((c) => !term || `${c.code} ${c.name}`.toLowerCase().includes(term) || c.subcategories.some((s) => `${s.code} ${s.name}`.toLowerCase().includes(term)));
                        if (!cats.length) return null;
                        return (
                            <div key={k.kind} className='space-y-1'>
                                <p className='pt-1 text-xs font-semibold uppercase tracking-wide text-muted'>{k.label}</p>
                                {cats.map((c) => {
                                    const id = `${k.kind}|${c.code}`;
                                    const subs = c.subcategories.filter((s) => !term || `${c.code} ${c.name} ${s.code} ${s.name}`.toLowerCase().includes(term));
                                    const chosen = c.subcategories.filter((s) => picked.has(keyOf(k.kind, c.code, s.code))).length;
                                    const isOpen = open[id] ?? !!term;
                                    return (
                                        <div key={id} className='rounded-xl border border-line'>
                                            <div className='flex min-h-11 items-center gap-1 pr-2'>
                                                <button type='button' aria-expanded={isOpen} onClick={() => setOpen({ ...open, [id]: !isOpen })} className='flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm text-ink'>
                                                    {isOpen ? <ChevronDown className='h-4 w-4 shrink-0' /> : <ChevronRight className='h-4 w-4 shrink-0' />}
                                                    <span className='min-w-0 flex-1 truncate'>{c.name}</span>
                                                    <Badge tone={chosen ? 'brand' : 'muted'}>{chosen}/{c.subcategories.length}</Badge>
                                                </button>
                                                <button
                                                    type='button'
                                                    onClick={() => setPicked((cur) => {
                                                        const next = new Set(cur);
                                                        const all = c.subcategories.every((s) => next.has(keyOf(k.kind, c.code, s.code)));
                                                        for (const s of c.subcategories) {
                                                            if (all) next.delete(keyOf(k.kind, c.code, s.code));
                                                            else next.add(keyOf(k.kind, c.code, s.code));
                                                        }
                                                        return next;
                                                    })}
                                                    className='min-h-11 px-2 text-xs text-brand'
                                                >
                                                    {chosen === c.subcategories.length ? 'Clear' : 'All'}
                                                </button>
                                            </div>
                                            {isOpen && (
                                                <ul className='divide-y divide-line border-t border-line'>
                                                    {subs.map((s) => {
                                                        const k2 = keyOf(k.kind, c.code, s.code);
                                                        return (
                                                            <li key={s.code}>
                                                                <label className='flex min-h-11 items-center gap-3 px-3 text-sm text-ink'>
                                                                    <input type='checkbox' checked={picked.has(k2)} onChange={(e) => toggle(k2, e.target.checked)} className='h-5 w-5 accent-emerald-500' />
                                                                    <span className='min-w-0 flex-1 truncate'>{s.name}</span>
                                                                    <span className='font-mono text-xs text-muted'>{s.code}</span>
                                                                </label>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })
                )}
            </section>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                {!valid && (
                    <div className='text-xs text-amber-300'>
                        <p className='font-semibold'>Still needed before you can save:</p>
                        <ul className='mt-1 list-disc space-y-0.5 pl-5'>
                            {name.trim().length < 3 && <li>A name of at least 3 characters</li>}
                            {members.length === 0 && <li>At least one person (use Add a person above)</li>}
                            {picked.size === 0 && <li>At least one subcategory</li>}
                            {!avail.data && <li>Wait for the subcategories to load</li>}
                        </ul>
                    </div>
                )}
                <Button className='w-full' disabled={!valid || !avail.data} onClick={save}>
                    <Save className='mr-1 h-4 w-4' /> {group ? 'Save changes' : 'Create buyer group'}
                </Button>
            </section>
            {confirm.sheet}
        </Screen>
    );
}

export function BuyerGroupsPanel() {
    const { data, error, loading, reload } = useLoad(() => callBackend<Overview>(`${API}/overview`));
    const [editing, setEditing] = useState<Group | 'new' | null>(null);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();
    useEffect(() => {
        if (notice) {
            const t = setTimeout(() => setNotice(''), 6000);
            return () => clearTimeout(t);
        }
    }, [notice]);

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'You do not have permission to view buyer groups.'}</Alert>;

    if (editing)
        return (
            <Editor
                group={editing === 'new' ? null : editing}
                users={data.users}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    setNotice('Saved. The change is recorded in the audit trail.');
                    reload();
                }}
            />
        );

    const toggleMaster = () =>
        confirm.ask(
            {
                title: data.enabled ? 'Switch buyer groups off' : 'Switch buyer groups on',
                message: data.enabled
                    ? 'Anyone with the procurement permission will handle every requirement and quotation. Groups and their members are kept and can be switched on again.'
                    : 'People will see and handle only the requirements and quotations of the subcategories in their buyer groups. Administrators still see everything.',
                confirmLabel: data.enabled ? 'Switch off' : 'Switch on',
                tone: data.enabled ? 'danger' : 'primary',
                reason: { label: 'Reason', minLength: 10 },
                acknowledge: data.enabled ? 'I understand that every procurement officer will then see all requirements.' : 'I understand that procurement officers outside a group will no longer see its requirements.',
            },
            async (reason) => {
                await callBackend(`${API}/toggle`, { enabled: !data.enabled, expectedVersion: data.version, reason });
                setNotice(data.enabled ? 'Buyer groups are off.' : 'Buyer groups are on.');
                reload();
            }
        );
    const toggleGroup = (g: Group) =>
        confirm.ask(
            {
                title: g.active ? `Switch off ${g.number}` : `Switch on ${g.number}`,
                message: g.active ? `${g.name} stops handling its subcategories. They become unassigned until another group takes them.` : `${g.name} takes back its subcategories, if they are still free.`,
                confirmLabel: g.active ? 'Switch off' : 'Switch on',
                tone: g.active ? 'danger' : 'primary',
                reason: { label: 'Reason', minLength: 10 },
            },
            async (reason) => {
                await callBackend(`${API}/active`, { id: g.id, active: !g.active, reason });
                reload();
            }
        );

    const cov = data.coverage;
    return (
        <div className='space-y-3'>
            {notice && <Alert tone='success'>{notice}</Alert>}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 className='text-sm font-semibold text-ink'>Buyer groups are {data.enabled ? 'on' : 'off'}</h2>
                    <Badge tone={data.enabled ? 'brand' : 'muted'}>{data.enabled ? 'On' : 'Off'}</Badge>
                </div>
                <p className='text-xs text-muted'>
                    {data.enabled
                        ? 'Each procurement officer sees and handles only the requirements, quotations and orders of the subcategories in their groups.'
                        : 'Anyone with authority to process procurement handles every requirement, quotation and order.'}
                </p>
                {data.updatedAt && <p className='text-xs text-muted'>Last changed {fmtDate(data.updatedAt)}.</p>}
                {data.canManage && (
                    <Button variant={data.enabled ? 'secondary' : 'primary'} onClick={toggleMaster}>
                        <Power className='mr-1 h-4 w-4' /> {data.enabled ? 'Switch off' : 'Switch on'}
                    </Button>
                )}
            </section>

            <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 className='text-sm font-semibold text-ink'>Allocation of subcategories</h2>
                    <span className='text-sm font-semibold text-ink'>{cov.pct}%</span>
                </div>
                <Bar pct={cov.pct} label='Subcategories given to a buyer group' />
                <p className='text-xs text-muted'>{cov.assigned} of {cov.total} approved subcategories belong to an active buyer group.</p>
                {cov.perKind.map((k) => (
                    <div key={k.kind} className='space-y-1'>
                        <div className='flex items-center justify-between text-xs text-soft'>
                            <span>{k.label}</span>
                            <span>{k.assigned}/{k.total} · {k.pct}%</span>
                        </div>
                        <Bar pct={k.pct} label={`${k.label} allocated`} />
                        {k.unassigned.length > 0 && (
                            <>
                                <button type='button' aria-expanded={!!open[`u-${k.kind}`]} onClick={() => setOpen({ ...open, [`u-${k.kind}`]: !open[`u-${k.kind}`] })} className='flex min-h-11 items-center gap-1 text-xs text-brand'>
                                    {open[`u-${k.kind}`] ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />} {k.total - k.assigned} not yet given to a group
                                </button>
                                {open[`u-${k.kind}`] && (
                                    <ul className='max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                                        {k.unassigned.map((s) => (
                                            <li key={`${s.categoryCode}|${s.subcategoryCode}`} className='px-3 py-2 text-xs'>
                                                <span className='text-ink'>{s.subcategoryName}</span> <span className='text-muted'>· {s.categoryName}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        )}
                    </div>
                ))}
                {data.enabled && cov.assigned < cov.total && <Alert tone='warn'>Requirements in a subcategory without a group can be handled only by administrators.</Alert>}
            </section>

            {data.canManage && (
                <Button onClick={() => setEditing('new')} className='w-full sm:w-auto'>
                    <Plus className='mr-1 h-4 w-4' /> New buyer group
                </Button>
            )}
            {data.groups.length === 0 && <p className='text-sm text-muted'>No buyer groups yet.</p>}
            {data.groups.map((g) => {
                const isOpen = !!open[g.id];
                return (
                    <section key={g.id} className={`space-y-2 rounded-2xl border bg-panel p-3 ${g.active ? 'border-line' : 'border-line opacity-70'}`}>
                        <div className='flex items-start gap-2'>
                            <div className='min-w-0 flex-1'>
                                <p className='font-mono text-xs text-brandsoft'>{g.number}</p>
                                <p className='truncate text-sm font-semibold text-ink'>{g.name}</p>
                                {g.description && <p className='text-xs text-muted'>{g.description}</p>}
                            </div>
                            <Badge tone={g.active ? 'brand' : 'muted'}>{g.active ? 'Active' : 'Off'}</Badge>
                            {data.mine.includes(g.id) && <Badge tone='brand'>You</Badge>}
                        </div>
                        <div className='flex items-center justify-between text-xs text-soft'>
                            <span>{g.scopeCount} subcategories · {g.members.length} people</span>
                            <span>{g.share}% of all</span>
                        </div>
                        <Bar pct={g.share} label={`${g.name} share`} />
                        <p className='text-xs text-muted'>{g.byKind.filter((k) => k.count).map((k) => `${k.label} ${k.count}`).join(' · ') || 'No subcategories'}</p>
                        <button type='button' aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.id]: !isOpen })} className='flex min-h-11 items-center gap-1 text-xs text-brand'>
                            {isOpen ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />} People and subcategories
                        </button>
                        {isOpen && (
                            <div className='space-y-2'>
                                <p className='text-xs text-soft'>{g.members.map((m) => `${m.name}${m.lead ? ' (lead)' : ''}`).join(', ') || 'No people'}</p>
                                <ul className='max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                                    {g.scopes.map((s) => (
                                        <li key={keyOf(s.kind, s.categoryCode, s.subcategoryCode)} className='px-3 py-2 text-xs'>
                                            <span className='text-ink'>{s.subcategoryName}</span> <span className='text-muted'>· {s.categoryName} · {s.kind}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {data.canManage && (
                            <div className='flex flex-wrap gap-2'>
                                <Button variant='secondary' onClick={() => setEditing(g)}>
                                    <Pencil className='mr-1 h-4 w-4' /> Edit
                                </Button>
                                <Button variant='secondary' onClick={() => toggleGroup(g)}>{g.active ? 'Switch off' : 'Switch on'}</Button>
                            </div>
                        )}
                    </section>
                );
            })}
            {confirm.sheet}
        </div>
    );
}

export default function BuyerGroups({ back }: { back: string }) {
    return (
        <Screen title='Buyer groups' subtitle='Who handles which subcategories' onBack={() => navigate(back)}>
            <BuyerGroupsPanel />
        </Screen>
    );
}
