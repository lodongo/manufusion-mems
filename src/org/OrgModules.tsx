import { useState } from 'react';
import { Eye, Lock, Puzzle, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Badge, Button, Card, Empty, PageTitle, Spinner, useLoad } from '../admin/kit';
import { appConfirm } from '../components/dialogs';

interface Mod {
    code: string;
    name: string;
    category: string;
    description: string;
    features: string[];
    mandatory: boolean;
    adopted: boolean;
    enabled: boolean;
    monthlyPriceKes: number;
    pricePerUserKes: number;
    dependencies: string[];
}

export type ModulesView = 'all' | 'available' | 'adopted';

const kes = (n: number) => `KES ${n.toLocaleString()}`;
const price = (m: Mod) => (m.monthlyPriceKes || m.pricePerUserKes ? `${kes(m.monthlyPriceKes)}/month${m.pricePerUserKes ? ` + ${kes(m.pricePerUserKes)} per user` : ''}` : 'Included');

const TITLES: Record<ModulesView, { title: string; subtitle: string; empty: string }> = {
    all: { title: 'All modules', subtitle: 'Everything MEMS offers', empty: 'MEMS has not released any modules yet.' },
    available: { title: 'Not adopted', subtitle: 'Modules from the MEMS catalogue you have not adopted', empty: 'You have adopted every available module.' },
    adopted: { title: 'Adopted', subtitle: 'Green is enabled, red is disabled', empty: 'No modules adopted yet. Adopt them from Not adopted.' },
};

function borderFor(m: Mod): string {
    if (!m.adopted) return 'border-slate-800';
    return m.enabled ? 'border-emerald-500' : 'border-red-500';
}

