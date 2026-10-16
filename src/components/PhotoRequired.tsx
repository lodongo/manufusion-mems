import { useState } from 'react';
import { Camera, UserRound } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { prepareFile } from '../apply/files';
import { Alert } from './ui';

/** Every organization user must have a photo before using MEMS. */
export default function PhotoRequired({ name, onDone, onSignOut }: { name: string; onDone: () => void; onSignOut: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState('');

    const upload = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        setError('');
        try {
            setPreview(URL.createObjectURL(file));
            const prepared = await prepareFile(file, true);
            await callBackend('/api/profile/photo', { data: prepared.data });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed.');
            setBusy(false);
        }
    };

    return (
        <div className='flex h-[100dvh] flex-col items-center justify-center bg-slate-950 px-6'>
            <div className='w-full max-w-sm space-y-5 text-center'>
                <h1 className='text-2xl font-semibold text-white'>Add your photo</h1>
                <p className='text-sm text-slate-400'>Hi {name}. Your organization requires a clear photo of your face so colleagues can recognise who did what.</p>
                <label className='mx-auto flex h-36 w-36 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-slate-600 bg-slate-900'>
                    {preview ? <img src={preview} alt='Your photo' className='h-full w-full object-cover' /> : <UserRound className='h-14 w-14 text-slate-500' />}
                    <input type='file' accept='image/jpeg,image/png' capture='user' className='hidden' disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                <label className='flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-500 font-semibold text-onbrand'>
                    <Camera className='h-5 w-5' />
                    {busy ? 'Uploading...' : 'Take or choose a photo'}
                    <input type='file' accept='image/jpeg,image/png' className='hidden' disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {error && <Alert tone='error'>{error}</Alert>}
                <button onClick={onSignOut} className='text-sm text-slate-400 underline'>
                    Log out
                </button>
            </div>
        </div>
    );
}
