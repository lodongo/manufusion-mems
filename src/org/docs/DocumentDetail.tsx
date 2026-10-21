import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, ExternalLink, FileDown, FilePlus2, Info, PenLine, Plus, QrCode, RefreshCw, Send, ShieldAlert, ShieldCheck, Trash2, Undo2, Upload, UserCheck, XCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { callBackend } from '../../lib/backend';
import { Screen, Segmented, messageOf, useConfirm } from '../../components/screen';
import { Alert, Field, SelectField } from '../../components/ui';
import { Badge, Button, Spinner, TextArea, useLoad } from '../../admin/kit';
import { EmptyState, Fact, FileIcon, StatusChip, Stepper, className, downloadOutline, fileSize, levelName, shortDate, type Step, type TemplateSection } from './docUi';

// One controlled document: where it is in its lifecycle, the next step for this person, and every action the
// server allows them (upload, sign-off, review, approval, publication, revision). Each action is checked again
// on the server, which also writes the audit trail.

interface WorkflowFile { id: string; name: string; mime: string; bytes: number; uploadedAt: string; state: 'released' | 'waiting' | 'infected' | 'failed'; scanned: boolean; bypassed: boolean; sha256: string }
interface Slot { slotId: string; label: string; signerUid: string; signer: string; status: string; signedAt: string; position?: { page: number; xPercent: number; yPercent: number; widthPercent: number } }
interface Workflow {
    document: {
        id: string; title: string; classCode: string; status: string; revision: string; representation: string; location: { name: string; level: string } | null;
        author: string; createdAt: string; updatedAt: string; submittedAt: string; reviewer: string; reviewedAt: string; reviewDecision: string; reviewReason: string;
        verifier: string; verifiedAt: string; publishedAt: string; revisionReason: string; supersedesDocumentId: string; supersededByDocumentId: string;
        templateCode: string; templateName: string; outline: TemplateSection[]; plannedSignOff: string[];
    };
    files: WorkflowFile[];
    signatures: Slot[];
    publication: { approvalId: string; status: string; requestedAt: string; current: boolean } | null;
    can: { edit: boolean; submit: boolean; review: boolean; sign: boolean; requestApproval: boolean; publish: boolean; revise: boolean; releaseUnscanned: boolean };
    scanning: { enabled: boolean };
    steps: Step[];
}

type Tab = 'Overview' | 'Files' | 'Sign-off' | 'Review' | 'Publish' | 'History';

const TYPES: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
};
const EXT: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const MAX_BYTES = 8_000_000;

const FILE_STATE: Record<WorkflowFile['state'], { label: string; tone: 'brand' | 'warn' | 'danger' | 'muted' }> = {
    released: { label: 'Released', tone: 'brand' },
    waiting: { label: 'Waiting for scan', tone: 'warn' },
    infected: { label: 'Blocked: malware found', tone: 'danger' },
    failed: { label: 'Blocked: scan failed', tone: 'danger' },
};

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className='rounded-2xl border border-line bg-panel'>
            <div className='flex min-h-[48px] items-center gap-2 px-4 pt-2'>
                <h2 className='min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-muted'>{title}</h2>
                {action}
            </div>
            <div className='space-y-3 px-4 pb-4'>{children}</div>
        </section>
    );
}

async function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`${file.name}: could not be read.`));
        reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
        reader.readAsDataURL(file);
    });
}

async function signingSheet(documentId: string, title: string, s: Slot, proof: string) {
    const url = `${window.location.origin}${window.location.pathname}#/verify/document/${documentId}/${proof}`;
    const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 340 });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text('MEMS - Document signature verification sheet', 15, 22);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(pdf.splitTextToSize(`Document: ${title}`, 180), 15, 34);
    pdf.text(`Document ID: ${documentId}`, 15, 44);
    pdf.text(`Authority: ${s.label}`, 15, 51);
    pdf.text(`Signed by: ${s.signer}`, 15, 58);
    pdf.text(`Signed at (UTC): ${s.signedAt}`, 15, 65);
    pdf.setFontSize(8);
    pdf.text(`Verification proof: ${proof}`, 15, 78);
    pdf.addImage(qr, 'PNG', 74, 90, 62, 62);
    pdf.text('Scan to authenticate in MEMS (sign-in and authorized access required).', 105, 160, { align: 'center' });
    pdf.text('Authenticity, current revision and withdrawal status are checked online.', 105, 166, { align: 'center' });
    pdf.save(`MEMS-Signed-${documentId}-${s.slotId}.pdf`);
}

