import { publicGet } from './backend';

export interface Country {
    name: string;
    iso2: string;
    iso3: string;
    dialCode: string;
    capital: string;
    region: string;
    currencyCode: string;
    timezone: string;
    languages: string[];
    flag: string;
}

export interface Currency {
    code: string;
    name: string;
    symbol: string;
    decimals: number;
    usedInAfrica: boolean;
    unitsPerUsd: number | null;
    usdPerUnit: number | null;
}

export interface MetaList {
    key: string;
    title: string;
    appliesTo: string;
    items: Array<{ code: string; label: string; categoryCode?: string; isicSection?: string; active?: boolean }>;
}

export interface ReferenceData {
    loaded: boolean;
    countries: Country[];
    currencies: Currency[];
    metadataLists: MetaList[];
    ratesUpdatedAt: string;
    ratesSource: string;
}

export function fetchReference(): Promise<ReferenceData> {
    return publicGet<ReferenceData>('/api/reference');
}

export function formatRate(value: number | null): string {
    if (value === null || value === undefined) return 'n/a';
    return value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 2 });
}
