/**
 * Attribute library used by the catalogue generator (tools/catalogue/enrich.ts).
 *
 * Each library attribute is one fact that makes an item different from another of the same kind (for an electric
 * motor: rated power, voltage, frequency, poles, frame size, mounting, IP and efficiency class). The generator writes
 * the attributes a rule needs into the catalogue files themselves; the application only reads the files.
 *
 * Plain language rule: every attribute says where to find the value (nameplate, packaging, datasheet) and gives an
 * example, so a person who is not a subject-matter expert can complete it without guessing.
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
    /** Groups of existing attributes that together hold this value (e.g. minimum + maximum); reused instead of adding it. */
    aliasSets?: string[][];
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

// ---------------------------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------------------------
export const POOL = new Map<string, LibAttribute>();
export const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
export const opts = (list: Array<string | [string, string]>): LibOption[] =>
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
export function def(code: string, a: Omit<LibAttribute, 'code'>): string {
    const full = 'MEMS.' + code;
    if (POOL.has(full)) throw new Error('Duplicate library attribute ' + full);
    const description = a.description.length < 60 ? a.description + ' ' + WHERE[a.domain] : a.description;
    POOL.set(full, { code: full, ...a, description });
    return full;
}
export const text = (code: string, name: string, domain: LibDomain, description: string, example?: string, maxLength = 120) =>
    def(code, { name, dataType: 'text', domain, description, example, validation: { maxLength } });
export const dec = (code: string, name: string, unit: string, domain: LibDomain, description: string, example?: string, min = 0, max?: number) =>
    def(code, { name, dataType: 'decimal', unit, domain, description, example, validation: { minimum: min, ...(max !== undefined ? { maximum: max } : {}) } });
export const int = (code: string, name: string, unit: string, domain: LibDomain, description: string, example?: string, min = 0, max?: number) =>
    def(code, { name, dataType: 'integer', unit, domain, description, example, validation: { minimum: min, ...(max !== undefined ? { maximum: max } : {}) } });
export const pick = (code: string, name: string, domain: LibDomain, description: string, list: Array<string | [string, string]>, unit?: string) =>
    def(code, { name, dataType: 'enum', domain, description, options: opts(list), ...(unit ? { unit } : {}) });
export const many = (code: string, name: string, domain: LibDomain, description: string, list: Array<string | [string, string]>) =>
    def(code, { name, dataType: 'multi_select', domain, description, options: opts(list) });
export const yes = (code: string, name: string, domain: LibDomain, description: string) => def(code, { name, dataType: 'boolean', domain, description });
export function alias(code: string, names: string[]) {
    const a = POOL.get(code);
    if (a) a.aliases = [...(a.aliases ?? []), ...names];
}
export function aliasSet(code: string, names: string[]) {
    const a = POOL.get(code);
    if (a) a.aliasSets = [...(a.aliasSets ?? []), names];
}

// ---------------------------------------------------------------------------------------------------------------
// Shared pick-lists
// ---------------------------------------------------------------------------------------------------------------
export const IP = ['IP20', 'IP21', 'IP23', 'IP44', 'IP54', 'IP55', 'IP56', 'IP65', 'IP66', 'IP67', 'IP68', 'IP69K'];
const AC_VOLTAGE: Array<[string, string]> = [['V230_1PH', '230 V single-phase'], ['V230', '230 V three-phase'], ['V380', '380 V'], ['V400', '400 V'], ['V415', '415 V'], ['V440', '440 V'], ['V460', '460 V'], ['V480', '480 V'], ['V525', '525 V'], ['V690', '690 V'], ['V230_400', '230/400 V (Δ/Y)'], ['V400_690', '400/690 V (Δ/Y)'], ['V3300', '3.3 kV'], ['V6600', '6.6 kV'], ['V11000', '11 kV'], ['OTHER', 'Other — state in notes']];
const COIL_VOLTAGE: Array<[string, string]> = [['24VDC', '24 V DC'], ['24VAC', '24 V AC'], ['48VDC', '48 V DC'], ['110VAC', '110 V AC'], ['110VDC', '110 V DC'], ['120VAC', '120 V AC'], ['220VDC', '220 V DC'], ['230VAC', '230 V AC'], ['400VAC', '400 V AC'], ['OTHER', 'Other — state in notes']];
const FREQ: Array<[string, string]> = [['HZ50', '50 Hz'], ['HZ60', '60 Hz'], ['HZ50_60', '50/60 Hz']];
const ELASTOMER: Array<[string, string]> = [['NBR', 'NBR (nitrile) — oil, water, air up to ~100 °C'], ['FKM', 'FKM / Viton — high temperature, fuels, chemicals'], ['EPDM', 'EPDM — hot water, steam, not oil'], ['VMQ', 'Silicone (VMQ) — food, wide temperature, low strength'], ['HNBR', 'HNBR — tougher nitrile, higher temperature'], ['PTFE', 'PTFE (Teflon) — almost all chemicals'], ['FFKM', 'FFKM (Kalrez type) — extreme chemicals and heat'], ['PU', 'Polyurethane (PU/AU) — wear, hydraulics'], ['CR', 'Neoprene (CR)']];
export const PRESSURE_CLASS = ['PN6', 'PN10', 'PN16', 'PN25', 'PN40', 'PN63', 'PN100', 'ASME Class 150', 'ASME Class 300', 'ASME Class 600', 'ASME Class 900', 'ASME Class 1500', 'ASME Class 2500'];
export const DN = ['DN6 (1/8")', 'DN8 (1/4")', 'DN10 (3/8")', 'DN15 (1/2")', 'DN20 (3/4")', 'DN25 (1")', 'DN32 (1-1/4")', 'DN40 (1-1/2")', 'DN50 (2")', 'DN65 (2-1/2")', 'DN80 (3")', 'DN100 (4")', 'DN125 (5")', 'DN150 (6")', 'DN200 (8")', 'DN250 (10")', 'DN300 (12")', 'DN350 (14")', 'DN400 (16")', 'DN450 (18")', 'DN500 (20")', 'DN600 (24")', 'Other — state in notes'];
export const END_CONNECTION = ['Flanged raised face (RF)', 'Flanged ring joint (RTJ)', 'Threaded BSP (G/R)', 'Threaded NPT', 'Socket weld', 'Butt weld', 'Wafer', 'Lug', 'Tri-clamp (sanitary)', 'Grooved (Victaulic type)', 'Compression fitting', 'Push-in'];
export const BODY_METAL = ['Cast iron', 'Ductile iron', 'Carbon steel (WCB / A105)', 'Stainless steel 304 / CF8', 'Stainless steel 316 / CF8M', 'Duplex stainless', 'Bronze / gunmetal', 'Brass', 'Aluminium', 'PVC / CPVC', 'Polypropylene (PP)', 'PVDF'];
const SIGNAL_OUT: Array<[string, string]> = [['MA4_20', '4–20 mA'], ['MA4_20_HART', '4–20 mA + HART'], ['V0_10', '0–10 V'], ['PNP', 'Switching PNP'], ['NPN', 'Switching NPN'], ['RELAY', 'Relay contact'], ['IOLINK', 'IO-Link'], ['MODBUS', 'Modbus RTU'], ['PROFIBUS', 'Profibus PA/DP'], ['FIELDBUS', 'Foundation Fieldbus'], ['ETHERNET', 'Industrial Ethernet']];
const EX_PROTECTION: Array<[string, string]> = [['NONE', 'Not for hazardous areas'], ['EX_D', 'Ex d — flameproof (gas)'], ['EX_E', 'Ex e / eb — increased safety (gas)'], ['EX_EC', 'Ex ec / nA — non-sparking, Zone 2'], ['EX_I', 'Ex i — intrinsically safe'], ['EX_T', 'Ex tb / tc — dust'], ['EX_P', 'Ex p — pressurised']];
export const FIELDBUS = ['None', 'Modbus RTU', 'Modbus TCP', 'Profibus DP', 'Profinet', 'EtherNet/IP', 'EtherCAT', 'CANopen', 'DeviceNet', 'BACnet', 'IO-Link'];
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
export const MANUFACTURER = text('MANUFACTURER', 'Manufacturer / brand', 'IDENTITY', 'The company that made the item, as printed on the nameplate, the item or its box.', 'SKF, Siemens, WEG, Grundfos');
export const MPN = text('MPN', 'Manufacturer part number (MPN)', 'IDENTITY', 'The maker’s own order or catalogue number. Copy it exactly, including dashes and slashes. If the machine maker (OEM) sells this part under its own number, still record the maker’s number here so it can be bought from other suppliers.', '6205-2RSH/C3', 80);
export const MODEL = text('MODEL', 'Model / type designation', 'IDENTITY', 'Model or type code from the nameplate or datasheet.', '1LE1001-1DB23-4AA4', 80);
export const SERIAL = text('SERIAL_NO', 'Serial number', 'IDENTITY', 'Unique number of this individual unit, from the nameplate. Each installed unit has its own.', 'SN 2309-11845', 80);
export const YEAR = int('YEAR_OF_MANUFACTURE', 'Year of manufacture', '', 'IDENTITY', 'Year the unit was built, from the nameplate.', '2021', 1900, 2100);
export const ORIGIN = def('COUNTRY_OF_ORIGIN', { name: 'Country of origin', dataType: 'country', domain: 'IDENTITY', description: 'Where the item was made (on the box or certificate). Needed for import duty and some tenders.' });
export const FITS = text('FITS_EQUIPMENT', 'Fits equipment (make / model)', 'IDENTITY', 'The machine this part is used on, so others can find the right spare. Give make and model.', 'Krones Contiform S12 blow moulder', 160);
export const STANDARD = text('STANDARD', 'Standard / specification', 'COMPLIANCE', 'The standard the item is made to, if printed or stated on the datasheet.', 'IEC 60034-1, DIN 625, ISO 4017');
export const SHELF_LIFE = int('SHELF_LIFE_MONTHS', 'Shelf life', 'months', 'PACK', 'How long the item can be stored before use (rubber, adhesives, chemicals, batteries, lubricants). Leave blank if unlimited.', '24', 0, 600);
export const PACK_QTY = int('PACK_QUANTITY', 'Quantity per pack', 'pcs', 'PACK', 'How many pieces come in one pack or box when bought.', '100', 1);
export const WEIGHT = dec('WEIGHT_KG', 'Weight', 'kg', 'DIMENSION', 'Net weight of one item. Helps transport and lifting planning.', '42');
export const IP_RATING = pick('IP_RATING', 'Ingress protection (IP rating)', 'ENVIRONMENT', 'Protection against dust and water, printed as “IPxx” on the nameplate. IP55 suits most plant areas; IP66+ for wash-down or outdoors.', IP);
export const EX = pick('EX_PROTECTION', 'Hazardous-area (Ex) protection', 'ENVIRONMENT', 'Only for areas with flammable gas or dust. Look for an “Ex” marking and ATEX/IECEx certificate number on the nameplate.', EX_PROTECTION);
export const AMBIENT = text('AMBIENT_RANGE', 'Operating temperature range', 'ENVIRONMENT', 'Minimum and maximum temperature it is rated for.', '-20 to +40 °C', 40);
export const NOTES = text('TECH_NOTES', 'Other technical notes', 'IDENTITY', 'Anything else needed to order the exact item (special version, coating, option codes).', 'Special shaft 38 mm with 10 mm key', 300);

// Electrical ratings
export const POWER_KW = dec('RATED_POWER_KW', 'Rated power', 'kW', 'RATING', 'Output power from the nameplate. If it shows HP only, kW = HP × 0.746.', '7.5');
export const VOLTAGE = pick('RATED_VOLTAGE', 'Rated voltage', 'RATING', 'Supply voltage from the nameplate. “400/690 V” means delta at 400 V or star at 690 V.', AC_VOLTAGE);
export const FREQUENCY = pick('FREQUENCY', 'Frequency', 'RATING', 'Supply frequency. Kenya, Uganda, Tanzania, Nigeria, South Africa use 50 Hz.', FREQ);
export const PHASES = pick('PHASES', 'Phases', 'RATING', 'Single-phase (two wires + earth) or three-phase supply.', [['P1', 'Single-phase'], ['P3', 'Three-phase'], ['DC', 'DC']]);
export const CURRENT_A = dec('RATED_CURRENT_A', 'Rated current', 'A', 'RATING', 'Full-load current from the nameplate at the rated voltage.', '14.2');
export const COIL = pick('COIL_VOLTAGE', 'Coil / control voltage', 'RATING', 'Voltage that operates the coil or control circuit — usually printed on the coil itself.', COIL_VOLTAGE);
export const SUPPLY_DC = pick('SUPPLY_VOLTAGE', 'Supply voltage', 'RATING', 'Power supply needed by the device.', [['V10_30DC', '10–30 V DC'], ['V24DC', '24 V DC'], ['V12DC', '12 V DC'], ['V5DC', '5 V DC'], ['V20_250ACDC', '20–250 V AC/DC'], ['V230AC', '230 V AC'], ['LOOP', 'Loop-powered (2-wire 4–20 mA)']]);

