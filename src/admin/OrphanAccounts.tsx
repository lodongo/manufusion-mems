import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { ROLE_LABELS, STAFF_ROLES } from '../types';
import { Alert } from '../components/ui';
import { fmtDate } from './format';
import { Button, Card, useLoad } from './kit';
import { appConfirm } from '../components/dialogs';

interface Orphan {
    uid: string;
    email: string;
    displayName: string;
    phone: string;
    disabled: boolean;
    createdAt: string;
}

/** Lists @manufusion.com login accounts that have no MEMS profile and lets a super admin attach one. */
export default function OrphanAccounts({ onRepaired }: { onRepaired: () => void }) {
    const { data, error, reload } = useLoad(() => callBackend<{ orphans: Orphan[] }>('/api/admin/users/orphans'));
    const [roles, setRoles] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState('');
    const [actionError, setActionError] = useState('');

    if (error) return <div className='mb-4'><Alert tone='error'>{error}</Alert></div>;
    if (!data || data.orphans.length === 0) return null;

    const repair = async (o: Orphan) => {
        const role = roles[o.uid] ?? 'mems_admin';
        if (!(await appConfirm(`Create a MEMS profile for ${o.email} with the role ${ROLE_LABELS[role]}?`))) return;
        setBusy(o.uid);
        setActionError('');
        try {
            await callBackend('/api/admin/users/repair', { uid: o.uid, role });
            reload();
            onRepaired();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not repair the account.');
        } finally {
            setBusy('');
        }
    };

    return (
        <Card tone='danger' className='mb-4 space-y-3'>
            <div className='flex items-start gap-2'>
                <TriangleAlert className='mt-0.5 h-5 w-5 shrink-0 text-amber-400' />
                <div>
                    <p className='font-medium text-white'>Login accounts without a MEMS profile</p>
                    <p className='text-xs text-slate-400'>These accounts exist in Firebase Authentication but cannot use MEMS until a profile is attached.</p>
                </div>
            </div>
            {data.orphans.map((o) => (
                <div key={o.uid} className='space-y-2 rounded-xl border border-slate-800 p-3'>
                    <p className='truncate text-sm font-medium text-white'>{o.displayName || o.email}</p>
                    <p className='truncate text-xs text-slate-400'>
                        {o.email}
                        {o.phone ? ` · ${o.phone}` : ''} · created {fmtDate(o.createdAt)}
                        {o.disabled ? ' · disabled' : ''}
                    </p>
                    <div className='flex gap-2'>
                        <select
                            aria-label={`Role for ${o.email}`}
                            value={roles[o.uid] ?? 'mems_admin'}
                            onChange={(e) => setRoles({ ...roles, [o.uid]: e.target.value })}
                            className='h-11 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-2 text-sm text-white'
                        >
                            {STAFF_ROLES.map((r) => (
                                <option key={r} value={r}>
                                    {ROLE_LABELS[r]}
                                </option>
                            ))}
                        </select>
                        <Button busy={busy === o.uid} disabled={!!busy} onClick={() => repair(o)}>
                            Attach profile
                        </Button>
                    </div>
                </div>
            ))}
            {actionError && <Alert tone='error'>{actionError}</Alert>}
        </Card>
    );
}
