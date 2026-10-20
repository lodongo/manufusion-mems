import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Screen } from '../components/screen';
import { fmtDate, fmtNum } from './format';
import { Badge, Button, Card, Empty, Spinner, useLoad } from './kit';
import LogList, { type LogEntry } from './LogList';

// MEMS staff dashboard, grouped the way staff work:
//   Needs attention (derived from the figures), Applications and tenants, Platform health,
//   Subscriptions and billing (links only: the dashboard service returns no billing figures), Audit and security.

interface DashboardData {
    stats: {
        staffUsers: number;
        tenants: number;
        activeTenants: number;
        tenantUsers: number;
        authUsers: number | null;
        modules: number;
        enabledModules: number;
        mandatoryModules: number;
        referenceLoaded: number;
        initializedModules: number;
        failedLogins24h: number;
        pendingApprovals: number;
        referenceTotal: number;
        kesPerUsd: number | null;
        ratesUpdatedAt: string;
    };
    recentTenants: Array<{ id: string; name: string; countryName: string; status: string; createdAt: string }>;
    recentLogs: LogEntry[];
}

function Stat({ label, value, sub, onClick, warn }: { label: string; value: string; sub?: string; onClick?: () => void; warn?: boolean }) {
    return (
        <button type='button' onClick={onClick} disabled={!onClick} className={`rounded-2xl border bg-slate-900 p-3 text-left disabled:cursor-default ${warn ? 'border-amber-500/60' : 'border-slate-800'}`}>
            <p className='text-xs text-slate-400'>{label}</p>
            <p className='mt-0.5 text-xl font-semibold text-white'>{value}</p>
            {sub && <p className='mt-0.5 text-xs text-slate-500'>{sub}</p>}
        </button>
    );
}