// Motors
export const POLES = pick('POLES', 'Number of poles (speed)', 'RATING', 'Poles set the speed. On the nameplate read the rpm: ~2900 rpm = 2-pole, ~1450 = 4-pole, ~960 = 6-pole, ~720 = 8-pole (50 Hz).', [['P2', '2-pole (≈ 3000 rpm at 50 Hz)'], ['P4', '4-pole (≈ 1500 rpm)'], ['P6', '6-pole (≈ 1000 rpm)'], ['P8', '8-pole (≈ 750 rpm)'], ['P10', '10-pole or more'], ['MULTI', 'Two-speed / multi-speed']]);
export const SPEED_RPM = int('RATED_SPEED_RPM', 'Rated speed', 'rpm', 'RATING', 'Full-load speed from the nameplate.', '1460', 0, 100000);
export const FRAME = text('FRAME_SIZE', 'Frame size', 'DIMENSION', 'Frame size from the nameplate. IEC frames are a number plus S/M/L (e.g. 132M); NEMA frames end in T (e.g. 213T). Same frame = same shaft height and fixing holes.', '132M', 20);
export const MOUNTING_IM = pick('MOUNTING_ARRANGEMENT', 'Mounting arrangement', 'CONNECTION', 'How the motor is fixed. Foot = bolted on feet; flange = bolted by the front face.', [['B3', 'IM B3 — foot mounted'], ['B5', 'IM B5 — large flange (FF)'], ['B14', 'IM B14 — small face flange (FT)'], ['B35', 'IM B35 — foot + large flange'], ['B34', 'IM B34 — foot + small flange'], ['V1', 'IM V1 — vertical, flange, shaft down'], ['V3', 'IM V3 — vertical, flange, shaft up'], ['OTHER', 'Other — state in notes']]);
export const EFFICIENCY = pick('EFFICIENCY_CLASS', 'Efficiency class', 'RATING', 'Energy efficiency class printed on the nameplate (IE1 lowest – IE5 highest). Replace like-for-like or better.', ['IE1', 'IE2', 'IE3', 'IE4', 'IE5', 'NEMA Premium', 'Not stated']);
export const INSULATION = pick('INSULATION_CLASS', 'Insulation class', 'RATING', 'Winding temperature class on the nameplate (“Ins. Cl. F”). F is the most common.', ['Class B (130 °C)', 'Class F (155 °C)', 'Class H (180 °C)']);
export const DUTY = pick('DUTY_TYPE', 'Duty type', 'RATING', 'How the motor runs. S1 = continuous (most motors). Others are for frequent starting or short-time running.', [['S1', 'S1 — continuous'], ['S2', 'S2 — short-time'], ['S3', 'S3 — intermittent periodic'], ['S4_S10', 'S4–S10 — frequent starts / variable load']]);
export const COOLING = pick('COOLING_METHOD', 'Cooling method', 'MATERIAL', 'How the motor is cooled. TEFC (own fan on the back) is the most common.', [['IC411', 'IC411 — totally enclosed, fan cooled (TEFC)'], ['IC416', 'IC416 — separate forced-vent fan'], ['IC410', 'IC410 — no fan (TENV)'], ['IC01', 'IC01 — open drip-proof (ODP)'], ['WATER', 'Water cooled']]);
export const SHAFT_D = dec('SHAFT_DIAMETER_MM', 'Shaft diameter', 'mm', 'DIMENSION', 'Diameter of the output shaft.', '38');
export const SHAFT_L = dec('SHAFT_LENGTH_MM', 'Shaft extension length', 'mm', 'DIMENSION', 'Length of the shaft sticking out of the motor.', '80');
export const BEARING_DE = text('BEARING_DE', 'Drive-end bearing', 'MATERIAL', 'Bearing number at the shaft end (on the nameplate or datasheet). Useful for ordering spares.', '6308-2Z/C3', 40);
export const BEARING_NDE = text('BEARING_NDE', 'Non-drive-end bearing', 'MATERIAL', 'Bearing number at the fan end.', '6208-2Z/C3', 40);
export const THERMAL_PROT = pick('THERMAL_PROTECTION', 'Winding protection', 'MATERIAL', 'Temperature sensors built into the windings, if any.', [['NONE', 'None'], ['PTC', 'PTC thermistors'], ['PT100', 'PT100 sensors'], ['BIMETAL', 'Bimetal thermal switches (PTO)'], ['KTY', 'KTY sensor']]);
export const BRAKE = pick('BRAKE', 'Brake', 'MATERIAL', 'Whether a holding brake is fitted, and its supply.', [['NONE', 'No brake'], ['DC24', 'Brake 24 V DC'], ['DC_RECT', 'Brake via rectifier (AC supply)'], ['OTHER', 'Other — state in notes']]);
export const INVERTER_DUTY = yes('INVERTER_DUTY', 'Suitable for variable speed drive (inverter duty)', 'RATING', 'Yes if the datasheet says it can run on a VFD/inverter (reinforced insulation, insulated bearing for large motors).');
export const TERMINAL_BOX = pick('TERMINAL_BOX_POSITION', 'Terminal box position', 'CONNECTION', 'Where the cable box sits, looking at the shaft end.', ['Top', 'Right', 'Left', 'Bottom']);

// Gear units
export const GEAR_TYPE = pick('GEAR_TYPE', 'Gear type', 'MATERIAL', 'Construction of the gear unit, from the datasheet or nameplate type code.', ['Helical', 'Helical-bevel (right angle)', 'Bevel', 'Worm', 'Helical-worm', 'Planetary', 'Parallel shaft', 'Cycloidal']);
export const RATIO = dec('GEAR_RATIO', 'Gear ratio', ': 1', 'RATING', 'Reduction ratio “i” on the nameplate (input speed ÷ output speed).', '28.5', 0.1);
export const OUT_SPEED = dec('OUTPUT_SPEED_RPM', 'Output speed', 'rpm', 'RATING', 'Speed of the output shaft, on the nameplate (n2).', '51');
export const OUT_TORQUE = dec('OUTPUT_TORQUE_NM', 'Output torque', 'N·m', 'RATING', 'Rated output torque (M2 or Ma) on the nameplate.', '1350');
export const SERVICE_FACTOR = dec('SERVICE_FACTOR', 'Service factor', '', 'RATING', 'Safety factor of the gear unit (fB or SF) on the nameplate.', '1.6', 0.1, 10);
export const MOUNT_POS = pick('MOUNTING_POSITION', 'Mounting position', 'CONNECTION', 'Orientation the unit is designed for (M1–M6). Wrong position = wrong oil level.', ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'Universal']);
export const OUTPUT_SHAFT = pick('OUTPUT_SHAFT', 'Output shaft', 'CONNECTION', 'Type of output.', ['Solid shaft with key', 'Hollow shaft with key', 'Hollow shaft with shrink disc', 'Flange output', 'Splined shaft']);
export const INPUT_TYPE = pick('INPUT_TYPE', 'Input', 'CONNECTION', 'How power goes in.', ['Integral motor (gear motor)', 'IEC motor adapter flange', 'NEMA C-face adapter', 'Solid input shaft']);
export const OIL_SPEC = text('OIL_SPECIFICATION', 'Oil type and quantity', 'MATERIAL', 'Oil grade and fill quantity on the nameplate.', 'ISO VG 220 mineral, 4.6 L', 80);

// Servo, DC
export const TORQUE_RATED = dec('RATED_TORQUE_NM', 'Rated (continuous) torque', 'N·m', 'RATING', 'Continuous torque M0 / Mn from the nameplate.', '8.2');
export const TORQUE_PEAK = dec('PEAK_TORQUE_NM', 'Peak torque', 'N·m', 'RATING', 'Maximum short-time torque.', '24');
export const ENCODER_FB = pick('FEEDBACK_DEVICE', 'Feedback device', 'CONNECTION', 'Position sensor built into the motor.', ['Resolver', 'Incremental encoder', 'Absolute single-turn encoder', 'Absolute multi-turn encoder', 'Hiperface DSL / single-cable', 'None']);
export const DC_FIELD = pick('DC_FIELD_TYPE', 'Field type', 'MATERIAL', 'How the DC motor field is excited.', ['Shunt (separately excited)', 'Series', 'Compound', 'Permanent magnet']);

// Drives & switchgear
export const DRIVE_INPUT = pick('DRIVE_INPUT', 'Input supply', 'RATING', 'Mains supply the drive connects to.', [['1X230', '1-phase 230 V'], ['3X230', '3-phase 230 V'], ['3X400', '3-phase 380–480 V'], ['3X690', '3-phase 525–690 V'], ['DC', 'DC bus']]);
export const DUTY_RATING = pick('OVERLOAD_DUTY', 'Duty / overload rating', 'RATING', 'Normal duty for pumps and fans; heavy duty for conveyors, crushers, hoists.', [['ND', 'Normal duty (≈110% overload)'], ['HD', 'Heavy duty (≈150% overload)']]);
export const CONTROL_MODE = pick('CONTROL_MODE', 'Control mode', 'RATING', 'Motor control method supported or required.', ['V/f (scalar)', 'Sensorless vector', 'Closed-loop vector (encoder)', 'Servo']);
export const COMMS = many('COMMUNICATION', 'Communication', 'CONNECTION', 'Network the device must connect to — check what the PLC or other drives use.', FIELDBUS);
export const EMC = yes('EMC_FILTER', 'Built-in EMC filter', 'COMPLIANCE', 'Yes if the drive includes an EMC/RFI filter.');
export const BRAKE_CHOPPER = yes('BRAKE_CHOPPER', 'Built-in braking chopper', 'RATING', 'Needed for fast stopping or lowering loads with a braking resistor.');
export const STO = yes('SAFE_TORQUE_OFF', 'Safe Torque Off (STO)', 'COMPLIANCE', 'Safety function input on the drive.');
export const DEVICE_FRAME = text('DEVICE_FRAME', 'Frame / size code', 'DIMENSION', 'Housing size code from the type code (e.g. FS2, Frame C).', 'FSB', 20);
export const AC3_CURRENT = dec('AC3_CURRENT_A', 'Rated operational current (AC-3)', 'A', 'RATING', 'Motor switching current at 400 V, printed as Ie or AC-3 on the side.', '25');
export const AC3_KW = dec('AC3_POWER_KW', 'Motor rating at 400 V (AC-3)', 'kW', 'RATING', 'Largest motor it can switch at 400 V.', '11');
export const POLES_SW = pick('SWITCH_POLES', 'Number of poles', 'CONNECTION', 'Number of switched conductors.', ['1P', '1P+N', '2P', '3P', '3P+N', '4P']);
export const AUX = text('AUX_CONTACTS', 'Auxiliary contacts', 'CONNECTION', 'Extra signal contacts (NO = normally open, NC = normally closed).', '1NO + 1NC', 20);
export const DIN_MOUNT = pick('DEVICE_MOUNTING', 'Mounting', 'CONNECTION', 'How it is fixed in the panel.', ['DIN rail 35 mm', 'Screw / base plate', 'Plug-in', 'Withdrawable', 'Door / panel cut-out']);
export const BREAKER_TYPE = pick('BREAKER_TYPE', 'Breaker type', 'MATERIAL', 'MCB = small DIN-rail; MCCB = moulded case (larger); ACB = air circuit breaker (main incomer); RCBO/RCCB = earth-leakage protection.', ['MCB', 'MCCB', 'ACB', 'RCBO', 'RCCB', 'Motor protection circuit breaker (MPCB)']);
export const IN_A = dec('NOMINAL_CURRENT_A', 'Rated current (In)', 'A', 'RATING', 'Current rating printed on the front (e.g. C16 = 16 A).', '16');
export const ICU = dec('BREAKING_CAPACITY_KA', 'Breaking capacity (Icu / Icn)', 'kA', 'RATING', 'Short-circuit rating printed on the front (e.g. 6000 = 6 kA, 36 kA).', '10');
export const TRIP_CURVE = pick('TRIP_CURVE', 'Trip curve / characteristic', 'RATING', 'Letter before the current on an MCB. B = lighting/sockets, C = general, D = motors/transformers.', ['B', 'C', 'D', 'K', 'Z', 'Thermal-magnetic (MCCB)', 'Electronic trip unit']);
export const RESIDUAL = pick('RESIDUAL_CURRENT', 'Residual current sensitivity', 'RATING', 'Earth-leakage trip level (RCD/RCBO only).', ['10 mA', '30 mA', '100 mA', '300 mA', '500 mA', 'Adjustable']);
export const SETTING_RANGE = text('SETTING_RANGE_A', 'Current setting range', 'RATING', 'Adjustable range on the dial of an overload relay or MPCB.', '9–14 A', 20);
export const FUSE_TYPE = pick('FUSE_CLASS', 'Fuse class', 'RATING', 'Printed on the fuse body. gG = general cables; aM = motors; aR/gR = semiconductor (drives, rectifiers).', ['gG / gL', 'aM', 'aR', 'gR', 'gPV (solar)', 'Class J', 'Class CC', 'Class RK5']);
export const FUSE_SIZE = pick('FUSE_SIZE', 'Fuse size', 'DIMENSION', 'Physical size so it fits the holder.', ['8x32', '10x38', '14x51', '22x58', 'NH000', 'NH00', 'NH1', 'NH2', 'NH3', 'D01', 'D02', 'D03', 'DII (E27)', 'DIII (E33)', 'Blade (automotive)', 'Other']);
export const RELAY_CONTACTS = text('CONTACT_CONFIGURATION', 'Contact configuration', 'CONNECTION', 'Number and type of contacts (CO = changeover).', '2 CO, 8 A', 30);

// Transformers
export const KVA = dec('RATED_POWER_KVA', 'Rated power', 'kVA', 'RATING', 'kVA on the nameplate.', '1000');
export const PRIMARY_V = text('PRIMARY_VOLTAGE', 'Primary (HV) voltage', 'RATING', 'High-voltage side on the nameplate.', '11 kV', 20);
export const SECONDARY_V = text('SECONDARY_VOLTAGE', 'Secondary (LV) voltage', 'RATING', 'Low-voltage side on the nameplate.', '433 V', 20);
export const VECTOR = pick('VECTOR_GROUP', 'Vector group', 'RATING', 'Winding connection on the nameplate. Needed to run transformers in parallel.', ['Dyn11', 'Dyn1', 'Yyn0', 'Dd0', 'YNd11', 'Yd1', 'Single-phase', 'Other']);
export const TX_COOLING = pick('TRANSFORMER_COOLING', 'Cooling', 'MATERIAL', 'Cooling code on the nameplate.', ['ONAN (oil, natural)', 'ONAF (oil, fans)', 'AN (dry, natural)', 'AF (dry, fans)', 'KNAN (ester oil)']);
export const TX_TYPE = pick('TRANSFORMER_TYPE', 'Construction', 'MATERIAL', 'Oil-filled or dry type.', ['Oil-immersed, hermetically sealed', 'Oil-immersed with conservator', 'Cast resin dry type', 'Vacuum-pressure impregnated dry type']);
export const IMPEDANCE = dec('IMPEDANCE_PCT', 'Impedance', '%', 'RATING', 'Short-circuit impedance Uk % on the nameplate.', '6', 0, 30);
export const TAPS = pick('TAP_CHANGER', 'Tap changer', 'RATING', 'Voltage adjustment taps.', ['Off-load ±2×2.5%', 'Off-load other', 'On-load (OLTC)', 'None']);

