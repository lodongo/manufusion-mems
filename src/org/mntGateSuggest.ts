// Suggested job roles for unconfigured maintenance workflow gates, matched on job role titles. A suggestion only
// fills the form: an administrator reviews it, gives a reason and saves (ADM.workflows, versioned and audited).
export const GATE_KEYWORDS: Record<string, string[]> = {
    'MNT.WR.CONVERT': ['maintenance planner', 'planner', 'maintenance supervisor', 'supervisor'],
    'MNT.WO.PLAN': ['maintenance planner', 'planner', 'planning', 'scheduler'],
    'MNT.ASSESS.REVIEW': ['maintenance supervisor', 'maintenance engineer', 'supervisor', 'engineer'],
    'MNT.TASK.VALIDATE': ['reliability', 'maintenance engineer', 'engineer', 'maintenance supervisor'],
    'MNT.TASK.FEEDBACK': ['artisan', 'technician', 'fitter', 'electrician', 'mechanic'],
    'MNT.SPARES.RECONCILE': ['stores', 'storekeeper', 'store', 'warehouse'],
    'MNT.WINDOW.ENGINEERING': ['maintenance engineer', 'engineering manager', 'engineer', 'engineering'],
    'MNT.WINDOW.SAFETY': ['safety', 'sheq', 'hse'],
    'MNT.SAFETY.SIGNOFF': ['safety', 'sheq', 'hse'],
    'MNT.HANDOVER': ['production', 'operations', 'operator', 'shift'],
    'MNT.WO.TECHNICAL_CLOSE': ['technical manager', 'maintenance manager', 'engineering manager', 'manager'],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Best matching job role per unconfigured, role-required gate. Gates with no match stay unconfigured. */
export function suggestGateRoles(
    gates: Array<{ code: string; roleRequired: boolean }>,
    jobRoles: Array<{ id: string; label: string }>,
    current: Record<string, string>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const g of gates) {
        if (!g.roleRequired || current[g.code]) continue;
        const words = GATE_KEYWORDS[g.code] ?? [];
        let best: { id: string; score: number } | null = null;
        for (const r of jobRoles) {
            const label = r.label.toLowerCase();
            const i = words.findIndex((w) => new RegExp(`\\b${escape(w)}\\b`).test(label));
            if (i < 0) continue;
            const score = (words.length - i) * 10 + (/\bmaint/.test(label) ? 1 : 0);
            if (!best || score > best.score) best = { id: r.id, score };
        }
        if (best) out[g.code] = best.id;
    }
    return out;
}

/** The maintenance gate a server message refers to, when the fix is in Maintenance Workflows. */
export function gateFromMessage(message: string): { gate: string; kind: 'unconfigured' | 'not_held' } | null {
    const a = /Configure (MNT\.[A-Z_.]+) in Maintenance Workflows/.exec(message);
    if (a) return { gate: a[1], kind: 'unconfigured' };
    const b = /configured (MNT\.[A-Z_.]+) organizational job role is required/.exec(message);
    if (b) return { gate: b[1], kind: 'not_held' };
    return null;
}
