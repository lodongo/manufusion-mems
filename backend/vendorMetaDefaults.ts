// ---------------------------------------------------------------------------
// Procurement vendor master data shipped by MEMS (Modules > PRC > Metadata). Organizations use these lists when they
// register a vendor. MEMS administrators can load them into the database and maintain them there; the vendor screens
// read the database first and fall back to these defaults.
// ---------------------------------------------------------------------------

type Row = [label: string, note: string, extra?: Record<string, unknown>];

function rows(prefix: string, color: string, list: Row[]): Array<Record<string, unknown>> {
    return list.map(([label, description, extra], i) => ({
        code: `${prefix}-${String(i + 1).padStart(3, '0')}`,
        label,
        description,
        category: '',
        selectable: true,
        active: true,
        color,
        ...(extra ?? {}),
    }));
}

export interface VendorList {
    key: string;
    title: string;
    description: string;
    version: number;
    items: Array<Record<string, unknown>>;
}

export const VENDOR_META_LISTS: VendorList[] = [
    {
        key: 'vendorClasses',
        title: 'Vendor classes (OEM, OCM, general supplier ...)',
        description: 'What kind of supplier the vendor is. Drives which documents are required, for example a manufacturer authorisation letter for distributors.',
        version: 1,
        items: rows('VCL', '#2563EB', [
            ['OEM (Original Equipment Manufacturer)', 'Makes and brands the equipment itself. Source of warranty, genuine parts and technical support.'],
            ['OCM (Original Component Manufacturer)', 'Makes the components that equipment makers fit. Supplies parts to the original specification.'],
            ['Authorised distributor or dealer', 'Appointed in writing by an OEM or OCM to sell its products in a territory.', { needsAuthorisation: true }],
            ['Manufacturer (own brand)', 'Makes goods under its own brand, not tied to a particular equipment maker.'],
            ['General supplier', 'Buys from several makers and resells. Holds no manufacturer appointment.'],
            ['Stockist or trader', 'Keeps stock for quick supply. The origin of the goods varies.'],
            ['Service contractor', 'Provides labour, installation, repair or maintenance.'],
            ['Professional or consulting firm', 'Provides expert advice, design, inspection or audit.', { needsProfessionalRegistration: true }],
            ['Importer or agent', 'Brings in goods, or represents a foreign maker locally.', { needsAuthorisation: true }],
        ]),
    },
    {
        key: 'vendorSourcingChannels',
        title: 'Vendor sourcing channels (single source, sole source ...)',
        description: 'How the organization sources from this vendor. Single source, sole source and nominated suppliers need a written justification.',
        version: 1,
        items: rows('VSC', '#EA580C', [
            ['Multi-source (competitive)', 'Several suppliers can meet the need. Normal competition applies.'],
            ['Preferred supplier', 'Pre-qualified for repeat buying. Still compared on price and delivery.'],
            ['Framework or call-off agreement', 'Prices and terms are agreed for a period. Orders are called off against the agreement.'],
            ['Single source', 'Others exist, but the organization deliberately uses one (standardisation, compatibility or warranty).', { needsJustification: true }],
            ['Sole source', 'Only one supplier can supply (patent, proprietary design or exclusive rights).', { needsJustification: true }],
            ['Nominated supplier', 'Named by a client, funder, regulator or the equipment maker.', { needsJustification: true }],
            ['Spot or one-off', 'Used for a single purchase. Not a repeat supplier.'],
            ['Emergency supplier', 'Used only when normal sourcing cannot meet an urgent need.', { needsJustification: true }],
        ]),
    },
    {
        key: 'vendorLegalTypes',
        title: 'Vendor legal types',
        description: 'Legal form of the vendor business.',
        version: 1,
        items: rows('VLT', '#64748B', [
            ['Sole proprietorship', 'Owned and run by one person.'],
            ['Partnership', 'Owned by two or more partners.'],
            ['Private limited company', 'Company whose shares are not offered to the public.'],
            ['Public limited company', 'Company whose shares are offered to the public.'],
            ['Cooperative or society', 'Member-owned organization.'],
            ['NGO or trust', 'Non-profit organization or trust.'],
            ['Government or parastatal', 'Public body or state-owned entity.'],
            ['Foreign company', 'Registered outside the country of the buyer.'],
            ['Individual contractor', 'A person who works for themselves.'],
        ]),
    },
    {
        key: 'vendorDocumentTypes',
        title: 'Vendor documents',
        description: 'Documents kept on the vendor file. Required documents must be attached before a vendor can be submitted for approval. Documents with an expiry stop the vendor from being approved when expired.',
        version: 1,
        items: rows('VDT', '#16A34A', [
            ['Certificate of incorporation or registration', 'Proof that the business exists.', { required: true, expires: false, forClasses: [] }],
            ['Tax registration certificate (PIN or TIN)', 'Proof of tax registration.', { required: true, expires: false, forClasses: [] }],
            ['Tax compliance certificate', 'Proof that taxes are up to date.', { required: true, expires: true, forClasses: [] }],
            ['Business permit or trading licence', 'Permission to trade where the vendor operates.', { required: true, expires: true, forClasses: [] }],
            ['Bank confirmation letter', 'Letter from the bank confirming the account name and number. Guards against payment fraud.', { required: true, expires: false, forClasses: [] }],
            ['Beneficial ownership declaration', 'Who ultimately owns and controls the business.', { required: true, expires: false, forClasses: [] }],
            ['Manufacturer authorisation letter', 'Written appointment by the OEM or OCM to sell or represent its products.', { required: true, expires: true, forClasses: ['VCL-003', 'VCL-009'] }],
            ['Professional registration or practising certificate', 'Registration with the professional body.', { required: true, expires: true, forClasses: ['VCL-008'] }],
            ['Quality certification (for example ISO 9001)', 'Evidence of a quality system.', { required: false, expires: true, forClasses: [] }],
            ['Health, safety or environmental certificate', 'Evidence of safe and responsible operation.', { required: false, expires: true, forClasses: [] }],
            ['Insurance certificate', 'Liability or professional indemnity cover.', { required: false, expires: true, forClasses: [] }],
            ['Company profile and references', 'Who the vendor has served before.', { required: false, expires: false, forClasses: [] }],
        ]),
    },
    {
        key: 'vendorPaymentTerms',
        title: 'Vendor payment terms',
        description: 'Terms on which the vendor expects to be paid.',
        version: 1,
        items: rows('VPT', '#0D9488', [
            ['Cash on delivery', 'Paid when the goods or service are received.', { days: 0 }],
            ['Advance payment', 'Paid before delivery.', { days: 0 }],
            ['Net 7 days', 'Paid 7 days after invoice.', { days: 7 }],
            ['Net 14 days', 'Paid 14 days after invoice.', { days: 14 }],
            ['Net 30 days', 'Paid 30 days after invoice.', { days: 30 }],
            ['Net 45 days', 'Paid 45 days after invoice.', { days: 45 }],
            ['Net 60 days', 'Paid 60 days after invoice.', { days: 60 }],
            ['Net 90 days', 'Paid 90 days after invoice.', { days: 90 }],
            ['Part advance, balance on delivery', 'A share is paid up front and the rest on delivery.', { days: 0 }],
            ['Letter of credit', 'Paid through a bank guarantee against shipping documents.', { days: 0 }],
        ]),
    },
    {
        key: 'vendorIncoterms',
        title: 'Incoterms',
        description: 'International trade terms that say who carries cost and risk of delivery. Used for materials and assets.',
        version: 1,
        items: rows('VIN', '#0EA5E9', [
            ['EXW (Ex Works)', 'Buyer collects from the seller premises.'],
            ['FCA (Free Carrier)', 'Seller hands goods to the buyer carrier.'],
            ['CPT (Carriage Paid To)', 'Seller pays carriage to a named place.'],
            ['CIP (Carriage and Insurance Paid To)', 'As CPT, and the seller insures the goods.'],
            ['DAP (Delivered at Place)', 'Seller delivers to the named place, ready to unload.'],
            ['DPU (Delivered at Place Unloaded)', 'Seller delivers and unloads at the named place.'],
            ['DDP (Delivered Duty Paid)', 'Seller delivers and pays import duties.'],
            ['FAS (Free Alongside Ship)', 'Seller places goods alongside the ship at the port.'],
            ['FOB (Free on Board)', 'Seller loads goods on the ship.'],
            ['CFR (Cost and Freight)', 'Seller pays freight to the destination port.'],
            ['CIF (Cost, Insurance and Freight)', 'As CFR, and the seller insures the goods.'],
        ]),
    },
    {
        key: 'vendorRiskRatings',
        title: 'Vendor risk ratings',
        description: 'Due diligence rating given when a vendor is registered.',
        version: 1,
        items: rows('VRR', '#DC2626', [
            ['Low', 'Established supplier with full documents and no concerns.'],
            ['Medium', 'Some concerns, such as a new business or a single reference.'],
            ['High', 'Significant concerns. Needs close control on every order.'],
        ]),
    },
];
