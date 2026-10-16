import { storage } from '@appdeploy/sdk';
import { HttpError, isObj, listDocs, nowIso, randomId, rateLimit, str, text, updateFields, type Doc, type Fields, type Plain } from './core';
import { audit } from './audit';
import { orgRoute, staff } from './guards';

// Organization branding: logo, brand name, slogan and theme. Applied to every
// signed-in member of the organization so they only see their own brand.

export const THEME_PRESETS: Record<string, { label: string; dark: boolean; theme: Record<string, string> }> = {
    crimson: { label: 'Crimson', dark: false, theme: {"page":"#fff5f6","panel":"#ffffff","border":"#efd5d9","text":"#361d26","textSoft":"#63414a","muted":"#896670","brand":"#c51d48","brandSoft":"#c51d48","onBrand":"#ffffff"} },
    azure: { label: 'Azure', dark: false, theme: {"page":"#f0f8ff","panel":"#ffffff","border":"#d3e6f5","text":"#17314a","textSoft":"#385b78","muted":"#6b859b","brand":"#147cc1","brandSoft":"#147cc1","onBrand":"#ffffff"} },
    violet: { label: 'Violet', dark: false, theme: {"page":"#f8f5ff","panel":"#ffffff","border":"#e4dcf5","text":"#302343","textSoft":"#584573","muted":"#827098","brand":"#7545c2","brandSoft":"#7545c2","onBrand":"#ffffff"} },
    olive: { label: 'Olive', dark: false, theme: {"page":"#f7f8ed","panel":"#ffffff","border":"#e0e5c9","text":"#303c24","textSoft":"#586347","muted":"#79846a","brand":"#677f28","brandSoft":"#677f28","onBrand":"#ffffff"} },
    slate: { label: 'Slate', dark: false, theme: {"page":"#f4f6f8","panel":"#ffffff","border":"#dce2e8","text":"#1d2c3c","textSoft":"#43586a","muted":"#6c8090","brand":"#375a7f","brandSoft":"#375a7f","onBrand":"#ffffff"} },
    sunrise: { label: 'Sunrise', dark: false, theme: {"page":"#fff9f1","panel":"#ffffff","border":"#f4e2ca","text":"#493021","textSoft":"#72533c","muted":"#97785c","brand":"#d97706","brandSoft":"#d97706","onBrand":"#ffffff"} },
    aqua: { label: 'Aqua', dark: false, theme: {"page":"#effbfa","panel":"#ffffff","border":"#c9e9e6","text":"#183d3b","textSoft":"#376561","muted":"#628984","brand":"#008e83","brandSoft":"#008e83","onBrand":"#ffffff"} },
    plum: { label: 'Plum', dark: true, theme: {"page":"#211628","panel":"#30203b","border":"#493252","text":"#faf2ff","textSoft":"#e5d3ed","muted":"#bda4c8","brand":"#cf8deb","brandSoft":"#cf8deb","onBrand":"#101827"} },
    steel: { label: 'Steel', dark: true, theme: {"page":"#141d29","panel":"#202c3a","border":"#354556","text":"#f4f8ff","textSoft":"#c9d5e2","muted":"#94a9bd","brand":"#6bb4ee","brandSoft":"#6bb4ee","onBrand":"#101827"} },
    evergreen: { label: 'Evergreen', dark: true, theme: {"page":"#10251c","panel":"#193529","border":"#2b4c3a","text":"#f2fff7","textSoft":"#c4e5d1","muted":"#92bba2","brand":"#52c98a","brandSoft":"#52c98a","onBrand":"#101827"} },
    coral: { label: 'Coral breeze', dark: false, theme: { page: '#fff7f4', panel: '#ffffff', border: '#f4dcd6', text: '#34221f', textSoft: '#66433b', muted: '#89645d', brand: '#e65b52', brandSoft: '#e65b52', onBrand: '#ffffff' } },
    royal: { label: 'Royal blue', dark: false, theme: { page: '#f2f6ff', panel: '#ffffff', border: '#d8e2f6', text: '#172b55', textSoft: '#37517b', muted: '#657a9e', brand: '#295bd6', brandSoft: '#295bd6', onBrand: '#ffffff' } },
    forest: { label: 'Forest canopy', dark: false, theme: { page: '#f1f8f3', panel: '#ffffff', border: '#d4e7d8', text: '#163626', textSoft: '#315743', muted: '#60806a', brand: '#1c8551', brandSoft: '#1c8551', onBrand: '#ffffff' } },
    rose: { label: 'Rose quartz', dark: false, theme: { page: '#fff5fa', panel: '#ffffff', border: '#f1d8e6', text: '#40243a', textSoft: '#69445f', muted: '#906d83', brand: '#b83280', brandSoft: '#b83280', onBrand: '#ffffff' } },
    sand: { label: 'Desert sand', dark: false, theme: { page: '#faf6ed', panel: '#ffffff', border: '#e8ddc7', text: '#40362b', textSoft: '#665647', muted: '#897966', brand: '#a66a27', brandSoft: '#a66a27', onBrand: '#ffffff' } },
    graphite: { label: 'Graphite', dark: true, theme: { page: '#111827', panel: '#1f2937', border: '#374151', text: '#f9fafb', textSoft: '#d1d5db', muted: '#9ca3af', brand: '#60a5fa', brandSoft: '#60a5fa', onBrand: '#111827' } },
    midnight: { label: 'Midnight indigo', dark: true, theme: { page: '#11112b', panel: '#1c1d42', border: '#33345f', text: '#f8f7ff', textSoft: '#d5d5f0', muted: '#a6a8d3', brand: '#a78bfa', brandSoft: '#a78bfa', onBrand: '#111827' } },
    teal: { label: 'Teal studio', dark: false, theme: { page: '#effafa', panel: '#ffffff', border: '#cbe7e5', text: '#123e40', textSoft: '#326669', muted: '#5b8586', brand: '#008b8b', brandSoft: '#008b8b', onBrand: '#ffffff' } },
    burgundy: { label: 'Burgundy executive', dark: true, theme: { page: '#25131d', panel: '#361c2a', border: '#573246', text: '#fff5f8', textSoft: '#eed6e1', muted: '#c49caa', brand: '#f472a6', brandSoft: '#f472a6', onBrand: '#111827' } },
    copper: { label: 'Copper dusk', dark: true, theme: { page: '#241b18', panel: '#342721', border: '#5b4438', text: '#fff7ef', textSoft: '#f1d8c5', muted: '#c7a996', brand: '#e79b58', brandSoft: '#e79b58', onBrand: '#111827' } },
    emerald: {
        label: 'Emerald night',
        dark: true,
        theme: { page: '#020617', panel: '#0f172a', border: '#1e293b', text: '#ffffff', textSoft: '#cbd5e1', muted: '#94a3b8', brand: '#10b981', brandSoft: '#6ee7b7', onBrand: '#020617' },
    },
    daylight: {
        label: 'Daylight',
        dark: false,
        theme: { page: '#f8fafc', panel: '#ffffff', border: '#e2e8f0', text: '#0f172a', textSoft: '#334155', muted: '#64748b', brand: '#059669', brandSoft: '#047857', onBrand: '#ffffff' },
    },
    ocean: {
        label: 'Ocean',
        dark: true,
        theme: { page: '#0b1220', panel: '#111c33', border: '#1f2c47', text: '#ffffff', textSoft: '#cbd5e1', muted: '#8ea0bf', brand: '#3b82f6', brandSoft: '#93c5fd', onBrand: '#ffffff' },
    },
    savanna: {
        label: 'Savanna',
        dark: true,
        theme: { page: '#1c1410', panel: '#2a1f18', border: '#3d2d22', text: '#fff7ed', textSoft: '#fed7aa', muted: '#c2a58a', brand: '#f59e0b', brandSoft: '#fcd34d', onBrand: '#1c1410' },
    },
};

