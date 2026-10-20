import { useEffect, useState } from 'react';
import { ArrowLeft, Mail, Save, ShieldCheck, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import MailRichEditor from './MailRichEditor';

export type MailPreferences={
    signatureEnabled:boolean;
    signatureHtml:string;
    autoReplyEnabled:boolean;
    autoReplySubject:string;
    autoReplyHtml:string;
};
export const defaultMailPrefs:MailPreferences={
    signatureEnabled:false,signatureHtml:'',autoReplyEnabled:false,autoReplySubject:'Automatic reply',autoReplyHtml:'',
};
const label='flex items-center gap-3 rounded-xl border border-line bg-page p-3 text-sm';
export default function MailSettings({value,onSaved,onClose}:{value:MailPreferences;onSaved:(v:MailPreferences)=>void;onClose:()=>void}){
    const [prefs,setPrefs]=useState(value);
    const [saving,setSaving]=useState(false);
    const [error,setError]=useState('');
    const [notice,setNotice]=useState('');
    const patch=(fields:Partial<MailPreferences>)=>setPrefs(p=>({...p,...fields}));
    const save=async()=>{
        setSaving(true);setError('');setNotice('');
        try{
            const r=await callBackend<{preferences:MailPreferences}>('/api/org/mail/preferences/save',prefs);
            setPrefs(r.preferences);onSaved(r.preferences);setNotice('Email settings saved.');
        }catch(e){setError(e instanceof Error?e.message:'Unable to save settings');}
        finally{setSaving(false);}
    };
    return <div role='dialog' aria-modal='true' aria-label='Email settings' className='fixed inset-0 z-[95] flex items-center justify-center bg-black/55 sm:p-4'>
        <div className='flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden bg-panel shadow-2xl sm:h-[min(90dvh,850px)] sm:rounded-2xl sm:border sm:border-line'>
            <header className='flex min-h-14 shrink-0 items-center gap-3 border-b border-line bg-page px-4'>
                <button type='button' aria-label='Close email settings' onClick={onClose}><ArrowLeft className='h-5 w-5 text-brand'/></button>
                <div className='min-w-0 flex-1'><h2 className='text-base font-bold text-ink'>Email settings</h2><p className='text-[11px] text-muted'>Personal mailbox preferences</p></div>
                <button type='button' onClick={()=>{void save()}} disabled={saving} className='flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-semibold text-onbrand disabled:opacity-50'><Save className='h-4 w-4'/>{saving?'Saving…':'Save'}</button>
                <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center'><X className='h-5 w-5'/></button>
            </header>
            <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6'>
                <section className='space-y-3'>
                    <h3 className='text-sm font-bold text-ink'>Email signature</h3>
                    <label className={label}>
                        <input type='checkbox' checked={prefs.signatureEnabled} onChange={e=>patch({signatureEnabled:e.target.checked})} className='h-5 w-5 accent-[rgb(var(--c-brand))]'/>
                        <span className='min-w-0 flex-1'><span className='block font-semibold text-ink'>Insert my signature automatically</span><span className='block text-xs text-muted'>For new messages, replies and forwards</span></span>
                    </label>
                    <div className='w-full min-h-[220px]'><MailRichEditor key='signature-editor' html={prefs.signatureHtml} onChange={signatureHtml=>patch({signatureHtml})}/></div>
                </section>
                <section className='space-y-3'>
                    <h3 className='text-sm font-bold text-ink'>Automatic replies (out of office)</h3>
                    <label className={label}>
                        <input type='checkbox' checked={prefs.autoReplyEnabled} onChange={e=>patch({autoReplyEnabled:e.target.checked})} className='h-5 w-5 accent-[rgb(var(--c-brand))]'/>
                        <span className='min-w-0 flex-1'><span className='block font-semibold text-ink'>Send an automatic reply</span><span className='block text-xs text-muted'>Only to internal colleagues, no more than once per colleague in 24 hours</span></span>
                    </label>
                    <label className='block text-xs font-semibold text-muted'>Automatic reply subject
                        <input value={prefs.autoReplySubject} onChange={e=>patch({autoReplySubject:e.target.value})} maxLength={180}
                            className='mt-1 h-11 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink outline-none focus:border-brand'/>
                    </label>
                    <div className='w-full min-h-[220px]'><MailRichEditor key='auto-reply-editor' html={prefs.autoReplyHtml} onChange={autoReplyHtml=>patch({autoReplyHtml})}/></div>
                </section>
                <section className='rounded-xl border border-line bg-page p-4'>
                    <h3 className='flex items-center gap-2 text-sm font-bold text-ink'><ShieldCheck className='h-4 w-4 text-brand'/> External email — future integration</h3>
                    <p className='mt-2 text-xs leading-relaxed text-muted'>External sending and receiving are disabled. A later release can connect a verified SMTP/Graph provider with domain verification, mail security policies, quotas, routing and audit controls. This mailbox will continue to work internally.</p>
                    <span className='mt-3 inline-flex rounded-full bg-brand/10 px-2 py-1 text-[11px] font-semibold text-brand'>Internal delivery only</span>
                </section>
                {error&&<p role='alert' className='rounded-lg bg-red-500/10 p-3 text-xs text-red-500'>{error}</p>}
                {notice&&<p role='status' className='rounded-lg bg-brand/10 p-3 text-xs text-brand'>{notice}</p>}
            </div>
            <footer className='shrink-0 border-t border-line bg-page p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
                <button type='button' disabled={saving} onClick={()=>{void save()}} className='flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-40'><Save className='h-4 w-4'/>Save email settings</button>
            </footer>
        </div>
    </div>;
}
