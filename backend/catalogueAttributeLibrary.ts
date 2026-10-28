/**
 * MEMS catalogue attribute library.
 *
 * Uploaded catalogues (materials, services, asset classes) often carry only generic attributes. This library
 * adds the attributes that make one item different from another of the same kind, e.g. for an electric motor:
 * rated power, voltage, frequency, poles, frame size, mounting, IP and efficiency class. It is applied when a
 * catalogue is read: attributes the catalogue already defines are kept (and never duplicated); library
 * attributes are added with source "MEMS_LIBRARY". Mandatory attributes are the minimum needed to buy the
 * right item; everything else is optional but recommended.
 *
 * Plain language rule: every attribute says where to find the value (nameplate, packaging, datasheet) and
 * gives an example, so a person who is not a subject-matter expert can complete it without guessing.
 */

export type LibKind = 'materials' | 'services' | 'assets';
export type LibDataType = 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'enum' | 'multi_select' | 'country';
export interface LibOption { code: string; label: string }
export interface LibAttribute {
    code: string;
    name: string;
    dataType: LibDataType;
    unit?: string;
    domain: LibDomain;
    description: string;
    example?: string;
    options?: LibOption[];
    validation?: { minimum?: number; maximum?: number; maxLength?: number; pattern?: string };
    /** Other names a catalogue may already use for the same attribute (prevents duplicates). */
    aliases?: string[];
}
export type LibDomain = 'IDENTITY' | 'RATING' | 'DIMENSION' | 'MATERIAL' | 'ENVIRONMENT' | 'CONNECTION' | 'COMPLIANCE' | 'SERVICE' | 'PACK';
export const LIB_DOMAINS: Record<LibDomain, string> = {
    IDENTITY: 'Identification & supply',
    RATING: 'Ratings & performance',
    DIMENSION: 'Size & dimensions',
    MATERIAL: 'Materials & construction',
    ENVIRONMENT: 'Protection & environment',
    CONNECTION: 'Mounting & connections',
    COMPLIANCE: 'Standards & certification',
    SERVICE: 'Service scope & requirements',
    PACK: 'Packaging & storage',
};
export const LIB_SOURCE = 'MEMS_LIBRARY';
export const libDomainCode = (d: LibDomain) => 'MEMS.LIB.' + d;

// ---------------------------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------------------------
const POOL = new Map<string, LibAttribute>();
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const opts = (list: Array<string | [string, string]>): LibOption[] =>
    list.map((o) => (Array.isArray(o) ? { code: o[0], label: o[1] } : { code: slug(o) || o, label: o }));
/** Where a non-specialist finds the value, added to short descriptions so nobody has to guess. */
const WHERE: Record<LibDomain, string> = {
    IDENTITY: 'Copy it from the nameplate, label, box or old purchase order.',
    RATING: 'Read it from the nameplate, label or datasheet — do not estimate.',
    DIMENSION: 'Read it from the label or drawing, or measure the old part (calliper or tape).',
    MATERIAL: 'Shown on the datasheet, label or old order. If unsure, ask the supplier using the part number.',
    ENVIRONMENT: 'Marked on the nameplate or datasheet; choose for the area where it is installed.',
    CONNECTION: 'Check the existing installation or the datasheet so the new item fits without changes.',
    COMPLIANCE: 'Stated on the certificate, datasheet or marking. Ask the supplier for the certificate.',
    SERVICE: 'Agree this with the provider before the order is placed; it is part of the acceptance check.',
    PACK: 'Printed on the packaging or the supplier’s price list.',
};
function def(code: string, a: Omit<LibAttribute, 'code'>): string {
    const full = 'MEMS.' + code;
    if (POOL.has(full)) throw new Error('Duplicate library attribute ' + full);
    const description = a.description.length < 60 ? a.description + ' ' + WHERE[a.domain] : a.description;
    POOL.set(full, { code: full, ...a, description });
    return full;
}
const text = (code: string, name: string, domain: LibDomain, description: string, example?: string, maxLength = 120) =>
    def(code, { name, dataType: 'text', domain, description, example, validation: { maxLength } });
const dec = (code: string, name: string, unit: string, domain: LibDomain, description: string, example?: string, min = 0, max?: number) =>
    def(code, { name, dataType: 'decimal', unit, domain, description, example, validation: { minimum: min, ...(max !== undefined ? { maximum: max } : {}) } });
const int = (code: string, name: string, unit: string, domain: LibDomain, description: string, example?: string, min = 0, max?: number) =>
    def(code, { name, dataType: 'integer', unit, domain, description, example, validation: { minimum: min, ...(max !== undefined ? { maximum: max } : {}) } });
const pick = (code: string, name: string, domain: LibDomain, description: string, list: Array<string | [string, string]>, unit?: string) =>
    def(code, { name, dataType: 'enum', domain, description, options: opts(list), ...(unit ? { unit } : {}) });
const many = (code: string, name: string, domain: LibDomain, description: string, list: Array<string | [string, string]>) =>
    def(code, { name, dataType: 'multi_select', domain, description, options: opts(list) });
const yes = (code: string, name: string, domain: LibDomain, description: string) => def(code, { name, dataType: 'boolean', domain, description });
function alias(code: string, names: string[]) {
    const a = POOL.get(code);
    if (a) a.aliases = [...(a.aliases ?? []), ...names];
}

// ---------------------------------------------------------------------------------------------------------------
// Shared pick-lists
// ---------------------------------------------------------------------------------------------------------------
const IP = ['IP20', 'IP21', 'IP23', 'IP44', 'IP54', 'IP55', 'IP56', 'IP65', 'IP66', 'IP67', 'IP68', 'IP69K'];
const AC_VOLTAGE: Array<[string, string]> = [['V230_1PH', '230 V single-phase'], ['V230', '230 V three-phase'], ['V380', '380 V'], ['V400', '400 V'], ['V415', '415 V'], ['V440', '440 V'], ['V460', '460 V'], ['V480', '480 V'], ['V525', '525 V'], ['V690', '690 V'], ['V230_400', '230/400 V (Δ/Y)'], ['V400_690', '400/690 V (Δ/Y)'], ['V3300', '3.3 kV'], ['V6600', '6.6 kV'], ['V11000', '11 kV'], ['OTHER', 'Other — state in notes']];
const COIL_VOLTAGE: Array<[string, string]> = [['24VDC', '24 V DC'], ['24VAC', '24 V AC'], ['48VDC', '48 V DC'], ['110VAC', '110 V AC'], ['110VDC', '110 V DC'], ['120VAC', '120 V AC'], ['220VDC', '220 V DC'], ['230VAC', '230 V AC'], ['400VAC', '400 V AC'], ['OTHER', 'Other — state in notes']];
const FREQ: Array<[string, string]> = [['HZ50', '50 Hz'], ['HZ60', '60 Hz'], ['HZ50_60', '50/60 Hz']];
const ELASTOMER: Array<[string, string]> = [['NBR', 'NBR (nitrile) — oil, water, air up to ~100 °C'], ['FKM', 'FKM / Viton — high temperature, fuels, chemicals'], ['EPDM', 'EPDM — hot water, steam, not oil'], ['VMQ', 'Silicone (VMQ) — food, wide temperature, low strength'], ['HNBR', 'HNBR — tougher nitrile, higher temperature'], ['PTFE', 'PTFE (Teflon) — almost all chemicals'], ['FFKM', 'FFKM (Kalrez type) — extreme chemicals and heat'], ['PU', 'Polyurethane (PU/AU) — wear, hydraulics'], ['CR', 'Neoprene (CR)']];
const PRESSURE_CLASS = ['PN6', 'PN10', 'PN16', 'PN25', 'PN40', 'PN63', 'PN100', 'ASME Class 150', 'ASME Class 300', 'ASME Class 600', 'ASME Class 900', 'ASME Class 1500', 'ASME Class 2500'];
const DN = ['DN6 (1/8")', 'DN8 (1/4")', 'DN10 (3/8")', 'DN15 (1/2")', 'DN20 (3/4")', 'DN25 (1")', 'DN32 (1-1/4")', 'DN40 (1-1/2")', 'DN50 (2")', 'DN65 (2-1/2")', 'DN80 (3")', 'DN100 (4")', 'DN125 (5")', 'DN150 (6")', 'DN200 (8")', 'DN250 (10")', 'DN300 (12")', 'DN350 (14")', 'DN400 (16")', 'DN450 (18")', 'DN500 (20")', 'DN600 (24")', 'Other — state in notes'];
const END_CONNECTION = ['Flanged raised face (RF)', 'Flanged ring joint (RTJ)', 'Threaded BSP (G/R)', 'Threaded NPT', 'Socket weld', 'Butt weld', 'Wafer', 'Lug', 'Tri-clamp (sanitary)', 'Grooved (Victaulic type)', 'Compression fitting', 'Push-in'];
const BODY_METAL = ['Cast iron', 'Ductile iron', 'Carbon steel (WCB / A105)', 'Stainless steel 304 / CF8', 'Stainless steel 316 / CF8M', 'Duplex stainless', 'Bronze / gunmetal', 'Brass', 'Aluminium', 'PVC / CPVC', 'Polypropylene (PP)', 'PVDF'];
const SIGNAL_OUT: Array<[string, string]> = [['MA4_20', '4–20 mA'], ['MA4_20_HART', '4–20 mA + HART'], ['V0_10', '0–10 V'], ['PNP', 'Switching PNP'], ['NPN', 'Switching NPN'], ['RELAY', 'Relay contact'], ['IOLINK', 'IO-Link'], ['MODBUS', 'Modbus RTU'], ['PROFIBUS', 'Profibus PA/DP'], ['FIELDBUS', 'Foundation Fieldbus'], ['ETHERNET', 'Industrial Ethernet']];
const EX_PROTECTION: Array<[string, string]> = [['NONE', 'Not for hazardous areas'], ['EX_D', 'Ex d — flameproof (gas)'], ['EX_E', 'Ex e / eb — increased safety (gas)'], ['EX_EC', 'Ex ec / nA — non-sparking, Zone 2'], ['EX_I', 'Ex i — intrinsically safe'], ['EX_T', 'Ex tb / tc — dust'], ['EX_P', 'Ex p — pressurised']];
const FIELDBUS = ['None', 'Modbus RTU', 'Modbus TCP', 'Profibus DP', 'Profinet', 'EtherNet/IP', 'EtherCAT', 'CANopen', 'DeviceNet', 'BACnet', 'IO-Link'];
const PROVIDER_TYPE: Array<[string, string]> = [
    ['OEM', 'OEM — the original equipment maker’s own service (e.g. Siemens services a Siemens drive)'],
    ['OEM_AUTH', 'OEM-authorised partner — certified by the maker, uses genuine parts'],
    ['SPECIALIST', 'Independent specialist — skilled in this equipment type, any make'],
    ['GENERAL', 'General contractor — routine work that needs no maker-specific skills'],
];

// ---------------------------------------------------------------------------------------------------------------
// Attribute pool
// ---------------------------------------------------------------------------------------------------------------
// Identification & supply (common)
const MANUFACTURER = text('MANUFACTURER', 'Manufacturer / brand', 'IDENTITY', 'The company that made the item, as printed on the nameplate, the item or its box.', 'SKF, Siemens, WEG, Grundfos');
const MPN = text('MPN', 'Manufacturer part number (MPN)', 'IDENTITY', 'The maker’s own order or catalogue number. Copy it exactly, including dashes and slashes. If the machine maker (OEM) sells this part under its own number, still record the maker’s number here so it can be bought from other suppliers.', '6205-2RSH/C3', 80);
const MODEL = text('MODEL', 'Model / type designation', 'IDENTITY', 'Model or type code from the nameplate or datasheet.', '1LE1001-1DB23-4AA4', 80);
const SERIAL = text('SERIAL_NO', 'Serial number', 'IDENTITY', 'Unique number of this individual unit, from the nameplate. Each installed unit has its own.', 'SN 2309-11845', 80);
const YEAR = int('YEAR_OF_MANUFACTURE', 'Year of manufacture', '', 'IDENTITY', 'Year the unit was built, from the nameplate.', '2021', 1900, 2100);
const ORIGIN = def('COUNTRY_OF_ORIGIN', { name: 'Country of origin', dataType: 'country', domain: 'IDENTITY', description: 'Where the item was made (on the box or certificate). Needed for import duty and some tenders.' });
const FITS = text('FITS_EQUIPMENT', 'Fits equipment (make / model)', 'IDENTITY', 'The machine this part is used on, so others can find the right spare. Give make and model.', 'Krones Contiform S12 blow moulder', 160);
const STANDARD = text('STANDARD', 'Standard / specification', 'COMPLIANCE', 'The standard the item is made to, if printed or stated on the datasheet.', 'IEC 60034-1, DIN 625, ISO 4017');
const SHELF_LIFE = int('SHELF_LIFE_MONTHS', 'Shelf life', 'months', 'PACK', 'How long the item can be stored before use (rubber, adhesives, chemicals, batteries, lubricants). Leave blank if unlimited.', '24', 0, 600);
const PACK_QTY = int('PACK_QUANTITY', 'Quantity per pack', 'pcs', 'PACK', 'How many pieces come in one pack or box when bought.', '100', 1);
const WEIGHT = dec('WEIGHT_KG', 'Weight', 'kg', 'DIMENSION', 'Net weight of one item. Helps transport and lifting planning.', '42');
const IP_RATING = pick('IP_RATING', 'Ingress protection (IP rating)', 'ENVIRONMENT', 'Protection against dust and water, printed as “IPxx” on the nameplate. IP55 suits most plant areas; IP66+ for wash-down or outdoors.', IP);
const EX = pick('EX_PROTECTION', 'Hazardous-area (Ex) protection', 'ENVIRONMENT', 'Only for areas with flammable gas or dust. Look for an “Ex” marking and ATEX/IECEx certificate number on the nameplate.', EX_PROTECTION);
const AMBIENT = text('AMBIENT_RANGE', 'Operating temperature range', 'ENVIRONMENT', 'Minimum and maximum temperature it is rated for.', '-20 to +40 °C', 40);
const NOTES = text('TECH_NOTES', 'Other technical notes', 'IDENTITY', 'Anything else needed to order the exact item (special version, coating, option codes).', 'Special shaft 38 mm with 10 mm key', 300);

// Electrical ratings
const POWER_KW = dec('RATED_POWER_KW', 'Rated power', 'kW', 'RATING', 'Output power from the nameplate. If it shows HP only, kW = HP × 0.746.', '7.5');
const VOLTAGE = pick('RATED_VOLTAGE', 'Rated voltage', 'RATING', 'Supply voltage from the nameplate. “400/690 V” means delta at 400 V or star at 690 V.', AC_VOLTAGE);
const FREQUENCY = pick('FREQUENCY', 'Frequency', 'RATING', 'Supply frequency. Kenya, Uganda, Tanzania, Nigeria, South Africa use 50 Hz.', FREQ);
const PHASES = pick('PHASES', 'Phases', 'RATING', 'Single-phase (two wires + earth) or three-phase supply.', [['P1', 'Single-phase'], ['P3', 'Three-phase'], ['DC', 'DC']]);
const CURRENT_A = dec('RATED_CURRENT_A', 'Rated current', 'A', 'RATING', 'Full-load current from the nameplate at the rated voltage.', '14.2');
const COIL = pick('COIL_VOLTAGE', 'Coil / control voltage', 'RATING', 'Voltage that operates the coil or control circuit — usually printed on the coil itself.', COIL_VOLTAGE);
const SUPPLY_DC = pick('SUPPLY_VOLTAGE', 'Supply voltage', 'RATING', 'Power supply needed by the device.', [['V10_30DC', '10–30 V DC'], ['V24DC', '24 V DC'], ['V12DC', '12 V DC'], ['V5DC', '5 V DC'], ['V20_250ACDC', '20–250 V AC/DC'], ['V230AC', '230 V AC'], ['LOOP', 'Loop-powered (2-wire 4–20 mA)']]);

// Motors
const POLES = pick('POLES', 'Number of poles (speed)', 'RATING', 'Poles set the speed. On the nameplate read the rpm: ~2900 rpm = 2-pole, ~1450 = 4-pole, ~960 = 6-pole, ~720 = 8-pole (50 Hz).', [['P2', '2-pole (≈ 3000 rpm at 50 Hz)'], ['P4', '4-pole (≈ 1500 rpm)'], ['P6', '6-pole (≈ 1000 rpm)'], ['P8', '8-pole (≈ 750 rpm)'], ['P10', '10-pole or more'], ['MULTI', 'Two-speed / multi-speed']]);
const SPEED_RPM = int('RATED_SPEED_RPM', 'Rated speed', 'rpm', 'RATING', 'Full-load speed from the nameplate.', '1460', 0, 100000);
const FRAME = text('FRAME_SIZE', 'Frame size', 'DIMENSION', 'Frame size from the nameplate. IEC frames are a number plus S/M/L (e.g. 132M); NEMA frames end in T (e.g. 213T). Same frame = same shaft height and fixing holes.', '132M', 20);
const MOUNTING_IM = pick('MOUNTING_ARRANGEMENT', 'Mounting arrangement', 'CONNECTION', 'How the motor is fixed. Foot = bolted on feet; flange = bolted by the front face.', [['B3', 'IM B3 — foot mounted'], ['B5', 'IM B5 — large flange (FF)'], ['B14', 'IM B14 — small face flange (FT)'], ['B35', 'IM B35 — foot + large flange'], ['B34', 'IM B34 — foot + small flange'], ['V1', 'IM V1 — vertical, flange, shaft down'], ['V3', 'IM V3 — vertical, flange, shaft up'], ['OTHER', 'Other — state in notes']]);
const EFFICIENCY = pick('EFFICIENCY_CLASS', 'Efficiency class', 'RATING', 'Energy efficiency class printed on the nameplate (IE1 lowest – IE5 highest). Replace like-for-like or better.', ['IE1', 'IE2', 'IE3', 'IE4', 'IE5', 'NEMA Premium', 'Not stated']);
const INSULATION = pick('INSULATION_CLASS', 'Insulation class', 'RATING', 'Winding temperature class on the nameplate (“Ins. Cl. F”). F is the most common.', ['Class B (130 °C)', 'Class F (155 °C)', 'Class H (180 °C)']);
const DUTY = pick('DUTY_TYPE', 'Duty type', 'RATING', 'How the motor runs. S1 = continuous (most motors). Others are for frequent starting or short-time running.', [['S1', 'S1 — continuous'], ['S2', 'S2 — short-time'], ['S3', 'S3 — intermittent periodic'], ['S4_S10', 'S4–S10 — frequent starts / variable load']]);
const COOLING = pick('COOLING_METHOD', 'Cooling method', 'MATERIAL', 'How the motor is cooled. TEFC (own fan on the back) is the most common.', [['IC411', 'IC411 — totally enclosed, fan cooled (TEFC)'], ['IC416', 'IC416 — separate forced-vent fan'], ['IC410', 'IC410 — no fan (TENV)'], ['IC01', 'IC01 — open drip-proof (ODP)'], ['WATER', 'Water cooled']]);
const SHAFT_D = dec('SHAFT_DIAMETER_MM', 'Shaft diameter', 'mm', 'DIMENSION', 'Diameter of the output shaft.', '38');
const SHAFT_L = dec('SHAFT_LENGTH_MM', 'Shaft extension length', 'mm', 'DIMENSION', 'Length of the shaft sticking out of the motor.', '80');
const BEARING_DE = text('BEARING_DE', 'Drive-end bearing', 'MATERIAL', 'Bearing number at the shaft end (on the nameplate or datasheet). Useful for ordering spares.', '6308-2Z/C3', 40);
const BEARING_NDE = text('BEARING_NDE', 'Non-drive-end bearing', 'MATERIAL', 'Bearing number at the fan end.', '6208-2Z/C3', 40);
const THERMAL_PROT = pick('THERMAL_PROTECTION', 'Winding protection', 'MATERIAL', 'Temperature sensors built into the windings, if any.', [['NONE', 'None'], ['PTC', 'PTC thermistors'], ['PT100', 'PT100 sensors'], ['BIMETAL', 'Bimetal thermal switches (PTO)'], ['KTY', 'KTY sensor']]);
const BRAKE = pick('BRAKE', 'Brake', 'MATERIAL', 'Whether a holding brake is fitted, and its supply.', [['NONE', 'No brake'], ['DC24', 'Brake 24 V DC'], ['DC_RECT', 'Brake via rectifier (AC supply)'], ['OTHER', 'Other — state in notes']]);
const INVERTER_DUTY = yes('INVERTER_DUTY', 'Suitable for variable speed drive (inverter duty)', 'RATING', 'Yes if the datasheet says it can run on a VFD/inverter (reinforced insulation, insulated bearing for large motors).');
const TERMINAL_BOX = pick('TERMINAL_BOX_POSITION', 'Terminal box position', 'CONNECTION', 'Where the cable box sits, looking at the shaft end.', ['Top', 'Right', 'Left', 'Bottom']);