export default function OrgModules({ view }: { view: ModulesView }) {
    const { data, error, loading, setData } = useLoad(() => callBackend<{ modules: Mod[] }>('/api/org/modules/list'));
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState('');
    const [info, setInfo] = useState('');
    const [viewing, setViewing] = useState<string | null>(null);

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load modules.'}</Alert>;

    const act = async (m: Mod, action: 'adopt' | 'enable' | 'disable' | 'remove') => {
        if (action === 'remove' && !(await appConfirm(`Remove ${m.name} from your adopted modules?`))) return;
        setBusy(`${m.code}:${action}`);
        setActionError('');
        setInfo('');
        try {
            const res = await callBackend<{ modules: Mod[]; also: string[] }>('/api/org/modules/action', { code: m.code, action });
            setData({ modules: res.modules });
            const verb = { adopt: 'adopted and enabled', enable: 'enabled', disable: 'disabled', remove: 'removed from adopted' }[action];
            setInfo(`${m.name} ${verb}.${res.also.length ? ` Also enabled because it is required: ${res.also.join(', ')}.` : ''}`);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not update the module.');
        } finally {
            setBusy('');
        }
    };

    const modules = data.modules.filter((m) => (view === 'available' ? !m.adopted : view === 'adopted' ? m.adopted : true));
    const counts = {
        adopted: data.modules.filter((m) => m.adopted).length,
        enabled: data.modules.filter((m) => m.enabled).length,
        available: data.modules.filter((m) => !m.adopted).length,
    };
    const t = TITLES[view];
    const current = viewing ? data.modules.find((m) => m.code === viewing) : undefined;

    const actions = (m: Mod, full = false) => {
        if (m.mandatory) return <Badge>Always on</Badge>;
        const b = (action: 'adopt' | 'enable' | 'disable' | 'remove', label: string, variant: 'primary' | 'secondary' | 'danger' = 'primary') => (
            <Button key={action} variant={variant} busy={busy === `${m.code}:${action}`} disabled={!!busy} onClick={() => act(m, action)}>
                {label}
            </Button>
        );
        if (!m.adopted) return b('adopt', 'Adopt');
        return (
            <div className='flex gap-2'>
                {m.enabled ? b('disable', 'Disable', 'danger') : b('enable', 'Enable')}
                {full && !m.enabled && b('remove', 'Remove', 'secondary')}
            </div>
        );
    };

    if (current) {
        return (
            <div className='space-y-4'>
                <div className='flex items-center justify-between gap-2'>
                    <PageTitle title={current.name} subtitle={`${current.code} · ${current.category}`} />
                    <button onClick={() => setViewing(null)} aria-label='Close' className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                        <X className='h-4 w-4' />
                    </button>
                </div>
                <Card className={`space-y-3 border-2 ${borderFor(current)}`}>
                    <div className='flex flex-wrap gap-2'>
                        {current.mandatory ? <Badge>Always on</Badge> : current.adopted ? <Badge tone={current.enabled ? 'brand' : 'danger'}>{current.enabled ? 'Enabled' : 'Disabled'}</Badge> : <Badge tone='muted'>Not adopted</Badge>}
                        <Badge tone='muted'>{price(current)}</Badge>
                    </div>
                    <p className='whitespace-pre-line text-sm text-slate-300'>{current.description}</p>
                    {current.features.length > 0 && (
                        <ul className='list-disc space-y-1 pl-5 text-sm text-slate-300'>
                            {current.features.map((f) => (
                                <li key={f}>{f}</li>
                            ))}
                        </ul>
                    )}
                    {current.dependencies.length > 0 && <p className='text-xs text-slate-500'>Needs: {current.dependencies.join(', ')} (enabled automatically)</p>}
                    {actions(current, true)}
                </Card>
                {actionError && <Alert tone='error'>{actionError}</Alert>}
                {info && <Alert tone='info'>{info}</Alert>}
            </div>
        );
    }

    return (
        <div className='space-y-4'>
            <PageTitle title={t.title} subtitle={t.subtitle} />
            <div className='grid grid-cols-3 gap-2 text-center'>
                <button onClick={() => navigate('organization_admin/modules_adopted')} className='rounded-xl border border-slate-800 bg-slate-900 px-2 py-2'>
                    <p className='text-lg font-semibold text-white'>{counts.adopted}</p>
                    <p className='text-[11px] text-slate-500'>Adopted</p>
                </button>
                <button onClick={() => navigate('organization_admin/modules_adopted')} className='rounded-xl border border-emerald-500/40 bg-slate-900 px-2 py-2'>
                    <p className='text-lg font-semibold text-emerald-300'>{counts.enabled}</p>
                    <p className='text-[11px] text-slate-500'>Enabled</p>
                </button>
                <button onClick={() => navigate('organization_admin/modules_available')} className='rounded-xl border border-slate-800 bg-slate-900 px-2 py-2'>
                    <p className='text-lg font-semibold text-white'>{counts.available}</p>
                    <p className='text-[11px] text-slate-500'>Not adopted</p>
                </button>
            </div>
            {actionError && <Alert tone='error'>{actionError}</Alert>}
            {info && <Alert tone='info'>{info}</Alert>}
            {modules.length === 0 ? (
                <Card>
                    <Empty>{t.empty}</Empty>
                </Card>
            ) : (
                <div className='space-y-2'>
                    {modules.map((m) => (
                        <div key={m.code} className={`rounded-2xl border-2 bg-slate-900 p-3 ${borderFor(m)}`}>
                            <div className='flex items-start gap-3'>
                                {m.mandatory ? <Lock className='mt-0.5 h-5 w-5 shrink-0 text-slate-500' /> : <Puzzle className='mt-0.5 h-5 w-5 shrink-0 text-emerald-400' />}
                                <div className='min-w-0 flex-1'>
                                    <p className='truncate text-sm font-medium text-white'>{m.name}</p>
                                    <p className='truncate text-xs text-slate-500'>
                                        {m.code} · {m.category} · {price(m)}
                                    </p>
                                </div>
                                {m.adopted && !m.mandatory && <span className={`text-xs font-medium ${m.enabled ? 'text-emerald-300' : 'text-red-400'}`}>{m.enabled ? 'Enabled' : 'Disabled'}</span>}
                            </div>
                            <div className='mt-3 flex items-center justify-between gap-2'>
                                <Button variant='secondary' onClick={() => setViewing(m.code)}>
                                    <Eye className='h-4 w-4' />
                                    View
                                </Button>
                                {actions(m)}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
