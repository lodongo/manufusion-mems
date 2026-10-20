import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { fmtDate } from '../admin/format';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { Screen } from '../components/screen';
import { humanize, type OrgContextData } from './types';

// Organization admin home, in the order an administrator works:
//   Needs attention, Setup progress (until done), Access and security, Organization design, Usage.
// One summary request. The server sends each block only when the person holds the matching administration right.

interface Summary {
    users?: { total: number; active: number; disabled: number; superAdmins: number; neverSignedIn: number; inactive30: number; active7: number; rolesExpiring: number; rolesExpired: number; withoutJobRole: number };
    access?: { roles: number; withLeftovers: number; withConflicts: number; undocumented: number; docsOutdated: number; unused: number };
    design?: { units: number; sites: number; jobRoles: number; jobRolesWithoutSecurityRole: number; jobRolesWithFewSkills: number; shortCodes: number };
    workflows?: { configured: number; enabled: number };
    security?: { sample: number; since: string; denied24h: number; failed24h: number; events24h: number; recentDenied: Array<{ at: string; action: string; who: string; details: string }>; recentChanges: Array<{ at: string; action: string; target: string; who: string }> };
    usage?: { byArea: Array<{ area: string; count: number }> };
    setup?: { items: Array<{ key: string; label: string; done: boolean; path: string }>; modules: number };
}
interface Attention {
    key: string;
    text: string;
    tone: 'danger' | 'warn';
    path: string;
}

const ROLES = 'organization_admin/roles';

function Stat({ label, value, sub, onClick, warn }: { label: string; value: string | number; sub?: string; onClick?: () => void; warn?: boolean }) {
    return (
        <button type='button' onClick={onClick} disabled={!onClick} className={`rounded-2xl border bg-panel p-3 text-left disabled:cursor-default ${warn ? 'border-amber-500/60' : 'border-line'}`}>
            <p className='text-xs text-muted'>{label}</p>
            <p className='mt-0.5 text-xl font-semibold text-ink'>{value}</p>
            {sub && <p className='text-xs text-muted'>{sub}</p>}
        </button>
    );
}

