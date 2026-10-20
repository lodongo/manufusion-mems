import { useSite } from '../lib/site';

/** Compact platform ownership imprint; separate from tenant branding. */
export default function OrganizationFooter() {
    const { config } = useSite();
    const theme = config.theme;
    return (
        <footer
            aria-label='MEMS platform information'
            className='fixed inset-x-0 bottom-0 z-40 flex min-h-9 items-center justify-center gap-2 border-t px-3 py-1 text-center text-[11px] shadow-sm'
            style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))', backgroundColor: theme.panel, borderColor: theme.border, color: theme.textSoft }}
        >
            {config.logoUrl
                ? <img src={config.logoUrl} alt='MEMS platform logo' className='h-5 w-5 shrink-0 object-contain' />
                : <span aria-label='MEMS platform logo' className='flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold' style={{ backgroundColor: theme.brand, color: theme.onBrand }}>M</span>}
            <span className='min-w-0 truncate'>{config.organizationFooterMessage?.trim() || `Run by Manufusion Africa Limited © ${new Date().getFullYear()}`}</span>
        </footer>
    );
}