// Cable
export const CABLE_TYPE = pick('CABLE_TYPE', 'Cable type', 'MATERIAL', 'What the cable is for.', ['Power', 'Control', 'Instrumentation (screened pairs)', 'Flexible / trailing', 'Welding', 'Data / Ethernet', 'Fibre optic', 'Fire-resistant']);
export const CORES = int('CORES', 'Number of cores', '', 'DIMENSION', 'Number of insulated conductors (count the colours; “4C” = 4 cores).', '4', 1, 200);
export const CSA = pick('CROSS_SECTION_MM2', 'Conductor size', 'DIMENSION', 'Cross-section of each core in mm², printed on the cable sheath (e.g. 4x16 mm²).', ['0.5', '0.75', '1', '1.5', '2.5', '4', '6', '10', '16', '25', '35', '50', '70', '95', '120', '150', '185', '240', '300', '400', '500', '630'], 'mm²');
export const CONDUCTOR = pick('CONDUCTOR_MATERIAL', 'Conductor', 'MATERIAL', 'Metal of the conductor.', ['Copper', 'Tinned copper', 'Aluminium']);
export const CABLE_INSULATION = pick('CABLE_INSULATION', 'Insulation / sheath', 'MATERIAL', 'Printed on the sheath (e.g. XLPE/SWA/PVC).', ['PVC', 'XLPE', 'EPR', 'Rubber', 'Silicone', 'LSZH (low smoke zero halogen)', 'PUR']);
export const ARMOUR = pick('ARMOUR', 'Armour / screen', 'MATERIAL', 'Protection layer under the outer sheath.', ['Unarmoured', 'Steel wire armour (SWA)', 'Aluminium wire armour (AWA)', 'Steel tape armour (STA)', 'Copper braid screen', 'Foil screen']);
export const CABLE_VOLTAGE = pick('CABLE_VOLTAGE_RATING', 'Voltage rating', 'RATING', 'Printed on the sheath.', ['300/500 V', '450/750 V', '0.6/1 kV', '1.8/3 kV', '3.6/6 kV', '6.35/11 kV', '12/20 kV', '18/30 kV']);
export const LENGTH_M = dec('LENGTH_M', 'Length', 'm', 'DIMENSION', 'Length per item, drum or coil.', '100');

// Sensors & instruments
export const SENSOR_PRINCIPLE = pick('SENSING_PRINCIPLE', 'Sensing principle', 'MATERIAL', 'How it detects. Inductive = metal only; capacitive = any material incl. liquids; magnetic = magnet on cylinder piston.', ['Inductive', 'Capacitive', 'Magnetic (reed / Hall)', 'Ultrasonic', 'Photoelectric diffuse', 'Photoelectric retro-reflective', 'Photoelectric through-beam', 'Background suppression', 'Fibre optic', 'Laser distance']);
export const HOUSING = pick('SENSOR_HOUSING', 'Housing size', 'DIMENSION', 'Threaded barrel size (M12 = 12 mm thread) or block shape.', ['M5', 'M8', 'M12', 'M18', 'M30', 'Rectangular / block', 'Slot / fork', 'Other']);
export const SENSE_RANGE = dec('SENSING_RANGE_MM', 'Sensing distance / range', 'mm', 'RATING', 'Rated operating distance (Sn) on the label.', '8');
export const SWITCH_OUT = pick('SWITCHING_OUTPUT', 'Output', 'CONNECTION', 'Must match the PLC input. PNP is standard in Europe/Africa; NPN in Asian machines. NO = signal when target present.', [['PNP_NO', 'PNP, NO'], ['PNP_NC', 'PNP, NC'], ['PNP_NONC', 'PNP, NO+NC'], ['NPN_NO', 'NPN, NO'], ['NPN_NC', 'NPN, NC'], ['2WIRE_DC', '2-wire DC'], ['2WIRE_AC', '2-wire AC/DC'], ['ANALOG', 'Analogue 4–20 mA / 0–10 V'], ['IOLINK', 'IO-Link'], ['RELAY', 'Relay']]);
export const CONNECTION_EL = pick('ELECTRICAL_CONNECTION', 'Electrical connection', 'CONNECTION', 'Cable tail or plug-in connector.', ['Cable 2 m', 'Cable 5 m', 'Connector M8 3-pin', 'Connector M8 4-pin', 'Connector M12 4-pin', 'Connector M12 5-pin', 'DIN 43650 (valve plug)', 'Terminal box', 'Cable gland M20']);
export const FLUSH = pick('FLUSH_MOUNTING', 'Mounting in metal', 'CONNECTION', 'Flush = can be mounted level with metal (shorter range). Non-flush = tip must stick out.', ['Flush (embeddable)', 'Non-flush']);
export const LIGHT = pick('LIGHT_TYPE', 'Light type', 'MATERIAL', 'Emitter type.', ['Red visible', 'Infrared', 'Laser', 'Blue / white']);
export const MEAS_RANGE = text('MEASURING_RANGE', 'Measuring range', 'RATING', 'Minimum to maximum with unit, as on the label or order code.', '0–10 bar', 40);
export const PRESSURE_TYPE = pick('PRESSURE_TYPE', 'Pressure reference', 'RATING', 'Gauge (relative to air), absolute, or differential between two ports.', ['Gauge', 'Absolute', 'Differential', 'Vacuum / compound']);
export const ANALOG_OUT = pick('INSTRUMENT_OUTPUT', 'Output signal', 'CONNECTION', 'Signal sent to the PLC or display.', SIGNAL_OUT);
export const PROCESS_CONN = pick('PROCESS_CONNECTION', 'Process connection', 'CONNECTION', 'Thread or flange that connects to the pipe or tank.', ['G 1/4" (BSPP)', 'G 1/2" (BSPP)', '1/4" NPT', '1/2" NPT', 'M20x1.5', 'Flange DN25', 'Flange DN50', 'Flange 1" ANSI', 'Tri-clamp 1.5"', 'Tri-clamp 2"', 'Wafer / between flanges', 'Other']);
export const WETTED = pick('WETTED_MATERIAL', 'Wetted material', 'MATERIAL', 'Material touching the process fluid.', ['Stainless 316L', 'Stainless 304', 'Hastelloy C', 'Ceramic', 'Titanium', 'Tantalum', 'PTFE / PFA', 'Brass']);
export const ACCURACY = dec('ACCURACY_PCT', 'Accuracy', '% of span', 'RATING', 'Accuracy stated on the datasheet.', '0.25', 0, 20);
export const TEMP_ELEMENT = pick('TEMPERATURE_ELEMENT', 'Sensing element', 'MATERIAL', 'RTD (PT100) for accuracy up to ~600 °C; thermocouples for higher temperatures.', ['PT100', 'PT1000', 'Thermocouple type K', 'Thermocouple type J', 'Thermocouple type T', 'Thermocouple type N', 'Thermocouple type S/R', 'NTC thermistor', 'Bimetal dial thermometer']);
export const WIRES = pick('RTD_WIRES', 'Wiring', 'CONNECTION', 'Number of wires (RTDs) or elements.', ['2-wire', '3-wire', '4-wire', 'Duplex (2 elements)']);
export const SHEATH_D = dec('SHEATH_DIAMETER_MM', 'Sheath / stem diameter', 'mm', 'DIMENSION', 'Diameter of the probe.', '6');
export const INSERTION = dec('INSERTION_LENGTH_MM', 'Insertion length', 'mm', 'DIMENSION', 'Length that goes into the process.', '150');
export const FLOW_PRINCIPLE = pick('FLOW_PRINCIPLE', 'Measuring principle', 'MATERIAL', 'Electromagnetic needs conductive liquid (water, slurries); Coriolis for mass flow and high accuracy; vortex for steam and gas.', ['Electromagnetic', 'Coriolis (mass)', 'Vortex', 'Ultrasonic clamp-on', 'Ultrasonic inline', 'Turbine', 'Positive displacement', 'Variable area (rotameter)', 'Thermal mass', 'Differential pressure']);
export const LINE_SIZE = pick('LINE_SIZE', 'Line size', 'DIMENSION', 'Nominal pipe size. DN = millimetres; inches in brackets.', DN);
export const LINER = pick('LINER_MATERIAL', 'Liner / wetted lining', 'MATERIAL', 'Inside lining (electromagnetic meters).', ['Hard rubber', 'Soft rubber', 'PTFE', 'PFA', 'Polyurethane', 'Ceramic', 'Not applicable']);
export const LEVEL_PRINCIPLE = pick('LEVEL_PRINCIPLE', 'Measuring principle', 'MATERIAL', 'How level is detected.', ['Radar (non-contact)', 'Guided wave radar', 'Ultrasonic', 'Hydrostatic / submersible', 'Float switch', 'Vibrating fork', 'Capacitive', 'Conductive probe', 'Magnetic level gauge']);
export const ENC_TYPE = pick('ENCODER_TYPE', 'Encoder type', 'MATERIAL', 'Incremental gives pulses; absolute keeps position after power loss.', ['Incremental', 'Absolute single-turn', 'Absolute multi-turn', 'Resolver']);
export const RESOLUTION = text('RESOLUTION', 'Resolution', 'RATING', 'Pulses per revolution (PPR) or bits.', '1024 PPR', 20);
export const ENC_SHAFT = pick('ENCODER_SHAFT', 'Shaft', 'CONNECTION', 'Solid shaft (needs coupling) or hollow / blind hollow shaft.', ['Solid shaft', 'Hollow shaft', 'Blind hollow shaft']);
export const ENC_OUT = pick('ENCODER_OUTPUT', 'Interface', 'CONNECTION', 'Electrical interface.', ['TTL / RS422 (5 V)', 'HTL push-pull (10–30 V)', 'Sin/Cos 1 Vpp', 'SSI', 'BiSS', 'EnDat', 'Profinet', 'EtherCAT', 'CANopen']);

// Valves (solenoid) & pneumatics
export const VALVE_FUNCTION = pick('VALVE_FUNCTION', 'Valve function', 'RATING', 'Ports/positions. 2/2 = on-off; 3/2 = single-acting cylinder; 5/2 and 5/3 = double-acting cylinder. NC = closed when de-energised.', ['2/2 NC', '2/2 NO', '3/2 NC', '3/2 NO', '5/2 single solenoid', '5/2 double solenoid', '5/3 closed centre', '5/3 exhaust centre', '5/3 pressure centre']);
export const PORT_SIZE = pick('PORT_SIZE', 'Port size', 'DIMENSION', 'Thread size of the ports.', ['M5', 'G 1/8"', 'G 1/4"', 'G 3/8"', 'G 1/2"', 'G 3/4"', 'G 1"', '1/4" NPT', '1/2" NPT', 'Push-in 6 mm', 'Push-in 8 mm', 'Push-in 10 mm', 'Push-in 12 mm', 'Sub-base / manifold']);
export const MEDIUM = pick('MEDIUM', 'Medium', 'RATING', 'What flows through it.', ['Compressed air', 'Water', 'Hot water', 'Steam', 'Oil', 'Fuel', 'Gas', 'Vacuum', 'Chemicals', 'Food liquids']);
export const PRESSURE_RANGE = text('PRESSURE_RANGE', 'Operating pressure range', 'RATING', 'Minimum and maximum working pressure.', '0.5–10 bar', 30);
export const SEAL_MAT = pick('SEAL_MATERIAL', 'Seal / elastomer material', 'MATERIAL', 'Choose to suit the fluid and temperature.', ELASTOMER);
export const ACTUATION = pick('VALVE_OPERATION', 'Operation', 'RATING', 'Direct acting works from 0 bar; pilot operated needs a minimum pressure difference.', ['Direct acting', 'Pilot operated (servo-assisted)', 'Pneumatic pilot', 'Manual / mechanical']);
export const BODY = pick('BODY_MATERIAL', 'Body material', 'MATERIAL', 'Material of the body / casing.', BODY_METAL);
export const CYL_TYPE = pick('CYLINDER_TYPE', 'Cylinder type', 'MATERIAL', 'Standard type so other brands fit the same mounting.', ['ISO 15552 profile/tie-rod', 'ISO 6432 round (mini)', 'ISO 21287 compact', 'Short-stroke / compact (non-ISO)', 'Guided cylinder', 'Rodless', 'Rotary actuator', 'Bellows / air spring']);
export const BORE = pick('CYLINDER_BORE_MM', 'Bore diameter', 'DIMENSION', 'Piston diameter — the first number in the size (e.g. 63x200 = bore 63 mm).', ['8', '10', '12', '16', '20', '25', '32', '40', '50', '63', '80', '100', '125', '160', '200', '250', '320'], 'mm');
export const STROKE = dec('STROKE_MM', 'Stroke', 'mm', 'DIMENSION', 'Travel of the rod — the second number in the size.', '200', 1);
export const ACTING = pick('ACTING', 'Action', 'RATING', 'Double acting = air both ways; single acting = spring return.', ['Double acting', 'Single acting, spring return', 'Single acting, spring extend']);
export const CUSHIONING = pick('CUSHIONING', 'End cushioning', 'RATING', 'Slows the piston at the ends.', ['None', 'Elastic (rubber pads)', 'Adjustable pneumatic', 'Self-adjusting']);
export const MAGNETIC = yes('MAGNETIC_PISTON', 'Magnetic piston (for position sensors)', 'RATING', 'Yes if position sensors clip onto the cylinder.');
export const ROD_THREAD = text('ROD_THREAD', 'Piston rod thread', 'CONNECTION', 'Thread on the rod end.', 'M16x1.5', 20);
export const ROD_D = dec('ROD_DIAMETER_MM', 'Rod diameter', 'mm', 'DIMENSION', 'Diameter of the piston rod.', '45');
export const MAX_PRESSURE_BAR = dec('MAX_PRESSURE_BAR', 'Maximum working pressure', 'bar', 'RATING', 'Highest allowed working pressure on the nameplate or datasheet.', '250');
export const HYD_MOUNT = pick('HYDRAULIC_MOUNTING', 'Mounting', 'CONNECTION', 'How the cylinder is attached.', ['Rear clevis', 'Front flange', 'Rear flange', 'Trunnion', 'Foot', 'Tie-rod extended', 'Spherical eye']);
export const SEAL_KIT = text('SEAL_KIT_NUMBER', 'Seal kit number', 'IDENTITY', 'Part number of the repair seal kit, if known.', 'SK-80/45-H', 60);
export const DISPLACEMENT = dec('DISPLACEMENT_CC', 'Displacement', 'cm³/rev', 'RATING', 'Volume per revolution, in the type code.', '45');
export const HYD_PUMP_TYPE = pick('HYDRAULIC_UNIT_TYPE', 'Type', 'MATERIAL', 'Construction.', ['External gear', 'Internal gear', 'Vane', 'Axial piston fixed', 'Axial piston variable', 'Radial piston', 'Orbital motor (gerotor)']);
export const SAE_FLANGE = text('MOUNTING_FLANGE', 'Mounting flange / shaft', 'CONNECTION', 'Flange standard and shaft (e.g. SAE B 2-bolt, splined 13T).', 'SAE B 2-bolt, keyed 22 mm', 60);

