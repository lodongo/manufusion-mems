import { useState, type ChangeEvent } from 'react';
import { Camera, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { compressPhoto } from './mntShared';

export default function ActionPhotoInput({
    value, onChange, label='Attach action photo',
}:{
    value:string;onChange:(path:string)=>void;label?:string;
}){
    const [url,setUrl]=useState('');
    const [busy,setBusy]=useState(false);
    const [error,setError]=useState('');
    const upload=async(event:ChangeEvent<HTMLInputElement>)=>{
        const photo=event.target.files?.[0];event.target.value='';
        if(!photo)return;
        setBusy(true);setError('');
        try{
            const data=await compressPhoto(photo);
            const saved=await callBackend<{path:string;url:string}>('/api/org/actions/photo',{data});
            setUrl(saved.url);onChange(saved.path);
        }catch(e){setError(e instanceof Error?e.message:'Could not attach photo.');}
        finally{setBusy(false);}
    };
    return <div className='space-y-2' aria-label='Action photo attachment'>
        <label className='flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-page px-3 text-xs font-semibold text-brand'>
            <Camera className='h-5 w-5'/>{busy?'Uploading…':value?'Replace action photo':label}
            <input type='file' accept='image/*' capture='environment' disabled={busy} className='sr-only'
                onChange={e=>{void upload(e)}}/>
        </label>
        {value&&<div className='flex items-center gap-3'>
            {url?<img src={url} alt='Action attachment' className='h-20 w-20 rounded-lg object-cover'/>:
                <span className='text-xs font-semibold text-brand'>Photo attached</span>}
            <button type='button' className='min-h-11 text-xs text-red-500'
                onClick={()=>{onChange('');setUrl('')}} aria-label='Remove action photo'><X className='mr-1 inline h-4 w-4'/>Remove</button>
        </div>}
        {error&&<p role='alert' className='text-xs text-red-500'>{error}</p>}
    </div>;
}
