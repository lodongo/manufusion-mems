import { INDUSTRY_CATEGORIES, INDUSTRY_SUBCATEGORIES } from './industryCatalog';
// Default reference data for MEMS. Loaded into Firestore by the super admin.

// [name, iso2, iso3, dialCode, capital, region, currencyCode, timezone, languages]
type CountryRow = [string, string, string, string, string, string, string, string, string];

const COUNTRY_ROWS: CountryRow[] = [
    // Eastern Africa
    ['Burundi', 'BI', 'BDI', '+257', 'Gitega', 'Eastern Africa', 'BIF', 'Africa/Bujumbura', 'Kirundi, French, English'],
    ['Comoros', 'KM', 'COM', '+269', 'Moroni', 'Eastern Africa', 'KMF', 'Indian/Comoro', 'Comorian, Arabic, French'],
    ['Djibouti', 'DJ', 'DJI', '+253', 'Djibouti', 'Eastern Africa', 'DJF', 'Africa/Djibouti', 'Arabic, French'],
    ['Eritrea', 'ER', 'ERI', '+291', 'Asmara', 'Eastern Africa', 'ERN', 'Africa/Asmara', 'Tigrinya, Arabic, English'],
    ['Ethiopia', 'ET', 'ETH', '+251', 'Addis Ababa', 'Eastern Africa', 'ETB', 'Africa/Addis_Ababa', 'Amharic, Afaan Oromo, Tigrinya, Somali, Afar'],
    ['Kenya', 'KE', 'KEN', '+254', 'Nairobi', 'Eastern Africa', 'KES', 'Africa/Nairobi', 'English, Swahili'],
    ['Madagascar', 'MG', 'MDG', '+261', 'Antananarivo', 'Eastern Africa', 'MGA', 'Indian/Antananarivo', 'Malagasy, French'],
    ['Malawi', 'MW', 'MWI', '+265', 'Lilongwe', 'Eastern Africa', 'MWK', 'Africa/Blantyre', 'English, Chichewa'],
    ['Mauritius', 'MU', 'MUS', '+230', 'Port Louis', 'Eastern Africa', 'MUR', 'Indian/Mauritius', 'English, French, Mauritian Creole'],
    ['Mozambique', 'MZ', 'MOZ', '+258', 'Maputo', 'Eastern Africa', 'MZN', 'Africa/Maputo', 'Portuguese'],
    ['Rwanda', 'RW', 'RWA', '+250', 'Kigali', 'Eastern Africa', 'RWF', 'Africa/Kigali', 'Kinyarwanda, English, French, Swahili'],
    ['Seychelles', 'SC', 'SYC', '+248', 'Victoria', 'Eastern Africa', 'SCR', 'Indian/Mahe', 'English, French, Seychellois Creole'],
    ['Somalia', 'SO', 'SOM', '+252', 'Mogadishu', 'Eastern Africa', 'SOS', 'Africa/Mogadishu', 'Somali, Arabic'],
    ['South Sudan', 'SS', 'SSD', '+211', 'Juba', 'Eastern Africa', 'SSP', 'Africa/Juba', 'English'],
    ['Tanzania', 'TZ', 'TZA', '+255', 'Dodoma', 'Eastern Africa', 'TZS', 'Africa/Dar_es_Salaam', 'Swahili, English'],
    ['Uganda', 'UG', 'UGA', '+256', 'Kampala', 'Eastern Africa', 'UGX', 'Africa/Kampala', 'English, Swahili'],
    ['Zambia', 'ZM', 'ZMB', '+260', 'Lusaka', 'Eastern Africa', 'ZMW', 'Africa/Lusaka', 'English'],
    ['Zimbabwe', 'ZW', 'ZWE', '+263', 'Harare', 'Eastern Africa', 'ZWG', 'Africa/Harare', 'English, Shona, Ndebele'],
    // Central Africa
    ['Angola', 'AO', 'AGO', '+244', 'Luanda', 'Central Africa', 'AOA', 'Africa/Luanda', 'Portuguese'],
    ['Cameroon', 'CM', 'CMR', '+237', 'Yaounde', 'Central Africa', 'XAF', 'Africa/Douala', 'French, English'],
    ['Central African Republic', 'CF', 'CAF', '+236', 'Bangui', 'Central Africa', 'XAF', 'Africa/Bangui', 'French, Sango'],
    ['Chad', 'TD', 'TCD', '+235', "N'Djamena", 'Central Africa', 'XAF', 'Africa/Ndjamena', 'French, Arabic'],
    ['Congo', 'CG', 'COG', '+242', 'Brazzaville', 'Central Africa', 'XAF', 'Africa/Brazzaville', 'French'],
    ['Democratic Republic of the Congo', 'CD', 'COD', '+243', 'Kinshasa', 'Central Africa', 'CDF', 'Africa/Kinshasa', 'French, Lingala, Swahili, Kikongo, Tshiluba'],
    ['Equatorial Guinea', 'GQ', 'GNQ', '+240', 'Malabo', 'Central Africa', 'XAF', 'Africa/Malabo', 'Spanish, French, Portuguese'],
    ['Gabon', 'GA', 'GAB', '+241', 'Libreville', 'Central Africa', 'XAF', 'Africa/Libreville', 'French'],
    ['Sao Tome and Principe', 'ST', 'STP', '+239', 'Sao Tome', 'Central Africa', 'STN', 'Africa/Sao_Tome', 'Portuguese'],
    // Northern Africa
    ['Algeria', 'DZ', 'DZA', '+213', 'Algiers', 'Northern Africa', 'DZD', 'Africa/Algiers', 'Arabic, Tamazight'],
    ['Egypt', 'EG', 'EGY', '+20', 'Cairo', 'Northern Africa', 'EGP', 'Africa/Cairo', 'Arabic'],
    ['Libya', 'LY', 'LBY', '+218', 'Tripoli', 'Northern Africa', 'LYD', 'Africa/Tripoli', 'Arabic'],
    ['Morocco', 'MA', 'MAR', '+212', 'Rabat', 'Northern Africa', 'MAD', 'Africa/Casablanca', 'Arabic, Tamazight'],
    ['Sudan', 'SD', 'SDN', '+249', 'Khartoum', 'Northern Africa', 'SDG', 'Africa/Khartoum', 'Arabic, English'],
    ['Tunisia', 'TN', 'TUN', '+216', 'Tunis', 'Northern Africa', 'TND', 'Africa/Tunis', 'Arabic'],
    // Southern Africa
    ['Botswana', 'BW', 'BWA', '+267', 'Gaborone', 'Southern Africa', 'BWP', 'Africa/Gaborone', 'English, Setswana'],
    ['Eswatini', 'SZ', 'SWZ', '+268', 'Mbabane', 'Southern Africa', 'SZL', 'Africa/Mbabane', 'English, siSwati'],
    ['Lesotho', 'LS', 'LSO', '+266', 'Maseru', 'Southern Africa', 'LSL', 'Africa/Maseru', 'Sesotho, English'],
    ['Namibia', 'NA', 'NAM', '+264', 'Windhoek', 'Southern Africa', 'NAD', 'Africa/Windhoek', 'English'],
    ['South Africa', 'ZA', 'ZAF', '+27', 'Pretoria', 'Southern Africa', 'ZAR', 'Africa/Johannesburg', 'English, Afrikaans, isiZulu, isiXhosa, Sesotho, Setswana'],
    // Western Africa
    ['Benin', 'BJ', 'BEN', '+229', 'Porto-Novo', 'Western Africa', 'XOF', 'Africa/Porto-Novo', 'French'],
    ['Burkina Faso', 'BF', 'BFA', '+226', 'Ouagadougou', 'Western Africa', 'XOF', 'Africa/Ouagadougou', 'Moore, Dioula, Fulfulde, French'],
    ['Cabo Verde', 'CV', 'CPV', '+238', 'Praia', 'Western Africa', 'CVE', 'Atlantic/Cape_Verde', 'Portuguese'],
    ["Cote d'Ivoire", 'CI', 'CIV', '+225', 'Yamoussoukro', 'Western Africa', 'XOF', 'Africa/Abidjan', 'French'],
    ['Gambia', 'GM', 'GMB', '+220', 'Banjul', 'Western Africa', 'GMD', 'Africa/Banjul', 'English'],
    ['Ghana', 'GH', 'GHA', '+233', 'Accra', 'Western Africa', 'GHS', 'Africa/Accra', 'English'],
    ['Guinea', 'GN', 'GIN', '+224', 'Conakry', 'Western Africa', 'GNF', 'Africa/Conakry', 'French'],
    ['Guinea-Bissau', 'GW', 'GNB', '+245', 'Bissau', 'Western Africa', 'XOF', 'Africa/Bissau', 'Portuguese'],
    ['Liberia', 'LR', 'LBR', '+231', 'Monrovia', 'Western Africa', 'LRD', 'Africa/Monrovia', 'English'],
    ['Mali', 'ML', 'MLI', '+223', 'Bamako', 'Western Africa', 'XOF', 'Africa/Bamako', 'Bambara, French'],
    ['Mauritania', 'MR', 'MRT', '+222', 'Nouakchott', 'Western Africa', 'MRU', 'Africa/Nouakchott', 'Arabic'],
    ['Niger', 'NE', 'NER', '+227', 'Niamey', 'Western Africa', 'XOF', 'Africa/Niamey', 'Hausa, French'],
    ['Nigeria', 'NG', 'NGA', '+234', 'Abuja', 'Western Africa', 'NGN', 'Africa/Lagos', 'English'],
    ['Senegal', 'SN', 'SEN', '+221', 'Dakar', 'Western Africa', 'XOF', 'Africa/Dakar', 'French, Wolof'],
    ['Sierra Leone', 'SL', 'SLE', '+232', 'Freetown', 'Western Africa', 'SLE', 'Africa/Freetown', 'English'],
    ['Togo', 'TG', 'TGO', '+228', 'Lome', 'Western Africa', 'XOF', 'Africa/Lome', 'French'],
];