// Bearings & power transmission
export const BEARING_DESIGNATION = text('BEARING_DESIGNATION', 'Bearing designation', 'IDENTITY', 'The full number stamped on the bearing ring or box, including suffixes (2RS, ZZ, C3…). The suffixes matter.', '6205-2RS1/C3', 40);
export const BEARING_TYPE = pick('BEARING_TYPE', 'Bearing type', 'MATERIAL', 'Basic type. Most electric motors and fans use deep-groove ball bearings (numbers starting 6…).', ['Deep groove ball', 'Angular contact ball', 'Self-aligning ball', 'Cylindrical roller', 'Spherical roller', 'Tapered roller', 'Needle roller', 'Thrust ball', 'Spherical roller thrust', 'Insert (Y-bearing)', 'Cam follower / track roller', 'Linear bearing']);
export const BORE_D = dec('BORE_DIAMETER_MM', 'Bore (inner) diameter d', 'mm', 'DIMENSION', 'Inside diameter — the shaft size.', '25', 0.5);
export const OUTER_D = dec('OUTER_DIAMETER_MM', 'Outside diameter D', 'mm', 'DIMENSION', 'Outside diameter.', '52', 1);
export const WIDTH_B = dec('WIDTH_MM', 'Width B', 'mm', 'DIMENSION', 'Width / thickness.', '15', 0.5);
export const SEALING = pick('BEARING_SEALING', 'Seals / shields', 'MATERIAL', 'Suffix on the number. 2RS = rubber seals both sides; 2Z / ZZ = metal shields; open = no seals.', ['Open', 'Shield one side (Z)', 'Shields both sides (2Z / ZZ)', 'Seal one side (RS)', 'Seals both sides (2RS / 2RSH / DDU)', 'Low-friction seals (2RZ / LLB)']);
export const CLEARANCE = pick('INTERNAL_CLEARANCE', 'Internal clearance', 'RATING', 'Suffix C3 = more clearance for heat (electric motors). No suffix = normal (CN).', ['C2', 'CN (normal)', 'C3', 'C4', 'C5']);
export const CAGE = pick('CAGE_MATERIAL', 'Cage', 'MATERIAL', 'Cage material (suffix J/TN9/M…).', ['Pressed steel', 'Machined brass (M / MA)', 'Polyamide (TN9 / P)', 'Full complement (no cage)']);
export const PRECISION = pick('PRECISION_CLASS', 'Precision class', 'RATING', 'Normal for general machines; P5/P4 for machine-tool spindles.', ['Normal (P0 / ABEC 1)', 'P6 (ABEC 3)', 'P5 (ABEC 5)', 'P4 (ABEC 7)', 'P2 (ABEC 9)']);
export const LUBE = pick('LUBRICATION', 'Lubrication', 'MATERIAL', 'Grease fill or special lubrication.', ['Standard grease', 'High-temperature grease', 'Low-temperature grease', 'Food-grade (NSF H1) grease', 'Solid oil', 'Oil lubricated / none']);
export const BORE_FORM = pick('BORE_FORM', 'Bore form', 'DIMENSION', 'Cylindrical, or tapered (suffix K) for adapter sleeves.', ['Cylindrical', 'Tapered 1:12 (K)', 'Tapered 1:30 (K30)']);
export const DYN_LOAD = dec('DYNAMIC_LOAD_KN', 'Dynamic load rating C', 'kN', 'RATING', 'From the maker’s catalogue.', '14.8');
export const PLAIN_MAT = pick('BUSH_MATERIAL', 'Bush material', 'MATERIAL', 'Material of the bush / sleeve.', ['Bronze', 'Sintered bronze (oil-impregnated)', 'PTFE-lined steel (DU type)', 'Polymer / plastic', 'Graphite bronze', 'Babbitt / white metal']);
export const FLANGED = yes('FLANGED', 'Flanged', 'DIMENSION', 'Yes if it has a collar/flange.');
export const HOUSING_TYPE = pick('HOUSING_TYPE', 'Housing type', 'MATERIAL', 'Shape of the housing.', ['Pillow block (UCP)', 'Square flange 4-bolt (UCF)', 'Oval flange 2-bolt (UCFL)', 'Round flange (UCFC)', 'Take-up (UCT)', 'Split plummer block (SNL/SN)', 'Hanger']);
export const SHAFT_FOR = dec('SHAFT_SIZE_MM', 'Shaft diameter', 'mm', 'DIMENSION', 'Shaft size it fits.', '40', 1);
export const INSERT = text('INSERT_DESIGNATION', 'Insert / bearing designation', 'IDENTITY', 'Bearing that sits in the housing.', 'UC208', 30);
export const HOUSING_MAT = pick('HOUSING_MATERIAL', 'Housing material', 'MATERIAL', 'Cast iron for general use; stainless or thermoplastic for wash-down.', ['Cast iron', 'Pressed steel', 'Stainless steel', 'Thermoplastic', 'Ductile iron', 'Aluminium']);
export const COUPLING_TYPE = pick('COUPLING_TYPE', 'Coupling type', 'MATERIAL', 'Type of flexible coupling.', ['Jaw / spider (Rotex type)', 'Tyre (Fenaflex type)', 'Gear', 'Grid', 'Disc / diaphragm', 'Pin & bush', 'Chain', 'Fluid', 'Rigid / flange', 'Oldham', 'Bellows']);
export const COUPLING_SIZE = text('COUPLING_SIZE', 'Coupling size', 'DIMENSION', 'Size number from the coupling hub or catalogue.', 'Rotex 38', 30);
export const BORES = text('BORE_SIZES', 'Bore sizes (driver / driven)', 'DIMENSION', 'Shaft holes in each half, with keyway.', '38 mm / 42 mm with key', 40);
export const MAX_TORQUE = dec('MAX_TORQUE_NM', 'Rated torque', 'N·m', 'RATING', 'Nominal torque from the catalogue.', '325');
export const ELEMENT_MAT = pick('ELEMENT_MATERIAL', 'Flexible element', 'MATERIAL', 'Spider / insert / tyre material (often colour-coded).', ['NBR', 'Polyurethane 92 Sh A (yellow)', 'Polyurethane 98 Sh A (red)', 'Hytrel', 'Natural rubber', 'Chloroprene', 'Steel']);
export const TAPER_BUSH = text('TAPER_BUSH', 'Taper bush size', 'CONNECTION', 'Taper-lock bush number if used (e.g. 2012, 2517).', '2012 x 30 mm', 20);
export const VBELT_SECTION = pick('BELT_SECTION', 'Belt section', 'DIMENSION', 'Profile code at the start of the number (e.g. SPB 2000 → SPB). Classical: Z, A, B, C; Wedge: SPZ, SPA, SPB, SPC; narrow US: 3V, 5V, 8V; cogged: XPZ, XPA, XPB, XPC.', ['Z / 10', 'A / 13', 'B / 17', 'C / 22', 'D / 32', 'SPZ', 'SPA', 'SPB', 'SPC', 'XPZ', 'XPA', 'XPB', 'XPC', '3V', '5V', '8V', '3VX', '5VX', 'Poly-V PJ', 'Poly-V PK', 'Poly-V PL']);
export const BELT_LENGTH = int('BELT_LENGTH_MM', 'Belt length', 'mm', 'DIMENSION', 'The number after the section (e.g. SPB 2000 = 2000 mm).', '2000', 100);
export const LENGTH_BASIS = pick('LENGTH_BASIS', 'Length measured as', 'DIMENSION', 'Wedge belts use datum/pitch length (Ld/Lp); classical belts often inside length (Li).', ['Datum / pitch length (Ld / Lp)', 'Inside length (Li)', 'Outside length (La)']);
export const BELT_BUILD = pick('BELT_CONSTRUCTION', 'Construction', 'MATERIAL', 'Wrapped (smooth) or raw-edge cogged (notched, runs cooler on small pulleys).', ['Wrapped', 'Raw-edge cogged', 'Banded (joined) belts', 'Link belt']);
export const MATCHED_SET = int('MATCHED_SET_QTY', 'Belts per matched set', 'pcs', 'PACK', 'On multi-belt drives all belts must be replaced together as a matched set.', '3', 1, 20);
export const TIMING_PROFILE = pick('TOOTH_PROFILE', 'Tooth profile', 'DIMENSION', 'Code before the size (e.g. 8M-1200-30 → HTD 8M).', ['MXL', 'XL', 'L', 'H', 'XH', 'T2.5', 'T5', 'T10', 'T20', 'AT5', 'AT10', 'AT20', 'HTD 3M', 'HTD 5M', 'HTD 8M', 'HTD 14M', 'GT2 / GT3', 'STD S8M', 'RPP 8M']);
export const TEETH = int('NUMBER_OF_TEETH', 'Number of teeth', '', 'DIMENSION', 'Count of teeth.', '150', 1);
export const BELT_WIDTH = dec('BELT_WIDTH_MM', 'Width', 'mm', 'DIMENSION', 'Belt width — last number in the code.', '30', 1);
export const BELT_MATERIAL = pick('BELT_MATERIAL', 'Belt material', 'MATERIAL', 'Body and tension cord.', ['Rubber / neoprene, glass fibre', 'Polyurethane, steel cord', 'Polyurethane, aramid', 'HNBR, glass fibre']);
export const CONVEYOR_BELT_TYPE = pick('CONVEYOR_BELT_TYPE', 'Belt type', 'MATERIAL', 'Carcass type.', ['Fabric EP (polyester/nylon)', 'Steel cord (ST)', 'Solid woven PVC/PVG', 'PVC / PU light conveyor', 'Modular plastic', 'Wire mesh', 'Chevron / cleated']);
export const BELT_RATING = text('BELT_RATING', 'Strength rating / plies', 'RATING', 'Printed on the belt or order, e.g. EP630/4 = 630 N/mm with 4 plies.', 'EP630/4', 20);
export const COVERS = text('COVER_THICKNESS', 'Top + bottom cover thickness', 'DIMENSION', 'Rubber cover thickness (top + bottom).', '6 + 2 mm', 20);
export const COVER_GRADE = pick('COVER_GRADE', 'Cover grade', 'MATERIAL', 'Grade suited to the material carried.', ['Abrasion resistant (DIN Y / W / X)', 'Heat resistant (T1–T3)', 'Oil resistant (MOR / G)', 'Fire resistant (K / S)', 'Food grade (FDA)', 'General purpose']);
export const SPLICE = pick('SPLICE_TYPE', 'Joining method', 'CONNECTION', 'How the belt ends are joined.', ['Hot vulcanised', 'Cold bonded', 'Mechanical fasteners', 'Endless (factory made)']);
export const CHAIN_PITCH = pick('CHAIN_SIZE', 'Chain size', 'DIMENSION', 'ISO/BS number (e.g. 08B) or ANSI number (e.g. 40). Pitch in brackets.', ['04B (6 mm)', '05B (8 mm)', '06B (3/8")', '08B (1/2")', '10B (5/8")', '12B (3/4")', '16B (1")', '20B (1-1/4")', '24B (1-1/2")', 'ANSI 25', 'ANSI 35', 'ANSI 40', 'ANSI 50', 'ANSI 60', 'ANSI 80', 'ANSI 100', 'ANSI 120', 'Conveyor chain (state in notes)']);
export const STRANDS = pick('STRANDS', 'Strands', 'DIMENSION', 'Single, double or triple row.', ['Simplex (1)', 'Duplex (2)', 'Triplex (3)']);
export const CHAIN_MAT = pick('CHAIN_MATERIAL', 'Material / finish', 'MATERIAL', 'Material for the environment.', ['Carbon steel', 'Nickel plated', 'Stainless steel', 'Self-lubricating', 'O-ring (sealed)']);
export const ATTACHMENTS = text('ATTACHMENTS', 'Attachments', 'CONNECTION', 'Special links or attachments (K1, M2, extended pins).', 'K1 every 4th link', 40);
export const SPROCKET_BORE = pick('SPROCKET_BORE', 'Bore type', 'CONNECTION', 'Pilot bore needs machining; taper bush or finished bore fit directly.', ['Pilot bore', 'Taper bush', 'Finished bore with keyway', 'QD bush']);
export const GROOVES = int('NUMBER_OF_GROOVES', 'Number of grooves', '', 'DIMENSION', 'Count of belt grooves.', '3', 1, 20);
export const PITCH_DIA = dec('PITCH_DIAMETER_MM', 'Pitch / datum diameter', 'mm', 'DIMENSION', 'Effective diameter, from the pulley code.', '200');
export const SEAL_D = dec('SEAL_SHAFT_MM', 'Shaft diameter (d)', 'mm', 'DIMENSION', 'First number of the size (e.g. 40x62x8 → 40).', '40', 1);
export const SEAL_DD = dec('SEAL_BORE_MM', 'Housing bore (D)', 'mm', 'DIMENSION', 'Second number of the size.', '62', 1);
export const SEAL_B = dec('SEAL_WIDTH_MM', 'Width (b)', 'mm', 'DIMENSION', 'Third number of the size.', '8', 1);
export const LIP_TYPE = pick('LIP_TYPE', 'Seal design', 'MATERIAL', 'Type code on the seal. TC = rubber outside, 2 lips (most common). SC = 1 lip. TB/SB = metal outside.', ['TC — double lip, rubber covered', 'SC — single lip, rubber covered', 'TB — double lip, metal case', 'SB — single lip, metal case', 'V-ring', 'PTFE lip seal', 'Cassette seal']);
export const MECH_SEAL_TYPE = pick('MECH_SEAL_TYPE', 'Seal arrangement', 'MATERIAL', 'Cartridge seals are pre-assembled and easiest to fit.', ['Single component', 'Single cartridge', 'Double cartridge', 'Tandem', 'Split seal', 'Mixer / agitator seal']);
export const MECH_SEAL_STD = pick('MECH_SEAL_STANDARD', 'Dimensional standard', 'COMPLIANCE', 'Allows equivalents from other makers.', ['EN 12756 (DIN 24960)', 'API 682', 'Pump-maker specific', 'Other']);
export const FACES = pick('SEAL_FACES', 'Seal face combination', 'MATERIAL', 'Rotating / stationary face materials.', ['Carbon / Silicon carbide', 'Silicon carbide / Silicon carbide', 'Carbon / Ceramic', 'Tungsten carbide / Tungsten carbide', 'Carbon / Tungsten carbide']);
export const SPRING_TYPE = pick('SEAL_SPRING', 'Spring type', 'MATERIAL', 'Spring arrangement.', ['Single spring', 'Multi-spring', 'Wave spring', 'Metal bellows', 'Rubber bellows']);
export const ORING_ID = dec('ORING_ID_MM', 'Inside diameter', 'mm', 'DIMENSION', 'Inner diameter.', '25.07', 0.1);
export const ORING_CS = dec('ORING_CS_MM', 'Cross-section', 'mm', 'DIMENSION', 'Thickness of the ring.', '2.62', 0.2);
export const HARDNESS = pick('HARDNESS_SHORE', 'Hardness', 'MATERIAL', '70 Shore A is standard; 90 for high pressure.', ['50 Shore A', '60 Shore A', '70 Shore A', '75 Shore A', '80 Shore A', '90 Shore A']);
export const ORING_STD = text('ORING_SIZE_CODE', 'Standard size code', 'IDENTITY', 'AS568 dash number (e.g. -121) or ISO 3601 / BS 1806 code, if known.', 'AS568-121', 20);
export const FOOD = yes('FOOD_GRADE', 'Food grade (FDA / EC 1935)', 'COMPLIANCE', 'Yes if it touches food or drink.');
export const GASKET_TYPE = pick('GASKET_TYPE', 'Gasket type', 'MATERIAL', 'Spiral wound for high pressure/temperature; sheet for general water/air.', ['Full-face sheet', 'Ring (IBC) sheet', 'Spiral wound', 'Ring type joint (RTJ)', 'Kammprofile', 'Rubber', 'PTFE envelope', 'Insulating kit']);
export const GASKET_MAT = pick('GASKET_MATERIAL', 'Gasket material', 'MATERIAL', 'Material to suit the fluid.', ['Compressed non-asbestos fibre (CNAF)', 'Flexible graphite', 'PTFE', 'Expanded PTFE', 'EPDM rubber', 'NBR rubber', 'SS316 + graphite (spiral)', 'Soft iron / steel (RTJ)']);
export const FLANGE_STD = pick('FLANGE_STANDARD', 'Flange standard', 'COMPLIANCE', 'Standard of the mating flanges.', ['EN 1092-1 (PN)', 'ASME B16.5', 'ASME B16.47', 'BS 10 (Table D/E)', 'JIS B2220']);
export const PRESSURE_RATING = pick('PRESSURE_CLASS', 'Pressure class', 'RATING', 'Printed on the flange, valve body or gasket.', PRESSURE_CLASS);
export const THICKNESS = dec('THICKNESS_MM', 'Thickness', 'mm', 'DIMENSION', 'Material thickness.', '3');
export const PACKING_MAT = pick('PACKING_MATERIAL', 'Packing material', 'MATERIAL', 'Gland packing yarn.', ['PTFE', 'Graphite', 'PTFE / graphite', 'Aramid', 'Carbon', 'Ramie / cotton']);
export const PACKING_SIZE = pick('PACKING_SECTION_MM', 'Cross-section', 'DIMENSION', 'Square size of the packing cord.', ['6', '8', '10', '12', '14', '16', '19', '22', '25'], 'mm');

