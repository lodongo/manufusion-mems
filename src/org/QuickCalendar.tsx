import { useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, Loader2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import MailCalendar from './MailCalendar';
import type { WorkGroup, MailColleague } from './MailWorkGroups';
import { leaveQuick } from './quickNavigation';

export default function QuickCalendar({uid}:{uid:string}) {
    const [people,setPeople]=useState<MailColleague[]>([]);
    const [groups,setGroups]=useState<WorkGroup[]>([]);
    const [loading,setLoading]=useState(true);
    const [error,setError]=useState('');
    useEffect(()=>{
        let active=true;
        Promise.all([
            callBackend<{people:MailColleague[]}>('/api/org/mail/people'),
            callBackend<{groups:WorkGroup[]}>('/api/org/work-groups/list'),
        ]).then(([p,g])=>{
            if(!active)return;
            setPeople(p.people);
            setGroups(g.groups);
        }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load calendar colleagues.');})
          .finally(()=>{if(active)setLoading(false);});
        return ()=>{active=false};
    },[uid]);
    if(loading)return <div className='flex min-h-[250px] items-center justify-center gap-2 text-muted'><Loader2 className='h-5 w-5 animate-spin'/> Loading your calendar…</div>;
    return <div className='flex min-h-[calc(100dvh-15.5rem)] flex-col overflow-hidden rounded-xl border border-line bg-panel'>
        {error&&<div role='alert' className='flex items-center gap-2 bg-amber-500/10 px-3 py-2 text-xs text-amber-700'><AlertCircle className='h-4 w-4'/>{error}</div>}
        <MailCalendar uid={uid} people={people} groups={groups}
            onClose={()=>leaveQuick('organization_home/quick')}/>
    </div>;
}