// Gear units
const GEAR_TYPE = pick('GEAR_TYPE', 'Gear type', 'MATERIAL', 'Construction of the gear unit, from the datasheet or nameplate type code.', ['Helical', 'Helical-bevel (right angle)', 'Bevel', 'Worm', 'Helical-worm', 'Planetary', 'Parallel shaft', 'Cycloidal']);
const RATIO = dec('GEAR_RATIO', 'Gear ratio', ': 1', 'RATING', 'Reduction ratio “i” on the nameplate (input speed ÷ output speed).', '28.5', 0.1);
const OUT_SPEED = dec('OUTPUT_SPEED_RPM', 'Output speed', 'rpm', 'RATING', 'Speed of the output shaft, on the nameplate (n2).', '51');
const OUT_TORQUE = dec('OUTPUT_TORQUE_NM', 'Output torque', 'N·m', 'RATING', 'Rated output torque (M2 or Ma) on the nameplate.', '1350');
const SERVICE_FACTOR = dec('SERVICE_FACTOR', 'Service factor', '', 'RATING', 'Safety factor of the gear unit (fB or SF) on the nameplate.', '1.6', 0.1, 10);
const MOUNT_POS = pick('MOUNTING_POSITION', 'Mounting position', 'CONNECTION', 'Orientation the unit is designed for (M1–M6). Wrong position = wrong oil level.', ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'Universal']);
const OUTPUT_SHAFT = pick('OUTPUT_SHAFT', 'Output shaft', 'CONNECTION', 'Type of output.', ['Solid shaft with key', 'Hollow shaft with key', 'Hollow shaft with shrink disc', 'Flange output', 'Splined shaft']);
const INPUT_TYPE = pick('INPUT_TYPE', 'Input', 'CONNECTION', 'How power goes in.', ['Integral motor (gear motor)', 'IEC motor adapter flange', 'NEMA C-face adapter', 'Solid input shaft']);
const OIL_SPEC = text('OIL_SPECIFICATION', 'Oil type and quantity', 'MATERIAL', 'Oil grade and fill quantity on the nameplate.', 'ISO VG 220 mineral, 4.6 L', 80);

// Servo, DC
const TORQUE_RATED = dec('RATED_TORQUE_NM', 'Rated (continuous) torque', 'N·m', 'RATING', 'Continuous torque M0 / Mn from the nameplate.', '8.2');
const TORQUE_PEAK = dec('PEAK_TORQUE_NM', 'Peak torque', 'N·m', 'RATING', 'Maximum short-time torque.', '24');
const ENCODER_FB = pick('FEEDBACK_DEVICE', 'Feedback device', 'CONNECTION', 'Position sensor built into the motor.', ['Resolver', 'Incremental encoder', 'Absolute single-turn encoder', 'Absolute multi-turn encoder', 'Hiperface DSL / single-cable', 'None']);
const DC_FIELD = pick('DC_FIELD_TYPE', 'Field type', 'MATERIAL', 'How the DC motor field is excited.', ['Shunt (separately excited)', 'Series', 'Compound', 'Permanent magnet']);

// Drives & switchgear
const DRIVE_INPUT = pick('DRIVE_INPUT', 'Input supply', 'RATING', 'Mains supply the drive connects to.', [['1X230', '1-phase 230 V'], ['3X230', '3-phase 230 V'], ['3X400', '3-phase 380–480 V'], ['3X690', '3-phase 525–690 V'], ['DC', 'DC bus']]);
const DUTY_RATING = pick('OVERLOAD_DUTY', 'Duty / overload rating', 'RATING', 'Normal duty for pumps and fans; heavy duty for conveyors, crushers, hoists.', [['ND', 'Normal duty (≈110% overload)'], ['HD', 'Heavy duty (≈150% overload)']]);
const CONTROL_MODE = pick('CONTROL_MODE', 'Control mode', 'RATING', 'Motor control method supported or required.', ['V/f (scalar)', 'Sensorless vector', 'Closed-loop vector (encoder)', 'Servo']);
const COMMS = many('COMMUNICATION', 'Communication', 'CONNECTION', 'Network the device must connect to — check what the PLC or other drives use.', FIELDBUS);
const EMC = yes('EMC_FILTER', 'Built-in EMC filter', 'COMPLIANCE', 'Yes if the drive includes an EMC/RFI filter.');
const BRAKE_CHOPPER = yes('BRAKE_CHOPPER', 'Built-in braking chopper', 'RATING', 'Needed for fast stopping or lowering loads with a braking resistor.');
const STO = yes('SAFE_TORQUE_OFF', 'Safe Torque Off (STO)', 'COMPLIANCE', 'Safety function input on the drive.');
const DEVICE_FRAME = text('DEVICE_FRAME', 'Frame / size code', 'DIMENSION', 'Housing size code from the type code (e.g. FS2, Frame C).', 'FSB', 20);
const AC3_CURRENT = dec('AC3_CURRENT_A', 'Rated operational current (AC-3)', 'A', 'RATING', 'Motor switching current at 400 V, printed as Ie or AC-3 on the side.', '25');
const AC3_KW = dec('AC3_POWER_KW', 'Motor rating at 400 V (AC-3)', 'kW', 'RATING', 'Largest motor it can switch at 400 V.', '11');
const POLES_SW = pick('SWITCH_POLES', 'Number of poles', 'CONNECTION', 'Number of switched conductors.', ['1P', '1P+N', '2P', '3P', '3P+N', '4P']);
const AUX = text('AUX_CONTACTS', 'Auxiliary contacts', 'CONNECTION', 'Extra signal contacts (NO = normally open, NC = normally closed).', '1NO + 1NC', 20);
const DIN_MOUNT = pick('DEVICE_MOUNTING', 'Mounting', 'CONNECTION', 'How it is fixed in the panel.', ['DIN rail 35 mm', 'Screw / base plate', 'Plug-in', 'Withdrawable', 'Door / panel cut-out']);
const BREAKER_TYPE = pick('BREAKER_TYPE', 'Breaker type', 'MATERIAL', 'MCB = small DIN-rail; MCCB = moulded case (larger); ACB = air circuit breaker (main incomer); RCBO/RCCB = earth-leakage protection.', ['MCB', 'MCCB', 'ACB', 'RCBO', 'RCCB', 'Motor protection circuit breaker (MPCB)']);
const IN_A = dec('NOMINAL_CURRENT_A', 'Rated current (In)', 'A', 'RATING', 'Current rating printed on the front (e.g. C16 = 16 A).', '16');
const ICU = dec('BREAKING_CAPACITY_KA', 'Breaking capacity (Icu / Icn)', 'kA', 'RATING', 'Short-circuit rating printed on the front (e.g. 6000 = 6 kA, 36 kA).', '10');
const TRIP_CURVE = pick('TRIP_CURVE', 'Trip curve / characteristic', 'RATING', 'Letter before the current on an MCB. B = lighting/sockets, C = general, D = motors/transformers.', ['B', 'C', 'D', 'K', 'Z', 'Thermal-magnetic (MCCB)', 'Electronic trip unit']);
const RESIDUAL = pick('RESIDUAL_CURRENT', 'Residual current sensitivity', 'RATING', 'Earth-leakage trip level (RCD/RCBO only).', ['10 mA', '30 mA', '100 mA', '300 mA', '500 mA', 'Adjustable']);
const SETTING_RANGE = text('SETTING_RANGE_A', 'Current setting range', 'RATING', 'Adjustable range on the dial of an overload relay or MPCB.', '9–14 A', 20);
const FUSE_TYPE = pick('FUSE_CLASS', 'Fuse class', 'RATING', 'Printed on the fuse body. gG = general cables; aM = motors; aR/gR = semiconductor (drives, rectifiers).', ['gG / gL', 'aM', 'aR', 'gR', 'gPV (solar)', 'Class J', 'Class CC', 'Class RK5']);
const FUSE_SIZE = pick('FUSE_SIZE', 'Fuse size', 'DIMENSION', 'Physical size so it fits the holder.', ['8x32', '10x38', '14x51', '22x58', 'NH000', 'NH00', 'NH1', 'NH2', 'NH3', 'D01', 'D02', 'D03', 'DII (E27)', 'DIII (E33)', 'Blade (automotive)', 'Other']);
const RELAY_CONTACTS = text('CONTACT_CONFIGURATION', 'Contact configuration', 'CONNECTION', 'Number and type of contacts (CO = changeover).', '2 CO, 8 A', 30);

// Transformers
const KVA = dec('RATED_POWER_KVA', 'Rated power', 'kVA', 'RATING', 'kVA on the nameplate.', '1000');
const PRIMARY_V = text('PRIMARY_VOLTAGE', 'Primary (HV) voltage', 'RATING', 'High-voltage side on the nameplate.', '11 kV', 20);
const SECONDARY_V = text('SECONDARY_VOLTAGE', 'Secondary (LV) voltage', 'RATING', 'Low-voltage side on the nameplate.', '433 V', 20);
const VECTOR = pick('VECTOR_GROUP', 'Vector group', 'RATING', 'Winding connection on the nameplate. Needed to run transformers in parallel.', ['Dyn11', 'Dyn1', 'Yyn0', 'Dd0', 'YNd11', 'Yd1', 'Single-phase', 'Other']);
const TX_COOLING = pick('TRANSFORMER_COOLING', 'Cooling', 'MATERIAL', 'Cooling code on the nameplate.', ['ONAN (oil, natural)', 'ONAF (oil, fans)', 'AN (dry, natural)', 'AF (dry, fans)', 'KNAN (ester oil)']);
const TX_TYPE = pick('TRANSFORMER_TYPE', 'Construction', 'MATERIAL', 'Oil-filled or dry type.', ['Oil-immersed, hermetically sealed', 'Oil-immersed with conservator', 'Cast resin dry type', 'Vacuum-pressure impregnated dry type']);
const IMPEDANCE = dec('IMPEDANCE_PCT', 'Impedance', '%', 'RATING', 'Short-circuit impedance Uk % on the nameplate.', '6', 0, 30);
const TAPS = pick('TAP_CHANGER', 'Tap changer', 'RATING', 'Voltage adjustment taps.', ['Off-load ±2×2.5%', 'Off-load other', 'On-load (OLTC)', 'None']);

// Cable
const CABLE_TYPE = pick('CABLE_TYPE', 'Cable type', 'MATERIAL', 'What the cable is for.', ['Power', 'Control', 'Instrumentation (screened pairs)', 'Flexible / trailing', 'Welding', 'Data / Ethernet', 'Fibre optic', 'Fire-resistant']);
const CORES = int('CORES', 'Number of cores', '', 'DIMENSION', 'Number of insulated conductors (count the colours; “4C” = 4 cores).', '4', 1, 200);
const CSA = pick('CROSS_SECTION_MM2', 'Conductor size', 'DIMENSION', 'Cross-section of each core in mm², printed on the cable sheath (e.g. 4x16 mm²).', ['0.5', '0.75', '1', '1.5', '2.5', '4', '6', '10', '16', '25', '35', '50', '70', '95', '120', '150', '185', '240', '300', '400', '500', '630'], 'mm²');
const CONDUCTOR = pick('CONDUCTOR_MATERIAL', 'Conductor', 'MATERIAL', 'Metal of the conductor.', ['Copper', 'Tinned copper', 'Aluminium']);
const CABLE_INSULATION = pick('CABLE_INSULATION', 'Insulation / sheath', 'MATERIAL', 'Printed on the sheath (e.g. XLPE/SWA/PVC).', ['PVC', 'XLPE', 'EPR', 'Rubber', 'Silicone', 'LSZH (low smoke zero halogen)', 'PUR']);
const ARMOUR = pick('ARMOUR', 'Armour / screen', 'MATERIAL', 'Protection layer under the outer sheath.', ['Unarmoured', 'Steel wire armour (SWA)', 'Aluminium wire armour (AWA)', 'Steel tape armour (STA)', 'Copper braid screen', 'Foil screen']);
const CABLE_VOLTAGE = pick('CABLE_VOLTAGE_RATING', 'Voltage rating', 'RATING', 'Printed on the sheath.', ['300/500 V', '450/750 V', '0.6/1 kV', '1.8/3 kV', '3.6/6 kV', '6.35/11 kV', '12/20 kV', '18/30 kV']);
const LENGTH_M = dec('LENGTH_M', 'Length', 'm', 'DIMENSION', 'Length per item, drum or coil.', '100');

// Sensors & instruments
const SENSOR_PRINCIPLE = pick('SENSING_PRINCIPLE', 'Sensing principle', 'MATERIAL', 'How it detects. Inductive = metal only; capacitive = any material incl. liquids; magnetic = magnet on cylinder piston.', ['Inductive', 'Capacitive', 'Magnetic (reed / Hall)', 'Ultrasonic', 'Photoelectric diffuse', 'Photoelectric retro-reflective', 'Photoelectric through-beam', 'Background suppression', 'Fibre optic', 'Laser distance']);
const HOUSING = pick('SENSOR_HOUSING', 'Housing size', 'DIMENSION', 'Threaded barrel size (M12 = 12 mm thread) or block shape.', ['M5', 'M8', 'M12', 'M18', 'M30', 'Rectangular / block', 'Slot / fork', 'Other']);
const SENSE_RANGE = dec('SENSING_RANGE_MM', 'Sensing distance / range', 'mm', 'RATING', 'Rated operating distance (Sn) on the label.', '8');
const SWITCH_OUT = pick('SWITCHING_OUTPUT', 'Output', 'CONNECTION', 'Must match the PLC input. PNP is standard in Europe/Africa; NPN in Asian machines. NO = signal when target present.', [['PNP_NO', 'PNP, NO'], ['PNP_NC', 'PNP, NC'], ['PNP_NONC', 'PNP, NO+NC'], ['NPN_NO', 'NPN, NO'], ['NPN_NC', 'NPN, NC'], ['2WIRE_DC', '2-wire DC'], ['2WIRE_AC', '2-wire AC/DC'], ['ANALOG', 'Analogue 4–20 mA / 0–10 V'], ['IOLINK', 'IO-Link'], ['RELAY', 'Relay']]);
const CONNECTION_EL = pick('ELECTRICAL_CONNECTION', 'Electrical connection', 'CONNECTION', 'Cable tail or plug-in connector.', ['Cable 2 m', 'Cable 5 m', 'Connector M8 3-pin', 'Connector M8 4-pin', 'Connector M12 4-pin', 'Connector M12 5-pin', 'DIN 43650 (valve plug)', 'Terminal box', 'Cable gland M20']);
const FLUSH = pick('FLUSH_MOUNTING', 'Mounting in metal', 'CONNECTION', 'Flush = can be mounted level with metal (shorter range). Non-flush = tip must stick out.', ['Flush (embeddable)', 'Non-flush']);
const LIGHT = pick('LIGHT_TYPE', 'Light type', 'MATERIAL', 'Emitter type.', ['Red visible', 'Infrared', 'Laser', 'Blue / white']);
const MEAS_RANGE = text('MEASURING_RANGE', 'Measuring range', 'RATING', 'Minimum to maximum with unit, as on the label or order code.', '0–10 bar', 40);
const PRESSURE_TYPE = pick('PRESSURE_TYPE', 'Pressure reference', 'RATING', 'Gauge (relative to air), absolute, or differential between two ports.', ['Gauge', 'Absolute', 'Differential', 'Vacuum / compound']);
const ANALOG_OUT = pick('INSTRUMENT_OUTPUT', 'Output signal', 'CONNECTION', 'Signal sent to the PLC or display.', SIGNAL_OUT);
const PROCESS_CONN = pick('PROCESS_CONNECTION', 'Process connection', 'CONNECTION', 'Thread or flange that connects to the pipe or tank.', ['G 1/4" (BSPP)', 'G 1/2" (BSPP)', '1/4" NPT', '1/2" NPT', 'M20x1.5', 'Flange DN25', 'Flange DN50', 'Flange 1" ANSI', 'Tri-clamp 1.5"', 'Tri-clamp 2"', 'Wafer / between flanges', 'Other']);
const WETTED = pick('WETTED_MATERIAL', 'Wetted material', 'MATERIAL', 'Material touching the process fluid.', ['Stainless 316L', 'Stainless 304', 'Hastelloy C', 'Ceramic', 'Titanium', 'Tantalum', 'PTFE / PFA', 'Brass']);
const ACCURACY = dec('ACCURACY_PCT', 'Accuracy', '% of span', 'RATING', 'Accuracy stated on the datasheet.', '0.25', 0, 20);
const TEMP_ELEMENT = pick('TEMPERATURE_ELEMENT', 'Sensing element', 'MATERIAL', 'RTD (PT100) for accuracy up to ~600 °C; thermocouples for higher temperatures.', ['PT100', 'PT1000', 'Thermocouple type K', 'Thermocouple type J', 'Thermocouple type T', 'Thermocouple type N', 'Thermocouple type S/R', 'NTC thermistor', 'Bimetal dial thermometer']);
const WIRES = pick('RTD_WIRES', 'Wiring', 'CONNECTION', 'Number of wires (RTDs) or elements.', ['2-wire', '3-wire', '4-wire', 'Duplex (2 elements)']);
const SHEATH_D = dec('SHEATH_DIAMETER_MM', 'Sheath / stem diameter', 'mm', 'DIMENSION', 'Diameter of the probe.', '6');
const INSERTION = dec('INSERTION_LENGTH_MM', 'Insertion length', 'mm', 'DIMENSION', 'Length that goes into the process.', '150');
const FLOW_PRINCIPLE = pick('FLOW_PRINCIPLE', 'Measuring principle', 'MATERIAL', 'Electromagnetic needs conductive liquid (water, slurries); Coriolis for mass flow and high accuracy; vortex for steam and gas.', ['Electromagnetic', 'Coriolis (mass)', 'Vortex', 'Ultrasonic clamp-on', 'Ultrasonic inline', 'Turbine', 'Positive displacement', 'Variable area (rotameter)', 'Thermal mass', 'Differential pressure']);
const LINE_SIZE = pick('LINE_SIZE', 'Line size', 'DIMENSION', 'Nominal pipe size. DN = millimetres; inches in brackets.', DN);
const LINER = pick('LINER_MATERIAL', 'Liner / wetted lining', 'MATERIAL', 'Inside lining (electromagnetic meters).', ['Hard rubber', 'Soft rubber', 'PTFE', 'PFA', 'Polyurethane', 'Ceramic', 'Not applicable']);
const LEVEL_PRINCIPLE = pick('LEVEL_PRINCIPLE', 'Measuring principle', 'MATERIAL', 'How level is detected.', ['Radar (non-contact)', 'Guided wave radar', 'Ultrasonic', 'Hydrostatic / submersible', 'Float switch', 'Vibrating fork', 'Capacitive', 'Conductive probe', 'Magnetic level gauge']);
const ENC_TYPE = pick('ENCODER_TYPE', 'Encoder type', 'MATERIAL', 'Incremental gives pulses; absolute keeps position after power loss.', ['Incremental', 'Absolute single-turn', 'Absolute multi-turn', 'Resolver']);
const RESOLUTION = text('RESOLUTION', 'Resolution', 'RATING', 'Pulses per revolution (PPR) or bits.', '1024 PPR', 20);
const ENC_SHAFT = pick('ENCODER_SHAFT', 'Shaft', 'CONNECTION', 'Solid shaft (needs coupling) or hollow / blind hollow shaft.', ['Solid shaft', 'Hollow shaft', 'Blind hollow shaft']);
const ENC_OUT = pick('ENCODER_OUTPUT', 'Interface', 'CONNECTION', 'Electrical interface.', ['TTL / RS422 (5 V)', 'HTL push-pull (10–30 V)', 'Sin/Cos 1 Vpp', 'SSI', 'BiSS', 'EnDat', 'Profinet', 'EtherCAT', 'CANopen']);

// Valves (solenoid) & pneumatics
const VALVE_FUNCTION = pick('VALVE_FUNCTION', 'Valve function', 'RATING', 'Ports/positions. 2/2 = on-off; 3/2 = single-acting cylinder; 5/2 and 5/3 = double-acting cylinder. NC = closed when de-energised.', ['2/2 NC', '2/2 NO', '3/2 NC', '3/2 NO', '5/2 single solenoid', '5/2 double solenoid', '5/3 closed centre', '5/3 exhaust centre', '5/3 pressure centre']);
const PORT_SIZE = pick('PORT_SIZE', 'Port size', 'DIMENSION', 'Thread size of the ports.', ['M5', 'G 1/8"', 'G 1/4"', 'G 3/8"', 'G 1/2"', 'G 3/4"', 'G 1"', '1/4" NPT', '1/2" NPT', 'Push-in 6 mm', 'Push-in 8 mm', 'Push-in 10 mm', 'Push-in 12 mm', 'Sub-base / manifold']);
const MEDIUM = pick('MEDIUM', 'Medium', 'RATING', 'What flows through it.', ['Compressed air', 'Water', 'Hot water', 'Steam', 'Oil', 'Fuel', 'Gas', 'Vacuum', 'Chemicals', 'Food liquids']);
const PRESSURE_RANGE = text('PRESSURE_RANGE', 'Operating pressure range', 'RATING', 'Minimum and maximum working pressure.', '0.5–10 bar', 30);
const SEAL_MAT = pick('SEAL_MATERIAL', 'Seal / elastomer material', 'MATERIAL', 'Choose to suit the fluid and temperature.', ELASTOMER);
const ACTUATION = pick('VALVE_OPERATION', 'Operation', 'RATING', 'Direct acting works from 0 bar; pilot operated needs a minimum pressure difference.', ['Direct acting', 'Pilot operated (servo-assisted)', 'Pneumatic pilot', 'Manual / mechanical']);
const BODY = pick('BODY_MATERIAL', 'Body material', 'MATERIAL', 'Material of the body / casing.', BODY_METAL);
const CYL_TYPE = pick('CYLINDER_TYPE', 'Cylinder type', 'MATERIAL', 'Standard type so other brands fit the same mounting.', ['ISO 15552 profile/tie-rod', 'ISO 6432 round (mini)', 'ISO 21287 compact', 'Short-stroke / compact (non-ISO)', 'Guided cylinder', 'Rodless', 'Rotary actuator', 'Bellows / air spring']);
const BORE = pick('CYLINDER_BORE_MM', 'Bore diameter', 'DIMENSION', 'Piston diameter — the first number in the size (e.g. 63x200 = bore 63 mm).', ['8', '10', '12', '16', '20', '25', '32', '40', '50', '63', '80', '100', '125', '160', '200', '250', '320'], 'mm');
const STROKE = dec('STROKE_MM', 'Stroke', 'mm', 'DIMENSION', 'Travel of the rod — the second number in the size.', '200', 1);
const ACTING = pick('ACTING', 'Action', 'RATING', 'Double acting = air both ways; single acting = spring return.', ['Double acting', 'Single acting, spring return', 'Single acting, spring extend']);
const CUSHIONING = pick('CUSHIONING', 'End cushioning', 'RATING', 'Slows the piston at the ends.', ['None', 'Elastic (rubber pads)', 'Adjustable pneumatic', 'Self-adjusting']);
const MAGNETIC = yes('MAGNETIC_PISTON', 'Magnetic piston (for position sensors)', 'RATING', 'Yes if position sensors clip onto the cylinder.');
const ROD_THREAD = text('ROD_THREAD', 'Piston rod thread', 'CONNECTION', 'Thread on the rod end.', 'M16x1.5', 20);
const ROD_D = dec('ROD_DIAMETER_MM', 'Rod diameter', 'mm', 'DIMENSION', 'Diameter of the piston rod.', '45');
const MAX_PRESSURE_BAR = dec('MAX_PRESSURE_BAR', 'Maximum working pressure', 'bar', 'RATING', 'Highest allowed working pressure on the nameplate or datasheet.', '250');
const HYD_MOUNT = pick('HYDRAULIC_MOUNTING', 'Mounting', 'CONNECTION', 'How the cylinder is attached.', ['Rear clevis', 'Front flange', 'Rear flange', 'Trunnion', 'Foot', 'Tie-rod extended', 'Spherical eye']);
const SEAL_KIT = text('SEAL_KIT_NUMBER', 'Seal kit number', 'IDENTITY', 'Part number of the repair seal kit, if known.', 'SK-80/45-H', 60);
const DISPLACEMENT = dec('DISPLACEMENT_CC', 'Displacement', 'cm³/rev', 'RATING', 'Volume per revolution, in the type code.', '45');
const HYD_PUMP_TYPE = pick('HYDRAULIC_UNIT_TYPE', 'Type', 'MATERIAL', 'Construction.', ['External gear', 'Internal gear', 'Vane', 'Axial piston fixed', 'Axial piston variable', 'Radial piston', 'Orbital motor (gerotor)']);
const SAE_FLANGE = text('MOUNTING_FLANGE', 'Mounting flange / shaft', 'CONNECTION', 'Flange standard and shaft (e.g. SAE B 2-bolt, splined 13T).', 'SAE B 2-bolt, keyed 22 mm', 60);

