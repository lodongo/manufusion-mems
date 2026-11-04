/**
 * Job grade rules shared by the server and the screen, so what the form tells a person is exactly what the
 * server will enforce. Pure functions only (no imports).
 */
export type GradeLike = {
    code: string;
    rank: number;
    title: string;
    enabled: boolean;
    minSalary: number | null;
    taxCodes: string[];
    deductionCodes: string[];
    /** Benefit package (optional so older callers keep working). */
    payModelCode?: string;
    benefitCodes?: string[];
    leave?: Array<{ code: string; daysPerYear: number; carryForwardDays?: number }>;
};

/** What the legal entity's Benefits catalogue offers, so the rules only ask for what can actually be chosen. */
export type CatalogueNeeds = { payModel: boolean; leave: boolean };

const money = (n: number) => n.toLocaleString('en');

/** Problems that stop a draft from being saved at all. */
export function draftIssues(grades: GradeLike[]): string[] {
    const out: string[] = [];
    if (!grades.length) out.push('Add at least one job grade.');
    const ranks = new Map<number, number>();
    const titles = new Map<string, number>();
    for (const g of grades) {
        const label = g.title.trim() || (g.code ? g.code : 'New grade');
        if (!Number.isInteger(g.rank) || g.rank < 1 || g.rank > 9999) out.push(`${label}: the grade number must be a whole number from 1 to 9999.`);
        if (g.title.trim().length < 2) out.push(`${label}: enter a title (2 to 150 characters).`);
        const s = g.minSalary;
        if (s !== null) {
            if (!Number.isFinite(s) || s < 0 || s > 1e9) out.push(`${label}: the minimum salary must be between 0 and ${money(1e9)}.`);
            else if (Math.abs(s * 100 - Math.round(s * 100)) > 1e-6) out.push(`${label}: the minimum salary can have at most 2 decimal places.`);
        }
        for (const l of g.leave || []) {
            if (!Number.isFinite(l.daysPerYear) || l.daysPerYear < 0 || l.daysPerYear > 366) out.push(`${label}: leave allowance ${l.code} must be between 0 and 366.`);
            if (l.carryForwardDays !== undefined && (!Number.isFinite(l.carryForwardDays) || l.carryForwardDays < 0 || l.carryForwardDays > 366)) out.push(`${label}: carry forward for ${l.code} must be between 0 and 366.`);
        }
        ranks.set(g.rank, (ranks.get(g.rank) || 0) + 1);
        const key = g.title.trim().toLowerCase();
        if (key) titles.set(key, (titles.get(key) || 0) + 1);
    }
    for (const [rank, n] of ranks) if (n > 1) out.push(`Grade number ${rank} is used ${n} times. Grade numbers must be unique.`);
    for (const [title, n] of titles) if (n > 1) out.push(`The grade title "${title}" is used ${n} times.`);
    return out;
}

/** What must be true before a draft may go for approval. */
export function activationProblems(grades: GradeLike[], currency: string, rolesUsing: Map<string, number>, needs: CatalogueNeeds = { payModel: false, leave: false }): string[] {
    const problems: string[] = [];
    const enabled = grades.filter((g) => g.enabled).sort((a, b) => a.rank - b.rank);
    if (!enabled.length) problems.push('Enable at least one job grade.');
    for (const g of enabled) {
        if (!((g.minSalary ?? 0) > 0)) problems.push(`Grade ${g.rank} · ${g.title}: enter the minimum monthly salary (${currency}).`);
        if (!g.taxCodes.length) problems.push(`Grade ${g.rank} · ${g.title}: select the taxes that apply. Configure them first in Benefits if none are listed.`);
        if (!g.deductionCodes.length) problems.push(`Grade ${g.rank} · ${g.title}: select the deductions that apply. Configure them first in Benefits if none are listed.`);
        if (needs.payModel && !g.payModelCode) problems.push(`Grade ${g.rank} · ${g.title}: select the pay model.`);
        if (needs.leave && !(g.leave || []).length) problems.push(`Grade ${g.rank} · ${g.title}: select the leave types that apply (open and save the grade to add the mandatory ones).`);
    }
    for (let i = 1; i < enabled.length; i++) {
        const a = enabled[i - 1].minSalary ?? 0;
        const b = enabled[i].minSalary ?? 0;
        if (a > 0 && b > 0 && b < a) problems.push(`Grade ${enabled[i].rank} · ${enabled[i].title} has a lower minimum salary than grade ${enabled[i - 1].rank}. Minimum salaries must not fall as the grade number rises.`);
    }
    for (const g of grades.filter((x) => !x.enabled)) {
        const n = rolesUsing.get(g.code) || 0;
        if (n > 0) problems.push(`Grade ${g.rank} · ${g.title} is disabled but ${n} job role${n === 1 ? ' uses' : 's use'} it. Move those roles to another grade first.`);
    }
    return problems;
}
