import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Badge, Button, Card, Spinner, TextArea, useLoad } from './kit';
import { fmtDate } from './format';

// MEMS Admin → Modules → DOC: malware scanning of uploaded document files. On: files stay quarantined until the
// trusted scanner reports them clean. Off (default until the scanner service runs): files are released after the
// file-type and fingerprint checks. Only a super admin changes it, with a reason; every change is audited.

interface Policy { enabled: boolean; reason: string; updatedBy: string; updatedAt: string; version: number; scannerConfigured: boolean }

export default function DocScanningCard({ isSuper }: { isSuper: boolean }) {
    const { data, loading, error, reload } = useLoad(() => callBackend<{ policy: Policy }>('/api/admin/drkms/scanning/get', {}), []);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState('');
    const p = data?.policy;
    const change = async () => {
        if (!p || reason.trim().length < 10) return;
        setBusy(true);
        setProblem('');
        try {
            await callBackend('/api/admin/drkms/scanning/set', { enabled: !p.enabled, reason: reason.trim() });
            setReason('');
            reload();
        } catch (err) {
            setProblem(err instanceof Error ? err.message : 'Could not change the setting.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <Card className='space-y-3'>
            <div className='flex items-center gap-2'>
                {p?.enabled ? <ShieldCheck className='h-5 w-5 text-emerald-400' /> : <ShieldAlert className='h-5 w-5 text-amber-400' />}
                <h2 className='flex-1 font-semibold text-white'>Malware scanning of document uploads</h2>
                {p && <Badge tone={p.enabled ? 'brand' : 'warn'}>{p.enabled ? 'On' : 'Off'}</Badge>}
            </div>
            {loading && <Spinner />}
            {error && <Alert tone='error'>{error}</Alert>}
            {p && (
                <>
                    <p className='text-sm text-slate-300'>
                        {p.enabled
                            ? 'Uploaded document files stay quarantined until the trusted scanner signs a clean verdict. Nothing can be reviewed, signed or published before.'
                            : 'Scanning is bypassed: uploads are released at once after the file-type (header) check, size limit and SHA-256 fingerprint, and are stored privately and unchangeably. Each release is marked "not scanned" and audited.'}
                    </p>
                    {!p.scannerConfigured && <Alert tone='warn'>The scanner service is not connected to this environment yet. If you turn scanning on now, uploads will wait in quarantine until it is.</Alert>}
                    {p.updatedAt && (
                        <p className='text-xs text-slate-500'>
                            Last changed {fmtDate(p.updatedAt)} by {p.updatedBy}: {p.reason}
                        </p>
                    )}
                    {isSuper ? (
                        <>
                            <TextArea id='doc-scan-reason' label={`Reason for turning scanning ${p.enabled ? 'off' : 'on'} *`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                            {problem && <Alert tone='error'>{problem}</Alert>}
                            <Button variant={p.enabled ? 'danger' : 'primary'} busy={busy} disabled={reason.trim().length < 10} onClick={() => void change()}>
                                {p.enabled ? 'Turn scanning off' : 'Turn scanning on'}
                            </Button>
                        </>
                    ) : (
                        <p className='text-xs text-slate-500'>Only a MEMS super admin can change this setting.</p>
                    )}
                </>
            )}
        </Card>
    );
}