function Block({ title, action, children }: { title: string; action?: { label: string; path: string }; children: ReactNode }) {
    return (
        <section className='space-y-2'>
            <div className='flex items-center justify-between'>
                <h2 className='text-sm font-semibold uppercase tracking-wide text-slate-400'>{title}</h2>
                {action && (
                    <button type='button' onClick={() => navigate(action.path)} className='min-h-11 text-sm text-emerald-300'>
                        {action.label}
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

export default function Dashboard() {
    const { data, error, loading, reload } = useLoad(() => callBackend<DashboardData>('/api/admin/dashboard'));

    const attention = useMemo(() => {
        if (!data) return [];
        const s = data.stats;
        const out: Array<{ key: string; text: string; path: string; danger?: boolean }> = [];
        if (s.pendingApprovals) out.push({ key: 'pend', text: `${s.pendingApprovals} organization${s.pendingApprovals === 1 ? '' : 's'} waiting for approval`, path: 'admin/tenants/pending' });
        if (s.failedLogins24h) out.push({ key: 'fail', text: `${s.failedLogins24h} failed sign-in${s.failedLogins24h === 1 ? '' : 's'} in the last 24 hours`, path: 'admin/logs', danger: s.failedLogins24h >= 10 });
        if (s.initializedModules < s.enabledModules) out.push({ key: 'init', text: `${s.enabledModules - s.initializedModules} enabled module${s.enabledModules - s.initializedModules === 1 ? ' is' : 's are'} not initialised`, path: 'admin/modules' });
        if (s.referenceTotal && s.referenceLoaded < s.referenceTotal) out.push({ key: 'ref', text: `${s.referenceTotal - s.referenceLoaded} default list${s.referenceTotal - s.referenceLoaded === 1 ? '' : 's'} not loaded`, path: 'admin/defaults' });
        if (!s.ratesUpdatedAt) out.push({ key: 'fx', text: 'Exchange rates are not loaded', path: 'admin/defaults' });
        return out;
    }, [data]);

    return (
        <Screen
            title='Dashboard'
            eyebrow='MEMS platform'
            subtitle='Key figures across MEMS'
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
                            <p className='flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300'>
                                <CheckCircle2 className='h-5 w-5 text-emerald-400' /> Nothing needs attention.
                            </p>
                        ) : (
                            <ul className='divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900'>
                                {attention.map((a) => (
                                    <li key={a.key}>
                                        <button type='button' onClick={() => navigate(a.path)} className='flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left'>
                                            <AlertTriangle className={`h-4 w-4 shrink-0 ${a.danger ? 'text-red-400' : 'text-amber-400'}`} />
                                            <span className='min-w-0 flex-1 text-sm text-white'>{a.text}</span>
                                            <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Block>

                    <Block title='Applications and tenants' action={{ label: 'All tenants', path: 'admin/tenants' }}>
                        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                            <Stat label='Pending approvals' value={fmtNum(data.stats.pendingApprovals)} sub='Organizations to review' onClick={() => navigate('admin/tenants/pending')} warn={data.stats.pendingApprovals > 0} />
                            <Stat label='Tenants' value={fmtNum(data.stats.tenants)} sub={`${fmtNum(data.stats.activeTenants)} active`} onClick={() => navigate('admin/tenants')} />
                            <Stat label='Tenant users' value={fmtNum(data.stats.tenantUsers)} />
                            <Stat
                                label='Modules enabled'
                                value={`${fmtNum(data.stats.enabledModules)} / ${fmtNum(data.stats.modules)}`}
                                sub={`${fmtNum(data.stats.mandatoryModules)} mandatory`}
                                onClick={() => navigate('admin/modules')}
                            />
                        </div>
                        <Card>
                            <h3 className='mb-1 text-sm font-semibold text-white'>Newest tenants</h3>
                            {data.recentTenants.length === 0 ? (
                                <Empty>No organizations have registered yet.</Empty>
                            ) : (
                                <ul className='divide-y divide-slate-800'>
                                    {data.recentTenants.map((t) => (
                                        <li key={t.id}>
                                            <button onClick={() => navigate(`admin/tenants/${t.id}`)} className='flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left'>
                                                <div className='min-w-0'>
                                                    <p className='truncate text-sm font-medium text-white'>{t.name}</p>
                                                    <p className='text-xs text-slate-500'>{t.countryName} · {fmtDate(t.createdAt)}</p>
                                                </div>
                                                <Badge tone={t.status === 'active' ? 'brand' : 'danger'}>{t.status}</Badge>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>
                    </Block>

                    <Block title='Platform health' action={{ label: 'Health check', path: 'admin/health' }}>
                        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                            <Stat label='Modules initialised' value={`${fmtNum(data.stats.initializedModules)} / ${fmtNum(data.stats.modules)}`} onClick={() => navigate('admin/modules')} warn={data.stats.initializedModules < data.stats.enabledModules} />
                            <Stat label='Default values' value={`${data.stats.referenceLoaded} / ${data.stats.referenceTotal}`} sub='lists loaded' onClick={() => navigate('admin/defaults')} warn={data.stats.referenceLoaded < data.stats.referenceTotal} />
                            <Stat label='1 USD in KES' value={fmtNum(data.stats.kesPerUsd, 2)} sub={data.stats.ratesUpdatedAt ? `Updated ${fmtDate(data.stats.ratesUpdatedAt)}` : 'Rates not loaded'} warn={!data.stats.ratesUpdatedAt} />
                            <Stat label='System health' value='Check' sub='Firebase status' onClick={() => navigate('admin/health')} />
                        </div>
                    </Block>

                    <Block title='Subscriptions and billing'>
                        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                            <Stat label='Module subscriptions' value={`${fmtNum(data.stats.enabledModules)} enabled`} sub='Per tenant, in tenant settings' onClick={() => navigate('admin/tenants')} />
                            <Stat label='Billing' value='Not connected' sub='No billing figures yet' />
                        </div>
                    </Block>

                    <Block title='Audit and security' action={{ label: 'All logs', path: 'admin/logs' }}>
                        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                            <Stat label='Failed sign-ins (24h)' value={fmtNum(data.stats.failedLogins24h)} sub='Blocked or wrong password' onClick={() => navigate('admin/logs')} warn={data.stats.failedLogins24h > 0} />
                            <Stat label='MEMS staff' value={fmtNum(data.stats.staffUsers)} onClick={() => navigate('admin/users')} />
                            <Stat label='Auth accounts' value={fmtNum(data.stats.authUsers)} sub='Firebase Authentication' />
                        </div>
                        <Card>
                            <h3 className='mb-1 text-sm font-semibold text-white'>Recent activity</h3>
                            <LogList logs={data.recentLogs} />
                        </Card>
                    </Block>
                </div>
            ) : null}
        </Screen>
    );
}
