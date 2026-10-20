import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, ClipboardCheck, ShieldCheck, Star, Clock3, Wrench, Boxes, UserCircle, Settings, Table2, Mail } from 'lucide-react';
import { defaultHomeLayout, type HomeKey, type HomeLayout, type HomeLayoutResponse } from '../lib/homeLayout';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Badge } from '../admin/kit';
import { hasPerm } from '../types';

// Organization user home: my work first.
//   Waiting for me, My requests / work orders, Favorites / Recent, Modules.
// Every block loads on its own and is left out when it fails or the person has no rights for it.

type Tone = 'brand' | 'muted' | 'danger' | 'warn';
interface WorkItem {
    key: string;
    title: string;
    sub?: string;
    badge?: string;
    tone?: Tone;
    path: string;
}
interface Shortcut {
    path: string;
    label: string;
    module: string;
}
export interface HomeModule {
    code: string;
    name: string;
    links: Array<{ label: string; path: string }>;
}

const SHOW = 5;
const DONE_WR = ['closed', 'cancelled', 'declined', 'converted', 'completed', 'rejected'];
const DONE_WO = ['closed', 'cancelled'];

// Which stock take states each right acts on (the server enforces the same rights).
const STOCK_ACTION: Record<string, { perm: string; label: string }> = {
    awaiting_print: { perm: 'INV_ST_010', label: 'Print the count sheet' },
    counting: { perm: 'INV_ST_017', label: 'Submit counts' },
    verification: { perm: 'INV_ST_020', label: 'Verify counts' },
    pending_post_approval: { perm: 'INV_ST_027', label: 'Approve posting' },
    approved_for_posting: { perm: 'INV_ST_028', label: 'Post to stock' },
};

function WorkGroup({ title, icon, items, loading, onOpen, empty, emphasise, limit = SHOW }: { title: string; icon: ReactNode; items: WorkItem[] | null; loading: boolean; onOpen: (path: string) => void; empty: string; emphasise?: boolean; limit?: number }) {
    if (!loading && (!items || items.length === 0)) return null;
    const list = items ?? [];
    return (
        <section className={`rounded-2xl border bg-panel p-4 ${emphasise && list.length ? 'border-brand' : 'border-line'}`}>
            <div className='mb-2 flex items-center justify-between gap-2'>
                <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'>
                    {icon} {title}
                </h2>
                {list.length > 0 && <Badge tone={emphasise ? 'warn' : 'muted'}>{list.length}</Badge>}
            </div>
            {loading && !items ? (
                <div className='space-y-2' aria-busy='true'>
                    <div className='h-11 animate-pulse rounded-xl bg-page' />
                    <div className='h-11 animate-pulse rounded-xl bg-page' />
                </div>
            ) : list.length === 0 ? (
                <p className='py-2 text-sm text-muted'>{empty}</p>
            ) : (
                <ul className='divide-y divide-line'>
                    {list.slice(0, limit).map((i) => (
                        <li key={i.key}>
                            <button type='button' onClick={() => onOpen(i.path)} className='flex min-h-12 w-full items-center gap-3 py-2 text-left'>
                                <span className='min-w-0 flex-1'>
                                    <span className='block truncate text-sm font-medium text-ink'>{i.title}</span>
                                    {i.sub && <span className='block truncate text-xs text-muted'>{i.sub}</span>}
                                </span>
                                {i.badge && <Badge tone={i.tone ?? 'muted'}>{i.badge}</Badge>}
                                <ChevronRight className='h-4 w-4 shrink-0 text-muted' />
                            </button>
                        </li>
                    ))}
                    {list.length > limit && <li className='py-2 text-xs text-muted'>and {list.length - limit} more</li>}
                </ul>
            )}
        </section>
    );
}

