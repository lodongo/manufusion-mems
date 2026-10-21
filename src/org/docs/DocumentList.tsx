import { useMemo, useState } from 'react';
import { BookOpenCheck, ChevronDown, ChevronUp, FilePlus2, FileSearch, PenLine, ShieldCheck, Upload, UserCheck } from 'lucide-react';
import RichTable, { type Column } from '../../components/RichTable';
import { Screen, Segmented } from '../../components/screen';
import { Alert } from '../../components/ui';
import { Button, Spinner } from '../../admin/kit';
import { firebaseAuth } from '../../firebase';
import { navigate } from '../../lib/route';
import { CLASS_NAMES, EmptyState, StatusChip, levelName, shortDate, statusLabel, type DocRow } from './docUi';

// Documents home: what to do first (a short guide), counters of the person's own work, and the register as a rich
// table (search, filters, columns, Excel, saved templates). Tapping a row opens the document.

export type ListView = 'mine' | 'all' | 'review' | 'due';
export interface ReviewItem { documentId: string; title: string; revision: string; nextReview: string | null; status: string }

const GUIDE_KEY = 'mems.doc.guide.hidden';
const STEPS = [
    { icon: FilePlus2, title: 'Create from a template', text: 'Tap New document, pick a template and where it applies.' },
    { icon: Upload, title: 'Upload the file', text: 'Write it in Word (download the outline), then upload the PDF or Word file.' },
    { icon: PenLine, title: 'Assign sign-off', text: 'Choose who signs it, then submit it for review.' },
    { icon: UserCheck, title: 'Independent review', text: 'A reviewer at that location verifies, returns or rejects it.' },
    { icon: ShieldCheck, title: 'Approve and publish', text: 'Signatories sign, approval follows the chart of authority, you publish.' },
];