function Block({ title, action, children }: { title: string; action?: { label: string; path: string }; children: ReactNode }) {
    return (
        <section className='space-y-2'>
            <div className='flex items-center justify-between'>
                <h2 className='text-sm font-semibold uppercase tracking-wide text-muted'>{title}</h2>
                {action && (
                    <button type='button' onClick={() => navigate(action.path)} className='min-h-11 text-sm text-brandsoft'>
                        {action.label}
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

export default function OrgOverview({ ctx }: { ctx: OrgContextData; hasBranding?: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Summary>('/api/org/home/admin'));
    const o = ctx.organization;

    const attention = useMemo<Attention[]>(() => {
        const out: Attention[] = [];
        if (!data) return out;
        const { users: u, access: a, design: d, security: s } = data;
        const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
        if (u?.rolesExpired) out.push({ key: 'exp', text: `${n(u.rolesExpired, 'person has', 'people have')} expired access`, tone: 'danger', path: 'organization_admin/users' });
        if (a?.withConflicts) out.push({ key: 'sod', text: `${n(a.withConflicts, 'role combines', 'roles combine')} duties that must stay apart`, tone: 'danger', path: `${ROLES}/review` });
        if (s?.denied24h) out.push({ key: 'den', text: `${n(s.denied24h, 'blocked action', 'blocked actions')} in the last 24 hours`, tone: 'warn', path: 'organization_admin/audit' });
        if (a?.withLeftovers) out.push({ key: 'left', text: `${n(a.withLeftovers, 'role holds', 'roles hold')} permissions that do nothing`, tone: 'warn', path: `${ROLES}/review` });
        if (u?.rolesExpiring) out.push({ key: 'soon', text: `${n(u.rolesExpiring, 'access ends', 'accesses end')} within 30 days`, tone: 'warn', path: 'organization_admin/users' });
        if (a?.undocumented) out.push({ key: 'doc', text: `${n(a.undocumented, 'role has', 'roles have')} no written rules`, tone: 'warn', path: ROLES });
        if (a?.docsOutdated) out.push({ key: 'docold', text: `${n(a.docsOutdated, 'role needs', 'roles need')} its rules reviewed`, tone: 'warn', path: ROLES });
        if (u?.withoutJobRole) out.push({ key: 'nojob', text: `${n(u.withoutJobRole, 'person has', 'people have')} no job role`, tone: 'warn', path: 'organization_admin/users' });
        if (d?.jobRolesWithoutSecurityRole) out.push({ key: 'nomap', text: `${n(d.jobRolesWithoutSecurityRole, 'job role has', 'job roles have')} no security role`, tone: 'warn', path: 'organization_admin/positions' });
        if (d?.shortCodes) out.push({ key: 'codes', text: `${n(d.shortCodes, 'job role uses', 'job roles use')} the old code format`, tone: 'warn', path: `${ROLES}/review` });
        if (u?.neverSignedIn) out.push({ key: 'never', text: `${n(u.neverSignedIn, 'person has', 'people have')} never signed in`, tone: 'warn', path: 'organization_admin/users' });
        return out;
    }, [data]);

    const setup = data?.setup;
    const remaining = setup ? setup.items.filter((i) => !i.done) : [];
    const percent = setup ? Math.round(((setup.items.length - remaining.length) / Math.max(1, setup.items.length)) * 100) : 100;

    return (
        <Screen
            title={o.name}
            eyebrow='Organization administration'
            subtitle={`Signed in as ${ctx.roleName}`}
            actions={
                <Button variant='secondary' onClick={reload} aria-label='Refresh'>
                    <RefreshCw className='h-4 w-4' />
                </Button>
            }
        >
            {loading && !data ? (
                <Spinner />
            ) : error ? (
                <Alert tone='error'>{error}</Alert>
            ) : data ? (
                <div className='space-y-5'>
                    <Block title='Needs attention'>
                        {attention.length === 0 ? (
                            <p className='flex items-center gap-2 rounded-2xl border border-line bg-panel p-4 text-sm text-soft'>
                                <CheckCircle2 className='h-5 w-5 text-emerald-500' /> Nothing needs your attention.
                            </p>
                        ) : (
                            <ul className='divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel'>
                                {attention.map((a) => (
                                    <li key={a.key}>
                                        <button type='button' onClick={() => navigate(a.path)} className='flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left'>
                                            <AlertTriangle className={`h-4 w-4 shrink-0 ${a.tone === 'danger' ? 'text-red-500' : 'text-amber-500'}`} />
                                            <span className='min-w-0 flex-1 text-sm text-ink'>{a.text}</span>
                                            <ChevronRight className='h-4 w-4 shrink-0 text-muted' />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Block>

                    {setup && remaining.length > 0 && (
                        <Block title='Setup progress'>
                            <div className='rounded-2xl border border-line bg-panel p-4'>
                                <div className='mb-3 flex items-center justify-between text-sm'>
                                    <span className='text-ink'>{setup.items.length - remaining.length} of {setup.items.length} done</span>
                                    <span className='text-muted'>{percent}%</span>
                                </div>
                                <div className='mb-3 h-2 overflow-hidden rounded-full bg-page' role='progressbar' aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label='Setup progress'>
                                    <div className='h-full rounded-full bg-brand' style={{ width: `${percent}%` }} />
                                </div>
                                <ul className='space-y-1'>
                                    {setup.items.map((i) => (
                                        <li key={i.key}>
                                            <button type='button' disabled={i.done} onClick={() => navigate(i.path)} className='flex min-h-11 w-full items-center gap-3 text-left text-sm disabled:cursor-default'>
                                                {i.done ? <CheckCircle2 className='h-5 w-5 shrink-0 text-emerald-500' /> : <Circle className='h-5 w-5 shrink-0 text-muted' />}
                                                <span className={i.done ? 'text-muted line-through' : 'text-ink'}>{i.label}</span>
                                                {!i.done && <ChevronRight className='ml-auto h-4 w-4 text-muted' />}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </Block>
                    )}

                    {(data.users || data.access) && (
                        <Block title='Access and security' action={data.access ? { label: 'Security roles', path: ROLES } : undefined}>
                            <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                                {data.users && <Stat label='People' value={data.users.total} sub={`${data.users.active7} active this week`} onClick={() => navigate('organization_admin/users')} />}
                                {data.users && <Stat label='Super admins' value={data.users.superAdmins} sub='Keep this small' onClick={() => navigate('organization_admin/users')} warn={data.users.superAdmins > 3} />}
                                {data.access && <Stat label='Security roles' value={data.access.roles} sub={`${data.access.unused} unused`} onClick={() => navigate(ROLES)} />}
                                {data.access && <Stat label='Roles with rules' value={`${data.access.roles - data.access.undocumented - data.access.docsOutdated} / ${data.access.roles}`} sub='Documented and current' onClick={() => navigate(ROLES)} warn={data.access.undocumented + data.access.docsOutdated > 0} />}
                                {data.users && <Stat label='Not seen for 30 days' value={data.users.inactive30} onClick={() => navigate('organization_admin/users')} />}
                                {data.users && <Stat label='Disabled' value={data.users.disabled} onClick={() => navigate('organization_admin/users')} />}
                                {data.workflows && <Stat label='Approval workflows' value={`${data.workflows.enabled} / ${data.workflows.configured}`} sub='enabled' onClick={() => navigate('organization_admin/workflows')} />}
                                {data.security && <Stat label='Blocked, 24h' value={data.security.denied24h} sub={`${data.security.failed24h} failed`} onClick={() => navigate('organization_admin/audit')} warn={data.security.denied24h > 0} />}
                            </div>
                        </Block>
                    )}

                    {data.security && (data.security.recentDenied.length > 0 || data.security.recentChanges.length > 0) && (
                        <Block title='Recent security activity' action={{ label: 'Audit trail', path: 'organization_admin/audit' }}>
                            <ul className='divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel'>
                                {data.security.recentDenied.slice(0, 3).map((e, i) => (
                                    <li key={`d${i}`} className='px-4 py-2'>
                                        <p className='flex items-center gap-2 text-sm text-ink'><Badge tone='danger'>Blocked</Badge> <span className='truncate'>{e.who || 'Unknown'}</span></p>
                                        <p className='truncate text-xs text-muted'>{e.action} · {fmtDate(e.at)}</p>
                                    </li>
                                ))}
                                {data.security.recentChanges.slice(0, 4).map((e, i) => (
                                    <li key={`c${i}`} className='px-4 py-2'>
                                        <p className='truncate text-sm text-ink'>{e.target || e.action}</p>
                                        <p className='truncate text-xs text-muted'>{e.who} · {e.action} · {fmtDate(e.at)}</p>
                                    </li>
                                ))}
                            </ul>
                            <p className='text-xs text-muted'>Based on the latest {data.security.sample} events.</p>
                        </Block>
                    )}

                    {data.design && (
                        <Block title='Organization design' action={{ label: 'Open', path: 'organization_admin/structure' }}>
                            <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                                <Stat label='Units' value={data.design.units} sub={`${data.design.sites} sites`} onClick={() => navigate('organization_admin/structure')} />
                                <Stat label='Job roles' value={data.design.jobRoles} onClick={() => navigate('organization_admin/positions')} />
                                <Stat label='Without security role' value={data.design.jobRolesWithoutSecurityRole} onClick={() => navigate('organization_admin/positions')} warn={data.design.jobRolesWithoutSecurityRole > 0} />
                                <Stat label='Modules enabled' value={data.setup?.modules ?? ctx.modules.length} onClick={() => navigate('organization_admin/modules')} />
                            </div>
                        </Block>
                    )}

                    {data.usage && data.usage.byArea.length > 0 && (
                        <Block title='Usage this week'>
                            <ul className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                                {data.usage.byArea.map((u) => {
                                    const max = data.usage?.byArea[0].count || 1;
                                    return (
                                        <li key={u.area}>
                                            <div className='flex justify-between text-xs text-soft'><span>{humanize(u.area)}</span><span>{u.count}</span></div>
                                            <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-page'><div className='h-full rounded-full bg-brand' style={{ width: `${Math.round((u.count / max) * 100)}%` }} /></div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Block>
                    )}

                    <Block title='Organization'>
                        <dl className='divide-y divide-line rounded-2xl border border-line bg-panel px-4'>
                            {[
                                ['Code', o.code],
                                ['Email extension', `@${o.domain}`],
                                ['Country', `${o.city}, ${o.countryName}`],
                                ['Base currency', o.currencyCode],
                                ['Industry', humanize(o.industry)],
                                ['Registered', fmtDate(o.createdAt)],
                            ].map(([k, v]) => (
                                <div key={k} className='flex justify-between gap-3 py-2 text-sm'>
                                    <dt className='text-muted'>{k}</dt>
                                    <dd className='text-right text-ink'>{v}</dd>
                                </div>
                            ))}
                        </dl>
                        <div className='flex flex-wrap gap-2 pt-1'>
                            {ctx.modules.map((m) => (
                                <Badge key={m.code} tone={m.mandatory ? 'warn' : 'brand'}>{m.code} · {m.name}</Badge>
                            ))}
                        </div>
                    </Block>
                </div>
            ) : null}
        </Screen>
    );
}
