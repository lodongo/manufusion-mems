export interface OrgContextData {
    organization: {
        id: string;
        code: string;
        name: string;
        domain: string;
        countryName: string;
        city: string;
        currencyCode: string;
        industry: string;
        companySize: string;
        legalEntityType: string;
        status: string;
        createdAt: string;
    };
    role: string;
    roleName: string;
    permissions: string[];
    modules: Array<{ code: string; name: string; category: string; mandatory: boolean; features: string[] }>;
    userCount: number;
    activeUserCount: number;
}

export interface OrgRole {
    id: string;
    name: string;
    description: string;
    permissions: string[];
    system: boolean;
    /** Standard level role (one ladder per module), when this role is one. */
    level?: { module: string; rank: number; level: string } | null;
    users: number;
    updatedAt: string;
}

export interface PermissionGroup {
    module: string;
    name: string;
    permissions: Array<{ key: string; label: string }>;
}

export const humanize = (code: string) => code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