function Guide({ experienced }: { experienced: boolean }) {
    const [hidden, setHidden] = useState(() => {
        try {
            const saved = localStorage.getItem(GUIDE_KEY);
            return saved === null ? experienced : saved === '1';
        } catch {
            return experienced;
        }
    });
    const toggle = () => {
        setHidden((h) => {
            try {
                localStorage.setItem(GUIDE_KEY, h ? '0' : '1');
            } catch {
                /* per-device preference only */
            }
            return !h;
        });
    };
    return (
        <section className='rounded-2xl border border-line bg-panel'>
            <button type='button' onClick={toggle} aria-expanded={!hidden} className='flex min-h-[48px] w-full items-center gap-2 px-4 text-left'>
                <BookOpenCheck className='h-5 w-5 shrink-0 text-brandsoft' />
                <span className='flex-1 text-sm font-semibold text-ink'>How documents work — start here</span>
                {hidden ? <ChevronDown className='h-4 w-4 text-muted' /> : <ChevronUp className='h-4 w-4 text-muted' />}
            </button>
            {!hidden && (
                <ol className='flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-4 sm:grid sm:grid-cols-5 sm:overflow-visible' aria-label='Document lifecycle'>
                    {STEPS.map((s, i) => (
                        <li key={s.title} className='flex w-[78%] shrink-0 snap-start gap-3 rounded-xl bg-page p-3 sm:w-auto sm:flex-col'>
                            <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brandsoft'>
                                <s.icon className='h-5 w-5' />
                            </span>
                            <span className='min-w-0'>
                                <span className='block text-sm font-semibold text-ink'>
                                    {i + 1}. {s.title}
                                </span>
                                <span className='block text-xs text-muted'>{s.text}</span>
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

export default function DocumentList({
    documents,
    loading,
    error,
    reviews,
    toSign,
    canCreate,
    canReview,
    view,
    onView,
    onOpen,
    onNew,
}: {
    documents: DocRow[];
    loading: boolean;
    error: string;
    reviews: ReviewItem[];
    toSign: number;
    canCreate: boolean;
    canReview: boolean;
    view: ListView;
    onView: (v: ListView) => void;
    onOpen: (id: string) => void;
    onNew: () => void;
}) {
    const me = firebaseAuth.currentUser?.uid ?? '';
    const mine = documents.filter((d) => d.createdBy === me && !['superseded', 'withdrawn', 'archived'].includes(d.status));
    const queue = documents.filter((d) => d.status === 'in_review' && d.createdBy !== me);
    const due = reviews.filter((r) => r.status === 'overdue' || r.status === 'due_soon');
    const rows = view === 'mine' ? mine : view === 'review' ? queue : documents;

    const columns = useMemo<Array<Column<DocRow>>>(
        () => [
            {
                key: 'title',
                label: 'Document',
                value: (d) => d.title,
                render: (d) => (
                    <span className='block min-w-0'>
                        <span className='line-clamp-2 font-medium text-ink'>{d.title}</span>
                        <span className='mt-0.5 flex min-w-0 items-center gap-2'>
                            <span className='sm:hidden'>
                                <StatusChip status={d.status} />
                            </span>
                            <span className='truncate font-mono text-[11px] text-muted'>
                                {d.classCode} · rev {d.revision}
                            </span>
                        </span>
                    </span>
                ),
            },
            { key: 'status', label: 'Status', value: (d) => statusLabel(d.status), render: (d) => <StatusChip status={d.status} /> },
            { key: 'classCode', label: 'Class', value: (d) => `${d.classCode} ${CLASS_NAMES[d.classCode] ?? ''}`.trim() },
            { key: 'location', label: 'Applies to', value: (d) => (d.scope?.name ? `${d.scope.name} (${levelName(d.scope.level || '')})` : '') },
            { key: 'updatedAt', label: 'Updated', type: 'date', value: (d) => d.updatedAt, render: (d) => shortDate(d.updatedAt) },
            { key: 'revision', label: 'Revision', value: (d) => d.revision, hidden: true },
            { key: 'template', label: 'Template', value: (d) => d.templateName || '', hidden: true },
            { key: 'documentId', label: 'Document ID', value: (d) => d.documentId, hidden: true },
        ],
        [],
    );

    const counters: Array<[string, number, ListView | null, string]> = [
        ['My drafts', mine.filter((d) => d.status === 'draft').length, 'mine', 'Your drafts not yet submitted'],
        ['In review', mine.filter((d) => d.status === 'in_review').length, 'mine', 'Your documents waiting for a reviewer'],
        ...(canReview ? ([['To review', queue.length, 'review', 'Submitted by others at your locations']] as Array<[string, number, ListView, string]>) : []),
        ['To sign', toSign, null, 'Open My document signatures'],
        ['Review due', due.length, 'due', 'Effective documents due for periodic review'],
    ];

    return (
        <Screen
            title='Documents'
            subtitle='Controlled documents'
            actions={
                canCreate ? (
                    <Button onClick={onNew}>
                        <FilePlus2 className='h-4 w-4' />
                        <span>New document</span>
                    </Button>
                ) : undefined
            }
            toolbar={
                <Segmented<ListView>
                    label='Document views'
                    value={view}
                    onChange={onView}
                    options={[
                        { value: 'mine', label: 'My work', count: mine.length },
                        { value: 'all', label: 'All documents', count: documents.length },
                        ...(canReview ? [{ value: 'review' as const, label: 'Review queue', count: queue.length }] : []),
                        { value: 'due', label: 'Review due', count: due.length },
                    ]}
                />
            }
        >
            <Guide experienced={mine.length > 0} />
            <div className='flex gap-2 overflow-x-auto sm:grid sm:grid-cols-5 sm:overflow-visible'>
                {counters.map(([label, n, target, hint]) => (
                    <button
                        key={label}
                        type='button'
                        title={hint}
                        onClick={() => (target ? onView(target) : navigate('organization_home/doc_my_signatures'))}
                        className={`min-w-[104px] shrink-0 rounded-xl border bg-panel px-3 py-2 text-left active:bg-page sm:min-w-0 ${n > 0 && (label === 'To review' || label === 'To sign' || label === 'Review due') ? 'border-brand/50' : 'border-line'}`}
                    >
                        <span className='block truncate text-xs text-muted'>{label}</span>
                        <span className='block text-xl font-semibold tabular-nums text-ink'>{n}</span>
                    </button>
                ))}
            </div>
            {loading && <Spinner />}
            {error && <Alert tone='error'>{error}</Alert>}
            {!loading && !error && view !== 'due' && rows.length === 0 && (
                <EmptyState icon={<FileSearch className='h-6 w-6' />} title={view === 'mine' ? 'You have no documents in progress' : view === 'review' ? 'Nothing waiting for your review' : 'No documents yet'}>
                    {view === 'review' ? 'Documents submitted by others at your locations appear here.' : canCreate ? 'Tap New document to create one from a template.' : 'You can read effective documents here once they are published.'}
                </EmptyState>
            )}
            {!loading && !error && view !== 'due' && rows.length > 0 && (
                <RichTable<DocRow>
                    id={`doc.register.${view}`}
                    tabKey={view}
                    title={view === 'mine' ? 'My documents' : view === 'review' ? 'Waiting for my review' : 'Document register'}
                    columns={columns}
                    rows={rows}
                    rowKey={(d) => d.documentId}
                    onRowClick={(d) => onOpen(d.documentId)}
                    fileName='document-register'
                    height='h-[calc(100dvh-24rem)] min-h-[320px]'
                />
            )}
            {view === 'due' && (
                <section className='rounded-2xl border border-line bg-panel'>
                    <h2 className='px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted'>Effective documents by next review date</h2>
                    {!reviews.length && <p className='p-4 text-sm text-muted'>No effective documents at your locations yet.</p>}
                    <ul className='divide-y divide-line'>
                        {reviews.map((r) => (
                            <li key={r.documentId}>
                                <button type='button' onClick={() => onOpen(r.documentId)} className='flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left active:bg-page'>
                                    <span className='min-w-0 flex-1'>
                                        <span className='block truncate text-sm font-medium text-ink'>{r.title}</span>
                                        <span className='block text-xs text-muted'>
                                            Revision {r.revision} · review by {r.nextReview ? shortDate(r.nextReview) : 'not scheduled'}
                                        </span>
                                    </span>
                                    <span className={`shrink-0 text-xs font-medium ${r.status === 'overdue' ? 'text-red-500' : r.status === 'due_soon' ? 'text-amber-500' : 'text-muted'}`}>{r.status.replace(/_/g, ' ')}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </Screen>
    );
}
