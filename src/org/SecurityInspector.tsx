import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { Screen } from '../components/screen';

type User = { uid: string; name: string; email: string; role: string; status: string };
type Change = { id: string; at: string; action: string; actor: string; target: string; outcome: string; details: string };
type Overview = {
    users: User[];
    partialUsers: boolean;
    summary: { users: number; disabledUsers: number; roles: number; rolesWithLeftovers: number; rolesWithWildcards: number; rolesWithPotentialConflicts: number; deniedRequestsInSample: number; reportedLoginFailuresInSample: number };
    roleIssues: Array<{ id: string; name: string; leftovers: number; wildcard: number; conflicts: number }>;
    repeatedDenials: Array<{ email: string; count: number }>;
    recentChanges: Change[];
    sampleSize: number;
    note: string;
};
type Inspection = {
    found: boolean;
    user?: { uid: string; name: string; email: string; status: string; roleId: string; roleName: string; expiresAt: string; expired: boolean };
    assignments?: Array<{ type: string; positionCode: string; jobTitle: string; location: string; startsOn: string; endsOn: string }>;
    sources?: Array<{ roleId: string; roleName: string; how: string; location: string; permissions: string[] }>;
    permissions?: string[];
    sensitivePermissions?: string[];
    scope?: { view: string; extraViewLocations: string[] };
    review?: { potentialConflicts: Array<{ id: string; why: string }>; legacyKeys: string[]; wildcardKeys: string[] };
};
const Tile = ({ label, value }: { label: string; value: number }) => (
    <div className='rounded-xl border border-line bg-panel p-3'>
        <p className='text-xl font-semibold text-ink'>{value}</p>
        <p className='text-xs text-muted'>{label}</p>
    </div>
);
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className='space-y-3 rounded-2xl border border-line bg-panel p-4'>
        <h2 className='text-sm font-semibold text-ink'>{title}</h2>
        {children}
    </section>
);