// Bearings & power transmission
const BEARING_DESIGNATION = text('BEARING_DESIGNATION', 'Bearing designation', 'IDENTITY', 'The full number stamped on the bearing ring or box, including suffixes (2RS, ZZ, C3…). The suffixes matter.', '6205-2RS1/C3', 40);
const BEARING_TYPE = pick('BEARING_TYPE', 'Bearing type', 'MATERIAL', 'Basic type. Most electric motors and fans use deep-groove ball bearings (numbers starting 6…).', ['Deep groove ball', 'Angular contact ball', 'Self-aligning ball', 'Cylindrical roller', 'Spherical roller', 'Tapered roller', 'Needle roller', 'Thrust ball', 'Spherical roller thrust', 'Insert (Y-bearing)', 'Cam follower / track roller', 'Linear bearing']);
const BORE_D = dec('BORE_DIAMETER_MM', 'Bore (inner) diameter d', 'mm', 'DIMENSION', 'Inside diameter — the shaft size.', '25', 0.5);
const OUTER_D = dec('OUTER_DIAMETER_MM', 'Outside diameter D', 'mm', 'DIMENSION', 'Outside diameter.', '52', 1);
const WIDTH_B = dec('WIDTH_MM', 'Width B', 'mm', 'DIMENSION', 'Width / thickness.', '15', 0.5);
const SEALING = pick('BEARING_SEALING', 'Seals / shields', 'MATERIAL', 'Suffix on the number. 2RS = rubber seals both sides; 2Z / ZZ = metal shields; open = no seals.', ['Open', 'Shield one side (Z)', 'Shields both sides (2Z / ZZ)', 'Seal one side (RS)', 'Seals both sides (2RS / 2RSH / DDU)', 'Low-friction seals (2RZ / LLB)']);
const CLEARANCE = pick('INTERNAL_CLEARANCE', 'Internal clearance', 'RATING', 'Suffix C3 = more clearance for heat (electric motors). No suffix = normal (CN).', ['C2', 'CN (normal)', 'C3', 'C4', 'C5']);
const CAGE = pick('CAGE_MATERIAL', 'Cage', 'MATERIAL', 'Cage material (suffix J/TN9/M…).', ['Pressed steel', 'Machined brass (M / MA)', 'Polyamide (TN9 / P)', 'Full complement (no cage)']);
const PRECISION = pick('PRECISION_CLASS', 'Precision class', 'RATING', 'Normal for general machines; P5/P4 for machine-tool spindles.', ['Normal (P0 / ABEC 1)', 'P6 (ABEC 3)', 'P5 (ABEC 5)', 'P4 (ABEC 7)', 'P2 (ABEC 9)']);
const LUBE = pick('LUBRICATION', 'Lubrication', 'MATERIAL', 'Grease fill or special lubrication.', ['Standard grease', 'High-temperature grease', 'Low-temperature grease', 'Food-grade (NSF H1) grease', 'Solid oil', 'Oil lubricated / none']);
const BORE_FORM = pick('BORE_FORM', 'Bore form', 'DIMENSION', 'Cylindrical, or tapered (suffix K) for adapter sleeves.', ['Cylindrical', 'Tapered 1:12 (K)', 'Tapered 1:30 (K30)']);
const DYN_LOAD = dec('DYNAMIC_LOAD_KN', 'Dynamic load rating C', 'kN', 'RATING', 'From the maker’s catalogue.', '14.8');
const PLAIN_MAT = pick('BUSH_MATERIAL', 'Bush material', 'MATERIAL', 'Material of the bush / sleeve.', ['Bronze', 'Sintered bronze (oil-impregnated)', 'PTFE-lined steel (DU type)', 'Polymer / plastic', 'Graphite bronze', 'Babbitt / white metal']);
const FLANGED = yes('FLANGED', 'Flanged', 'DIMENSION', 'Yes if it has a collar/flange.');
const HOUSING_TYPE = pick('HOUSING_TYPE', 'Housing type', 'MATERIAL', 'Shape of the housing.', ['Pillow block (UCP)', 'Square flange 4-bolt (UCF)', 'Oval flange 2-bolt (UCFL)', 'Round flange (UCFC)', 'Take-up (UCT)', 'Split plummer block (SNL/SN)', 'Hanger']);
const SHAFT_FOR = dec('SHAFT_SIZE_MM', 'Shaft diameter', 'mm', 'DIMENSION', 'Shaft size it fits.', '40', 1);
const INSERT = text('INSERT_DESIGNATION', 'Insert / bearing designation', 'IDENTITY', 'Bearing that sits in the housing.', 'UC208', 30);
const HOUSING_MAT = pick('HOUSING_MATERIAL', 'Housing material', 'MATERIAL', 'Cast iron for general use; stainless or thermoplastic for wash-down.', ['Cast iron', 'Pressed steel', 'Stainless steel', 'Thermoplastic', 'Ductile iron', 'Aluminium']);
const COUPLING_TYPE = pick('COUPLING_TYPE', 'Coupling type', 'MATERIAL', 'Type of flexible coupling.', ['Jaw / spider (Rotex type)', 'Tyre (Fenaflex type)', 'Gear', 'Grid', 'Disc / diaphragm', 'Pin & bush', 'Chain', 'Fluid', 'Rigid / flange', 'Oldham', 'Bellows']);
const COUPLING_SIZE = text('COUPLING_SIZE', 'Coupling size', 'DIMENSION', 'Size number from the coupling hub or catalogue.', 'Rotex 38', 30);
const BORES = text('BORE_SIZES', 'Bore sizes (driver / driven)', 'DIMENSION', 'Shaft holes in each half, with keyway.', '38 mm / 42 mm with key', 40);
const MAX_TORQUE = dec('MAX_TORQUE_NM', 'Rated torque', 'N·m', 'RATING', 'Nominal torque from the catalogue.', '325');
const ELEMENT_MAT = pick('ELEMENT_MATERIAL', 'Flexible element', 'MATERIAL', 'Spider / insert / tyre material (often colour-coded).', ['NBR', 'Polyurethane 92 Sh A (yellow)', 'Polyurethane 98 Sh A (red)', 'Hytrel', 'Natural rubber', 'Chloroprene', 'Steel']);
const TAPER_BUSH = text('TAPER_BUSH', 'Taper bush size', 'CONNECTION', 'Taper-lock bush number if used (e.g. 2012, 2517).', '2012 x 30 mm', 20);
const VBELT_SECTION = pick('BELT_SECTION', 'Belt section', 'DIMENSION', 'Profile code at the start of the number (e.g. SPB 2000 → SPB). Classical: Z, A, B, C; Wedge: SPZ, SPA, SPB, SPC; narrow US: 3V, 5V, 8V; cogged: XPZ, XPA, XPB, XPC.', ['Z / 10', 'A / 13', 'B / 17', 'C / 22', 'D / 32', 'SPZ', 'SPA', 'SPB', 'SPC', 'XPZ', 'XPA', 'XPB', 'XPC', '3V', '5V', '8V', '3VX', '5VX', 'Poly-V PJ', 'Poly-V PK', 'Poly-V PL']);
const BELT_LENGTH = int('BELT_LENGTH_MM', 'Belt length', 'mm', 'DIMENSION', 'The number after the section (e.g. SPB 2000 = 2000 mm).', '2000', 100);
const LENGTH_BASIS = pick('LENGTH_BASIS', 'Length measured as', 'DIMENSION', 'Wedge belts use datum/pitch length (Ld/Lp); classical belts often inside length (Li).', ['Datum / pitch length (Ld / Lp)', 'Inside length (Li)', 'Outside length (La)']);
const BELT_BUILD = pick('BELT_CONSTRUCTION', 'Construction', 'MATERIAL', 'Wrapped (smooth) or raw-edge cogged (notched, runs cooler on small pulleys).', ['Wrapped', 'Raw-edge cogged', 'Banded (joined) belts', 'Link belt']);
const MATCHED_SET = int('MATCHED_SET_QTY', 'Belts per matched set', 'pcs', 'PACK', 'On multi-belt drives all belts must be replaced together as a matched set.', '3', 1, 20);
const TIMING_PROFILE = pick('TOOTH_PROFILE', 'Tooth profile', 'DIMENSION', 'Code before the size (e.g. 8M-1200-30 → HTD 8M).', ['MXL', 'XL', 'L', 'H', 'XH', 'T2.5', 'T5', 'T10', 'T20', 'AT5', 'AT10', 'AT20', 'HTD 3M', 'HTD 5M', 'HTD 8M', 'HTD 14M', 'GT2 / GT3', 'STD S8M', 'RPP 8M']);
const TEETH = int('NUMBER_OF_TEETH', 'Number of teeth', '', 'DIMENSION', 'Count of teeth.', '150', 1);
const BELT_WIDTH = dec('BELT_WIDTH_MM', 'Width', 'mm', 'DIMENSION', 'Belt width — last number in the code.', '30', 1);
const BELT_MATERIAL = pick('BELT_MATERIAL', 'Belt material', 'MATERIAL', 'Body and tension cord.', ['Rubber / neoprene, glass fibre', 'Polyurethane, steel cord', 'Polyurethane, aramid', 'HNBR, glass fibre']);
const CONVEYOR_BELT_TYPE = pick('CONVEYOR_BELT_TYPE', 'Belt type', 'MATERIAL', 'Carcass type.', ['Fabric EP (polyester/nylon)', 'Steel cord (ST)', 'Solid woven PVC/PVG', 'PVC / PU light conveyor', 'Modular plastic', 'Wire mesh', 'Chevron / cleated']);
const BELT_RATING = text('BELT_RATING', 'Strength rating / plies', 'RATING', 'Printed on the belt or order, e.g. EP630/4 = 630 N/mm with 4 plies.', 'EP630/4', 20);
const COVERS = text('COVER_THICKNESS', 'Top + bottom cover thickness', 'DIMENSION', 'Rubber cover thickness (top + bottom).', '6 + 2 mm', 20);
const COVER_GRADE = pick('COVER_GRADE', 'Cover grade', 'MATERIAL', 'Grade suited to the material carried.', ['Abrasion resistant (DIN Y / W / X)', 'Heat resistant (T1–T3)', 'Oil resistant (MOR / G)', 'Fire resistant (K / S)', 'Food grade (FDA)', 'General purpose']);
const SPLICE = pick('SPLICE_TYPE', 'Joining method', 'CONNECTION', 'How the belt ends are joined.', ['Hot vulcanised', 'Cold bonded', 'Mechanical fasteners', 'Endless (factory made)']);
const CHAIN_PITCH = pick('CHAIN_SIZE', 'Chain size', 'DIMENSION', 'ISO/BS number (e.g. 08B) or ANSI number (e.g. 40). Pitch in brackets.', ['04B (6 mm)', '05B (8 mm)', '06B (3/8")', '08B (1/2")', '10B (5/8")', '12B (3/4")', '16B (1")', '20B (1-1/4")', '24B (1-1/2")', 'ANSI 25', 'ANSI 35', 'ANSI 40', 'ANSI 50', 'ANSI 60', 'ANSI 80', 'ANSI 100', 'ANSI 120', 'Conveyor chain (state in notes)']);
const STRANDS = pick('STRANDS', 'Strands', 'DIMENSION', 'Single, double or triple row.', ['Simplex (1)', 'Duplex (2)', 'Triplex (3)']);
const CHAIN_MAT = pick('CHAIN_MATERIAL', 'Material / finish', 'MATERIAL', 'Material for the environment.', ['Carbon steel', 'Nickel plated', 'Stainless steel', 'Self-lubricating', 'O-ring (sealed)']);
const ATTACHMENTS = text('ATTACHMENTS', 'Attachments', 'CONNECTION', 'Special links or attachments (K1, M2, extended pins).', 'K1 every 4th link', 40);
const SPROCKET_BORE = pick('SPROCKET_BORE', 'Bore type', 'CONNECTION', 'Pilot bore needs machining; taper bush or finished bore fit directly.', ['Pilot bore', 'Taper bush', 'Finished bore with keyway', 'QD bush']);
const GROOVES = int('NUMBER_OF_GROOVES', 'Number of grooves', '', 'DIMENSION', 'Count of belt grooves.', '3', 1, 20);
const PITCH_DIA = dec('PITCH_DIAMETER_MM', 'Pitch / datum diameter', 'mm', 'DIMENSION', 'Effective diameter, from the pulley code.', '200');
const SEAL_D = dec('SEAL_SHAFT_MM', 'Shaft diameter (d)', 'mm', 'DIMENSION', 'First number of the size (e.g. 40x62x8 → 40).', '40', 1);
const SEAL_DD = dec('SEAL_BORE_MM', 'Housing bore (D)', 'mm', 'DIMENSION', 'Second number of the size.', '62', 1);
const SEAL_B = dec('SEAL_WIDTH_MM', 'Width (b)', 'mm', 'DIMENSION', 'Third number of the size.', '8', 1);
const LIP_TYPE = pick('LIP_TYPE', 'Seal design', 'MATERIAL', 'Type code on the seal. TC = rubber outside, 2 lips (most common). SC = 1 lip. TB/SB = metal outside.', ['TC — double lip, rubber covered', 'SC — single lip, rubber covered', 'TB — double lip, metal case', 'SB — single lip, metal case', 'V-ring', 'PTFE lip seal', 'Cassette seal']);
const MECH_SEAL_TYPE = pick('MECH_SEAL_TYPE', 'Seal arrangement', 'MATERIAL', 'Cartridge seals are pre-assembled and easiest to fit.', ['Single component', 'Single cartridge', 'Double cartridge', 'Tandem', 'Split seal', 'Mixer / agitator seal']);
const MECH_SEAL_STD = pick('MECH_SEAL_STANDARD', 'Dimensional standard', 'COMPLIANCE', 'Allows equivalents from other makers.', ['EN 12756 (DIN 24960)', 'API 682', 'Pump-maker specific', 'Other']);
const FACES = pick('SEAL_FACES', 'Seal face combination', 'MATERIAL', 'Rotating / stationary face materials.', ['Carbon / Silicon carbide', 'Silicon carbide / Silicon carbide', 'Carbon / Ceramic', 'Tungsten carbide / Tungsten carbide', 'Carbon / Tungsten carbide']);
const SPRING_TYPE = pick('SEAL_SPRING', 'Spring type', 'MATERIAL', 'Spring arrangement.', ['Single spring', 'Multi-spring', 'Wave spring', 'Metal bellows', 'Rubber bellows']);
const ORING_ID = dec('ORING_ID_MM', 'Inside diameter', 'mm', 'DIMENSION', 'Inner diameter.', '25.07', 0.1);
const ORING_CS = dec('ORING_CS_MM', 'Cross-section', 'mm', 'DIMENSION', 'Thickness of the ring.', '2.62', 0.2);
const HARDNESS = pick('HARDNESS_SHORE', 'Hardness', 'MATERIAL', '70 Shore A is standard; 90 for high pressure.', ['50 Shore A', '60 Shore A', '70 Shore A', '75 Shore A', '80 Shore A', '90 Shore A']);
const ORING_STD = text('ORING_SIZE_CODE', 'Standard size code', 'IDENTITY', 'AS568 dash number (e.g. -121) or ISO 3601 / BS 1806 code, if known.', 'AS568-121', 20);
const FOOD = yes('FOOD_GRADE', 'Food grade (FDA / EC 1935)', 'COMPLIANCE', 'Yes if it touches food or drink.');
const GASKET_TYPE = pick('GASKET_TYPE', 'Gasket type', 'MATERIAL', 'Spiral wound for high pressure/temperature; sheet for general water/air.', ['Full-face sheet', 'Ring (IBC) sheet', 'Spiral wound', 'Ring type joint (RTJ)', 'Kammprofile', 'Rubber', 'PTFE envelope', 'Insulating kit']);
const GASKET_MAT = pick('GASKET_MATERIAL', 'Gasket material', 'MATERIAL', 'Material to suit the fluid.', ['Compressed non-asbestos fibre (CNAF)', 'Flexible graphite', 'PTFE', 'Expanded PTFE', 'EPDM rubber', 'NBR rubber', 'SS316 + graphite (spiral)', 'Soft iron / steel (RTJ)']);
const FLANGE_STD = pick('FLANGE_STANDARD', 'Flange standard', 'COMPLIANCE', 'Standard of the mating flanges.', ['EN 1092-1 (PN)', 'ASME B16.5', 'ASME B16.47', 'BS 10 (Table D/E)', 'JIS B2220']);
const PRESSURE_RATING = pick('PRESSURE_CLASS', 'Pressure class', 'RATING', 'Printed on the flange, valve body or gasket.', PRESSURE_CLASS);
const THICKNESS = dec('THICKNESS_MM', 'Thickness', 'mm', 'DIMENSION', 'Material thickness.', '3');
const PACKING_MAT = pick('PACKING_MATERIAL', 'Packing material', 'MATERIAL', 'Gland packing yarn.', ['PTFE', 'Graphite', 'PTFE / graphite', 'Aramid', 'Carbon', 'Ramie / cotton']);
const PACKING_SIZE = pick('PACKING_SECTION_MM', 'Cross-section', 'DIMENSION', 'Square size of the packing cord.', ['6', '8', '10', '12', '14', '16', '19', '22', '25'], 'mm');

