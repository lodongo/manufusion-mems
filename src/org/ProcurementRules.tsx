import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Segmented, messageOf, useConfirm } from '../components/screen';

// Buying rules and the chart of authority tiers, shown as tabs of Procurement setup.
// Buying rules: may materials be bought for any cost center, or only for warehouses that hold that material type?
// Authority limits: for each amount band, how the buy is sourced (direct, RFQ, RFT ...), how many quotes, and who approves.
// Every save needs a reason, makes a new version and is audited. The server refuses overlapping or incomplete bands.

// ----- Buying rules -----

interface PolicyOut {
    policy: { directToCostCenters: boolean; version: number; updatedAt: string };
    canManage: boolean;
}

export function BuyingRules() {
    const { data, error, loading, reload } = useLoad(() => callBackend<PolicyOut>('/api/org/procurement/policy/get'));
    const [choice, setChoice] = useState<boolean | null>(null);
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the buying rules.'}</Alert>;
    const current = data.policy.directToCostCenters;
    const value = choice ?? current;
    const options = [
        { v: false, title: 'Only for warehouses', text: 'Materials can only be bought for a warehouse (a cost center of type Inventory or Warehousing) that holds that material type. People see only the warehouses whose material categories match the item they are buying.' },
        { v: true, title: 'For any cost center', text: 'Materials can be bought directly for any cost center the person has access to, as well as for warehouses. Use this where departments consume what they buy.' },
    ];

    const save = () =>
        confirm.ask(
            {
                title: 'Change the buying rules',
                message: `From now on, materials can be bought ${value ? 'for any cost center' : 'only for warehouses that hold the material type'}. Items already saved are not changed, but they are checked again when edited. This creates version ${data.policy.version + 1}.`,
                confirmLabel: 'Save',
                reason: { label: 'Reason for this change', minLength: 10, placeholder: 'For example: departments now buy consumables directly' },
            },
            async (reason) => {
                await callBackend('/api/org/procurement/policy/save', { directToCostCenters: value, expectedVersion: data.policy.version, reason });
                setNotice('Saved. The change is recorded in the audit trail.');
                setChoice(null);
                reload();
            }
        );

    return (
        <div className='space-y-3'>
            {notice && <Alert tone='success'>{notice}</Alert>}
            <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 className='text-sm font-semibold text-ink'>Where can materials be bought for?</h2>
                    <Badge tone='muted'>{data.policy.version ? `Version ${data.policy.version}` : 'Default'}</Badge>
                </div>
                {options.map((o) => (
                    <label key={String(o.v)} className={`flex min-h-12 items-start gap-3 rounded-xl border p-3 ${value === o.v ? 'border-brand bg-page' : 'border-line'}`}>
                        <input type='radio' name='policy' disabled={!data.canManage} checked={value === o.v} onChange={() => setChoice(o.v)} className='mt-1 h-5 w-5 shrink-0 accent-emerald-500' />
                        <span>
                            <span className='block text-sm font-medium text-ink'>{o.title}</span>
                            <span className='block text-xs text-muted'>{o.text}</span>
                        </span>
                    </label>
                ))}
                {data.policy.updatedAt && <p className='text-xs text-muted'>Last changed {fmtDate(data.policy.updatedAt)}.</p>}
            </section>
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>How an item can be specified</h2>
                <ul className='list-disc space-y-1 pl-5 text-xs text-muted'>
                    <li>Pick a material from the stock of any warehouse (materials only).</li>
                    <li>Pick from the catalogue, then fill in the technical attributes of that entry.</li>
                    <li>Describe it. A description is always available, and is what an item is when neither of the others is chosen.</li>
                </ul>
            </section>
            {data.canManage ? (
                <Button onClick={save} disabled={value === current} className='w-full sm:w-auto'>
                    <Save className='mr-2 h-4 w-4' /> Save changes
                </Button>
            ) : (
                <p className='text-xs text-muted'>You can view the buying rules. Changing them needs the Procurement Setup Administrator role.</p>
            )}
            {confirm.sheet}
        </div>
    );
}