export default function DocumentDetail({ documentId, onBack, onOpenDocument }: { documentId: string; onBack: () => void; onOpenDocument: (id: string) => void }) {
    const { data, loading, error, reload } = useLoad(() => callBackend<Workflow>('/api/org/drkms/documents/workflow', { documentId }), [documentId]);
    const { ask, sheet } = useConfirm();
    const [tab, setTab] = useState<Tab>('Overview');
    const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
    const [busy, setBusy] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);
    // Sign-off form
    const [adding, setAdding] = useState(false);
    const [signer, setSigner] = useState('');
    const [authority, setAuthority] = useState('');
    const [position, setPosition] = useState({ page: 1, xPercent: 60, yPercent: 75, widthPercent: 35 });
    const [advanced, setAdvanced] = useState(false);
    // Review form
    const [reason, setReason] = useState('');

    const users = useLoad(() => (adding ? callBackend<{ users: Array<{ uid: string; firstName: string; lastName: string }> }>('/api/org/drkms/forms/signers/list', {}) : Promise.resolve(null)), [adding]);
    const history = useLoad(
        () => (tab === 'History' ? callBackend<{ currentStatus: string; predecessorId: string; successorId: string; revisions: Array<{ revisionId: string; revision: string; status: string; publishedAt: string; fingerprint: string }> }>('/api/org/drkms/documents/revision-history', { documentId }) : Promise.resolve(null)),
        [tab, documentId],
    );
    const effective = useLoad(
        () => (tab === 'History' && data && ['effective'].includes(data.document.status) ? callBackend<{ revisionId: string; files: Array<{ fileId: string; name: string; mime: string; bytes: number }> }>('/api/org/drkms/documents/effective-files', { documentId }) : Promise.resolve(null)),
        [tab, documentId, data?.document.status],
    );
    const proofs = useLoad(
        () => (tab === 'Sign-off' && data?.document.status === 'effective' ? callBackend<{ slots: Array<{ slotId: string; proof?: string }> }>('/api/org/drkms/signatures/list', { documentId }) : Promise.resolve(null)),
        [tab, documentId, data?.document.status],
    );

    const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
        setBusy(key);
        setNotice(null);
        try {
            await fn();
            if (ok) setNotice({ tone: 'success', text: ok });
            reload();
        } catch (err) {
            setNotice({ tone: 'error', text: messageOf(err) });
        } finally {
            setBusy('');
        }
    };

    const d = data?.document;
    const tabs = useMemo<Tab[]>(() => {
        if (!data) return ['Overview'];
        const s = data.document.status;
        const t: Tab[] = ['Overview', 'Files', 'Sign-off'];
        if (['in_review', 'technical_verified', 'rejected'].includes(s) || data.document.reviewDecision) t.push('Review');
        if (['technical_verified', 'effective'].includes(s) || data.publication) t.push('Publish');
        if (['effective', 'superseded', 'withdrawn', 'archived'].includes(s)) t.push('History');
        return t;
    }, [data]);

    const openFile = (f: WorkflowFile) =>
        run(`open-${f.id}`, async () => {
            const res = await callBackend<{ url: string }>('/api/org/drkms/files/open', { documentId, fileId: f.id });
            if (!res.url.startsWith('https://')) throw new Error('A secure link could not be created.');
            window.open(res.url, '_blank', 'noopener,noreferrer');
        });

    const upload = async (list: FileList | null) => {
        const files = Array.from(list ?? []);
        if (!files.length) return;
        setBusy('upload');
        setNotice(null);
        try {
            for (const file of files) {
                const mime = TYPES[file.type] ? file.type : EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
                if (!mime) throw new Error(`${file.name}: use PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PNG or JPEG.`);
                if (file.size < 1 || file.size > MAX_BYTES) throw new Error(`${file.name}: the limit is 8 MB per file.`);
                await callBackend('/api/org/drkms/files/stage', { documentId, mime, name: file.name.slice(0, 180), data: await readBase64(file) });
            }
            setNotice({ tone: 'success', text: data?.scanning.enabled ? 'Uploaded. The file is released once the malware scan reports it clean.' : 'Uploaded and released (malware scanning is off in MEMS Admin; the file type and fingerprint were checked).' });
            reload();
        } catch (err) {
            setNotice({ tone: 'error', text: messageOf(err) });
            reload();
        } finally {
            setBusy('');
        }
    };

    const removeFile = (f: WorkflowFile) =>
        ask({ title: 'Remove file', message: <>Remove <strong className='text-ink'>{f.name}</strong> from this draft? The original stays in the audit record.</>, confirmLabel: 'Remove', tone: 'danger', reason: { label: 'Reason', minLength: 5, placeholder: 'For example: wrong version uploaded' } }, async (r) => {
            await callBackend('/api/org/drkms/files/remove', { documentId, fileId: f.id, reason: r });
            reload();
        });

    const releaseFile = (f: WorkflowFile) =>
        ask({ title: 'Release without a scan', message: 'Malware scanning is off in MEMS Admin. The file type and fingerprint were checked on upload; releasing it lets reviewers and signatories open it. This is recorded in the audit trail.', confirmLabel: 'Release file' }, async () => {
            await callBackend('/api/org/drkms/files/release', { documentId, fileId: f.id });
            reload();
        });

    const assign = () => {
        if (!signer || authority.trim().length < 3) return;
        void run(
            'assign',
            async () => {
                await callBackend('/api/org/drkms/signatures/assign', { documentId, signerUid: signer, label: authority.trim(), position });
                setSigner('');
                setAuthority('');
                setAdding(false);
            },
            'Signatory added. They sign after the independent review.',
        );
    };

    const sign = (s: Slot) =>
        ask(
            {
                title: `Sign as ${s.label}`,
                message: 'Open and read the verified files first. Your signature is bound to this exact verified content; any later change needs a new revision and new signatures.',
                confirmLabel: 'Sign document',
                acknowledge: 'I have read the verified document and I sign it under my own authenticated account.',
            },
            async () => {
                await callBackend('/api/org/drkms/signatures/sign', { documentId, slotId: s.slotId, attest: true });
                setNotice({ tone: 'success', text: 'Signed. Your signature is recorded against the verified content.' });
                reload();
            },
        );

    const submit = () =>
        ask({ title: 'Submit for review', message: 'An independent reviewer at this location checks the document. You cannot change the files or signatories while it is in review.', confirmLabel: 'Submit for review' }, async () => {
            await callBackend('/api/org/drkms/documents/submit-review', { documentId });
            setNotice({ tone: 'success', text: 'Submitted. Reviewers at this location can now see it in their review queue.' });
            reload();
        });

    const decide = (decision: 'verify' | 'return' | 'reject') =>
        run(
            'decide',
            async () => {
                await callBackend('/api/org/drkms/documents/review-decision', { documentId, decision, reason: reason.trim() });
                setReason('');
            },
            decision === 'verify' ? 'Verified. The signatories can now sign.' : decision === 'return' ? 'Returned to the author for changes.' : 'Rejected.',
        );

    const requestApproval = () =>
        ask({ title: 'Request publication approval', message: 'The approval request goes to the approvers set in the chart of authority for document publication. It covers this exact verified revision and its signatures.', confirmLabel: 'Send request', reason: { label: 'Note for approvers', minLength: 5, placeholder: 'What is new in this revision and why it should be published' } }, async (note) => {
            const packet = await callBackend<{ transactionCode: string; payload: { documentId: string; revision: string; contentFingerprint: string } }>('/api/org/drkms/documents/approval-packet', { documentId });
            if (!packet.transactionCode) throw new Error('The document publication transaction is not installed. Contact MEMS support.');
            let request: { id: string };
            try {
                request = await callBackend<{ id: string }>('/api/org/governance/approvals/request', { code: packet.transactionCode, payload: packet.payload, reason: note });
            } catch (err) {
                const m = messageOf(err);
                if (/not configured|authority policy/i.test(m))
                    throw new Error(`Publication approval is not set up yet. An organization administrator must configure transaction ${packet.transactionCode} (document publication) as approval-required with a reviewed chart of authority in Transaction governance. (${m})`);
                throw err;
            }
            await callBackend('/api/org/drkms/documents/publication-request', { documentId, approvalId: request.id });
            setNotice({ tone: 'success', text: 'Approval requested. The approvers see it in My workflow; you publish once it is approved.' });
            reload();
        });

    const publish = () =>
        ask({ title: 'Publish document', message: 'The verified, signed and approved revision becomes effective and immutable. A previous revision, if any, becomes superseded.', confirmLabel: 'Publish', acknowledge: 'I confirm this is the approved revision to publish.' }, async () => {
            const packet = await callBackend<{ payload: { revision: string; contentFingerprint: string } }>('/api/org/drkms/documents/approval-packet', { documentId });
            await callBackend('/api/org/drkms/documents/publish', { documentId, revision: packet.payload.revision, contentFingerprint: packet.payload.contentFingerprint, governanceApprovalId: data?.publication?.approvalId });
            setNotice({ tone: 'success', text: 'Published. The document is now effective.' });
            reload();
        });

    const revise = () =>
        ask({ title: 'Start a new revision', message: 'A new draft is created from this document. The current revision stays effective until the new one is reviewed, signed, approved and published.', confirmLabel: 'Create revision draft', reason: { label: 'Reason for the change', minLength: 12, placeholder: 'What changes and why' } }, async (r) => {
            const res = await callBackend<{ document: { documentId: string } }>('/api/org/drkms/documents/revise', { documentId, reason: r });
            onOpenDocument(res.document.documentId);
        });

    const openEffective = (fileId: string, signed: boolean) =>
        run(`eff-${fileId}`, async () => {
            const res = signed
                ? await callBackend<{ url: string }>('/api/org/drkms/documents/signed-copy', { documentId, fileId })
                : await callBackend<{ url: string }>('/api/org/drkms/documents/revision-download', { documentId, revisionId: effective.data?.revisionId, fileId });
            if (!res.url.startsWith('https://')) throw new Error('A secure link could not be created.');
            window.open(res.url, '_blank', 'noopener,noreferrer');
        });

    // ----- Next step (the one thing to do now) -----
    const next = (() => {
        if (!data || !d) return null;
        const c = data.can;
        const waiting = data.files.filter((f) => f.state !== 'released').length;
        if (c.submit) {
            if (!data.files.length && d.representation !== 'digital_structured') return { text: 'Upload the document file. Use the template outline to write it, then upload the PDF or Word file.', action: <Button onClick={() => setTab('Files')}><Upload className='h-4 w-4' />Upload file</Button> };
            if (waiting) return { text: `${waiting} file(s) are not released yet.${c.releaseUnscanned ? ' Scanning is off: you can release them.' : ' They are released when the malware scan reports them clean.'}`, action: <Button variant='secondary' onClick={() => setTab('Files')}>Open files</Button> };
            if (!data.signatures.length) return { text: 'Assign who signs the document off (for example the approver).', action: <Button onClick={() => { setTab('Sign-off'); setAdding(true); }}><PenLine className='h-4 w-4' />Add signatory</Button> };
            return { text: 'The draft is complete. Submit it for independent review.', action: <Button onClick={submit}><Send className='h-4 w-4' />Submit for review</Button> };
        }
        if (c.review) return { text: 'This document is waiting for your independent review.', action: <Button onClick={() => setTab('Review')}><UserCheck className='h-4 w-4' />Review now</Button> };
        if (c.sign) return { text: 'You are an assigned signatory. Read the verified files and sign.', action: <Button onClick={() => setTab('Sign-off')}><PenLine className='h-4 w-4' />Sign</Button> };
        if (c.publish) return { text: 'Publication is approved. Publish to make it effective.', action: <Button onClick={publish}><ShieldCheck className='h-4 w-4' />Publish</Button> };
        if (c.requestApproval && (!data.publication || !data.publication.current || ['rejected', 'returned', 'missing'].includes(data.publication.status))) return { text: 'All signatures are in. Request publication approval under the chart of authority.', action: <Button onClick={requestApproval}><Send className='h-4 w-4' />Request approval</Button> };
        if (d.status === 'in_review') return { text: 'Waiting for an independent reviewer at this location.', action: null };
        if (d.status === 'technical_verified') return data.publication ? { text: `Publication approval: ${data.publication.status.replace(/_/g, ' ')}.`, action: null } : { text: 'Waiting for all signatories to sign.', action: null };
        if (d.status === 'rejected') return { text: `Rejected by ${d.reviewer || 'the reviewer'}: ${d.reviewReason}`, action: null };
        if (c.revise) return { text: 'This revision is effective.', action: <Button variant='secondary' onClick={revise}><FilePlus2 className='h-4 w-4' />New revision</Button> };
        return null;
    })();

    return (
        <Screen
            title={d?.title || 'Document'}
            eyebrow={d ? `${d.classCode} · rev ${d.revision}` : ''}
            subtitle={d?.location ? `${d.location.name} · ${levelName(d.location.level)}` : undefined}
            onBack={onBack}
            actions={
                <button type='button' aria-label='Refresh' onClick={reload} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'>
                    <RefreshCw className='h-5 w-5' />
                </button>
            }
            toolbar={data ? <Segmented<Tab> label='Document sections' value={tab} onChange={(t) => { setTab(t); setNotice(null); }} options={tabs.map((t) => ({ value: t, label: t }))} /> : undefined}
        >
            {loading && !data && <Spinner />}
            {error && <Alert tone='error'>{error}</Alert>}
            {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
            {data && d && (
                <>
                    {tab === 'Overview' && (
                        <>
                            <div className='flex flex-wrap items-center gap-2'>
                                <StatusChip status={d.status} />
                                {d.templateName && <Badge tone='muted'>{d.templateName} template</Badge>}
                                <Badge tone={data.scanning.enabled ? 'brand' : 'muted'}>{data.scanning.enabled ? 'Malware scanning on' : 'Malware scanning off'}</Badge>
                            </div>
                            {next && (
                                <section className='flex flex-col gap-3 rounded-2xl border border-brand/40 bg-brand/5 p-4 sm:flex-row sm:items-center'>
                                    <Info className='hidden h-5 w-5 shrink-0 text-brandsoft sm:block' />
                                    <p className='min-w-0 flex-1 text-sm text-ink'>
                                        <span className='block text-xs font-medium uppercase tracking-wide text-brandsoft'>Next step</span>
                                        {next.text}
                                    </p>
                                    {next.action && <div className='shrink-0'>{next.action}</div>}
                                </section>
                            )}
                            <Stepper steps={data.steps} />
                            {d.status === 'draft' && d.reviewDecision === 'return' && <Alert tone='warn'>Returned by {d.reviewer || 'the reviewer'} on {shortDate(d.reviewedAt)}: {d.reviewReason}</Alert>}
                            <div className='grid gap-3 lg:grid-cols-2 lg:items-start'>
                            <Section title='Details'>
                                <dl className='divide-y divide-line'>
                                    <Fact label='Class'>{`${d.classCode} — ${className(d.classCode)}`}</Fact>
                                    <Fact label='Applies to'>{d.location ? `${d.location.name} (${levelName(d.location.level)})` : ''}</Fact>
                                    <Fact label='Author'>{d.author}</Fact>
                                    <Fact label='Created'>{shortDate(d.createdAt)}</Fact>
                                    {d.submittedAt && <Fact label='Submitted'>{shortDate(d.submittedAt)}</Fact>}
                                    {d.verifier && <Fact label='Verified by'>{`${d.verifier} · ${shortDate(d.verifiedAt)}`}</Fact>}
                                    {d.publishedAt && <Fact label='Published'>{shortDate(d.publishedAt)}</Fact>}
                                    {d.revisionReason && <Fact label='Reason for revision'>{d.revisionReason}</Fact>}
                                    <Fact label='Document ID'>
                                        <span className='break-all font-mono text-xs'>{d.id}</span>
                                    </Fact>
                                </dl>
                                {d.supersedesDocumentId && (
                                    <button type='button' onClick={() => onOpenDocument(d.supersedesDocumentId)} className='min-h-[44px] text-sm font-medium text-brandsoft'>
                                        Open the previous revision
                                    </button>
                                )}
                                {d.supersededByDocumentId && (
                                    <button type='button' onClick={() => onOpenDocument(d.supersededByDocumentId)} className='min-h-[44px] text-sm font-medium text-brandsoft'>
                                        Open the newer revision
                                    </button>
                                )}
                            </Section>
                            {d.outline.length > 0 && (
                                <Section
                                    title={`Template outline · ${d.templateName}`}
                                    action={
                                        <Button
                                            variant='secondary'
                                            onClick={() => downloadOutline({ title: d.title, classCode: d.classCode, documentId: d.id, revision: d.revision, location: d.location ? `${d.location.name} (${levelName(d.location.level)})` : '', author: d.author, templateName: d.templateName || 'Template', sections: d.outline, signOff: d.plannedSignOff })}
                                        >
                                            <FileDown className='h-4 w-4' />
                                            <span className='hidden sm:inline'>Word outline</span>
                                        </Button>
                                    }
                                >
                                    <ol className='space-y-2'>
                                        {d.outline.map((s, i) => (
                                            <li key={s.heading} className='rounded-xl bg-page p-3'>
                                                <p className='text-sm font-semibold text-ink'>
                                                    {i + 1}. {s.heading}
                                                </p>
                                                {s.guidance && <p className='text-xs text-muted'>{s.guidance}</p>}
                                            </li>
                                        ))}
                                    </ol>
                                </Section>
                            )}
                            </div>
                        </>
                    )}

                    {tab === 'Files' && (
                        <Section
                            title={`Source files · ${data.files.length}`}
                            action={
                                data.can.edit ? (
                                    <>
                                        <input ref={fileInput} type='file' multiple className='hidden' accept='.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg' onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
                                        <Button busy={busy === 'upload'} onClick={() => fileInput.current?.click()}>
                                            <Upload className='h-4 w-4' />
                                            Upload
                                        </Button>
                                    </>
                                ) : undefined
                            }
                        >
                            <p className='text-xs text-muted'>
                                PDF, Word, Excel, PowerPoint, PNG or JPEG, up to 8 MB each. Files are checked by their content, fingerprinted and stored privately; the original never changes.{' '}
                                {data.scanning.enabled ? 'Malware scanning is on: a file is released only when the scan reports it clean.' : 'Malware scanning is off in MEMS Admin, so files are released at upload.'}
                            </p>
                            {!data.files.length && <EmptyState icon={<Upload className='h-6 w-6' />} title='No file yet'>{data.can.edit ? 'Upload the finished document (download the Word outline from Overview to write it).' : 'The author has not uploaded a file.'}</EmptyState>}
                            <ul className='space-y-2'>
                                {data.files.map((f) => {
                                    const st = FILE_STATE[f.state];
                                    return (
                                        <li key={f.id} className='rounded-xl border border-line bg-page p-3'>
                                            <div className='flex min-w-0 items-start gap-3'>
                                                <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brandsoft'>
                                                    <FileIcon mime={f.mime} />
                                                </span>
                                                <div className='min-w-0 flex-1'>
                                                    <p className='break-words text-sm font-medium text-ink [overflow-wrap:anywhere]'>{f.name}</p>
                                                    <p className='text-xs text-muted'>
                                                        {TYPES[f.mime] ?? f.mime} · {fileSize(f.bytes)} · {shortDate(f.uploadedAt)}
                                                    </p>
                                                    <div className='mt-1 flex flex-wrap gap-1.5'>
                                                        <Badge tone={st.tone}>{st.label}</Badge>
                                                        {f.state === 'released' && <Badge tone='muted'>{f.scanned ? 'Scanned clean' : 'Not scanned (scanning off)'}</Badge>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className='mt-2 flex flex-wrap gap-2'>
                                                {f.state === 'released' && (
                                                    <Button variant='secondary' busy={busy === `open-${f.id}`} onClick={() => void openFile(f)}>
                                                        <ExternalLink className='h-4 w-4' />
                                                        Open
                                                    </Button>
                                                )}
                                                {f.state === 'waiting' && data.can.releaseUnscanned && (
                                                    <Button variant='secondary' onClick={() => releaseFile(f)}>
                                                        <ShieldAlert className='h-4 w-4' />
                                                        Release without scan
                                                    </Button>
                                                )}
                                                {data.can.edit && (
                                                    <Button variant='danger' onClick={() => removeFile(f)}>
                                                        <Trash2 className='h-4 w-4' />
                                                        Remove
                                                    </Button>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Section>
                    )}

                    {tab === 'Sign-off' && (
                        <Section
                            title={`Signatories · ${data.signatures.filter((s) => s.status === 'signed').length} of ${data.signatures.length} signed`}
                            action={
                                data.can.edit && !adding ? (
                                    <Button variant='secondary' onClick={() => setAdding(true)}>
                                        <Plus className='h-4 w-4' />
                                        Add
                                    </Button>
                                ) : undefined
                            }
                        >
                            <p className='text-xs text-muted'>The author chooses who signs. Signatories sign after the independent review, against the exact verified content. Every signature is authenticated and recorded.</p>
                            {adding && data.can.edit && (
                                <div className='space-y-3 rounded-xl border border-line bg-page p-3'>
                                    {users.loading && <Spinner />}
                                    <SelectField id='doc-signer' label='Signatory *' value={signer} onChange={(e) => setSigner(e.target.value)}>
                                        <option value=''>Choose a person</option>
                                        {(users.data?.users ?? []).map((u) => (
                                            <option key={u.uid} value={u.uid}>
                                                {`${u.firstName} ${u.lastName}`.trim() || u.uid}
                                            </option>
                                        ))}
                                    </SelectField>
                                    <Field id='doc-authority' label='Signs as *' value={authority} maxLength={80} placeholder='For example: Approved by (Plant Manager)' list='doc-authorities' onChange={(e) => setAuthority(e.target.value)} error={authority && authority.trim().length < 3 ? 'At least 3 characters.' : undefined} />
                                    <datalist id='doc-authorities'>
                                        {['Prepared by', 'Reviewed by', 'Technical review', 'Approved by', ...d.plannedSignOff].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
                                            <option key={v} value={v} />
                                        ))}
                                    </datalist>
                                    <button type='button' onClick={() => setAdvanced((a) => !a)} className='min-h-[44px] text-sm font-medium text-brandsoft'>
                                        {advanced ? 'Hide signature position' : 'Signature position on the page (optional)'}
                                    </button>
                                    {advanced && (
                                        <div className='grid grid-cols-2 gap-2'>
                                            {(
                                                [
                                                    ['page', 'Page', 1, 10000],
                                                    ['xPercent', 'From left %', 0, 90],
                                                    ['yPercent', 'From top %', 0, 90],
                                                    ['widthPercent', 'Width %', 10, 100 - position.xPercent],
                                                ] as const
                                            ).map(([k, label, min, max]) => (
                                                <Field key={k} id={`doc-pos-${k}`} label={label} type='number' inputMode='numeric' min={min} max={max} value={String(position[k])} onChange={(e) => setPosition((p) => ({ ...p, [k]: Math.min(max, Math.max(min, Number(e.target.value) || min)) }))} />
                                            ))}
                                        </div>
                                    )}
                                    <div className='flex gap-2'>
                                        <Button variant='secondary' onClick={() => setAdding(false)}>
                                            Cancel
                                        </Button>
                                        <Button className='flex-1' busy={busy === 'assign'} disabled={!signer || authority.trim().length < 3} onClick={assign}>
                                            <PenLine className='h-4 w-4' />
                                            Add signatory
                                        </Button>
                                    </div>
                                </div>
                            )}
                            {!data.signatures.length && !adding && <EmptyState icon={<PenLine className='h-6 w-6' />} title='No signatories yet'>{data.can.edit ? 'Add at least one person to sign the document off.' : 'The author has not assigned anyone.'}</EmptyState>}
                            <ul className='space-y-2'>
                                {data.signatures.map((s) => {
                                    const proof = proofs.data?.slots.find((p) => p.slotId === s.slotId)?.proof;
                                    const mine = data.can.sign && s.status === 'pending';
                                    return (
                                        <li key={s.slotId} className='rounded-xl border border-line bg-page p-3'>
                                            <div className='flex min-w-0 items-start justify-between gap-2'>
                                                <div className='min-w-0'>
                                                    <p className='text-sm font-semibold text-ink'>{s.label}</p>
                                                    <p className='truncate text-sm text-soft'>{s.signer}</p>
                                                    <p className='text-xs text-muted'>{s.status === 'signed' ? `Signed ${shortDate(s.signedAt)}` : 'Not signed yet'}</p>
                                                </div>
                                                <Badge tone={s.status === 'signed' ? 'brand' : 'muted'}>{s.status === 'signed' ? 'Signed' : 'Pending'}</Badge>
                                            </div>
                                            {(mine || (proof && s.status === 'signed')) && (
                                                <div className='mt-2 flex flex-wrap gap-2'>
                                                    {mine && (
                                                        <Button onClick={() => sign(s)}>
                                                            <PenLine className='h-4 w-4' />
                                                            Sign
                                                        </Button>
                                                    )}
                                                    {proof && (
                                                        <Button variant='secondary' busy={busy === `qr-${s.slotId}`} onClick={() => void run(`qr-${s.slotId}`, () => signingSheet(d.id, d.title, s, proof))}>
                                                            <QrCode className='h-4 w-4' />
                                                            Verification sheet
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            {data.can.sign && <p className='text-xs text-muted'>Open the files in the Files tab before signing.</p>}
                        </Section>
                    )}

                    {tab === 'Review' && (
                        <Section title='Independent review'>
                            {d.reviewDecision && (
                                <Alert tone={d.reviewDecision === 'verify' ? 'success' : d.reviewDecision === 'reject' ? 'error' : 'warn'}>
                                    {d.reviewDecision === 'verify' ? 'Verified' : d.reviewDecision === 'reject' ? 'Rejected' : 'Returned'} by {d.reviewer} on {shortDate(d.reviewedAt)}: {d.reviewReason}
                                </Alert>
                            )}
                            {data.can.review ? (
                                <>
                                    <p className='text-sm text-soft'>Open every file in the Files tab and check the content, the template sections and the signatories. You cannot review a document you wrote.</p>
                                    <TextArea id='doc-review-reason' label='Review comments *' rows={4} maxLength={2000} value={reason} placeholder='What you checked, and what must change if you return it' onChange={(e) => setReason(e.target.value)} />
                                    <p className={`text-xs ${reason && reason.trim().length < 10 ? 'text-red-500' : 'text-muted'}`}>{reason.trim().length}/10 characters minimum</p>
                                    <div className='grid gap-2 sm:grid-cols-3'>
                                        <Button busy={busy === 'decide'} disabled={reason.trim().length < 10} onClick={() => void decide('verify')}>
                                            <ShieldCheck className='h-4 w-4' />
                                            Verify
                                        </Button>
                                        <Button variant='secondary' disabled={!!busy || reason.trim().length < 10} onClick={() => void decide('return')}>
                                            <Undo2 className='h-4 w-4' />
                                            Return for changes
                                        </Button>
                                        <Button variant='danger' disabled={!!busy || reason.trim().length < 10} onClick={() => void decide('reject')}>
                                            <XCircle className='h-4 w-4' />
                                            Reject
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                d.status === 'in_review' && <p className='text-sm text-muted'>Waiting for an independent reviewer at {d.location?.name ?? 'this location'}.</p>
                            )}
                        </Section>
                    )}

                    {tab === 'Publish' && (
                        <Section title='Approval and publication'>
                            <p className='text-sm text-soft'>Publication follows the chart of authority configured for document publication in Transaction governance. The approval covers this exact verified revision; any change after approval needs a new request.</p>
                            {data.publication ? (
                                <dl className='divide-y divide-line'>
                                    <Fact label='Approval request'>
                                        <span className='break-all font-mono text-xs'>{data.publication.approvalId}</span>
                                    </Fact>
                                    <Fact label='Status'>{data.publication.status.replace(/_/g, ' ')}</Fact>
                                    <Fact label='Requested'>{shortDate(data.publication.requestedAt)}</Fact>
                                    {!data.publication.current && <Fact label='Note'>The document changed after the request: request approval again.</Fact>}
                                </dl>
                            ) : (
                                <p className='text-sm text-muted'>No approval requested yet.</p>
                            )}
                            <div className='flex flex-wrap gap-2'>
                                {data.can.requestApproval && (!data.publication || !data.publication.current || ['rejected', 'returned', 'missing'].includes(data.publication.status)) && (
                                    <Button onClick={requestApproval}>
                                        <Send className='h-4 w-4' />
                                        Request approval
                                    </Button>
                                )}
                                {data.can.publish && (
                                    <Button onClick={publish}>
                                        <ShieldCheck className='h-4 w-4' />
                                        Publish
                                    </Button>
                                )}
                            </div>
                            {d.status === 'technical_verified' && !data.can.requestApproval && !data.can.publish && <p className='text-xs text-muted'>Only the author, holding the publication right at this location, requests approval once every signatory has signed.</p>}
                        </Section>
                    )}

                    {tab === 'History' && (
                        <>
                            {d.status === 'effective' && (
                                <Section title='Effective files' action={data.can.revise ? <Button variant='secondary' onClick={revise}><FilePlus2 className='h-4 w-4' />New revision</Button> : undefined}>
                                    {effective.loading && <Spinner />}
                                    {effective.error && <Alert tone='error'>{effective.error}</Alert>}
                                    {effective.data?.files.map((f) => (
                                        <div key={f.fileId} className='flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-page p-3'>
                                            <FileIcon mime={f.mime} className='h-5 w-5 shrink-0 text-brandsoft' />
                                            <p className='min-w-0 flex-1 break-all text-sm text-ink'>
                                                {f.name} <span className='text-xs text-muted'>· {fileSize(f.bytes)}</span>
                                            </p>
                                            <Button variant='secondary' busy={busy === `eff-${f.fileId}`} onClick={() => void openEffective(f.fileId, false)}>
                                                <Download className='h-4 w-4' />
                                                Open
                                            </Button>
                                            {f.mime === 'application/pdf' && (
                                                <Button variant='secondary' disabled={!!busy} onClick={() => void openEffective(f.fileId, true)}>
                                                    <QrCode className='h-4 w-4' />
                                                    QR-signed PDF
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </Section>
                            )}
                            <Section title='Published revisions'>
                                {history.loading && <Spinner />}
                                {history.error && <Alert tone='error'>{history.error}</Alert>}
                                {history.data && !history.data.revisions.length && <p className='text-sm text-muted'>No published revisions yet.</p>}
                                <ul className='space-y-2'>
                                    {history.data?.revisions.map((r) => (
                                        <li key={r.revisionId} className='rounded-xl bg-page p-3'>
                                            <p className='text-sm font-semibold text-ink'>
                                                Revision {r.revision} · {r.status}
                                            </p>
                                            <p className='text-xs text-muted'>Published {shortDate(r.publishedAt)}</p>
                                            <p className='break-all font-mono text-[11px] text-muted'>SHA-256 {r.fingerprint}</p>
                                        </li>
                                    ))}
                                </ul>
                            </Section>
                        </>
                    )}
                </>
            )}
            {sheet}
        </Screen>
    );
}