export interface CountryDefault {
    name: string;
    iso2: string;
    iso3: string;
    dialCode: string;
    capital: string;
    region: string;
    currencyCode: string;
    timezone: string;
    languages: string[];
    flag: string;
    continent: string;
}

function flagOf(iso2: string): string {
    return String.fromCodePoint(...iso2.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0)));
}

export const AFRICAN_COUNTRIES: CountryDefault[] = COUNTRY_ROWS.map(
    ([name, iso2, iso3, dialCode, capital, region, currencyCode, timezone, languages]) => ({
        name,
        iso2,
        iso3,
        dialCode,
        capital,
        region,
        currencyCode,
        timezone,
        languages: languages.split(', '),
        flag: flagOf(iso2),
        continent: 'Africa',
    })
);

// [code, name, symbol, decimals]
type CurrencyRow = [string, string, string, number];

const CURRENCY_ROWS: CurrencyRow[] = [
    ['AED', 'UAE Dirham', 'د.إ', 2], ['AFN', 'Afghani', '؋', 2], ['ALL', 'Lek', 'L', 2],
    ['AMD', 'Armenian Dram', '֏', 2], ['AOA', 'Kwanza', 'Kz', 2], ['ARS', 'Argentine Peso', '$', 2],
    ['AUD', 'Australian Dollar', 'A$', 2], ['AWG', 'Aruban Florin', 'ƒ', 2], ['AZN', 'Azerbaijan Manat', '₼', 2],
    ['BAM', 'Convertible Mark', 'KM', 2], ['BBD', 'Barbados Dollar', 'Bds$', 2], ['BDT', 'Taka', '৳', 2],
    ['BHD', 'Bahraini Dinar', '.د.ب', 3], ['BIF', 'Burundi Franc', 'FBu', 0], ['BMD', 'Bermudian Dollar', '$', 2],
    ['BND', 'Brunei Dollar', 'B$', 2], ['BOB', 'Boliviano', 'Bs', 2], ['BRL', 'Brazilian Real', 'R$', 2],
    ['BSD', 'Bahamian Dollar', 'B$', 2], ['BTN', 'Ngultrum', 'Nu.', 2], ['BWP', 'Pula', 'P', 2],
    ['BYN', 'Belarusian Ruble', 'Br', 2], ['BZD', 'Belize Dollar', 'BZ$', 2], ['CAD', 'Canadian Dollar', 'C$', 2],
    ['CDF', 'Congolese Franc', 'FC', 2], ['CHF', 'Swiss Franc', 'CHF', 2], ['CLP', 'Chilean Peso', '$', 0],
    ['CNY', 'Yuan Renminbi', '¥', 2], ['COP', 'Colombian Peso', '$', 2], ['CRC', 'Costa Rican Colon', '₡', 2],
    ['CUP', 'Cuban Peso', '$', 2], ['CVE', 'Cabo Verde Escudo', 'Esc', 2], ['CZK', 'Czech Koruna', 'Kč', 2],
    ['DJF', 'Djibouti Franc', 'Fdj', 0], ['DKK', 'Danish Krone', 'kr', 2], ['DOP', 'Dominican Peso', 'RD$', 2],
    ['DZD', 'Algerian Dinar', 'د.ج', 2], ['EGP', 'Egyptian Pound', 'E£', 2], ['ERN', 'Nakfa', 'Nfk', 2],
    ['ETB', 'Ethiopian Birr', 'Br', 2], ['EUR', 'Euro', '€', 2], ['FJD', 'Fiji Dollar', 'FJ$', 2],
    ['FKP', 'Falkland Islands Pound', '£', 2], ['GBP', 'Pound Sterling', '£', 2], ['GEL', 'Lari', '₾', 2],
    ['GHS', 'Ghana Cedi', 'GH₵', 2], ['GIP', 'Gibraltar Pound', '£', 2], ['GMD', 'Dalasi', 'D', 2],
    ['GNF', 'Guinean Franc', 'FG', 0], ['GTQ', 'Quetzal', 'Q', 2], ['GYD', 'Guyana Dollar', 'G$', 2],
    ['HKD', 'Hong Kong Dollar', 'HK$', 2], ['HNL', 'Lempira', 'L', 2], ['HTG', 'Gourde', 'G', 2],
    ['HUF', 'Forint', 'Ft', 2], ['IDR', 'Rupiah', 'Rp', 2], ['ILS', 'New Israeli Sheqel', '₪', 2],
    ['INR', 'Indian Rupee', '₹', 2], ['IQD', 'Iraqi Dinar', 'ع.د', 3], ['IRR', 'Iranian Rial', '﷼', 2],
    ['ISK', 'Iceland Krona', 'kr', 0], ['JMD', 'Jamaican Dollar', 'J$', 2], ['JOD', 'Jordanian Dinar', 'JD', 3],
    ['JPY', 'Yen', '¥', 0], ['KES', 'Kenyan Shilling', 'KSh', 2], ['KGS', 'Som', 'с', 2],
    ['KHR', 'Riel', '៛', 2], ['KMF', 'Comorian Franc', 'CF', 0], ['KPW', 'North Korean Won', '₩', 2],
    ['KRW', 'Won', '₩', 0], ['KWD', 'Kuwaiti Dinar', 'KD', 3], ['KYD', 'Cayman Islands Dollar', 'CI$', 2],
    ['KZT', 'Tenge', '₸', 2], ['LAK', 'Lao Kip', '₭', 2], ['LBP', 'Lebanese Pound', 'ل.ل', 2],
    ['LKR', 'Sri Lanka Rupee', 'Rs', 2], ['LRD', 'Liberian Dollar', 'L$', 2], ['LSL', 'Loti', 'L', 2],
    ['LYD', 'Libyan Dinar', 'LD', 3], ['MAD', 'Moroccan Dirham', 'د.م.', 2], ['MDL', 'Moldovan Leu', 'L', 2],
    ['MGA', 'Malagasy Ariary', 'Ar', 2], ['MKD', 'Denar', 'ден', 2], ['MMK', 'Kyat', 'K', 2],
    ['MNT', 'Tugrik', '₮', 2], ['MOP', 'Pataca', 'MOP$', 2], ['MRU', 'Ouguiya', 'UM', 2],
    ['MUR', 'Mauritius Rupee', '₨', 2], ['MVR', 'Rufiyaa', 'Rf', 2], ['MWK', 'Malawi Kwacha', 'MK', 2],
    ['MXN', 'Mexican Peso', '$', 2], ['MYR', 'Malaysian Ringgit', 'RM', 2], ['MZN', 'Mozambique Metical', 'MT', 2],
    ['NAD', 'Namibia Dollar', 'N$', 2], ['NGN', 'Naira', '₦', 2], ['NIO', 'Cordoba Oro', 'C$', 2],
    ['NOK', 'Norwegian Krone', 'kr', 2], ['NPR', 'Nepalese Rupee', 'Rs', 2], ['NZD', 'New Zealand Dollar', 'NZ$', 2],
    ['OMR', 'Rial Omani', 'ر.ع.', 3], ['PAB', 'Balboa', 'B/.', 2], ['PEN', 'Sol', 'S/', 2],
    ['PGK', 'Kina', 'K', 2], ['PHP', 'Philippine Peso', '₱', 2], ['PKR', 'Pakistan Rupee', 'Rs', 2],
    ['PLN', 'Zloty', 'zł', 2], ['PYG', 'Guarani', '₲', 0], ['QAR', 'Qatari Rial', 'ر.ق', 2],
    ['RON', 'Romanian Leu', 'lei', 2], ['RSD', 'Serbian Dinar', 'дин.', 2], ['RUB', 'Russian Ruble', '₽', 2],
    ['RWF', 'Rwanda Franc', 'FRw', 0], ['SAR', 'Saudi Riyal', 'ر.س', 2], ['SBD', 'Solomon Islands Dollar', 'SI$', 2],
    ['SCR', 'Seychelles Rupee', 'SR', 2], ['SDG', 'Sudanese Pound', 'ج.س.', 2], ['SEK', 'Swedish Krona', 'kr', 2],
    ['SGD', 'Singapore Dollar', 'S$', 2], ['SHP', 'Saint Helena Pound', '£', 2], ['SLE', 'Leone', 'Le', 2],
    ['SOS', 'Somali Shilling', 'Sh.So.', 2], ['SRD', 'Surinam Dollar', '$', 2], ['SSP', 'South Sudanese Pound', 'SSP', 2],
    ['STN', 'Dobra', 'Db', 2], ['SVC', 'El Salvador Colon', '₡', 2], ['SYP', 'Syrian Pound', '£S', 2],
    ['SZL', 'Lilangeni', 'E', 2], ['THB', 'Baht', '฿', 2], ['TJS', 'Somoni', 'SM', 2],
    ['TMT', 'Turkmenistan New Manat', 'm', 2], ['TND', 'Tunisian Dinar', 'د.ت', 3], ['TOP', 'Paanga', 'T$', 2],
    ['TRY', 'Turkish Lira', '₺', 2], ['TTD', 'Trinidad and Tobago Dollar', 'TT$', 2], ['TWD', 'New Taiwan Dollar', 'NT$', 2],
    ['TZS', 'Tanzanian Shilling', 'TSh', 2], ['UAH', 'Hryvnia', '₴', 2], ['UGX', 'Uganda Shilling', 'USh', 0],
    ['USD', 'US Dollar', '$', 2], ['UYU', 'Peso Uruguayo', '$U', 2], ['UZS', 'Uzbekistan Sum', 'soʻm', 2],
    ['VES', 'Bolivar Soberano', 'Bs.S', 2], ['VND', 'Dong', '₫', 0], ['VUV', 'Vatu', 'VT', 0],
    ['WST', 'Tala', 'WS$', 2], ['XAF', 'CFA Franc BEAC', 'FCFA', 0], ['XCD', 'East Caribbean Dollar', 'EC$', 2],
    ['XCG', 'Caribbean Guilder', 'Cg', 2], ['XOF', 'CFA Franc BCEAO', 'CFA', 0], ['XPF', 'CFP Franc', '₣', 0],
    ['YER', 'Yemeni Rial', '﷼', 2], ['ZAR', 'Rand', 'R', 2], ['ZMW', 'Zambian Kwacha', 'ZK', 2],
    ['ZWG', 'Zimbabwe Gold', 'ZiG', 2],
];

