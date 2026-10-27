import { createContext, useContext } from 'react';
import { publicGet } from './backend';

export interface Theme {
    page: string;
    panel: string;
    border: string;
    text: string;
    textSoft: string;
    muted: string;
    brand: string;
    brandSoft: string;
    onBrand: string;
}

export interface SiteFeature {
    icon: string;
    title: string;
    text: string;
}

export interface SiteConfig {
    brandName: string;
    tagline: string;
    logoUrl?: string;
    platformName: string;
    heroTitle: string;
    heroDescription: string;
    registerButtonLabel: string;
    loginButtonLabel: string;
    loginSubtitle: string;
    forgotPasswordText: string;
    memsWebsiteLinkLabel: string;
    companyWebsiteLabel: string;
    companyWebsiteUrl: string;
    supportEmail: string;
    supportPhone: string;
    footerText: string;
    organizationFooterMessage: string;
    features: SiteFeature[];
    theme: Theme;
}

export interface SiteLocked {
    staffEmailDomain: string;
    firebaseProjectId: string;
    setupCompletedAt: string;
}

export const THEME_LABELS: Record<keyof Theme, string> = {
    page: 'Page background',
    panel: 'Cards and panels',
    border: 'Borders',
    text: 'Headings',
    textSoft: 'Body text',
    muted: 'Secondary text',
    brand: 'Brand colour',
    brandSoft: 'Brand highlight',
    onBrand: 'Text on brand colour',
};

export const THEME_PRESETS: Array<{ name: string; theme: Theme }> = [
    {
        name: 'Emerald night',
        theme: { page: '#020617', panel: '#0f172a', border: '#1e293b', text: '#ffffff', textSoft: '#cbd5e1', muted: '#94a3b8', brand: '#10b981', brandSoft: '#6ee7b7', onBrand: '#020617' },
    },
    {
        name: 'Daylight',
        theme: { page: '#f8fafc', panel: '#ffffff', border: '#e2e8f0', text: '#0f172a', textSoft: '#334155', muted: '#64748b', brand: '#059669', brandSoft: '#047857', onBrand: '#ffffff' },
    },
    {
        name: 'Ocean',
        theme: { page: '#0b1220', panel: '#111c33', border: '#1f2c47', text: '#ffffff', textSoft: '#cbd5e1', muted: '#8ea0bf', brand: '#3b82f6', brandSoft: '#93c5fd', onBrand: '#ffffff' },
    },
    {
        name: 'Savanna',
        theme: { page: '#1c1410', panel: '#2a1f18', border: '#3d2d22', text: '#fff7ed', textSoft: '#fed7aa', muted: '#c2a58a', brand: '#f59e0b', brandSoft: '#fcd34d', onBrand: '#1c1410' },
    },
];

export const SITE_DEFAULTS: SiteConfig = {
    brandName: 'MEMS',
    tagline: 'Assets for a Stronger Africa',
    platformName: 'Manufusion Enterprise Management Platform',
    heroTitle: 'Manufacturing management, built for Africa.',
    heroDescription:
        'The Manufusion Enterprise Management Platform helps manufacturers manage materials, production and costs from a phone, in their own country and currency.',
    registerButtonLabel: 'Register your organization',
    loginButtonLabel: 'Login',
    loginSubtitle: '',
    forgotPasswordText: 'If you forgot your password, contact your organization admin directly.',
    memsWebsiteLinkLabel: 'Visit our website',
    companyWebsiteLabel: 'Visit our website',
    companyWebsiteUrl: 'https://manufusion.com',
    supportEmail: 'support@manufusion.com',
    supportPhone: '',
    footerText: 'Manufusion. All rights reserved.',
    organizationFooterMessage: '',
    features: [
        { icon: 'boxes', title: 'Inventory', text: 'Raw materials and finished goods across every store and location.' },
        { icon: 'layers', title: 'Bills of materials', text: 'Know exactly what goes into every product and what it costs.' },
        { icon: 'clipboard', title: 'Production', text: 'Plan, run and track production orders, yields and waste.' },
        { icon: 'wallet', title: 'Multi-currency', text: 'Built for African currencies, with live rates to the US dollar.' },
        { icon: 'smartphone', title: 'Mobile first', text: 'Designed for the phone your team already carries.' },
        { icon: 'globe', title: 'Made for Africa', text: 'All 54 African countries, local currencies and dialing codes.' },
    ],
    theme: THEME_PRESETS[0].theme,
};

export const EMPTY_LOCKED: SiteLocked = { staffEmailDomain: 'manufusion.com', firebaseProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '', setupCompletedAt: '' };

function rgb(hex: string): string {
    const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000';
    return `${parseInt(value.slice(1, 3), 16)} ${parseInt(value.slice(3, 5), 16)} ${parseInt(value.slice(5, 7), 16)}`;
}

export function applyTheme(theme: Theme) {
    const style = document.documentElement.style;
    style.setProperty('--c-page', rgb(theme.page));
    style.setProperty('--c-panel', rgb(theme.panel));
    style.setProperty('--c-line', rgb(theme.border));
    style.setProperty('--c-ink', rgb(theme.text));
    style.setProperty('--c-soft', rgb(theme.textSoft));
    style.setProperty('--c-muted', rgb(theme.muted));
    style.setProperty('--c-brand', rgb(theme.brand));
    style.setProperty('--c-brandsoft', rgb(theme.brandSoft));
    style.setProperty('--c-onbrand', rgb(theme.onBrand));
    // Error/danger text must stay readable on both light and dark tenant themes (WCAG AA on the page colour).
    const [r, g, b] = rgb(theme.page).split(' ').map(Number);
    const lightPage = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
    style.setProperty('--c-danger', lightPage ? '185 28 28' : '248 113 113');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.page);
}

export function fetchSite() {
    return publicGet<{ config: SiteConfig; locked: SiteLocked }>('/api/site');
}

export interface SiteState {
    config: SiteConfig;
    locked: SiteLocked;
    setConfig: (config: SiteConfig) => void;
}

export const SiteContext = createContext<SiteState>({ config: SITE_DEFAULTS, locked: EMPTY_LOCKED, setConfig: () => undefined });

export const useSite = () => useContext(SiteContext);
