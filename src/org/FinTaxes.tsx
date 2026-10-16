import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Button, Spinner, useLoad } from '../admin/kit';
import { useConfirm } from '../components/screen';
import { Card, FIN_API, FinScreen, Pending, Pill, go, useEntity, type Entity } from './finKit';

// Taxes of a legal entity: tax regimes (VAT, withholding, excise, other), each with dated rates and the balance sheet
// account each rate posts to for purchases and for sales. An approved rate is never deleted; it is ended with a date.
// The account mapping shows which transactions each tax applies to.

interface Rate {
    code: string;
    name: string;
    rate: number;
    validFrom: string;
    validTo: string;
    purchaseGl: string;
    saleGl: string;
    recoverable: boolean;
}
interface Regime {
    code: string;
    name: string;
    kind: string;
    authority: string;
    registrationNo: string;
    appliesTo: string[];
    rates: Rate[];
    active: boolean;
}
interface TaxData {
    regimes: Regime[];
    version: number;
    kinds: Record<string, string>;
    accounts: Array<{ code: string; name: string }>;
    country: string;
    pending: Array<{ id: string; typeLabel: string; title: string; makerName: string }>;
    can: Record<string, boolean>;
}
const today = () => new Date().toISOString().slice(0, 10);

function Body({ le }: { le: Entity }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<TaxData>(`${FIN_API}/tax/get`, { leId: le.id }), [le.id]);
    const [list, setList] = useState<Regime[]>([]);
    const [msg, setMsg] = useState('');
    const confirm = useConfirm();
    useEffect(() => {
        if (data) setList(JSON.parse(JSON.stringify(data.regimes)) as Regime[]);
    }, [data]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the taxes.'}</Alert>;
    const can = data.can.tax_manage;
    const approved = new Set(data.regimes.flatMap((r) => r.rates.map((x) => `${r.code}|${x.code}`)));
    const setR = (i: number, p: Partial<Regime>) => setList(list.map((r, k) => (k === i ? { ...r, ...p } : r)));
    const setRate = (i: number, j: number, p: Partial<Rate>) => setR(i, { rates: list[i].rates.map((x, k) => (k === j ? { ...x, ...p } : x)) });
    const problems: string[] = [];
    list.forEach((r, i) => {
        if (!/^[A-Z0-9_]{2,12}$/.test(r.code)) problems.push(`Regime ${i + 1}: code of 2 to 12 capital letters or digits.`);
        if (r.name.trim().length < 3) problems.push(`Regime ${i + 1}: name.`);
        if (!r.appliesTo.length) problems.push(`Regime ${i + 1}: purchases, sales or both.`);
        if (!r.rates.length) problems.push(`Regime ${i + 1}: at least one rate.`);
        r.rates.forEach((x, j) => {
            if (!/^[A-Z0-9_]{2,16}$/.test(x.code)) problems.push(`${r.code || i + 1} rate ${j + 1}: code.`);
            if (!(x.rate >= 0 && x.rate <= 100)) problems.push(`${r.code} rate ${j + 1}: 0 to 100%.`);
            if (!x.validFrom || (x.validTo && x.validTo < x.validFrom)) problems.push(`${r.code} rate ${j + 1}: dates.`);
            if (r.appliesTo.includes('purchase') && !x.purchaseGl) problems.push(`${r.code} rate ${j + 1}: purchase account.`);
            if (r.appliesTo.includes('sale') && !x.saleGl) problems.push(`${r.code} rate ${j + 1}: sales account.`);
        });
    });
    const changed = JSON.stringify(list) !== JSON.stringify(data.regimes);
    const acc = (id: string, label: string, value: string, on: (v: string) => void) => (
        <SelectField id={id} label={label} value={value} disabled={!can} onChange={(e) => on(e.target.value)}>
            <option value=''>Choose a balance sheet account</option>
            {data.accounts.map((a) => (
                <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                </option>
            ))}
        </SelectField>
    );
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            <Pending items={data.pending} />
            <Alert tone='info'>Taxes are posted by supplier and customer invoices (Accounts Payable and Receivable, not built yet). Receipts post to GR/IR without tax. Version {data.version}.</Alert>
            {list.map((r, i) => (
                <Card key={i} title={`${r.code || 'New regime'} ${r.name}`} right={<Pill status={r.active ? 'active' : 'closed'} label={r.active ? 'In use' : 'Not in use'} />}>
                    <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                        <Field id={`tx-c-${i}`} label='Code' value={r.code} disabled={!can || (i < data.regimes.length && data.regimes[i].code === r.code)} maxLength={12} onChange={(e) => setR(i, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
                        <Field id={`tx-n-${i}`} label='Name' value={r.name} disabled={!can} maxLength={80} onChange={(e) => setR(i, { name: e.target.value })} />
                        <SelectField id={`tx-k-${i}`} label='Kind' value={r.kind} disabled={!can} onChange={(e) => setR(i, { kind: e.target.value })}>
                            {Object.entries(data.kinds).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </SelectField>
                        <Field id={`tx-a-${i}`} label='Tax authority' value={r.authority} disabled={!can} maxLength={80} onChange={(e) => setR(i, { authority: e.target.value })} />
                        <Field id={`tx-r-${i}`} label='Registration number' value={r.registrationNo} disabled={!can} maxLength={40} onChange={(e) => setR(i, { registrationNo: e.target.value })} />
                    </div>
                    <div className='flex flex-wrap gap-2'>
                        {(['purchase', 'sale'] as const).map((k) => (
                            <label key={k} className='flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm text-soft'>
                                <input type='checkbox' className='h-5 w-5 accent-emerald-500' disabled={!can} checked={r.appliesTo.includes(k)} onChange={() => setR(i, { appliesTo: r.appliesTo.includes(k) ? r.appliesTo.filter((x) => x !== k) : [...r.appliesTo, k] })} />
                                Applies to {k === 'purchase' ? 'purchases' : 'sales'}
                            </label>
                        ))}
                        <label className='flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm text-soft'>
                            <input type='checkbox' className='h-5 w-5 accent-emerald-500' disabled={!can} checked={r.active} onChange={() => setR(i, { active: !r.active })} />
                            In use
                        </label>
                    </div>
                    {r.rates.map((x, j) => {
                        const locked = approved.has(`${r.code}|${x.code}`);
                        return (
                            <div key={j} className='space-y-2 rounded-xl border border-line p-2'>
                                <div className='grid grid-cols-2 gap-2'>
                                    <Field id={`tx-rc-${i}-${j}`} label='Rate code' value={x.code} disabled={!can || locked} maxLength={16} onChange={(e) => setRate(i, j, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
                                    <Field id={`tx-rv-${i}-${j}`} label='Rate %' inputMode='decimal' value={String(x.rate)} disabled={!can || locked} onChange={(e) => setRate(i, j, { rate: Number(e.target.value.replace(/[^\d.]/g, '')) })} />
                                    <Field id={`tx-rn-${i}-${j}`} label='Name' value={x.name} disabled={!can} maxLength={60} onChange={(e) => setRate(i, j, { name: e.target.value })} />
                                    <Field id={`tx-rf-${i}-${j}`} label='Valid from' type='date' value={x.validFrom} disabled={!can || locked} onChange={(e) => setRate(i, j, { validFrom: e.target.value })} />
                                    <Field id={`tx-rt-${i}-${j}`} label='Valid to (optional)' type='date' value={x.validTo} disabled={!can} onChange={(e) => setRate(i, j, { validTo: e.target.value })} />
                                </div>
                                {r.appliesTo.includes('purchase') && acc(`tx-pg-${i}-${j}`, 'Account for purchases (recoverable tax)', x.purchaseGl, (v) => setRate(i, j, { purchaseGl: v }))}
                                {r.appliesTo.includes('sale') && acc(`tx-sg-${i}-${j}`, 'Account for sales (tax payable)', x.saleGl, (v) => setRate(i, j, { saleGl: v }))}
                                {can && !locked && (
                                    <button type='button' className='flex min-h-11 items-center gap-1 text-sm text-red-300' onClick={() => setR(i, { rates: r.rates.filter((_, k) => k !== j) })}>
                                        <Trash2 className='h-4 w-4' /> Remove this rate
                                    </button>
                                )}
                                {locked && <p className='text-xs text-muted'>Approved rate: it can only be ended with a date.</p>}
                            </div>
                        );
                    })}
                    {can && (
                        <Button variant='secondary' onClick={() => setR(i, { rates: [...r.rates, { code: '', name: '', rate: 0, validFrom: today(), validTo: '', purchaseGl: '', saleGl: '', recoverable: true }] })}>
                            <Plus className='h-4 w-4' /> Add a rate
                        </Button>
                    )}
                </Card>
            ))}
            {can && (
                <div className='flex flex-wrap gap-2'>
                    <Button variant='secondary' onClick={() => setList([...list, { code: '', name: '', kind: 'vat', authority: '', registrationNo: '', appliesTo: ['purchase', 'sale'], rates: [{ code: '', name: '', rate: 16, validFrom: today(), validTo: '', purchaseGl: '', saleGl: '', recoverable: true }], active: true }])}>
                        <Plus className='h-4 w-4' /> Add a tax regime
                    </Button>
                    <Button disabled={!changed || problems.length > 0} onClick={() => confirm.ask({ title: 'Propose the taxes', message: 'A person with FIN.tax.approve must approve before they apply.', confirmLabel: 'Propose', reason: { label: 'Reason (e.g. the law or notice that sets the rate)', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/tax/propose`, { leId: le.id, regimes: list, reason }); setMsg('Proposed for approval.'); reload(); })}>
                        Propose taxes
                    </Button>
                </div>
            )}
            {can && changed && problems.length > 0 && <Alert tone='warn'>{problems.slice(0, 6).join(' ')}</Alert>}
            {!list.length && <p className='text-sm text-muted'>No tax regimes yet{data.country ? ` for ${data.country}` : ''}.</p>}
            {confirm.sheet}
        </>
    );
}

export default function FinTaxes() {
    const ent = useEntity();
    return (
        <FinScreen title='Taxes' subtitle='Tax regimes, dated rates and their accounts' onBack={() => go('module/FIN')} entityState={ent}>
            {(le) => <Body le={le} />}
        </FinScreen>
    );
}