export default function OrgUserHome({
    userUid, firstName, roleName, permissions, needsVerification, email, modules, favorites, recent, favoritePaths, onOpen, onFavorite, onNavigate,
}: {
    userUid: string;
    firstName: string;
    roleName: string;
    permissions: string[];
    needsVerification: boolean;
    email: string;
    modules: HomeModule[];
    favorites: Shortcut[];
    recent: Shortcut[];
    favoritePaths: string[];
    onOpen: (path: string) => void;
    onFavorite: (path: string) => void;
    onNavigate: (route: string) => void;
}) {
    const [approvals, setApprovals] = useState<WorkItem[] | null>(null);
    const [review, setReview] = useState<WorkItem[] | null>(null);
    const [stock, setStock] = useState<WorkItem[] | null>(null);
    const [mine, setMine] = useState<WorkItem[] | null>(null);
    const [orders, setOrders] = useState<WorkItem[] | null>(null);
    const [passed, setPassed] = useState<WorkItem[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [layout, setLayout] = useState<HomeLayout>(defaultHomeLayout);
    const [savedTables, setSavedTables] = useState<Array<{ id: string; name: string; title: string }>>([]);
    const [mailPreview,setMailPreview]=useState<Array<{id:string;subject:string;fromName:string;fromEmail:string;priority:string;read:boolean;flagged:boolean;sentAt:string;updatedAt:string}>>([]);
    const [unreadMail,setUnreadMail]=useState(0);
    useEffect(() => {
        let alive = true;
        void Promise.all([
            callBackend<HomeLayoutResponse>('/api/org/home-layout/get').then((r) => {
                if (alive) setLayout(r.layout);
            }).catch(() => undefined),
            callBackend<{ items: Array<{ id: string; name: string; title: string }> }>('/api/org/my-tables/list').then((r) => {
                if (alive) setSavedTables(r.items);
            }).catch(() => undefined),
            callBackend<{items:Array<{id:string;subject:string;fromName:string;fromEmail:string;priority:string;read:boolean;flagged:boolean;folder:string;sentAt:string;updatedAt:string}>}>('/api/org/mail/list').then(r=>{
                if(alive){setUnreadMail(r.items.filter(m=>m.folder==='inbox'&&!m.read).length);setMailPreview(r.items.filter(m=>m.folder==='inbox'&&!m.read&&(m.priority==='high'||m.flagged)));}
            }).catch(()=>undefined),
        ]);
        return () => { alive = false; };
    }, [userUid]);
    const has = (p: string) => hasPerm(permissions, p);
    const hasMnt = permissions.includes('*') || permissions.some((p) => p.startsWith('MNT.'));
    const hasInv = permissions.includes('*') || permissions.some((p) => p.startsWith('INV'));

    useEffect(() => {
        let alive = true;
        let approvalList: WorkItem[] = [];
        const quiet = <T,>(path: string, body: Record<string, unknown> | undefined, ok: (r: T) => void) =>
            callBackend<T>(path, body).then((r) => alive && ok(r)).catch(() => undefined);

        void Promise.all([
            quiet<{ items: Array<{ id: string; type: string; label: string; name: string; isMine: boolean; canApprove: boolean; needsReconciliation?: boolean; submittedAt: string; creatorName: string }> }>('/api/org/procurement/workflows/inbox', undefined, (r) => {
                approvalList = r.items
                    .filter((x) => x.canApprove && !x.isMine)
                    .map((x) => ({ key: `${x.type}:${x.id}`, title: x.name || x.label, sub: `${x.label}${x.creatorName ? ` · from ${x.creatorName}` : ''}`, badge: x.needsReconciliation ? 'Reconcile' : 'Approve', tone: 'warn' as Tone, path: 'my_workflow' }));
                setApprovals(approvalList);
            }).then(async () => {
                // Add the key figures (amount, quantity, event) to what waits for me, and list what has passed through me.
                const [info, past] = await Promise.all([
                    callBackend<{ items: Array<{ key: string; details: Array<{ label: string; value: string }> }> }>('/api/org/workflows/describe', { items: approvalList.slice(0, 20).map((a) => { const [type, ...id] = a.key.split(':'); return { type, id: id.join(':') }; }) }).catch(() => null),
                    callBackend<{ items: Array<{ key: string; title: string; label: string; level: number; totalLevels: number; details: Array<{ label: string; value: string }> }> }>('/api/org/workflows/passed').catch(() => null),
                ]);
                if (!alive) return;
                if (info) {
                    const figures = new Map(info.items.map((t) => [t.key, t.details.slice(0, 2).map((d) => `${d.label}: ${d.value}`).join(' · ')]));
                    setApprovals((cur) => (cur ? cur.map((a) => (figures.get(a.key) ? { ...a, sub: figures.get(a.key) } : a)) : cur));
                }
                if (past) setPassed(past.items.map((t) => ({ key: t.key, title: t.title, sub: [t.label, ...t.details.slice(0, 2).map((d) => `${d.label}: ${d.value}`)].join(' · '), badge: `${t.level} of ${t.totalLevels}`, path: 'my_workflow' })));
            }),
            hasMnt
                ? Promise.all([
                      quiet<{ rows: Array<{ code: string; title: string; status: string; statusLabel: string }> }>('/api/org/mnt/wr/list', { view: 'mine' }, (r) =>
                          setMine(r.rows.filter((x) => !DONE_WR.includes(x.status)).map((x) => ({ key: x.code, title: x.title || x.code, sub: x.code, badge: x.statusLabel, path: `work_requests/${x.code}` })))
                      ),
                      quiet<{ rows: Array<{ code: string; title: string; status: string; statusLabel: string }> }>('/api/org/mnt/wr/list', { view: 'review' }, (r) =>
                          setReview(r.rows.map((x) => ({ key: x.code, title: x.title || x.code, sub: `${x.code} · to review`, badge: x.statusLabel, tone: 'warn' as Tone, path: `work_requests/${x.code}` })))
                      ),
                      quiet<{ rows: Array<{ code: string; title: string; status: string; statusLabel: string }> }>('/api/org/mnt/wo/list', { view: 'mine' }, (r) =>
                          setOrders(r.rows.filter((x) => !DONE_WO.includes(x.status)).map((x) => ({ key: x.code, title: x.title || x.code, sub: x.code, badge: x.statusLabel, path: `work_orders/${x.code}` })))
                      ),
                  ]).then(() => undefined)
                : Promise.resolve(),
            hasInv
                ? quiet<{ sessions: Array<{ id: string; piNumber: string; sessionName?: string; status: string }> }>('/api/org/inventory/stocktake/list', undefined, (r) =>
                      setStock(
                          r.sessions
                              .filter((s) => STOCK_ACTION[s.status] && has(STOCK_ACTION[s.status].perm))
                              .map((s) => ({ key: s.id, title: s.sessionName || s.piNumber, sub: s.piNumber, badge: STOCK_ACTION[s.status].label, tone: 'warn' as Tone, path: 'module/INV/feature/3' }))
                      )
                  )
                : Promise.resolve(),
        ]).finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const waiting = [...(approvals ?? []), ...(review ?? []), ...(stock ?? [])];
    const anyWaiting = loading || waiting.length > 0;
    const open = (path: string) => onOpen(path);

    const shortcutRow = (kind: 'fav' | 'recent', list: Shortcut[]) => list.length === 0 ? null : (
        <section className='rounded-2xl border border-line bg-panel p-4'>
            <h2 className='mb-2 flex items-center gap-2 text-sm font-semibold text-ink'>
                {kind === 'fav' ? <Star className='h-4 w-4' /> : <Clock3 className='h-4 w-4' />} {kind === 'fav' ? 'Favorites' : 'Recently opened'}
            </h2>
            {list.length === 0 ? (
                <p className='text-sm text-muted'>{kind === 'fav' ? 'Tap the star beside a workspace to pin it here.' : 'Workspaces you open will appear here.'}</p>
            ) : (
                <div className='flex gap-2 overflow-x-auto pb-1'>
                    {list.slice(0, 8).map((s) => (
                        <div key={s.path} className='flex min-w-[10rem] max-w-[14rem] shrink-0 items-center rounded-xl border border-line bg-page'>
                            <button type='button' onClick={() => open(s.path)} className='min-h-12 min-w-0 flex-1 px-3 py-2 text-left'>
                                <span className='block truncate text-sm font-semibold text-ink'>{s.label}</span>
                                <span className='block truncate text-xs text-muted'>{s.module}</span>
                            </button>
                            <button type='button' aria-label={favoritePaths.includes(s.path) ? 'Remove favorite' : 'Add favorite'} onClick={() => onFavorite(s.path)} className='flex h-11 w-9 items-center justify-center text-amber-500'>
                                <Star className='h-4 w-4' fill={favoritePaths.includes(s.path) ? 'currentColor' : 'none'} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );

    const rowLimit = (key: HomeKey) => layout.sizes[key] === 'compact' ? 2 : layout.sizes[key] === 'wide' ? 8 : SHOW;
    const showKey = (key: HomeKey): boolean => {
        if (layout.hidden.includes(key)) return false;
        switch (key) {
            case 'waiting': return loading || waiting.length > 0;
            case 'passed': return !loading && waiting.length === 0 && !!passed?.length;
            case 'requests': return hasMnt && (loading || !!mine?.length);
            case 'orders': return hasMnt && (loading || !!orders?.length);
            case 'favorites': return favorites.length > 0;
            case 'recent': return recent.length > 0;
            case 'my_tables': return savedTables.length > 0;
            case 'modules': return modules.length > 0;
            case 'quick_links': return true;
            default: return false;
        }
    };
    const cards: Record<HomeKey, ReactNode> = {
        waiting: <WorkGroup title='Waiting for me' icon={<ClipboardCheck className='h-4 w-4' />}
            items={loading ? null : waiting} loading={loading} onOpen={open} empty=''
            emphasise limit={rowLimit('waiting')} />,
        passed: <WorkGroup title='Passed through me, still open' icon={<ClipboardCheck className='h-4 w-4' />}
            items={passed} loading={false} onOpen={open} empty='' limit={rowLimit('passed')} />,
        requests: <WorkGroup title='My requests' icon={<Wrench className='h-4 w-4' />}
            items={mine} loading={loading && hasMnt} onOpen={open} empty='' limit={rowLimit('requests')} />,
        orders: <WorkGroup title='My work orders' icon={<Boxes className='h-4 w-4' />}
            items={orders} loading={loading && hasMnt} onOpen={open} empty='' limit={rowLimit('orders')} />,
        favorites: shortcutRow('fav', favorites),
        recent: shortcutRow('recent', recent),
        my_tables: (
            <section className='rounded-2xl border border-line bg-panel p-4'>
                <div className='mb-2 flex items-center justify-between gap-2'>
                    <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'>
                        <Table2 className='h-4 w-4' /> My Tables
                    </h2>
                    <span className='rounded-full bg-page px-2 py-0.5 text-xs text-muted'>{savedTables.length}</span>
                </div>
                <div className='space-y-1'>
                    {savedTables.slice(0, rowLimit('my_tables')).map((t) => (
                        <button key={t.id} type='button' onClick={() => onNavigate('organization_home/my_tables')}
                            className='flex w-full items-center justify-between gap-2 rounded-lg py-2 text-left text-sm text-ink'>
                            <span className='min-w-0 truncate'>{t.name}</span><ChevronRight className='h-4 w-4 shrink-0 text-muted' />
                        </button>
                    ))}
                    <button type='button' className='mt-2 text-sm font-semibold text-brand' onClick={() => onNavigate('organization_home/my_tables')}>
                        View all my tables →
                    </button>
                </div>
            </section>
        ),
        modules: (
            <section className='rounded-2xl border border-line bg-panel p-4'>
                <h2 className='mb-3 text-sm font-semibold text-ink'>My modules</h2>
                <div className='grid gap-2 sm:grid-cols-2'>
                    {modules.slice(0, layout.sizes.modules === 'compact' ? 3 : modules.length).map((m) => (
                        <div key={m.code} className='rounded-xl border border-line bg-page'>
                            <button type='button' onClick={() => open(`module/${m.code}`)}
                                className='flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left'>
                                <span className='min-w-0'>
                                    <span className='block truncate text-sm font-semibold text-ink'>{m.name}</span>
                                    <span className='font-mono text-[11px] text-muted'>{m.code}</span>
                                </span>
                                <ChevronRight className='h-4 w-4 shrink-0 text-muted' />
                            </button>
                            {layout.sizes.modules !== 'compact' && m.links.length > 0 && (
                                <div className='flex flex-wrap gap-1 border-t border-line p-2'>
                                    {m.links.slice(0, layout.sizes.modules === 'wide' ? 6 : 3).map((l) => (
                                        <button key={l.path} type='button' onClick={() => open(l.path)}
                                            className='min-h-11 rounded-lg bg-panel px-2 text-xs text-soft'>{l.label}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </section>
        ),
        quick_links: (
            <section className='grid gap-2 sm:grid-cols-2'>
                {[
                    { label: 'My access', sub: 'Roles and their rules', icon: <ShieldCheck className='h-4 w-4' />, route: 'organization_home/my_access' },
                    { label: 'My activity', sub: 'What I did recently', icon: <Clock3 className='h-4 w-4' />, route: 'organization_home/activity' },
                    { label: 'My details', sub: 'Profile and password', icon: <UserCircle className='h-4 w-4' />, route: 'organization_home/profile' },
                    { label: 'My setup', sub: 'Personal home and appearance', icon: <Settings className='h-4 w-4' />, route: 'organization_home/my_setup' },
                    { label: 'My Tables', sub: 'Saved table layouts', icon: <Table2 className='h-4 w-4' />, route: 'organization_home/my_tables' },
                ].slice(0, layout.sizes.quick_links === 'compact' ? 3 : 5).map((x) => (
                    <button key={x.label} type='button' onClick={() => onNavigate(x.route)}
                        className='flex min-h-14 items-center gap-3 rounded-xl border border-line bg-panel px-3 text-left'>
                        <span className='text-brandsoft'>{x.icon}</span>
                        <span className='min-w-0'>
                            <span className='block truncate text-sm font-semibold text-ink'>{x.label}</span>
                            <span className='block truncate text-xs text-muted'>{x.sub}</span>
                        </span>
                    </button>
                ))}
            </section>
        ),
    };
    return (
        <div className='space-y-4'>
            <section className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                    <p className='text-xs font-semibold uppercase tracking-wider text-brandsoft'>Organization workspace</p>
                    <h1 className='mt-1 text-2xl font-semibold text-ink'>Welcome, {firstName}</h1>
                    <p className='text-sm text-muted'>{roleName}</p>
                </div>
                <div className='flex items-center gap-1.5'>
                    {!!unreadMail && <span className={'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ' + (mailPreview.length ? 'bg-red-600 text-white' : 'bg-brand/10 text-brand')} title={mailPreview.length ? mailPreview.length+' critical unread email' : unreadMail+' unread email'}>{mailPreview.length || unreadMail > 99 ? (mailPreview.length > 99 || (!mailPreview.length && unreadMail > 99) ? '99+' : (mailPreview.length || unreadMail)) : unreadMail}</span>}
                    <button type='button' aria-label='Open internal Email' className='flex min-h-11 items-center gap-2 rounded-xl border border-line bg-panel px-3 text-xs font-semibold text-brand'
                        onClick={() => onNavigate('organization_home/mail')}>
                        <Mail className='h-5 w-5' /> Email
                    </button>
                </div>
            </section>
            {needsVerification && <Alert tone='info'>Please verify your email using the link sent to {email}.</Alert>}
            <div className='grid grid-cols-1 items-start gap-3 md:grid-cols-2'>
                {layout.order.filter(showKey).map((key) => (
                    <div key={key} className={layout.sizes[key] === 'wide' ? 'md:col-span-2' : ''}>
                        {cards[key]}
                    </div>
                ))}
            </div>
        </div>
    );
}
