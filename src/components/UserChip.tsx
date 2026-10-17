import { Clock3, UserRound, Zap } from 'lucide-react';
import { navigate } from '../lib/route';
import { useEffect, useState } from 'react';
import { callBackend } from '../lib/backend';
import type { Session } from '../types';

/** Current user's photo and name, shown on every organization page. */
export default function UserChip({ session, roleLabel, compact, onClick }: { session: Session; roleLabel?: string; compact?: boolean; onClick?: () => void }) {
    const name = `${session.user.firstName} ${session.user.lastName}`.trim() || session.user.email;
    const [seconds, setSeconds] = useState<number | null>(null);
    const [restLimit, setRestLimit] = useState<number | null>(null);
    const [quickCount,setQuickCount]=useState<{total:number;unreadChats:number;newMonitored:number;overdue:number}|null>(null);
    useEffect(()=>{
        if(!session.organization){setQuickCount(null);return;}
        let alive=true;
        const update=()=>{if(document.visibilityState==='hidden')return;
            void callBackend<{total:number;unreadChats:number;newMonitored:number;overdue:number}>('/api/org/quick/status')
                .then(r=>{if(alive)setQuickCount(r)}).catch(()=>undefined);
        };
        update();
        const timer=window.setInterval(update,60000);
        document.addEventListener('visibilitychange',update);
        return()=>{alive=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',update)};
    },[session.user.uid,Boolean(session.organization)]);
    useEffect(() => {
        let mounted = true;
        const refresh = () => {
            void callBackend<{ todaySeconds: number; workSeconds:number; settings:{tracking:boolean;breaks:boolean;workMinutes:number} }>('/api/profile/health/status')
                .then((data) => { if (mounted) { setSeconds(data.settings.tracking && data.settings.breaks ? Math.max(0, data.settings.workMinutes * 60 - data.workSeconds) : null); setRestLimit(data.settings.tracking && data.settings.breaks ? data.settings.workMinutes : null); } })
                .catch(() => undefined);
        };
        const progress = (event: Event) => {
            const item = (event as CustomEvent<{ uid: string; todaySeconds: number; workSeconds?:number; settings?:{tracking:boolean;breaks:boolean;workMinutes:number} }>).detail;
            if (mounted && item?.uid === session.user.uid && item.settings) { setSeconds(item.settings.tracking && item.settings.breaks ? Math.max(0,item.settings.workMinutes*60-(item.workSeconds??0)) : null);setRestLimit(item.settings.tracking && item.settings.breaks ? item.settings.workMinutes : null); }
        };
        refresh();
        window.addEventListener('mems-health-progress', progress);
        return () => { mounted = false; window.removeEventListener('mems-health-progress', progress); };
    }, [session.user.uid]);
    const minutes = Math.ceil((seconds ?? 0) / 60);
    const duration = minutes >= 60 ? Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm' : minutes + 'm';
    return (
        <div className='flex min-w-0 items-center gap-1'>
            {session.organization && (
                <button type='button' aria-label={'Open Quick links'+(quickCount?.total?' · '+quickCount.total+' items need attention':'')} title={quickCount?.total?quickCount.total+' items need attention · '+quickCount.unreadChats+' unread chats · '+quickCount.newMonitored+' monitored actions · '+quickCount.overdue+' overdue':'Quick links'}
                    onClick={() => {
                        try {
                            const path = window.location.hash.replace(/^#\/?/, '');
                            if ((path.startsWith('organization_home') || path.startsWith('organization_admin'))
                                && !path.includes('/quick')) {
                                sessionStorage.setItem('mems.quick.return.' + session.user.uid, path);
                            }
                        } catch { /* Quick links remains accessible. */ }
                        navigate('organization_home/quick');
                    }}
                    className={'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-transparent text-brand transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand '+(quickCount?.total?'animate-pulse':'')}>
                    <Zap className={'h-7 w-7 fill-current '+(quickCount?.total?'drop-shadow-[0_0_12px_rgba(244,114,182,0.95)]':'')} strokeWidth={1.7} />
                    {!!quickCount?.total&&<span aria-label={quickCount.total+' quick items'} className='absolute -right-1 -top-0.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-extrabold leading-none text-onbrand shadow-[0_0_11px_rgba(244,114,182,0.9)]'>{quickCount.total>99?'99+':quickCount.total}</span>}
                </button>
            )}
            <button type='button' onClick={onClick} aria-label='My details' className='flex min-w-0 items-center gap-2 text-left'>
            <span className='flex shrink-0 flex-col items-center gap-0.5'>
                <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800 ${compact ? 'h-9 w-9' : 'h-10 w-10'}`}>
                    {session.photoUrl ? <img src={session.photoUrl} alt={name} className='h-full w-full object-cover' /> : <UserRound className='h-5 w-5 text-slate-400' />}
                </span>
                <span className='flex items-center gap-0.5 whitespace-nowrap text-[9px] leading-none text-muted' title={restLimit===null?'Rest countdown is not enabled':'Time until next rest: ' + duration}>
                    <Clock3 className='h-2.5 w-2.5' />{seconds === null ? 'Rest off' : duration}
                </span>
            </span>
            {!compact && (
                <span className='min-w-0'>
                    <span className='block truncate text-sm font-medium text-white'>{name}</span>
                    <span className='block truncate text-xs text-slate-500'>{roleLabel ?? session.roleName ?? ''}</span>
                </span>
            )}
            </button>
        </div>
    );
}
