import { useEffect } from 'react';
import { callBackend } from '../lib/backend';
import type { Session } from '../types';

type HealthLock = { locked: true; kind: 'break' | 'weekly'; until: string; message: string };

/**
 * Counts foreground MEMS use with recent user activity, not background tabs.
 * The server remains the authority for elapsed usage and lockout expiry.
 */
export default function HealthTracker({ session }: { session: Session }) {
    useEffect(() => {
        let active = true;
        let pending = false;
        let lastTick = Date.now();
        let lastInteraction = Date.now();
        let lastCheck = 0;
        const activity = () => { lastInteraction = Date.now(); };

        const pulse = async () => {
            if (!active || pending) return;
            const now = Date.now();
            const visible = document.visibilityState === 'visible' && document.hasFocus();
            const recentlyActive = now - lastInteraction < 120000;
            const countable = visible && recentlyActive;
            const seconds = countable ? Math.max(0, Math.min(40, Math.floor((now - lastTick) / 1000))) : 0;
            lastTick = now;
            // Hidden tabs only need occasional checks; they never accumulate active time.
            if (!countable && now - lastCheck < 60000) return;
            lastCheck = now;
            pending = true;
            try {
                const result = await callBackend<{ lock?: HealthLock | null; todaySeconds: number }>('/api/profile/health/pulse', { seconds });
                if (active && typeof result.todaySeconds === 'number') {
                    window.dispatchEvent(new CustomEvent('mems-health-progress', { detail: { uid: session.user.uid, todaySeconds: result.todaySeconds } }));
                }
                if (active && result.lock && Date.parse(result.lock.until) > Date.now()) {
                    window.dispatchEvent(new CustomEvent('mems-health-lock', { detail: { ...result.lock, uid: session.user.uid } }));
                }
            } catch {
                // Protected business APIs separately enforce the same server-side lockout.
            } finally {
                pending = false;
            }
        };

        const resume = () => {
            lastTick = Date.now();
            if (document.visibilityState === 'visible') void pulse();
        };
        document.addEventListener('pointerdown', activity, { passive: true });
        document.addEventListener('keydown', activity);
        document.addEventListener('scroll', activity, { passive: true, capture: true });
        document.addEventListener('visibilitychange', resume);
        window.addEventListener('focus', resume);
        const interval = window.setInterval(() => { void pulse(); }, 30000);
        return () => {
            active = false;
            window.clearInterval(interval);
            document.removeEventListener('pointerdown', activity);
            document.removeEventListener('keydown', activity);
            document.removeEventListener('scroll', activity, true);
            document.removeEventListener('visibilitychange', resume);
            window.removeEventListener('focus', resume);
        };
    }, [session.user.uid]);

    return null;
}
