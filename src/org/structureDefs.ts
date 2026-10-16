export type FieldType = 'text' | 'select' | 'date' | 'number' | 'country' | 'currency' | 'email' | 'url' | 'phone' | 'bank' | 'meta' | 'fin' | 'asset' | 'assetClass';

export interface FieldDef {
    key: string;
    label: string;
    type: FieldType;
    section?: string;
    required?: boolean;
    options?: string[];
    min?: number;
    max?: number;
    list?: string;
    placeholder?: string;
}

export interface LevelDef {
    key: string;
    label: string;
    manual: boolean;
    maxLength?: number;
    hint: string;
    example: string;
    children: string[];
    managerRequired?: boolean;
    fields: FieldDef[];
}

// Hard-coded chain from legal entity down. Codes inherit the parent's code up to the assembly.
export const LEVELS: Record<string, LevelDef> = {
    group: { key: 'group', label: 'Upper level unit', manual: true, maxLength: 6, hint: '2 to 6 capital letters, e.g. EAST or KE.', example: 'EAST', children: [], fields: [] },
    legal_entity: {
        key: 'legal_entity',
        label: 'Legal entity',
        manual: true,
        maxLength: 3,
        hint: '3 capital letters, unique in your organization. We suggest one from the name; change it if you like.',
        example: 'ABC',
        children: ['site'],
        fields: [
            { key: 'tradingName', label: 'Trading name (if different)', type: 'text', section: 'Identity' },
            { key: 'registrationNumber', label: 'Registration number', type: 'text', section: 'Registration and tax', required: true },
            { key: 'registrationDate', label: 'Registration date', type: 'date', section: 'Registration and tax' },
            { key: 'taxNumber', label: 'Tax PIN / TIN', type: 'text', section: 'Registration and tax', required: true },
            { key: 'vatNumber', label: 'VAT number', type: 'text', section: 'Registration and tax' },
            { key: 'countryCode', label: 'Country', type: 'country', section: 'Registration and tax', required: true },
            { key: 'currencyCode', label: 'Functional currency', type: 'currency', section: 'Finance', required: true },
            { key: 'fiscalYearStart', label: 'Financial year starts', type: 'meta', list: 'fiscalYearStart', section: 'Finance' },
            { key: 'address', label: 'Physical address', type: 'text', section: 'Address and contact', required: true },
            { key: 'city', label: 'City or town', type: 'text', section: 'Address and contact', required: true },
            { key: 'postalAddress', label: 'Postal address', type: 'text', section: 'Address and contact' },
            { key: 'postalCode', label: 'Postal code', type: 'text', section: 'Address and contact' },
            { key: 'phone', label: 'Telephone', type: 'phone', section: 'Address and contact', placeholder: '+254 712 345 678' },
            { key: 'email', label: 'Email', type: 'email', section: 'Address and contact' },
            { key: 'website', label: 'Website', type: 'url', section: 'Address and contact', placeholder: 'https://' },
            { key: 'bankId', label: 'Bank', type: 'bank', section: 'Banking' },
            { key: 'bankBranch', label: 'Branch', type: 'text', section: 'Banking' },
            { key: 'bankAccountName', label: 'Account name', type: 'text', section: 'Banking' },
            { key: 'bankAccountNumber', label: 'Account number', type: 'text', section: 'Banking' },
        ],
    },
    site: {
        key: 'site',
        label: 'Site',
        manual: false,
        hint: 'Numbered automatically: 01, 02...',
        example: 'ABC-01',
        children: ['department'],
        fields: [
            { key: 'siteType', label: 'Site type', type: 'select', options: ['Factory', 'Warehouse', 'Office', 'Depot', 'Farm', 'Shop', 'Other'] },
            { key: 'address', label: 'Physical address', type: 'text' },
            { key: 'city', label: 'City or town', type: 'text' },
            { key: 'phone', label: 'Telephone', type: 'phone' },
        ],
    },
    department: { key: 'department', label: 'Department', manual: true, maxLength: 3, hint: '3 capital letters, e.g. PRD for production, FIN for finance.', example: 'ABC-01-PRD', children: ['cost_center'], fields: [] },
    cost_center: {
        key: 'cost_center',
        label: 'Cost center',
        manual: false,
        managerRequired: true,
        hint: 'Numbered automatically: 001, 002...',
        example: 'ABC-01-PRD-001',
        children: ['work_center'],
        fields: [{ key: 'costType', label: 'Cost center type', type: 'fin', list: 'costCenterTypes', required: true }],
    },
    // Equipment unit (ISO 14224 term): any machine, production line, utility system or facility.
    // Internal key stays 'work_center'; classified from the asset catalog and configured through its asset record.
    work_center: {
        key: 'work_center',
        label: 'Equipment unit',
        manual: false,
        hint: 'A machine, production line, utility system or facility, classified from the asset catalog. Numbered automatically: 001, 002...',
        example: 'ABC-01-PRD-001-001',
        children: ['assembly'],
        fields: [{ key: 'equipmentClass', label: 'Equipment class (from the asset catalog) *', type: 'assetClass' }],
    },
    // Old level kept only to show data created before equipment units; nothing new is added here.
    equipment: {
        key: 'equipment',
        label: 'Equipment (old level)',
        manual: false,
        hint: 'Old level. New equipment is set up as an equipment unit under the cost center.',
        example: 'ABC-01-PRD-001-01-001',
        children: ['assembly'],
        fields: [
            { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
            { key: 'model', label: 'Model', type: 'text' },
            { key: 'serialNumber', label: 'Serial number', type: 'text' },
            { key: 'commissionedOn', label: 'Commissioned on', type: 'date' },
        ],
    },
    assembly: { key: 'assembly', label: 'Assembly', manual: false, hint: 'Numbered automatically: 01, 02... Holds bills of materials, which are not codified (components come from inventory).', example: 'ABC-01-PRD-001-001-01', children: [], fields: [] },
};

export const CHAIN = ['legal_entity', 'site', 'department', 'cost_center', 'work_center', 'assembly'];
export const MAX_UPPER_LEVELS = 6;
export const LEVEL_EXAMPLES = ['Headquarters', 'Regional office', 'Country office', 'Area office', 'Zone', 'Branch'];

export const LEVEL_COLORS: Record<string, string> = {
    group: '#38bdf8',
    legal_entity: '#34d399',
    site: '#a78bfa',
    department: '#fbbf24',
    cost_center: '#fb7185',
    work_center: '#22d3ee',
    equipment: '#94a3b8',
    assembly: '#a3e635',
};

export function upperName(names: string[], tier: number): string {
    return names[tier] || `Level_${tier}`;
}

/** Suggests a 3-letter code from a name, e.g. "Acme Bottling Company" -> ABC. */
export function suggestCode(name: string): string {
    const words = name.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
    let code = words.map((w) => w[0]).join('');
    if (code.length < 3 && words[0]) code += words[0].slice(1);
    return code.slice(0, 3);
}

export function operatingLabel(value: string, names: string[]): string {
    if (value === 'legal_entity') return 'Legal entity level';
    if (value === 'site') return 'Site level';
    if (value === 'department') return 'Department level';
    if (value === 'cost_center') return 'Cost center level';
    const m = /^upper:(\d)$/.exec(value);
    return m ? `${upperName(names, Number(m[1]))} level` : 'Level not set yet';
}
