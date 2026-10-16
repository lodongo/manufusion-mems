import { useState } from 'react';
import { UserRound } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { prepareFile } from '../apply/files';
import { Alert } from './ui';

export default function ProfilePhoto({ photoUrl, onUpdated }: { photoUrl: string; onUpdated: (url: string) => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const upload = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        setError('');
        try {
            const prepared = await prepareFile(file, true);
            const res = await callBackend<{ photoUrl: string }>('/api/profile/photo', { data: prepared.data });
            onUpdated(res.photoUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className='mb-4 flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4'>
            <label className='relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-slate-600 bg-slate-950'>
                {photoUrl ? <img src={photoUrl} alt='Your photo' className='h-full w-full object-cover' /> : <UserRound className='h-8 w-8 text-slate-500' />}
                {busy && <span className='absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white'>Saving...</span>}
                <input type='file' accept='image/jpeg,image/png' className='hidden' disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <div className='min-w-0 text-sm'>
                <p className='font-medium text-white'>Your photo</p>
                <p className='text-xs text-slate-500'>Tap the photo to change it.</p>
                {error && <div className='mt-2'><Alert tone='error'>{error}</Alert></div>}
            </div>
        </section>
    );
}
