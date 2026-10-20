import { useEffect, useMemo, useState } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { ROLE_LABELS } from '../types';
import { Alert } from '../components/ui';
import { fmtDate, fmtKes } from './format';
import { Badge, Button, Card, Empty, PageTitle, Spinner, SubTabs, TextArea, Toggle, useLoad } from './kit';
import LogList, { type LogEntry } from './LogList';
import { appConfirm } from '../components/dialogs';

interface TenantRow {
    id: string;
    code: string;
    domain: string;
    name: string;
    countryName: string;
    city: string;
    currencyCode: string;
    industry: string;
    status: string;
    createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
    pending_approval: 'Pending approval',
    pending_verification: 'Pending approval',
    active: 'Active',
    suspended: 'Suspended',
    rejected: 'Rejected',
};

const isPending = (s: string) => s === 'pending_approval' || s === 'pending_verification';

function StatusBadge({ status }: { status: string }) {
    const tone = status === 'active' ? 'brand' : isPending(status) ? 'warn' : 'danger';
    return <Badge tone={tone}>{STATUS_LABELS[status] ?? status}</Badge>;
}

export default function TenantsPage({ id, tab, canWrite, isSuper }: { id?: string; tab?: string; canWrite: boolean; isSuper: boolean }) {
    if (id && id !== 'pending') {
        const valid = tab === 'users' || tab === 'modules' || tab === 'log' || tab === 'registration' ? tab : undefined;
        return <TenantDetail id={id} tab={valid} canWrite={canWrite} isSuper={isSuper} />;
    }
    return <TenantList initialFilter={id === 'pending' ? 'pending' : ''} />;
}

