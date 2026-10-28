/**
 * Plain-language descriptions for catalogue attributes that only carry a generic text ("X technical specification",
 * "X for this service. Yes or no.", or a few words). Each description says what to enter and where a person who is
 * not a specialist finds it. Attributes that already have a proper description are left alone.
 */
import type { Kind } from './types';

type Obj = Record<string, any>;
const norm = (s: string) => String(s ?? '').trim().toLowerCase();

// ---------------------------------------------------------------------------------------------- services
const SERVICE: Record<string, string> = {
    'inspection method': 'How the work or item is checked before acceptance — visual, functional, dimensional, NDT, laboratory or remote. Choose what your acceptance criteria need.',
    'inspection standard': 'Standard or procedure the inspection follows, so every provider checks the same way (e.g. API 510, ISO 2859-1 sampling, OEM inspection checklist rev C).',
    'inspection report required': 'Yes if the provider must hand over a signed inspection report before the job is accepted and paid.',
    'functional test required': 'Yes if the equipment must be run and shown to work (with readings recorded) before acceptance.',
    'parts included': 'Yes if the price includes spare parts; No if parts are charged separately or issued from your stores.',
    'professional qualification required': 'Yes if the people doing the work must hold a professional qualification (state which under licence / accreditation).',
    'required license or accreditation': 'Licence, registration or accreditation the provider must hold (e.g. EPRA A1, NCA 4, NEMA licence, ISO/IEC 17025). Check the certificate before ordering.',
    'confidentiality requirement': 'Yes if the provider will see confidential information and must sign a non-disclosure agreement first.',
    'review and signoff required': 'Yes if your responsible person must review and sign the deliverable before it counts as delivered.',
    'materials supplied by': 'Who provides the materials used in the work: you (client), the contractor, or shared. Decide it now to avoid disputes on the invoice.',
    'equipment type': 'Kind of equipment the work is on (e.g. centrifugal pump, air compressor, filler). Put make, model and tag in Equipment identification.',
    'maintenance activity': 'What is being done: inspection, preventive maintenance, repair, overhaul, replacement, condition monitoring or commissioning.',
    'shutdown required': 'Yes if the equipment or line must be stopped for the work — production planning must agree the window.',
    'test report required': 'Yes if test results (values measured, limits, pass/fail) must be handed over with the job.',
    'audit scope': 'Sites, processes, periods or systems the audit covers (e.g. Plant A production and warehouse, FY 2026).',
    'audit criteria': 'What the audit is measured against: standard clauses, policies, contract or law (e.g. ISO 22000:2018 clauses 4–10).',
    'formal report required': 'Yes if a formal written report (findings, evidence, recommendations) must be delivered.',
    origin: 'Where the goods or people are collected: site name and address or port / airport.',
    destination: 'Where the goods or people are delivered: site name and address or port / airport.',
    'service frequency': 'How often the service is performed (one-off, daily, weekly, monthly, quarterly or on demand).',
    'rental period': 'Length of the hire in the period unit below (e.g. 14 days).',
    'operator included': 'Yes if the hire includes a trained, certified operator; No for bare (dry) hire.',
    'target platform': 'Where the software must run — web, Android, iOS, Windows, cloud… Tick all that apply.',
    environment: 'Which system environment the work is for — development, test, staging or live production.',
    'support sla': 'Support hours and response / fix times promised (e.g. 8×5, P1 response 1 h, fix 4 h).',
    'data sensitivity': 'Most sensitive data the provider will handle. Confidential or restricted data needs a data-processing agreement and security checks.',
    'waste or emission stream': 'Waste or emission concerned (e.g. used oil, sludge, boiler stack gas), with EWC code if known.',
    'hazardous material involved': 'Yes if hazardous substances are handled — the provider must supply SDS, trained staff and correct PPE.',
    'disposal certificate required': 'Yes if a certificate of lawful disposal (NEMA) must be returned for each consignment.',
    'regulatory permit required': 'Yes if a permit is needed before the work (e.g. NEMA, county, WRA, KCAA); say who obtains it.',
    'work location': 'Site, building and area where the work is done.',
    'bill of quantities required': 'Yes if prices must be given against a bill of quantities so tenders compare item by item.',
    'completion certificate required': 'Yes if a completion / practical-completion certificate must be issued before final payment.',
    'assessment included': 'Yes if trainees are assessed (test or practical) and results reported.',
    duration: 'Expected length of the service in hours.',
    'deliverable specification': 'What exactly you will receive (content, format, number of copies), so acceptance is clear.',
    'acceptance testing required': 'Yes if formal acceptance tests (FAT / SAT / UAT) must be passed before acceptance.',
    'handover documentation required': 'Yes if manuals, as-built drawings, certificates and spare-parts lists must be handed over.',
    'rental period unit': 'Unit of the rental period (hour, day, week, month or year).',
    'maintenance included': 'Yes if maintenance of the hired equipment is included in the rental price.',
    'engineering discipline': 'Engineering disciplines involved — tick all that apply.',
    'design stage': 'Stage of design required: concept, feasibility, basic, detailed, as-built or independent review.',
    'applicable design code': 'Code the design must comply with (e.g. Eurocode 2, ASME B31.3, IEC 60364, Kenya Building Code).',
    'drawing deliverables': 'Yes if drawings are part of the deliverable — say formats under Drawing / model format.',
    'participant count': 'Number of people attending or covered.',
    'consignment type': 'What is shipped and how it is packed (e.g. 20 pallets of cartons, 1 × 40 ft container, loose machinery).',
    'proof of delivery required': 'Yes if the driver must return a signed (or photo / e-POD) proof of delivery before invoicing.',
    'treatment method': 'How waste, water or a pest is treated (e.g. incineration, biological treatment, fumigation with phosphine).',
    'area or quantity': 'Quantity of work in the work unit (e.g. 250 m², 40 m, 12 items).',
    'chemical safety documentation required': 'Yes if SDS and chemical risk assessments must be supplied for every chemical used on site.',
    'work extent': 'How much work: inspection only, minor repair, major repair, full overhaul or rebuild.',
    'work quantity': 'Quantity of work in the work unit.',
    'work unit': 'Unit for the work quantity (m, kg, tonne, item, lot, day).',
    'site access constraints': 'Restrictions the provider must plan for — access hours, height or weight limits, escorts, clean zones.',
    'commissioning included': 'Yes if start-up, testing and handover in working order are included.',
    'transport mode': 'How the goods move: road, rail, air, sea, inland waterway or multimodal.',
    'cargo type': 'Nature of the cargo (general, fragile, perishable, dangerous goods class, out-of-gauge).',
    weight: 'Gross weight of the consignment in kg, from the packing list.',
    'temperature controlled': 'Yes if the cargo must stay in a temperature range — give the range in the scope (e.g. 2–8 °C).',
    'clinical service type': 'Type of clinical service: diagnostic, therapeutic, preventive, rehabilitation or emergency.',
    'licensed provider required': 'Yes — the facility and practitioners must hold current licences (KMPDC, NCK, PPB).',
    'patient count': 'Number of patients or employees to be seen.',
    'clinical report required': 'Yes if a clinical report must be returned (respect patient confidentiality).',
    'training format': 'Classroom, virtual instructor-led, self-paced, on-the-job or blended.',
    'certificate included': 'Yes if each participant receives a certificate of attendance or competence.',
    'cleaning area': 'Floor area to be cleaned in m² (measure or take from the floor plan).',
    'cleaning chemicals included': 'Yes if the provider supplies chemicals and consumables; they must be approved for your site.',
    'food contact area': 'Yes if the area or equipment touches food — only food-safe chemicals and methods are allowed.',
    'coverage period': 'When the service must be available: business hours, 12-hour shift, 24/7, event-only or on demand.',
    'number of personnel': 'Number of people the provider must deploy per shift.',
    'response time target': 'Maximum minutes from call to arrival / response.',
    'security license required': 'Yes — guards and the company must hold PSRA licences.',
    'delivery method': 'How it is delivered: in person, virtual, hybrid, self-paced or on the job.',
    'meal or service type': 'Meals or services to be provided — tick all that apply.',
    'number of servings': 'Number of meals / portions per service.',
    'dietary requirements': 'Special diets the caterer must cover — tick all that apply.',
    'fuel included': 'Yes if fuel is included in the hire price; No if you refuel or are charged per litre.',
    'insurance included': 'Yes if the hire price includes insurance of the equipment; state the excess under scope.',
    'delivery and collection included': 'Yes if transport to and from your site is in the price.',
    'measurement range': 'Range the instrument is used over (e.g. 0–16 bar, −20 to 150 °C) — calibrate across this range.',
    'calibration points': 'Number of points checked across the range (5 is common: 0, 25, 50, 75, 100 %).',
    'traceability standard': 'Chain of traceability required (e.g. traceable to national standards via KEBS / ISO/IEC 17025 accredited lab).',
    'certificate required': 'Yes if a certificate must be issued for the work (calibration, test, inspection or competence).',
    'insurance requirements': 'Insurance the provider must hold — ask for current certificates before work starts.',
    'withholding tax applicable': 'Yes if withholding tax is deducted from payments (professional, management, contractual fees). Finance confirms the rate.',
};
const SERVICE_BY_TYPE: Record<string, (n: string, u?: string) => string> = {
    boolean: (n) => `Yes if ${n.toLowerCase()} applies to this service — it becomes part of the order and is checked when the service is accepted.`,
    text: (n) => `${n}: describe it in plain words so every provider quotes the same thing.`,
    enum: (n) => `${n}: choose the option that fits this service.`,
    multi_select: (n) => `${n}: tick everything that applies to this service.`,
    integer: (n, u) => `${n} as a whole number${u ? ` (${u})` : ''}.`,
    decimal: (n, u) => `${n} as a number${u ? ` in ${u}` : ''}.`,
};

