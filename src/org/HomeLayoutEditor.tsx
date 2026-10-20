import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutDashboard, RotateCcw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Button, Card, Spinner } from '../admin/kit';
import { HOME_CARDS, defaultHomeLayout, type HomeCardSize, type HomeKey, type HomeLayout, type HomeLayoutResponse } from '../lib/homeLayout';

export default function HomeLayoutEditor() {
    const [available, setAvailable] = useState<HomeKey[]>([]);
    const [layout, setLayout] = useState<HomeLayout>(defaultHomeLayout);
    const [saved, setSaved] = useState<HomeLayout>(defaultHomeLayout);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    useEffect(() => {
        let alive = true;
        callBackend<HomeLayoutResponse>('/api/org/home-layout/get')
            .then((result) => {
                if (!alive) return;
                setLayout(result.layout);
                setSaved(result.layout);
                setAvailable(result.available);
            })
            .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Cannot load your homepage setup.'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    const changeOrder = (key: HomeKey, delta: number) => {
        const displayed = layout.order.filter((item) => available.includes(item));
        const from = displayed.indexOf(key);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= displayed.length) return;
        [displayed[from], displayed[to]] = [displayed[to], displayed[from]];
        const remaining = layout.order.filter((item) => !available.includes(item));
        setLayout({ ...layout, order: [...displayed, ...remaining] });
    };
    const changeSize = (key: HomeKey, value: HomeCardSize) => {
        setLayout({ ...layout, sizes: { ...layout.sizes, [key]: value } });
    };
    const toggle = (key: HomeKey) => setLayout((value) => ({
        ...value,
        hidden: value.hidden.includes(key) ? value.hidden.filter((item) => item !== key) : [...value.hidden, key],
    }));

    const save = async () => {
        setBusy(true);
        setError('');
        setInfo('');
        try {
            const result = await callBackend<HomeLayoutResponse>('/api/org/home-layout/save', { layout });
            setLayout(result.layout);
            setSaved(result.layout);
            setAvailable(result.available);
            setInfo('Your home layout is saved. Return to Organization home to see the changes.');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save your home layout.');
        } finally {
            setBusy(false);
        }
    };
    const changed = JSON.stringify(layout) !== JSON.stringify(saved);
    return (
        <Card className='space-y-3'>
            <div className='flex items-start gap-2'>
                <LayoutDashboard className='mt-0.5 h-5 w-5 shrink-0 text-brand' />
                <div>
                    <h2 className='font-semibold text-ink'>My home layout</h2>
                    <p className='mt-1 text-xs text-muted'>Choose, reorder and resize cards mapped to your account. Empty cards hide automatically. This never changes your permissions.</p>
                </div>
            </div>
            {loading ? <Spinner /> : (
                <>
                    <div className='space-y-2'>
                        {layout.order.filter((key) => available.includes(key)).map((key, index, mapped) => {
                            const card = HOME_CARDS.find((item) => item.key === key);
                            if (!card) return null;
                            const enabled = !layout.hidden.includes(key);
                            return (
                                <div key={key} className='rounded-xl border border-line bg-page p-3'>
                                    <div className='flex items-center gap-2'>
                                        <button type='button' aria-label={(enabled ? 'Hide ' : 'Show ') + card.label}
                                            onClick={() => toggle(key)} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-brand'>
                                            {enabled ? <Eye className='h-4 w-4' /> : <EyeOff className='h-4 w-4' />}
                                        </button>
                                        <div className='min-w-0 flex-1'>
                                            <p className='text-sm font-semibold text-ink'>{card.label}</p>
                                            <p className='text-xs text-muted'>{card.hint}</p>
                                        </div>
                                        <div className='flex shrink-0 gap-1'>
                                            <button type='button' aria-label={'Move ' + card.label + ' up'} disabled={index === 0}
                                                onClick={() => changeOrder(key, -1)}
                                                className='flex h-11 w-9 items-center justify-center rounded-lg border border-line text-muted disabled:opacity-30'>
                                                <ArrowUp className='h-4 w-4' />
                                            </button>
                                            <button type='button' aria-label={'Move ' + card.label + ' down'} disabled={index === mapped.length - 1}
                                                onClick={() => changeOrder(key, 1)}
                                                className='flex h-11 w-9 items-center justify-center rounded-lg border border-line text-muted disabled:opacity-30'>
                                                <ArrowDown className='h-4 w-4' />
                                            </button>
                                        </div>
                                    </div>
                                    <label className='mt-2 flex items-center gap-2 pl-1 text-xs text-muted'>
                                        Card size
                                        <select value={layout.sizes[key]} onChange={(e) => changeSize(key, e.target.value as HomeCardSize)}
                                            className='min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-sm text-ink'>
                                            <option value='compact'>Compact · fewer rows</option>
                                            <option value='regular'>Regular</option>
                                            <option value='wide'>Wide · more rows on larger screens</option>
                                        </select>
                                    </label>
                                </div>
                            );
                        })}
                    </div>
                    <p className='text-xs text-muted'>Cards appear only when you have access and there is content. Wide cards span two columns on a larger screen; all sizes fit your phone.</p>
                    <div className='flex flex-wrap gap-2'>
                        <Button type='button' disabled={!changed || busy} busy={busy} onClick={() => { void save(); }} className='min-w-0 flex-1'>Save home layout</Button>
                        <Button type='button' variant='secondary' disabled={busy} onClick={() => setLayout(defaultHomeLayout())}>
                            <RotateCcw className='h-4 w-4' /> Reset
                        </Button>
                    </div>
                </>
            )}
            {error && <Alert tone='error'>{error}</Alert>}
            {info && <Alert tone='success'>{info}</Alert>}
        </Card>
    );
}
