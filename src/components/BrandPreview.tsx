import { Building2 } from 'lucide-react';
import type { Theme } from '../lib/site';

/** A small phone-style preview of how MEMS will look for the organization. */
export default function BrandPreview({ name, slogan, logoUrl, theme }: { name: string; slogan: string; logoUrl: string; theme: Theme }) {
    return (
        <div className='mx-auto w-full max-w-[17rem] overflow-hidden rounded-[1.75rem] border-4 border-slate-800 shadow-xl' style={{ background: theme.page }}>
            <div className='flex items-center gap-2 px-4 py-3' style={{ borderBottom: `1px solid ${theme.border}` }}>
                <div className='flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg' style={{ background: theme.panel }}>
                    {logoUrl ? <img src={logoUrl} alt='Logo preview' className='h-full w-full object-contain' /> : <Building2 className='h-5 w-5' style={{ color: theme.muted }} />}
                </div>
                <div className='min-w-0'>
                    <p className='truncate text-sm font-semibold' style={{ color: theme.text }}>
                        {name || 'Your brand'}
                    </p>
                    <p className='truncate text-[10px]' style={{ color: theme.muted }}>
                        {slogan || 'Your slogan'}
                    </p>
                </div>
            </div>
            <div className='space-y-2 p-4'>
                <p className='text-xs' style={{ color: theme.textSoft }}>
                    Welcome back
                </p>
                <div className='grid grid-cols-2 gap-2'>
                    {['Inventory', 'Production'].map((label) => (
                        <div key={label} className='rounded-xl p-2' style={{ background: theme.panel, border: `1px solid ${theme.border}` }}>
                            <div className='h-3 w-3 rounded' style={{ background: theme.brand }} />
                            <p className='mt-2 text-[10px] font-medium' style={{ color: theme.text }}>
                                {label}
                            </p>
                        </div>
                    ))}
                </div>
                <div className='rounded-xl py-2 text-center text-xs font-semibold' style={{ background: theme.brand, color: theme.onBrand }}>
                    Primary action
                </div>
            </div>
        </div>
    );
}