// ----- Authority limits -----

interface Level {
    code: string;
    title: string;
    positionCode: string;
}
interface Position {
    code: string;
    title: string;
    parentCode: string;
}
interface Sourcing {
    from: number;
    to: number | null;
    method: string;
    minQuotes: number;
    minEvaluators: number;
    justification: boolean;
}
interface Approval {
    from: number;
    to: number | null;
    levels: string[];
}
interface Controls {
    requireApprovedVendor: boolean;
    budgetRequired: boolean;
    splitOrderDays: number;
    matchTolerancePct: number;
    emergencyCeiling: number;
    emergencyRatifyDays: number;
    contractThreshold: number;
    conflictDeclarationFrom: number;
    tenderCommitteeMin: number;
}
interface Auth {
    levels: Level[];
    sourcing: Sourcing[];
    approval: Approval[];
    controls: Controls;
    version: number;
    updatedAt: string;
}
interface Out {
    authority: Auth;
    methods: Array<{ code: string; label: string; note: string }>;
    currency: string;
    canManage: boolean;
}
interface Resolved {
    amount: number;
    sourcing: { methodLabel: string; minQuotes: number; minEvaluators: number; justification: boolean };
    approval: { approvers: number; titles: Array<{ code: string; title: string }> };
    requires: { writtenContract: boolean; conflictDeclaration: boolean; tenderCommittee: number; emergencyAllowed: boolean };
}

type Draft = Pick<Auth, 'levels' | 'sourcing' | 'approval' | 'controls'>;
type NumKey = Exclude<keyof Controls, 'requireApprovedVendor' | 'budgetRequired'>;
type Section = 'sourcing' | 'approval' | 'controls' | 'levels' | 'check';

const SECTIONS: Array<{ value: Section; label: string }> = [
    { value: 'sourcing', label: 'Quotes and sourcing' },
    { value: 'approval', label: 'Cost approval' },
    { value: 'controls', label: 'Other controls' },
    { value: 'levels', label: 'Approval levels' },
    { value: 'check', label: 'Check an amount' },
];

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const num = (v: string) => (v.trim() === '' ? 0 : Number(v));

/** Each band starts where the one below it ends; the first starts at 0 and the last has no upper limit. */
function chain<T extends { from: number; to: number | null }>(rows: T[]): T[] {
    return rows.map((r, i) => ({ ...r, from: i === 0 ? 0 : rows[i - 1].to ?? 0, to: i === rows.length - 1 ? null : r.to }));
}
const bandText = (b: { from: number; to: number | null }, cur: string) => `${cur} ${fmt(b.from)} ${b.to === null ? 'and above' : `up to ${fmt(b.to)}`}`;

