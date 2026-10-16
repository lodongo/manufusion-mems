import { THEME_PRESETS, type Theme } from './site';

export const BRAND_PRESETS: Array<{ key: string; label: string; dark: boolean; theme: Theme }> = [
    { key: 'crimson', label: 'Crimson', dark: false, theme: {"page":"#fff5f6","panel":"#ffffff","border":"#efd5d9","text":"#361d26","textSoft":"#63414a","muted":"#896670","brand":"#c51d48","brandSoft":"#c51d48","onBrand":"#ffffff"} },
    { key: 'azure', label: 'Azure', dark: false, theme: {"page":"#f0f8ff","panel":"#ffffff","border":"#d3e6f5","text":"#17314a","textSoft":"#385b78","muted":"#6b859b","brand":"#147cc1","brandSoft":"#147cc1","onBrand":"#ffffff"} },
    { key: 'violet', label: 'Violet', dark: false, theme: {"page":"#f8f5ff","panel":"#ffffff","border":"#e4dcf5","text":"#302343","textSoft":"#584573","muted":"#827098","brand":"#7545c2","brandSoft":"#7545c2","onBrand":"#ffffff"} },
    { key: 'olive', label: 'Olive', dark: false, theme: {"page":"#f7f8ed","panel":"#ffffff","border":"#e0e5c9","text":"#303c24","textSoft":"#586347","muted":"#79846a","brand":"#677f28","brandSoft":"#677f28","onBrand":"#ffffff"} },
    { key: 'slate', label: 'Slate', dark: false, theme: {"page":"#f4f6f8","panel":"#ffffff","border":"#dce2e8","text":"#1d2c3c","textSoft":"#43586a","muted":"#6c8090","brand":"#375a7f","brandSoft":"#375a7f","onBrand":"#ffffff"} },
    { key: 'sunrise', label: 'Sunrise', dark: false, theme: {"page":"#fff9f1","panel":"#ffffff","border":"#f4e2ca","text":"#493021","textSoft":"#72533c","muted":"#97785c","brand":"#d97706","brandSoft":"#d97706","onBrand":"#ffffff"} },
    { key: 'aqua', label: 'Aqua', dark: false, theme: {"page":"#effbfa","panel":"#ffffff","border":"#c9e9e6","text":"#183d3b","textSoft":"#376561","muted":"#628984","brand":"#008e83","brandSoft":"#008e83","onBrand":"#ffffff"} },
    { key: 'plum', label: 'Plum', dark: true, theme: {"page":"#211628","panel":"#30203b","border":"#493252","text":"#faf2ff","textSoft":"#e5d3ed","muted":"#bda4c8","brand":"#cf8deb","brandSoft":"#cf8deb","onBrand":"#101827"} },
    { key: 'steel', label: 'Steel', dark: true, theme: {"page":"#141d29","panel":"#202c3a","border":"#354556","text":"#f4f8ff","textSoft":"#c9d5e2","muted":"#94a9bd","brand":"#6bb4ee","brandSoft":"#6bb4ee","onBrand":"#101827"} },
    { key: 'evergreen', label: 'Evergreen', dark: true, theme: {"page":"#10251c","panel":"#193529","border":"#2b4c3a","text":"#f2fff7","textSoft":"#c4e5d1","muted":"#92bba2","brand":"#52c98a","brandSoft":"#52c98a","onBrand":"#101827"} },
    { key: 'coral', label: 'Coral breeze', dark: false, theme: { page: '#fff7f4', panel: '#ffffff', border: '#f4dcd6', text: '#34221f', textSoft: '#66433b', muted: '#89645d', brand: '#e65b52', brandSoft: '#e65b52', onBrand: '#ffffff' } },
    { key: 'royal', label: 'Royal blue', dark: false, theme: { page: '#f2f6ff', panel: '#ffffff', border: '#d8e2f6', text: '#172b55', textSoft: '#37517b', muted: '#657a9e', brand: '#295bd6', brandSoft: '#295bd6', onBrand: '#ffffff' } },
    { key: 'forest', label: 'Forest canopy', dark: false, theme: { page: '#f1f8f3', panel: '#ffffff', border: '#d4e7d8', text: '#163626', textSoft: '#315743', muted: '#60806a', brand: '#1c8551', brandSoft: '#1c8551', onBrand: '#ffffff' } },
    { key: 'rose', label: 'Rose quartz', dark: false, theme: { page: '#fff5fa', panel: '#ffffff', border: '#f1d8e6', text: '#40243a', textSoft: '#69445f', muted: '#906d83', brand: '#b83280', brandSoft: '#b83280', onBrand: '#ffffff' } },
    { key: 'sand', label: 'Desert sand', dark: false, theme: { page: '#faf6ed', panel: '#ffffff', border: '#e8ddc7', text: '#40362b', textSoft: '#665647', muted: '#897966', brand: '#a66a27', brandSoft: '#a66a27', onBrand: '#ffffff' } },
    { key: 'graphite', label: 'Graphite', dark: true, theme: { page: '#111827', panel: '#1f2937', border: '#374151', text: '#f9fafb', textSoft: '#d1d5db', muted: '#9ca3af', brand: '#60a5fa', brandSoft: '#60a5fa', onBrand: '#111827' } },
    { key: 'midnight', label: 'Midnight indigo', dark: true, theme: { page: '#11112b', panel: '#1c1d42', border: '#33345f', text: '#f8f7ff', textSoft: '#d5d5f0', muted: '#a6a8d3', brand: '#a78bfa', brandSoft: '#a78bfa', onBrand: '#111827' } },
    { key: 'teal', label: 'Teal studio', dark: false, theme: { page: '#effafa', panel: '#ffffff', border: '#cbe7e5', text: '#123e40', textSoft: '#326669', muted: '#5b8586', brand: '#008b8b', brandSoft: '#008b8b', onBrand: '#ffffff' } },
    { key: 'burgundy', label: 'Burgundy executive', dark: true, theme: { page: '#25131d', panel: '#361c2a', border: '#573246', text: '#fff5f8', textSoft: '#eed6e1', muted: '#c49caa', brand: '#f472a6', brandSoft: '#f472a6', onBrand: '#111827' } },
    { key: 'copper', label: 'Copper dusk', dark: true, theme: { page: '#241b18', panel: '#342721', border: '#5b4438', text: '#fff7ef', textSoft: '#f1d8c5', muted: '#c7a996', brand: '#e79b58', brandSoft: '#e79b58', onBrand: '#111827' } },
    { key: 'emerald', label: 'Emerald night', dark: true, theme: THEME_PRESETS[0].theme },
    { key: 'daylight', label: 'Daylight', dark: false, theme: THEME_PRESETS[1].theme },
    { key: 'ocean', label: 'Ocean', dark: true, theme: THEME_PRESETS[2].theme },
    { key: 'savanna', label: 'Savanna', dark: true, theme: THEME_PRESETS[3].theme },
];

export const BRAND_SWATCHES = ['#10b981', '#16a34a', '#0891b2', '#2563eb', '#4f46e5', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#f59e0b', '#a16207', '#334155'];

const HEX = /^#[0-9a-f]{6}$/i;

function channels(hex: string): number[] {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function luminance(hex: string): number {
    const [r, g, b] = channels(hex).map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(hex: string, target: string, amount: number): string {
    const a = channels(hex);
    const b = channels(target);
    return `#${a.map((c, i) => Math.round(c + (b[i] - c) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/** Same rules as the server: preset base colours plus the chosen brand colour. */
export function buildBrandTheme(preset: string, brandColor: string): Theme {
    const base = BRAND_PRESETS.find((p) => p.key === preset) ?? BRAND_PRESETS[0];
    const brand = HEX.test(brandColor) ? brandColor.toLowerCase() : base.theme.brand;
    return { ...base.theme, brand, brandSoft: mix(brand, base.dark ? '#ffffff' : '#000000', 0.35), onBrand: luminance(brand) > 0.45 ? '#0f172a' : '#ffffff' };
}