// Pumps, compressors, fans
const PUMP_TYPE = pick('PUMP_TYPE', 'Pump type', 'MATERIAL', 'Basic design.', ['End-suction', 'Inline', 'Horizontal split-case', 'Multistage horizontal', 'Multistage vertical', 'Vertical turbine', 'Submersible', 'Self-priming', 'Slurry', 'Magnetic drive', 'Canned motor']);
const PD_TYPE = pick('PD_PUMP_TYPE', 'Pump type', 'MATERIAL', 'Positive displacement design.', ['External gear', 'Internal gear', 'Lobe', 'Screw', 'Progressive cavity (mono)', 'Air-operated diaphragm (AODD)', 'Metering / dosing diaphragm', 'Piston / plunger', 'Peristaltic (hose)', 'Vane']);
const FLOW = dec('FLOW_M3H', 'Rated flow', 'm³/h', 'RATING', 'Duty flow on the nameplate or datasheet. 1 m³/h ≈ 16.7 L/min.', '50');
const HEAD = dec('HEAD_M', 'Rated head', 'm', 'RATING', 'Duty head on the nameplate (10 m ≈ 1 bar of water).', '32');
const DISCHARGE_P = dec('DISCHARGE_PRESSURE_BAR', 'Discharge pressure', 'bar', 'RATING', 'Rated outlet pressure.', '6');
const SUCTION = pick('SUCTION_SIZE', 'Suction size', 'DIMENSION', 'Inlet nominal size.', DN);
const DISCHARGE = pick('DISCHARGE_SIZE', 'Discharge size', 'DIMENSION', 'Outlet nominal size.', DN);
const IMPELLER_D = dec('IMPELLER_DIAMETER_MM', 'Impeller diameter', 'mm', 'DIMENSION', 'Trimmed impeller diameter (nameplate or test certificate).', '219');
const IMPELLER_TYPE = pick('IMPELLER_TYPE', 'Impeller type', 'MATERIAL', 'Closed for clean liquids; open/vortex for solids.', ['Closed', 'Semi-open', 'Open', 'Vortex (recessed)', 'Channel', 'Cutter / grinder']);
const CASING_MAT = pick('CASING_MATERIAL', 'Casing material', 'MATERIAL', 'Material of the pump casing.', BODY_METAL);
const IMPELLER_MAT = pick('IMPELLER_MATERIAL', 'Impeller material', 'MATERIAL', 'Material of the impeller.', [...BODY_METAL, 'High-chrome iron', 'Rubber lined']);
const SHAFT_SEAL = pick('SHAFT_SEAL', 'Shaft sealing', 'MATERIAL', 'How the shaft is sealed.', ['Gland packing', 'Single mechanical seal', 'Single cartridge seal', 'Double mechanical seal', 'Magnetic drive (sealless)', 'Lip seal']);
const LIQUID = text('LIQUID', 'Liquid handled', 'RATING', 'What is pumped, with temperature and solids if any.', 'Cooling water 35 °C', 80);
const MAX_TEMP = dec('MAX_TEMPERATURE_C', 'Maximum temperature', '°C', 'RATING', 'Highest operating temperature.', '120', -273);
const NPSH = dec('NPSHR_M', 'NPSH required', 'm', 'RATING', 'From the pump curve — needed to avoid cavitation.', '3.2');
const PUMP_STD = pick('PUMP_STANDARD', 'Pump standard', 'COMPLIANCE', 'Standard pumps can be replaced by other makers with the same dimensions.', ['EN 733', 'ISO 2858 / ISO 5199', 'API 610', 'ASME B73.1', 'Maker standard']);
const VISCOSITY = text('VISCOSITY', 'Liquid viscosity', 'RATING', 'Viscosity of the pumped liquid.', '500 cP', 30);
const COMP_TYPE = pick('COMPRESSOR_TYPE', 'Compressor type', 'MATERIAL', 'Basic design.', ['Rotary screw', 'Reciprocating piston', 'Centrifugal', 'Scroll', 'Rotary vane', 'Tooth / claw', 'Refrigeration hermetic', 'Refrigeration semi-hermetic']);
const OIL_FREE = yes('OIL_FREE', 'Oil-free', 'RATING', 'Yes for oil-free (class 0) air — food, pharma, electronics.');
const FAD = dec('FREE_AIR_DELIVERY_M3MIN', 'Free air delivery (FAD)', 'm³/min', 'RATING', 'Air output at working pressure (1 m³/min ≈ 35.3 cfm).', '6.5');
const WORK_P = dec('WORKING_PRESSURE_BAR', 'Working pressure', 'bar', 'RATING', 'Maximum working pressure.', '8');
const COOL_MEDIUM = pick('COOLING_MEDIUM', 'Cooling', 'MATERIAL', 'Air or water cooled.', ['Air-cooled', 'Water-cooled']);
const VSD = yes('VARIABLE_SPEED', 'Variable speed drive', 'RATING', 'Yes if speed is controlled by a built-in VSD.');
const DRYER = yes('INTEGRATED_DRYER', 'Integrated dryer', 'RATING', 'Yes if a refrigerant dryer is built in.');
const FAN_TYPE = pick('FAN_TYPE', 'Fan / blower type', 'MATERIAL', 'Look at the wheel: axial = propeller blades; centrifugal = drum-shaped wheel blowing out sideways; roots/side-channel = positive-displacement blowers.', ['Axial', 'Centrifugal forward-curved', 'Centrifugal backward-curved', 'Radial blade', 'Mixed flow', 'Roots (lobe) blower', 'Side-channel blower', 'Plug fan']);
const AIRFLOW = dec('AIRFLOW_M3H', 'Airflow', 'm³/h', 'RATING', 'Rated airflow.', '12000');
const STATIC_P = dec('STATIC_PRESSURE_PA', 'Static pressure', 'Pa', 'RATING', 'Pressure at the rated airflow.', '800');
const DRIVE_ARR = pick('DRIVE_ARRANGEMENT', 'Drive', 'CONNECTION', 'Motor connection.', ['Direct drive', 'Belt drive', 'Coupling drive']);
const FAN_D = dec('FAN_DIAMETER_MM', 'Impeller / wheel diameter', 'mm', 'DIMENSION', 'Diameter of the fan wheel.', '630');

// Valves (process)
const VALVE_TYPE = pick('VALVE_TYPE', 'Valve type', 'MATERIAL', 'Design. Ball/butterfly = quick on-off; globe = regulating; check = one-way; gate = full-bore isolation.', ['Ball', 'Gate', 'Globe', 'Butterfly', 'Check (swing)', 'Check (lift / dual-plate)', 'Plug', 'Diaphragm', 'Needle', 'Knife gate', 'Pressure relief / safety', 'Pressure reducing', 'Control valve', 'Foot valve', 'Strainer (Y-type)']);
const VALVE_SIZE = pick('VALVE_SIZE', 'Size', 'DIMENSION', 'Nominal size on the body (DN mm or inches).', DN);
const END_CONN = pick('END_CONNECTION', 'End connection', 'CONNECTION', 'How it joins the pipe.', END_CONNECTION);
const TRIM = text('TRIM_SEAT', 'Trim / seat material', 'MATERIAL', 'Seat and ball/disc material (e.g. SS316 ball, PTFE seats).', 'SS316 ball, RPTFE seats', 60);
const OPERATOR = pick('VALVE_OPERATOR', 'Operation', 'CONNECTION', 'How the valve is operated.', ['Lever', 'Handwheel', 'Gear operator', 'Pneumatic actuator double-acting', 'Pneumatic actuator spring-return', 'Electric actuator', 'Solenoid', 'Self-acting']);
const FAIL = pick('FAIL_POSITION', 'Fail-safe position', 'RATING', 'Position on loss of air/power (actuated valves only).', ['Fail closed', 'Fail open', 'Fail last position', 'Not applicable']);
const SET_P = dec('SET_PRESSURE_BAR', 'Set pressure', 'bar', 'RATING', 'Opening pressure on the tag (relief/safety valves).', '10');
const VALVE_STD = text('VALVE_STANDARD', 'Design standard', 'COMPLIANCE', 'E.g. API 6D, API 600, EN 593, ASME B16.34.', 'API 6D', 40);

// Hoses & fittings
const HOSE_APP = pick('HOSE_APPLICATION', 'Hose application', 'MATERIAL', 'What the hose carries.', ['Hydraulic', 'Pneumatic / air', 'Water', 'Steam', 'Suction & discharge', 'Chemical', 'Food & beverage', 'Fuel / oil', 'Welding gas']);
const HOSE_ID = pick('HOSE_ID', 'Inside diameter (dash size)', 'DIMENSION', 'Bore size. Hydraulic hose dash size = sixteenths of an inch (-08 = 1/2").', ['-03 (3/16")', '-04 (1/4")', '-05 (5/16")', '-06 (3/8")', '-08 (1/2")', '-10 (5/8")', '-12 (3/4")', '-16 (1")', '-20 (1-1/4")', '-24 (1-1/2")', '-32 (2")', '2-1/2"', '3"', '4"', '6"']);
const HOSE_STD = pick('HOSE_STANDARD', 'Hose standard', 'COMPLIANCE', 'Printed along the hose.', ['EN 853 1SN', 'EN 853 2SN', 'EN 857 2SC', 'EN 856 4SP', 'EN 856 4SH', 'SAE 100R1AT', 'SAE 100R2AT', 'SAE 100R12', 'SAE 100R13', 'EN 12115 (chemical)', 'ISO 6134 (steam)', 'Other']);
const END_FITTINGS = text('END_FITTINGS', 'End fittings (end 1 / end 2)', 'CONNECTION', 'Fitting type and size at each end, with orientation if angled.', 'JIC 37° female -08 / BSP 60° female 1/2" 90°', 120);
const FITTING_TYPE = pick('FITTING_TYPE', 'Fitting type', 'MATERIAL', 'Shape of the fitting.', ['Elbow 90°', 'Elbow 45°', 'Equal tee', 'Reducing tee', 'Concentric reducer', 'Eccentric reducer', 'Union', 'Coupling / socket', 'Nipple', 'Cap / plug', 'Flange weld-neck', 'Flange slip-on', 'Flange blind', 'Adapter']);
const SCHEDULE = pick('SCHEDULE', 'Wall schedule / class', 'DIMENSION', 'Wall thickness series.', ['SCH 10', 'SCH 40', 'SCH 80', 'SCH 160', 'XXS', 'Class 3000 (forged)', 'Class 6000 (forged)', 'Medium (BS 1387)', 'Heavy (BS 1387)', 'PN10 (plastic)', 'PN16 (plastic)']);

// Filters
const FILTER_APP = pick('FILTER_APPLICATION', 'Filter application', 'MATERIAL', 'What the filter cleans.', ['Engine air intake', 'Compressor air intake', 'Compressed air line', 'Hydraulic return', 'Hydraulic pressure', 'Lube oil', 'Fuel', 'Water / process liquid', 'Dust collector bag', 'Dust collector cartridge', 'HVAC panel / bag', 'Oil separator (compressor)']);
const MICRON = pick('FILTER_RATING_MICRON', 'Filtration rating', 'RATING', 'Particle size it stops (smaller = finer), printed on the element.', ['0.01', '0.1', '1', '3', '5', '10', '25', '40', '60', '100', '150', '250', '500'], 'µm');
const FILTER_CLASS = text('FILTER_EFFICIENCY', 'Efficiency class', 'RATING', 'E.g. β≥200, ISO 16890 ePM1 70%, G4/F7/F9, MERV 13.', 'ISO ePM1 70% (F7)', 40);
const FILTER_DIMS = text('FILTER_DIMENSIONS', 'Dimensions', 'DIMENSION', 'Outside diameter × inside diameter × length (cartridges) or W × H × D (panels).', 'OD 130 × ID 72 × L 250 mm', 60);
const MEDIA = pick('FILTER_MEDIA', 'Filter media', 'MATERIAL', 'Material of the element.', ['Cellulose', 'Glass fibre', 'Synthetic', 'Stainless mesh', 'Polyester needlefelt', 'PTFE membrane', 'Activated carbon']);

