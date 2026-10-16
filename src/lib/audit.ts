import { api } from '@appdeploy/client';
import { firebaseAuth } from '../firebase';

// Client-side audit tracker: navigation, clicks, form submits and errors.
// Field values are never captured.

interface ClientEvent {
    category: string;
    action: string;
    route: string;
    targetType: string;
    targetLabel: string;
    details: string;
    clientAt: string;
}

const queue: ClientEvent[] = [];
let installed = false;

function sessionId(): string {
    try {
        let id = sessionStorage.getItem('mems_sid');
        if (!id) {
            id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            sessionStorage.setItem('mems_sid', id);
        }
        return id;
    } catch {
        return 'unavailable';
    }
}

export function clientInfo() {
    const nav = navigator as Navigator & {
        connection?: { effectiveType?: string };
        deviceMemory?: number;
        userAgentData?: { platform?: string };
    };
    let standalone = false;
    try {
        standalone = window.matchMedia('(display-mode: standalone)').matches;
    } catch {
        standalone = false;
    }
    return {
        sessionId: sessionId(),
        userAgent: nav.userAgent,
        platform: nav.userAgentData?.platform || nav.platform || '',
        language: nav.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        connection: nav.connection?.effectiveType ?? '',
        deviceMemory: nav.deviceMemory ?? 0,
        standalone,
    };
}

const currentRoute = () => window.location.hash.replace(/^#\/?/, '') || 'login';

export function track(category: string, action: string, targetType = '', targetLabel = '', details = '') {
    queue.push({ category, action, route: currentRoute(), targetType, targetLabel: targetLabel.slice(0, 120), details: details.slice(0, 200), clientAt: new Date().toISOString() });
    if (queue.length >= 40) void flush();
}

export async function flush() {
    if (!queue.length) return;
    const events = queue.splice(0, 50);
    try {
        const user = firebaseAuth.currentUser;
        const idToken = user ? await user.getIdToken() : undefined;
        await api.post('/api/audit/events', { events, client: clientInfo(), sessionId: sessionId(), idToken });
    } catch {
        // Auditing must never break the app.
    }
}

function labelOf(el: Element): string {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const textContent = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (textContent) return textContent.slice(0, 80);
    return el.getAttribute('id') || el.tagName.toLowerCase();
}

export function installAuditTracking() {
    if (installed) return;
    installed = true;
    track('navigation', 'app.open', 'route', currentRoute());
    window.addEventListener('hashchange', () => {
        track('navigation', 'navigate', 'route', currentRoute());
        void flush();
    });
    document.addEventListener(
        'click',
        (event) => {
            const target = event.target as Element | null;
            const el = target?.closest('button, a, [role="tab"], [role="switch"], summary, input[type="checkbox"]');
            if (!el) return;
            track('interaction', 'click', el.tagName.toLowerCase(), labelOf(el));
        },
        true
    );
    document.addEventListener(
        'change',
        (event) => {
            const el = event.target as HTMLElement | null;
            if (el instanceof HTMLSelectElement) track('interaction', 'select', 'select', el.id || el.getAttribute('aria-label') || 'select', el.value.slice(0, 60));
        },
        true
    );
    document.addEventListener(
        'submit',
        (event) => {
            const form = event.target as HTMLFormElement;
            track('form', 'submit', 'form', form.getAttribute('aria-label') || form.id || 'form');
        },
        true
    );
    window.addEventListener('error', (event) => track('error', 'js.error', 'script', String(event.message)));
    window.addEventListener('unhandledrejection', (event) => track('error', 'js.unhandled_rejection', 'promise', String(event.reason)));
    window.setInterval(() => void flush(), 15000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flush();
    });
}

export async function reportLoginAttempt(email: string, outcome: 'success' | 'failure' | 'blocked', code = '') {
    try {
        const current = firebaseAuth.currentUser;
        const idToken = outcome === 'success' && current ? await current.getIdToken() : undefined;
        await api.post('/api/audit/login-attempt', { email, outcome, code, route: currentRoute(), client: clientInfo(), idToken });
    } catch {
        // ignore
    }
}
