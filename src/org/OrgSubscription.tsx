import { useState } from 'react';
import { CreditCard, Smartphone } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field } from '../components/ui';
import { Badge, Button, Card, Empty, PageTitle, Spinner, useLoad } from '../admin/kit';
import { appConfirm } from '../components/dialogs';

interface Subscription {
    period: string;
    currency: string;
    users: number;
    lines: Array<{ code: string; name: string; monthly: number; perUser: number; users: number; amount: number }>;
    total: number;
    paid: number;
    balance: number;
    status: string;
    payments: Array<{ id: string; period: string; amount: number; method: string; provider: string; status: string; reference: string; createdAt: string; paidAt: string }>;
    provider: { name: string; mode: string };
}

const kes = (n: number) => `KES ${n.toLocaleString()}`;
const STATUS: Record<string, { label: string; tone: 'brand' | 'danger' | 'muted' }> = {
    paid: { label: 'Paid', tone: 'brand' },
    partial: { label: 'Part paid', tone: 'danger' },
    due: { label: 'Payment due', tone: 'danger' },
    free: { label: 'Nothing to pay', tone: 'muted' },
};

export default function OrgSubscription() {
    const { data, error, loading, setData } = useLoad(() => callBackend<Subscription>('/api/org/subscription'));
    const [method, setMethod] = useState<'mpesa' | 'card'>('mpesa');
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [payError, setPayError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load your subscription.'}</Alert>;

    const month = new Date(`${data.period}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const status = STATUS[data.status] ?? STATUS.due;
    const simulated = data.provider.name === 'Simulation';

    const pay = async () => {
        setPayError('');
        if (simulated && !(await appConfirm(`Simulate a ${method === 'mpesa' ? 'M-Pesa' : 'card'} payment of ${kes(data.balance)}? No money will move.`))) return;
        setBusy(true);
        try {
            const res = await callBackend<{ subscription?: Subscription; checkoutUrl?: string }>('/api/org/subscription/pay', { method, phone });
            if (res.checkoutUrl) {
                window.location.href = res.checkoutUrl;
                return;
            }
            if (res.subscription) setData(res.subscription);
        } catch (err) {
            setPayError(err instanceof Error ? err.message : 'Payment could not start.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className='space-y-4'>
            <PageTitle title='Subscription' subtitle={`${month} · ${data.users} active user${data.users === 1 ? '' : 's'}`} />
            <Card className='space-y-3'>
                <div className='flex items-start justify-between gap-3'>
                    <div>
                        <p className='text-xs uppercase tracking-wider text-slate-500'>Total per month</p>
                        <p className='text-3xl font-semibold text-white'>{kes(data.total)}</p>
                        {data.paid > 0 && <p className='text-xs text-slate-400'>Paid {kes(data.paid)} · Balance {kes(data.balance)}</p>}
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                {data.balance > 0 && (
                    <div className='space-y-3 border-t border-slate-800 pt-3'>
                        <div className='grid grid-cols-2 gap-2'>
                            <button type='button' onClick={() => setMethod('mpesa')} className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-medium ${method === 'mpesa' ? 'bg-emerald-500 text-onbrand' : 'border border-slate-700 text-slate-300'}`}>
                                <Smartphone className='h-4 w-4' />
                                M-Pesa
                            </button>
                            <button type='button' onClick={() => setMethod('card')} className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-medium ${method === 'card' ? 'bg-emerald-500 text-onbrand' : 'border border-slate-700 text-slate-300'}`}>
                                <CreditCard className='h-4 w-4' />
                                Card
                            </button>
                        </div>
                        {method === 'mpesa' && <Field id='pay-phone' label='M-Pesa phone number' type='tel' inputMode='tel' placeholder='+254712345678' value={phone} onChange={(e) => setPhone(e.target.value)} />}
                        {payError && <Alert tone='error'>{payError}</Alert>}
                        <Button className='w-full' busy={busy} onClick={pay}>
                            Pay {kes(data.balance)}
                        </Button>
                    </div>
                )}
                <p className='text-xs text-slate-500'>
                    {simulated ? 'Test mode: payments are simulated. M-Pesa and card payments through IntaSend will be switched on soon.' : `Payments by IntaSend (${data.provider.mode}).`}
                </p>
            </Card>

            <section>
                <h2 className='mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'>Subscribed modules</h2>
                {data.lines.length === 0 ? (
                    <Empty>No modules enabled yet.</Empty>
                ) : (
                    <Card className='p-0'>
                        <ul className='divide-y divide-slate-800'>
                            {data.lines.map((l) => (
                                <li key={l.code} className='flex items-start justify-between gap-3 px-4 py-3'>
                                    <div className='min-w-0'>
                                        <p className='truncate text-sm text-white'>{l.name}</p>
                                        <p className='text-xs text-slate-500'>
                                            {l.code} · {kes(l.monthly)}
                                            {l.perUser ? ` + ${kes(l.perUser)} × ${l.users} users` : ''}
                                        </p>
                                    </div>
                                    <p className='shrink-0 text-sm font-medium text-white'>{kes(l.amount)}</p>
                                </li>
                            ))}
                            <li className='flex justify-between px-4 py-3 text-sm font-semibold text-white'>
                                <span>Total per month</span>
                                <span>{kes(data.total)}</span>
                            </li>
                        </ul>
                    </Card>
                )}
            </section>

            <section>
                <h2 className='mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'>Payments</h2>
                {data.payments.length === 0 ? (
                    <Empty>No payments yet.</Empty>
                ) : (
                    <Card className='p-0'>
                        <ul className='divide-y divide-slate-800'>
                            {data.payments.map((p) => (
                                <li key={p.id} className='flex items-start justify-between gap-3 px-4 py-3'>
                                    <div className='min-w-0'>
                                        <p className='text-sm text-white'>
                                            {kes(p.amount)} · {p.method === 'card' ? 'Card' : 'M-Pesa'}
                                        </p>
                                        <p className='truncate text-xs text-slate-500'>
                                            {new Date(p.createdAt).toLocaleString()} · {p.period}
                                            {p.reference ? ` · ${p.reference}` : ''}
                                            {p.provider === 'simulation' ? ' · simulated' : ''}
                                        </p>
                                    </div>
                                    <Badge tone={p.status === 'paid' ? 'brand' : p.status === 'failed' ? 'danger' : 'muted'}>{p.status}</Badge>
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}
            </section>
        </div>
    );
}
