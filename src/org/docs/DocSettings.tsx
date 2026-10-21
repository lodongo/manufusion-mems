import { useEffect, useState } from 'react';
import { Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import { callBackend } from '../../lib/backend';
import { Screen, messageOf } from '../../components/screen';
import { Alert, Field } from '../../components/ui';
import { Badge, Button, Toggle } from '../../admin/kit';
import { CLASS_NAMES } from './docUi';

// Organization document controls (ADM.document_config): enabled classes, the default review cycle and the DOC
// sections shown in the menu. Malware scanning is set by MEMS Admin and only shown here.

export const DOC_SECTIONS: Array<[string, string, string]> = [
    ['register', 'Documents', 'Controlled documents: create, review, sign, approve, publish.'],
    ['review', 'Review & approvals', 'Shortcut to the review queue.'],
    ['engineering', 'Engineering & equipment library', 'Link documents to assets and equipment models.'],
    ['sds', 'SHEQ SDS / MSDS', 'Safety data sheets register.'],
    ['rca', 'Digital RCA & investigations', 'Structured root-cause analysis (DMAIC).'],
    ['knowledge', 'Knowledge & troubleshooting', 'Equipment knowledge and troubleshooting search.'],
    ['forms', 'Digital forms & records', 'Online form templates, records and their sign-off.'],
];

export default function DocSettings({
    config,
    scanningEnabled,
    onSaved,
}: {
    config: { enabledClassCodes: string[]; defaultReviewMonths: number; enabledSubmodules?: string[] };
    scanningEnabled: boolean;
    onSaved: () => void;
}) {
    const [classes, setClasses] = useState<string[]>(config.enabledClassCodes);
    const [months, setMonths] = useState(String(config.defaultReviewMonths || 24));
    const [sections, setSections] = useState<string[]>(config.enabledSubmodules ?? DOC_SECTIONS.map(([k]) => k));
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    useEffect(() => {
        setClasses(config.enabledClassCodes);
        setMonths(String(config.defaultReviewMonths || 24));
        setSections(config.enabledSubmodules ?? DOC_SECTIONS.map(([k]) => k));
    }, [config]);

    const m = Number(months);
    const errors: string[] = [];
    if (!/^\d+$/.test(months) || m < 1 || m > 120) errors.push('Review cycle: enter whole months from 1 to 120.');
    if (!classes.length) errors.push('Enable at least one document class.');
    if (!sections.includes('register')) errors.push('The Documents section must stay enabled.');
    const dirty = JSON.stringify([...classes].sort()) !== JSON.stringify([...config.enabledClassCodes].sort()) || m !== config.defaultReviewMonths || JSON.stringify([...sections].sort()) !== JSON.stringify([...(config.enabledSubmodules ?? DOC_SECTIONS.map(([k]) => k))].sort());

    const save = async () => {
        if (errors.length || !dirty) return;
        setBusy(true);
        setNotice(null);
        try {
            await callBackend('/api/org/drkms/configure', { enabledClassCodes: classes, defaultReviewMonths: m, enabledSubmodules: sections });
            setNotice({ tone: 'success', text: 'Document settings saved.' });
            onSaved();
        } catch (err) {
            setNotice({ tone: 'error', text: messageOf(err) });
        } finally {
            setBusy(false);
        }
    };
    const flip = (list: string[], set: (v: string[]) => void, key: string, on: boolean) => set(on ? [...list, key] : list.filter((x) => x !== key));

    return (
        <Screen
            title='Document settings'
            subtitle='Organization document controls'
            actions={
                <Button busy={busy} disabled={!!errors.length || !dirty} onClick={() => void save()}>
                    <Save className='h-4 w-4' />
                    Save
                </Button>
            }
        >
            {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
            {errors.length > 0 && dirty && <Alert tone='warn'>{errors.join(' ')}</Alert>}
            <section className='flex items-start gap-3 rounded-2xl border border-line bg-panel p-4'>
                {scanningEnabled ? <ShieldCheck className='h-5 w-5 shrink-0 text-brandsoft' /> : <ShieldAlert className='h-5 w-5 shrink-0 text-amber-500' />}
                <div className='min-w-0 text-sm'>
                    <p className='font-semibold text-ink'>
                        Malware scanning <Badge tone={scanningEnabled ? 'brand' : 'warn'}>{scanningEnabled ? 'On' : 'Off'}</Badge>
                    </p>
                    <p className='text-muted'>
                        {scanningEnabled
                            ? 'Uploaded files are released only when the trusted scanner reports them clean.'
                            : 'Uploaded files are released at once after the file-type and fingerprint checks. MEMS Admin turns scanning on when the scanner service is running.'}
                    </p>
                </div>
            </section>
            <section className='space-y-3 rounded-2xl border border-line bg-panel p-4'>
                <h2 className='text-xs font-medium uppercase tracking-wide text-muted'>Review cycle</h2>
                <Field id='doc-months' label='Default review cycle (months)' inputMode='numeric' value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, '').slice(0, 3))} hint='Effective documents are listed as due for review this many months after publication.' />
            </section>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                <h2 className='text-xs font-medium uppercase tracking-wide text-muted'>Sections in the menu</h2>
                {DOC_SECTIONS.map(([key, label, text]) => (
                    <div key={key} className='flex min-h-[52px] items-center gap-3'>
                        <div className='min-w-0 flex-1'>
                            <p className='text-sm font-medium text-ink'>{label}</p>
                            <p className='text-xs text-muted'>{text}</p>
                        </div>
                        <Toggle label={label} checked={sections.includes(key)} disabled={key === 'register'} onChange={(on) => flip(sections, setSections, key, on)} />
                    </div>
                ))}
            </section>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                <h2 className='text-xs font-medium uppercase tracking-wide text-muted'>Document classes people may create · {classes.length}</h2>
                <div className='grid gap-2 sm:grid-cols-2'>
                    {Object.entries(CLASS_NAMES).map(([code, label]) => (
                        <label key={code} className='flex min-h-[48px] items-center gap-3 rounded-xl border border-line bg-page px-3'>
                            <input type='checkbox' className='h-5 w-5 shrink-0 accent-[rgb(var(--c-brand))]' checked={classes.includes(code)} onChange={(e) => flip(classes, setClasses, code, e.target.checked)} />
                            <span className='min-w-0 text-sm text-ink'>
                                <span className='font-mono text-xs text-muted'>{code}</span> {label}
                            </span>
                        </label>
                    ))}
                </div>
            </section>
        </Screen>
    );
}
