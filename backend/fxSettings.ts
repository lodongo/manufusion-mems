import { str, type Doc } from './core';

export const FX_PROVIDERS = [
    { id: 'open_er_api', label: 'ExchangeRate-API open data', apiKeyRequired: false, cadence: 'Published daily', notes: 'Free daily reference rates; hourly polling does not create hourly market quotations.' },
    { id: 'currencyapi', label: 'CurrencyAPI', apiKeyRequired: true, cadence: 'Depends on subscription', notes: 'Configure MEMS_FX_PROVIDER_API_KEY using Cloud Run Secret Manager; coverage depends on provider plan.' },
    { id: 'exchange_rate_api', label: 'ExchangeRate-API paid', apiKeyRequired: true, cadence: 'Depends on subscription', notes: 'Configure MEMS_FX_PROVIDER_API_KEY using Cloud Run Secret Manager.' },
] as const;

export type Provider = typeof FX_PROVIDERS[number]['id'];
export type Frequency = 'hourly' | 'three_hourly' | 'six_hourly' | 'daily' | 'weekly';
export interface FxSettings {
    provider: Provider;
    enabled: boolean;
    frequency: Frequency;
    timeUtc: string;
    weekday: number;
}
const DEFAULT_CONFIG: FxSettings = { provider: 'open_er_api', enabled: false, frequency: 'daily', timeUtc: '06:00', weekday: 1 };
export function settingsOf(d: Doc | null): FxSettings {
    const x = d?.data || {};
    return {
        provider: FX_PROVIDERS.some((p) => p.id === x.provider) ? x.provider as Provider : DEFAULT_CONFIG.provider,
        enabled: x.enabled === true,
        frequency: ['hourly','three_hourly','six_hourly','daily','weekly'].includes(str(x.frequency)) ? x.frequency as Frequency : DEFAULT_CONFIG.frequency,
        timeUtc: /^([01]\d|2[0-3]):[0-5]\d$/.test(str(x.timeUtc)) ? str(x.timeUtc) : DEFAULT_CONFIG.timeUtc,
        weekday: Number.isInteger(x.weekday) && Number(x.weekday) >= 0 && Number(x.weekday) <= 6 ? Number(x.weekday) : DEFAULT_CONFIG.weekday,
    };
}
