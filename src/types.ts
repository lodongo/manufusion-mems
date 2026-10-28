import type { Theme } from './lib/site';

export interface OrgBranding {
    displayName: string;
    slogan: string;
    preset: string;
    brandColor: string;
    theme: Theme;
    logoUrl: string;
    logoNeedsReview?: boolean;
}

export interface Organization {
    branding?: OrgBranding | null;
    id: string;
    code: string;
    name: string;
    domain: string;
    countryCode: string;
    countryName: string;
    currencyCode: string;
    city: string;
    status: string;
    rejectionReason?: string;
    emailVerified?: boolean;
}

export interface UserPreferences {
    appearance: string;
    startPage: 'home' | 'last';
}

export interface Session {
    health?: { lock: { locked: true; kind: 'break' | 'weekly'; until: string; message: string } | null };
    user: {
        uid: string;
        email: string;
        firstName: string;
        lastName: string;
        phone: string;
    };
    role: string | null;
    roleName?: string;
    organization: Organization | null;
    permissions: string[];
    landing: string;
    mustChangePassword?: boolean;
    photoUrl?: string;
    lastRoute?: string;
    preferences?: UserPreferences;
    photoRequired?: boolean;
    /** Development-only platform testing override for this organization (banner). */
    testMode?: { active: boolean; appliesToYou: boolean; expiresAt: string; reason: string };
}

export const STAFF_ROLES = ['super_admin', 'mems_admin', 'mems_support'];

export const ROLE_LABELS: Record<string, string> = {
    super_admin: 'Super admin',
    mems_admin: 'MEMS admin',
    mems_support: 'MEMS support (read-only)',
    org_super_admin: 'Organization super admin',
    org_admin: 'Organization super admin',
    org_user: 'Standard user',
    applicant: 'Registration applicant',
};

export function hasPerm(permissions: string[], permission: string): boolean {
    if (permissions.includes('*') || permissions.includes(permission)) return true;
    const parts = permission.split('.');
    for (let i = parts.length - 1; i > 0; i--) if (permissions.includes(`${parts.slice(0, i).join('.')}.*`)) return true;
    return false;
}
