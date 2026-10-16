import { useState } from 'react';
import { BookOpen, Pencil } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, messageOf, useConfirm } from '../components/screen';

// Role documentation: the rules that go with a security role. Guidance for people, never part of access control.
// Plain text only (shown as text, never as HTML). Every save is a new version with a reason, audited on the server.
// It is flagged as out of date when the role's permissions change or the review date passes.

export interface RoleDoc {
    version: number;
    purpose: string;
    audience: string;
    allows: string;
    never: string;
    limits: string;
    rules: string;
    nextReview: string;
    updatedAt: string;
    updatedBy: string;
    status: 'missing' | 'outdated' | 'current';
}
export interface DocGroups {
    module: string;
    items: string[];
}
interface DocResponse {
    role: { id: string; name: string; description: string; permissionCount: number; system: boolean };
    permissions: DocGroups[];
    doc: RoleDoc | null;
    canEdit: boolean;
    history: Array<{ version: number; at: string; by: string; reason: string }>;
}

export const FIELD_DEFS = [
    { key: 'purpose', label: 'Purpose', max: 400, min: 10, rows: 3, hint: 'Why this role exists.' },
    { key: 'audience', label: 'Who should hold this role', max: 400, min: 0, rows: 3, hint: 'Job roles or situations it is meant for.' },
    { key: 'allows', label: 'What the role allows', max: 1200, min: 10, rows: 5, hint: 'In plain words, what a holder can do.' },
    { key: 'never', label: 'Must never be combined with', max: 800, min: 0, rows: 3, hint: 'Duties that must stay with someone else.' },
    { key: 'limits', label: 'Approval and cost limits', max: 800, min: 0, rows: 3, hint: 'Amount limits and who approves above them.' },
    { key: 'rules', label: 'Rules for the people who hold it', max: 4000, min: 0, rows: 8, hint: 'Conduct, review and escalation rules.' },
] as const;
type Key = (typeof FIELD_DEFS)[number]['key'];

export function DocStatusBadge({ status }: { status: RoleDoc['status'] }) {
    return status === 'current' ? <Badge tone='brand'>Documented</Badge> : status === 'outdated' ? <Badge tone='warn'>Needs review</Badge> : <Badge tone='danger'>Missing</Badge>;
}

/** Read-only rendering, shared with My access. */
export function DocView({ doc }: { doc: RoleDoc }) {
    return (
        <div className='space-y-3'>
            {FIELD_DEFS.map((f) =>
                doc[f.key] ? (
                    <div key={f.key}>
                        <h3 className='text-xs font-semibold uppercase tracking-wide text-muted'>{f.label}</h3>
                        <p className='mt-1 whitespace-pre-wrap break-words text-sm text-ink'>{doc[f.key]}</p>
                    </div>
                ) : null
            )}
            <p className='text-xs text-muted'>
                Version {doc.version} · {fmtDate(doc.updatedAt)}
                {doc.updatedBy ? ` · ${doc.updatedBy}` : ''}
                {doc.nextReview ? ` · review by ${fmtDate(doc.nextReview)}` : ''}
            </p>
        </div>
    );
}

export function PermissionGroups({ groups }: { groups: DocGroups[] }) {
    if (!groups.length) return <p className='text-sm text-muted'>No permissions.</p>;
    return (
        <div className='space-y-2'>
            {groups.map((g) => (
                <details key={g.module} className='rounded-xl border border-line bg-page'>
                    <summary className='flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-medium text-ink'>
                        <span>{g.module}</span>
                        <span className='text-xs text-muted'>{g.items.length}</span>
                    </summary>
                    <ul className='list-disc space-y-1 px-8 pb-3 text-sm text-soft'>
                        {g.items.map((i) => (
                            <li key={i}>{i}</li>
                        ))}
                    </ul>
                </details>
            ))}
        </div>
    );
}