// Pumps, compressors, fans
export const PUMP_TYPE = pick('PUMP_TYPE', 'Pump type', 'MATERIAL', 'Basic design.', ['End-suction', 'Inline', 'Horizontal split-case', 'Multistage horizontal', 'Multistage vertical', 'Vertical turbine', 'Submersible', 'Self-priming', 'Slurry', 'Magnetic drive', 'Canned motor']);
export const PD_TYPE = pick('PD_PUMP_TYPE', 'Pump type', 'MATERIAL', 'Positive displacement design.', ['External gear', 'Internal gear', 'Lobe', 'Screw', 'Progressive cavity (mono)', 'Air-operated diaphragm (AODD)', 'Metering / dosing diaphragm', 'Piston / plunger', 'Peristaltic (hose)', 'Vane']);
export const FLOW = dec('FLOW_M3H', 'Rated flow', 'm³/h', 'RATING', 'Duty flow on the nameplate or datasheet. 1 m³/h ≈ 16.7 L/min.', '50');
export const HEAD = dec('HEAD_M', 'Rated head', 'm', 'RATING', 'Duty head on the nameplate (10 m ≈ 1 bar of water).', '32');
export const DISCHARGE_P = dec('DISCHARGE_PRESSURE_BAR', 'Discharge pressure', 'bar', 'RATING', 'Rated outlet pressure.', '6');
export const SUCTION = pick('SUCTION_SIZE', 'Suction size', 'DIMENSION', 'Inlet nominal size.', DN);
export const DISCHARGE = pick('DISCHARGE_SIZE', 'Discharge size', 'DIMENSION', 'Outlet nominal size.', DN);
export const IMPELLER_D = dec('IMPELLER_DIAMETER_MM', 'Impeller diameter', 'mm', 'DIMENSION', 'Trimmed impeller diameter (nameplate or test certificate).', '219');
export const IMPELLER_TYPE = pick('IMPELLER_TYPE', 'Impeller type', 'MATERIAL', 'Closed for clean liquids; open/vortex for solids.', ['Closed', 'Semi-open', 'Open', 'Vortex (recessed)', 'Channel', 'Cutter / grinder']);
export const CASING_MAT = pick('CASING_MATERIAL', 'Casing material', 'MATERIAL', 'Material of the pump casing.', BODY_METAL);
export const IMPELLER_MAT = pick('IMPELLER_MATERIAL', 'Impeller material', 'MATERIAL', 'Material of the impeller.', [...BODY_METAL, 'High-chrome iron', 'Rubber lined']);
export const SHAFT_SEAL = pick('SHAFT_SEAL', 'Shaft sealing', 'MATERIAL', 'How the shaft is sealed.', ['Gland packing', 'Single mechanical seal', 'Single cartridge seal', 'Double mechanical seal', 'Magnetic drive (sealless)', 'Lip seal']);
export const LIQUID = text('LIQUID', 'Liquid handled', 'RATING', 'What is pumped, with temperature and solids if any.', 'Cooling water 35 °C', 80);
export const MAX_TEMP = dec('MAX_TEMPERATURE_C', 'Maximum temperature', '°C', 'RATING', 'Highest operating temperature.', '120', -273);
export const NPSH = dec('NPSHR_M', 'NPSH required', 'm', 'RATING', 'From the pump curve — needed to avoid cavitation.', '3.2');
export const PUMP_STD = pick('PUMP_STANDARD', 'Pump standard', 'COMPLIANCE', 'Standard pumps can be replaced by other makers with the same dimensions.', ['EN 733', 'ISO 2858 / ISO 5199', 'API 610', 'ASME B73.1', 'Maker standard']);
export const VISCOSITY = text('VISCOSITY', 'Liquid viscosity', 'RATING', 'Viscosity of the pumped liquid.', '500 cP', 30);
export const COMP_TYPE = pick('COMPRESSOR_TYPE', 'Compressor type', 'MATERIAL', 'Basic design.', ['Rotary screw', 'Reciprocating piston', 'Centrifugal', 'Scroll', 'Rotary vane', 'Tooth / claw', 'Refrigeration hermetic', 'Refrigeration semi-hermetic']);
export const OIL_FREE = yes('OIL_FREE', 'Oil-free', 'RATING', 'Yes for oil-free (class 0) air — food, pharma, electronics.');
export const FAD = dec('FREE_AIR_DELIVERY_M3MIN', 'Free air delivery (FAD)', 'm³/min', 'RATING', 'Air output at working pressure (1 m³/min ≈ 35.3 cfm).', '6.5');
export const WORK_P = dec('WORKING_PRESSURE_BAR', 'Working pressure', 'bar', 'RATING', 'Maximum working pressure.', '8');
export const COOL_MEDIUM = pick('COOLING_MEDIUM', 'Cooling', 'MATERIAL', 'Air or water cooled.', ['Air-cooled', 'Water-cooled']);
export const VSD = yes('VARIABLE_SPEED', 'Variable speed drive', 'RATING', 'Yes if speed is controlled by a built-in VSD.');
export const DRYER = yes('INTEGRATED_DRYER', 'Integrated dryer', 'RATING', 'Yes if a refrigerant dryer is built in.');
export const FAN_TYPE = pick('FAN_TYPE', 'Fan / blower type', 'MATERIAL', 'Look at the wheel: axial = propeller blades; centrifugal = drum-shaped wheel blowing out sideways; roots/side-channel = positive-displacement blowers.', ['Axial', 'Centrifugal forward-curved', 'Centrifugal backward-curved', 'Radial blade', 'Mixed flow', 'Roots (lobe) blower', 'Side-channel blower', 'Plug fan']);
export const AIRFLOW = dec('AIRFLOW_M3H', 'Airflow', 'm³/h', 'RATING', 'Rated airflow.', '12000');
export const STATIC_P = dec('STATIC_PRESSURE_PA', 'Static pressure', 'Pa', 'RATING', 'Pressure at the rated airflow.', '800');
export const DRIVE_ARR = pick('DRIVE_ARRANGEMENT', 'Drive', 'CONNECTION', 'Motor connection.', ['Direct drive', 'Belt drive', 'Coupling drive']);
export const FAN_D = dec('FAN_DIAMETER_MM', 'Impeller / wheel diameter', 'mm', 'DIMENSION', 'Diameter of the fan wheel.', '630');

// Valves (process)
export const VALVE_TYPE = pick('VALVE_TYPE', 'Valve type', 'MATERIAL', 'Design. Ball/butterfly = quick on-off; globe = regulating; check = one-way; gate = full-bore isolation.', ['Ball', 'Gate', 'Globe', 'Butterfly', 'Check (swing)', 'Check (lift / dual-plate)', 'Plug', 'Diaphragm', 'Needle', 'Knife gate', 'Pressure relief / safety', 'Pressure reducing', 'Control valve', 'Foot valve', 'Strainer (Y-type)']);
export const VALVE_SIZE = pick('VALVE_SIZE', 'Size', 'DIMENSION', 'Nominal size on the body (DN mm or inches).', DN);
export const END_CONN = pick('END_CONNECTION', 'End connection', 'CONNECTION', 'How it joins the pipe.', END_CONNECTION);
export const TRIM = text('TRIM_SEAT', 'Trim / seat material', 'MATERIAL', 'Seat and ball/disc material (e.g. SS316 ball, PTFE seats).', 'SS316 ball, RPTFE seats', 60);
export const OPERATOR = pick('VALVE_OPERATOR', 'Operation', 'CONNECTION', 'How the valve is operated.', ['Lever', 'Handwheel', 'Gear operator', 'Pneumatic actuator double-acting', 'Pneumatic actuator spring-return', 'Electric actuator', 'Solenoid', 'Self-acting']);
export const FAIL = pick('FAIL_POSITION', 'Fail-safe position', 'RATING', 'Position on loss of air/power (actuated valves only).', ['Fail closed', 'Fail open', 'Fail last position', 'Not applicable']);
export const SET_P = dec('SET_PRESSURE_BAR', 'Set pressure', 'bar', 'RATING', 'Opening pressure on the tag (relief/safety valves).', '10');
export const VALVE_STD = text('VALVE_STANDARD', 'Design standard', 'COMPLIANCE', 'E.g. API 6D, API 600, EN 593, ASME B16.34.', 'API 6D', 40);

// Hoses & fittings
export const HOSE_APP = pick('HOSE_APPLICATION', 'Hose application', 'MATERIAL', 'What the hose carries.', ['Hydraulic', 'Pneumatic / air', 'Water', 'Steam', 'Suction & discharge', 'Chemical', 'Food & beverage', 'Fuel / oil', 'Welding gas']);
export const HOSE_ID = pick('HOSE_ID', 'Inside diameter (dash size)', 'DIMENSION', 'Bore size. Hydraulic hose dash size = sixteenths of an inch (-08 = 1/2").', ['-03 (3/16")', '-04 (1/4")', '-05 (5/16")', '-06 (3/8")', '-08 (1/2")', '-10 (5/8")', '-12 (3/4")', '-16 (1")', '-20 (1-1/4")', '-24 (1-1/2")', '-32 (2")', '2-1/2"', '3"', '4"', '6"']);
export const HOSE_STD = pick('HOSE_STANDARD', 'Hose standard', 'COMPLIANCE', 'Printed along the hose.', ['EN 853 1SN', 'EN 853 2SN', 'EN 857 2SC', 'EN 856 4SP', 'EN 856 4SH', 'SAE 100R1AT', 'SAE 100R2AT', 'SAE 100R12', 'SAE 100R13', 'EN 12115 (chemical)', 'ISO 6134 (steam)', 'Other']);
export const END_FITTINGS = text('END_FITTINGS', 'End fittings (end 1 / end 2)', 'CONNECTION', 'Fitting type and size at each end, with orientation if angled.', 'JIC 37° female -08 / BSP 60° female 1/2" 90°', 120);
export const FITTING_TYPE = pick('FITTING_TYPE', 'Fitting type', 'MATERIAL', 'Shape of the fitting.', ['Elbow 90°', 'Elbow 45°', 'Equal tee', 'Reducing tee', 'Concentric reducer', 'Eccentric reducer', 'Union', 'Coupling / socket', 'Nipple', 'Cap / plug', 'Flange weld-neck', 'Flange slip-on', 'Flange blind', 'Adapter']);
export const SCHEDULE = pick('SCHEDULE', 'Wall schedule / class', 'DIMENSION', 'Wall thickness series.', ['SCH 10', 'SCH 40', 'SCH 80', 'SCH 160', 'XXS', 'Class 3000 (forged)', 'Class 6000 (forged)', 'Medium (BS 1387)', 'Heavy (BS 1387)', 'PN10 (plastic)', 'PN16 (plastic)']);

// Filters
export const FILTER_APP = pick('FILTER_APPLICATION', 'Filter application', 'MATERIAL', 'What the filter cleans.', ['Engine air intake', 'Compressor air intake', 'Compressed air line', 'Hydraulic return', 'Hydraulic pressure', 'Lube oil', 'Fuel', 'Water / process liquid', 'Dust collector bag', 'Dust collector cartridge', 'HVAC panel / bag', 'Oil separator (compressor)']);
export const MICRON = pick('FILTER_RATING_MICRON', 'Filtration rating', 'RATING', 'Particle size it stops (smaller = finer), printed on the element.', ['0.01', '0.1', '1', '3', '5', '10', '25', '40', '60', '100', '150', '250', '500'], 'µm');
export const FILTER_CLASS = text('FILTER_EFFICIENCY', 'Efficiency class', 'RATING', 'E.g. β≥200, ISO 16890 ePM1 70%, G4/F7/F9, MERV 13.', 'ISO ePM1 70% (F7)', 40);
export const FILTER_DIMS = text('FILTER_DIMENSIONS', 'Dimensions', 'DIMENSION', 'Outside diameter × inside diameter × length (cartridges) or W × H × D (panels).', 'OD 130 × ID 72 × L 250 mm', 60);
export const MEDIA = pick('FILTER_MEDIA', 'Filter media', 'MATERIAL', 'Material of the element.', ['Cellulose', 'Glass fibre', 'Synthetic', 'Stainless mesh', 'Polyester needlefelt', 'PTFE membrane', 'Activated carbon']);

