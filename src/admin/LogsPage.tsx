import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { CATEGORY_LABELS } from './format';
import { Button, Card, PageTitle, Spinner, useLoad } from './kit';
import LogList, { type LogEntry } from './LogList';

export function AuditBrowser({ logs }: { logs: LogEntry[] }) {
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('');
    const [outcome, setOutcome] = useState('');
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return logs.filter(
            (l) =>
                (!category || l.category === category) &&
                (!outcome || l.outcome === outcome) &&
                (!q || `${l.action} ${l.target} ${l.details} ${l.actorEmail} ${l.ip} ${l.route}`.toLowerCase().includes(q))
        );
    }, [logs, search, category, outcome]);

    return (
        <div>
            <div className='mb-4 grid gap-2 sm:grid-cols-3'>
                <input
                    type='search'
                    placeholder='Search user, IP, action'
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className='h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
                />
                <select aria-label='Filter by category' value={category} onChange={(e) => setCategory(e.target.value)} className='h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white'>
                    <option value=''>All categories</option>
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                            {label}
                        </option>
                    ))}
                </select>
                <select aria-label='Filter by outcome' value={outcome} onChange={(e) => setOutcome(e.target.value)} className='h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white'>
                    <option value=''>All outcomes</option>
                    <option value='success'>Success</option>
                    <option value='failure'>Failure</option>
                    <option value='denied'>Denied</option>
                    <option value='blocked'>Blocked</option>
                </select>
            </div>
            <p className='mb-2 text-xs text-slate-500'>{filtered.length} events · tap an event for full details</p>
            <Card>
                <LogList logs={filtered} />
            </Card>
        </div>
    );
}

export default function LogsPage() {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ logs: LogEntry[] }>('/api/admin/logs', { limit: 400 }));
    return (
        <div>
            <PageTitle
                title='Audit trail'
                subtitle='Every login, registration, navigation, click, API call and change across MEMS (latest 400)'
                action={
                    <Button variant='secondary' busy={loading} onClick={reload} aria-label='Refresh audit trail'>
                        <RefreshCw className='h-4 w-4' />
                    </Button>
                }
            />
            {loading && !data ? <Spinner /> : error ? <Alert tone='error'>{error}</Alert> : <AuditBrowser logs={data?.logs ?? []} />}
        </div>
    );
}
