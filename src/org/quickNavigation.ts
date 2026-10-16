import { useEffect, useRef } from 'react';
import { navigate } from '../lib/route';

interface QuickLeaveDetail {
    handled: boolean;
    proceed: () => void;
}

/** Give the active tool one opportunity to save its draft before navigating. */
export function leaveQuick(destination: string) {
    const detail: QuickLeaveDetail = { handled: false, proceed: () => navigate(destination) };
    window.dispatchEvent(new CustomEvent('mems.quick.leave', { detail }));
    if (!detail.handled) detail.proceed();
}

/** A tool can safely veto exit when a server save fails. */
export function useQuickLeave(save: () => Promise<boolean>) {
    const current = useRef(save);
    current.current = save;
    useEffect(() => {
        const onExit = (ev: Event) => {
            const detail = (ev as CustomEvent<QuickLeaveDetail>).detail;
            if (!detail || detail.handled) return;
            detail.handled = true;
            void current.current().then((saved) => {
                if (saved) detail.proceed();
            }).catch(() => undefined);
        };
        window.addEventListener('mems.quick.leave', onExit);
        return () => window.removeEventListener('mems.quick.leave', onExit);
    }, []);
}
