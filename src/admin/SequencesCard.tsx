import { useState } from 'react';
import { Hash } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field } from '../components/ui';
import { Button, Card, Spinner, useLoad } from './kit';
import { appConfirm } from '../components/dialogs';

interface SequenceData {
    orgSeq: number;
    nextOrgCode: string;
}

export default function SequencesCard({ isSuper }: { isSuper: boolean }) {
    const { data, setData, error, loading } = useLoad(() => callBackend<SequenceData>('/api/admin/sequences'));
    const [next, setNext] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    const save = async () => {
        if (!(await appConfirm(`Set the next organization code number to ${next}? Codes are never reused.`))) return;
        setBusy(true);
        setActionError('');
        try {
            setData(await callBackend<SequenceData>('/api/admin/sequences/set', { next: Number(next) }));
            setNext('');
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not update.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card>
            <div className='mb-3 flex items-center gap-2'>
                <Hash className='h-5 w-5 text-emerald-400' />
                <h2 className='text-lg font-semibold text-white'>Sequences</h2>
            </div>
            {loading && !data ? (
                <Spinner />
            ) : error ? (
                <Alert tone='error'>{error}</Alert>
            ) : data ? (
                <div className='space-y-3'>
                    <div className='flex items-center justify-between text-sm'>
                        <span className='text-slate-400'>Organization codes issued</span>
                        <span className='font-medium text-white'>{data.orgSeq}</span>
                    </div>
                    <div className='flex items-center justify-between text-sm'>
                        <span className='text-slate-400'>Next organization code</span>
                        <span className='font-mono font-medium text-emerald-300'>{data.nextOrgCode}</span>
                    </div>
                    {isSuper && (
                        <div className='flex items-end gap-2'>
                            <div className='flex-1'>
                                <Field id='seq-next' label='Set next number (super admin)' type='number' inputMode='numeric' min={data.orgSeq + 1} value={next} onChange={(e) => setNext(e.target.value)} />
                            </div>
                            <Button busy={busy} disabled={!next} onClick={save}>
                                Set
                            </Button>
                        </div>
                    )}
                    {actionError && <Alert tone='error'>{actionError}</Alert>}
                </div>
            ) : null}
        </Card>
    );
}