const HEX = /^#[0-9a-f]{6}$/;

function channels(hex: string): [number, number, number] {
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

export function buildTheme(preset: string, brandColor: string): Record<string, string> {
    const base = THEME_PRESETS[preset] ?? THEME_PRESETS.emerald;
    const brand = HEX.test(brandColor) ? brandColor : base.theme.brand;
    return {
        ...base.theme,
        brand,
        brandSoft: mix(brand, base.dark ? '#ffffff' : '#000000', 0.35),
        onBrand: luminance(brand) > 0.45 ? '#0f172a' : '#ffffff',
    };
}

export function readBranding(b: Record<string, unknown>): Fields {
    const displayName = text(b, 'displayName', 2, 40, 'Enter the brand name your team will see (2 to 40 characters).');
    const slogan = text(b, 'slogan', 2, 120, 'Enter your slogan (2 to 120 characters).');
    const preset = str(b.preset);
    if (!THEME_PRESETS[preset]) throw new HttpError(400, 'Choose a theme.');
    const brandColor = str(b.brandColor).toLowerCase();
    if (!HEX.test(brandColor)) throw new HttpError(400, 'Choose a brand colour.');
    return { displayName, slogan, preset, brandColor };
}

export function detectImage(buf: Buffer): { contentType: string; ext: string } | null {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg' };
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', ext: 'png' };
    return null;
}

/**
 * The stored path is never authorization to read an image. Only this organization's
 * own uploaded branding or its verified registration applicant's logo may be signed.
 * Existing approved application logos remain usable without moving stored files.
 */
export function ownedLogoPath(org: Doc, path: string): string {
    if (!path) return '';
    const filename = (prefix: string) => path.startsWith(prefix)
        && /^logo_[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(path.slice(prefix.length));
    if (filename('organizations/' + org.id + '/branding/')) return path;
    const applicantId = str(org.data.applicationId);
    if (applicantId && applicantId === str(org.data.createdBy)
        && filename('applications/' + applicantId + '/')) return path;
    return '';
}

/** Branding as sent to an organization user, with an ownership-checked private logo link. */
export async function brandingOut(org: Doc, replacement?: Fields) {
    const branding = replacement ?? org.data.branding;
    if (!isObj(branding)) return null;
    const claimedPath = str(branding.logoPath);
    const permitted = ownedLogoPath(org, claimedPath);
    let logoUrl = '';
    if (permitted) {
        try {
            const [signed] = await storage.url([permitted]);
            logoUrl = signed?.url ?? '';
        } catch {
            logoUrl = '';
        }
    }
    const preset = str(branding.preset) || 'emerald';
    const brandColor = str(branding.brandColor);
    return {
        displayName: str(branding.displayName),
        slogan: str(branding.slogan),
        preset,
        brandColor,
        theme: buildTheme(preset, brandColor),
        logoUrl,
        logoNeedsReview: !!claimedPath && !permitted,
    };
}

export const brandingRoutes = {
    // Read-only platform diagnostic to identify old records with foreign logo paths.
    'POST /api/admin/branding/ownership-review': [
        staff('admin.branding.ownership_review', 'read', async () => {
            const orgs = await listDocs('organizations');
            const issues = orgs
                .map((org) => ({ org, path: str(isObj(org.data.branding) ? org.data.branding.logoPath : '') }))
                .filter(({ org, path }) => !!path && !ownedLogoPath(org, path))
                .map(({ org }) => ({
                    orgId: org.id,
                    code: str(org.data.code),
                    name: str(org.data.name),
                    finding: 'Logo reference is outside this organization’s permitted branding locations',
                }));
            return { checked: orgs.length, flagged: issues.length, issues: issues.slice(0, 100), truncated: issues.length > 100 };
        }),
    ],
    'POST /api/org/branding/get': [
        orgRoute('org.branding.get', 'ADM.settings', async (ctx) => ({ name: str(ctx.org.data.name), branding: await brandingOut(ctx.org) })),
    ],

    'POST /api/org/branding/save': [
        orgRoute('org.branding.save', 'ADM.settings', async (ctx) => {
            const value = readBranding((isObj(ctx.body.branding) ? ctx.body.branding : {}) as Record<string, unknown>);
            const current = isObj(ctx.org.data.branding) ? ctx.org.data.branding : {};
            const next: Fields = { ...current, ...value, theme: buildTheme(str(value.preset), str(value.brandColor)), updatedAt: nowIso(), updatedBy: ctx.actor.email };
            await updateFields(`organizations/${ctx.orgId}`, { branding: next });
            await audit([{ category: 'data', action: 'org.branding.update', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: str(value.displayName) }, details: `${str(value.preset)} · ${str(value.brandColor)}` }]);
            return { branding: await brandingOut(ctx.org, next) };
        }),
    ],

    'POST /api/org/branding/logo': [
        orgRoute('org.branding.logo', 'ADM.settings', async (ctx) => {
            await rateLimit('org-logo', ctx.orgId, 30, 3600);
            const data = str(ctx.body.data);
            if (!data || data.length > 1_500_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, 'The logo must be a PNG or JPEG image under 1 MB.');
            const buf = Buffer.from(data, 'base64');
            if (!buf.length || buf.length > 1_100_000) throw new HttpError(400, 'The logo must be under 1 MB.');
            const detected = detectImage(buf);
            if (!detected) throw new HttpError(400, 'The logo must be a PNG or JPEG image.');
            const path = `organizations/${ctx.orgId}/branding/logo_${randomId(6)}.${detected.ext}`;
            const [ok] = await storage.write([{ path, content: data, contentType: detected.contentType }]);
            if (!ok) throw new HttpError(502, 'The logo could not be stored. Please try again.');
            const current = isObj(ctx.org.data.branding) ? ctx.org.data.branding : {};
            const previous = str(current.logoPath);
            const next: Fields = { ...current, logoPath: path, updatedAt: nowIso(), updatedBy: ctx.actor.email };
            try {
                await updateFields('organizations/' + ctx.orgId, { branding: next });
            } catch (err) {
                // The previous valid logo must remain usable when the database save fails.
                await storage.delete([path]).catch(() => undefined);
                throw err;
            }
            // Never delete a registration image, another tenant's file or the active
            // logo before the new organization-specific reference has been saved.
            if (previous && previous !== path && previous.startsWith('organizations/' + ctx.orgId + '/branding/')
                && ownedLogoPath(ctx.org, previous)) {
                try { await storage.delete([previous]); }
                catch { console.warn('LOGO_CLEANUP_DEFERRED', ctx.orgId); }
            }
            await audit([{ category: 'data', action: 'org.branding.logo', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: 'Logo' }, details: `${Math.round(buf.length / 1024)} KB` }]);
            return { branding: await brandingOut(ctx.org, next) };
        }),
    ],
};