// Fasteners & springs
export const FASTENER_TYPE = pick('FASTENER_TYPE', 'Fastener type', 'MATERIAL', 'Basic type.', ['Hex bolt (part thread)', 'Hex set screw (full thread)', 'Socket head cap screw', 'Countersunk screw', 'Stud / threaded rod', 'Hex nut', 'Nyloc nut', 'Flat washer', 'Spring washer', 'Anchor bolt', 'Rivet', 'Self-tapping screw', 'Grub screw', 'Eye bolt', 'U-bolt']);
export const THREAD = pick('THREAD_STANDARD', 'Thread', 'DIMENSION', 'Metric coarse is standard (M12). Fine pitch is written M12x1.25. Imperial: UNC/UNF/BSW.', ['Metric coarse', 'Metric fine', 'UNC', 'UNF', 'BSW', 'BSF', 'Not threaded']);
export const THREAD_D = pick('THREAD_DIAMETER', 'Diameter', 'DIMENSION', 'Nominal diameter.', ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M14', 'M16', 'M20', 'M24', 'M27', 'M30', 'M36', 'M42', 'M48', '1/4"', '5/16"', '3/8"', '1/2"', '5/8"', '3/4"', '7/8"', '1"']);
export const FASTENER_L = dec('FASTENER_LENGTH_MM', 'Length', 'mm', 'DIMENSION', 'Length under the head.', '50', 1);
export const PROPERTY_CLASS = pick('PROPERTY_CLASS', 'Strength / property class', 'RATING', 'Stamped on the head (8.8, 10.9…) or A2/A4 for stainless.', ['4.6', '5.6', '8.8', '10.9', '12.9', 'A2-70', 'A4-70', 'A4-80', 'Grade 5', 'Grade 8']);
export const FINISH = pick('FINISH', 'Finish / material', 'MATERIAL', 'Coating or material.', ['Plain / black', 'Zinc plated', 'Hot-dip galvanised', 'Stainless A2 (304)', 'Stainless A4 (316)', 'Brass', 'Geomet / Dacromet']);
export const SPRING_KIND = pick('SPRING_TYPE', 'Spring type', 'MATERIAL', 'Compression springs get shorter under load; extension springs have hooks and stretch; torsion springs twist.', ['Compression', 'Extension', 'Torsion', 'Disc (Belleville)', 'Gas spring']);
export const WIRE_D = dec('WIRE_DIAMETER_MM', 'Wire diameter', 'mm', 'DIMENSION', 'Thickness of the spring wire.', '2');
export const FREE_L = dec('FREE_LENGTH_MM', 'Free length', 'mm', 'DIMENSION', 'Unloaded length.', '60');

// Lubricants & chemicals
export const LUBE_APP = pick('LUBRICANT_APPLICATION', 'Application', 'MATERIAL', 'What the oil is used for.', ['Gear oil (industrial)', 'Hydraulic oil', 'Compressor oil', 'Turbine oil', 'Engine oil', 'Slideway oil', 'Heat transfer oil', 'Chain / open gear', 'Spindle oil', 'Refrigeration oil', 'Transformer oil']);
export const ISO_VG = pick('ISO_VG', 'Viscosity grade (ISO VG / SAE)', 'RATING', 'Number on the drum (e.g. “68” in HLP 68). Never mix grades.', ['ISO VG 2', 'ISO VG 10', 'ISO VG 22', 'ISO VG 32', 'ISO VG 46', 'ISO VG 68', 'ISO VG 100', 'ISO VG 150', 'ISO VG 220', 'ISO VG 320', 'ISO VG 460', 'ISO VG 680', 'ISO VG 1000', 'SAE 15W-40', 'SAE 10W-30', 'SAE 30', 'SAE 40', 'SAE 80W-90', 'SAE 85W-140']);
export const BASE_OIL = pick('BASE_OIL', 'Base oil', 'MATERIAL', 'Mineral or synthetic. Do not mix PAG with other oils.', ['Mineral', 'Synthetic PAO', 'Synthetic ester', 'Synthetic PAG', 'Semi-synthetic', 'Bio-based']);
export const LUBE_SPEC = text('LUBRICANT_SPECIFICATION', 'Specification / approvals', 'COMPLIANCE', 'Classification on the label, e.g. DIN 51524-2 HLP, DIN 51517-3 CLP, API CK-4, OEM approval.', 'DIN 51524-2 HLP', 80);
export const NSF_H1 = yes('NSF_H1', 'Food grade NSF H1', 'COMPLIANCE', 'Required where incidental food contact is possible.');
export const PACK_L = pick('PACK_SIZE_L', 'Pack size', 'PACK', 'Container size.', ['0.4 kg cartridge', '1 L / 1 kg', '4 L', '5 L', '18 L / 18 kg pail', '20 L', '180 kg drum', '205 L / 208 L drum', '1000 L IBC', 'Bulk'], '');
export const PRODUCT_NAME = text('PRODUCT_NAME', 'Brand product name', 'IDENTITY', 'The product name on the label.', 'Shell Tellus S2 MX 68', 80);
export const THICKENER = pick('GREASE_THICKENER', 'Thickener', 'MATERIAL', 'Lithium complex is general-purpose; do not mix with polyurea or calcium without checking.', ['Lithium', 'Lithium complex', 'Calcium sulfonate complex', 'Polyurea', 'Aluminium complex', 'Bentonite (clay)', 'Calcium', 'Barium complex']);
export const NLGI = pick('NLGI_GRADE', 'NLGI consistency', 'RATING', 'Firmness number on the tub. NLGI 2 is most common; 00/000 for centralised systems.', ['000', '00', '0', '1', '2', '3']);
export const BASE_VISC = int('BASE_OIL_VISCOSITY', 'Base oil viscosity at 40 °C', 'cSt', 'RATING', 'From the datasheet; higher for slow, heavy loads.', '220');
export const EP = yes('EP_ADDITIVE', 'Extreme pressure (EP) additive', 'RATING', 'EP on the label means suited to shock and heavy loads.');
export const GHS = many('GHS_HAZARD', 'GHS hazard classes', 'COMPLIANCE', 'Pictograms on the label / safety data sheet (SDS).', ['Not hazardous', 'Flammable', 'Oxidiser', 'Corrosive', 'Toxic', 'Harmful / irritant', 'Health hazard (CMR)', 'Environmental hazard', 'Gas under pressure', 'Explosive']);
export const UN = text('UN_NUMBER', 'UN number', 'COMPLIANCE', 'Four-digit transport number on the SDS / drum (only for dangerous goods).', 'UN1263', 10);
export const CONCENTRATION = dec('CONCENTRATION_PCT', 'Concentration', '%', 'RATING', 'Active ingredient strength.', '48', 0, 100);
export const SDS = yes('SDS_AVAILABLE', 'Safety data sheet available', 'COMPLIANCE', 'A current SDS must be on file before chemicals are stored or used.');
export const STORAGE_T = text('STORAGE_CONDITIONS', 'Storage conditions', 'PACK', 'Temperature and handling needed in the store.', 'Below 30 °C, away from oxidisers', 80);

// Welding, abrasives, PPE
export const WELD_PROCESS = pick('WELDING_PROCESS', 'Welding process', 'MATERIAL', 'Process it is for.', ['Stick (SMAW / MMA)', 'MIG/MAG (GMAW)', 'TIG (GTAW)', 'Flux-cored (FCAW)', 'Submerged arc (SAW)', 'Gas / brazing']);
export const WELD_CLASS = text('WELDING_CLASSIFICATION', 'Classification', 'COMPLIANCE', 'AWS/EN code on the box (e.g. E7018, ER70S-6, ER308L, E6013).', 'E7018', 30);
export const WIRE_DIA = pick('ELECTRODE_DIAMETER', 'Diameter', 'DIMENSION', 'Rod or wire diameter.', ['0.8', '1.0', '1.2', '1.6', '2.0', '2.5', '3.2', '4.0', '5.0'], 'mm');
export const PACK_KG = dec('PACK_WEIGHT_KG', 'Pack weight', 'kg', 'PACK', 'Weight per box or spool.', '5');
export const ABRASIVE_TYPE = pick('ABRASIVE_TOOL_TYPE', 'Tool type', 'MATERIAL', 'What the tool is. Cutting discs are thin (1–3 mm); grinding discs are thick (6 mm+) — never grind with a cutting disc.', ['Cutting disc', 'Grinding disc', 'Flap disc', 'Wire brush', 'Drill bit (HSS)', 'Drill bit (masonry)', 'End mill', 'Turning insert', 'Tap', 'Hole saw', 'Saw blade', 'Abrasive belt / paper']);
export const TOOL_DIA = dec('TOOL_DIAMETER_MM', 'Diameter', 'mm', 'DIMENSION', 'Disc or tool diameter.', '115');
export const SUIT_FOR = many('SUITABLE_FOR', 'Suitable for', 'RATING', 'Materials it can work on.', ['Steel', 'Stainless steel (INOX)', 'Cast iron', 'Aluminium', 'Masonry / concrete', 'Wood', 'Plastic']);
export const MAX_RPM = int('MAX_RPM', 'Maximum speed', 'rpm', 'RATING', 'Printed on the disc — never exceed.', '13300');
export const GRIT = text('GRIT', 'Grit / grade', 'RATING', 'Grit number or grade.', 'P80', 10);
export const PPE_TYPE = pick('PPE_TYPE', 'PPE type', 'MATERIAL', 'Type of protective equipment.', ['Safety boots / shoes', 'Gloves', 'Safety helmet', 'Safety glasses / goggles', 'Face shield', 'Hearing protection', 'Disposable respirator', 'Half-mask respirator', 'Coverall', 'High-visibility vest', 'Full-body harness', 'Lanyard / SRL', 'Welding helmet', 'Chemical suit']);
export const PPE_STD = text('PPE_STANDARD', 'Protection standard / class', 'COMPLIANCE', 'Marking on the item, e.g. EN ISO 20345 S3, EN 388 4X42C, EN 397, EN 166, EN 352 SNR 30, EN 149 FFP2.', 'EN ISO 20345 S3 SRC', 40);
export const SIZE = text('SIZE', 'Size', 'DIMENSION', 'Size marked on the item.', '42 / L / 9', 20);

// Pipes, steel, paint
export const PIPE_MAT = pick('PIPE_MATERIAL', 'Material', 'MATERIAL', 'Pipe material, stencilled along the pipe or on the mill certificate.', ['Carbon steel seamless', 'Carbon steel ERW', 'Galvanised steel', 'Stainless 304/304L', 'Stainless 316/316L', 'Copper', 'PVC-U', 'CPVC', 'HDPE', 'PPR', 'Ductile iron', 'GRP']);
export const PIPE_STD = text('PIPE_STANDARD', 'Standard / grade', 'COMPLIANCE', 'E.g. ASTM A106 Gr B, ASTM A312 TP316L, EN 10255, ISO 4427.', 'ASTM A106 Gr B', 40);
export const PIPE_END = pick('PIPE_END', 'Ends', 'CONNECTION', 'End preparation.', ['Plain', 'Bevelled', 'Threaded & coupled', 'Socket', 'Grooved', 'Flanged']);
export const STEEL_FORM = pick('STEEL_FORM', 'Form', 'DIMENSION', 'Shape of the steel as delivered from the mill or stockist.', ['Plate', 'Sheet', 'Equal angle', 'Unequal angle', 'Channel (PFC/UPN)', 'I-beam (IPE/UB)', 'H-beam (HEA/UC)', 'Flat bar', 'Round bar', 'Square bar', 'Square hollow section', 'Rectangular hollow section', 'Chequer plate', 'Expanded mesh']);
export const STEEL_GRADE = pick('STEEL_GRADE', 'Grade', 'MATERIAL', 'Material grade on the mill certificate.', ['S235', 'S275', 'S355', 'ASTM A36', 'ASTM A572 Gr 50', 'EN8 / C45', 'EN24 / 4340', 'Stainless 304', 'Stainless 316', 'Hardox / wear plate', 'Aluminium 5083', 'Aluminium 6061']);
export const SECTION_DIMS = text('SECTION_DIMENSIONS', 'Dimensions', 'DIMENSION', 'Size in mm (e.g. 50x50x5 angle, 10 mm plate 2500x1250).', '50 x 50 x 5', 60);
export const PAINT_TYPE = pick('PAINT_TYPE', 'Coating type', 'MATERIAL', 'Generic type.', ['Primer — zinc-rich', 'Primer — epoxy', 'Primer — alkyd', 'Intermediate — epoxy MIO', 'Topcoat — polyurethane', 'Topcoat — alkyd enamel', 'Topcoat — epoxy', 'Heat-resistant (silicone)', 'Floor coating', 'Road marking', 'Thinner']);
export const RAL = text('RAL_COLOUR', 'Colour (RAL / BS code)', 'MATERIAL', 'Colour code on the tin, e.g. RAL 7035 light grey, RAL 5015 blue.', 'RAL 7035', 20);
export const GLOSS = pick('GLOSS', 'Finish', 'MATERIAL', 'Surface finish.', ['Gloss', 'Semi-gloss', 'Satin', 'Matt']);

// Electrical misc
export const PLC_MODULE = pick('PLC_MODULE_TYPE', 'Module type', 'MATERIAL', 'Function of the module.', ['CPU / controller', 'Digital input', 'Digital output', 'Digital I/O mixed', 'Analogue input', 'Analogue output', 'Temperature input (RTD/TC)', 'Communication module', 'Power supply', 'Counter / positioning', 'Safety I/O', 'Interface / bus coupler']);
export const CHANNELS = int('CHANNELS', 'Number of channels', '', 'RATING', 'Inputs or outputs on the module.', '16', 0, 512);
export const SIGNAL = pick('SIGNAL_TYPE', 'Signal type', 'RATING', 'Electrical signal.', ['24 V DC sinking', '24 V DC sourcing', '24 V DC relay', '120/230 V AC', '4–20 mA', '0–10 V', '±10 V', 'RTD', 'Thermocouple']);
export const FIRMWARE = text('FIRMWARE_VERSION', 'Firmware / hardware version', 'IDENTITY', 'Version on the label (FS / V…). Replacements may need the same or a compatible version.', 'V4.2', 20);
export const PLATFORM = text('CONTROL_PLATFORM', 'Product family', 'IDENTITY', 'PLC family, e.g. Siemens S7-1500, Allen-Bradley ControlLogix, Schneider M340.', 'Siemens S7-1500', 60);
export const SCREEN = dec('SCREEN_SIZE_IN', 'Screen size', 'inch', 'DIMENSION', 'Diagonal size.', '7');
export const BATTERY_CHEM = pick('BATTERY_CHEMISTRY', 'Battery chemistry', 'MATERIAL', 'Printed on the battery label. Never replace one chemistry with another without changing the charger settings.', ['Lead-acid VRLA / AGM', 'Lead-acid gel', 'Lead-acid flooded', 'Lithium-ion / LiFePO4', 'NiCd', 'NiMH', 'Alkaline / lithium primary']);
export const VOLT_DC = dec('NOMINAL_VOLTAGE_V', 'Nominal voltage', 'V', 'RATING', 'Voltage on the label.', '12');
export const CAPACITY_AH = dec('CAPACITY_AH', 'Capacity', 'Ah', 'RATING', 'Ampere-hours on the label.', '100');
export const TERMINAL = text('TERMINAL_TYPE', 'Terminal type', 'CONNECTION', 'Terminal / post style.', 'M6 insert', 20);
export const LAMP_TYPE = pick('LAMP_TYPE', 'Lamp technology', 'MATERIAL', 'Technology.', ['LED', 'Fluorescent tube (T8/T5)', 'Compact fluorescent', 'Metal halide', 'High-pressure sodium', 'Halogen', 'Induction']);
export const WATT = dec('POWER_W', 'Power', 'W', 'RATING', 'Wattage printed on the lamp or luminaire label.', '150');
export const LUMEN = int('LUMENS', 'Light output', 'lm', 'RATING', 'Lumens on the box.', '18000');
export const CCT = pick('COLOUR_TEMPERATURE', 'Colour temperature', 'RATING', 'Light colour.', ['2700 K warm', '3000 K', '4000 K neutral', '5000 K', '6500 K daylight']);
export const LAMP_BASE = pick('LAMP_BASE', 'Cap / base', 'CONNECTION', 'The fitting that goes into the holder (screw E27/E40, bayonet B22, pins G13 for tubes).', ['E27', 'E40', 'E14', 'B22', 'G13 (T8)', 'G5 (T5)', 'GU10', 'Integrated luminaire']);

// Assets
export const CONVEYOR_TYPE = pick('CONVEYOR_TYPE', 'Conveyor type', 'MATERIAL', 'How the conveyor moves material: belt on rollers, powered rollers, chains, a screw (auger) or buckets.', ['Belt (troughed)', 'Belt (flat)', 'Roller (gravity)', 'Roller (powered)', 'Chain / slat', 'Screw (auger)', 'Bucket elevator', 'Drag chain', 'Overhead', 'Pneumatic', 'Vibratory', 'Modular plastic belt']);
export const LENGTH_EQ = dec('EQUIPMENT_LENGTH_M', 'Length', 'm', 'DIMENSION', 'Overall length / centres.', '24');
export const WIDTH_EQ = dec('EQUIPMENT_WIDTH_MM', 'Width', 'mm', 'DIMENSION', 'Belt or working width.', '800');
export const CAPACITY_TPH = dec('CAPACITY_TPH', 'Capacity', 't/h', 'RATING', 'Design throughput.', '250');
export const SPEED_MS = dec('SPEED_M_S', 'Speed', 'm/s', 'RATING', 'Design speed.', '1.6');
export const INCLINE = dec('INCLINATION_DEG', 'Inclination', '°', 'DIMENSION', 'Slope angle.', '12', -90, 90);
export const MATERIAL_HANDLED = text('MATERIAL_HANDLED', 'Material handled', 'RATING', 'What is moved, with density/lump size if bulk.', 'Clinker, 0–50 mm', 80);
export const BOILER_TYPE = pick('BOILER_TYPE', 'Boiler type', 'MATERIAL', 'Fire-tube (hot gas in tubes inside a water shell) is most common in factories; water-tube for high pressure and large output.', ['Fire-tube (shell)', 'Water-tube', 'Electric', 'Thermal oil heater', 'Waste-heat recovery', 'Steam generator (coil)']);
export const STEAM = dec('STEAM_CAPACITY_KGH', 'Steam capacity', 'kg/h', 'RATING', 'Rated evaporation (F&A 100 °C or actual).', '5000');
export const DESIGN_P = dec('DESIGN_PRESSURE_BAR', 'Design pressure', 'bar', 'RATING', 'Maximum allowable working pressure on the nameplate.', '10.34');
export const DESIGN_T = dec('DESIGN_TEMPERATURE_C', 'Design temperature', '°C', 'RATING', 'Maximum design temperature.', '200', -273);
export const FUEL = pick('FUEL_TYPE', 'Fuel', 'RATING', 'Main fuel / energy source.', ['Diesel', 'Heavy fuel oil', 'Natural gas', 'LPG', 'Biomass / wood', 'Coal', 'Electricity', 'Dual fuel', 'Biogas', 'Petrol', 'Hybrid', 'Battery electric']);
export const BURNER = text('BURNER_MODEL', 'Burner make / model', 'IDENTITY', 'From the burner nameplate.', 'Riello RS 190', 60);
export const REG_NO = text('REGISTRATION_NUMBER', 'Statutory registration number', 'COMPLIANCE', 'Number given by the regulator (boiler, pressure vessel, lifting equipment, vehicle).', 'DOSHS/BLR/1234', 40);
export const NEXT_INSPECT = def('NEXT_STATUTORY_INSPECTION', { name: 'Next statutory inspection due', dataType: 'date', domain: 'COMPLIANCE', description: 'Date on the current inspection certificate. MEMS uses it to remind you before it expires.' });
export const PRIME_KVA = dec('PRIME_POWER_KVA', 'Prime power', 'kVA', 'RATING', 'Continuous (prime) rating on the generator plate.', '500');
export const STANDBY_KVA = dec('STANDBY_POWER_KVA', 'Standby power', 'kVA', 'RATING', 'Emergency (standby) rating.', '550');
export const ENGINE = text('ENGINE_MAKE_MODEL', 'Engine make / model', 'IDENTITY', 'From the engine plate.', 'Perkins 2506A-E15TAG2', 60);
export const ALTERNATOR = text('ALTERNATOR_MAKE_MODEL', 'Alternator make / model', 'IDENTITY', 'From the alternator plate.', 'Stamford HCI544D', 60);
export const TANK_L = dec('FUEL_TANK_L', 'Fuel tank capacity', 'L', 'DIMENSION', 'Base or day tank.', '800');
export const ENCLOSURE = pick('GENSET_ENCLOSURE', 'Enclosure', 'MATERIAL', 'How the generator is housed: open frame in a room, silent canopy outdoors, or inside a container.', ['Open skid', 'Sound-attenuated canopy', 'Containerised', 'Weatherproof']);
export const ATS = yes('ATS', 'Automatic transfer switch', 'RATING', 'Yes if it starts and changes over automatically on mains failure.');
export const CONTROLLER = text('CONTROLLER_MODEL', 'Controller', 'IDENTITY', 'Control panel model.', 'DSE 7320', 40);
export const HVAC_TYPE = pick('HVAC_TYPE', 'Equipment type', 'MATERIAL', 'Kind of cooling or air-handling equipment, from the nameplate or the HVAC drawings.', ['Air-cooled chiller', 'Water-cooled chiller', 'Split unit', 'Ducted split', 'VRF / VRV system', 'Air handling unit', 'Packaged rooftop unit', 'Cooling tower', 'Cold room', 'Heat pump']);
export const COOL_KW = dec('COOLING_CAPACITY_KW', 'Cooling capacity', 'kW', 'RATING', 'Nominal capacity (1 TR = 3.517 kW; 12 000 BTU/h ≈ 3.5 kW).', '350');
export const REFRIGERANT = pick('REFRIGERANT', 'Refrigerant', 'MATERIAL', 'Gas on the nameplate. Needed for leak repairs and regulatory phase-outs.', ['R134a', 'R410A', 'R32', 'R407C', 'R404A', 'R22 (phase-out)', 'R1234ze', 'R513A', 'R290 (propane)', 'R717 (ammonia)', 'R744 (CO2)']);
export const REFRIG_KG = dec('REFRIGERANT_CHARGE_KG', 'Refrigerant charge', 'kg', 'RATING', 'Factory charge on the nameplate.', '42');
export const MHE_TYPE = pick('MHE_TYPE', 'Truck type', 'MATERIAL', 'Counterbalance trucks have a heavy rear weight; reach trucks extend the mast forward; stackers are walk-behind.', ['Counterbalance forklift', 'Reach truck', 'Pallet stacker', 'Powered pallet truck', 'Hand pallet truck', 'Order picker', 'Telehandler', 'Side loader', 'Tow tractor']);
export const LOAD_KG = dec('RATED_CAPACITY_KG', 'Rated capacity', 'kg', 'RATING', 'Safe working load on the capacity plate.', '2500');
export const LIFT_MM = dec('LIFT_HEIGHT_MM', 'Lift height', 'mm', 'DIMENSION', 'Maximum fork height.', '4500');
export const MAST = pick('MAST_TYPE', 'Mast', 'MATERIAL', 'Mast stages.', ['Simplex', 'Duplex', 'Duplex free-lift', 'Triplex', 'Quad']);
export const TYRES = pick('TYRE_TYPE', 'Tyres', 'MATERIAL', 'Tyre type.', ['Pneumatic', 'Solid pneumatic', 'Cushion / press-on', 'Polyurethane', 'Non-marking']);
export const VEHICLE_TYPE = pick('VEHICLE_TYPE', 'Vehicle type', 'MATERIAL', 'Body type as shown on the logbook (registration certificate).', ['Saloon car', 'Pick-up', 'SUV', 'Van', 'Minibus', 'Bus', 'Truck (rigid)', 'Prime mover', 'Trailer', 'Tanker', 'Tipper', 'Motorcycle', 'Tractor']);
export const REG_PLATE = text('VEHICLE_REGISTRATION', 'Registration plate', 'IDENTITY', 'Number plate.', 'KDA 123A', 15);
export const VIN = text('VIN', 'Chassis / VIN', 'IDENTITY', '17-character vehicle identification number on the logbook.', 'JTFSS22P900123456', 20);
export const ENGINE_NO = text('ENGINE_NUMBER', 'Engine number', 'IDENTITY', 'From the logbook or engine block.', '1KD-1234567', 30);
export const PAYLOAD = dec('PAYLOAD_KG', 'Payload / seating', 'kg', 'RATING', 'Payload in kg (or seats for passenger vehicles).', '3500');
export const MACHINE_TYPE = pick('MACHINE_TOOL_TYPE', 'Machine type', 'MATERIAL', 'Kind of machine tool, as on its nameplate or manual.', ['Lathe (manual)', 'CNC lathe / turning centre', 'Milling machine (manual)', 'CNC machining centre', 'Drill press', 'Surface grinder', 'Cylindrical grinder', 'Press brake', 'Shear', 'Bandsaw', 'EDM', 'Laser cutter', 'Plasma cutter', 'Welding machine', 'Injection moulding', 'Hydraulic press']);
export const CNC = pick('CNC_CONTROL', 'Control system', 'IDENTITY', 'CNC make (needed for programs and spare boards).', ['Manual (no CNC)', 'Fanuc', 'Siemens Sinumerik', 'Heidenhain', 'Mitsubishi', 'Haas', 'Mazak Mazatrol', 'Okuma OSP', 'Fagor', 'GSK', 'Other']);
export const AXES = int('AXES', 'Number of axes', '', 'RATING', 'Controlled axes.', '3', 0, 12);
export const TRAVEL = text('TRAVEL_XYZ', 'Travel X / Y / Z', 'DIMENSION', 'Axis travels in mm.', '1020 / 510 / 635 mm', 40);
export const SPINDLE_KW = dec('SPINDLE_POWER_KW', 'Spindle power', 'kW', 'RATING', 'Main spindle motor power.', '22');
export const SPINDLE_RPM = int('SPINDLE_SPEED_MAX', 'Maximum spindle speed', 'rpm', 'RATING', 'Top speed.', '12000');
export const CRANE_TYPE = pick('CRANE_TYPE', 'Crane / hoist type', 'MATERIAL', 'Overhead (EOT) cranes run on rails across a building; jibs swing on a pillar or wall; hoists hang from a beam.', ['Overhead EOT single girder', 'Overhead EOT double girder', 'Gantry', 'Semi-gantry', 'Jib (pillar)', 'Jib (wall)', 'Monorail hoist', 'Electric chain hoist', 'Wire rope hoist', 'Manual chain block', 'Lever hoist', 'Mobile crane', 'Truck-mounted crane', 'Man lift / MEWP']);
export const SWL = dec('SWL_TONNES', 'Safe working load (SWL)', 't', 'RATING', 'Marked on the crane/hoist (SWL/WLL).', '10');
export const SPAN = dec('SPAN_M', 'Span', 'm', 'DIMENSION', 'Rail centres.', '18');
export const LIFT_M = dec('HEIGHT_OF_LIFT_M', 'Height of lift', 'm', 'DIMENSION', 'Hook travel.', '9');
export const VESSEL_TYPE = pick('VESSEL_TYPE', 'Vessel type', 'MATERIAL', 'Anything holding pressure (air receivers, autoclaves) is a statutory pressure vessel and needs periodic inspection.', ['Air receiver', 'Pressure vessel', 'Atmospheric storage tank', 'Silo', 'Reactor', 'Heat exchanger (shell & tube)', 'Plate heat exchanger', 'Autoclave', 'LPG tank']);
export const VOLUME_M3 = dec('VOLUME_M3', 'Capacity', 'm³', 'DIMENSION', 'Volume (1 m³ = 1000 L).', '2');
export const DESIGN_CODE = pick('DESIGN_CODE', 'Design code', 'COMPLIANCE', 'Code on the nameplate / data book.', ['ASME VIII Div 1', 'EN 13445', 'PD 5500', 'API 650', 'API 620', 'AD 2000', 'TEMA', 'Other']);
export const HX_AREA = dec('HEAT_TRANSFER_AREA_M2', 'Heat transfer area', 'm²', 'DIMENSION', 'Surface area.', '45');
export const CAPACITY_GENERIC = text('RATED_CAPACITY', 'Rated capacity / size', 'RATING', 'Main capacity of the equipment, with unit.', '1200 bottles/hour', 60);

// Services
export const PROVIDER = pick('PROVIDER_TYPE', 'Provider type required', 'SERVICE', 'Who may do the work. Use OEM or OEM-authorised while equipment is under warranty or for safety-critical/proprietary systems; independent specialists for most repairs; general contractors for routine work.', PROVIDER_TYPE);
export const EQUIP = text('EQUIPMENT_SERVICED', 'Equipment (make / model)', 'SERVICE', 'What the work is on. Give make, model and asset tag if known.', 'Atlas Copco GA75 compressor, AST-000123', 160);
export const SCOPE = many('WORK_SCOPE', 'Scope of work', 'SERVICE', 'Tick everything that is included.', ['Inspection and report', 'Diagnosis / fault finding', 'Repair', 'Full overhaul', 'Refurbishment', 'Replacement / installation', 'Commissioning', 'Testing', 'Modification / upgrade']);
export const LOCATION = pick('WORK_LOCATION', 'Where the work is done', 'SERVICE', 'On our site, or at the provider’s workshop.', ['On our site', 'Provider workshop', 'Either']);
export const PARTS = pick('PARTS_SUPPLY', 'Who supplies spare parts', 'SERVICE', 'Avoid disputes later: decide who buys the parts.', ['Provider supplies (included)', 'Provider supplies (charged separately)', 'We supply from stores', 'Agree per job']);
export const DELIVERABLES = many('DELIVERABLES', 'Required deliverables', 'SERVICE', 'Documents you must receive before the job is accepted and paid.', ['Service / job report', 'Test certificate', 'Calibration certificate', 'Before/after photos', 'Failure analysis (root cause)', 'As-left measurements', 'Updated drawings', 'Warranty certificate', 'Waste disposal certificate', 'Statutory inspection certificate']);
export const SAFETY_REQ = many('SAFETY_REQUIREMENTS', 'Site safety requirements', 'SERVICE', 'Permits and controls the provider must follow on site.', ['Permit to work', 'Lock-out / tag-out (LOTO)', 'Hot work permit', 'Confined space entry', 'Work at height', 'Electrical isolation certificate', 'Excavation permit', 'Lifting plan', 'Site induction', 'Own PPE']);
export const WARRANTY = int('WARRANTY_MONTHS', 'Workmanship warranty', 'months', 'SERVICE', 'Minimum warranty on the work.', '6', 0, 120);
export const TURNAROUND = int('TURNAROUND_DAYS', 'Maximum turnaround', 'days', 'SERVICE', 'Days from collection/start to completion.', '10', 0, 365);
export const RESPONSE = pick('RESPONSE_TIME', 'Response time on breakdown', 'SERVICE', 'How fast the provider must be on site after a call.', ['2 hours', '4 hours', '8 hours', 'Next working day', '48 hours', 'Not applicable']);
export const FREQ_SERVICE = pick('SERVICE_FREQUENCY', 'Frequency', 'SERVICE', 'How often the service is performed.', ['One-off', 'Weekly', 'Monthly', 'Quarterly', 'Six-monthly', 'Annually', 'On call']);
export const COVERAGE = pick('CONTRACT_COVERAGE', 'Contract coverage', 'SERVICE', 'What the price covers.', ['Labour only', 'Labour + consumables', 'Comprehensive (labour + parts)', 'Inspection only']);
export const DURATION = int('CONTRACT_MONTHS', 'Contract duration', 'months', 'SERVICE', 'Length of the agreement.', '12', 1, 120);
export const LICENCE = text('LICENCE_REQUIRED', 'Licence / registration required', 'COMPLIANCE', 'Regulator licence the provider must hold (e.g. EPRA electrical class A1, NCA category, NEMA waste licence, DOSHS approved person).', 'EPRA Class A1', 80);
export const ACCREDITATION = yes('ACCREDITED_LAB', 'ISO/IEC 17025 accredited', 'COMPLIANCE', 'Yes if the certificate must come from an accredited laboratory (needed for audits, ISO 9001, legal metrology).');
export const CAL_POINTS = int('CALIBRATION_POINTS', 'Calibration points', '', 'SERVICE', 'Number of test points across the range.', '5', 1, 50);
export const INSTRUMENT = text('INSTRUMENT_TYPE', 'Instrument / equipment', 'SERVICE', 'What is calibrated, with range and accuracy needed.', 'Pressure gauge 0–16 bar, class 1.0', 160);
export const NDT = many('INSPECTION_METHODS', 'Inspection methods', 'SERVICE', 'Methods required.', ['Visual (VT)', 'Ultrasonic (UT)', 'Thickness gauging', 'Magnetic particle (MT)', 'Dye penetrant (PT)', 'Radiography (RT)', 'Eddy current (ET)', 'Thermography', 'Vibration analysis', 'Oil analysis', 'Load test', 'Hydrostatic test']);
export const PERSONNEL = text('PERSONNEL_QUALIFICATION', 'Personnel qualification', 'COMPLIANCE', 'Certification the technicians must hold (e.g. ISO 9712 / PCN Level 2, CSWIP, OEM certification).', 'ISO 9712 Level 2 UT', 80);
export const REWIND_TESTS = many('REWIND_TESTS', 'Required tests', 'SERVICE', 'Tests the repairer must perform and report.', ['Insulation resistance (Megger)', 'Polarisation index', 'Winding resistance', 'Surge comparison', 'High-potential (hipot)', 'No-load run', 'Vibration', 'Core loss test']);
export const VARNISH = pick('VARNISH_METHOD', 'Impregnation', 'SERVICE', 'VPI (vacuum pressure) is better for large or high-voltage motors.', ['Dip and bake', 'Trickle', 'Vacuum pressure impregnation (VPI)']);
export const BEARINGS_INC = yes('BEARINGS_INCLUDED', 'Replace bearings', 'SERVICE', 'Yes to replace both bearings during the repair (recommended).');
export const PROCESS_MACHINING = many('MACHINING_PROCESSES', 'Processes', 'SERVICE', 'Operations needed.', ['Turning', 'Milling', 'Grinding', 'Drilling / boring', 'Welding repair', 'Fabrication', 'Metal spraying / build-up', 'Dynamic balancing', 'Heat treatment', 'Coating / plating', 'Laser cladding']);
export const DRAWING = text('DRAWING_REFERENCE', 'Drawing number / revision', 'SERVICE', 'Drawing or sample reference the work must match.', 'DRG-0045 rev C', 60);
export const TOLERANCE = text('TOLERANCE', 'Critical tolerances', 'SERVICE', 'Key fits or tolerances.', 'Bearing seat Ø60 k6', 60);
export const QTY = int('QUANTITY', 'Quantity', 'pcs', 'SERVICE', 'Number of pieces / units.', '2', 1);
export const CLEAN_METHOD = many('CLEANING_METHOD', 'Cleaning method', 'SERVICE', 'Methods allowed.', ['High-pressure water jetting', 'Dry ice blasting', 'Chemical cleaning', 'Vacuum / suction', 'Steam cleaning', 'Manual', 'Abrasive blasting']);
export const WASTE_TYPE = many('WASTE_TYPE', 'Waste type', 'SERVICE', 'What is collected.', ['Non-hazardous general', 'Hazardous', 'Used oil', 'Oily rags / filters', 'Scrap metal', 'E-waste', 'Chemicals', 'Medical / clinical', 'Construction debris', 'Sludge']);
export const DISPOSAL_CERT = yes('DISPOSAL_CERTIFICATE', 'Disposal certificate required', 'COMPLIANCE', 'Yes for hazardous waste — the regulator expects proof of lawful disposal.');
export const TRANSPORT_MODE = pick('TRANSPORT_MODE', 'Mode', 'SERVICE', 'How it moves.', ['Road', 'Sea', 'Air', 'Rail', 'Courier', 'Multimodal']);
export const VEHICLE_REQ = text('VEHICLE_REQUIREMENT', 'Vehicle / equipment needed', 'SERVICE', 'E.g. 10 t flatbed with crane, 40 ft container, refrigerated truck.', '10 t flatbed with HIAB', 80);
export const ROUTE = text('ROUTE', 'Route (from → to)', 'SERVICE', 'Origin and destination.', 'Mombasa port → Nairobi plant', 120);
export const DG = yes('DANGEROUS_GOODS', 'Dangerous goods', 'COMPLIANCE', 'Yes if the load is classed dangerous (needs ADR/IMDG/IATA compliance and trained driver).');
export const TRAINING_TOPIC = text('TRAINING_TOPIC', 'Training topic', 'SERVICE', 'Subject of the training.', 'Forklift operator certification', 120);
export const PARTICIPANTS = int('PARTICIPANTS', 'Participants', 'people', 'SERVICE', 'Number of trainees.', '12', 1);
export const DAYS = dec('DURATION_DAYS', 'Duration', 'days', 'SERVICE', 'Length of the course.', '3');
export const CERT_ISSUED = yes('CERTIFICATE_ISSUED', 'Certificate issued', 'COMPLIANCE', 'Yes if each trainee must receive a certificate.');
export const DELIVERY = pick('TRAINING_DELIVERY', 'Delivery', 'SERVICE', 'Where training happens.', ['On our site', 'Provider premises', 'Online', 'Blended']);
export const DISCIPLINE = many('ENGINEERING_DISCIPLINE', 'Discipline', 'SERVICE', 'Engineering discipline(s).', ['Mechanical', 'Electrical', 'Civil / structural', 'Process / chemical', 'Instrumentation & control', 'Fire & safety', 'Environmental', 'Energy audit']);
export const PROF_REG = text('PROFESSIONAL_REGISTRATION', 'Professional registration', 'COMPLIANCE', 'Registration the engineer must hold (e.g. EBK registered engineer, ECSA Pr Eng).', 'EBK Professional Engineer', 60);
export const VOLTAGE_LEVEL = pick('VOLTAGE_LEVEL', 'Voltage level', 'SERVICE', 'Highest voltage involved.', ['Extra-low voltage (<50 V)', 'Low voltage (up to 1 kV)', 'Medium voltage (1–36 kV)', 'High voltage (>36 kV)']);
export const LIFT_EQ = many('LIFTING_EQUIPMENT', 'Equipment to inspect', 'SERVICE', 'Lifting equipment covered.', ['Overhead cranes', 'Mobile cranes', 'Hoists / chain blocks', 'Forklifts', 'Slings / shackles / chains', 'Man lifts / MEWP', 'Lifts / elevators', 'Jacks']);
export const LOAD_TEST = yes('LOAD_TEST_REQUIRED', 'Load test required', 'SERVICE', 'Yes if a proof load test is part of the inspection.');

alias(MANUFACTURER, ['manufacturer', 'brand', 'make', 'maker', 'producer', 'oem', 'oem name', 'manufacturer name']);
alias(MPN, ['part number', 'part no', 'manufacturer part number', 'mpn', 'catalogue number', 'catalog number', 'order number', 'order code', 'article number', 'oem part number']);
alias(MODEL, ['model', 'type', 'model number', 'type designation', 'model type']);
alias(SERIAL, ['serial', 'serial number', 'serial no', 's n']);
alias(YEAR, ['year', 'year built', 'manufacture year', 'year of manufacture']);
alias(POWER_KW, ['power', 'power kw', 'motor power', 'output power', 'kw', 'rated output']);
alias(VOLTAGE, ['voltage', 'supply voltage', 'operating voltage', 'voltage v']);
alias(FREQUENCY, ['frequency', 'hz', 'rated frequency']);
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
alias(VALVE_SIZE, ['nominal size', 'dn', 'nominal diameter', 'nominal pipe diameter']);
alias(PRESSURE_RATING, ['pressure class', 'pressure rating', 'pn rating']);
alias(BODY, ['body material']);
alias(SEAL_MAT, ['seal material', 'elastomer', 'seat material']);
alias(STANDARD, ['standard', 'specification']);
alias(ORIGIN, ['country of origin', 'origin']);
alias(CLEARANCE, ['bearing internal clearance']);
alias(SEALING, ['seal configuration']);
alias(CAGE, ['cage material']);
alias(PRECISION, ['precision class']);
alias(DYN_LOAD, ['dynamic load rating']);
alias(THREAD_D, ['nominal thread diameter']);
alias(PROPERTY_CLASS, ['property class']);
alias(FINISH, ['surface finish']);
alias(THREAD, ['thread standard', 'thread pitch']);
alias(MOUNTING_IM, ['mounting arrangement']);
alias(INSULATION, ['insulation class']);
alias(PHASES, ['number of phases']);
alias(SPEED_RPM, ['rated speed']);
alias(PRESSURE_RATING, ['pressure class']);
alias(END_CONN, ['end connection']);
alias(OPERATOR, ['actuation type']);
alias(MICRON, ['filtration rating']);
alias(MEDIA, ['filtration media']);
alias(SENSOR_PRINCIPLE, ['sensing principle']);
alias(ANALOG_OUT, ['output signal']);
alias(CONNECTION_EL, ['electrical connection']);
alias(HOUSING, ['threaded housing size']);
alias(SENSE_RANGE, ['nominal sensing distance', 'detection distance']);
alias(LIGHT, ['light source']);
alias(ENC_TYPE, ['encoder technology']);
alias(ENC_OUT, ['encoder output']);
alias(RESOLUTION, ['pulses per revolution', 'resolution bits']);
alias(ENC_SHAFT, ['shaft configuration']);
alias(SHAFT_D, ['shaft diameter']);
alias(TEMP_ELEMENT, ['rtd element']);
alias(WIRES, ['wiring configuration']);
alias(SHEATH_D, ['probe diameter']);
alias(INSERTION, ['insertion length']);
alias(PROCESS_CONN, ['process connection', 'process connection type']);
alias(PRESSURE_TYPE, ['pressure reference']);
alias(WETTED, ['wetted material']);
alias(ACCURACY, ['accuracy percent span', 'flow accuracy']);
alias(LINE_SIZE, ['nominal pipe diameter']);
alias(MEDIUM, ['process fluid']);
alias(CURRENT_A, ['rated current']);
alias(WELD_PROCESS, ['welding process']);
alias(WIRE_DIA, ['wire or rod diameter']);
alias(WELD_CLASS, ['filler classification']);
alias(NLGI, ['nlgi consistency grade']);
alias(THICKENER, ['thickener type']);
alias(BASE_OIL, ['base oil', 'lubricant base type']);
alias(ISO_VG, ['viscosity grade']);
alias(LUBE_SPEC, ['oem approvals']);
alias(PPE_STD, ['applicable safety standard']);
alias(PLATFORM, ['controller family']);
alias(PLC_MODULE, ['module type']);
alias(CHANNELS, ['channel count']);
alias(COMMS, ['supported protocols']);
alias(FIRMWARE, ['firmware compatibility', 'firmware version']);
alias(SUPPLY_DC, ['supply voltage']);
alias(PIPE_MAT, ['material']);

