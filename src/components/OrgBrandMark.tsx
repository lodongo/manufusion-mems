import { Building2 } from 'lucide-react';
import type { OrgBranding } from '../types';

/** The organization's own logo, brand name and slogan. */
export default function OrgBrandMark({ branding, fallbackName, compact }: { branding?: OrgBranding | null; fallbackName: string; compact?: boolean }) {
    const name = branding?.displayName || fallbackName;
    return (
        <div className='flex min-w-0 items-center gap-3'>
            <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-900 ${compact ? 'h-10 w-10' : 'h-12 w-12'}`}>
                {branding?.logoUrl ? <img src={branding.logoUrl} alt={`${name} logo`} className='h-full w-full object-contain' /> : <Building2 className='h-5 w-5 text-emerald-400' />}
            </div>
            <div className='min-w-0'>
                <p className={`truncate font-semibold text-white ${compact ? 'text-base' : 'text-lg'}`}>{name}</p>
                {branding?.slogan && <p className='truncate text-xs text-slate-400'>{branding.slogan}</p>}
            </div>
        </div>
    );
}