// Fasteners & springs
const FASTENER_TYPE = pick('FASTENER_TYPE', 'Fastener type', 'MATERIAL', 'Basic type.', ['Hex bolt (part thread)', 'Hex set screw (full thread)', 'Socket head cap screw', 'Countersunk screw', 'Stud / threaded rod', 'Hex nut', 'Nyloc nut', 'Flat washer', 'Spring washer', 'Anchor bolt', 'Rivet', 'Self-tapping screw', 'Grub screw', 'Eye bolt', 'U-bolt']);
const THREAD = pick('THREAD_STANDARD', 'Thread', 'DIMENSION', 'Metric coarse is standard (M12). Fine pitch is written M12x1.25. Imperial: UNC/UNF/BSW.', ['Metric coarse', 'Metric fine', 'UNC', 'UNF', 'BSW', 'BSF', 'Not threaded']);
const THREAD_D = pick('THREAD_DIAMETER', 'Diameter', 'DIMENSION', 'Nominal diameter.', ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M14', 'M16', 'M20', 'M24', 'M27', 'M30', 'M36', 'M42', 'M48', '1/4"', '5/16"', '3/8"', '1/2"', '5/8"', '3/4"', '7/8"', '1"']);
const FASTENER_L = dec('FASTENER_LENGTH_MM', 'Length', 'mm', 'DIMENSION', 'Length under the head.', '50', 1);
const PROPERTY_CLASS = pick('PROPERTY_CLASS', 'Strength / property class', 'RATING', 'Stamped on the head (8.8, 10.9…) or A2/A4 for stainless.', ['4.6', '5.6', '8.8', '10.9', '12.9', 'A2-70', 'A4-70', 'A4-80', 'Grade 5', 'Grade 8']);
const FINISH = pick('FINISH', 'Finish / material', 'MATERIAL', 'Coating or material.', ['Plain / black', 'Zinc plated', 'Hot-dip galvanised', 'Stainless A2 (304)', 'Stainless A4 (316)', 'Brass', 'Geomet / Dacromet']);
const SPRING_KIND = pick('SPRING_TYPE', 'Spring type', 'MATERIAL', 'Compression springs get shorter under load; extension springs have hooks and stretch; torsion springs twist.', ['Compression', 'Extension', 'Torsion', 'Disc (Belleville)', 'Gas spring']);
const WIRE_D = dec('WIRE_DIAMETER_MM', 'Wire diameter', 'mm', 'DIMENSION', 'Thickness of the spring wire.', '2');
const FREE_L = dec('FREE_LENGTH_MM', 'Free length', 'mm', 'DIMENSION', 'Unloaded length.', '60');

// Lubricants & chemicals
const LUBE_APP = pick('LUBRICANT_APPLICATION', 'Application', 'MATERIAL', 'What the oil is used for.', ['Gear oil (industrial)', 'Hydraulic oil', 'Compressor oil', 'Turbine oil', 'Engine oil', 'Slideway oil', 'Heat transfer oil', 'Chain / open gear', 'Spindle oil', 'Refrigeration oil', 'Transformer oil']);
const ISO_VG = pick('ISO_VG', 'Viscosity grade (ISO VG / SAE)', 'RATING', 'Number on the drum (e.g. “68” in HLP 68). Never mix grades.', ['ISO VG 2', 'ISO VG 10', 'ISO VG 22', 'ISO VG 32', 'ISO VG 46', 'ISO VG 68', 'ISO VG 100', 'ISO VG 150', 'ISO VG 220', 'ISO VG 320', 'ISO VG 460', 'ISO VG 680', 'ISO VG 1000', 'SAE 15W-40', 'SAE 10W-30', 'SAE 30', 'SAE 40', 'SAE 80W-90', 'SAE 85W-140']);
const BASE_OIL = pick('BASE_OIL', 'Base oil', 'MATERIAL', 'Mineral or synthetic. Do not mix PAG with other oils.', ['Mineral', 'Synthetic PAO', 'Synthetic ester', 'Synthetic PAG', 'Semi-synthetic', 'Bio-based']);
const LUBE_SPEC = text('LUBRICANT_SPECIFICATION', 'Specification / approvals', 'COMPLIANCE', 'Classification on the label, e.g. DIN 51524-2 HLP, DIN 51517-3 CLP, API CK-4, OEM approval.', 'DIN 51524-2 HLP', 80);
const NSF_H1 = yes('NSF_H1', 'Food grade NSF H1', 'COMPLIANCE', 'Required where incidental food contact is possible.');
const PACK_L = pick('PACK_SIZE_L', 'Pack size', 'PACK', 'Container size.', ['0.4 kg cartridge', '1 L / 1 kg', '4 L', '5 L', '18 L / 18 kg pail', '20 L', '180 kg drum', '205 L / 208 L drum', '1000 L IBC', 'Bulk'], '');
const PRODUCT_NAME = text('PRODUCT_NAME', 'Brand product name', 'IDENTITY', 'The product name on the label.', 'Shell Tellus S2 MX 68', 80);
const THICKENER = pick('GREASE_THICKENER', 'Thickener', 'MATERIAL', 'Lithium complex is general-purpose; do not mix with polyurea or calcium without checking.', ['Lithium', 'Lithium complex', 'Calcium sulfonate complex', 'Polyurea', 'Aluminium complex', 'Bentonite (clay)', 'Calcium', 'Barium complex']);
const NLGI = pick('NLGI_GRADE', 'NLGI consistency', 'RATING', 'Firmness number on the tub. NLGI 2 is most common; 00/000 for centralised systems.', ['000', '00', '0', '1', '2', '3']);
const BASE_VISC = int('BASE_OIL_VISCOSITY', 'Base oil viscosity at 40 °C', 'cSt', 'RATING', 'From the datasheet; higher for slow, heavy loads.', '220');
const EP = yes('EP_ADDITIVE', 'Extreme pressure (EP) additive', 'RATING', 'EP on the label means suited to shock and heavy loads.');
const GHS = many('GHS_HAZARD', 'GHS hazard classes', 'COMPLIANCE', 'Pictograms on the label / safety data sheet (SDS).', ['Not hazardous', 'Flammable', 'Oxidiser', 'Corrosive', 'Toxic', 'Harmful / irritant', 'Health hazard (CMR)', 'Environmental hazard', 'Gas under pressure', 'Explosive']);
const UN = text('UN_NUMBER', 'UN number', 'COMPLIANCE', 'Four-digit transport number on the SDS / drum (only for dangerous goods).', 'UN1263', 10);
const CONCENTRATION = dec('CONCENTRATION_PCT', 'Concentration', '%', 'RATING', 'Active ingredient strength.', '48', 0, 100);
const SDS = yes('SDS_AVAILABLE', 'Safety data sheet available', 'COMPLIANCE', 'A current SDS must be on file before chemicals are stored or used.');
const STORAGE_T = text('STORAGE_CONDITIONS', 'Storage conditions', 'PACK', 'Temperature and handling needed in the store.', 'Below 30 °C, away from oxidisers', 80);

// Welding, abrasives, PPE
const WELD_PROCESS = pick('WELDING_PROCESS', 'Welding process', 'MATERIAL', 'Process it is for.', ['Stick (SMAW / MMA)', 'MIG/MAG (GMAW)', 'TIG (GTAW)', 'Flux-cored (FCAW)', 'Submerged arc (SAW)', 'Gas / brazing']);
const WELD_CLASS = text('WELDING_CLASSIFICATION', 'Classification', 'COMPLIANCE', 'AWS/EN code on the box (e.g. E7018, ER70S-6, ER308L, E6013).', 'E7018', 30);
const WIRE_DIA = pick('ELECTRODE_DIAMETER', 'Diameter', 'DIMENSION', 'Rod or wire diameter.', ['0.8', '1.0', '1.2', '1.6', '2.0', '2.5', '3.2', '4.0', '5.0'], 'mm');
const PACK_KG = dec('PACK_WEIGHT_KG', 'Pack weight', 'kg', 'PACK', 'Weight per box or spool.', '5');
const ABRASIVE_TYPE = pick('ABRASIVE_TOOL_TYPE', 'Tool type', 'MATERIAL', 'What the tool is. Cutting discs are thin (1–3 mm); grinding discs are thick (6 mm+) — never grind with a cutting disc.', ['Cutting disc', 'Grinding disc', 'Flap disc', 'Wire brush', 'Drill bit (HSS)', 'Drill bit (masonry)', 'End mill', 'Turning insert', 'Tap', 'Hole saw', 'Saw blade', 'Abrasive belt / paper']);
const TOOL_DIA = dec('TOOL_DIAMETER_MM', 'Diameter', 'mm', 'DIMENSION', 'Disc or tool diameter.', '115');
const SUIT_FOR = many('SUITABLE_FOR', 'Suitable for', 'RATING', 'Materials it can work on.', ['Steel', 'Stainless steel (INOX)', 'Cast iron', 'Aluminium', 'Masonry / concrete', 'Wood', 'Plastic']);
const MAX_RPM = int('MAX_RPM', 'Maximum speed', 'rpm', 'RATING', 'Printed on the disc — never exceed.', '13300');
const GRIT = text('GRIT', 'Grit / grade', 'RATING', 'Grit number or grade.', 'P80', 10);
const PPE_TYPE = pick('PPE_TYPE', 'PPE type', 'MATERIAL', 'Type of protective equipment.', ['Safety boots / shoes', 'Gloves', 'Safety helmet', 'Safety glasses / goggles', 'Face shield', 'Hearing protection', 'Disposable respirator', 'Half-mask respirator', 'Coverall', 'High-visibility vest', 'Full-body harness', 'Lanyard / SRL', 'Welding helmet', 'Chemical suit']);
const PPE_STD = text('PPE_STANDARD', 'Protection standard / class', 'COMPLIANCE', 'Marking on the item, e.g. EN ISO 20345 S3, EN 388 4X42C, EN 397, EN 166, EN 352 SNR 30, EN 149 FFP2.', 'EN ISO 20345 S3 SRC', 40);
const SIZE = text('SIZE', 'Size', 'DIMENSION', 'Size marked on the item.', '42 / L / 9', 20);

// Pipes, steel, paint
const PIPE_MAT = pick('PIPE_MATERIAL', 'Material', 'MATERIAL', 'Pipe material, stencilled along the pipe or on the mill certificate.', ['Carbon steel seamless', 'Carbon steel ERW', 'Galvanised steel', 'Stainless 304/304L', 'Stainless 316/316L', 'Copper', 'PVC-U', 'CPVC', 'HDPE', 'PPR', 'Ductile iron', 'GRP']);
const PIPE_STD = text('PIPE_STANDARD', 'Standard / grade', 'COMPLIANCE', 'E.g. ASTM A106 Gr B, ASTM A312 TP316L, EN 10255, ISO 4427.', 'ASTM A106 Gr B', 40);
const PIPE_END = pick('PIPE_END', 'Ends', 'CONNECTION', 'End preparation.', ['Plain', 'Bevelled', 'Threaded & coupled', 'Socket', 'Grooved', 'Flanged']);
const STEEL_FORM = pick('STEEL_FORM', 'Form', 'DIMENSION', 'Shape of the steel as delivered from the mill or stockist.', ['Plate', 'Sheet', 'Equal angle', 'Unequal angle', 'Channel (PFC/UPN)', 'I-beam (IPE/UB)', 'H-beam (HEA/UC)', 'Flat bar', 'Round bar', 'Square bar', 'Square hollow section', 'Rectangular hollow section', 'Chequer plate', 'Expanded mesh']);
const STEEL_GRADE = pick('STEEL_GRADE', 'Grade', 'MATERIAL', 'Material grade on the mill certificate.', ['S235', 'S275', 'S355', 'ASTM A36', 'ASTM A572 Gr 50', 'EN8 / C45', 'EN24 / 4340', 'Stainless 304', 'Stainless 316', 'Hardox / wear plate', 'Aluminium 5083', 'Aluminium 6061']);
const SECTION_DIMS = text('SECTION_DIMENSIONS', 'Dimensions', 'DIMENSION', 'Size in mm (e.g. 50x50x5 angle, 10 mm plate 2500x1250).', '50 x 50 x 5', 60);
const PAINT_TYPE = pick('PAINT_TYPE', 'Coating type', 'MATERIAL', 'Generic type.', ['Primer — zinc-rich', 'Primer — epoxy', 'Primer — alkyd', 'Intermediate — epoxy MIO', 'Topcoat — polyurethane', 'Topcoat — alkyd enamel', 'Topcoat — epoxy', 'Heat-resistant (silicone)', 'Floor coating', 'Road marking', 'Thinner']);
const RAL = text('RAL_COLOUR', 'Colour (RAL / BS code)', 'MATERIAL', 'Colour code on the tin, e.g. RAL 7035 light grey, RAL 5015 blue.', 'RAL 7035', 20);
const GLOSS = pick('GLOSS', 'Finish', 'MATERIAL', 'Surface finish.', ['Gloss', 'Semi-gloss', 'Satin', 'Matt']);

// Electrical misc
const PLC_MODULE = pick('PLC_MODULE_TYPE', 'Module type', 'MATERIAL', 'Function of the module.', ['CPU / controller', 'Digital input', 'Digital output', 'Digital I/O mixed', 'Analogue input', 'Analogue output', 'Temperature input (RTD/TC)', 'Communication module', 'Power supply', 'Counter / positioning', 'Safety I/O', 'Interface / bus coupler']);
const CHANNELS = int('CHANNELS', 'Number of channels', '', 'RATING', 'Inputs or outputs on the module.', '16', 0, 512);
const SIGNAL = pick('SIGNAL_TYPE', 'Signal type', 'RATING', 'Electrical signal.', ['24 V DC sinking', '24 V DC sourcing', '24 V DC relay', '120/230 V AC', '4–20 mA', '0–10 V', '±10 V', 'RTD', 'Thermocouple']);
const FIRMWARE = text('FIRMWARE_VERSION', 'Firmware / hardware version', 'IDENTITY', 'Version on the label (FS / V…). Replacements may need the same or a compatible version.', 'V4.2', 20);
const PLATFORM = text('CONTROL_PLATFORM', 'Product family', 'IDENTITY', 'PLC family, e.g. Siemens S7-1500, Allen-Bradley ControlLogix, Schneider M340.', 'Siemens S7-1500', 60);
const SCREEN = dec('SCREEN_SIZE_IN', 'Screen size', 'inch', 'DIMENSION', 'Diagonal size.', '7');
const BATTERY_CHEM = pick('BATTERY_CHEMISTRY', 'Battery chemistry', 'MATERIAL', 'Printed on the battery label. Never replace one chemistry with another without changing the charger settings.', ['Lead-acid VRLA / AGM', 'Lead-acid gel', 'Lead-acid flooded', 'Lithium-ion / LiFePO4', 'NiCd', 'NiMH', 'Alkaline / lithium primary']);
const VOLT_DC = dec('NOMINAL_VOLTAGE_V', 'Nominal voltage', 'V', 'RATING', 'Voltage on the label.', '12');
const CAPACITY_AH = dec('CAPACITY_AH', 'Capacity', 'Ah', 'RATING', 'Ampere-hours on the label.', '100');
const TERMINAL = text('TERMINAL_TYPE', 'Terminal type', 'CONNECTION', 'Terminal / post style.', 'M6 insert', 20);
const LAMP_TYPE = pick('LAMP_TYPE', 'Lamp technology', 'MATERIAL', 'Technology.', ['LED', 'Fluorescent tube (T8/T5)', 'Compact fluorescent', 'Metal halide', 'High-pressure sodium', 'Halogen', 'Induction']);
const WATT = dec('POWER_W', 'Power', 'W', 'RATING', 'Wattage printed on the lamp or luminaire label.', '150');
const LUMEN = int('LUMENS', 'Light output', 'lm', 'RATING', 'Lumens on the box.', '18000');
const CCT = pick('COLOUR_TEMPERATURE', 'Colour temperature', 'RATING', 'Light colour.', ['2700 K warm', '3000 K', '4000 K neutral', '5000 K', '6500 K daylight']);
const LAMP_BASE = pick('LAMP_BASE', 'Cap / base', 'CONNECTION', 'The fitting that goes into the holder (screw E27/E40, bayonet B22, pins G13 for tubes).', ['E27', 'E40', 'E14', 'B22', 'G13 (T8)', 'G5 (T5)', 'GU10', 'Integrated luminaire']);

// Assets
const CONVEYOR_TYPE = pick('CONVEYOR_TYPE', 'Conveyor type', 'MATERIAL', 'How the conveyor moves material: belt on rollers, powered rollers, chains, a screw (auger) or buckets.', ['Belt (troughed)', 'Belt (flat)', 'Roller (gravity)', 'Roller (powered)', 'Chain / slat', 'Screw (auger)', 'Bucket elevator', 'Drag chain', 'Overhead', 'Pneumatic', 'Vibratory', 'Modular plastic belt']);
const LENGTH_EQ = dec('EQUIPMENT_LENGTH_M', 'Length', 'm', 'DIMENSION', 'Overall length / centres.', '24');
const WIDTH_EQ = dec('EQUIPMENT_WIDTH_MM', 'Width', 'mm', 'DIMENSION', 'Belt or working width.', '800');
const CAPACITY_TPH = dec('CAPACITY_TPH', 'Capacity', 't/h', 'RATING', 'Design throughput.', '250');
const SPEED_MS = dec('SPEED_M_S', 'Speed', 'm/s', 'RATING', 'Design speed.', '1.6');
const INCLINE = dec('INCLINATION_DEG', 'Inclination', '°', 'DIMENSION', 'Slope angle.', '12', -90, 90);
const MATERIAL_HANDLED = text('MATERIAL_HANDLED', 'Material handled', 'RATING', 'What is moved, with density/lump size if bulk.', 'Clinker, 0–50 mm', 80);
const BOILER_TYPE = pick('BOILER_TYPE', 'Boiler type', 'MATERIAL', 'Fire-tube (hot gas in tubes inside a water shell) is most common in factories; water-tube for high pressure and large output.', ['Fire-tube (shell)', 'Water-tube', 'Electric', 'Thermal oil heater', 'Waste-heat recovery', 'Steam generator (coil)']);
const STEAM = dec('STEAM_CAPACITY_KGH', 'Steam capacity', 'kg/h', 'RATING', 'Rated evaporation (F&A 100 °C or actual).', '5000');
const DESIGN_P = dec('DESIGN_PRESSURE_BAR', 'Design pressure', 'bar', 'RATING', 'Maximum allowable working pressure on the nameplate.', '10.34');
const DESIGN_T = dec('DESIGN_TEMPERATURE_C', 'Design temperature', '°C', 'RATING', 'Maximum design temperature.', '200', -273);
const FUEL = pick('FUEL_TYPE', 'Fuel', 'RATING', 'Main fuel / energy source.', ['Diesel', 'Heavy fuel oil', 'Natural gas', 'LPG', 'Biomass / wood', 'Coal', 'Electricity', 'Dual fuel', 'Biogas', 'Petrol', 'Hybrid', 'Battery electric']);
const BURNER = text('BURNER_MODEL', 'Burner make / model', 'IDENTITY', 'From the burner nameplate.', 'Riello RS 190', 60);
const REG_NO = text('REGISTRATION_NUMBER', 'Statutory registration number', 'COMPLIANCE', 'Number given by the regulator (boiler, pressure vessel, lifting equipment, vehicle).', 'DOSHS/BLR/1234', 40);
const NEXT_INSPECT = def('NEXT_STATUTORY_INSPECTION', { name: 'Next statutory inspection due', dataType: 'date', domain: 'COMPLIANCE', description: 'Date on the current inspection certificate. MEMS uses it to remind you before it expires.' });
const PRIME_KVA = dec('PRIME_POWER_KVA', 'Prime power', 'kVA', 'RATING', 'Continuous (prime) rating on the generator plate.', '500');
const STANDBY_KVA = dec('STANDBY_POWER_KVA', 'Standby power', 'kVA', 'RATING', 'Emergency (standby) rating.', '550');
const ENGINE = text('ENGINE_MAKE_MODEL', 'Engine make / model', 'IDENTITY', 'From the engine plate.', 'Perkins 2506A-E15TAG2', 60);
const ALTERNATOR = text('ALTERNATOR_MAKE_MODEL', 'Alternator make / model', 'IDENTITY', 'From the alternator plate.', 'Stamford HCI544D', 60);
const TANK_L = dec('FUEL_TANK_L', 'Fuel tank capacity', 'L', 'DIMENSION', 'Base or day tank.', '800');
const ENCLOSURE = pick('GENSET_ENCLOSURE', 'Enclosure', 'MATERIAL', 'How the generator is housed: open frame in a room, silent canopy outdoors, or inside a container.', ['Open skid', 'Sound-attenuated canopy', 'Containerised', 'Weatherproof']);
const ATS = yes('ATS', 'Automatic transfer switch', 'RATING', 'Yes if it starts and changes over automatically on mains failure.');
const CONTROLLER = text('CONTROLLER_MODEL', 'Controller', 'IDENTITY', 'Control panel model.', 'DSE 7320', 40);
const HVAC_TYPE = pick('HVAC_TYPE', 'Equipment type', 'MATERIAL', 'Kind of cooling or air-handling equipment, from the nameplate or the HVAC drawings.', ['Air-cooled chiller', 'Water-cooled chiller', 'Split unit', 'Ducted split', 'VRF / VRV system', 'Air handling unit', 'Packaged rooftop unit', 'Cooling tower', 'Cold room', 'Heat pump']);
const COOL_KW = dec('COOLING_CAPACITY_KW', 'Cooling capacity', 'kW', 'RATING', 'Nominal capacity (1 TR = 3.517 kW; 12 000 BTU/h ≈ 3.5 kW).', '350');
const REFRIGERANT = pick('REFRIGERANT', 'Refrigerant', 'MATERIAL', 'Gas on the nameplate. Needed for leak repairs and regulatory phase-outs.', ['R134a', 'R410A', 'R32', 'R407C', 'R404A', 'R22 (phase-out)', 'R1234ze', 'R513A', 'R290 (propane)', 'R717 (ammonia)', 'R744 (CO2)']);
const REFRIG_KG = dec('REFRIGERANT_CHARGE_KG', 'Refrigerant charge', 'kg', 'RATING', 'Factory charge on the nameplate.', '42');
const MHE_TYPE = pick('MHE_TYPE', 'Truck type', 'MATERIAL', 'Counterbalance trucks have a heavy rear weight; reach trucks extend the mast forward; stackers are walk-behind.', ['Counterbalance forklift', 'Reach truck', 'Pallet stacker', 'Powered pallet truck', 'Hand pallet truck', 'Order picker', 'Telehandler', 'Side loader', 'Tow tractor']);
const LOAD_KG = dec('RATED_CAPACITY_KG', 'Rated capacity', 'kg', 'RATING', 'Safe working load on the capacity plate.', '2500');
const LIFT_MM = dec('LIFT_HEIGHT_MM', 'Lift height', 'mm', 'DIMENSION', 'Maximum fork height.', '4500');
const MAST = pick('MAST_TYPE', 'Mast', 'MATERIAL', 'Mast stages.', ['Simplex', 'Duplex', 'Duplex free-lift', 'Triplex', 'Quad']);
const TYRES = pick('TYRE_TYPE', 'Tyres', 'MATERIAL', 'Tyre type.', ['Pneumatic', 'Solid pneumatic', 'Cushion / press-on', 'Polyurethane', 'Non-marking']);
const VEHICLE_TYPE = pick('VEHICLE_TYPE', 'Vehicle type', 'MATERIAL', 'Body type as shown on the logbook (registration certificate).', ['Saloon car', 'Pick-up', 'SUV', 'Van', 'Minibus', 'Bus', 'Truck (rigid)', 'Prime mover', 'Trailer', 'Tanker', 'Tipper', 'Motorcycle', 'Tractor']);
const REG_PLATE = text('VEHICLE_REGISTRATION', 'Registration plate', 'IDENTITY', 'Number plate.', 'KDA 123A', 15);
const VIN = text('VIN', 'Chassis / VIN', 'IDENTITY', '17-character vehicle identification number on the logbook.', 'JTFSS22P900123456', 20);
const ENGINE_NO = text('ENGINE_NUMBER', 'Engine number', 'IDENTITY', 'From the logbook or engine block.', '1KD-1234567', 30);
const PAYLOAD = dec('PAYLOAD_KG', 'Payload / seating', 'kg', 'RATING', 'Payload in kg (or seats for passenger vehicles).', '3500');
const MACHINE_TYPE = pick('MACHINE_TOOL_TYPE', 'Machine type', 'MATERIAL', 'Kind of machine tool, as on its nameplate or manual.', ['Lathe (manual)', 'CNC lathe / turning centre', 'Milling machine (manual)', 'CNC machining centre', 'Drill press', 'Surface grinder', 'Cylindrical grinder', 'Press brake', 'Shear', 'Bandsaw', 'EDM', 'Laser cutter', 'Plasma cutter', 'Welding machine', 'Injection moulding', 'Hydraulic press']);
const CNC = pick('CNC_CONTROL', 'Control system', 'IDENTITY', 'CNC make (needed for programs and spare boards).', ['Manual (no CNC)', 'Fanuc', 'Siemens Sinumerik', 'Heidenhain', 'Mitsubishi', 'Haas', 'Mazak Mazatrol', 'Okuma OSP', 'Fagor', 'GSK', 'Other']);
const AXES = int('AXES', 'Number of axes', '', 'RATING', 'Controlled axes.', '3', 0, 12);
const TRAVEL = text('TRAVEL_XYZ', 'Travel X / Y / Z', 'DIMENSION', 'Axis travels in mm.', '1020 / 510 / 635 mm', 40);
const SPINDLE_KW = dec('SPINDLE_POWER_KW', 'Spindle power', 'kW', 'RATING', 'Main spindle motor power.', '22');
const SPINDLE_RPM = int('SPINDLE_SPEED_MAX', 'Maximum spindle speed', 'rpm', 'RATING', 'Top speed.', '12000');
const CRANE_TYPE = pick('CRANE_TYPE', 'Crane / hoist type', 'MATERIAL', 'Overhead (EOT) cranes run on rails across a building; jibs swing on a pillar or wall; hoists hang from a beam.', ['Overhead EOT single girder', 'Overhead EOT double girder', 'Gantry', 'Semi-gantry', 'Jib (pillar)', 'Jib (wall)', 'Monorail hoist', 'Electric chain hoist', 'Wire rope hoist', 'Manual chain block', 'Lever hoist', 'Mobile crane', 'Truck-mounted crane', 'Man lift / MEWP']);
const SWL = dec('SWL_TONNES', 'Safe working load (SWL)', 't', 'RATING', 'Marked on the crane/hoist (SWL/WLL).', '10');
const SPAN = dec('SPAN_M', 'Span', 'm', 'DIMENSION', 'Rail centres.', '18');
const LIFT_M = dec('HEIGHT_OF_LIFT_M', 'Height of lift', 'm', 'DIMENSION', 'Hook travel.', '9');
const VESSEL_TYPE = pick('VESSEL_TYPE', 'Vessel type', 'MATERIAL', 'Anything holding pressure (air receivers, autoclaves) is a statutory pressure vessel and needs periodic inspection.', ['Air receiver', 'Pressure vessel', 'Atmospheric storage tank', 'Silo', 'Reactor', 'Heat exchanger (shell & tube)', 'Plate heat exchanger', 'Autoclave', 'LPG tank']);
const VOLUME_M3 = dec('VOLUME_M3', 'Capacity', 'm³', 'DIMENSION', 'Volume (1 m³ = 1000 L).', '2');
const DESIGN_CODE = pick('DESIGN_CODE', 'Design code', 'COMPLIANCE', 'Code on the nameplate / data book.', ['ASME VIII Div 1', 'EN 13445', 'PD 5500', 'API 650', 'API 620', 'AD 2000', 'TEMA', 'Other']);
const HX_AREA = dec('HEAT_TRANSFER_AREA_M2', 'Heat transfer area', 'm²', 'DIMENSION', 'Surface area.', '45');
const CAPACITY_GENERIC = text('RATED_CAPACITY', 'Rated capacity / size', 'RATING', 'Main capacity of the equipment, with unit.', '1200 bottles/hour', 60);

// Services
const PROVIDER = pick('PROVIDER_TYPE', 'Provider type required', 'SERVICE', 'Who may do the work. Use OEM or OEM-authorised while equipment is under warranty or for safety-critical/proprietary systems; independent specialists for most repairs; general contractors for routine work.', PROVIDER_TYPE);
const EQUIP = text('EQUIPMENT_SERVICED', 'Equipment (make / model)', 'SERVICE', 'What the work is on. Give make, model and asset tag if known.', 'Atlas Copco GA75 compressor, AST-000123', 160);
const SCOPE = many('WORK_SCOPE', 'Scope of work', 'SERVICE', 'Tick everything that is included.', ['Inspection and report', 'Diagnosis / fault finding', 'Repair', 'Full overhaul', 'Refurbishment', 'Replacement / installation', 'Commissioning', 'Testing', 'Modification / upgrade']);
const LOCATION = pick('WORK_LOCATION', 'Where the work is done', 'SERVICE', 'On our site, or at the provider’s workshop.', ['On our site', 'Provider workshop', 'Either']);
const PARTS = pick('PARTS_SUPPLY', 'Who supplies spare parts', 'SERVICE', 'Avoid disputes later: decide who buys the parts.', ['Provider supplies (included)', 'Provider supplies (charged separately)', 'We supply from stores', 'Agree per job']);
const DELIVERABLES = many('DELIVERABLES', 'Required deliverables', 'SERVICE', 'Documents you must receive before the job is accepted and paid.', ['Service / job report', 'Test certificate', 'Calibration certificate', 'Before/after photos', 'Failure analysis (root cause)', 'As-left measurements', 'Updated drawings', 'Warranty certificate', 'Waste disposal certificate', 'Statutory inspection certificate']);
const SAFETY_REQ = many('SAFETY_REQUIREMENTS', 'Site safety requirements', 'SERVICE', 'Permits and controls the provider must follow on site.', ['Permit to work', 'Lock-out / tag-out (LOTO)', 'Hot work permit', 'Confined space entry', 'Work at height', 'Electrical isolation certificate', 'Excavation permit', 'Lifting plan', 'Site induction', 'Own PPE']);
const WARRANTY = int('WARRANTY_MONTHS', 'Workmanship warranty', 'months', 'SERVICE', 'Minimum warranty on the work.', '6', 0, 120);
const TURNAROUND = int('TURNAROUND_DAYS', 'Maximum turnaround', 'days', 'SERVICE', 'Days from collection/start to completion.', '10', 0, 365);
const RESPONSE = pick('RESPONSE_TIME', 'Response time on breakdown', 'SERVICE', 'How fast the provider must be on site after a call.', ['2 hours', '4 hours', '8 hours', 'Next working day', '48 hours', 'Not applicable']);
const FREQ_SERVICE = pick('SERVICE_FREQUENCY', 'Frequency', 'SERVICE', 'How often the service is performed.', ['One-off', 'Weekly', 'Monthly', 'Quarterly', 'Six-monthly', 'Annually', 'On call']);
const COVERAGE = pick('CONTRACT_COVERAGE', 'Contract coverage', 'SERVICE', 'What the price covers.', ['Labour only', 'Labour + consumables', 'Comprehensive (labour + parts)', 'Inspection only']);
const DURATION = int('CONTRACT_MONTHS', 'Contract duration', 'months', 'SERVICE', 'Length of the agreement.', '12', 1, 120);
const LICENCE = text('LICENCE_REQUIRED', 'Licence / registration required', 'COMPLIANCE', 'Regulator licence the provider must hold (e.g. EPRA electrical class A1, NCA category, NEMA waste licence, DOSHS approved person).', 'EPRA Class A1', 80);
const ACCREDITATION = yes('ACCREDITED_LAB', 'ISO/IEC 17025 accredited', 'COMPLIANCE', 'Yes if the certificate must come from an accredited laboratory (needed for audits, ISO 9001, legal metrology).');
const CAL_POINTS = int('CALIBRATION_POINTS', 'Calibration points', '', 'SERVICE', 'Number of test points across the range.', '5', 1, 50);
const INSTRUMENT = text('INSTRUMENT_TYPE', 'Instrument / equipment', 'SERVICE', 'What is calibrated, with range and accuracy needed.', 'Pressure gauge 0–16 bar, class 1.0', 160);
const NDT = many('INSPECTION_METHODS', 'Inspection methods', 'SERVICE', 'Methods required.', ['Visual (VT)', 'Ultrasonic (UT)', 'Thickness gauging', 'Magnetic particle (MT)', 'Dye penetrant (PT)', 'Radiography (RT)', 'Eddy current (ET)', 'Thermography', 'Vibration analysis', 'Oil analysis', 'Load test', 'Hydrostatic test']);
const PERSONNEL = text('PERSONNEL_QUALIFICATION', 'Personnel qualification', 'COMPLIANCE', 'Certification the technicians must hold (e.g. ISO 9712 / PCN Level 2, CSWIP, OEM certification).', 'ISO 9712 Level 2 UT', 80);
const REWIND_TESTS = many('REWIND_TESTS', 'Required tests', 'SERVICE', 'Tests the repairer must perform and report.', ['Insulation resistance (Megger)', 'Polarisation index', 'Winding resistance', 'Surge comparison', 'High-potential (hipot)', 'No-load run', 'Vibration', 'Core loss test']);
const VARNISH = pick('VARNISH_METHOD', 'Impregnation', 'SERVICE', 'VPI (vacuum pressure) is better for large or high-voltage motors.', ['Dip and bake', 'Trickle', 'Vacuum pressure impregnation (VPI)']);
const BEARINGS_INC = yes('BEARINGS_INCLUDED', 'Replace bearings', 'SERVICE', 'Yes to replace both bearings during the repair (recommended).');
const PROCESS_MACHINING = many('MACHINING_PROCESSES', 'Processes', 'SERVICE', 'Operations needed.', ['Turning', 'Milling', 'Grinding', 'Drilling / boring', 'Welding repair', 'Fabrication', 'Metal spraying / build-up', 'Dynamic balancing', 'Heat treatment', 'Coating / plating', 'Laser cladding']);
const DRAWING = text('DRAWING_REFERENCE', 'Drawing number / revision', 'SERVICE', 'Drawing or sample reference the work must match.', 'DRG-0045 rev C', 60);
const TOLERANCE = text('TOLERANCE', 'Critical tolerances', 'SERVICE', 'Key fits or tolerances.', 'Bearing seat Ø60 k6', 60);
const QTY = int('QUANTITY', 'Quantity', 'pcs', 'SERVICE', 'Number of pieces / units.', '2', 1);
const CLEAN_METHOD = many('CLEANING_METHOD', 'Cleaning method', 'SERVICE', 'Methods allowed.', ['High-pressure water jetting', 'Dry ice blasting', 'Chemical cleaning', 'Vacuum / suction', 'Steam cleaning', 'Manual', 'Abrasive blasting']);
const WASTE_TYPE = many('WASTE_TYPE', 'Waste type', 'SERVICE', 'What is collected.', ['Non-hazardous general', 'Hazardous', 'Used oil', 'Oily rags / filters', 'Scrap metal', 'E-waste', 'Chemicals', 'Medical / clinical', 'Construction debris', 'Sludge']);
const DISPOSAL_CERT = yes('DISPOSAL_CERTIFICATE', 'Disposal certificate required', 'COMPLIANCE', 'Yes for hazardous waste — the regulator expects proof of lawful disposal.');
const TRANSPORT_MODE = pick('TRANSPORT_MODE', 'Mode', 'SERVICE', 'How it moves.', ['Road', 'Sea', 'Air', 'Rail', 'Courier', 'Multimodal']);
const VEHICLE_REQ = text('VEHICLE_REQUIREMENT', 'Vehicle / equipment needed', 'SERVICE', 'E.g. 10 t flatbed with crane, 40 ft container, refrigerated truck.', '10 t flatbed with HIAB', 80);
const ROUTE = text('ROUTE', 'Route (from → to)', 'SERVICE', 'Origin and destination.', 'Mombasa port → Nairobi plant', 120);
const DG = yes('DANGEROUS_GOODS', 'Dangerous goods', 'COMPLIANCE', 'Yes if the load is classed dangerous (needs ADR/IMDG/IATA compliance and trained driver).');
const TRAINING_TOPIC = text('TRAINING_TOPIC', 'Training topic', 'SERVICE', 'Subject of the training.', 'Forklift operator certification', 120);
const PARTICIPANTS = int('PARTICIPANTS', 'Participants', 'people', 'SERVICE', 'Number of trainees.', '12', 1);
const DAYS = dec('DURATION_DAYS', 'Duration', 'days', 'SERVICE', 'Length of the course.', '3');
const CERT_ISSUED = yes('CERTIFICATE_ISSUED', 'Certificate issued', 'COMPLIANCE', 'Yes if each trainee must receive a certificate.');
const DELIVERY = pick('TRAINING_DELIVERY', 'Delivery', 'SERVICE', 'Where training happens.', ['On our site', 'Provider premises', 'Online', 'Blended']);
const DISCIPLINE = many('ENGINEERING_DISCIPLINE', 'Discipline', 'SERVICE', 'Engineering discipline(s).', ['Mechanical', 'Electrical', 'Civil / structural', 'Process / chemical', 'Instrumentation & control', 'Fire & safety', 'Environmental', 'Energy audit']);
const PROF_REG = text('PROFESSIONAL_REGISTRATION', 'Professional registration', 'COMPLIANCE', 'Registration the engineer must hold (e.g. EBK registered engineer, ECSA Pr Eng).', 'EBK Professional Engineer', 60);
const VOLTAGE_LEVEL = pick('VOLTAGE_LEVEL', 'Voltage level', 'SERVICE', 'Highest voltage involved.', ['Extra-low voltage (<50 V)', 'Low voltage (up to 1 kV)', 'Medium voltage (1–36 kV)', 'High voltage (>36 kV)']);
const LIFT_EQ = many('LIFTING_EQUIPMENT', 'Equipment to inspect', 'SERVICE', 'Lifting equipment covered.', ['Overhead cranes', 'Mobile cranes', 'Hoists / chain blocks', 'Forklifts', 'Slings / shackles / chains', 'Man lifts / MEWP', 'Lifts / elevators', 'Jacks']);
const LOAD_TEST = yes('LOAD_TEST_REQUIRED', 'Load test required', 'SERVICE', 'Yes if a proof load test is part of the inspection.');

alias(MANUFACTURER, ['manufacturer', 'brand', 'make', 'maker', 'producer', 'oem', 'oem name', 'manufacturer name']);
alias(MPN, ['part number', 'part no', 'manufacturer part number', 'mpn', 'catalogue number', 'catalog number', 'order number', 'order code', 'article number', 'oem part number']);
alias(MODEL, ['model', 'type', 'model number', 'type designation', 'model type']);
alias(SERIAL, ['serial', 'serial number', 'serial no', 's n']);
alias(YEAR, ['year', 'year built', 'manufacture year', 'year of manufacture']);
alias(POWER_KW, ['power', 'power kw', 'motor power', 'output power', 'kw', 'rated output']);
alias(VOLTAGE, ['voltage', 'supply voltage', 'operating voltage', 'voltage v']);
alias(FREQUENCY, ['frequency', 'hz']);
alias(IP_RATING, ['ip rating', 'ip', 'ip class', 'protection class', 'ingress protection', 'enclosure rating', 'degree of protection']);
alias(FRAME, ['frame', 'frame size', 'iec frame']);
alias(EFFICIENCY, ['efficiency', 'efficiency class', 'ie class']);
alias(SPEED_RPM, ['speed', 'rpm', 'speed rpm', 'motor speed']);
alias(POLES, ['poles', 'pole']);
alias(CURRENT_A, ['current', 'full load current', 'amps']);
alias(BORE_D, ['bore', 'inner diameter', 'inside diameter', 'id', 'bore diameter']);
alias(OUTER_D, ['outer diameter', 'outside diameter', 'od']);
alias(WIDTH_B, ['width']);
alias(BEARING_DESIGNATION, ['bearing number', 'designation', 'bearing designation']);
alias(WEIGHT, ['weight', 'mass', 'net weight']);
alias(FLOW, ['flow', 'flow rate', 'capacity flow']);
alias(HEAD, ['head', 'total head', 'pump head']);
alias(VALVE_SIZE, ['size', 'nominal size', 'dn']);
alias(PRESSURE_RATING, ['pressure class', 'pressure rating', 'pn rating']);
alias(BODY, ['body material', 'material of construction']);
alias(SEAL_MAT, ['seal material', 'elastomer', 'material']);
alias(STANDARD, ['standard', 'specification']);
alias(ORIGIN, ['country of origin', 'origin']);

// ---------------------------------------------------------------------------------------------------------------
// Archetypes (most specific first)
// ---------------------------------------------------------------------------------------------------------------
export type SupplyHint = 'OEM' | 'OCM' | 'GENERAL';
export interface Archetype {
    id: string;
    label: string;
    kinds: LibKind[];
    match: RegExp;
    exclude?: RegExp;
    required: string[];
    optional: string[];
    /** Attributes included in the short text, in order. */
    specific: string[];
    guidance: string;
    supply?: { usual: SupplyHint[]; note: string };
}
const A = (a: Archetype) => a;
const M = ['materials'] as LibKind[], AS = ['assets'] as LibKind[], MA = ['materials', 'assets'] as LibKind[], S = ['services'] as LibKind[];
const ID_MATERIAL = [MANUFACTURER, MPN, FITS, NOTES];
const ID_ASSET = [MANUFACTURER, MODEL, SERIAL, YEAR, ORIGIN];

const ARCHETYPES: Archetype[] = [
    // ----- Services (only applied to the service catalogue) -----
    A({ id: 'SVC_REWIND', label: 'Electric motor rewinding / repair', kinds: S, match: /rewind|motor (repair|overhaul)|armature|winding repair/i, required: [PROVIDER, POWER_KW, VOLTAGE, POLES, INSULATION, REWIND_TESTS], optional: [EQUIP, FRAME, BEARINGS_INC, VARNISH, WARRANTY, TURNAROUND, DELIVERABLES, LOCATION], specific: [POWER_KW, POLES], guidance: 'Copy power, voltage, speed and frame from the motor nameplate. Always ask for test results and new bearings.' }),
    A({ id: 'SVC_CALIBRATION', label: 'Calibration', kinds: S, match: /calibrat|verification of (instrument|gauge)|metrolog/i, required: [INSTRUMENT, ACCREDITATION, LOCATION], optional: [CAL_POINTS, FREQ_SERVICE, DELIVERABLES, TURNAROUND, PROVIDER], specific: [INSTRUMENT], guidance: 'State the instrument, its range and the accuracy you need. Use an ISO/IEC 17025 accredited lab for audit-critical instruments.' }),
    A({ id: 'SVC_LIFTING', label: 'Lifting equipment inspection & certification', kinds: S, match: /lifting (equipment|gear)|crane inspection|hoist inspection|load test|statutory inspection/i, required: [LIFT_EQ, LICENCE, LOAD_TEST], optional: [FREQ_SERVICE, DELIVERABLES, PERSONNEL, SAFETY_REQ], specific: [], guidance: 'Statutory inspections must be done by an approved person; keep each certificate and its expiry date.' }),
    A({ id: 'SVC_NDT', label: 'Inspection, NDT & condition monitoring', kinds: S, match: /\bndt\b|non-?destructive|inspection|ultrasonic test|thermograph|vibration (analysis|monitor)|oil analysis|condition monitor/i, required: [NDT, EQUIP, PERSONNEL], optional: [FREQ_SERVICE, DELIVERABLES, LICENCE, SAFETY_REQ, LOCATION], specific: [], guidance: 'Choose the methods and ask for technicians certified to ISO 9712 / PCN for NDT.' }),
    A({ id: 'SVC_PM_CONTRACT', label: 'Maintenance service contract', kinds: S, match: /maintenance contract|service contract|service agreement|amc\b|preventive maintenance|planned maintenance/i, required: [PROVIDER, EQUIP, FREQ_SERVICE, COVERAGE, RESPONSE], optional: [DURATION, DELIVERABLES, PARTS, SAFETY_REQ, WARRANTY], specific: [FREQ_SERVICE], guidance: 'Define what is covered, how often visits happen and how fast breakdowns are answered — these are what you will hold the provider to.' }),
    A({ id: 'SVC_ELECTRICAL', label: 'Electrical installation & works', kinds: S, match: /electrical (install|work|wiring|contract)|cabling|substation|switchgear (service|maintenance)|earthing|lightning protection/i, required: [PROVIDER, VOLTAGE_LEVEL, LICENCE, SCOPE], optional: [DELIVERABLES, SAFETY_REQ, LOCATION, WARRANTY], specific: [VOLTAGE_LEVEL], guidance: 'Electrical work must be done by a licensed contractor; ask for a test and completion certificate.' }),
    A({ id: 'SVC_MACHINING', label: 'Machining & fabrication', kinds: S, match: /machin|fabricat|welding (service|repair)|turning|milling|balancing|metalwork|metal spray/i, required: [PROCESS_MACHINING, DRAWING, QTY], optional: [TOLERANCE, LOCATION, TURNAROUND, DELIVERABLES, WARRANTY], specific: [DRAWING], guidance: 'Always give a drawing or a sample. List critical fits so the job is checked against them.' }),
    A({ id: 'SVC_CLEANING', label: 'Industrial cleaning', kinds: S, match: /cleaning|hydro-?jet|dry ice|tank clean|duct clean|janitor/i, required: [CLEAN_METHOD, LOCATION, FREQ_SERVICE], optional: [SAFETY_REQ, DELIVERABLES, WASTE_TYPE], specific: [FREQ_SERVICE], guidance: 'Confined-space or chemical cleaning needs permits — tick them under safety requirements.' }),
    A({ id: 'SVC_WASTE', label: 'Waste collection & disposal', kinds: S, match: /waste|disposal|scrap (collection|removal)|recycling|effluent/i, required: [WASTE_TYPE, LICENCE, DISPOSAL_CERT], optional: [FREQ_SERVICE, QTY, DELIVERABLES], specific: [], guidance: 'Use only licensed waste handlers and keep the disposal certificates — the generator stays responsible.' }),
    A({ id: 'SVC_TRANSPORT', label: 'Transport & logistics', kinds: S, match: /transport|logistic|haulage|freight|courier|shipping|clearing|forwarding|delivery service/i, required: [TRANSPORT_MODE, ROUTE, DG], optional: [VEHICLE_REQ, WEIGHT, DELIVERABLES], specific: [TRANSPORT_MODE, ROUTE], guidance: 'Give route and load. Dangerous goods need a compliant carrier and documentation.' }),
    A({ id: 'SVC_TRAINING', label: 'Training', kinds: S, match: /training|course|certification of (staff|operator)|competence/i, required: [TRAINING_TOPIC, PARTICIPANTS, DELIVERY], optional: [DAYS, CERT_ISSUED, LICENCE], specific: [TRAINING_TOPIC], guidance: 'Say who is trained and whether each person needs a certificate.' }),
    A({ id: 'SVC_ENGINEERING', label: 'Engineering & consultancy', kinds: S, match: /consult|engineering (design|service)|design service|audit|study|survey/i, required: [DISCIPLINE, DELIVERABLES], optional: [PROF_REG, DAYS, LOCATION], specific: [], guidance: 'Be specific about the deliverables (report, drawings, calculations) you will accept.' }),
    A({ id: 'SVC_REPAIR', label: 'Equipment repair & overhaul', kinds: S, match: /repair|overhaul|refurbish|reconditio|servic(e|ing)|maintenance|rebuild/i, required: [PROVIDER, EQUIP, SCOPE, LOCATION], optional: [PARTS, DELIVERABLES, SAFETY_REQ, WARRANTY, TURNAROUND], specific: [EQUIP], guidance: 'State the equipment make and model, what you expect done and the documents you need back. Use OEM or OEM-authorised providers while under warranty.' }),
    // ----- Electrical components (before motors, so "motor starter" is not a motor) -----
    A({ id: 'CONTACTOR', label: 'Contactor / motor starter', kinds: M, match: /contactor|motor starter|\bdol starter|star[- ]delta starter/i, required: [AC3_CURRENT, COIL, POLES_SW], optional: [AC3_KW, AUX, DIN_MOUNT, DEVICE_FRAME], specific: [AC3_CURRENT, COIL], guidance: 'Read the AC-3 current (or kW at 400 V) and coil voltage from the side of the contactor.', supply: { usual: ['OCM', 'GENERAL'], note: 'Widely available; keep the same maker if it mounts with auxiliary blocks or overload relays.' } }),
    A({ id: 'OVERLOAD', label: 'Overload relay / motor protection breaker', kinds: M, match: /overload relay|thermal relay|motor protection|\bmpcb\b|motor circuit breaker/i, required: [SETTING_RANGE, BREAKER_TYPE], optional: [ICU, POLES_SW, AUX, DIN_MOUNT], specific: [SETTING_RANGE], guidance: 'The setting range must include the motor full-load current.' }),
    A({ id: 'VFD', label: 'Variable speed drive (VFD / inverter)', kinds: MA, match: /variable (speed|frequency) drive|\bvfd\b|\bvsd\b|inverter drive|frequency (inverter|converter)|\bac drive|servo (drive|amplifier)/i, required: [POWER_KW, DRIVE_INPUT, CURRENT_A, DUTY_RATING, IP_RATING], optional: [CONTROL_MODE, COMMS, EMC, BRAKE_CHOPPER, STO, DEVICE_FRAME, FIRMWARE, MODEL], specific: [POWER_KW, DRIVE_INPUT, DUTY_RATING], guidance: 'Size by motor current, not just kW. Use heavy duty for conveyors, crushers and hoists.', supply: { usual: ['OCM', 'GENERAL'], note: 'Buy from the drive maker or an authorised distributor; parameters and firmware must be copied from the old drive.' } }),
    A({ id: 'SOFT_STARTER', label: 'Soft starter', kinds: MA, match: /soft\s*-?start/i, required: [POWER_KW, DRIVE_INPUT, CURRENT_A], optional: [COIL, COMMS, IP_RATING, DEVICE_FRAME, MODEL], specific: [POWER_KW, CURRENT_A], guidance: 'Rated current must be at least the motor nameplate current.' }),
    A({ id: 'BREAKER', label: 'Circuit breaker', kinds: MA, match: /circuit breaker|\bmcb\b|\bmccb\b|\bacb\b|\brcbo\b|\brccb\b|\brcd\b|earth leakage/i, required: [BREAKER_TYPE, IN_A, POLES_SW, ICU], optional: [TRIP_CURVE, RESIDUAL, VOLTAGE, DIN_MOUNT, AUX], specific: [BREAKER_TYPE, IN_A, TRIP_CURVE, POLES_SW], guidance: 'Copy the current (e.g. C16 → 16 A, curve C), number of poles and kA rating printed on the front.' }),
    A({ id: 'FUSE', label: 'Fuse', kinds: M, match: /\bfuses?\b|fuse link|hrc fuse/i, exclude: /fuse (holder|base|carrier|switch)/i, required: [IN_A, FUSE_TYPE, FUSE_SIZE], optional: [VOLTAGE, ICU], specific: [IN_A, FUSE_TYPE, FUSE_SIZE], guidance: 'Replace like for like: same amps, class (gG, aM, aR) and size.' }),
    A({ id: 'RELAY', label: 'Control relay / timer', kinds: M, match: /\brelays?\b|timer relay|time delay relay|safety relay/i, exclude: /overload relay|thermal relay|protection relay/i, required: [COIL, RELAY_CONTACTS], optional: [DIN_MOUNT, MODEL], specific: [COIL, RELAY_CONTACTS], guidance: 'Coil voltage and contacts are printed on the relay. Check the base/socket fits.' }),
    A({ id: 'WELDING', label: 'Welding consumable', kinds: M, match: /welding (rod|wire|electrode)|electrode|filler (rod|wire)|mig wire|tig rod/i, required: [WELD_PROCESS, WELD_CLASS, WIRE_DIA], optional: [PACK_KG, SHELF_LIFE], specific: [WELD_CLASS, WIRE_DIA], guidance: 'The AWS code (e.g. E7018) and diameter are on the box.' }),
    A({ id: 'CABLE', label: 'Electrical cable', kinds: M, match: /\bcables?\b|\bwire\b|conductor|flex(ible)? cord/i, exclude: /cable (tie|gland|lug|tray|ladder|marker|joint|termination|clamp|drum|pulling)|wire (rope|mesh|brush)|welding wire/i, required: [CABLE_TYPE, CORES, CSA, CONDUCTOR, CABLE_INSULATION, CABLE_VOLTAGE], optional: [ARMOUR, LENGTH_M, STANDARD], specific: [CORES, CSA, CABLE_INSULATION, ARMOUR], guidance: 'The cable sheath is printed with everything: e.g. “4C x 16 mm² Cu XLPE/SWA/PVC 0.6/1 kV”.' }),
    // ----- Sensors, instruments and controls -----
    A({ id: 'PROXIMITY', label: 'Proximity / presence sensor', kinds: M, match: /proximity|inductive sensor|capacitive sensor|reed switch|cylinder sensor|ultrasonic sensor/i, required: [SENSOR_PRINCIPLE, HOUSING, SENSE_RANGE, SWITCH_OUT, SUPPLY_DC, CONNECTION_EL], optional: [FLUSH, IP_RATING, BODY], specific: [SENSOR_PRINCIPLE, HOUSING, SWITCH_OUT, SENSE_RANGE], guidance: 'Thread size, sensing distance and PNP/NPN are on the sensor label. PNP/NPN must match the machine — fitting the wrong type will not work.', supply: { usual: ['OCM', 'GENERAL'], note: 'Standard sensors are interchangeable across brands when size, range, output and connector match.' } }),
    A({ id: 'PHOTOELECTRIC', label: 'Photoelectric sensor', kinds: M, match: /photo-?electric|photo ?cell|photo sensor|light barrier|optical sensor|laser sensor/i, required: [SENSOR_PRINCIPLE, SENSE_RANGE, SWITCH_OUT, SUPPLY_DC, CONNECTION_EL], optional: [LIGHT, HOUSING, IP_RATING], specific: [SENSOR_PRINCIPLE, SWITCH_OUT, SENSE_RANGE], guidance: 'Check the sensing mode: diffuse sees the object directly; retro-reflective needs a reflector; through-beam needs a separate receiver.' }),
    A({ id: 'PRESSURE_TX', label: 'Pressure transmitter / switch / gauge', kinds: MA, match: /pressure (transmitter|transducer|sensor|switch|gauge)|manometer|\bdp (transmitter|cell)/i, required: [MEAS_RANGE, PRESSURE_TYPE, ANALOG_OUT, PROCESS_CONN], optional: [WETTED, ACCURACY, CONNECTION_EL, EX, IP_RATING, MODEL], specific: [MEAS_RANGE, ANALOG_OUT, PROCESS_CONN], guidance: 'Range, output and thread are on the label. For gauges choose output “none” and give the dial size in notes.' }),
    A({ id: 'TEMP_SENSOR', label: 'Temperature sensor / thermometer', kinds: MA, match: /temperature (sensor|probe|transmitter|element)|thermocouple|\brtd\b|pt-?100|pt-?1000|thermometer|thermowell|temperature (gauge|switch)/i, required: [TEMP_ELEMENT, MEAS_RANGE, SHEATH_D, INSERTION, PROCESS_CONN], optional: [WIRES, ANALOG_OUT, WETTED, EX], specific: [TEMP_ELEMENT, SHEATH_D, INSERTION], guidance: 'Measure the probe diameter and length that goes into the pipe; the element type is on the head or cable.' }),
    A({ id: 'FLOWMETER', label: 'Flow meter', kinds: MA, match: /flow ?meter|flow (transmitter|sensor|switch)|rotameter|water meter/i, required: [FLOW_PRINCIPLE, LINE_SIZE, PROCESS_CONN, MEAS_RANGE, ANALOG_OUT], optional: [LINER, WETTED, ACCURACY, MEDIUM, EX, IP_RATING], specific: [FLOW_PRINCIPLE, LINE_SIZE], guidance: 'Give the pipe size and the fluid; the principle decides what fluids it can measure.' }),
    A({ id: 'LEVEL', label: 'Level sensor / switch', kinds: MA, match: /level (sensor|transmitter|switch|gauge|probe)|float switch|tuning fork|vibrating fork/i, required: [LEVEL_PRINCIPLE, MEAS_RANGE, ANALOG_OUT, PROCESS_CONN], optional: [WETTED, MEDIUM, EX, IP_RATING], specific: [LEVEL_PRINCIPLE, MEAS_RANGE], guidance: 'State what is in the tank (liquid, powder, foam) and the tank height.' }),
    A({ id: 'ENCODER', label: 'Encoder', kinds: M, match: /encoder|resolver/i, required: [ENC_TYPE, RESOLUTION, ENC_SHAFT, ENC_OUT, SUPPLY_DC], optional: [SHAFT_D, CONNECTION_EL, IP_RATING], specific: [ENC_TYPE, RESOLUTION, ENC_OUT], guidance: 'Resolution and interface are on the encoder label; both must match the drive or PLC.' }),
    A({ id: 'SOLENOID_VALVE', label: 'Solenoid / directional valve', kinds: M, match: /solenoid valve|directional (control )?valve|pneumatic valve|\b[35]\/[23] valve/i, required: [VALVE_FUNCTION, PORT_SIZE, COIL, MEDIUM], optional: [PRESSURE_RANGE, BODY, SEAL_MAT, ACTUATION, CONNECTION_EL, EX], specific: [VALVE_FUNCTION, PORT_SIZE, COIL], guidance: 'Function (e.g. 5/2), port thread and coil voltage are marked on the valve body and coil.' }),
    A({ id: 'PLC', label: 'PLC / controller module', kinds: M, match: /\bplc\b|programmable (logic )?controller|i\/o module|input module|output module|\bcpu\b|bus coupler|remote i\/o/i, required: [PLATFORM, PLC_MODULE, MODEL], optional: [CHANNELS, SIGNAL, FIRMWARE, COMMS], specific: [PLATFORM, PLC_MODULE, CHANNELS], guidance: 'Copy the full order number and version from the module label (e.g. 6ES7 521-1BL00-0AB0, FS 03). Firmware version matters for replacements.', supply: { usual: ['OCM', 'OEM'], note: 'Buy genuine modules from the control-system maker or its authorised distributor; beware of grey-market units.' } }),
    A({ id: 'HMI', label: 'Operator panel (HMI)', kinds: M, match: /\bhmi\b|operator panel|touch ?panel|touch ?screen/i, required: [PLATFORM, SCREEN, MODEL], optional: [COMMS, FIRMWARE, SUPPLY_DC, IP_RATING], specific: [PLATFORM, SCREEN], guidance: 'Keep a backup of the HMI program — a new panel needs it loaded.' }),
    A({ id: 'BATTERY', label: 'Battery / UPS battery', kinds: M, match: /battery|batteries|\bups\b/i, required: [BATTERY_CHEM, VOLT_DC, CAPACITY_AH], optional: [TERMINAL, WEIGHT, SHELF_LIFE], specific: [VOLT_DC, CAPACITY_AH, BATTERY_CHEM], guidance: 'Voltage, Ah and terminal type are on the battery label. Replace all batteries in a string together.' }),
    A({ id: 'LAMP', label: 'Lamp / luminaire', kinds: M, match: /\blamps?\b|luminaire|light fitting|floodlight|bulb|led (tube|light|panel)/i, required: [LAMP_TYPE, WATT, VOLTAGE], optional: [LUMEN, CCT, LAMP_BASE, IP_RATING, EX], specific: [LAMP_TYPE, WATT, LAMP_BASE], guidance: 'Wattage, cap/base and colour temperature are on the lamp or box.' }),
    // ----- Mechanical components (before equipment, so "motor bearing" is a bearing) -----
    A({ id: 'BEARING_HOUSING', label: 'Bearing housing / unit', kinds: M, match: /pillow block|plummer block|bearing (housing|unit)|flange(d)? (bearing|unit)|\buc[pft]\w*\d/i, required: [HOUSING_TYPE, SHAFT_FOR, INSERT], optional: [HOUSING_MAT, SEALING, LUBE], specific: [HOUSING_TYPE, INSERT], guidance: 'The housing number and insert bearing number are cast/stamped on the unit (e.g. UCP208 = pillow block for a 40 mm shaft).' }),
    A({ id: 'BUSH', label: 'Plain bearing / bush', kinds: M, match: /\bbush(es|ing)?\b|plain bearing|sleeve bearing|journal bearing|white metal bearing/i, exclude: /taper bush|bushing (insulator|transformer)/i, required: [PLAIN_MAT, BORE_D, OUTER_D, WIDTH_B], optional: [FLANGED, FITS], specific: [PLAIN_MAT, BORE_D, OUTER_D, WIDTH_B], guidance: 'Measure inner diameter, outer diameter and length (mm).' }),
    A({ id: 'BEARING', label: 'Rolling bearing', kinds: M, match: /bearing/i, exclude: /bearing (housing|puller|heater|grease|fitting tool|unit)|pillow block|plummer/i, required: [BEARING_DESIGNATION, BEARING_TYPE, BORE_D, OUTER_D, WIDTH_B], optional: [SEALING, CLEARANCE, CAGE, PRECISION, LUBE, BORE_FORM, DYN_LOAD], specific: [BEARING_DESIGNATION, SEALING, CLEARANCE], guidance: 'The number stamped on the bearing ring (e.g. 6205-2RS/C3) identifies it completely. Suffixes matter: 2RS = sealed, ZZ = shielded, C3 = extra clearance.', supply: { usual: ['OCM', 'GENERAL'], note: 'Bearings are standard parts: buy from the bearing maker (OCM, e.g. SKF, FAG, NSK) or a general distributor using the full number — not from the machine OEM at OEM prices.' } }),
    A({ id: 'COUPLING', label: 'Shaft coupling', kinds: M, match: /coupling/i, exclude: /pipe coupling|hose coupling|quick coupling|camlock|fluid coupling repair/i, required: [COUPLING_TYPE, COUPLING_SIZE, BORES], optional: [MAX_TORQUE, ELEMENT_MAT, TAPER_BUSH], specific: [COUPLING_TYPE, COUPLING_SIZE, BORES], guidance: 'The coupling size number is on the hub. Measure both shaft diameters.' }),
    A({ id: 'TIMING_BELT', label: 'Timing / synchronous belt', kinds: M, match: /timing belt|synchronous belt|toothed belt|htd belt/i, required: [TIMING_PROFILE, TEETH, BELT_WIDTH], optional: [BELT_LENGTH, BELT_MATERIAL], specific: [TIMING_PROFILE, BELT_LENGTH, BELT_WIDTH], guidance: 'The code on the back (e.g. 1200-8M-30) gives length, profile and width.' }),
    A({ id: 'CONVEYOR_BELT', label: 'Conveyor belting', kinds: M, match: /conveyor belt|belting/i, required: [CONVEYOR_BELT_TYPE, BELT_WIDTH, BELT_RATING, COVER_GRADE], optional: [COVERS, LENGTH_M, SPLICE, THICKNESS], specific: [CONVEYOR_BELT_TYPE, BELT_WIDTH, BELT_RATING], guidance: 'Belt rating (e.g. EP630/4) and cover thickness are on the belt edge or old order.' }),
    A({ id: 'VBELT', label: 'V-belt / wedge belt', kinds: M, match: /v-?belt|vee belt|wedge belt|fan belt|poly-?v|ribbed belt|\bbelts?\b/i, exclude: /conveyor|timing|seat belt|safety belt|pulley|sheave|belt (scale|cleaner|scraper|guard|tensioner)/i, required: [VBELT_SECTION, BELT_LENGTH, LENGTH_BASIS], optional: [BELT_BUILD, MATCHED_SET], specific: [VBELT_SECTION, BELT_LENGTH], guidance: 'The code printed on the belt (e.g. SPB 2000) is section + length. On multi-belt drives order a matched set.', supply: { usual: ['OCM', 'GENERAL'], note: 'Standard sections are interchangeable between brands.' } }),
    A({ id: 'CHAIN', label: 'Roller chain', kinds: M, match: /roller chain|transmission chain|drive chain|conveyor chain|\bchain\b/i, exclude: /chain (block|hoist|sling|guard|tensioner)|sprocket/i, required: [CHAIN_PITCH, STRANDS, LENGTH_M], optional: [CHAIN_MAT, ATTACHMENTS, STANDARD], specific: [CHAIN_PITCH, STRANDS], guidance: 'The chain number is stamped on the side plates (e.g. 08B-1 or 40).' }),
    A({ id: 'SPROCKET', label: 'Sprocket', kinds: M, match: /sprocket/i, required: [CHAIN_PITCH, TEETH, STRANDS, SPROCKET_BORE], optional: [BORES, TAPER_BUSH], specific: [CHAIN_PITCH, TEETH], guidance: 'Count the teeth and read the chain size it runs with.' }),
    A({ id: 'PULLEY', label: 'Pulley / sheave', kinds: M, match: /pulley|sheave/i, exclude: /conveyor pulley|pulley lagging/i, required: [VBELT_SECTION, GROOVES, PITCH_DIA, SPROCKET_BORE], optional: [TAPER_BUSH, BORES], specific: [VBELT_SECTION, GROOVES, PITCH_DIA], guidance: 'The code on the pulley (e.g. SPB 200-3-2012) gives section, diameter, grooves and bush.' }),
    // ----- Seals, filters, hoses and piping -----
    A({ id: 'MECH_SEAL', label: 'Mechanical seal', kinds: M, match: /mechanical seal|cartridge seal|pump seal/i, required: [MECH_SEAL_TYPE, SHAFT_FOR, FACES, SEAL_MAT], optional: [MECH_SEAL_STD, SPRING_TYPE, FITS], specific: [MECH_SEAL_TYPE, SHAFT_FOR, FACES], guidance: 'Give the pump make/model and shaft size; the seal maker’s code is usually on the gland plate or old box.', supply: { usual: ['OCM', 'OEM'], note: 'Buy from the seal maker (OCM, e.g. John Crane, EagleBurgmann) with the pump details, or from the pump OEM.' } }),
    A({ id: 'OIL_SEAL', label: 'Oil seal / shaft seal', kinds: M, match: /oil seal|shaft seal|lip seal|radial (shaft )?seal|rotary seal|v-?ring seal/i, required: [SEAL_D, SEAL_DD, SEAL_B, LIP_TYPE, SEAL_MAT], optional: [ORING_STD, FOOD], specific: [SEAL_D, SEAL_DD, SEAL_B, LIP_TYPE, SEAL_MAT], guidance: 'The three numbers on the seal (e.g. 40x62x8) are shaft × housing × width in mm.', supply: { usual: ['GENERAL', 'OCM'], note: 'Sizes are standard: any seal supplier can supply by size, type and material.' } }),
    A({ id: 'ORING', label: 'O-ring', kinds: M, match: /o-?rings?\b|\bo ring/i, required: [ORING_ID, ORING_CS, SEAL_MAT, HARDNESS], optional: [ORING_STD, FOOD, PACK_QTY, SHELF_LIFE], specific: [ORING_ID, ORING_CS, SEAL_MAT], guidance: 'Measure the inside diameter and the thickness (cross-section). Choose material for the fluid: NBR for oil, EPDM for hot water/steam, FKM for heat/chemicals.' }),
    A({ id: 'GASKET', label: 'Gasket', kinds: M, match: /gasket/i, required: [GASKET_TYPE, GASKET_MAT, VALVE_SIZE, PRESSURE_RATING], optional: [FLANGE_STD, THICKNESS, MAX_TEMP], specific: [GASKET_TYPE, VALVE_SIZE, PRESSURE_RATING, GASKET_MAT], guidance: 'Flange gaskets are ordered by pipe size + pressure class + material (e.g. DN100 PN16 graphite).' }),
    A({ id: 'PACKING', label: 'Gland packing', kinds: M, match: /gland packing|packing (cord|rope|ring)|compression packing/i, required: [PACKING_MAT, PACKING_SIZE], optional: [LENGTH_M, MEDIUM, MAX_TEMP], specific: [PACKING_MAT, PACKING_SIZE], guidance: 'Measure the gap between shaft and stuffing box — that is the packing size.' }),
    A({ id: 'FILTER', label: 'Filter / filter element', kinds: M, match: /filter|strainer element|separator element/i, exclude: /filter (regulator|housing)|frl/i, required: [FILTER_APP, MICRON, FILTER_DIMS], optional: [FILTER_CLASS, MEDIA, SEAL_MAT, FITS], specific: [FILTER_APP, MICRON], guidance: 'Copy the number printed on the old element and give the machine it fits. Equivalent elements from filter makers (OCM) are often far cheaper than OEM-branded ones.', supply: { usual: ['OCM', 'GENERAL'], note: 'Filter makers (e.g. Donaldson, Mann, Parker) publish cross-references to OEM numbers.' } }),
    A({ id: 'HOSE', label: 'Hose / hose assembly', kinds: M, match: /\bhoses?\b|hose assembly/i, exclude: /hose (clamp|clip|reel)/i, required: [HOSE_APP, HOSE_ID, MAX_PRESSURE_BAR, END_FITTINGS], optional: [HOSE_STD, LENGTH_M, MAX_TEMP], specific: [HOSE_APP, HOSE_ID, HOSE_STD], guidance: 'The hose layline shows the standard and size (e.g. 2SN -08). Measure total length including fittings.' }),
    A({ id: 'PIPE_FITTING', label: 'Pipe fitting / flange', kinds: M, match: /elbow|\btee\b|(concentric|eccentric|pipe) reducer|reducer fitting|pipe fitting|\bunion\b|\bnipple\b|socket fitting|flange(s)?\b/i, exclude: /flange(d)? (bearing|unit|motor)/i, required: [FITTING_TYPE, VALVE_SIZE, SCHEDULE, PIPE_MAT], optional: [END_CONN, PRESSURE_RATING, PIPE_STD], specific: [FITTING_TYPE, VALVE_SIZE, SCHEDULE, PIPE_MAT], guidance: 'Give the pipe size, wall schedule and material — they must match the pipe.' }),
    A({ id: 'PIPE', label: 'Pipe / tube', kinds: M, match: /\bpipes?\b|\btubes?\b|tubing/i, exclude: /pipe (fitting|clamp|wrench)|fluorescent tube|test tube|tube light/i, required: [PIPE_MAT, VALVE_SIZE, SCHEDULE], optional: [PIPE_STD, PIPE_END, LENGTH_M], specific: [PIPE_MAT, VALVE_SIZE, SCHEDULE], guidance: 'Nominal size and schedule are stencilled on the pipe.' }),
    // ----- Consumables -----
    A({ id: 'GREASE', label: 'Grease', kinds: M, match: /grease/i, exclude: /grease (gun|nipple|fitting|pump)/i, required: [THICKENER, NLGI, BASE_VISC, PACK_L], optional: [EP, NSF_H1, BASE_OIL, PRODUCT_NAME, AMBIENT, SHELF_LIFE], specific: [THICKENER, NLGI, PACK_L], guidance: 'Thickener type and NLGI grade are on the tub. Mixing incompatible greases causes bearing failures.' }),
    A({ id: 'OIL', label: 'Lubricating oil', kinds: M, match: /\boil\b|lubricant|lube/i, exclude: /oil (seal|filter|pump|cooler|level|analysis)|grease/i, required: [LUBE_APP, ISO_VG, BASE_OIL, PACK_L], optional: [LUBE_SPEC, NSF_H1, PRODUCT_NAME, SHELF_LIFE], specific: [LUBE_APP, ISO_VG, PACK_L], guidance: 'Grade (e.g. ISO VG 68) and specification are on the drum. Use what the machine manual specifies.' }),
    A({ id: 'ABRASIVE', label: 'Abrasive / cutting tool', kinds: M, match: /cutting disc|grinding (disc|wheel)|flap disc|abrasive|drill bit|end mill|saw blade|hole saw|turning insert|thread(ing)? tap/i, required: [ABRASIVE_TYPE, TOOL_DIA, SUIT_FOR], optional: [MAX_RPM, GRIT, PACK_QTY], specific: [ABRASIVE_TYPE, TOOL_DIA], guidance: 'Diameter and maximum speed are printed on the disc — never fit a disc rated below the tool speed.' }),
    A({ id: 'PPE', label: 'Personal protective equipment', kinds: M, match: /\bppe\b|safety (boot|shoe|helmet|glass|goggle|harness|vest)|gloves?|helmet|goggles|respirator|ear ?(plug|muff)|coverall|overall|hi-?vis|harness|face shield/i, exclude: /wiring harness|cable harness|loom/i, required: [PPE_TYPE, PPE_STD, SIZE], optional: [PACK_QTY, SHELF_LIFE], specific: [PPE_TYPE, PPE_STD, SIZE], guidance: 'The protection standard (e.g. EN 388, S3) is marked on the item; it must match your risk assessment.' }),
    A({ id: 'FASTENER', label: 'Fastener', kinds: M, match: /\bbolts?\b|\bnuts?\b|\bscrews?\b|\bwashers?\b|\bstuds?\b|anchor|fastener|threaded rod|\brivets?\b/i, exclude: /screw (pump|conveyor|compressor|jack)|wheel nut tool/i, required: [FASTENER_TYPE, THREAD, THREAD_D, PROPERTY_CLASS, FINISH], optional: [FASTENER_L, STANDARD, PACK_QTY], specific: [FASTENER_TYPE, THREAD_D, FASTENER_L, PROPERTY_CLASS, FINISH], guidance: 'Size is written M12x50 (diameter × length). The strength class (8.8, 10.9) is stamped on the head.', supply: { usual: ['GENERAL'], note: 'Standard fasteners: any general supplier, by size, class and finish.' } }),
    A({ id: 'SPRING', label: 'Spring', kinds: M, match: /\bsprings?\b/i, exclude: /gas spring strut|spring washer/i, required: [SPRING_KIND, WIRE_D, OUTER_D, FREE_L], optional: [FITS], specific: [SPRING_KIND, WIRE_D, OUTER_D, FREE_L], guidance: 'Measure wire thickness, outside diameter and free length.' }),
    A({ id: 'CHEMICAL', label: 'Chemical', kinds: M, match: /chemical|acid|caustic|solvent|detergent|degreaser|biocide|coolant|antifreeze|adhesive|sealant|resin|reagent/i, required: [GHS, SDS, PACK_L], optional: [CONCENTRATION, UN, STORAGE_T, SHELF_LIFE, PRODUCT_NAME], specific: [CONCENTRATION, PACK_L], guidance: 'A current safety data sheet (SDS) is required before storing or using any chemical.' }),
    A({ id: 'STEEL', label: 'Steel section / plate', kinds: M, match: /steel (plate|sheet|bar|section|angle|channel|beam)|\bangle iron|flat bar|round bar|hollow section|\bi-?beam|h-?beam|chequer plate/i, required: [STEEL_FORM, STEEL_GRADE, SECTION_DIMS], optional: [LENGTH_M, THICKNESS, STANDARD], specific: [STEEL_FORM, SECTION_DIMS, STEEL_GRADE], guidance: 'Ask for the mill certificate for structural and pressure uses.' }),
    A({ id: 'PAINT', label: 'Paint / coating', kinds: M, match: /paint|coating|primer|enamel|thinner|varnish/i, required: [PAINT_TYPE, RAL, PACK_L], optional: [GLOSS, PRODUCT_NAME, SHELF_LIFE], specific: [PAINT_TYPE, RAL], guidance: 'Use the same system (primer + topcoat) your specification requires.' }),
    // ----- Equipment (materials and asset classes) -----
    A({ id: 'GEARMOTOR', label: 'Gear motor', kinds: MA, match: /gear\s*-?motor|geared motor|motoreduc|motor reducer/i, required: [POWER_KW, VOLTAGE, FREQUENCY, OUT_SPEED, RATIO, GEAR_TYPE, OUTPUT_SHAFT, MOUNT_POS], optional: [OUT_TORQUE, SERVICE_FACTOR, IP_RATING, EFFICIENCY, BRAKE, OIL_SPEC, SHAFT_D, THERMAL_PROT, WEIGHT], specific: [POWER_KW, OUT_SPEED, GEAR_TYPE, OUTPUT_SHAFT], guidance: 'Read kW, output rpm and ratio from the gear motor nameplate. Mounting position (M1–M6) sets the oil level — match it exactly.', supply: { usual: ['OEM', 'OCM'], note: 'Gear motors are maker-specific: buy from the maker or its distributor, quoting the full type code.' } }),
    A({ id: 'SERVO_MOTOR', label: 'Servo motor', kinds: MA, match: /servo\s*-?motor|servomotor|\bservo\b/i, exclude: /servo (drive|amplifier|valve)/i, required: [TORQUE_RATED, SPEED_RPM, VOLTAGE, ENCODER_FB, BRAKE], optional: [TORQUE_PEAK, POWER_KW, SHAFT_D, IP_RATING, CONNECTION_EL, FIRMWARE], specific: [TORQUE_RATED, SPEED_RPM, ENCODER_FB], guidance: 'Servo motors must match the drive and feedback type exactly — copy the full order number from the nameplate.', supply: { usual: ['OEM', 'OCM'], note: 'Usually only available from the motor maker or the machine builder.' } }),
    A({ id: 'DC_MOTOR', label: 'DC motor', kinds: MA, match: /\bdc motor|direct current motor|shunt motor|series motor/i, required: [POWER_KW, DC_FIELD, SPEED_RPM, FRAME], optional: [VOLT_DC, CURRENT_A, IP_RATING, COOLING, SHAFT_D, BEARING_DE, BEARING_NDE], specific: [POWER_KW, SPEED_RPM], guidance: 'Record armature and field voltages from the nameplate in the notes.', supply: { usual: ['OCM', 'OEM'], note: 'Buy by maker type code; brushes and commutator parts are maker-specific.' } }),
    A({ id: 'MOTOR', label: 'Electric motor (AC)', kinds: MA, match: /\b(electric |induction |ac |three[- ]phase |squirrel cage |electrical )?motors?\b/i, exclude: /motor (vehicle|cycle|car|grader|oil|starter|protect|control centre|control center|circuit breaker|brush|cover|fan cover|terminal|base plate|mount)|motorcycle|motor-?bike|hydraulic motor|air motor|orbital motor|\bmcc\b/i, required: [POWER_KW, VOLTAGE, FREQUENCY, POLES, FRAME, MOUNTING_IM, IP_RATING, EFFICIENCY], optional: [PHASES, SPEED_RPM, CURRENT_A, INSULATION, DUTY, COOLING, SHAFT_D, SHAFT_L, BEARING_DE, BEARING_NDE, THERMAL_PROT, BRAKE, INVERTER_DUTY, TERMINAL_BOX, EX, WEIGHT, STANDARD], specific: [POWER_KW, POLES, FRAME, MOUNTING_IM, VOLTAGE], guidance: 'Everything you need is on the motor nameplate: kW, volts, Hz, rpm (→ poles), frame (e.g. 132M), IP and IE class. A motor with the same kW, poles, frame and mounting is interchangeable between brands.', supply: { usual: ['OCM', 'GENERAL'], note: 'Standard IEC motors are interchangeable: buy from the motor maker (OCM) or any distributor. Use OEM only for special motors built into a machine.' } }),
    A({ id: 'TRANSFORMER', label: 'Transformer', kinds: MA, match: /transformer/i, exclude: /current transformer|\bct\b|instrument transformer/i, required: [KVA, PRIMARY_V, SECONDARY_V, VECTOR, TX_TYPE], optional: [TX_COOLING, IMPEDANCE, TAPS, FREQUENCY, WEIGHT, STANDARD, REG_NO], specific: [KVA, PRIMARY_V, SECONDARY_V], guidance: 'All values are on the transformer rating plate. Vector group and impedance matter if it runs in parallel with another.' }),
    A({ id: 'HYD_PUMP', label: 'Hydraulic pump / motor', kinds: MA, match: /hydraulic (pump|motor)|piston pump|gear pump hydraulic|orbital motor/i, required: [HYD_PUMP_TYPE, DISPLACEMENT, MAX_PRESSURE_BAR, SAE_FLANGE], optional: [SPEED_RPM, MODEL, SEAL_KIT], specific: [HYD_PUMP_TYPE, DISPLACEMENT], guidance: 'Displacement and the full type code are on the pump label.', supply: { usual: ['OCM', 'OEM'], note: 'Buy by maker type code (e.g. Rexroth A10VSO…).' } }),
    A({ id: 'PD_PUMP', label: 'Positive displacement pump', kinds: MA, match: /gear pump|lobe pump|screw pump|progressive cavity|mono pump|diaphragm pump|\baodd\b|dosing pump|metering pump|plunger pump|peristaltic|vane pump/i, required: [PD_TYPE, FLOW, DISCHARGE_P, SUCTION, DISCHARGE, CASING_MAT], optional: [VISCOSITY, LIQUID, MAX_TEMP, SEAL_MAT, SHAFT_SEAL, POWER_KW, MODEL], specific: [PD_TYPE, FLOW, DISCHARGE_P], guidance: 'Give flow, pressure and the liquid (with viscosity). Check the elastomer suits the liquid.' }),
    A({ id: 'PUMP', label: 'Centrifugal pump', kinds: MA, match: /\bpumps?\b|centrifugal|borehole pump|submersible/i, exclude: /pump (seal|impeller|spare|part|shaft|sleeve|casing|kit|repair)|heat pump|grease pump|fuel pump/i, required: [PUMP_TYPE, FLOW, HEAD, SUCTION, DISCHARGE, POWER_KW, CASING_MAT, SHAFT_SEAL], optional: [SPEED_RPM, IMPELLER_D, IMPELLER_TYPE, IMPELLER_MAT, LIQUID, MAX_TEMP, NPSH, PUMP_STD, END_CONN, WEIGHT], specific: [PUMP_TYPE, FLOW, HEAD, SUCTION], guidance: 'Flow (m³/h) and head (m) are on the pump nameplate. Standard EN 733 / ISO 2858 pumps can be replaced by other makers with identical dimensions.', supply: { usual: ['OEM', 'OCM'], note: 'Impellers, wear rings and casings are maker-specific: buy from the pump OEM quoting the serial number. Standard bearings and seals can come from their makers (OCM).' } }),
    A({ id: 'COMPRESSOR', label: 'Compressor', kinds: MA, match: /compressor/i, exclude: /compressor (oil|filter|spare|part|kit|valve)/i, required: [COMP_TYPE, FAD, WORK_P, POWER_KW, OIL_FREE], optional: [COOL_MEDIUM, VSD, DRYER, VOLTAGE, MODEL, REFRIGERANT], specific: [COMP_TYPE, FAD, WORK_P], guidance: 'FAD (m³/min) and maximum pressure are on the data plate.', supply: { usual: ['OEM'], note: 'Service kits and air-ends are maker-specific; use OEM parts during warranty.' } }),
    A({ id: 'FAN', label: 'Fan / blower', kinds: MA, match: /\bfans?\b|blower|ventilator|extractor/i, exclude: /fan (belt|cover|guard)|fan cowl/i, required: [FAN_TYPE, AIRFLOW, STATIC_P, POWER_KW], optional: [SPEED_RPM, DRIVE_ARR, FAN_D, IP_RATING, EX], specific: [FAN_TYPE, AIRFLOW], guidance: 'Airflow and pressure are on the fan plate or datasheet.' }),
    A({ id: 'VALVE', label: 'Valve', kinds: MA, match: /valve|strainer/i, exclude: /valve (seat|spring|positioner|repair kit|actuator kit)|solenoid/i, required: [VALVE_TYPE, VALVE_SIZE, PRESSURE_RATING, END_CONN, BODY], optional: [TRIM, OPERATOR, FAIL, SET_P, SEAL_MAT, MEDIUM, MAX_TEMP, VALVE_STD], specific: [VALVE_TYPE, VALVE_SIZE, PRESSURE_RATING, BODY], guidance: 'Size, pressure class and body material are cast on the valve body or tag. Give the fluid and temperature.' }),
    A({ id: 'PNEU_CYL', label: 'Pneumatic cylinder', kinds: M, match: /pneumatic cylinder|air cylinder|pneumatic actuator|rodless cylinder/i, required: [CYL_TYPE, BORE, STROKE, ACTING], optional: [CUSHIONING, MAGNETIC, ROD_THREAD, PORT_SIZE, SEAL_MAT], specific: [CYL_TYPE, BORE, STROKE], guidance: 'Bore × stroke is in the order code (e.g. DSBC-63-200 = 63 mm bore, 200 mm stroke). ISO cylinders fit other brands.' }),
    A({ id: 'HYD_CYL', label: 'Hydraulic cylinder', kinds: M, match: /hydraulic (cylinder|ram|jack)/i, required: [BORE, ROD_D, STROKE, MAX_PRESSURE_BAR, HYD_MOUNT], optional: [PORT_SIZE, SEAL_KIT, ROD_THREAD], specific: [BORE, ROD_D, STROKE], guidance: 'Measure bore, rod diameter and stroke; record the seal kit number for repairs.' }),
    A({ id: 'GEARBOX', label: 'Gearbox / speed reducer', kinds: MA, match: /gear ?box|gear unit|speed reducer|gear reducer|reduction gear|worm (gear|reducer)/i, required: [GEAR_TYPE, RATIO, POWER_KW, OUT_TORQUE, MOUNT_POS, OUTPUT_SHAFT, INPUT_TYPE], optional: [OUT_SPEED, SERVICE_FACTOR, OIL_SPEC, SHAFT_D, WEIGHT], specific: [GEAR_TYPE, RATIO, POWER_KW], guidance: 'Ratio, torque and mounting position are on the gearbox nameplate.', supply: { usual: ['OEM', 'OCM'], note: 'Gearboxes are maker-specific; quote the full type code and serial number.' } }),
    // ----- Asset classes only -----
    A({ id: 'GENSET', label: 'Generator set', kinds: AS, match: /generator|genset|gen-?set|alternator set/i, required: [PRIME_KVA, VOLTAGE, FREQUENCY, ENGINE, ALTERNATOR, FUEL], optional: [STANDBY_KVA, TANK_L, ENCLOSURE, ATS, CONTROLLER], specific: [PRIME_KVA], guidance: 'Prime and standby kVA are on the generator plate; engine and alternator have their own plates.' }),
    A({ id: 'BOILER', label: 'Boiler / steam generator', kinds: AS, match: /boiler|steam generator|thermal oil heater|thermic fluid heater/i, required: [BOILER_TYPE, STEAM, DESIGN_P, FUEL, REG_NO, NEXT_INSPECT], optional: [BURNER, DESIGN_T, DESIGN_CODE], specific: [STEAM, DESIGN_P], guidance: 'Boilers are statutory equipment: record the registration number and the next inspection date from the certificate.' }),
    A({ id: 'VESSEL', label: 'Pressure vessel / tank / heat exchanger', kinds: AS, match: /pressure vessel|air receiver|receiver tank|storage tank|\btank\b|silo|reactor|heat exchanger|autoclave/i, required: [VESSEL_TYPE, VOLUME_M3, DESIGN_P, DESIGN_CODE], optional: [DESIGN_T, BODY, HX_AREA, REG_NO, NEXT_INSPECT], specific: [VESSEL_TYPE, VOLUME_M3], guidance: 'The nameplate shows design pressure, temperature and code. Pressure vessels need statutory inspection.' }),
    A({ id: 'CRANE', label: 'Crane / hoist / lifting equipment', kinds: AS, match: /crane|hoist|chain block|lifting|man ?lift|mewp|winch/i, required: [CRANE_TYPE, SWL, REG_NO, NEXT_INSPECT], optional: [SPAN, LIFT_M, POWER_KW], specific: [CRANE_TYPE, SWL], guidance: 'SWL must be marked on the equipment. Keep the statutory inspection certificate current.' }),
    A({ id: 'FORKLIFT', label: 'Forklift / material handling truck', kinds: AS, match: /forklift|fork lift|reach truck|stacker|pallet (truck|jack)|order picker|telehandler/i, required: [MHE_TYPE, LOAD_KG, LIFT_MM, FUEL], optional: [MAST, TYRES, REG_NO, NEXT_INSPECT], specific: [MHE_TYPE, LOAD_KG], guidance: 'Capacity and lift height are on the truck capacity plate.' }),
    A({ id: 'VEHICLE', label: 'Vehicle', kinds: AS, match: /vehicle|truck|lorry|pick-?up|\bvan\b|\bbus\b|\bcar\b|motorcycle|tractor|trailer|tanker|tipper/i, exclude: /forklift|pallet truck/i, required: [VEHICLE_TYPE, REG_PLATE, VIN, FUEL], optional: [ENGINE_NO, PAYLOAD], specific: [VEHICLE_TYPE, REG_PLATE], guidance: 'Copy registration, chassis (VIN) and engine numbers from the logbook.' }),
    A({ id: 'HVAC', label: 'HVAC / refrigeration', kinds: AS, match: /chiller|air condition|\bhvac\b|\bac unit|split unit|\bvrf\b|\bvrv\b|air handling|\bahu\b|cooling tower|cold room|refrigerat|heat pump/i, required: [HVAC_TYPE, COOL_KW, REFRIGERANT, POWER_KW], optional: [REFRIG_KG, VOLTAGE, COMP_TYPE], specific: [HVAC_TYPE, COOL_KW], guidance: 'Capacity and refrigerant type/charge are on the outdoor-unit nameplate.' }),
    A({ id: 'CONVEYOR', label: 'Conveyor', kinds: AS, match: /conveyor|elevator|auger/i, exclude: /conveyor belt/i, required: [CONVEYOR_TYPE, LENGTH_EQ, WIDTH_EQ, CAPACITY_TPH, POWER_KW], optional: [SPEED_MS, INCLINE, MATERIAL_HANDLED], specific: [CONVEYOR_TYPE, LENGTH_EQ, WIDTH_EQ], guidance: 'Length, width and capacity come from the conveyor drawing or GA.' }),
    A({ id: 'MACHINE_TOOL', label: 'Machine tool', kinds: AS, match: /lathe|milling|machining cent|\bcnc\b|grinder|press brake|shear|bandsaw|\bedm\b|laser cutt|plasma cutt|drill(ing)? (press|machine)|welding machine|injection mould|hydraulic press/i, required: [MACHINE_TYPE, CNC, SPINDLE_KW], optional: [AXES, TRAVEL, SPINDLE_RPM, CAPACITY_GENERIC], specific: [MACHINE_TYPE, CNC], guidance: 'Record the control make and version — needed for programs and spare boards.' }),
];

/** Fallbacks when nothing specific matches. */
const FALLBACK: Record<LibKind, Archetype> = {
    materials: A({ id: 'MRO_GENERIC', label: 'General material', kinds: M, match: /.^/, required: [], optional: ID_MATERIAL, specific: [], guidance: 'Record the maker and the maker’s part number so the exact item can be bought again from any supplier.' }),
    services: A({ id: 'SVC_GENERIC', label: 'General service', kinds: S, match: /.^/, required: [PROVIDER, SCOPE, LOCATION], optional: [EQUIP, DELIVERABLES, SAFETY_REQ, WARRANTY, TURNAROUND], specific: [], guidance: 'Say who may do the work, what is included and what documents you need back.' }),
    assets: A({ id: 'ASSET_GENERIC', label: 'General equipment', kinds: AS, match: /.^/, required: [MANUFACTURER, MODEL], optional: [SERIAL, YEAR, ORIGIN, CAPACITY_GENERIC, POWER_KW, WEIGHT], specific: [], guidance: 'Copy manufacturer, model and serial number from the nameplate.' }),
};

/** Common identity attributes added to every material and asset class. */
function commonFor(kind: LibKind): string[] {
    if (kind === 'materials') return ID_MATERIAL;
    if (kind === 'assets') return ID_ASSET;
    return [];
}
/** Identity attributes that are mandatory for every asset (each installed unit must be traceable to its maker). */
const ASSET_REQUIRED = [MANUFACTURER, MODEL];

// ---------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------
export const libraryAttributes = (): LibAttribute[] => Array.from(POOL.values());
export const libraryAttribute = (code: string) => POOL.get(code);
export const archetypes = () => ARCHETYPES.slice();

/** Normalised name used to detect an attribute the catalogue already defines under another code. */
export const normName = (s: string) =>
    s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(rated|nominal|the|of|number|no)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** Find the best archetype for a catalogue entry from its own name first, then its hierarchy. */
/**
 * Whole machines and complete components whose name also appears in the names of their parts ("pump base
 * plate", "bearing bracket", "motor cable gland"). A part must never inherit the machine's mandatory ratings,
 * so when the item name says it is a part these types are skipped and the general spare-part form is used.
 */
const WHOLE_UNITS = new Set([
    'GEARMOTOR', 'SERVO_MOTOR', 'DC_MOTOR', 'MOTOR', 'TRANSFORMER', 'HYD_PUMP', 'PD_PUMP', 'PUMP', 'COMPRESSOR', 'FAN', 'VALVE', 'SOLENOID_VALVE',
    'PNEU_CYL', 'HYD_CYL', 'GEARBOX', 'BEARING', 'GENSET', 'BOILER', 'VESSEL', 'CRANE', 'FORKLIFT', 'VEHICLE', 'HVAC', 'CONVEYOR', 'MACHINE_TOOL',
]);
const PART_OF = /\b(brackets?|base ?plates?|baseplates?|guards?|covers?|glands?|kits?|spares?|parts?|impellers?|shafts?|sleeves?|lids?|mountings?|mounts?|supports?|stands?|handles?|spacers?|pullers?|heaters?|tools?|nameplates?|terminal box(es)?|wear rings?|liners?|clamps?|holders?|adapters?|adaptors?|cowls?|grilles?|skids?)\b/i;

export function matchArchetype(kind: LibKind, names: { item: string; synonyms?: string[]; family?: string; subcategory?: string; category?: string }): Archetype {
    const candidates = ARCHETYPES.filter((a) => a.kinds.includes(kind));
    const itemLayer = [names.item, ...(names.synonyms ?? [])].join(' | ');
    const isPart = kind !== 'services' && PART_OF.test(names.item ?? '');
    const layers = [itemLayer, names.family ?? '', names.subcategory ?? '', names.category ?? ''];
    for (const [i, hay] of layers.entries()) {
        if (!hay.trim()) continue;
        const hit = candidates.find((a) => a.match.test(hay) && !(a.exclude && a.exclude.test(hay)) && !(isPart && WHOLE_UNITS.has(a.id)));
        if (hit) return hit;
        // A named part never falls through to its parent machine's type in the hierarchy.
        if (i === 0 && isPart) return FALLBACK[kind];
    }
    return FALLBACK[kind];
}

export interface Enrichment {
    archetype: { id: string; label: string; guidance: string; supply?: { usual: SupplyHint[]; note: string } };
    /** Library attribute codes to add, in display order. */
    add: string[];
    /** Codes (library or existing) that become mandatory. */
    required: string[];
    /** Codes used in the generated short text. */
    specific: string[];
}

/**
 * Work out what to add to one catalogue entry. `existing` maps the entry's current attribute codes to their
 * names; library attributes whose normalised name matches an existing one are not added (the existing
 * attribute is used instead, and marked mandatory when the library says so).
 */
export function enrichmentFor(kind: LibKind, names: Parameters<typeof matchArchetype>[1], existing: Array<{ code: string; name: string }>): Enrichment {
    const arch = matchArchetype(kind, names);
    const existingByName = new Map(existing.map((e) => [normName(e.name), e.code]));
    const existingCodes = new Set(existing.map((e) => e.code));
    const resolve = (libCode: string): { code: string; isNew: boolean } => {
        if (existingCodes.has(libCode)) return { code: libCode, isNew: false };
        const lib = POOL.get(libCode)!;
        for (const n of [lib.name, ...(lib.aliases ?? [])]) {
            const same = existingByName.get(normName(n));
            if (same) return { code: same, isNew: false };
        }
        return { code: libCode, isNew: true };
    };
    const order = [...arch.required, ...arch.optional, ...commonFor(kind)];
    const requiredLib = new Set([...arch.required, ...(kind === 'assets' ? ASSET_REQUIRED : [])]);
    const add: string[] = [];
    const required: string[] = [];
    const specific: string[] = [];
    const seen = new Set<string>();
    for (const libCode of order) {
        if (seen.has(libCode)) continue;
        seen.add(libCode);
        const r = resolve(libCode);
        if (r.isNew) add.push(r.code);
        if (requiredLib.has(libCode)) required.push(r.code);
    }
    for (const libCode of arch.specific) specific.push(resolve(libCode).code);
    return { archetype: { id: arch.id, label: arch.label, guidance: arch.guidance, ...(arch.supply ? { supply: arch.supply } : {}) }, add, required, specific };
}

/** The library attribute as a catalogue attribute record (same shape as uploaded attributes). */
export function catalogueAttributeRecord(code: string): Record<string, unknown> | null {
    const a = POOL.get(code);
    if (!a) return null;
    return {
        code: a.code,
        key: a.code.slice(5).toLowerCase(),
        name: a.name,
        description: a.description,
        domain: libDomainCode(a.domain),
        dataType: a.dataType,
        unit: a.unit ?? '',
        options: a.options ?? [],
        validation: a.validation ?? {},
        example: a.example ?? '',
        source: LIB_SOURCE,
    };
}
export const libraryDomainRecords = () => (Object.keys(LIB_DOMAINS) as LibDomain[]).map((d) => ({ code: libDomainCode(d), name: LIB_DOMAINS[d], source: LIB_SOURCE }));

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/**
 * Apply the library to a loaded catalogue in place. Items keep every attribute, requirement and specific
 * flag they already have; library attributes are appended. Returns how many entries were enriched.
 * `entryName` returns the hierarchy names for an entry (family, subcategory, category).
 */
export function enrichCatalogue(
    kind: LibKind,
    attributes: Map<string, Obj>,
    domains: Obj[],
    entries: Iterable<Obj>,
    hierarchy: (entry: Obj) => { family?: string; subcategory?: string; category?: string },
): number {
    for (const d of libraryDomainRecords()) if (!domains.some((x) => str(x.code) === d.code)) domains.push(d);
    let count = 0;
    for (const entry of entries) {
        if (entry.libraryArchetype) continue; // already enriched (cached object)
        const codes = strs(entry.attributes);
        const existing = codes.map((code) => ({ code, name: str(attributes.get(code)?.name) || code }));
        const e = enrichmentFor(kind, { item: str(entry.name), synonyms: strs(entry.synonyms), ...hierarchy(entry) }, existing);
        for (const code of e.add) {
            if (!attributes.has(code)) {
                const rec = catalogueAttributeRecord(code);
                if (rec) attributes.set(code, rec);
            }
        }
        const allCodes = [...codes, ...e.add.filter((c) => !codes.includes(c))];
        const required = Array.from(new Set([...strs(entry.requiredAttributes), ...e.required])).filter((c) => allCodes.includes(c));
        const specific = strs(entry.specificAttributes).length ? strs(entry.specificAttributes) : e.specific.filter((c) => allCodes.includes(c));
        entry.libraryOriginal = { attributes: codes, requiredAttributes: strs(entry.requiredAttributes), specificAttributes: strs(entry.specificAttributes) };
        entry.attributes = allCodes;
        entry.requiredAttributes = required;
        entry.specificAttributes = specific;
        entry.libraryArchetype = e.archetype;
        entry.libraryAdded = e.add;
        count++;
    }
    return count;
}

/** Remove library additions again (used when exporting the catalogue exactly as uploaded). */
export function stripLibrary(entry: Obj): Obj {
    if (!entry.libraryArchetype) return entry;
    const { libraryArchetype: _a, libraryAdded: _b, libraryOriginal, ...rest } = entry;
    const o = (libraryOriginal ?? {}) as Obj;
    return { ...rest, attributes: strs(o.attributes), requiredAttributes: strs(o.requiredAttributes), specificAttributes: strs(o.specificAttributes) };
}
