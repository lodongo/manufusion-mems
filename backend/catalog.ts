// Default ERP module catalogue and MEMS website configuration.

export interface ModuleDefault {
    code: string;
    name: string;
    category: string;
    description: string;
    features: string[];
    mandatory: boolean;
    enabled: boolean;
    monthlyPriceKes: number;
    annualPriceKes: number;
    pricePerUserKes: number;
    dependencies: string[];
    sortOrder: number;
}

function mod(
    sortOrder: number,
    code: string,
    name: string,
    category: string,
    mandatory: boolean,
    monthlyPriceKes: number,
    pricePerUserKes: number,
    dependencies: string[],
    description: string,
    features: string[]
): ModuleDefault {
    return {
        code,
        name,
        category,
        description,
        features,
        mandatory,
        enabled: true,
        monthlyPriceKes,
        annualPriceKes: monthlyPriceKes * 10,
        pricePerUserKes,
        dependencies,
        sortOrder,
    };
}

export const MODULE_CATEGORIES = ['Core', 'Finance', 'Operations', 'Supply chain', 'Commercial', 'People', 'Productivity'];

export const DEFAULT_MODULES: ModuleDefault[] = [
    mod(10, 'ADM', 'Administration & Security', 'Core', true, 0, 0, [],
        'The foundation of every MEMS tenant. It manages the organization profile, branches, users, roles and permissions, approval rules and security settings, and keeps a complete audit trail of who did what and when. Every other module relies on it for access control, so it is always included at no extra cost.',
        ['Organization profile and branches', 'Users, roles and permissions', 'Approval workflows', 'Audit trail and activity logs', 'Security and notification settings']),
    mod(20, 'FIN', 'Finance & Accounting', 'Finance', true, 6500, 500, [],
        'Double-entry accounting designed for African businesses. It maintains the chart of accounts and general ledger, accounts payable and receivable, bank, cash and mobile money accounts, and multi-currency transactions with automatic exchange gains and losses. It produces the trial balance, profit and loss, balance sheet and tax reports that management and regulators need.',
        ['Chart of accounts and general ledger', 'Accounts payable and receivable', 'Bank, cash and mobile money reconciliation', 'Multi-currency with live exchange rates', 'VAT and withholding tax reporting', 'Financial statements']),
    mod(30, 'INV', 'Inventory Management', 'Operations', true, 5000, 500, [],
        'Real-time visibility of raw materials, packaging, work in progress and finished goods. It tracks stock by item, batch, serial number and location, supports multiple units of measure with conversions, and values stock using FIFO or weighted average cost so the books always match the shelves.',
        ['Materials Master', 'Batch, lot and expiry tracking', 'Stock movements, transfers and adjustments', 'Reorder levels and low-stock alerts', 'Stock counts and valuation']),
    mod(40, 'MFG', 'Manufacturing', 'Operations', true, 8500, 500, ['INV'],
        'The heart of MEMS. It defines multi-level bills of materials and routings, issues production orders and job cards, records material consumption, labour and machine time, and captures output, yield and waste directly from the shop floor on a phone.',
        ['Multi-level bills of materials', 'Routings and work centres', 'Production orders and job cards', 'Material issue and backflushing', 'Yield, scrap and waste tracking', 'By-products and co-products']),
    mod(50, 'PLN', 'Production Planning & MRP', 'Operations', false, 6000, 500, ['MFG', 'INV'],
        'Turns sales demand and forecasts into a plan the factory can actually build. It runs material requirements planning across bills of materials to suggest purchase and production orders, balances the load against work-centre capacity, and highlights shortages before they stop the line.',
        ['Master production schedule', 'MRP runs and planned orders', 'Capacity planning', 'Shortage and expedite reports', 'Demand forecasting']),
    mod(60, 'CST', 'Product Costing', 'Finance', false, 3500, 300, ['MFG', 'FIN'],
        'Shows what every product really costs to make. It rolls up material, labour and overhead costs through the bill of materials, compares standard and actual cost for each production order, and analyses variances and margins by product, customer and channel.',
        ['Standard and actual costing', 'Cost roll-up through bills of materials', 'Overhead absorption', 'Variance analysis', 'Product margin analysis']),
    mod(70, 'QLT', 'Quality Management', 'Operations', false, 4000, 400, ['MFG'],
        'Builds quality into every batch. It defines inspection plans and specifications for incoming materials, in-process checks and finished goods, records test results, quarantines non-conforming stock, manages corrective and preventive actions, and issues certificates of analysis.',
        ['Inspection plans and specifications', 'Incoming, in-process and final inspection', 'Quarantine and release of stock', 'Corrective and preventive actions', 'Certificates of analysis']),
    mod(80, 'MNT', 'Maintenance Management', 'Operations', false, 4000, 400, ['AST'],
        'Keeps machines running and downtime low. It schedules preventive maintenance by time or usage, raises and tracks work orders for breakdowns, records spare parts and labour used, and reports downtime and maintenance cost for every machine.',
        ['Preventive maintenance schedules', 'Breakdown work orders', 'Spare parts usage', 'Downtime tracking', 'Maintenance cost per machine']),
    mod(90, 'AST', 'Asset Management', 'Finance', false, 3500, 300, ['FIN'],
        'A complete register of fixed assets, from machinery and vehicles to buildings and IT equipment. It tracks acquisition, location, custodians, insurance and warranties, and calculates depreciation using straight-line or reducing-balance methods with automatic postings to finance.',
        ['Fixed asset register', 'Asset tagging and custodians', 'Depreciation schedules', 'Insurance and warranty tracking', 'Disposals and transfers']),
    mod(100, 'PRC', 'Procurement', 'Supply chain', false, 4500, 400, ['INV', 'FIN'],
        'Manages buying from request to payment. It captures purchase requisitions, sends requests for quotation, compares supplier quotes, issues approved purchase orders, records goods received and matches supplier invoices against orders and deliveries before payment.',
        ['Purchase requisitions and approvals', 'Requests for quotation', 'Supplier management and rating', 'Purchase orders and goods received notes', 'Three-way invoice matching']),
    mod(110, 'WHS', 'Warehousing', 'Supply chain', false, 4500, 400, ['INV'],
        'Organises stores and warehouses down to the bin. It manages receiving, put-away, picking, packing and dispatch, supports barcode and QR scanning with the phone camera, and makes the best use of space across multiple warehouses.',
        ['Multiple warehouses, zones and bins', 'Receiving and put-away', 'Picking, packing and dispatch', 'Barcode and QR scanning', 'Warehouse transfers']),
    mod(120, 'LOG', 'Logistics', 'Supply chain', false, 4000, 400, ['INV'],
        'Plans and tracks the movement of goods in and out. It manages inbound and outbound shipments, own fleet and third-party transporters, delivery routes, freight costs and proof of delivery, with clear visibility of goods in transit.',
        ['Shipment planning', 'Fleet and transporter management', 'Route planning', 'Freight cost tracking', 'Proof of delivery']),
    mod(130, 'DST', 'Distribution', 'Commercial', false, 4500, 400, ['SAL', 'INV'],
        'Manages the route to market. It handles distributors, depots and route sales, price lists by channel and region, van-sales stock and distributor replenishment, giving a clear view of sell-in and sell-through across the network.',
        ['Distributor and depot management', 'Channel and regional price lists', 'Route and van sales', 'Distributor stock replenishment', 'Sell-in and sell-through reports']),
    mod(140, 'SAL', 'Sales', 'Commercial', false, 5000, 400, ['FIN', 'INV'],
        'Handles the full order-to-cash cycle. It creates quotations and sales orders, checks stock and credit limits, raises delivery notes and invoices, accepts mobile money and bank payments, and tracks customer balances and sales performance.',
        ['Quotations and sales orders', 'Credit limits and approvals', 'Delivery notes and invoices', 'Mobile money and bank receipts', 'Customer statements and sales analysis']),
    mod(150, 'CRM', 'Customer Relationship Management', 'Commercial', false, 3500, 300, ['SAL'],
        'Builds lasting customer relationships. It tracks leads, prospects and customers, logs calls, visits and messages, manages the sales pipeline and follow-ups, and records complaints and feedback so nothing falls through the cracks.',
        ['Leads and prospects', 'Sales pipeline', 'Visits, calls and follow-ups', 'Complaints and feedback', 'Customer segmentation']),
    mod(160, 'POS', 'Point of Sale', 'Commercial', false, 3000, 300, ['SAL', 'INV'],
        'Sells directly from factory shops and outlets. A fast, phone-friendly till that works with cash, mobile money and cards, issues receipts, updates stock instantly and reconciles daily takings per cashier and outlet.',
        ['Phone-based till', 'Cash, mobile money and card payments', 'Receipts and returns', 'Instant stock updates', 'Daily cash-up and reconciliation']),
    mod(170, 'HRM', 'Human Resources', 'People', false, 4000, 300, [],
        'Manages the people behind production. It keeps employee records, contracts and documents, tracks attendance, shifts and leave, manages recruitment and onboarding, and supports performance reviews and training records.',
        ['Employee records and contracts', 'Attendance, shifts and leave', 'Recruitment and onboarding', 'Performance reviews', 'Training and certifications']),
    mod(180, 'PAY', 'Payroll', 'People', false, 4500, 300, ['HRM', 'FIN'],
        'Runs accurate payroll for African tax regimes. It calculates gross pay, overtime, allowances, statutory deductions, PAYE and pension contributions, produces payslips and statutory returns, and posts payroll costs to finance.',
        ['Gross-to-net calculation', 'Statutory deductions and PAYE', 'Payslips', 'Statutory returns', 'Payroll journal to finance']),
    mod(190, 'DOC', 'Documentation & Records', 'Productivity', false, 2500, 200, [],
        'A central library for controlled documents. It stores standard operating procedures, certificates, contracts and drawings with version control, approvals and expiry reminders, and links documents to items, assets, suppliers and orders.',
        ['Document library', 'Version control', 'Approval and sign-off', 'Expiry reminders', 'Links to records']),
    mod(200, 'RPT', 'Reporting & Analytics', 'Productivity', false, 3000, 200, [],
        'Turns MEMS data into decisions. It provides dashboards and key performance indicators for production, inventory, sales and finance, scheduled reports by email, and exports to Excel and PDF.',
        ['Dashboards and KPIs', 'Standard report library', 'Scheduled reports', 'Excel and PDF export', 'Custom report builder']),
    mod(210, 'PRJ', 'Project Management', 'Productivity', false, 3000, 200, [],
        'Plans and controls projects such as plant expansions, new product launches and equipment installations. It manages tasks, milestones, resources and budgets, and tracks actual cost and progress against plan.',
        ['Projects, tasks and milestones', 'Resource allocation', 'Budgets and actual costs', 'Progress tracking', 'Project documents']),
];

export const FEATURE_ICONS = ['boxes', 'layers', 'clipboard', 'wallet', 'smartphone', 'globe', 'factory', 'truck', 'shield', 'chart'];

export const SITE_DEFAULTS = {
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
    theme: {
        page: '#020617',
        panel: '#0f172a',
        border: '#1e293b',
        text: '#ffffff',
        textSoft: '#cbd5e1',
        muted: '#94a3b8',
        brand: '#10b981',
        brandSoft: '#6ee7b7',
        onBrand: '#020617',
    },
};
