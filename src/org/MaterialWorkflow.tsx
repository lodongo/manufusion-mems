import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Circle, Plus, Save, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { InfoTip, Screen, Segmented, useConfirm } from '../components/screen';
import { Badge, Button, Card, Spinner, TextArea, Toggle, useLoad } from '../admin/kit';

// Workflow management: the organization's approval catalogue (one workflow per transaction type).
//   Registry   every workflow template with its module, number of approval steps, execution and status
//   Editor     execution order (sequential / parallel), threshold (all / any), enable, and 1–20 approval steps;
//              each step is a position (role), the n-th reporting manager above the requester, or a named user.
// Saving changes the approval chain, so it is confirmed. The HIGH RISK option also terminates the pending
// approvals of connected material creation / extension requests: it needs a justification of at least 20 characters
// and the typed phrase TERMINATE ACTIVE WORKFLOWS (both re-checked by the server, which also audits the change).
// expectedVersion guards against saving over someone else's newer change.

interface Step {
    mode: string;
    role: string;
    uid: string;
    managerLevel: number;
}
interface Workflow {
    code: string;
    module: string;
    name: string;
    transactionKey: string;
    enabled: boolean;
    approvalMode: string;
    approvalRule: string;
    steps: Step[];
    version: number;
}
interface Role {
    code: string;
    title: string;
}
interface User {
    uid: string;
    firstName: string;
    lastName: string;
}
interface DraftStep {
    mode: string;
    role: string;
    uid: string;
    level: string;
}
interface Draft {
    enabled: boolean;
    approvalMode: string;
    approvalRule: string;
    steps: DraftStep[];
}

const API = '/api/org/procurement/workflows';
const PHRASE = 'TERMINATE ACTIVE WORKFLOWS';
const MAX_STEPS = 20;
const normalizePhrase = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();
const blankStep = (): DraftStep => ({ mode: 'role', role: '', uid: '', level: '1' });
const toDraft = (w: Workflow): Draft => ({
    enabled: w.enabled,
    approvalMode: w.approvalMode || 'sequential',
    approvalRule: w.approvalRule || 'all',
    steps: (w.steps ?? []).map((s) => ({ mode: s.mode || 'role', role: s.role || '', uid: s.uid || '', level: String(s.managerLevel || 1) })),
});
const userName = (u: User) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.uid;

function stepProblem(s: DraftStep): string {
    if (!['role', 'manager', 'user'].includes(s.mode)) return 'Choose how the approver is found.';
    if (s.mode === 'role' && !s.role) return 'Choose a position.';
    if (s.mode === 'user' && !s.uid) return 'Choose a user.';
    if (s.mode === 'manager' && !(/^\d{1,2}$/.test(s.level.trim()) && Number(s.level) >= 1 && Number(s.level) <= 20)) return 'Manager level must be a whole number from 1 to 20.';
    return '';
}