function TenantList({ initialFilter }: { initialFilter: string }) {
    const { data, error, loading } = useLoad(() => callBackend<{ tenants: TenantRow[] }>('/api/admin/tenants/list'));
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState(initialFilter);
    const counts = useMemo(() => {
        const all = data?.tenants ?? [];
        return {
            '': all.length,
            pending: all.filter((t) => isPending(t.status)).length,
            active: all.filter((t) => t.status === 'active').length,
            suspended: all.filter((t) => t.status === 'suspended').length,
            rejected: all.filter((t) => t.status === 'rejected').length,
        } as Record<string, number>;
    }, [data]);
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (data?.tenants ?? []).filter(
            (t) =>
                (!filter || (filter === 'pending' ? isPending(t.status) : t.status === filter)) &&
                (!q || `${t.code} ${t.name} ${t.domain} ${t.countryName} ${t.city}`.toLowerCase().includes(q))
        );
    }, [data, search, filter]);

    return (
        <div>
            <PageTitle title='Tenants' subtitle='Registered organizations' />
            <SubTabs<string>
                value={filter}
                onChange={setFilter}
                tabs={[
                    { key: '', label: `All (${counts[''] ?? 0})` },
                    { key: 'pending', label: `Pending approval (${counts.pending ?? 0})` },
                    { key: 'active', label: `Active (${counts.active ?? 0})` },
                    { key: 'suspended', label: `Suspended (${counts.suspended ?? 0})` },
                    { key: 'rejected', label: `Rejected (${counts.rejected ?? 0})` },
                ]}
            />
            <input
                type='search'
                placeholder='Search code, name, email extension'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className='mb-4 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
            />
            {loading && !data ? (
                <Spinner />
            ) : error ? (
                <Alert tone='error'>{error}</Alert>
            ) : rows.length === 0 ? (
                <Empty>No organizations found.</Empty>
            ) : (
                <div className='space-y-3'>
                    {rows.map((t) => (
                        <button key={t.id} onClick={() => navigate(`admin/tenants/${t.id}`)} className='block w-full text-left'>
                            <Card>
                                <div className='flex items-start justify-between gap-3'>
                                    <div className='min-w-0'>
                                        <p className='truncate font-medium text-white'>{t.name}</p>
                                        <p className='font-mono text-xs text-emerald-300'>
                                            {t.code} · @{t.domain}
                                        </p>
                                        <p className='truncate text-sm text-slate-400'>
                                            {t.city}, {t.countryName} · {t.currencyCode}
                                        </p>
                                        <p className='text-xs text-slate-500'>Registered {fmtDate(t.createdAt)}</p>
                                    </div>
                                    <StatusBadge status={t.status} />
                                </div>
                            </Card>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

interface TenantDetailData {
    tenant: Record<string, unknown> & { id: string; name?: string; status?: string };
    users: Array<{ uid: string; email: string; firstName: string; lastName: string; phone: string; role: string; status: string; lastLoginAt: string }>;
    modules: Array<{ code: string; name: string; category: string; mandatory: boolean; available: boolean; enabled: boolean; adopted: boolean; monthlyPriceKes: number }>;
}

type Tab = 'registration' | 'users' | 'modules' | 'log';

function TenantDetail({ id, tab, canWrite, isSuper }: { id: string; tab?: Tab; canWrite: boolean; isSuper: boolean }) {
    const { data, setData, error, loading, reload } = useLoad(() => callBackend<TenantDetailData>('/api/admin/tenants/get', { orgId: id }), [id]);
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Tenant not found.'}</Alert>;
    const t = data.tenant;
    const status = String(t.status ?? '');
    const active: Tab = tab ?? (isPending(status) || status === 'rejected' ? 'registration' : 'users');

    const setStatus = async (next: string) => {
        if (!(await appConfirm(next === 'suspended' ? `Suspend ${t.name}? Its users will lose access.` : `Reactivate ${t.name}?`))) return;
        setBusy('status');
        setActionError('');
        try {
            await callBackend('/api/admin/tenants/status', { orgId: id, status: next });
            setData({ ...data, tenant: { ...t, status: next } });
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not update status.');
        } finally {
            setBusy('');
        }
    };

    const adoptedModules = data.modules.filter((m) => m.adopted);
    const monthly = adoptedModules.filter((m) => m.enabled).reduce((sum, m) => sum + m.monthlyPriceKes, 0);

    return (
        <div>
            <button onClick={() => navigate('admin/tenants')} className='mb-4 text-sm text-slate-400'>
                ← Tenants
            </button>
            <Card className='mb-4'>
                <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                        <h1 className='truncate text-xl font-semibold text-white'>{String(t.name ?? '')}</h1>
                        <p className='font-mono text-xs text-emerald-300'>
                            {String(t.code ?? '')} · @{String(t.domain ?? '')}
                        </p>
                        <p className='text-sm text-slate-400'>
                            {String(t.city ?? '')}, {String(t.countryName ?? '')} · {String(t.currencyCode ?? '')}
                        </p>
                        <p className='text-xs text-slate-500'>Registered {fmtDate(String(t.createdAt ?? ''))}</p>
                    </div>
                    <StatusBadge status={status} />
                </div>
                {canWrite && (status === 'active' || status === 'suspended') && (
                    <div className='mt-3'>
                        <Button variant={status === 'active' ? 'danger' : 'primary'} busy={busy === 'status'} onClick={() => setStatus(status === 'active' ? 'suspended' : 'active')}>
                            {status === 'active' ? 'Suspend tenant' : 'Reactivate tenant'}
                        </Button>
                    </div>
                )}
            </Card>

            <SubTabs<Tab>
                value={active}
                onChange={(key) => navigate(`admin/tenants/${id}/${key}`)}
                tabs={[
                    { key: 'registration', label: 'Registration' },
                    { key: 'users', label: `Users (${data.users.length})` },
                    { key: 'modules', label: 'Adopted modules' },
                    { key: 'log', label: 'Log' },
                ]}
            />
            {actionError && (
                <div className='mb-3'>
                    <Alert tone='error'>{actionError}</Alert>
                </div>
            )}

            {active === 'registration' && <RegistrationReview orgId={id} isSuper={isSuper} onDecided={reload} />}

            {active === 'users' && (
                <Card>
                    {data.users.length === 0 ? (
                        <Empty>No users.</Empty>
                    ) : (
                        <ul className='divide-y divide-slate-800'>
                            {data.users.map((u) => (
                                <li key={u.uid} className='flex items-start justify-between gap-3 py-3'>
                                    <div className='min-w-0'>
                                        <p className='truncate text-sm font-medium text-white'>
                                            {u.firstName} {u.lastName}
                                        </p>
                                        <p className='truncate text-xs text-slate-400'>{u.email}</p>
                                        <p className='text-xs text-slate-500'>
                                            {u.phone} · Last login {fmtDate(u.lastLoginAt)}
                                        </p>
                                    </div>
                                    <Badge tone='brand'>{ROLE_LABELS[u.role] ?? u.role}</Badge>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            )}

            {active === 'modules' && (
                <Card>
                    <p className='mb-1 text-sm text-slate-400'>Enabled modules: {fmtKes(monthly)} per month</p>
                    <p className='mb-3 text-xs text-slate-500'>Modules are adopted, enabled and disabled only by the organization's own administrators. MEMS can view them here but cannot change them.</p>
                    {adoptedModules.length === 0 ? (
                        <Empty>This organization has not adopted any modules yet.</Empty>
                    ) : (
                        <ul className='space-y-2'>
                            {adoptedModules.map((m) => (
                                <li key={m.code} className={`flex items-center justify-between gap-3 rounded-xl border-2 p-3 ${m.enabled ? 'border-emerald-500/70' : 'border-red-500/70'}`}>
                                    <div className='min-w-0'>
                                        <p className='truncate text-sm font-medium text-white'>
                                            <span className='mr-2 font-mono text-emerald-300'>{m.code}</span>
                                            {m.name}
                                        </p>
                                        <p className='text-xs text-slate-500'>
                                            {m.category} · {m.mandatory ? 'Mandatory' : `${fmtKes(m.monthlyPriceKes)} / month`}
                                        </p>
                                    </div>
                                    {m.enabled ? <Badge tone='brand'>Enabled</Badge> : <Badge tone='danger'>Disabled</Badge>}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            )}

            {active === 'log' && <TenantLog id={id} />}
        </div>
    );
}

interface RegistrationData {
    id: string;
    code: string;
    name: string;
    status: string;
    domain: string;
    legalEntityType: string;
    industry: string;
    companySize: string;
    countryName: string;
    city: string;
    currencyCode: string;
    submittedAt: string;
    registration: { number: string; authority: string; date: string; taxId: string };
    originCountryName: string;
    hq: { countryName: string; city: string; address: string; postalAddress: string };
    registrant: { title: string; firstName: string; lastName: string; jobTitle: string; email: string; phone: string; idType: string; idNumber: string };
    emailVerified: boolean;
    files: Array<{ id: string; kind: string; name: string; contentType: string; size: number; uploadedAt: string }>;
    decision: { approvedAt: string; approvedBy: string; rejectedAt: string; rejectedBy: string; rejectionReason: string };
}

const human = (code: string) => code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const KIND_LABELS: Record<string, string> = { registration: 'Registration document', identity: 'Identity document', photo: 'Photo' };

function Rows({ rows }: { rows: Array<[string, string]> }) {
    return (
        <dl className='space-y-1.5 text-sm'>
            {rows.map(([label, value]) => (
                <div key={label} className='flex items-start justify-between gap-3'>
                    <dt className='shrink-0 text-slate-400'>{label}</dt>
                    <dd className='text-right text-white'>{value || '—'}</dd>
                </div>
            ))}
        </dl>
    );
}

function RegistrationReview({ orgId, isSuper, onDecided }: { orgId: string; isSuper: boolean; onDecided: () => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<RegistrationData>('/api/admin/registrations/get', { orgId }), [orgId]);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the registration.'}</Alert>;

    const decide = async (decision: 'approve' | 'reject' | 'delete') => {
        const prompts = {
            approve: `Approve ${data.name}? Its users will be able to log in and use MEMS.`,
            reject: `Reject ${data.name}? The email extension @${data.domain} will be released.`,
            delete: `Permanently delete ${data.name}, its account and all uploaded documents? This cannot be undone.`,
        };
        if (decision === 'reject' && reason.trim().length < 5) return setActionError('Give a reason for the rejection (at least 5 characters).');
        if (!(await appConfirm(prompts[decision]))) return;
        setBusy(decision);
        setActionError('');
        try {
            await callBackend('/api/admin/registrations/decide', { orgId, decision, reason });
            if (decision === 'delete') {
                navigate('admin/tenants');
                return;
            }
            reload();
            onDecided();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not save the decision.');
        } finally {
            setBusy('');
        }
    };

    const r = data.registrant;
    const pending = isPending(data.status);

    return (
        <div className='space-y-4'>
            {pending && (
                <Card>
                    <div className='flex items-center justify-between gap-3'>
                        <p className='text-sm text-slate-300'>Submitted {fmtDate(data.submittedAt)}</p>
                        {data.emailVerified ? <Badge tone='brand'>Email verified</Badge> : <Badge tone='warn'>Email not verified</Badge>}
                    </div>
                </Card>
            )}
            {data.status === 'rejected' && (
                <Card tone='danger'>
                    <p className='text-sm text-white'>Rejected {fmtDate(data.decision.rejectedAt)} by {data.decision.rejectedBy}</p>
                    <p className='mt-1 text-sm text-slate-300'>Reason: {data.decision.rejectionReason}</p>
                </Card>
            )}
            {data.status !== 'rejected' && data.decision.approvedAt && (
                <Card>
                    <p className='text-sm text-slate-300'>
                        Approved {fmtDate(data.decision.approvedAt)} by {data.decision.approvedBy}
                    </p>
                </Card>
            )}

            <Card>
                <h2 className='mb-2 font-semibold text-white'>Organization</h2>
                <Rows
                    rows={[
                        ['Name', data.name],
                        ['Code', data.code],
                        ['Email extension', `@${data.domain}`],
                        ['Legal entity', human(data.legalEntityType)],
                        ['Industry', human(data.industry)],
                        ['Size', human(data.companySize)],
                        ['Base currency', data.currencyCode],
                    ]}
                />
            </Card>
            <Card>
                <h2 className='mb-2 font-semibold text-white'>Local registration</h2>
                <Rows
                    rows={[
                        ['Country', data.countryName],
                        ['Registration number', data.registration.number],
                        ['Authority', data.registration.authority],
                        ['Date', data.registration.date],
                        ['Tax ID', data.registration.taxId],
                        ['Local office', data.city],
                    ]}
                />
            </Card>
            <Card>
                <h2 className='mb-2 font-semibold text-white'>Origin and headquarters</h2>
                <Rows
                    rows={[
                        ['Country of origin', data.originCountryName],
                        ['HQ country', data.hq.countryName],
                        ['HQ city', data.hq.city],
                        ['HQ address', data.hq.address],
                        ['Postal address', data.hq.postalAddress],
                    ]}
                />
            </Card>
            <Card>
                <h2 className='mb-2 font-semibold text-white'>Person registering</h2>
                <Rows
                    rows={[
                        ['Name', `${human(r.title)} ${r.firstName} ${r.lastName}`.trim()],
                        ['Job title', r.jobTitle],
                        ['Email', r.email],
                        ['Phone', r.phone],
                        ['ID type', human(r.idType)],
                        ['ID number', r.idNumber],
                    ]}
                />
            </Card>
            <Card>
                <h2 className='mb-2 font-semibold text-white'>Documents ({data.files.length})</h2>
                {data.files.length === 0 ? (
                    <Empty>No documents were uploaded with this registration.</Empty>
                ) : (
                    <ul className='space-y-3'>
                        {data.files.map((f) => (
                            <DocumentItem key={f.id} orgId={orgId} file={f} />
                        ))}
                    </ul>
                )}
            </Card>

            {isSuper && pending && (
                <Card className='space-y-3'>
                    <h2 className='font-semibold text-white'>Decision</h2>
                    <Button className='w-full' busy={busy === 'approve'} disabled={!!busy} onClick={() => decide('approve')}>
                        Approve organization
                    </Button>
                    <TextArea id='reject-reason' label='Reason for rejection' rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                    <Button className='w-full' variant='danger' busy={busy === 'reject'} disabled={!!busy} onClick={() => decide('reject')}>
                        Reject registration
                    </Button>
                </Card>
            )}
            {!isSuper && pending && <Alert tone='info'>Only a MEMS super admin can approve or reject registrations.</Alert>}
            {isSuper && data.status === 'rejected' && (
                <Button className='w-full' variant='danger' busy={busy === 'delete'} disabled={!!busy} onClick={() => decide('delete')}>
                    Permanently delete registration and documents
                </Button>
            )}
            {actionError && <Alert tone='error'>{actionError}</Alert>}
        </div>
    );
}

function DocumentItem({ orgId, file }: { orgId: string; file: RegistrationData['files'][number] }) {
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        return () => {
            if (url) URL.revokeObjectURL(url);
        };
    }, [url]);

    const load = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await callBackend<{ name: string; contentType: string; data: string }>('/api/admin/registrations/file', { orgId, fileId: file.id });
            const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
            setUrl(URL.createObjectURL(new Blob([bytes], { type: res.contentType })));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not open the document.');
        } finally {
            setBusy(false);
        }
    };

    const isPdf = file.contentType === 'application/pdf';
    return (
        <li className='rounded-xl border border-slate-800 p-3'>
            <div className='flex items-center gap-2'>
                {isPdf ? <FileText className='h-5 w-5 shrink-0 text-emerald-400' /> : <ImageIcon className='h-5 w-5 shrink-0 text-emerald-400' />}
                <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm text-white'>{file.name}</p>
                    <p className='text-xs text-slate-500'>
                        {KIND_LABELS[file.kind] ?? file.kind} · {Math.round(file.size / 1000)} KB
                    </p>
                </div>
                {!url && (
                    <Button variant='secondary' busy={busy} onClick={load}>
                        View
                    </Button>
                )}
                {url && isPdf && (
                    <a href={url} target='_blank' rel='noopener noreferrer' className='flex h-11 items-center rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-200'>
                        Open PDF
                    </a>
                )}
            </div>
            {url && !isPdf && <img src={url} alt={file.name} className='mt-3 max-h-96 w-full rounded-lg object-contain' />}
            {error && <div className='mt-2'><Alert tone='error'>{error}</Alert></div>}
        </li>
    );
}

function TenantLog({ id }: { id: string }) {
    const { data, error, loading } = useLoad(() => callBackend<{ logs: LogEntry[] }>('/api/admin/tenants/logs', { orgId: id }), [id]);
    return <Card>{loading && !data ? <Spinner /> : error ? <Alert tone='error'>{error}</Alert> : <LogList logs={data?.logs ?? []} />}</Card>;
}
