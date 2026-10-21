import { useMemo, useState } from 'react';
import { ArrowLeft, Check, FilePlus2, FileText } from 'lucide-react';
import Sheet from '../../components/Sheet';
import { Alert, Field, SelectField } from '../../components/ui';
import { Button } from '../../admin/kit';
import { messageOf } from '../../components/screen';
import { callBackend } from '../../lib/backend';
import { LEVELS, className, levelName, type DocTemplate, type ScopeNode } from './docUi';

// New controlled document in two steps: 1 choose a template (or a blank document), 2 title, class and the location
// it applies to. The server checks the class, the template, the location and the person's authority there.

export default function NewDocumentSheet({
    templates,
    enabledClasses,
    locations,
    onClose,
    onCreated,
}: {
    templates: DocTemplate[];
    enabledClasses: string[];
    locations: ScopeNode[];
    onClose: () => void;
    onCreated: (documentId: string) => void;
}) {
    const usable = templates.filter((t) => !t.classCode || enabledClasses.includes(t.classCode));
    const [step, setStep] = useState<1 | 2>(1);
    const [template, setTemplate] = useState<DocTemplate | null>(null);
    const [title, setTitle] = useState('');
    const [classCode, setClassCode] = useState('');
    const [level, setLevel] = useState(() => LEVELS.find(([k]) => locations.some((n) => n.level === k))?.[0] ?? 'site');
    const [nodeId, setNodeId] = useState('');
    const [touched, setTouched] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const levelNodes = useMemo(() => locations.filter((n) => n.level === level).sort((a, b) => a.name.localeCompare(b.name)), [locations, level]);
    const pick = (t: DocTemplate) => {
        setTemplate(t);
        setClassCode(t.classCode || enabledClasses[0] || '');
        setStep(2);
    };
    const problems: Record<string, string> = {};
    if (title.trim().length < 3) problems.title = 'Give the document a title of at least 3 characters.';
    if (title.trim().length > 200) problems.title = 'Use at most 200 characters.';
    if (!classCode) problems.classCode = 'Choose the document class.';
    if (!nodeId) problems.nodeId = 'Choose where the document applies.';
    const ok = Object.keys(problems).length === 0;

    const create = async () => {
        setTouched(true);
        if (!ok || busy) return;
        setBusy(true);
        setError('');
        try {
            const res = await callBackend<{ document: { documentId: string } }>('/api/org/drkms/documents/create-draft', {
                title: title.trim(),
                classCode,
                scopeNodeId: nodeId,
                ...(template && template.code !== 'TPL-BLANK' ? { templateCode: template.code } : {}),
            });
            onCreated(res.document.documentId);
        } catch (err) {
            setError(messageOf(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet
            title={step === 1 ? 'New document · choose a template' : `New ${template?.name.toLowerCase() || 'document'}`}
            onClose={() => !busy && onClose()}
            footer={
                step === 2 ? (
                    <>
                        <Button variant='secondary' onClick={() => setStep(1)} disabled={busy} className='shrink-0'>
                            <ArrowLeft className='h-4 w-4' />
                            Back
                        </Button>
                        <Button className='flex-1' busy={busy} disabled={touched && !ok} onClick={() => void create()}>
                            <FilePlus2 className='h-4 w-4' />
                            Create draft
                        </Button>
                    </>
                ) : undefined
            }
        >
            {step === 1 && (
                <>
                    <p className='text-sm text-muted'>A template gives the sections the document must contain and who usually signs it off. You can download it as a Word outline after creating the draft.</p>
                    {!locations.length && <Alert tone='warn'>You hold the document right at no organizational location yet, so you cannot create documents. Ask your administrator.</Alert>}
                    <div className='grid gap-2 sm:grid-cols-2'>
                        {usable.map((t) => (
                            <button
                                key={t.code}
                                type='button'
                                disabled={!locations.length}
                                onClick={() => pick(t)}
                                className='flex min-h-[72px] min-w-0 items-start gap-3 rounded-xl border border-line bg-page p-3 text-left active:bg-panel disabled:opacity-50'
                            >
                                <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brandsoft'>
                                    <FileText className='h-5 w-5' />
                                </span>
                                <span className='min-w-0'>
                                    <span className='block text-sm font-semibold text-ink'>
                                        {t.name}
                                        {t.classCode && <span className='ml-1 font-mono text-xs font-normal text-muted'>{t.classCode}</span>}
                                    </span>
                                    <span className='line-clamp-2 block text-xs text-muted'>{t.purpose}</span>
                                    {t.sections.length > 0 && <span className='mt-0.5 block text-[11px] text-muted'>{t.sections.length} sections · review every {t.reviewMonths} months</span>}
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
            {step === 2 && template && (
                <>
                    <div className='rounded-xl bg-page p-3 text-sm'>
                        <p className='font-semibold text-ink'>
                            <Check className='mr-1 inline h-4 w-4 text-brandsoft' />
                            {template.name}
                        </p>
                        <p className='text-xs text-muted'>{template.sections.length ? template.sections.map((s) => s.heading).join(' · ') : template.purpose}</p>
                    </div>
                    {error && <Alert tone='error'>{error}</Alert>}
                    <Field id='doc-title' label='Title *' value={title} maxLength={200} placeholder='For example: Preventive maintenance planning procedure' error={touched ? problems.title : undefined} onChange={(e) => setTitle(e.target.value)} />
                    <SelectField id='doc-class' label='Document class *' value={classCode} disabled={!!template.classCode} error={touched ? problems.classCode : undefined} hint={template.classCode ? 'Set by the template.' : undefined} onChange={(e) => setClassCode(e.target.value)}>
                        <option value=''>Choose a class</option>
                        {enabledClasses.map((c) => (
                            <option key={c} value={c}>
                                {c} — {className(c)}
                            </option>
                        ))}
                    </SelectField>
                    <SelectField
                        id='doc-level'
                        label='Applies at'
                        value={level}
                        onChange={(e) => {
                            setLevel(e.target.value);
                            setNodeId('');
                        }}
                    >
                        {LEVELS.filter(([k]) => locations.some((n) => n.level === k)).map(([k, v]) => (
                            <option key={k} value={k}>
                                {v}
                            </option>
                        ))}
                    </SelectField>
                    <SelectField id='doc-location' label={`${levelName(level)} *`} value={nodeId} error={touched ? problems.nodeId : undefined} hint='Only locations where you may register documents are listed.' onChange={(e) => setNodeId(e.target.value)}>
                        <option value=''>Choose a location</option>
                        {levelNodes.map((n) => (
                            <option key={n.id} value={n.id}>
                                {n.name}
                            </option>
                        ))}
                    </SelectField>
                </>
            )}
        </Sheet>
    );
}
