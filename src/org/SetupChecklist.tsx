import { CircleCheck, Circle } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Card, useLoad } from '../admin/kit';

export default function SetupChecklist({ userCount, hasBranding }: { userCount: number; hasBranding: boolean }) {
    const { data } = useLoad(() => callBackend<{ children: Array<{ level: string }> }>('/api/org/structure/node', { id: 'root' }));
    const {data: brandData} = useLoad(() => callBackend<{branding:{displayName?:string;slogan?:string;preset?:string;brandColor?:string;logoUrl?:string}|null}>('/api/org/branding/get'));
    const savedBrand=brandData?.branding;
    const brandingDone=!!(savedBrand?.displayName&&savedBrand?.slogan&&savedBrand?.preset&&savedBrand?.brandColor&&savedBrand?.logoUrl);
    const steps = [
        { done: (data?.children.length ?? 0) > 0, label: 'Design your organization', hint: 'Add your legal entities, sites and departments', route: 'organization_admin/structure' },
        { done: brandData ? brandingDone : hasBranding, label: 'Set your branding', hint: 'Logo, colours and slogan', route: 'organization_admin/branding' },
        { done: true, label: 'Choose your settings', hint: 'Time zone, date format and financial year', route: 'organization_admin/settings' },
        { done: userCount > 1, label: 'Invite your team', hint: 'Add users and give them roles', route: 'organization_admin/users' },
    ];
    if (steps.every((s) => s.done)) return null;
    return (
        <Card className='space-y-1'>
            <p className='mb-2 font-semibold text-white'>Get started</p>
            {steps.map((s) => (
                <button key={s.label} onClick={() => navigate(s.route)} className='flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left'>
                    {s.done ? <CircleCheck className='h-5 w-5 shrink-0 text-emerald-400' /> : <Circle className='h-5 w-5 shrink-0 text-slate-500' />}
                    <span className='min-w-0'>
                        <span className={`block text-sm ${s.done ? 'text-slate-400 line-through' : 'text-white'}`}>{s.label}</span>
                        <span className='block text-xs text-slate-500'>{s.hint}</span>
                    </span>
                </button>
            ))}
        </Card>
    );
}
