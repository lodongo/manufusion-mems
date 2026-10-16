import { useState } from 'react';
import { ACTION_LABELS, CATEGORY_LABELS, fmtDate } from './format';
import { Badge, Empty } from './kit';

export interface LogEntry {
    id: string;
    at: string;
    category: string;
    action: string;
    outcome: string;
    source: string;
    actorEmail: string;
    actorRole: string;
    orgId: string;
    targetType: string;
    target: string;
    details: string;
    route: string;
    durationMs: number | null;
    ip: string;
    country: string;
    userAgent: string;
    device: string;
    sessionId: string;
}

const OUTCOME_TONE: Record<string, 'brand' | 'danger' | 'warn' | 'muted'> = {
    success: 'brand',
    failure: 'danger',
    denied: 'danger',
    blocked: 'warn',
};

export default function LogList({ logs }: { logs: LogEntry[] }) {
    const [open, setOpen] = useState('');
    if (logs.length === 0) return <Empty>No activity yet.</Empty>;
    return (
        <ul className='divide-y divide-slate-800'>
            {logs.map((log) => {
                const label = log.category === 'api' ? log.action : ACTION_LABELS[log.action] ?? log.action;
                const expanded = open === log.id;
                return (
                    <li key={log.id} className='py-3'>
                        <button type='button' onClick={() => setOpen(expanded ? '' : log.id)} className='block w-full text-left' aria-label={`Audit event ${label}`}>
                            <div className='flex items-start justify-between gap-3'>
                                <p className='min-w-0 truncate text-sm font-medium text-white'>{label}</p>
                                <p className='shrink-0 text-xs text-slate-500'>{fmtDate(log.at)}</p>
                            </div>
                            <div className='mt-1 flex flex-wrap items-center gap-1'>
                                <Badge>{CATEGORY_LABELS[log.category] ?? (log.category || 'event')}</Badge>
                                {log.outcome && log.outcome !== 'success' && <Badge tone={OUTCOME_TONE[log.outcome] ?? 'muted'}>{log.outcome}</Badge>}
                                <span className='truncate text-xs text-slate-400'>{log.actorEmail}</span>
                            </div>
                            {(log.target || log.details) && (
                                <p className='mt-0.5 truncate text-xs text-slate-500'>
                                    {log.target}
                                    {log.details ? ` · ${log.details}` : ''}
                                </p>
                            )}
                        </button>
                        {expanded && (
                            <dl className='mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-xl bg-slate-950 p-3 text-xs'>
                                {[
                                    ['Action', log.action],
                                    ['Role', log.actorRole],
                                    ['Route', log.route],
                                    ['IP address', log.ip],
                                    ['Country', log.country],
                                    ['Device', log.device],
                                    ['Browser', log.userAgent],
                                    ['Session', log.sessionId],
                                    ['Source', log.source],
                                    ['Duration', log.durationMs !== null ? `${log.durationMs} ms` : ''],
                                    ['Details', log.details],
                                ]
                                    .filter(([, value]) => value)
                                    .map(([key, value]) => (
                                        <div key={key} className='contents'>
                                            <dt className='text-slate-500'>{key}</dt>
                                            <dd className='break-all text-slate-300'>{value}</dd>
                                        </div>
                                    ))}
                            </dl>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