// ---------------------------------------------------------------------------------------------- materials
const MATERIAL_RULES: Array<[RegExp, (a: Obj) => string]> = [
    [/^(applicable technical standard|standard edition or revision|specification or standard reference|technical specification or standard reference)$/, () => 'Standard or specification the item conforms to, with its edition (e.g. ISO 3601-1:2012, DIN 625, ASTM A105). Printed on the label, datasheet or certificate. Leave empty if the item is ordered by maker’s part number only.'],
    [/^(nominal size or capacity designation|size or grade designation|size or capacity|size|capacity or rating)$/, () => 'The size or rating that is printed on the item or its label (e.g. 6205, M10 × 40, DN50 PN16, 20 L). Copy it exactly.'],
    [/^variant, configuration and revision$/, () => 'Version, variant or revision letter when the maker sells several (e.g. “-2RS”, rev C, version 2). Copy from the label or drawing.'],
    [/^(design or drawing reference|drawing or specification revision)$/, () => 'Drawing or specification number with revision when the item is made to a drawing (e.g. DRG-1043 rev B).'],
    [/^dimensional tolerances$/, () => 'Only for parts made to drawing: critical tolerances (e.g. bore Ø40 H7). Take them from the drawing.'],
    [/^(functional performance specification|primary technical specification|performance rating)$/, () => 'Main performance value that identifies the item, with unit (e.g. 5.5 kW, 10 µm, 25 bar). From the datasheet or nameplate.'],
    [/^(material grade or chemical composition|material grade|material or composition|material|chemical composition|tool material|sheath material|body material)$/, () => 'Material or grade as stated on the datasheet, certificate or label (e.g. AISI 316L, EPDM, PA6-GF30, HSS-Co). If unsure, ask the supplier quoting the part number.'],
    [/^(interface or connection compatibility|electrical mechanical and fluid interfaces|connection interface|connector type|interface standard|closure compatibility)$/, () => 'How the item connects to what it fits — thread, flange, plug, neck finish or bus (e.g. G½" BSP, M12 4-pin, 38 mm PCO 1881). Check the existing installation.'],
    [/^environmental operating envelope$/, () => 'Conditions the item must survive (temperature range, IP rating, hazardous area). From the datasheet.'],
    [/^(regulatory and certification requirements|food contact registration|food grade certification|regulatory device classification)$/, () => 'Certificates or registrations the item must have (e.g. NSF H1, EU 10/2011, KEBS, ATEX, PPB registration). Ask the supplier for the certificate.'],
    [/^unit of issue and package quantity$/, () => 'How the item is issued and packed (e.g. each; box of 100; drum of 200 L). From the supplier price list.'],
    [/^interchangeability evidence$/, () => 'Proof that an alternative fits (cross-reference list, OEM approval, test report). Needed only when buying a non-original equivalent.'],
    [/^(safety and hazardous area classification|hazard classification)$/, () => 'Hazard class from the SDS (GHS pictograms) or Ex marking for hazardous areas (e.g. Ex db IIC T4).'],
    [/^software firmware or protocol compatibility$/, () => 'Firmware version or protocol the item must support (e.g. FW ≥ V2.1, PROFINET, Modbus RTU). From the device label or engineering software.'],
    [/^test method and acceptance tolerance$/, () => 'How the item is checked at receipt and what is acceptable (e.g. CoA within spec; dimensional check ±0.1 mm).'],
    [/^shelf life and storage constraints$/, () => 'Shelf life and how to store it (e.g. 24 months, keep below 25 °C, away from sunlight). Printed on the pack or SDS.'],
    [/^applicable regional market specification$/, () => 'Market-specific version needed (e.g. 230 V / 50 Hz, UK plug, Kenyan KEBS mark).'],
    [/^standard material description$/, () => 'Short standard text for the item (type, main size, material) as the supplier would recognise it.'],
    [/^(compatibility or application)$/, () => 'Machine, equipment or use this item is for (make / model or line). Helps the next buyer pick the same part.'],
    [/temperature/, (a) => `${a.name}${a.unit ? ` in ${a.unit}` : ' in °C'}, from the datasheet or label.`],
    [/pressure/, (a) => `${a.name}${a.unit ? ` in ${a.unit}` : ' in bar'}, from the nameplate or datasheet.`],
    [/voltage/, (a) => `${a.name}${a.unit ? ` in ${a.unit}` : ' in V'}, as printed on the label.`],
    [/current/, (a) => `${a.name}${a.unit ? ` in ${a.unit}` : ' in A'}, from the nameplate.`],
    [/(length|width|thickness|diameter|pitch)/, (a) => `${a.name}${a.unit ? ` in ${a.unit}` : ''}. Read it from the label or drawing, or measure the old part with a calliper or tape.`],
    [/(volume|size|capacity|weight|mass)/, (a) => `${a.name}${a.unit ? ` in ${a.unit}` : ''}, as printed on the pack or label.`],
];
const MATERIAL_FALLBACK = (a: Obj) => `${a.name}${a.unit ? ` (${a.unit})` : ''}: copy it from the label, datasheet or previous purchase order${a.dataType === 'enum' ? ' and pick the matching option' : ''}. If unsure, ask the supplier quoting the maker’s part number.`;

