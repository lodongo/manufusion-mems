import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { useConfirm } from '../components/screen';


// ----- Evaluation metrics -----

interface EvalCriterion {
    code: string;
    label: string;
    note: string;
    enabled: boolean;
    weight: number;
    whenMissing: 'skip' | 'zero';
}
interface EvalOut {
    config: { criteria: EvalCriterion[]; classOrder: string[]; version: number; updatedAt: string };
    classes: Array<{ code: string; label: string }>;
    canManage: boolean;
}

/** How quotes are scored: the weight of each metric, what to do when a quote has no data for it, and the order of vendor classes. */
export default function EvaluationMetrics() {
    const { data, error, loading, reload } = useLoad(() => callBackend<EvalOut>('/api/org/procurement/evaluation/get'));
    const [criteria, setCriteria] = useState<EvalCriterion[] | null>(null);
    const [order, setOrder] = useState<string[] | null>(null);
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();

    useEffect(() => {
        if (data) {
            setCriteria(data.config.criteria);
            setOrder(data.config.classOrder);
        }
    }, [data]);

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'You do not have permission to view the evaluation metrics.'}</Alert>;
    if (!criteria || !order) return <Spinner />;
    const canManage = data.canManage;
    const total = criteria.filter((c) => c.enabled).reduce((n, c) => n + (Number(c.weight) || 0), 0);
    const dirty = JSON.stringify({ c: criteria, o: order }) !== JSON.stringify({ c: data.config.criteria, o: data.config.classOrder });
    const label = (code: string) => data.classes.find((c) => c.code === code)?.label ?? code;
    const patch = (code: string, p: Partial<EvalCriterion>) => setCriteria(criteria.map((c) => (c.code === code ? { ...c, ...p } : c)));
    const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= order.length) return;
        const next = order.slice();
        [next[i], next[j]] = [next[j], next[i]];
        setOrder(next);
    };
    const rest = data.classes.filter((c) => !order.includes(c.code));

    const save = () =>
        confirm.ask(
            {
                title: 'Save the evaluation metrics',
                message: `This creates version ${data.config.version + 1}. Quotations analysed from now on use these weights. A recommendation already made keeps the version it was made with.`,
                confirmLabel: 'Save',
                reason: { label: 'Reason for this change', minLength: 10, placeholder: 'For example: warranty now matters more for plant spares' },
                acknowledge: 'I am authorised to change how quotes are scored.',
            },
            async (reason) => {
                await callBackend('/api/org/procurement/evaluation/save', { criteria, classOrder: order, expectedVersion: data.config.version, reason });
                setNotice('Saved. The change is recorded in the audit trail.');
                reload();
            }
        );

    return (
        <div className='space-y-3'>
            {notice && <Alert tone='success'>{notice}</Alert>}
            <Alert tone='info'>Each quote is scored from 0 to 100 on every metric that is on, and the scores are combined by weight. A vendor with no data for a metric is left out of that metric (or counted as zero, as you choose), so a missing SRM score never counts against a vendor.</Alert>
            {criteria.map((c) => (
                <section key={c.code} className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                    <div className='flex items-center justify-between gap-2'>
                        <label className='flex min-h-11 items-center gap-3 text-sm font-medium text-ink'>
                            <input type='checkbox' disabled={!canManage || c.code === 'price'} checked={c.enabled} onChange={(e) => patch(c.code, { enabled: e.target.checked })} className='h-5 w-5 accent-emerald-500' /> {c.label}
                        </label>
                        {c.enabled && <Badge tone='brand'>{c.weight}%</Badge>}
                    </div>
                    <p className='text-xs text-muted'>{c.note}</p>
                    {c.enabled && (
                        <div className='grid grid-cols-2 gap-3'>
                            <Field id={`ev-w-${c.code}`} label='Weight %' type='number' inputMode='numeric' min='0' max='100' step='1' disabled={!canManage} value={String(c.weight)} onChange={(e) => patch(c.code, { weight: Number(e.target.value) })} />
                            <SelectField id={`ev-m-${c.code}`} label='If no data' disabled={!canManage || c.code === 'price'} value={c.whenMissing} onChange={(e) => patch(c.code, { whenMissing: e.target.value as 'skip' | 'zero' })}>
                                <option value='skip'>Leave out</option>
                                <option value='zero'>Count as zero</option>
                            </SelectField>
                        </div>
                    )}
                </section>
            ))}
            <p className={`text-sm ${total === 100 ? 'text-brandsoft' : 'text-amber-400'}`}>Weights of metrics that are on: {total}% {total === 100 ? '' : '(must be 100%)'}</p>

            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Vendor class order</h2>
                <p className='text-xs text-muted'>Higher scores higher. By default OEM comes first, then OCM, then the rest. Classes not listed score zero on this metric.</p>
                <ol className='space-y-1'>
                    {order.map((code, i) => (
                        <li key={code} className='flex min-h-11 items-center gap-2 rounded-xl border border-line px-3'>
                            <span className='w-6 text-xs text-muted'>{i + 1}</span>
                            <span className='min-w-0 flex-1 truncate text-sm text-ink'>{label(code)}</span>
                            {canManage && (
                                <>
                                    <button type='button' aria-label={`Move ${label(code)} up`} disabled={i === 0} onClick={() => move(i, -1)} className='h-11 w-11 text-soft disabled:opacity-30'>↑</button>
                                    <button type='button' aria-label={`Move ${label(code)} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} className='h-11 w-11 text-soft disabled:opacity-30'>↓</button>
                                    <button type='button' aria-label={`Remove ${label(code)}`} onClick={() => setOrder(order.filter((x) => x !== code))} className='flex h-11 w-11 items-center justify-center text-red-400'>
                                        <Trash2 className='h-4 w-4' />
                                    </button>
                                </>
                            )}
                        </li>
                    ))}
                </ol>
                {canManage && rest.length > 0 && (
                    <SelectField id='ev-add' label='Add a class to the order' value='' onChange={(e) => e.target.value && setOrder([...order, e.target.value])}>
                        <option value=''>Choose</option>
                        {rest.map((c) => (
                            <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                    </SelectField>
                )}
            </section>
            {canManage ? (
                <Button onClick={save} disabled={!dirty || total !== 100} className='w-full sm:w-auto'>
                    <Save className='mr-2 h-4 w-4' /> Save changes
                </Button>
            ) : (
                <p className='text-xs text-muted'>You can view the metrics. Changing them needs the Chart of Authority Administrator role.</p>
            )}
            {data.config.updatedAt && <p className='text-xs text-muted'>Version {data.config.version}, saved {fmtDate(data.config.updatedAt)}.</p>}
            {confirm.sheet}
        </div>
    );
}