export function AuthorityTiers() {
    const { data, error, loading, reload } = useLoad(() => callBackend<Out>('/api/org/procurement/authority/tiers'));
    const [draft, setDraft] = useState<Draft | null>(null);
    const [section, setSection] = useState<Section>('sourcing');
    const [notice, setNotice] = useState('');
    const [problem, setProblem] = useState('');
    const [amount, setAmount] = useState('');
    const [resolved, setResolved] = useState<Resolved | null>(null);
    const [checking, setChecking] = useState(false);
    const confirm = useConfirm();

    const positions = useLoad(() => callBackend<{ positions: Position[] }>('/api/org/procurement/authority/positions').catch(() => ({ positions: [] as Position[] })));

    useEffect(() => {
        if (data) setDraft({ levels: data.authority.levels, sourcing: data.authority.sourcing, approval: data.authority.approval, controls: data.authority.controls });
    }, [data]);

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'You do not have permission to view the chart of authority.'}</Alert>;
    if (!draft) return <Spinner />;
    const cur = data.currency;
    const canManage = data.canManage;
    const orig: Draft = { levels: data.authority.levels, sourcing: data.authority.sourcing, approval: data.authority.approval, controls: data.authority.controls };
    const dirty = JSON.stringify(orig) !== JSON.stringify(draft);

    const setSourcing = (rows: Sourcing[]) => setDraft({ ...draft, sourcing: chain(rows) });
    const setApproval = (rows: Approval[]) => setDraft({ ...draft, approval: chain(rows) });
    const setControls = (p: Partial<Controls>) => setDraft({ ...draft, controls: { ...draft.controls, ...p } });
    const patchSourcing = (i: number, p: Partial<Sourcing>) => setSourcing(draft.sourcing.map((b, k) => (k === i ? { ...b, ...p } : b)));
    const patchApproval = (i: number, p: Partial<Approval>) => setApproval(draft.approval.map((b, k) => (k === i ? { ...b, ...p } : b)));

    const addSourcing = () => {
        const last = draft.sourcing[draft.sourcing.length - 1];
        const mid = Math.max(last.from * 10, last.from + 1_000_000);
        setSourcing([...draft.sourcing.slice(0, -1), { ...last, to: mid }, { ...last, from: mid, to: null }]);
    };
    const addApproval = () => {
        const last = draft.approval[draft.approval.length - 1];
        const mid = Math.max(last.from * 10, last.from + 1_000_000);
        setApproval([...draft.approval.slice(0, -1), { ...last, to: mid }, { ...last, from: mid, to: null }]);
    };
    const toggleLevel = (i: number, code: string) => {
        const has = draft.approval[i].levels.includes(code);
        const next = has ? draft.approval[i].levels.filter((x) => x !== code) : [...draft.approval[i].levels, code];
        patchApproval(i, { levels: draft.levels.map((l) => l.code).filter((c) => next.includes(c)) });
    };

    const save = () =>
        confirm.ask(
            {
                title: 'Save the chart of authority',
                message: `This creates version ${data.authority.version + 1}. It changes how many quotes, which sourcing method and how many approvers apply at each amount. Earlier versions are kept.`,
                confirmLabel: 'Save',
                reason: { label: 'Reason for this change', minLength: 10, placeholder: 'For example: board approved new limits on 12 October' },
                acknowledge: 'I am authorised to change the limits of authority.',
            },
            async (reason) => {
                const out = await callBackend<{ unmapped?: string[] }>('/api/org/procurement/authority/save', { ...draft, expectedVersion: data.authority.version, reason });
                setNotice(`Saved. The change is recorded in the audit trail.${out.unmapped && out.unmapped.length ? ` These approval levels are used but have no job role yet: ${out.unmapped.join(', ')}. Nobody can approve at those levels until you map them.` : ''}`);
                reload();
            }
        );

    const check = async () => {
        setChecking(true);
        setProblem('');
        try {
            setResolved(await callBackend<Resolved>('/api/org/procurement/authority/resolve', { amount: num(amount) }));
        } catch (e) {
            setProblem(messageOf(e));
        } finally {
            setChecking(false);
        }
    };

    const c = draft.controls;
    const setNum = (key: NumKey, v: number) => setDraft({ ...draft, controls: { ...draft.controls, [key]: v } });
    const money = (id: string, label: string, key: NumKey, hint?: string) => (
        <Field id={id} label={`${label} (${cur || 'amount'})`} type='number' inputMode='decimal' min='0' step='any' disabled={!canManage} value={String(c[key])} onChange={(e) => setNum(key, num(e.target.value))} hint={hint} />
    );
    const count = (id: string, label: string, key: NumKey, hint?: string) => (
        <Field id={id} label={label} type='number' inputMode='numeric' min='0' step='1' disabled={!canManage} value={String(c[key])} onChange={(e) => setNum(key, num(e.target.value))} hint={hint} />
    );

    return (
        <div className='space-y-3'>
            {notice && <Alert tone='success'>{notice}</Alert>}
            <Alert tone='info'>Amounts are in {cur || 'the organization currency'}. These limits are the organization&apos;s chart of authority. They are applied by quotations, purchase requisitions and purchase orders as those are released.{data.authority.version === 0 ? ' Nothing has been saved yet, so the suggested defaults are shown. Review them and save your own.' : ''}</Alert>
            <Segmented label='Authority sections' value={section} options={SECTIONS} onChange={setSection} />

            {section === 'sourcing' && (
                <>
                    {draft.sourcing.map((b, i) => (
                        <section key={i} className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                            <div className='flex items-center justify-between gap-2'>
                                <p className='text-sm font-semibold text-ink'>{bandText(b, cur)}</p>
                                {canManage && draft.sourcing.length > 1 && (
                                    <button type='button' aria-label='Remove this band' onClick={() => setSourcing(draft.sourcing.filter((_, k) => k !== i))} className='flex h-11 w-11 items-center justify-center text-red-400'>
                                        <Trash2 className='h-4 w-4' />
                                    </button>
                                )}
                            </div>
                            {b.to !== null && <Field id={`s-to-${i}`} label={`Applies up to (${cur || 'amount'})`} type='number' inputMode='decimal' min='0' step='any' disabled={!canManage} value={String(b.to)} onChange={(e) => patchSourcing(i, { to: num(e.target.value) })} />}
                            <SelectField id={`s-method-${i}`} label='How it is bought' value={b.method} disabled={!canManage} onChange={(e) => patchSourcing(i, { method: e.target.value, justification: e.target.value === 'single_source' })} hint={data.methods.find((m) => m.code === b.method)?.note}>
                                {data.methods.map((m) => (
                                    <option key={m.code} value={m.code}>{m.label}</option>
                                ))}
                            </SelectField>
                            <div className='grid grid-cols-2 gap-3'>
                                <Field id={`s-q-${i}`} label='Quotes or bids needed' type='number' inputMode='numeric' min='1' max='20' disabled={!canManage} value={String(b.minQuotes)} onChange={(e) => patchSourcing(i, { minQuotes: num(e.target.value) })} />
                                <Field id={`s-e-${i}`} label='People who evaluate' type='number' inputMode='numeric' min='1' max='20' disabled={!canManage} value={String(b.minEvaluators)} onChange={(e) => patchSourcing(i, { minEvaluators: num(e.target.value) })} />
                            </div>
                            {b.method === 'single_source' && <p className='text-xs text-muted'>A written justification is required for single or sole source buying.</p>}
                        </section>
                    ))}
                    {canManage && draft.sourcing.length < 12 && (
                        <Button variant='secondary' onClick={addSourcing}>
                            <Plus className='mr-1 h-4 w-4' /> Add an amount band
                        </Button>
                    )}
                </>
            )}

            {section === 'approval' && (
                <>
                    {draft.approval.map((b, i) => (
                        <section key={i} className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                            <div className='flex items-center justify-between gap-2'>
                                <p className='text-sm font-semibold text-ink'>{bandText(b, cur)}</p>
                                <Badge tone='muted'>{b.levels.length} approver{b.levels.length === 1 ? '' : 's'}</Badge>
                                {canManage && draft.approval.length > 1 && (
                                    <button type='button' aria-label='Remove this band' onClick={() => setApproval(draft.approval.filter((_, k) => k !== i))} className='flex h-11 w-11 items-center justify-center text-red-400'>
                                        <Trash2 className='h-4 w-4' />
                                    </button>
                                )}
                            </div>
                            {b.to !== null && <Field id={`a-to-${i}`} label={`Applies up to (${cur || 'amount'})`} type='number' inputMode='decimal' min='0' step='any' disabled={!canManage} value={String(b.to)} onChange={(e) => patchApproval(i, { to: num(e.target.value) })} />}
                            <div>
                                <p className='mb-1 text-sm text-soft'>Who approves, in order</p>
                                <div className='flex flex-wrap gap-2'>
                                    {draft.levels.map((l) => {
                                        const on = b.levels.includes(l.code);
                                        return (
                                            <button key={l.code} type='button' aria-pressed={on} disabled={!canManage} onClick={() => toggleLevel(i, l.code)} className={`flex min-h-11 items-center gap-1 rounded-xl border px-3 text-sm ${on ? 'border-brand bg-brand text-onbrand' : 'border-line text-soft'}`}>
                                                <span className='font-mono text-xs'>{l.code}</span> {l.title}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </section>
                    ))}
                    {canManage && draft.approval.length < 12 && (
                        <Button variant='secondary' onClick={addApproval}>
                            <Plus className='mr-1 h-4 w-4' /> Add an amount band
                        </Button>
                    )}
                    <p className='text-xs text-muted'>A higher amount can never need fewer approvers than the band below it. Nobody approves their own work, whatever the level.</p>
                </>
            )}

            {section === 'controls' && (
                <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                    <label className='flex min-h-11 items-center gap-3 text-sm text-ink'>
                        <input type='checkbox' disabled={!canManage} checked={c.requireApprovedVendor} onChange={(e) => setControls({ requireApprovedVendor: e.target.checked })} className='h-5 w-5 accent-emerald-500' />
                        Buy only from approved vendors
                    </label>
                    <label className='flex min-h-11 items-center gap-3 text-sm text-ink'>
                        <input type='checkbox' disabled={!canManage} checked={c.budgetRequired} onChange={(e) => setControls({ budgetRequired: e.target.checked })} className='h-5 w-5 accent-emerald-500' />
                        Check the budget before a requisition is approved
                    </label>
                    {money('c-emerg', 'Emergency buying ceiling', 'emergencyCeiling', 'The most that may be bought in an emergency without the normal sourcing steps.')}
                    {count('c-ratify', 'Days to ratify an emergency purchase', 'emergencyRatifyDays', 'The approver must confirm an emergency purchase within this many days.')}
                    {money('c-contract', 'Written contract needed from', 'contractThreshold')}
                    {money('c-conflict', 'Conflict of interest declaration from', 'conflictDeclarationFrom', 'Evaluators sign a declaration from this amount.')}
                    {count('c-committee', 'Tender committee size', 'tenderCommitteeMin', 'The fewest members for opening and evaluating tenders.')}
                    {count('c-split', 'Split order check (days)', 'splitOrderDays', 'Orders to the same vendor within this period are added together, so a large buy cannot be split to stay under a limit. 0 switches the check off.')}
                    {count('c-match', 'Invoice matching tolerance (%)', 'matchTolerancePct', 'How far an invoice may differ from the order and receipt before it is stopped.')}
                    <div className='rounded-xl border border-line bg-page p-3'>
                        <p className='text-sm font-medium text-ink'>Always enforced</p>
                        <ul className='mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted'>
                            <li>Nobody approves their own requirement, requisition, order or vendor.</li>
                            <li>Whoever created or edited a vendor cannot approve it.</li>
                            <li>Whoever prepares an order cannot approve it, and the requisition approver cannot approve the order.</li>
                            <li>Changing a limit needs a reason, is versioned and is audited.</li>
                        </ul>
                    </div>
                </section>
            )}

            {section === 'levels' && (
                <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                    <p className='text-xs text-muted'>
                        An approval level is only a name until it is mapped to a job role (ROL_). The people who hold that job role today approve at that level. L1 stays on the requester&apos;s immediate manager unless you map it. Job roles are created in Organization design, and people are given them there.
                    </p>
                    {draft.levels.map((l, i) => {
                        const pos = (positions.data?.positions ?? []).find((x) => x.code === l.positionCode);
                        const usedBy = draft.approval.filter((b) => b.levels.includes(l.code)).length;
                        const missing = usedBy > 0 && !l.positionCode && l.code !== 'L1';
                        return (
                            <div key={l.code} className='space-y-2 rounded-xl border border-line p-3'>
                                <div className='flex items-center justify-between gap-2'>
                                    <p className='font-mono text-xs text-brandsoft'>{l.code}</p>
                                    <Badge tone={missing ? 'warn' : l.positionCode || l.code === 'L1' ? 'brand' : 'muted'}>
                                        {l.positionCode ? 'Mapped' : l.code === 'L1' ? 'Immediate manager' : usedBy ? 'Not mapped' : 'Not used'}
                                    </Badge>
                                </div>
                                <Field id={`l-${l.code}`} label='Name of the level' maxLength={60} disabled={!canManage} value={l.title} onChange={(e) => setDraft({ ...draft, levels: draft.levels.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
                                <SelectField
                                    id={`lp-${l.code}`}
                                    label='Job role that approves'
                                    disabled={!canManage || positions.loading}
                                    value={l.positionCode}
                                    onChange={(e) => setDraft({ ...draft, levels: draft.levels.map((x, k) => (k === i ? { ...x, positionCode: e.target.value } : x)) })}
                                    hint={l.code === 'L1' ? 'Leave empty to use the immediate manager of whoever raised the requirement.' : pos ? `${pos.code} ${pos.title}` : usedBy ? 'Used in a cost approval band, so it needs a job role.' : undefined}
                                >
                                    <option value=''>{l.code === 'L1' ? 'The requester\'s immediate manager' : 'Not mapped'}</option>
                                    {(positions.data?.positions ?? []).map((x) => (
                                        <option key={x.code} value={x.code}>{x.code} · {x.title}</option>
                                    ))}
                                </SelectField>
                            </div>
                        );
                    })}
                </section>
            )}

            {section === 'check' && (
                <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                    <p className='text-xs text-muted'>Enter an amount to see what the saved chart of authority requires.</p>
                    <Field id='chk-amount' label={`Amount (${cur || 'amount'})`} type='number' inputMode='decimal' min='0' step='any' value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <Button disabled={checking || amount.trim() === ''} onClick={() => void check()}>{checking ? 'Checking' : 'Check'}</Button>
                    {problem && <Alert tone='error'>{problem}</Alert>}
                    {resolved && (
                        <div className='space-y-2 rounded-xl border border-line bg-page p-3 text-sm'>
                            <p className='font-semibold text-ink'>{cur} {fmt(resolved.amount)}</p>
                            <p className='text-ink'>{resolved.sourcing.methodLabel}</p>
                            <p className='text-xs text-muted'>{resolved.sourcing.minQuotes} quote(s) or bid(s), {resolved.sourcing.minEvaluators} evaluator(s){resolved.sourcing.justification ? ', written justification' : ''}</p>
                            <p className='text-ink'>{resolved.approval.approvers} approver(s)</p>
                            <ol className='list-decimal space-y-0.5 pl-5 text-xs text-muted'>
                                {resolved.approval.titles.map((t) => (
                                    <li key={t.code}>{t.code} {t.title}</li>
                                ))}
                            </ol>
                            <p className='text-xs text-muted'>
                                {[resolved.requires.writtenContract ? 'Written contract' : '', resolved.requires.conflictDeclaration ? 'Conflict of interest declaration' : '', resolved.requires.tenderCommittee ? `Tender committee of ${resolved.requires.tenderCommittee}` : '', resolved.requires.emergencyAllowed ? 'Emergency buying allowed' : ''].filter(Boolean).join(' · ') || 'No extra requirements'}
                            </p>
                        </div>
                    )}
                </section>
            )}

            {section !== 'check' && (
                canManage ? (
                    <Button onClick={save} disabled={!dirty} className='w-full sm:w-auto'>
                        <Save className='mr-2 h-4 w-4' /> Save changes
                    </Button>
                ) : (
                    <p className='text-xs text-muted'>You can view the limits. Changing them needs the Chart of Authority Administrator role.</p>
                )
            )}
            {data.authority.updatedAt && <p className='text-xs text-muted'>Version {data.authority.version}, saved {fmtDate(data.authority.updatedAt)}.</p>}
            {confirm.sheet}
        </div>
    );
}
