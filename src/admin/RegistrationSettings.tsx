import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { callBackend, publicGet } from '../lib/backend';
import { Alert } from '../components/ui';
import { Card, Toggle, useLoad } from './kit';
import { appConfirm } from '../components/dialogs';

export default function RegistrationSettings({ isSuper }: { isSuper: boolean }) {
    const { data, setData, error } = useLoad(() => publicGet<{ requireEmailVerification: boolean }>('/api/registration/settings'));
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const change = async (value: boolean) => {
        if (!value && !(await appConfirm('Allow registration without email verification? Use this only for testing with dummy emails, and turn it back on before going live.'))) return;
        setBusy(true);
        setActionError('');
        try {
            setData(await callBackend<{ requireEmailVerification: boolean }>('/api/admin/settings/registration', { requireEmailVerification: value }));
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not change the setting.');
        } finally {
            setBusy(false);
        }
    };

    const required = data?.requireEmailVerification !== false;

    return (
        <Card tone={required ? undefined : 'danger'} className='mb-4 space-y-3'>
            <div className='flex items-center justify-between gap-3'>
                <div>
                    <p className='text-sm font-medium text-white'>Require email verification</p>
                    <p className='text-xs text-slate-500'>{isSuper ? 'Applicants must confirm their email before continuing.' : 'Only a super admin can change this.'}</p>
                </div>
                <Toggle label='Require email verification' checked={required} disabled={!isSuper || busy || !data} onChange={change} />
            </div>
            {!required && (
                <p className='flex items-start gap-2 text-xs text-amber-400'>
                    <ShieldAlert className='mt-0.5 h-4 w-4 shrink-0' />
                    Testing mode: applicants can register with dummy emails. Turn this back on before going live.
                </p>
            )}
            {(error || actionError) && <Alert tone='error'>{error || actionError}</Alert>}
        </Card>
    );
}
