import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { PASSWORD_RULE, passwordProblem } from '../lib/password';
import { Alert, Field } from '../components/ui';
import { Button, Card } from './kit';
import { appConfirm } from '../components/dialogs';

export default function ResetPassword({ endpoint, uid }: { endpoint: string; uid: string }) {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const reset = async () => {
        setError('');
        setInfo('');
        const problem = passwordProblem(password);
        if (problem) return setError(problem);
        if (!(await appConfirm('Reset this password? The user will be logged out everywhere and must set a new password at next login.'))) return;
        setBusy(true);
        try {
            await callBackend(endpoint, { uid, password });
            setPassword('');
            setInfo('Password reset. Share the temporary password securely; the user must change it at next login.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not reset the password.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className='mt-4 space-y-3'>
            <h2 className='flex items-center gap-2 font-semibold text-white'>
                <KeyRound className='h-4 w-4' />
                Reset password
            </h2>
            <Field id='reset-password' label='New temporary password' type='password' autoComplete='new-password' value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className='text-xs text-slate-500'>{PASSWORD_RULE}</p>
            {error && <Alert tone='error'>{error}</Alert>}
            {info && <Alert tone='info'>{info}</Alert>}
            <Button variant='secondary' busy={busy} onClick={reset} className='w-full'>
                Reset password
            </Button>
        </Card>
    );
}
