import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { fetchReference } from '../lib/reference';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { STATUS_LABELS, type Application } from '../apply/types';
import { formatSize } from '../apply/files';
import { fmtDate } from './format';
import { Badge, Button, Card, Empty, PageTitle, Spinner, SubTabs, TextArea, useLoad } from './kit';
import RegistrationSettings from './RegistrationSettings';

interface Summary {
    uid: string;
    email: string;
    domain: string;
    status: string;
    organizationName: string;
    applicantName: string;
    createdAt: string;
    updatedAt: string;
    submittedAt: string;
}

const TONE: Record<string, 'brand' | 'warn' | 'danger' | 'muted'> = { submitted: 'warn', approved: 'brand', rejected: 'danger', returned: 'warn', draft: 'muted' };

type Filter = 'submitted' | 'returned' | 'draft' | 'approved' | 'rejected' | 'all';

export default function ApplicationsPage({ id, isSuper }: { id?: string; isSuper: boolean }) {
    if (id) return <ApplicationDetail uid={id} isSuper={isSuper} />;
    return <ApplicationList isSuper={isSuper} />;
}

function ApplicationList({ isSuper }: { isSuper: boolean }) {
    const { data, error, loading } = useLoad(() => callBackend<{ applications: Summary[] }>('/api/admin/applications/list'));
    const [filter, setFilter] = useState<Filter>('submitted');
    const rows = useMemo(() => (data?.applications ?? []).filter((a) => filter === 'all' || a.status === filter), [data, filter]);
    const count = (s: string) => (data?.applications ?? []).filter((a) => a.status === s).length;

    return (
        <div>
            <PageTitle title='Registrations' subtitle='Staged organization applications awaiting MEMS approval' />
            <RegistrationSettings isSuper={isSuper} />
            <SubTabs<Filter>
                value={filter}
                onChange={setFilter}
                tabs={[
                    { key: 'submitted', label: `Pending (${count('submitted')})` },
                    { key: 'returned', label: 'Returned' },
                    { key: 'draft', label: 'In progress' },
                    { key: 'approved', label: 'Approved' },
                    { key: 'rejected', label: 'Rejected' },
                    { key: 'all', label: 'All' },
                ]}
            />
            {loading && !data ? (
                <Spinner />
            ) : error ? (
                <Alert tone='error'>{error}</Alert>
            ) : rows.length === 0 ? (
                <Empty>No applications here.</Empty>
            ) : (
                <div className='space-y-3'>
                    {rows.map((a) => (
                        <button key={a.uid} onClick={() => navigate(`admin/registrations/${a.uid}`)} className='block w-full text-left'>
                            <Card>
                                <div className='flex items-start justify-between gap-3'>
                                    <div className='min-w-0'>
                                        <p className='truncate font-medium text-white'>{a.organizationName || 'Organization name not given yet'}</p>
                                        <p className='truncate text-sm text-slate-400'>
                                            {a.applicantName} · @{a.domain}
                                        </p>
                                        <p className='text-xs text-slate-500'>{a.submittedAt ? `Submitted ${fmtDate(a.submittedAt)}` : `Updated ${fmtDate(a.updatedAt)}`}</p>
                                    </div>
                                    <Badge tone={TONE[a.status] ?? 'muted'}>{STATUS_LABELS[a.status] ?? a.status}</Badge>
                                </div>
                            </Card>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

interface DetailData {
    application: Application;
    documents: Record<string, { name: string; contentType: string; size: number; uploadedAt: string; url: string; label: string }>;
}

function ApplicationDetail({ uid, isSuper }: { uid: string; isSuper: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<DetailData>('/api/admin/applications/get', { uid }), [uid]);
    const ref = useLoad(() => fetchReference());
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState('');
    const [info, setInfo] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Application not found.'}</Alert>;
    const a = data.application;
    const country = (iso?: string) => ref.data?.countries.find((c) => c.iso2 === iso)?.name ?? iso ?? '';
    const label = (list: string, code?: string) => ref.data?.metadataLists.find((l) => l.key === list)?.items.find((i) => i.code === code)?.label ?? code ?? '';

    const decide = async (decision: 'approve' | 'return' | 'reject') => {
        setActionError('');
        setInfo('');
        if (decision !== 'approve' && note.trim().length < 5) return setActionError('Write a reason for the applicant (at least 5 characters).');
        const prompts = {
            approve: `Approve ${a.organization.name}? This creates the organization and gives ${a.email} super admin access.`,
            return: 'Return this application to the applicant for changes?',
            reject: 'Reject this application? The email extension will be released.',
        };
        if (!window.confirm(prompts[decision])) return;
        setBusy(decision);
        try {
            const res = await callBackend<{ status: string; code?: string }>('/api/admin/applications/decide', { uid, decision, note: note.trim() });
            setInfo(res.status === 'approved' ? `Approved. Organization code ${res.code}.` : `Application ${res.status}.`);
            setNote('');
            reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not save the decision.');
        } finally {
            setBusy('');
        }
    };

    const sections: Array<{ title: string; rows: Array<[string, string | undefined]> }> = [
        {
            title: 'Applicant',
            rows: [
                ['Name', `${label('titles', a.applicant.title)} ${a.applicant.firstName ?? ''} ${a.applicant.lastName ?? ''}`.trim()],
                ['Email', a.email],
                ['Phone', a.applicant.phone],
                ['ID document', `${label('identityDocumentTypes', a.identity.idType)} ${a.identity.idNumber ?? ''}`.trim()],
            ],
        },
        {
            title: 'Organization',
            rows: [
                ['Name', a.organization.name],
                ['Email extension', `@${a.domain}`],
                ['Legal entity', label('legalEntityTypes', a.organization.legalEntityType)],
                ['Industry', label('industries', a.organization.industry)],
                ['Size', label('companySizes', a.organization.companySize)],
                ['Base currency', a.organization.currencyCode],
                ['Website', a.organization.website],
            ],
        },
        {
            title: 'Registration',
            rows: [
                ['Country of registration', country(a.registration.countryCode)],
                ['Registration number', a.registration.registrationNumber],
                ['Registration date', a.registration.registrationDate],
                ['Tax number', a.registration.taxNumber],
                ['Country of origin', a.registration.originCountryCode === 'OTHER' ? a.registration.originOther : country(a.registration.originCountryCode)],
            ],
        },
        {
            title: 'Branding',
            rows: [
                ['Brand name', a.branding?.displayName],
                ['Slogan', a.branding?.slogan],
                ['Theme', a.branding?.preset],
                ['Brand colour', a.branding?.brandColor],
            ],
        },
        {
            title: 'Headquarters',
            rows: [
                ['Country', country(a.headquarters.countryCode)],
                ['City', a.headquarters.city],
                ['Address', a.headquarters.address],
                ['Postal address', a.headquarters.postalAddress],
            ],
        },
    ];

    return (
        <div className='space-y-4'>
            <button onClick={() => navigate('admin/registrations')} className='text-sm text-slate-400'>
                ← Registrations
            </button>
            <PageTitle
                title={a.organization.name || a.email}
                subtitle={a.submittedAt ? `Submitted ${fmtDate(a.submittedAt)}` : `Started ${fmtDate(a.createdAt)}`}
                action={<Badge tone={TONE[a.status] ?? 'muted'}>{STATUS_LABELS[a.status] ?? a.status}</Badge>}
            />
            {a.reviewNote && (
                <Card>
                    <p className='text-sm text-slate-300'>
                        Last decision by {a.reviewedBy} on {fmtDate(a.reviewedAt)}: {a.reviewNote}
                    </p>
                </Card>
            )}
            {sections.map((s) => (
                <Card key={s.title}>
                    <h2 className='mb-2 font-semibold text-white'>{s.title}</h2>
                    {s.rows.map(([k, v]) => (
                        <div key={k} className='flex justify-between gap-3 py-1 text-sm'>
                            <span className='text-slate-400'>{k}</span>
                            <span className='text-right text-white'>{v || '—'}</span>
                        </div>
                    ))}
                </Card>
            ))}
            <Card>
                <h2 className='mb-2 font-semibold text-white'>Documents</h2>
                {Object.keys(data.documents).length === 0 ? (
                    <Empty>No documents uploaded.</Empty>
                ) : (
                    <div className='grid grid-cols-2 gap-3'>
                        {Object.entries(data.documents).map(([slot, d]) => (
                            <a key={slot} href={d.url} target='_blank' rel='noopener noreferrer' className='block overflow-hidden rounded-xl border border-slate-800'>
                                {d.contentType.startsWith('image/') ? (
                                    <img src={d.url} alt={d.label} className='h-28 w-full object-cover' />
                                ) : (
                                    <div className='flex h-28 items-center justify-center bg-slate-950'>
                                        <FileText className='h-10 w-10 text-emerald-400' />
                                    </div>
                                )}
                                <div className='p-2'>
                                    <p className='truncate text-xs font-medium text-white'>{d.label}</p>
                                    <p className='text-[10px] text-slate-500'>{formatSize(d.size)}</p>
                                </div>
                            </a>
                        ))}
                    </div>
                )}
                <p className='mt-2 text-xs text-slate-500'>Links are private and expire after 15 minutes. Reopen the page to renew them.</p>
            </Card>
            {a.status === 'submitted' && (
                <Card className='space-y-3'>
                    <h2 className='font-semibold text-white'>Decision</h2>
                    {isSuper ? (
                        <>
                            <TextArea id='decision-note' label='Note to the applicant (required to return or reject)' rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                            {actionError && <Alert tone='error'>{actionError}</Alert>}
                            <div className='grid grid-cols-3 gap-2'>
                                <Button busy={busy === 'approve'} disabled={!!busy} onClick={() => decide('approve')}>
                                    Approve
                                </Button>
                                <Button variant='secondary' busy={busy === 'return'} disabled={!!busy} onClick={() => decide('return')}>
                                    Return
                                </Button>
                                <Button variant='danger' busy={busy === 'reject'} disabled={!!busy} onClick={() => decide('reject')}>
                                    Reject
                                </Button>
                            </div>
                        </>
                    ) : (
                        <Alert tone='info'>Only a MEMS super admin can approve, return or reject registrations.</Alert>
                    )}
                </Card>
            )}
            {info && <Alert tone='info'>{info}</Alert>}
        </div>
    );
}
