import { type Theme } from './site';
import { BRAND_PRESETS } from './brandTheme';
import type { UserPreferences } from '../types';

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
    appearance: 'organization',
    startPage: 'home',
};

/** Change only neutral surfaces; the organization retains its primary brand and highlights. */
export function effectivePersonalTheme(
    organizationTheme: Theme,
    preference?: UserPreferences['appearance']
): Theme {
    if (!preference || preference === 'organization') return organizationTheme;
    const selected = preference === 'light' ? 'daylight' : preference === 'dark' ? 'emerald' : preference;
    const neutral = BRAND_PRESETS.find((p) => p.key === selected)?.theme;
    if (!neutral) return organizationTheme;
    return {
        ...organizationTheme,
        page: neutral.page,
        panel: neutral.panel,
        border: neutral.border,
        text: neutral.text,
        textSoft: neutral.textSoft,
        muted: neutral.muted,
        // Never override the corporate brand, highlights, or text on brand.
        brand: organizationTheme.brand,
        brandSoft: organizationTheme.brandSoft,
        onBrand: organizationTheme.onBrand,
    };
}
