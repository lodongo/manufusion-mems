import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

// Bottom sheet on phones, centred dialog on larger screens. The body scrolls; the header and footer stay in place.
export default function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = previous;
        };
    }, [onClose]);
    return (
        <div className='fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4' role='presentation'>
            <button type='button' aria-label='Close' tabIndex={-1} className='absolute inset-0 bg-black/60' onClick={onClose} />
            <div role='dialog' aria-modal='true' aria-label={title} className='relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line bg-panel sm:max-w-lg sm:rounded-2xl'>
                <div className='flex items-center gap-2 border-b border-line p-4'>
                    <h2 className='min-w-0 flex-1 truncate text-base font-semibold text-ink'>{title}</h2>
                    <button type='button' aria-label='Close' onClick={onClose} className='-m-2 flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-page'>
                        <X className='h-5 w-5' />
                    </button>
                </div>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4'>{children}</div>
                {footer && <div className='flex gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>{footer}</div>}
            </div>
        </div>
    );
}

