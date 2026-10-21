import { useState } from 'react';
import { ExternalLink, PenLine, PenTool } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';
import { Alert } from '../components/ui';
import DigitalFormSignatures from './DigitalFormSignatures';
import { EmptyState, StatusChip, shortDate } from './docs/docUi';

// Signatures assigned to me: read the verified source (short-lived private links), then sign with an explicit,
// authenticated attestation bound to the verified content. Form signatures are on the second tab.

type Assignment = { documentId: string; slotId: string; label: string; title: string; documentStatus: string; signatureStatus: string; signedAt: string };
type View = 'documents' | 'forms';

export default function MyDocSignatures() {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ assignments: Assignment[] }>('/api/org/drkms/signatures/my-inbox', {}), []);
    const { ask, sheet } = useConfirm();
    const [view, setView] = useState<View>('documents');
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const [files, setFiles] = useState<Record<string, Array<{ fileId: string; name: string; url: string }>>>({});
    const rows = data?.assignments ?? [];
    const pending = rows.filter((r) => r.signatureStatus === 'pending');

    const preview = async (row: Assignment) => {
        setBusy(`${row.slotId}-preview`);
        setNotice(null);
        try {
            const res = await callBackend<{ files: Array<{ fileId: string; name: string; url: string }> }>('/api/org/drkms/signatures/preview', { documentId: row.documentId, slotId: row.slotId });
            setFiles((p) => ({ ...p, [row.slotId]: res.files }));
        } catch (err) {
            setNotice({ tone: 'error', text: messageOf(err) });
        } finally {
            setBusy('');
        }
    };
    const sign = (row: Assignment) =>
        ask(
            {
                title: `Sign as ${row.label}`,
                message: <>Sign <strong className='text-ink'>{row.title}</strong>. Your signature is bound to the exact verified content; a later change needs a new revision.</>,
                confirmLabel: 'Sign document',
                acknowledge: 'I have read the verified document and I sign it under my own authenticated account.',
            },
            async () => {
                await callBackend('/api/org/drkms/signatures/sign', { documentId: row.documentId, slotId: row.slotId, attest: true });
                setNotice({ tone: 'success', text: 'Signed. The document still needs its publication approval.' });
                reload();
            },
        );

    return (
        <Screen
            title='My signatures'
            subtitle='Documents and forms assigned to me for sign-off'
            toolbar={
                <Segmented<View>
                    label='Signature type'
                    value={view}
                    onChange={setView}
                    options={[
                        { value: 'documents', label: 'Documents', count: pending.length },
                        { value: 'forms', label: 'Forms' },
                    ]}
                />
            }
        >
            {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
            {view === 'forms' && <DigitalFormSignatures />}
            {view === 'documents' && (
                <>
                    {loading && <Spinner />}
                    {error && <Alert tone='error'>{error}</Alert>}
                    {!loading && !error && !rows.length && <EmptyState icon={<PenTool className='h-6 w-6' />} title='Nothing to sign'>Documents assigned to you for sign-off appear here.</EmptyState>}
                    <ul className='space-y-2'>
                        {rows.map((r) => {
                            const ready = r.signatureStatus === 'pending' && r.documentStatus === 'technical_verified';
                            return (
                                <li key={`${r.documentId}-${r.slotId}`} className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                                    <div className='flex min-w-0 items-start justify-between gap-2'>
                                        <div className='min-w-0'>
                                            <p className='break-words text-sm font-semibold text-ink'>{r.title}</p>
                                            <p className='text-xs text-muted'>Sign as: {r.label}</p>
                                        </div>
                                        <Badge tone={r.signatureStatus === 'signed' ? 'brand' : ready ? 'warn' : 'muted'}>{r.signatureStatus === 'signed' ? `Signed ${shortDate(r.signedAt)}` : ready ? 'Ready to sign' : 'Waiting'}</Badge>
                                    </div>
                                    <div className='flex flex-wrap items-center gap-2'>
                                        <StatusChip status={r.documentStatus} />
                                        {r.signatureStatus === 'pending' && !ready && <span className='text-xs text-muted'>You can sign after the independent review.</span>}
                                    </div>
                                    {ready && (
                                        <div className='flex flex-wrap gap-2'>
                                            <Button variant='secondary' busy={busy === `${r.slotId}-preview`} onClick={() => void preview(r)}>
                                                <ExternalLink className='h-4 w-4' />
                                                Read the document
                                            </Button>
                                            <Button onClick={() => sign(r)}>
                                                <PenLine className='h-4 w-4' />
                                                Sign
                                            </Button>
                                        </div>
                                    )}
                                    {files[r.slotId]?.map((f) => (
                                        <a key={f.fileId} href={f.url} target='_blank' rel='noopener noreferrer' className='flex min-h-[44px] items-center gap-2 break-all rounded-xl border border-line bg-page px-3 text-sm text-brandsoft'>
                                            <ExternalLink className='h-4 w-4 shrink-0' />
                                            {f.name}
                                        </a>
                                    ))}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
            {sheet}
        </Screen>
    );
}
