import { useEffect, useState } from 'react';
import { FlaskConical, X } from 'lucide-react';

interface Status { active: boolean; appliesToYou: boolean; expiresAt: string; reason: string }

/**
 * Tells everyone in a tenant that the development-only platform testing override is on, so nobody mistakes
 * single-person approvals for real ones. Sits just above the platform footer; it never covers the action bar.
 */
export default function TestModeBanner({ status }: { status?: Status }) {
    const [open, setOpen] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    // The server decides; the banner only hides itself once the override has expired.
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);
    if (!status?.active || !(Date.parse(status.expiresAt) > now)) return null;
    const until = status.expiresAt ? new Date(status.expiresAt).toLocaleString() : '';
    return (
        <div className='fixed bottom-11 left-3 z-40 max-w-[calc(100vw-1.5rem)]' role='status' aria-live='polite'>
            {open ? (
                <div className='w-80 max-w-full rounded-2xl border border-amber-400/60 bg-amber-100 p-3 text-xs text-amber-950 shadow-lg'>
                    <div className='flex items-start justify-between gap-2'>
                        <p className='font-semibold'>Test mode is on until {until}</p>
                        <button type='button' aria-label='Close' onClick={() => setOpen(false)} className='-m-1 flex h-8 w-8 items-center justify-center rounded-lg'><X className='h-4 w-4' /></button>
                    </div>
                    <p className='mt-1'>
                        {status.appliesToYou
                            ? 'As organization super admin you can complete workflow steps alone: maker-checker and job-role checks are relaxed for you. Every relaxed check is recorded in the audit trail.'
                            : 'Your organization super admin can complete workflow steps alone for development testing. Your own access is unchanged.'}
                    </p>
                    {status.reason && <p className='mt-1 opacity-80'>Reason: {status.reason}</p>}
                </div>
            ) : (
                <button type='button' onClick={() => setOpen(true)} className='flex min-h-9 items-center gap-1.5 rounded-full border border-amber-400/60 bg-amber-100 px-3 text-xs font-semibold text-amber-950 shadow-lg'>
                    <FlaskConical className='h-4 w-4' /> Test mode
                </button>
            )}
        </div>
    );
}
