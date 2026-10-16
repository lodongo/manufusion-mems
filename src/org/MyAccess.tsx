import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Badge, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen } from '../components/screen';
import { DocStatusBadge, DocView, PermissionGroups, type DocGroups, type RoleDoc } from './RoleDocs';

// My access: everything the signed-in person holds, in plain words, with the rules of each role.
// Read only. Anyone can see their own access; nothing here changes it.

interface Mine {
    roleName: string;
    expiresAt: string;
    jobRoles: Array<{ code: string; title: string; place: string; type: string; startsOn: string; endsOn: string }>;
    roles: Array<{ id: string; name: string; description: string; how: string[]; appliesAt: string; permissions: DocGroups[]; doc: RoleDoc | null }>;
}

export default function MyAccess({ back }: { back: string }) {
    const { data, error, loading } = useLoad(() => callBackend<Mine>('/api/org/my-access'));
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load your access.'}</Alert>;
    return (
        <Screen title='My access' subtitle={data.roleName} onBack={() => navigate(back)}>
            {data.expiresAt && <Alert tone='info'>Your access ends on {fmtDate(data.expiresAt)}.</Alert>}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                <h2 className='text-sm font-semibold text-ink'>My job roles</h2>
                {data.jobRoles.length === 0 ? (
                    <p className='text-sm text-muted'>No job role assigned.</p>
                ) : (
                    <ul className='divide-y divide-line'>
                        {data.jobRoles.map((j, i) => (
                            <li key={`${j.code}${i}`} className='py-2 text-sm'>
                                <p className='font-medium text-ink'>{j.title || j.code} <span className='font-mono text-xs text-muted'>{j.code}</span></p>
                                <p className='text-xs text-muted'>{j.place}{j.type ? ` · ${j.type}` : ''}{j.endsOn ? ` · until ${fmtDate(j.endsOn)}` : ''}</p>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            {data.roles.length === 0 && <p className='text-sm text-muted'>No security roles apply to you.</p>}
            {data.roles.map((r) => (
                <section key={r.id} className='space-y-3 rounded-2xl border border-line bg-panel p-4'>
                    <div className='flex items-start justify-between gap-2'>
                        <div className='min-w-0'>
                            <h2 className='truncate text-base font-semibold text-ink'>{r.name}</h2>
                            {r.description && <p className='text-xs text-muted'>{r.description}</p>}
                        </div>
                        {r.doc ? <DocStatusBadge status={r.doc.status} /> : <Badge tone='muted'>No rules yet</Badge>}
                    </div>
                    <p className='text-xs text-soft'>{r.how.join(' · ')}</p>
                    <p className='text-xs text-muted'>Applies at: {r.appliesAt}</p>
                    {r.doc && <DocView doc={r.doc} />}
                    <PermissionGroups groups={r.permissions} />
                </section>
            ))}
        </Screen>
    );
}
