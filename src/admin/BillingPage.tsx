import { useState } from 'react';
import { CircleCheck, CircleX, Copy } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Button, Card, PageTitle, Spinner, useLoad } from './kit';

interface BillingData {
    provider: string;
    intasend: { publishableKey: boolean; secretKey: boolean; webhookChallenge: boolean };
    webhookUrl: string;
}

const OPTIONS = [
    { key: 'mock', label: 'Simulated payments', hint: 'For testing. Payments are recorded instantly without real money.' },
    { key: 'intasend_sandbox', label: 'IntaSend sandbox', hint: 'Real IntaSend checkout with test money.' },
    { key: 'intasend_live', label: 'IntaSend live', hint: 'Real M-Pesa and card payments.' },
];

export default function BillingPage({ isSuper }: { isSuper: boolean }) {
    const { data, error, loading, setData } = useLoad(() => callBackend<BillingData>('/api/admin/billing/get'));
    const [busy, setBusy] = useState('');
    const [saveError, setSaveError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load billing settings.'}</Alert>;

    const choose = async (provider: string) => {
        if (provider === data.provider) return;
        if (provider === 'intasend_live' && !window.confirm('Switch to live IntaSend payments? Organizations will pay with real money.')) return;
        setBusy(provider);
        setSaveError('');
        try {
            const res = await callBackend<{ provider: string }>('/api/admin/billing/save', { provider });
            setData({ ...data, provider: res.provider });
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy('');
        }
    };

    const secrets: Array<[string, boolean]> = [
        ['INTASEND_PUBLISHABLE_KEY', data.intasend.publishableKey],
        ['INTASEND_SECRET_KEY', data.intasend.secretKey],
        ['INTASEND_WEBHOOK_CHALLENGE', data.intasend.webhookChallenge],
    ];

    return (
        <div className='space-y-4'>
            <PageTitle title='Billing and payments' subtitle='How organizations pay for their modules' />
            <Card className='space-y-2'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Payment provider</p>
                {OPTIONS.map((o) => (
                    <button
                        key={o.key}
                        type='button'
                        disabled={!isSuper || !!busy}
                        onClick={() => choose(o.key)}
                        className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left disabled:opacity-60 ${data.provider === o.key ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700'}`}
                    >
                        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${data.provider === o.key ? 'bg-emerald-400' : 'border border-slate-500'}`} />
                        <span>
                            <span className='block text-sm font-medium text-white'>{o.label}</span>
                            <span className='block text-xs text-slate-400'>{o.hint}</span>
                        </span>
                    </button>
                ))}
                {!isSuper && <p className='text-xs text-slate-500'>Only a super admin can change the provider.</p>}
                {saveError && <Alert tone='error'>{saveError}</Alert>}
            </Card>
            <Card className='space-y-3'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>IntaSend setup</p>
                <ol className='list-decimal space-y-1 pl-5 text-sm text-slate-300'>
                    <li>In your IntaSend dashboard, copy the publishable key and the secret API token.</li>
                    <li>Under Webhooks, add the URL below and choose a long random challenge.</li>
                    <li>Add the three secrets below in AppDeploy (never in code), then switch the provider above.</li>
                </ol>
                <ul className='space-y-1.5'>
                    {secrets.map(([name, ok]) => (
                        <li key={name} className='flex items-center gap-2 text-sm'>
                            {ok ? <CircleCheck className='h-4 w-4 text-emerald-400' /> : <CircleX className='h-4 w-4 text-slate-500' />}
                            <span className='font-mono text-xs text-slate-300'>{name}</span>
                            <span className='text-xs text-slate-500'>{ok ? 'added' : 'missing'}</span>
                        </li>
                    ))}
                </ul>
                <div>
                    <p className='mb-1 text-xs text-slate-500'>Webhook URL</p>
                    <div className='flex gap-2'>
                        <code className='min-w-0 flex-1 truncate rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-300'>{data.webhookUrl}</code>
                        <Button variant='secondary' aria-label='Copy webhook URL' onClick={() => void navigator.clipboard?.writeText(data.webhookUrl)}>
                            <Copy className='h-4 w-4' />
                        </Button>
                    </div>
                </div>
                <p className='text-xs text-slate-500'>Every webhook must carry the challenge, and each payment is confirmed directly with IntaSend before it is marked paid.</p>
            </Card>
            <p className='text-xs text-slate-500'>Module prices (monthly price and price per user, in KES) are set on each module under Modules.</p>
        </div>
    );
}
