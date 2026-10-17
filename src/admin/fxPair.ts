export interface FxRateObservation {
    rates?: Record<string, number>;
    usdKes?: number | null;
    kesUsd?: number | null;
}

/** FX quotes are persisted as currency units per one USD.
 * Derive the requested direction only from the same observation (never combine dates).
 */
export function observedUnitsPerUsd(row: FxRateObservation, currency: string): number | null {
    if (currency === 'USD') return 1;
    const raw = row.rates?.[currency] ?? (currency === 'KES' ? row.usdKes ?? null : null);
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
    return raw;
}
export function observedPairRate(row: FxRateObservation, base: string, quote: string): number | null {
    const a = observedUnitsPerUsd(row, base);
    const b = observedUnitsPerUsd(row, quote);
    return a !== null && b !== null ? b / a : null;
}
export function formatFxRate(rate: number | null): string {
    if (rate === null || !Number.isFinite(rate)) return 'Unavailable';
    return new Intl.NumberFormat(undefined, {
        maximumSignificantDigits: 9,
        minimumSignificantDigits: 1,
    }).format(rate);
}