export default function RoleDocs({ roleId, back }: { roleId: string; back: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<DocResponse>('/api/org/roles/docs/get', { id: roleId }));
    const [editing, setEditing] = useState(false);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the documentation.'}</Alert>;
    if (editing) return <Editor data={data} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />;
    const { role, doc } = data;
    return (
        <Screen
            title={role.name}
            eyebrow='Role rules'
            subtitle={role.description || undefined}
            onBack={() => navigate(back)}
            actions={
                data.canEdit ? (
                    <Button onClick={() => setEditing(true)}>
                        <Pencil className='h-4 w-4' />
                        <span>{doc ? 'Edit' : 'Write'}</span>
                    </Button>
                ) : undefined
            }
        >
            {doc?.status === 'outdated' && <Alert tone='warn'>The permissions of this role changed since the rules were last reviewed, or the review date has passed. Check that the rules still match, then save to confirm.</Alert>}
            {!doc && <Alert tone='warn'>No rules have been written for this role yet.{data.canEdit ? '' : ' Ask a role administrator to document it.'}</Alert>}
            {doc && (
                <section className='space-y-3 rounded-2xl border border-line bg-panel p-4'>
                    <div className='flex items-center justify-between gap-2'>
                        <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'><BookOpen className='h-4 w-4' /> Rules</h2>
                        <DocStatusBadge status={doc.status} />
                    </div>
                    <DocView doc={doc} />
                </section>
            )}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                <h2 className='text-sm font-semibold text-ink'>Permissions in this role {role.permissionCount >= 0 ? `(${role.permissionCount})` : ''}</h2>
                <PermissionGroups groups={data.permissions} />
            </section>
            {data.history.length > 0 && (
                <section className='space-y-2 rounded-2xl border border-line bg-panel p-4'>
                    <h2 className='text-sm font-semibold text-ink'>Version history</h2>
                    <ul className='divide-y divide-line'>
                        {data.history.map((h) => (
                            <li key={h.version} className='py-2 text-sm'>
                                <p className='text-ink'>Version {h.version} · {fmtDate(h.at)}{h.by ? ` · ${h.by}` : ''}</p>
                                <p className='whitespace-pre-wrap break-words text-xs text-muted'>{h.reason}</p>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </Screen>
    );
}

function Editor({ data, onCancel, onSaved }: { data: DocResponse; onCancel: () => void; onSaved: () => void }) {
    const d = data.doc;
    const [v, setV] = useState<Record<Key, string>>({ purpose: d?.purpose ?? '', audience: d?.audience ?? '', allows: d?.allows ?? '', never: d?.never ?? '', limits: d?.limits ?? '', rules: d?.rules ?? '' });
    const [nextReview, setNextReview] = useState(d?.nextReview ?? '');
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState('');
    const { ask, sheet } = useConfirm();
    const today = new Date().toISOString().slice(0, 10);

    const problems: Record<string, string> = {};
    for (const f of FIELD_DEFS) {
        const n = v[f.key].trim().length;
        if (n < f.min) problems[f.key] = `Write at least ${f.min} characters.`;
        else if (v[f.key].length > f.max) problems[f.key] = `Use ${f.max} characters or fewer.`;
    }
    if (nextReview && nextReview < today) problems.nextReview = 'The review date cannot be in the past.';
    const invalid = Object.keys(problems).length > 0;

    const submit = () => {
        setSubmitted(true);
        setError('');
        if (invalid) return;
        ask(
            { title: 'Save role rules?', message: 'A new version is stored with your reason and recorded in the audit trail. Earlier versions are kept.', confirmLabel: 'Save rules', reason: { label: 'Reason for this change', minLength: 10 } },
            async (reason) => {
                try {
                    await callBackend('/api/org/roles/docs/save', { id: data.role.id, ...v, nextReview, reason, expectedVersion: d?.version ?? 0 });
                    onSaved();
                } catch (err) {
                    setError(messageOf(err));
                    throw err;
                }
            }
        );
    };

    return (
        <Screen
            title={`Rules: ${data.role.name}`}
            eyebrow='Role rules'
            onBack={onCancel}
            actions={<Button onClick={submit}>Save</Button>}
        >
            <Alert tone='info'>Plain text only. Do not write passwords, keys or personal data here: everyone who holds this role can read it.</Alert>
            {error && <Alert tone='error'>{error}</Alert>}
            {FIELD_DEFS.map((f) => (
                <label key={f.key} htmlFor={`rd-${f.key}`} className='block'>
                    <span className='mb-1 block text-sm text-soft'>{f.label}{f.min > 0 ? ' *' : ''}</span>
                    <textarea
                        id={`rd-${f.key}`}
                        rows={f.rows}
                        maxLength={f.max}
                        value={v[f.key]}
                        onChange={(e) => setV((p) => ({ ...p, [f.key]: e.target.value }))}
                        aria-invalid={submitted && problems[f.key] ? true : undefined}
                        className={`w-full rounded-xl border bg-panel p-3 text-base text-ink placeholder:text-muted focus:outline-none ${submitted && problems[f.key] ? 'border-red-500/70' : 'border-line focus:border-brand'}`}
                    />
                    <span className='mt-1 flex justify-between text-xs text-muted'>
                        <span className={submitted && problems[f.key] ? 'text-red-400' : ''}>{submitted && problems[f.key] ? problems[f.key] : f.hint}</span>
                        <span>{v[f.key].length}/{f.max}</span>
                    </span>
                </label>
            ))}
            <label htmlFor='rd-review' className='block'>
                <span className='mb-1 block text-sm text-soft'>Next review date</span>
                <input id='rd-review' type='date' min={today} value={nextReview} onChange={(e) => setNextReview(e.target.value)} className='h-12 w-full rounded-xl border border-line bg-panel px-3 text-base text-ink focus:border-brand focus:outline-none' />
                {submitted && problems.nextReview && <span className='mt-1 block text-xs text-red-400'>{problems.nextReview}</span>}
            </label>
            {sheet}
        </Screen>
    );
}