export default function MaterialWorkflow() {
    const registry = useLoad(() => callBackend<{ items: Workflow[] }>(API + '/registry'));
    const directory = useLoad(() =>
        Promise.all([callBackend<{ positions: Role[] }>('/api/org/positions/list'), callBackend<{ users: User[] }>('/api/org/users/list').catch(() => ({ users: [] as User[] }))]).then(([p, u]) => ({
            roles: p.positions ?? [],
            users: u.users ?? [],
        }))
    );
    const [module, setModule] = useState('ALL');
    const [editing, setEditing] = useState<Workflow | null>(null);
    const [notice, setNotice] = useState('');

    const items = useMemo(() => registry.data?.items ?? [], [registry.data]);
    const modules = useMemo(() => [...new Set(items.map((x) => x.module))].sort(), [items]);
    const rows = useMemo(() => items.filter((x) => module === 'ALL' || x.module === module), [items, module]);

    const columns = useMemo<Array<Column<Workflow>>>(
        () => [
            { key: 'code', label: 'Code', value: (x) => x.code, render: (x) => <span className='font-mono text-xs font-semibold text-ink'>{x.code}</span> },
            { key: 'name', label: 'Transaction / workflow', value: (x) => x.name },
            { key: 'key', label: 'Transaction key', value: (x) => x.transactionKey, hidden: true },
            { key: 'module', label: 'Module', value: (x) => x.module },
            { key: 'steps', label: 'Approvals', type: 'number', value: (x) => x.steps.length },
            { key: 'mode', label: 'Execution', value: (x) => (x.approvalMode === 'parallel' ? 'Parallel' : 'Sequential') },
            { key: 'rule', label: 'Threshold', value: (x) => (x.approvalRule === 'any' ? 'Any one approver' : 'All approvers') },
            { key: 'status', label: 'Status', value: (x) => (x.enabled ? 'Enabled' : 'Disabled'), render: (x) => <Badge tone={x.enabled ? 'brand' : 'muted'}>{x.enabled ? 'Enabled' : 'Disabled'}</Badge> },
            { key: 'version', label: 'Version', type: 'number', value: (x) => x.version, hidden: true },
        ],
        []
    );

    if (editing) {
        return (
            <Editor
                workflow={editing}
                roles={directory.data?.roles ?? []}
                users={directory.data?.users ?? []}
                directoryError={directory.error}
                onBack={() => setEditing(null)}
                onSaved={(text) => {
                    setEditing(null);
                    setNotice(text);
                    registry.reload();
                }}
            />
        );
    }

    return (
        <Screen
            title='Workflow management'
            subtitle='Approval catalogue, assignments and execution rules'
            toolbar={
                modules.length > 0 ? (
                    <Segmented
                        label='Modules'
                        value={module}
                        onChange={setModule}
                        options={[{ value: 'ALL', label: 'All modules', count: items.length }, ...modules.map((m) => ({ value: m, label: m, count: items.filter((x) => x.module === m).length }))]}
                    />
                ) : undefined
            }
        >
            {registry.error && <Alert tone='error'>{registry.error}</Alert>}
            {notice && <Alert tone='success'>{notice}</Alert>}
            <div className='grid grid-cols-3 gap-2'>
                {[
                    ['Templates', items.length],
                    ['Enabled', items.filter((x) => x.enabled).length],
                    ['Modules', modules.length],
                ].map(([label, value]) => (
                    <div key={label} className='rounded-xl border border-line bg-panel px-3 py-2'>
                        <p className='text-xs text-muted'>{label}</p>
                        <p className='text-lg font-semibold text-ink'>{value}</p>
                    </div>
                ))}
            </div>
            {!registry.data && registry.loading ? (
                <Spinner />
            ) : (
                <RichTable
                    id='adm.workflows'
                    title='Workflow registry'
                    fileName='Workflow_registry'
                    columns={columns}
                    rows={rows}
                    rowKey={(x) => x.code}
                    onRowClick={(x) => {
                        setNotice('');
                        setEditing(x);
                    }}
                    empty='No matching workflows.'
                    height='h-[calc(100dvh-22rem)]'
                />
            )}
        </Screen>
    );
}

// ---------------------------------------------------------------------------
// Workflow editor (full screen, Save on top).
// ---------------------------------------------------------------------------

