import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search, X } from 'lucide-react';
import { callBackend } from '../lib/backend';

// Additional security roles a person holds directly besides the primary role (e.g. Asset Clerk and Document
// Author). Every change is checked live on the server for duties that must stay apart, across all the person's
// direct roles and (for an existing person) their job roles. The save checks everything again.

export interface AccessCheck {
    superAdmin: boolean;
    permissions: number;
    conflicts: Array<{ id: string; why: string; a: string; b: string; fromA: string[]; fromB: string[] }>;
    notGrantable: string[];
    max: number;
}

const SYSTEM = new Set(['org_super_admin', 'org_admin', 'org_user', 'default_security']);

export default function RoleSetPicker({
    roles,
    primary,
    value,
    onChange,
    endpoint,
    uid,
    disabled,
    max = 12,
    onCheck,
}: {
    roles: Array<{ id: string; name: string }>;
    primary: string;
    value: string[];
    onChange: (next: string[]) => void;
    /** Server preview route (users or HR). */
    endpoint: string;
    uid?: string;
    disabled?: boolean;
    max?: number;
    onCheck?: (check: AccessCheck | null) => void;
}) {
    const [query, setQuery] = useState('');
    const [check, setCheck] = useState<AccessCheck | null>(null);
    const [checking, setChecking] = useState(false);
    const [failure, setFailure] = useState('');
    const seq = useRef(0);
    const name = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
    const superAdmin = primary === 'org_super_admin';
    const available = useMemo(() => {
        const q = query.trim().toLowerCase();
        return roles.filter((r) => !SYSTEM.has(r.id) && r.id !== primary && !value.includes(r.id) && (!q || r.name.toLowerCase().includes(q)));
    }, [roles, primary, value, query]);

    // Live check: every change of primary or additional roles, shortly after the last tap.
    useEffect(() => {
        const n = ++seq.current;
        setChecking(true);
        setFailure('');
        const timer = window.setTimeout(() => {
            callBackend<AccessCheck>(endpoint, { uid, role: primary, additionalRoles: superAdmin ? [] : value })
                .then((r) => { if (n === seq.current) { setCheck(r); onCheck?.(r); } })
                .catch((e) => { if (n === seq.current) { setCheck(null); onCheck?.(null); setFailure(e instanceof Error ? e.message : 'Could not check the roles.'); } })
                .finally(() => { if (n === seq.current) setChecking(false); });
        }, 350);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint, uid, primary, value.join('|')]);

    if (superAdmin) return <p className='rounded-xl border border-line bg-page p-3 text-xs text-muted'>An organization super admin already holds every right, so no additional roles are needed.</p>;

    return (
        <div className='space-y-2'>
            <div className='flex items-center justify-between gap-2'>
                <span className='text-sm text-soft'>Additional security roles ({value.length}/{max})</span>
                {checking ? (
                    <span className='flex items-center gap-1 text-xs text-muted'><Loader2 className='h-3.5 w-3.5 animate-spin' />Checking</span>
                ) : check && !check.conflicts.length && !check.notGrantable.length ? (
                    <span className='flex items-center gap-1 text-xs text-brand'><CheckCircle2 className='h-3.5 w-3.5' />No conflicts · {check.permissions} rights</span>
                ) : check ? (
                    <span className='flex items-center gap-1 text-xs text-red-400'><AlertTriangle className='h-3.5 w-3.5' />{check.conflicts.length} conflict{check.conflicts.length === 1 ? '' : 's'}</span>
                ) : null}
            </div>
            {value.length > 0 && (
                <ul className='flex flex-wrap gap-1.5' aria-label='Additional security roles held'>
                    {value.map((id) => (
                        <li key={id} className='flex min-h-9 items-center gap-1 rounded-full border border-brand/50 bg-brand/10 pl-3 pr-1 text-xs text-ink'>
                            {name(id)}
                            {!disabled && (
                                <button type='button' aria-label={`Remove ${name(id)}`} onClick={() => onChange(value.filter((x) => x !== id))} className='flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-panel'>
                                    <X className='h-3.5 w-3.5' />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {!disabled && value.length < max && (
                <div className='rounded-xl border border-line bg-page p-2'>
                    <label className='relative block'>
                        <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted' />
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Find a role to add, e.g. Document Author' aria-label='Find a security role to add'
                            className='h-11 w-full rounded-lg border border-line bg-panel pl-9 pr-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none' />
                    </label>
                    <ul className='mt-2 max-h-48 space-y-1 overflow-y-auto overscroll-contain'>
                        {available.slice(0, 60).map((r) => (
                            <li key={r.id}>
                                <button type='button' onClick={() => { onChange([...value, r.id]); setQuery(''); }} className='flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm text-ink active:bg-panel'>
                                    <span className='min-w-0 truncate'>{r.name}</span><span className='shrink-0 text-xs text-brand'>Add</span>
                                </button>
                            </li>
                        ))}
                        {!available.length && <li className='px-3 py-2 text-xs text-muted'>No other roles match.</li>}
                    </ul>
                </div>
            )}
            {failure && <p role='alert' className='text-xs text-red-400'>{failure}</p>}
            {check?.notGrantable.length ? <p role='alert' className='rounded-lg border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-400'>You cannot give {check.notGrantable.join(', ')}: they carry rights you do not hold yourself.</p> : null}
            {check?.conflicts.length ? (
                <div role='alert' className='space-y-2 rounded-xl border border-red-500/50 bg-red-500/10 p-3'>
                    <p className='text-xs font-semibold text-red-400'>Duties that must stay apart. Remove one side, or saving will ask for an audited business reason.</p>
                    {check.conflicts.map((c) => (
                        <div key={c.id} className='text-xs text-soft'>
                            <p className='text-ink'>{c.why}</p>
                            <p className='mt-0.5'><span className='font-mono text-[11px]'>{c.a}</span> from {c.fromA.join(', ') || '—'}</p>
                            <p><span className='font-mono text-[11px]'>{c.b}</span> from {c.fromB.join(', ') || '—'}</p>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
