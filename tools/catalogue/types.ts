/** Type rules: which attributes make an entry of a given type unique, which are mandatory, and how it is sourced. */
export type Kind = 'materials' | 'services' | 'assets';
export type SupplyHint = 'OEM' | 'OCM' | 'GENERAL';
export type ProviderHint = 'OEM' | 'OEM_AUTH' | 'SPECIALIST' | 'GENERAL' | 'IN_HOUSE';
/** A library attribute code (MEMS.X) or an attribute the catalogue already has, by name ("@Rated power"). */
export type Ref = string;
export const N = (name: string): Ref => '@' + name;

export interface TypeSpec {
    id: string;
    label: string;
    kind: Kind;
    /** Code prefixes (category, subcategory, family or item) where the rule applies. Empty = everywhere. */
    scope: string[];
    /** Item-name pattern; when omitted the rule applies to every entry in scope. */
    match?: RegExp;
    exclude?: RegExp;
    required: Ref[];
    optional?: Ref[];
    /** Attributes used to build the short text, in order (defaults to the first required ones). */
    specific?: Ref[];
    /** Plain-language set-up help shown at the top of the form. */
    guidance: string;
    /** Materials: usual supply route and why. */
    supply?: { usual: SupplyHint[]; note: string };
    /** Services and assets: who should do the work / service the asset. */
    providers?: { usual: ProviderHint[]; note: string };
    /** Assets: attribute domain for new attributes (e.g. ELC, FLD). Services: SCP/TEC/QAC… */
    domain?: string;
    /** Keep the catalogue's generic mandatory attributes (standard, revision…) mandatory. Default false. */
    keepGenericRequired?: boolean;
    /** Assets and services: also make this many of the entry's own distinguishing attributes (specificAttributes) mandatory. */
    promoteSpecific?: number;
}
export const SUPPLY_LABEL: Record<SupplyHint, string> = {
    OEM: 'OEM — the machine maker (or its authorised agent)',
    OCM: 'OCM — the company that makes the component itself',
    GENERAL: 'General supplier / stockist',
};
export const PROVIDER_LABEL: Record<ProviderHint, string> = {
    OEM: 'OEM — the equipment maker’s own service team',
    OEM_AUTH: 'OEM-authorised service partner',
    SPECIALIST: 'Independent specialist',
    GENERAL: 'General contractor',
    IN_HOUSE: 'Own maintenance team',
};
