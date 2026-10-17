import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { callBackend } from '../lib/backend';

type RestStatus = { workSeconds:number; settings:{tracking:boolean;breaks:boolean;workMinutes:number;breakMinutes:number}; lock?:{kind:string;until:string}|null };
const remaining = (data:RestStatus) => Math.max(0, data.settings.workMinutes*60-data.workSeconds);
const duration = (seconds:number) => {const m=Math.ceil(seconds/60);return m>=60?Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m':m+' min';};

/** Rest progress uses the same authoritative health service as the mandatory break lock. */
export default function RestCountdown(){
    const [data,setData]=useState<RestStatus|null>(null);
    const [error,setError]=useState(false);
    useEffect(()=>{
        let active=true;
        const refresh=()=>{void callBackend<RestStatus>('/api/profile/health/status').then(r=>{if(active){setData(r);setError(false);}}).catch(()=>{if(active)setError(true);});};
        refresh();
        const timer=window.setInterval(refresh,30000);
        const onProgress=(e:Event)=>{const d=(e as CustomEvent<RestStatus>).detail;if(d?.settings&&active)setData(d);};
        window.addEventListener('mems-health-progress',onProgress);
        return()=>{active=false;window.clearInterval(timer);window.removeEventListener('mems-health-progress',onProgress);};
    },[]);
    if(error&&!data)return <div className='mb-4 rounded-xl border border-line bg-panel p-3 text-sm text-soft'>Rest information is temporarily unavailable.</div>;
    if(!data)return <div className='mb-4 rounded-xl border border-line bg-panel p-3 text-sm text-soft'>Loading next rest…</div>;
    const enabled=data.settings.tracking&&data.settings.breaks;
    const progress=enabled?Math.min(100,Math.max(0,Math.round((data.workSeconds/(data.settings.workMinutes*60))*100))):0;
    return <section aria-label='Progress to next rest' className='mb-4 space-y-3 rounded-2xl border border-line bg-panel p-4'>
        <div className='flex items-center justify-between gap-3'>
            <div><h2 className='flex items-center gap-2 font-semibold text-ink'><Clock3 className='h-5 w-5 text-brand'/>Next rest</h2>
                <p className='mt-1 text-sm text-soft'>{enabled?'Active focus period: '+data.settings.workMinutes+' min · Rest: '+data.settings.breakMinutes+' min':'Rest schedule is not enabled in Keep Alive'}</p>
            </div>
            <strong className='shrink-0 text-xl text-brand'>{enabled?duration(remaining(data)):'Off'}</strong>
        </div>
        {enabled&&<><div role='progressbar' aria-label='Focus progress to next rest' aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className='h-2 overflow-hidden rounded-full bg-page'><div className='h-full rounded-full bg-brand transition-all' style={{width:progress+'%'}}/></div>
            <p className='text-xs text-soft'>{progress}% of focus interval completed · Based on active MEMS time</p></>}
    </section>;
}