function Editor({ workflow, roles, users, directoryError, onBack, onSaved }: { workflow: Workflow; roles: Role[]; users: User[]; directoryError: string; onBack: () => void; onSaved: (text: string) => void }) {
    const [draft, setDraft] = useState<Draft>(() => toDraft(workflow));
    const [terminate, setTerminate] = useState(false);
    const [reason, setReason] = useState('');
    const [phrase, setPhrase] = useState('');
    const confirm = useConfirm();

    const original = useMemo(() => JSON.stringify(toDraft(workflow)), [workflow]);
    const dirty = terminate || JSON.stringify(draft) !== original;
    const reasonReady = reason.trim().length >= 20;
    const phraseReady = normalizePhrase(phrase) === PHRASE;
    const stepProblems = draft.steps.map(stepProblem);
    const problems = [
        ...(draft.steps.length < 1 ? ['Add at least one approval step.'] : []),
        ...(draft.steps.length > MAX_STEPS ? [`Use at most ${MAX_STEPS} approval steps.`] : []),
        ...stepProblems.map((p, i) => (p ? `Approval ${i + 1}: ${p}` : '')).filter(Boolean),
        ...(terminate && !reasonReady ? ['Give a business justification of at least 20 characters.'] : []),
        ...(terminate && !phraseReady ? [`Type ${PHRASE} to confirm the termination.`] : []),
    ];

    const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
    const setStep = (i: number, patch: Partial<DraftStep>) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (i === j ? { ...s, ...patch } : s)) }));

    const back = () => {
        if (!dirty) return onBack();
        confirm.ask({ title: 'Discard changes?', message: `Your changes to ${workflow.code} are not saved.`, confirmLabel: 'Discard changes', tone: 'danger' }, async () => onBack());
    };

    const save = () =>
        confirm.ask(
            {
                title: terminate ? 'Terminate active approvals and save?' : `Save ${workflow.code}?`,
                message: (
                    <>
                        <p>
                            This changes the approval chain of <span className='font-semibold text-ink'>{workflow.name}</span>: {draft.enabled ? 'enabled' : 'disabled'}, {draft.approvalMode === 'parallel' ? 'parallel' : 'sequential'},{' '}
                            {draft.approvalRule === 'any' ? 'any one approver' : 'all approvers'}, {draft.steps.length} approval step{draft.steps.length === 1 ? '' : 's'}.
                        </p>
                        {terminate && <p className='mt-2 text-red-300'>Pending material creation and extension approvals are terminated (not deleted) and are not resubmitted automatically.</p>}
                    </>
                ),
                confirmLabel: terminate ? 'Terminate & save' : 'Save workflow',
                tone: terminate ? 'danger' : 'primary',
                acknowledge: terminate ? 'I understand active approvals will be terminated and the affected requests must be resubmitted.' : undefined,
            },
            async () => {
                const r = await callBackend<{ ok: boolean; terminated?: number }>(API + '/save', {
                    code: workflow.code,
                    enabled: draft.enabled,
                    approvalMode: draft.approvalMode,
                    approvalRule: draft.approvalRule,
                    steps: draft.steps.map((s) => ({ mode: s.mode, role: s.role, uid: s.uid, managerLevel: Number(s.level) || 1 })),
                    expectedVersion: workflow.version,
                    terminateActive: terminate,
                    terminationReason: reason.trim(),
                    terminationConfirmation: normalizePhrase(phrase),
                });
                onSaved(
                    terminate
                        ? `HIGH RISK: ${r.terminated ?? 0} active approval instance${r.terminated === 1 ? '' : 's'} terminated and workflow ${workflow.code} updated.`
                        : `Workflow ${workflow.code} saved.`
                );
            }
        );

    return (
        <>
            <Screen
                title={workflow.name}
                eyebrow={`${workflow.code} · ${workflow.transactionKey}`}
                subtitle={`${workflow.module} · version ${workflow.version}`}
                onBack={back}
                actions={
                    <Button variant={terminate ? 'danger' : 'primary'} disabled={!dirty || problems.length > 0} onClick={save}>
                        <Save className='h-4 w-4' /> {terminate ? 'Terminate & save' : 'Save'}
                    </Button>
                }
            >
                {directoryError && <Alert tone='error'>{directoryError}</Alert>}
                {problems.length > 0 && (
                    <div role='status' className='rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300'>
                        <p className='font-medium'>Before you can save:</p>
                        <ul className='mt-1 list-disc space-y-0.5 pl-5'>
                            {problems.map((p) => (
                                <li key={p}>{p}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <Card className='grid gap-3 sm:grid-cols-3'>
                    <SelectField id='wf-mode' label='Execution order *' value={draft.approvalMode} onChange={(e) => update({ approvalMode: e.target.value })}>
                        <option value='sequential'>Sequential</option>
                        <option value='parallel'>Parallel / any order</option>
                    </SelectField>
                    <SelectField id='wf-rule' label='Approval threshold *' value={draft.approvalRule} onChange={(e) => update({ approvalRule: e.target.value })}>
                        <option value='all'>All approvers required</option>
                        <option value='any'>Any one approver</option>
                    </SelectField>
                    <label className='flex min-h-[48px] items-center gap-3 self-end rounded-xl border border-line px-3 py-2'>
                        <Toggle checked={draft.enabled} onChange={(v) => update({ enabled: v })} label='Enable workflow' />
                        <span className='text-sm text-soft'>Enable workflow</span>
                    </label>
                </Card>

                <div className='flex items-center gap-2'>
                    <h2 className='min-w-0 flex-1 text-sm font-semibold text-ink'>Approval steps ({draft.steps.length})</h2>
                    <InfoTip label='Approval steps'>Select a named user, an organization position, or a manager level above the requester. No requester may approve their own transaction.</InfoTip>
                    <Button variant='secondary' disabled={draft.steps.length >= MAX_STEPS} onClick={() => update({ steps: [...draft.steps, blankStep()] })}>
                        <Plus className='h-4 w-4' /> Add step
                    </Button>
                </div>

                {draft.steps.map((s, i) => {
                    const unknownRole = s.role && !roles.some((r) => r.code === s.role);
                    const unknownUser = s.uid && !users.some((u) => u.uid === s.uid);
                    return (
                        <Card key={i} className='space-y-3'>
                            <div className='flex items-center justify-between gap-2'>
                                <span className='text-sm font-semibold text-ink'>Approval {i + 1}</span>
                                <Button variant='danger' disabled={draft.steps.length <= 1} onClick={() => update({ steps: draft.steps.filter((_, j) => i !== j) })} aria-label={`Remove approval ${i + 1}`}>
                                    <Trash2 className='h-4 w-4' /> Remove
                                </Button>
                            </div>
                            <div className='grid gap-3 sm:grid-cols-2'>
                                <SelectField id={`wf-step-${i}-mode`} label='Approver *' value={s.mode} onChange={(e) => setStep(i, { mode: e.target.value })}>
                                    <option value='role'>Organization role / position</option>
                                    <option value='manager'>Ascending reporting manager</option>
                                    <option value='user'>Named user</option>
                                </SelectField>
                                {s.mode === 'role' ? (
                                    <SelectField id={`wf-step-${i}-role`} label='Position *' value={s.role} onChange={(e) => setStep(i, { role: e.target.value })} error={stepProblems[i] || undefined}>
                                        <option value=''>Select position</option>
                                        {unknownRole && <option value={s.role}>{s.role} (not found)</option>}
                                        {roles.map((r) => (
                                            <option key={r.code} value={r.code}>
                                                {r.title} ({r.code})
                                            </option>
                                        ))}
                                    </SelectField>
                                ) : s.mode === 'user' ? (
                                    <SelectField id={`wf-step-${i}-user`} label='User *' value={s.uid} onChange={(e) => setStep(i, { uid: e.target.value })} error={stepProblems[i] || undefined}>
                                        <option value=''>Select user</option>
                                        {unknownUser && <option value={s.uid}>{s.uid} (not found)</option>}
                                        {users.map((u) => (
                                            <option key={u.uid} value={u.uid}>
                                                {userName(u)}
                                            </option>
                                        ))}
                                    </SelectField>
                                ) : (
                                    <Field
                                        id={`wf-step-${i}-level`}
                                        label='Manager level above requester *'
                                        inputMode='numeric'
                                        maxLength={2}
                                        value={s.level}
                                        onChange={(e) => setStep(i, { level: e.target.value })}
                                        error={stepProblems[i] || undefined}
                                        hint='1 = direct manager, up to 20'
                                    />
                                )}
                            </div>
                        </Card>
                    );
                })}

                <Card tone='danger' className='space-y-3'>
                    <label className='flex min-h-[44px] items-start gap-3 text-sm font-semibold text-ink'>
                        <input className='mt-0.5 h-5 w-5 shrink-0 accent-red-500' type='checkbox' checked={terminate} onChange={(e) => setTerminate(e.target.checked)} />
                        <span className='flex items-start gap-2'>
                            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-red-400' />
                            HIGH RISK — Terminate existing active approvals when saving changes
                        </span>
                    </label>
                    <p className='rounded-lg bg-red-500/10 p-3 text-sm text-red-300'>
                        Applicable to connected material creation and extension requests. Pending approvals are terminated, not deleted. Previous decisions and records are retained. This does not automatically resubmit the
                        transactions.
                    </p>
                    {terminate && (
                        <div className='space-y-3'>
                            <TextArea id='wf-terminate-reason' label='Business justification (minimum 20 characters) *' rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Explain the business reason in at least 20 characters' />
                            <Field id='wf-terminate-phrase' label={`Type ${PHRASE} to confirm *`} autoComplete='off' value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={PHRASE} />
                            <ul className='space-y-1 rounded-lg border border-line bg-page p-3 text-sm'>
                                <li className={`flex items-center gap-2 ${reasonReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                                    {reasonReady ? <Check className='h-4 w-4' /> : <Circle className='h-4 w-4' />} Reason: {reason.trim().length}/20 characters
                                </li>
                                <li className={`flex items-center gap-2 ${phraseReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                                    {phraseReady ? <Check className='h-4 w-4' /> : <Circle className='h-4 w-4' />} Confirmation phrase {phraseReady ? 'verified' : 'not yet matched'}
                                </li>
                                <li className='pt-1 text-xs text-muted'>The high-risk save becomes available when both checks are complete.</li>
                            </ul>
                        </div>
                    )}
                </Card>
            </Screen>
            {confirm.sheet}
        </>
    );
}