export interface CurrencyDefault {
    code: string;
    name: string;
    symbol: string;
    decimals: number;
    usedInAfrica: boolean;
}

const AFRICAN_CURRENCY_CODES = new Set(AFRICAN_COUNTRIES.map((c) => c.currencyCode));

export const CURRENCIES: CurrencyDefault[] = CURRENCY_ROWS.map(([code, name, symbol, decimals]) => ({
    code,
    name,
    symbol,
    decimals,
    usedInAfrica: AFRICAN_CURRENCY_CODES.has(code),
}));

export interface MetaListDefault {
    key: string;
    title: string;
    appliesTo: string;
    items: Array<{ code: string; label: string; categoryCode?: string; isicSection?: string; description?: string; active?: boolean }>;
}

function slug(label: string): string {
    return label
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function metaList(key: string, title: string, appliesTo: string, labels: string[]): MetaListDefault {
    return { key, title, appliesTo, items: labels.map((label) => ({ code: slug(label), label })) };
}

export const METADATA_LISTS: MetaListDefault[] = [
    {
        key: 'industryCategories', title: 'Industry categories — ISIC Rev.5 section-aligned',
        appliesTo: 'organization', items: INDUSTRY_CATEGORIES,
    },
    {
        key: 'industries', title: 'Industry subcategories — MEMS global master',
        appliesTo: 'organization', items: INDUSTRY_SUBCATEGORIES,
    },
    metaList('companySizes', 'Company size', 'organization', [
        'Micro (1-9 employees)', 'Small (10-49 employees)', 'Medium (50-249 employees)',
        'Large (250-999 employees)', 'Enterprise (1000+ employees)',
    ]),
    metaList('legalEntityTypes', 'Legal entity type', 'organization', [
        'Sole proprietorship', 'Partnership', 'Limited liability partnership', 'Private limited company',
        'Public limited company', 'Cooperative', 'State-owned enterprise', 'Non-profit organization',
        'Branch of a foreign company', 'Other',
    ]),
    metaList('annualTurnover', 'Annual turnover (USD)', 'organization', [
        'Under 50,000', '50,000 - 250,000', '250,000 - 1 million', '1 - 10 million', 'Over 10 million',
    ]),
    metaList('fiscalYearStart', 'Financial year starts', 'organization', [
        'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
        'November', 'December',
    ]),
    metaList('dateFormats', 'Date format', 'organization', ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
    metaList('userRoles', 'User role', 'user', [
        'Organization admin', 'Production manager', 'Supervisor', 'Operator', 'Storekeeper',
        'Procurement officer', 'Sales officer', 'Accountant', 'Quality controller', 'Viewer',
    ]),
    metaList('departments', 'Department', 'user', [
        'Management', 'Production', 'Stores and inventory', 'Procurement', 'Sales and distribution',
        'Finance and accounts', 'Quality assurance', 'Maintenance', 'Human resources', 'Logistics',
        'Information technology',
    ]),
    metaList('titles', 'Title', 'user', ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Eng']),
    metaList('identityDocumentTypes', 'Identity document type', 'user', ['National ID card', 'Passport', 'Alien or resident ID', 'Driving licence']),
    metaList('languages', 'Preferred language', 'user', [
        'English', 'French', 'Portuguese', 'Arabic', 'Swahili', 'Amharic', 'Hausa', 'Yoruba', 'Igbo',
        'isiZulu', 'Afrikaans', 'Somali', 'Kinyarwanda', 'Spanish',
    ]),
];

export const PUBLIC_EMAIL_DOMAINS: string[] = [
    // Global webmail
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.fr', 'yahoo.de',
    'yahoo.es', 'yahoo.it', 'yahoo.ca', 'yahoo.com.au', 'yahoo.com.br', 'yahoo.co.jp', 'yahoo.co.za',
    'yahoo.com.ng', 'yahoo.com.gh', 'ymail.com', 'rocketmail.com', 'hotmail.com', 'hotmail.co.uk',
    'hotmail.fr', 'hotmail.de', 'hotmail.it', 'hotmail.es', 'hotmail.ca', 'outlook.com', 'outlook.fr',
    'outlook.de', 'outlook.es', 'outlook.it', 'outlook.co.uk', 'live.com', 'live.co.uk', 'live.fr',
    'live.de', 'live.ca', 'live.co.za', 'msn.com', 'passport.com', 'windowslive.com', 'icloud.com',
    'me.com', 'mac.com', 'aol.com', 'aol.co.uk', 'aim.com',
    // Privacy-focused
    'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me', 'tutanota.com', 'tutanota.de', 'tutamail.com',
    'tuta.io', 'tuta.com', 'posteo.de', 'posteo.net', 'mailbox.org', 'disroot.org', 'riseup.net',
    'startmail.com', 'mailfence.com', 'kolabnow.com', 'countermail.com', 'skiff.com', 'duck.com',
    'simplelogin.com', 'anonaddy.com', 'hushmail.com', 'hush.com', 'runbox.com', 'fastmail.com',
    'fastmail.fm', 'hey.com',
    // Mail.com / GMX family
    'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch', 'gmx.fr', 'gmx.co.uk', 'mail.com', 'email.com',
    'usa.com', 'post.com', 'consultant.com', 'engineer.com', 'myself.com', 'dr.com', 'techie.com',
    // Other global providers
    'zoho.com', 'zohomail.com', 'zohomail.eu', 'yandex.com', 'yandex.ru', 'yandex.ua', 'ya.ru', 'mail.ru',
    'inbox.ru', 'list.ru', 'bk.ru', 'rambler.ru', 'lycos.com', 'excite.com', 'inbox.com', 'mail.ee',
    'gawab.com', 'myway.com',
    // Asia
    'rediffmail.com', 'rediff.com', 'sify.com', 'indiatimes.com', 'qq.com', '163.com', '126.com',
    'yeah.net', 'sina.com', 'sina.cn', 'sohu.com', 'aliyun.com', '139.com', '189.cn', 'naver.com',
    'daum.net', 'hanmail.net', 'nate.com',
    // Europe ISPs
    'web.de', 't-online.de', 'freenet.de', 'arcor.de', 'online.de', 'orange.fr', 'wanadoo.fr', 'free.fr',
    'laposte.net', 'sfr.fr', 'neuf.fr', 'bbox.fr', 'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it',
    'tin.it', 'btinternet.com', 'sky.com', 'talktalk.net', 'virginmedia.com', 'ntlworld.com',
    'blueyonder.co.uk', 'sapo.pt', 'seznam.cz', 'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl', 'abv.bg',
    'mail.bg', 'ukr.net', 'i.ua',
    // Americas & Oceania ISPs
    'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'comcast.net', 'charter.net', 'cox.net',
    'earthlink.net', 'juno.com', 'netzero.net', 'optonline.net', 'frontier.com', 'shaw.ca', 'rogers.com',
    'sympatico.ca', 'telus.net', 'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'xtra.co.nz',
    'terra.com.br', 'uol.com.br', 'bol.com.br', 'ig.com.br', 'globo.com',
    // Africa ISPs / public mail
    'mweb.co.za', 'telkomsa.net', 'webmail.co.za', 'vodamail.co.za', 'iafrica.com', 'afrihost.co.za',
    'lantic.net', 'menara.ma', 'ethionet.et', 'africamail.com',
    // Disposable / temporary
    'yopmail.com', 'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'temp-mail.org',
    'sharklasers.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
    'throwawaymail.com', 'mohmal.com', 'mailnesia.com', 'emailondeck.com', 'tempmail.com',
    'fakeinbox.com', 'spamgourmet.com', 'mintemail.com',
];
