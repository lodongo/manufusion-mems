import { HttpError, getDoc, isObj, nowIso, str, writeDoc } from './core';
import { orgRoute } from './guards';
import { PERMS, audited, holdsAnywhere, holdsDirect } from './scopeGuard';

// ---------------------------------------------------------------------------
// Organization risk matrix (SAF): factors, formula, bands and tolerability cut-off.
//   organizations/{org}/saf/risk_matrix   { configuration, history[] }
// Reading needs a SAF right anywhere (assessors need the matrix to rate risks). The matrix applies to the
// whole organization, so changing it needs SAF.configure (or SAF.admin) from the person's own direct
// security role; job roles, which are bound to places, do not count. Every change is versioned and audited.
// ---------------------------------------------------------------------------

const path = (id: string) => `organizations/${id}/saf/risk_matrix`;
const defaultFactors = [
    { code: 'P', label: 'Probability', max: 5, enabled: true },
    { code: 'S', label: 'Severity', max: 5, enabled: true },
    { code: 'E', label: 'Exposure', max: 5, enabled: true },
    { code: 'A', label: 'People affected', max: 2, enabled: true },
];
const defaultBands = [
    { label: 'Low', min: 1, max: 20, color: '#16a34a', action: 'Routine controls' },
    { label: 'Moderate', min: 21, max: 50, color: '#eab308', action: 'Managed improvement' },
    { label: 'High', min: 51, max: 100, color: '#f97316', action: 'Priority corrective action' },
    { label: 'Critical', min: 101, max: 250, color: '#dc2626', action: 'Stop work and escalate' },
];
const defaults = () => ({ version: 1, formula: 'multiply', factors: defaultFactors, bands: defaultBands, severityOverride: 5, tolerableMax: 50, updatedAt: '', updatedBy: '' });

export const safRiskRoutes = {
    'POST /api/org/saf/risk-matrix/read': [
        orgRoute('org.saf.risk_matrix.read', null, async (ctx) => {
            if (!holdsAnywhere(ctx, PERMS.matrixView)) throw new HttpError(403, 'You do not have permission to view the risk matrix.');
            const d = await getDoc(path(ctx.orgId));
            return {
                configuration: d?.data?.configuration || defaults(),
                history: Array.isArray(d?.data?.history) ? d.data.history : [],
                canEdit: holdsDirect(ctx, PERMS.matrixConfigure),
            };
        }),
    ],

    'POST /api/org/saf/risk-matrix/save': [
        orgRoute('org.saf.risk_matrix.save', null, async (ctx) => {
            if (!holdsDirect(ctx, PERMS.matrixConfigure)) throw new HttpError(403, 'Changing the risk matrix needs SAF configuration rights in your own security role.');
            const x = ctx.body.configuration;
            if (!isObj(x)) throw new HttpError(400, 'Invalid configuration');
            const formula = str(x.formula);
            if (!['multiply', 'add'].includes(formula)) throw new HttpError(400, 'Invalid formula');

            const factors = x.factors;
            if (!Array.isArray(factors) || factors.length !== 4 || !['P', 'S', 'E', 'A'].every((c) => factors.some((f) => isObj(f) && str(f.code) === c))) throw new HttpError(400, 'Four factors are required');
            const normalized = factors.map((f) => {
                if (!isObj(f) || !Number.isInteger(f.max) || (f.max as number) < 1 || (f.max as number) > 10 || typeof f.enabled !== 'boolean') throw new HttpError(400, 'Invalid factor scale');
                return { code: str(f.code), label: str(f.label).slice(0, 60), max: f.max as number, enabled: f.enabled };
            });
            const enabled = normalized.filter((f) => f.enabled);
            if (!enabled.length) throw new HttpError(400, 'Enable at least one factor');
            const maximum = enabled.reduce((n, f) => (formula === 'multiply' ? n * f.max : n + f.max), formula === 'multiply' ? 1 : 0);
            const minimum = formula === 'multiply' ? 1 : enabled.length;

            const bands = x.bands;
            if (!Array.isArray(bands) || bands.length < 2 || bands.length > 10) throw new HttpError(400, 'Define 2–10 risk bands');
            const sorted = bands
                .map((b) => {
                    if (!isObj(b) || !Number.isInteger(b.min) || !Number.isInteger(b.max) || (b.min as number) > (b.max as number) || !/^#[0-9a-fA-F]{6}$/.test(str(b.color))) throw new HttpError(400, 'Invalid risk band');
                    return { label: str(b.label).slice(0, 50), min: b.min as number, max: b.max as number, color: str(b.color), action: str(b.action).slice(0, 240) };
                })
                .sort((a, b) => a.min - b.min);
            if (sorted[0].min !== minimum || sorted[sorted.length - 1].max !== maximum || sorted.some((b, i) => i > 0 && b.min !== sorted[i - 1].max + 1)) {
                throw new HttpError(400, `Risk bands must cover ${minimum}–${maximum} without gaps or overlaps`);
            }

            const override = Number(x.severityOverride);
            const severityMax = normalized.find((f) => f.code === 'S')?.max ?? 0;
            if (!Number.isInteger(override) || override < 0 || override > severityMax) throw new HttpError(400, 'Invalid severity override');
            const tolerableMax = Number(x.tolerableMax ?? sorted[1]?.max);
            if (!Number.isInteger(tolerableMax) || tolerableMax < minimum || tolerableMax > maximum) throw new HttpError(400, 'Invalid tolerability cutoff');

            const old = await getDoc(path(ctx.orgId));
            const previous = isObj(old?.data?.configuration) ? (old?.data?.configuration as Record<string, unknown>) : null;
            const history = Array.isArray(old?.data?.history) ? old.data.history : [];
            const configuration = {
                version: Number(previous?.version || 0) + 1,
                formula,
                factors: normalized,
                bands: sorted,
                severityOverride: override,
                tolerableMax,
                updatedAt: nowIso(),
                updatedBy: ctx.uid,
            };
            await writeDoc(path(ctx.orgId), { configuration, history: previous ? [...history.slice(-48), previous] : history });
            await audited(ctx, 'saf.risk_matrix.save', `Risk matrix v${configuration.version}`, {
                fromVersion: previous ? Number(previous.version) || 0 : null,
                formula,
                factors: normalized.map((f) => `${f.code}${f.enabled ? '' : '(off)'}:1–${f.max}`).join(' '),
                bands: sorted.map((b) => `${b.label} ${b.min}–${b.max}`).join('; '),
                tolerableMax,
                severityOverride: override,
            });
            return { configuration };
        }),
    ],
};