// ---------------------------------------------------------------------------------------------- assets
const ASSET_WHERE: Record<string, string> = {
    IDN: 'Copy it from the nameplate, invoice, logbook or registration document.',
    MNT: 'Take it from the maintenance plan, OEM manual or CMMS.',
    FIN: 'Finance sets it from the fixed-asset policy.',
    PHY: 'Measure it, or read it from the drawing or datasheet.',
    BLD: 'From the approved building plans, as-built drawings or occupation certificate.',
    LND: 'From the title deed, lease or survey plan.',
    CIV: 'From the design report or as-built drawings.',
    ICT: 'From the device label, system information or vendor portal.',
    SFT: 'From the licence certificate, order or contract.',
    INT: 'From the registration certificate or agreement.',
    BIO: 'From the herd, flock or plantation register.',
    MED: 'From the device label, user manual or PPB registration.',
    LAB: 'From the instrument label, manual or qualification report.',
    SAF: 'From the equipment label, commissioning certificate or service record.',
    ENV: 'From the design report, licence or permit.',
    FUR: 'Check the item or the supplier invoice.',
    CMR: 'From the equipment label or placement agreement.',
    MIN: 'From the licence or equipment datasheet.',
};
const ASSET_TECH = 'Read it from the nameplate or the maker’s datasheet — do not estimate.';

export function describeExisting(kind: Kind, a: Obj): void {
    const desc = String(a.description ?? '');
    const n = norm(a.name);
    if (kind === 'services') {
        if (!/for this service\.\s*(yes or no|free text|choose one option|choose all that apply|number|whole number)\.?$/i.test(desc)) return;
        a.description = SERVICE[n] ?? (SERVICE_BY_TYPE[a.dataType] ?? SERVICE_BY_TYPE.text)(a.name, a.unit);
        return;
    }
    if (kind === 'materials') {
        if (!/technical specification$|record explicit value, standard, tolerance and revision/i.test(desc)) return;
        const rule = MATERIAL_RULES.find(([re]) => re.test(n));
        a.description = rule ? rule[1](a) : MATERIAL_FALLBACK(a);
        return;
    }
    // assets: short descriptions get a where-to-find hint
    if (desc.length >= 60 || /copy it from|read it from|from the /i.test(desc)) return;
    const hint = ASSET_WHERE[a.domain] ?? ASSET_TECH;
    a.description = `${desc ? desc.replace(/\s*$/, '').replace(/([^.])$/, '$1.') + ' ' : ''}${hint}`;
}
