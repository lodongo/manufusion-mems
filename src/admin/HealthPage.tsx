import { CircleCheck, CircleX, RefreshCw, TriangleAlert } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { fmtDate, fmtNum } from './format';
import { Badge, Button, Card, Empty, PageTitle, Spinner, useLoad } from './kit';

interface LogoOwnershipReview {
    checked: number;
    flagged: number;
    issues: Array<{ orgId: string; code: string; name: string; finding: string }>;
    truncated: boolean;
}

interface HealthData {
    checkedAt: string;
    projectId: string;
    checks: Array<{ label: string; ok: boolean; ms: number; detail: string }>;
    collections: Record<string, number | null>;
    incidents: Array<{ title: string; service: string; severity: string; begin: string; end: string; active: boolean }> | null;
}

export default function HealthPage() {
    const { data, error, loading, reload } = useLoad(() => callBackend<HealthData>('/api/admin/health'));
    const logos = useLoad(() => callBackend<LogoOwnershipReview>('/api/admin/branding/ownership-review'));
    const allOk = data?.checks.every((c) => c.ok);

    return (
        <div className='space-y-4'>
            <PageTitle
                title='System health'
                subtitle={data ? `Firebase project ${data.projectId} · checked ${fmtDate(data.checkedAt)}` : 'Firebase status and key metrics'}
                action={
                    <Button variant='secondary' busy={loading} onClick={reload}>
                        <RefreshCw className='h-4 w-4' />
                        Check
                    </Button>
                }
            />
            {loading && !data ? (
                <Spinner />
            ) : error ? (
                <Alert tone='error'>{error}</Alert>
            ) : data ? (
                <>
                    <Card>
                        <div className='mb-2 flex items-center justify-between'>
                            <h2 className='font-semibold text-white'>Services</h2>
                            <Badge tone={allOk ? 'brand' : 'danger'}>{allOk ? 'All systems operational' : 'Attention needed'}</Badge>
                        </div>
                        <ul className='divide-y divide-slate-800'>
                            {data.checks.map((c) => (
                                <li key={c.label} className='flex items-center justify-between gap-3 py-3'>
                                    <div className='flex min-w-0 items-center gap-2'>
                                        {c.ok ? <CircleCheck className='h-5 w-5 shrink-0 text-emerald-400' /> : <CircleX className='h-5 w-5 shrink-0 text-red-400' />}
                                        <div className='min-w-0'>
                                            <p className='truncate text-sm text-white'>{c.label}</p>
                                            <p className='truncate text-xs text-slate-500'>{c.detail}</p>
                                        </div>
                                    </div>
                                    <span className='shrink-0 text-xs text-slate-400'>{c.ms} ms</span>
                                </li>
                            ))}
                        </ul>
                    </Card>

                    <Card>
                        <h2 className='mb-2 font-semibold text-white'>Organization logo ownership</h2>
                        {logos.loading && !logos.data ? <Spinner /> : logos.error ? (
                            <Alert tone='warn'>Logo ownership review unavailable: {logos.error}</Alert>
                        ) : logos.data ? (
                            <div className='space-y-2'>
                                <p className='text-sm text-slate-300'>
                                    Checked {logos.data.checked} organizations; {logos.data.flagged} invalid logo reference{logos.data.flagged === 1 ? '' : 's'} identified.
                                </p>
                                <Badge tone={logos.data.flagged ? 'danger' : 'brand'}>{logos.data.flagged ? 'Review affected organizations' : 'No invalid references detected'}</Badge>
                                {logos.data.issues.length > 0 && <ul className='divide-y divide-slate-800'>
                                    {logos.data.issues.map((org) => (
                                        <li className='py-2 text-sm' key={org.orgId}>
                                            <p className='font-medium text-white'>{org.name} {org.code && '(' + org.code + ')'}</p>
                                            <p className='text-xs text-slate-400'>{org.finding}. Ask an authorized organization admin to upload its own logo.</p>
                                        </li>
                                    ))}
                                </ul>}
                                {logos.data.truncated && <p className='text-xs text-amber-400'>Showing the first 100 findings.</p>}
                                <p className='text-xs text-slate-500'>This checks stored ownership references. It cannot determine whether two different organizations intentionally uploaded the same image.</p>
                            </div>
                        ) : null}
                    </Card>

                    <Card>
                        <h2 className='mb-2 font-semibold text-white'>Firestore documents</h2>
                        <div className='grid grid-cols-2 gap-3'>
                            {Object.entries(data.collections).map(([name, count]) => (
                                <div key={name} className='rounded-xl border border-slate-800 p-3'>
                                    <p className='text-xs capitalize text-slate-400'>{name}</p>
                                    <p className='text-xl font-semibold text-white'>{fmtNum(count)}</p>
                                </div>
                            ))}
                        </div>
                    </Card>

                    <Card>
                        <h2 className='mb-2 font-semibold text-white'>Firebase platform status (last 7 days)</h2>
                        {data.incidents === null ? (
                            <p className='text-sm text-slate-400'>The Firebase status page could not be reached.</p>
                        ) : data.incidents.length === 0 ? (
                            <Empty>No Firebase incidents reported in the last 7 days.</Empty>
                        ) : (
                            <ul className='divide-y divide-slate-800'>
                                {data.incidents.map((i, index) => (
                                    <li key={index} className='py-3'>
                                        <div className='flex items-start gap-2'>
                                            <TriangleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${i.active ? 'text-amber-400' : 'text-slate-500'}`} />
                                            <div className='min-w-0'>
                                                <p className='text-sm text-white'>{i.title || 'Incident'}</p>
                                                <p className='text-xs text-slate-500'>
                                                    {i.service} · {i.active ? 'Ongoing' : `Resolved ${fmtDate(i.end)}`}
                                                </p>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>
                    <p className='text-xs text-slate-500'>
                        Usage quotas and billing (reads, writes, storage) are shown in the Firebase console under Usage and billing.
                    </p>
                </>
            ) : null}
        </div>
    );
}
