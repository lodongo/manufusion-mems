import type { LucideIcon } from 'lucide-react';

export interface NavItem {
    key: string;
    label: string;
    Icon: LucideIcon;
}

export interface NavGroup {
    title: string;
    items: NavItem[];
}

/** Grouped side menu used by the MEMS admin and organization admin shells. */
export default function SideNav({ groups, active, onSelect }: { groups: NavGroup[]; active: string; onSelect: (key: string) => void }) {
    return (
        <div className='flex-1 overflow-y-auto overscroll-contain px-2 pb-2'>
            {groups
                .filter((g) => g.items.length > 0)
                .map((g) => (
                    <div key={g.title} className='mb-2'>
                        <p className='px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-slate-500'>{g.title}</p>
                        <ul className='space-y-0.5'>
                            {g.items.map(({ key, label, Icon }) => (
                                <li key={key || 'home'}>
                                    <button
                                        onClick={() => onSelect(key)}
                                        className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm ${
                                            active === key ? 'bg-emerald-500/10 font-medium text-emerald-300' : 'text-slate-300 hover:bg-slate-800/60 active:bg-slate-800'
                                        }`}
                                    >
                                        <Icon className='h-[18px] w-[18px] shrink-0' />
                                        <span className='truncate'>{label}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
        </div>
    );
}
