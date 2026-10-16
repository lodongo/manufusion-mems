import { useMemo } from 'react';
import { Compass, FileEdit, KeyRound, LogIn, ShieldAlert } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { ACTION_LABELS } from '../admin/format';
import { Card, Empty, PageTitle, Spinner, useLoad } from '../admin/kit';
import type { LogEntry } from '../admin/LogList';

const PAGE_NAMES: Record<string, string> = {
    login: 'the login page',
    site: 'the website',
    organization_home: 'Home',
    'organization_home/profile': 'My details',
    'organization_home/activity': 'My activity',
    organization_admin: 'Overview',
    'organization_admin/users': 'Users',
    'organization_admin/roles': 'Roles and permissions',
    'organization_admin/structure': 'Organization design',
    'organization_admin/settings': 'Settings',
    'organization_admin/branding': 'Branding',
    'organization_admin/audit': 'Audit trail',
    'organization_admin/profile': 'My details',
    'organization_admin/activity': 'My activity',
    'organization_admin/delegations': 'Delegation',
    'organization_admin/workflows': 'Workflows and approvals',
    'organization_admin/authority': 'Chart of authority',
};

function pageName(route: string): string {
    if (PAGE_NAMES[route]) return PAGE_NAMES[route];
    const parts = route.split('/');
    const base = parts.slice(0, 2).join('/');
    if (PAGE_NAMES[base]) return `${PAGE_NAMES[base]} (${parts.slice(2).join(' / ')})`;
    return route || 'a page';
}

function deviceOf(ua: string): string {
    if (!ua) return '';
    const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return [browser, os].filter(Boolean).join(' on ');
}

function describe(e: LogEntry): string {
    const device = deviceOf(e.userAgent);
    const on = device ? ` using ${device}` : '';
    const where = e.country ? ` in ${e.country}` : '';
    switch (e.action) {
        case 'auth.login_attempt':
            return e.outcome === 'success' ? `You signed in${on}${where}` : e.outcome === 'blocked' ? 'A sign-in to your account was blocked' : 'Someone tried to sign in to your account with a wrong password';
        case 'auth.session_start':
            return `You started a session${on}${where}`;
        case 'auth.password_changed':
            return 'You changed your password';
        case 'profile.update':
            return 'You updated your personal details';
        case 'profile.photo':
            return 'You changed your photo';
        case 'navigate':
            return `You opened ${pageName(e.target)}`;
        case 'app.open':
            return `You opened MEMS${on}`;
        case 'submit':
            return 'You submitted a form';
        default: {
            const label = ACTION_LABELS[e.action] ?? e.action.replace(/[._]/g, ' ');
            return `${label}${e.target ? `: ${e.target}` : ''}`;
        }
    }
}

function iconFor(e: LogEntry) {
    if (e.outcome && e.outcome !== 'success') return <ShieldAlert className='h-4 w-4 text-red-400' />;
    if (e.category === 'auth') return e.action === 'auth.password_changed' ? <KeyRound className='h-4 w-4 text-emerald-400' /> : <LogIn className='h-4 w-4 text-emerald-400' />;
    if (e.category === 'navigation') return <Compass className='h-4 w-4 text-sky-400' />;
    return <FileEdit className='h-4 w-4 text-amber-400' />;
}

function dayLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function MyActivity() {
    const { data, error, loading } = useLoad(() => callBackend<{ events: LogEntry[] }>('/api/me/activity'));
    const groups = useMemo(() => {
        const out: Array<{ day: string; items: LogEntry[] }> = [];
        for (const e of data?.events ?? []) {
            const day = dayLabel(e.at);
            const last = out[out.length - 1];
            if (last && last.day === day) last.items.push(e);
            else out.push({ day, items: [e] });
        }
        return out;
    }, [data]);

    return (
        <div className='flex min-h-0 flex-col'>
            <PageTitle title='My activity' />
            <div
                className='h-[calc(100dvh-14rem)] min-h-0 overflow-y-auto overscroll-contain pr-1 sm:h-[calc(100dvh-11rem)]'
                role='region'
                aria-label='My activity history'
                tabIndex={0}
            >
                {loading && !data ? (
                    <Spinner />
                ) : error ? (
                    <Alert tone='error'>{error}</Alert>
                ) : groups.length === 0 ? (
                    <Empty>No activity recorded yet.</Empty>
                ) : (
                    <div className='space-y-5 pb-4'>
                    {groups.map((g) => (
                        <section key={g.day}>
                            <h2 className='mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'>{g.day}</h2>
                            <Card className='p-0'>
                                <ul className='divide-y divide-slate-800'>
                                    {g.items.map((e) => (
                                        <li key={e.id} className='flex items-start gap-3 px-4 py-3'>
                                            <span className='mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800'>{iconFor(e)}</span>
                                            <div className='min-w-0 flex-1'>
                                                <p className='text-sm text-white'>{describe(e)}</p>
                                                <p className='text-xs text-slate-500'>{new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        </section>
                    ))}
                    </div>
                )}
            </div>
        </div>
    );
}