export default function SecurityInspector() {
    const overview = useLoad(() => callBackend<Overview>('/api/org/security/overview'));
    const [selected, setSelected] = useState('');
    const [detail, setDetail] = useState<Inspection | null>(null);
    const [detailBusy, setDetailBusy] = useState(false);
    const [detailError, setDetailError] = useState('');

    useEffect(() => {
        if (overview.data?.users.length && !overview.data.users.some((u) => u.uid === selected)) {
            setSelected(overview.data.users[0].uid);
        }
    }, [overview.data, selected]);

    useEffect(() => {
        if (!selected) return;
        let active = true;
        setDetailBusy(true);
        setDetail(null);
        setDetailError('');
        callBackend<Inspection>('/api/org/security/inspect', { uid: selected })
            .then((value) => { if (active) setDetail(value); })
            .catch((error: unknown) => { if (active) setDetailError(error instanceof Error ? error.message : 'Could not inspect access.'); })
            .finally(() => { if (active) setDetailBusy(false); });
        return () => { active = false; };
    }, [selected]);

    const info = overview.data;
    return (
        <Screen title='Security inspector' subtitle='Read-only access and risk visibility' onBack={() => navigate('organization_admin/roles')} actions={
            <Button variant='secondary' onClick={overview.reload} aria-label='Refresh security review'><RefreshCw className='h-4 w-4' /></Button>
        }>
            {overview.loading && !info ? <Spinner /> : overview.error || !info ? (
                <Alert tone='error'>{overview.error || 'Security review unavailable.'}</Alert>
            ) : (
                <>
                    <Alert tone='info'>Inspection only. No existing user role, permission, site access or workflow is changed here.</Alert>
                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                        <Tile label='Users' value={info.summary.users} />
                        <Tile label='Security roles' value={info.summary.roles} />
                        <Tile label='Roles with conflicts' value={info.summary.rolesWithPotentialConflicts} />
                        <Tile label='Roles with legacy rights' value={info.summary.rolesWithLeftovers} />
                        <Tile label='Roles with wildcard rights' value={info.summary.rolesWithWildcards} />
                        <Tile label='Disabled users' value={info.summary.disabledUsers} />
                        <Tile label='Denied requests in sample' value={info.summary.deniedRequestsInSample} />
                        <Tile label='Reported failed logins' value={info.summary.reportedLoginFailuresInSample} />
                    </div>
                    <Panel title='Inspect a user'>
                        {info.partialUsers && <Alert tone='warn'>Only the first 500 users are listed. Use existing user administration to locate others.</Alert>}
                        <label htmlFor='security-inspect-user' className='block text-xs font-medium text-muted'>User</label>
                        <select id='security-inspect-user' className='min-h-11 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink' value={selected} onChange={(event) => setSelected(event.target.value)}>
                            {!info.users.length && <option value=''>No users found</option>}
                            {info.users.map((u) => <option key={u.uid} value={u.uid}>{u.name} — {u.email}</option>)}
                        </select>
                        {detailBusy ? <Spinner /> : detailError ? <Alert tone='error'>{detailError}</Alert> : !detail?.found || !detail.user ? (
                            <p className='text-sm text-muted'>Select an available user to view their effective permissions.</p>
                        ) : (
                            <div className='space-y-4 text-sm text-soft'>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <p className='font-semibold text-ink'>{detail.user.name}</p>
                                    <Badge tone={detail.user.status === 'disabled' ? 'danger' : 'brand'}>{detail.user.status}</Badge>
                                    {detail.user.expired && <Badge tone='warn'>Direct role expired</Badge>}
                                </div>
                                <p className='break-all text-xs text-muted'>{detail.user.email} · {detail.user.roleName}</p>
                                <p>View scope: {detail.scope?.view || 'Not assigned'}</p>
                                {detail.scope?.extraViewLocations.length ? <p>Additional view-only areas: {detail.scope.extraViewLocations.join(', ')}</p> : null}
                                {detail.user.expiresAt && <p>Direct role expires: {detail.user.expiresAt}</p>}
                                <div>
                                    <p className='mb-2 font-semibold text-ink'>Organizational assignments</p>
                                    {detail.assignments?.length ? detail.assignments.map((a, i) =>
                                        <p className='border-t border-line py-2' key={a.positionCode + i}>
                                            {a.jobTitle} · {a.location} <span className='text-muted'>({a.type}{a.endsOn ? ', until ' + a.endsOn : ''})</span>
                                        </p>
                                    ) : <p className='text-muted'>No job assignment.</p>}
                                </div>
                                <div>
                                    <p className='mb-2 font-semibold text-ink'>Permission sources</p>
                                    {detail.sources?.map((s, i) =>
                                        <div className='border-t border-line py-2' key={s.roleId + i}>
                                            <p className='font-medium text-ink'>{s.roleName}</p>
                                            <p className='text-xs text-muted'>{s.how} · {s.location} · {s.permissions.length} right(s)</p>
                                        </div>
                                    )}
                                </div>
                                <div className='rounded-xl border border-line p-3'>
                                    <p className='font-medium text-ink'>Effective permissions ({detail.permissions?.length || 0})</p>
                                    <p className='mt-2 break-words text-xs text-muted'>{detail.permissions?.join(' · ') || 'None'}</p>
                                </div>
                                <div className='rounded-xl border border-line p-3'>
                                    <p className='font-medium text-ink'>Sensitive permissions ({detail.sensitivePermissions?.length || 0})</p>
                                    <p className='mt-2 break-words text-xs text-muted'>{detail.sensitivePermissions?.join(' · ') || 'None'}</p>
                                </div>
                                {detail.review?.potentialConflicts.length ? <Alert tone='warn'>
                                    Potential duty conflicts across this user's combined roles: {detail.review.potentialConflicts.map((c) => c.why).join(' ')} These are warnings; transaction-level rules remain authoritative.
                                </Alert> : <div className='flex items-center gap-2 text-xs text-muted'><ShieldCheck className='h-4 w-4' /> No listed permission-pair conflicts.</div>}
                                {detail.review?.legacyKeys.length ? <Alert tone='warn'>Legacy permissions: {detail.review.legacyKeys.join(', ')}</Alert> : null}
                                {detail.review?.wildcardKeys.length ? <Alert tone='warn'>Broad permissions: {detail.review.wildcardKeys.join(', ')}</Alert> : null}
                            </div>
                        )}
                    </Panel>
                    {info.repeatedDenials.length > 0 && <Panel title='Repeated denied requests (sample only)'>
                        {info.repeatedDenials.map((a) => <p key={a.email} className='text-sm text-soft'>{a.email}: {a.count} denied requests</p>)}
                    </Panel>}
                    <Panel title='Role and security change history'>
                        {info.recentChanges.length === 0 ? <p className='text-sm text-muted'>No matching security changes in the current audit sample.</p> :
                            <ul className='divide-y divide-line'>
                                {info.recentChanges.map((e) => (
                                    <li className='py-2 text-sm' key={e.id}>
                                        <p className='font-medium text-ink'>{e.action} <Badge tone={e.outcome === 'success' ? 'muted' : 'warn'}>{e.outcome}</Badge></p>
                                        <p className='text-xs text-muted'>{e.at} · {e.actor} · {e.target}</p>
                                        {e.details && <p className='mt-1 break-words text-xs text-soft'>{e.details}</p>}
                                    </li>
                                ))}
                            </ul>
                        }
                    </Panel>
                    <p className='text-xs text-muted'>{info.note}</p>
                </>
            )}
        </Screen>
    );
}
