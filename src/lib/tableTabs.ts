/**
 * Restore the specific tab on which a personal table view was saved. The
 * one-shot instruction is scoped to the current organization route and consumed
 * before a tabbed page mounts. Unknown/removed tabs fall back safely.
 */
export function restoredTableTab<T extends string>(allowed: readonly T[], fallback: T): T {
    try {
        const route = window.location.hash.replace(/^#\/?/, '');
        const key = 'mems.table.tab.' + route;
        const requested = sessionStorage.getItem(key) || '';
        if (!requested) return fallback;
        sessionStorage.removeItem(key);
        return allowed.includes(requested as T) ? requested as T : fallback;
    } catch { return fallback; }
}
