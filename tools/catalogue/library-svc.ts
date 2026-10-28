/**
 * Service-specific attributes: what a buyer who is not a specialist must state so that two offers for the same
 * service can be compared and the work can be accepted. Every attribute says where the value comes from and has an
 * example; fixed answers are pick-lists.
 */
import { text, dec, int, pick, many, yes, alias } from './library';
import * as L from './library';

// --- equipment work -------------------------------------------------------------------------------------------
export const RUNNING_HOURS = int('RUNNING_HOURS', 'Running hours at service', 'h', 'SERVICE', 'Hour-meter reading on the machine controller or the last service report. It decides which service level (A/B/C/D) is due.', '24000');
export const SERVICE_LEVEL = pick('SERVICE_LEVEL', 'Service level / interval', 'SERVICE', 'The maker’s service schedule names the interval. Copy it from the service manual or the last job card.', ['Routine (A / 2,000 h)', 'Intermediate (B / 4,000 h)', 'Major (C / 8,000 h)', 'Overhaul (D / 24,000–40,000 h)', 'Annual', 'As per OEM schedule']);
export const GENUINE_PARTS = yes('GENUINE_PARTS_REQUIRED', 'Genuine OEM parts only', 'SERVICE', 'Yes while the machine is under warranty or for safety-critical parts; say No to allow quality equivalents (cheaper).');
export const PUMP_TESTS = many('PUMP_REPAIR_TESTS', 'Tests after repair', 'SERVICE', 'Tests the repairer must do and report before the pump is returned.', ['Hydrostatic casing test', 'Performance test (flow / head)', 'Run test with vibration reading', 'Mechanical seal leak test', 'Impeller dynamic balancing', 'Dimensional report of wear rings and shaft']);
export const SEAL_ARRANGEMENT = pick('PUMP_SEAL_ARRANGEMENT', 'Shaft sealing', 'SERVICE', 'Look at the pump: gland packing (rope) or a mechanical seal. The seal type is on the pump datasheet.', ['Gland packing', 'Single mechanical seal', 'Double / tandem mechanical seal', 'Cartridge seal', 'Magnetic drive (sealless)']);
export const MOTOR_RATING = text('MOTOR_RATING_SERVICE', 'Motor rating (kW / V / rpm / frame)', 'SERVICE', 'Copy from the motor nameplate so the repairer quotes the right winding and bearings.', '75 kW / 400 V / 1480 rpm / IEC 280M', 80);
export const GEARBOX_DATA = text('GEARBOX_DATA_SERVICE', 'Gearbox make / model / ratio', 'SERVICE', 'From the gearbox nameplate. The ratio is written as i = 25.3 or 25.3:1.', 'Flender H2SH 7, i = 25.3', 100);
export const ALIGN_METHOD = pick('ALIGNMENT_METHOD', 'Alignment method', 'SERVICE', 'Laser alignment is faster and gives a printed report; ask for it on critical machines.', ['Laser alignment with report', 'Dial indicator (reverse rim)', 'Straight edge (non-critical only)']);
export const ALIGN_TOL = text('ALIGNMENT_TOLERANCE', 'Alignment tolerance', 'SERVICE', 'Acceptable offset and angle. If unsure use the coupling maker’s value or ANSI/ASA S2.75 for the speed.', 'Offset ≤ 0.05 mm, angle ≤ 0.05 mm/100 mm at 1500 rpm', 80);
export const SPLICE_METHOD = pick('BELT_SPLICE_METHOD', 'Splice method', 'SERVICE', 'Hot vulcanised splices are strongest; cold bonded or mechanical fasteners are quick repairs.', ['Hot vulcanised', 'Cold bonded', 'Mechanical fasteners', 'Finger splice (PVC / PU)']);
export const BELT_SPEC = text('BELT_SPEC_SERVICE', 'Belt specification', 'SERVICE', 'Printed on the belt edge or the conveyor drawing: width, type, plies and covers.', '1200 mm EP630/4 6+2 mm', 80);
export const TRANSFORMER_DATA = text('TRANSFORMER_DATA_SERVICE', 'Transformer rating (kVA / voltage / oil volume)', 'SERVICE', 'From the transformer nameplate.', '1000 kVA, 11/0.415 kV, 680 L oil', 100);
export const TX_TESTS = many('TRANSFORMER_TESTS', 'Tests required', 'SERVICE', 'Choose the tests to be done and reported.', ['Oil breakdown voltage (BDV)', 'Dissolved gas analysis (DGA)', 'Moisture / acidity', 'Insulation resistance and PI', 'Winding resistance', 'Turns ratio (TTR)', 'Tan delta', 'Sweep frequency (SFRA)', 'Thermography']);
export const CIRCUIT_COUNT = int('CIRCUITS_OR_POINTS', 'Number of circuits / test points', '', 'SERVICE', 'Count from the single-line diagram or the board schedule — used to compare quotes.', '48', 1);
export const TEST_INSTRUMENTS = yes('CALIBRATED_TEST_INSTRUMENTS', 'Calibrated test instruments', 'SERVICE', 'Yes to require valid calibration certificates for every test instrument used (attach to the report).');
export const CAL_LOCATION = pick('CALIBRATION_LOCATION', 'Calibration location', 'SERVICE', 'On-site avoids removing the instrument; laboratory calibration is usually more accurate.', ['On site', 'Provider laboratory', 'Either']);
export const CONTROL_PLATFORM = text('CONTROL_SYSTEM_VERSION', 'Control system / software version', 'SERVICE', 'Make, family and software version of the PLC, SCADA or drive — on the controller label or in the engineering software.', 'Siemens S7-1500, TIA Portal V18', 100);
export const AUTOMATION_DELIVERABLES = many('AUTOMATION_DELIVERABLES', 'Automation deliverables', 'SERVICE', 'Files you must receive so another integrator can support the system later.', ['Program backup (source, unlocked)', 'Commented program printout', 'I/O list', 'Updated electrical drawings', 'Functional description', 'FAT / SAT test record', 'User manual / training']);
export const SIL_LEVEL = pick('SIL_LEVEL', 'Safety integrity level', 'SERVICE', 'From the safety requirements specification (SRS) or the SIL study.', ['SIL 1', 'SIL 2', 'SIL 3', 'Not a safety function']);
export const MEASUREMENT_POINTS = int('MEASUREMENT_POINTS', 'Machines / measurement points', '', 'SERVICE', 'Number of machines or points in the route — count from the equipment list.', '40', 1);
export const ANALYST_CERT = pick('ANALYST_CERTIFICATION', 'Analyst certification', 'COMPLIANCE', 'ISO 18436 category of the person analysing the data; Cat II is normal for routine programmes.', ['ISO 18436 Category I', 'ISO 18436 Category II', 'ISO 18436 Category III', 'ISO 18436 Category IV', 'Not required']);
export const SHUTDOWN_WINDOW = text('SHUTDOWN_WINDOW', 'Shutdown window', 'SERVICE', 'Dates and hours the plant is stopped for the work.', '12–19 Dec, 24 h working', 80);
export const PEAK_MANPOWER = int('PEAK_MANPOWER', 'Peak manpower', 'people', 'SERVICE', 'Maximum number of contractor staff on site at one time (for induction, PPE and welfare planning).', '60', 1);
export const SITE_AREA = dec('WORK_AREA_M2', 'Area to be worked', 'm²', 'SERVICE', 'Measure on site or take from the drawing.', '450');
export const MATERIAL_SPEC = text('MATERIAL_SPECIFICATION', 'Material / product specification', 'SERVICE', 'Products the work must use, with brand or standard (so offers are equal).', 'Crown Paints Silk Vinyl, 2 coats on 1 primer', 160);
export const STATUTORY_INSPECTION = yes('STATUTORY_INSPECTION', 'Statutory inspection / certificate', 'COMPLIANCE', 'Yes if the law requires a certificate after the work (lifts, pressure vessels, fire systems, electrical installations).');

// --- engineering & construction -------------------------------------------------------------------------------
export const CAD_FORMAT = many('CAD_FORMAT', 'Drawing / model format', 'SERVICE', 'File formats you must receive so you can edit the drawings later.', ['AutoCAD DWG', 'PDF', 'Revit RVT', 'IFC', 'SolidWorks', 'STEP', 'Excel calculations', 'Native software files']);
export const DRAWING_COUNT = int('DRAWING_COUNT', 'Number of drawings / documents', '', 'SERVICE', 'Estimated count from the document list — helps compare quotes.', '25', 1);
export const STUDY_METHOD = pick('STUDY_METHOD', 'Study method', 'SERVICE', 'Method required by your standard or insurer.', ['HAZOP (IEC 61882)', 'HAZID', 'LOPA', 'SIL determination', 'Bow-tie', 'FMEA / FMECA', 'RCA (5-Why / fishbone)', 'RCM (SAE JA1011)', 'Area classification (IEC 60079-10)', 'Other']);
export const STUDY_NODES = int('STUDY_NODES', 'Study size (nodes / systems / assets)', '', 'SERVICE', 'Number of P&ID nodes, systems or assets covered — the main cost driver.', '12', 1);
export const INSPECTOR_CERT = text('INSPECTOR_CERTIFICATION', 'Inspector certification', 'COMPLIANCE', 'Qualification of the inspector (e.g. CSWIP 3.1, API 510/570/653, AWS CWI, approved person under DOSHS).', 'CSWIP 3.1 Welding Inspector', 80);
export const WITNESS_POINTS = text('WITNESS_HOLD_POINTS', 'Witness / hold points', 'SERVICE', 'Steps you or your client must witness before the work continues (from the inspection and test plan).', 'Hydrotest, final run test', 120);
export const CONTRACTOR_CLASS = text('CONTRACTOR_REGISTRATION', 'Contractor registration / category', 'COMPLIANCE', 'Category the contractor must be registered in (e.g. NCA 1–8, EPRA A1, NEMA licence). Copy from the tender requirement.', 'NCA 3 Building works', 60);
export const DESIGN_RESP = pick('DESIGN_RESPONSIBILITY', 'Design responsibility', 'SERVICE', 'Who designs: you give the design (build only), or the contractor designs and builds.', ['Build to our design', 'Design and build', 'Contractor detail design to our concept']);
export const EQUIPMENT_WEIGHT = dec('HEAVIEST_ITEM_T', 'Heaviest item', 't', 'SERVICE', 'Weight of the heaviest piece to lift or install, from the datasheet or delivery note.', '12.5');
export const LIFT_RADIUS = dec('LIFT_RADIUS_M', 'Lift radius', 'm', 'SERVICE', 'Horizontal distance from crane position to load placement — measure on site.', '18');
export const LIFT_PLAN = yes('LIFTING_PLAN_REQUIRED', 'Lifting plan required', 'SERVICE', 'Yes for heavy, tandem or near-power-line lifts; the plan is approved before the lift.');
export const SCAFFOLD_HEIGHT = dec('SCAFFOLD_HEIGHT_M', 'Working height', 'm', 'SERVICE', 'Highest working platform needed.', '12');
export const SCAFFOLD_TYPE = pick('SCAFFOLD_TYPE', 'Scaffold type', 'SERVICE', 'System scaffold is faster; tube and fitting suits odd shapes.', ['System (Cuplock / Ringlock)', 'Tube and fitting', 'Mobile tower', 'Suspended / cradle', 'Cantilever']);
export const DEPTH_M = dec('WORK_DEPTH_M', 'Depth', 'm', 'SERVICE', 'Required depth of the pile, borehole, trench or tunnel.', '60');
export const DIAMETER_MM = int('WORK_DIAMETER_MM', 'Diameter', 'mm', 'SERVICE', 'Diameter of the pile, bore or pipe.', '600');
export const GEO_DATA = yes('GEOTECH_DATA_PROVIDED', 'Ground / geotechnical data provided', 'SERVICE', 'Yes if you give the contractor a soil report; No means they must allow for their own investigation.');

// --- IT, data, telecom ----------------------------------------------------------------------------------------
export const TECH_STACK = text('TECH_STACK', 'Technology / product', 'SERVICE', 'Languages, framework or product to use, or “supplier to propose”.', 'React + Node.js on Azure', 120);
export const USER_COUNT = int('USER_COUNT', 'Number of users', 'users', 'SERVICE', 'Named or concurrent users — the main licence and support cost driver.', '150', 1);
export const IP_OWNERSHIP = pick('SOURCE_CODE_OWNERSHIP', 'Source code / IP ownership', 'SERVICE', 'Ownership protects you if the supplier stops supporting the system.', ['We own source code and IP', 'Licence with source code escrow', 'Supplier owns, we get a licence']);
export const UAT = yes('USER_ACCEPTANCE_TEST', 'User acceptance test (UAT) required', 'SERVICE', 'Yes so payment is only released after your users test and sign off.');
export const PRODUCT_VERSION = text('PRODUCT_AND_VERSION', 'Product and version', 'SERVICE', 'System being implemented or supported, with edition and version.', 'SAP S/4HANA 2023, Finance + MM', 120);
export const CLOUD_PROVIDER = pick('CLOUD_PROVIDER', 'Cloud platform', 'SERVICE', 'Platform the workload runs on.', ['Microsoft Azure', 'Amazon Web Services', 'Google Cloud', 'Oracle Cloud', 'Local data centre', 'Supplier to propose']);
export const DATA_RESIDENCY = text('DATA_RESIDENCY', 'Data residency', 'COMPLIANCE', 'Country or region where data may be stored — the Data Protection Act may require in-country storage of personal data.', 'Kenya / South Africa region', 60);
export const UPTIME = dec('UPTIME_SLA_PCT', 'Availability (uptime) target', '%', 'SERVICE', 'Monthly availability promised in the SLA. 99.9 % ≈ 43 minutes downtime a month.', '99.9', 90, 100);
export const RPO_RTO = text('RPO_RTO', 'Recovery point / time objective', 'SERVICE', 'How much data you can lose (RPO) and how fast service must be back (RTO).', 'RPO 1 h / RTO 4 h', 40);
export const DEVICE_COUNT = int('DEVICE_COUNT', 'Devices / endpoints in scope', '', 'SERVICE', 'Servers, PCs, switches or other devices covered — count from the asset register.', '220', 1);
export const TEST_APPROACH = pick('SECURITY_TEST_APPROACH', 'Test approach', 'SERVICE', 'How much information the testers get: black box (none), grey box (user account), white box (full access).', ['Black box', 'Grey box', 'White box', 'Red team']);
export const SECURITY_TARGETS = text('SECURITY_TARGETS', 'Systems in scope', 'SERVICE', 'IP ranges, URLs, applications or sites to test.', '3 web apps, 1 /24 external range', 160);
export const TESTER_CERT = many('SECURITY_CERTIFICATIONS', 'Tester certifications', 'COMPLIANCE', 'Certifications at least one team member must hold.', ['OSCP', 'CREST', 'CEH', 'CISSP', 'CISA', 'ISO 27001 Lead Auditor', 'GIAC']);
export const BANDWIDTH = int('BANDWIDTH_MBPS', 'Bandwidth', 'Mbps', 'SERVICE', 'Committed speed. Say if it must be symmetric (same upload and download).', '100', 1);
export const CONTENTION = pick('CONTENTION', 'Contention / commitment', 'SERVICE', 'Dedicated (1:1) links keep full speed at all times; shared links are cheaper.', ['Dedicated 1:1 symmetric', 'Dedicated asymmetric', 'Shared / best effort']);
export const SITE_COUNT = int('SITE_COUNT', 'Number of sites', 'sites', 'SERVICE', 'Locations covered by the service.', '4', 1);
export const NCA_LICENCE = yes('NCA_LICENSED', 'Regulator-licensed provider (NCA / CA)', 'COMPLIANCE', 'Yes — telecom and broadcast services may only be provided by a licensed operator or contractor.');
export const FREQ_BAND = text('RADIO_BAND_TECHNOLOGY', 'Frequency band / technology', 'SERVICE', 'Band or technology, e.g. 5 GHz Wi-Fi 6, 3.5 GHz 5G, Ku-band VSAT.', 'Ku-band VSAT', 60);

// --- logistics ------------------------------------------------------------------------------------------------
export const INCOTERMS = pick('INCOTERMS', 'Incoterms® 2020', 'SERVICE', 'Who pays and carries risk to which point — must match the purchase order.', ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);
export const CONTAINER = pick('CONTAINER_TYPE_SERVICE', 'Container / unit', 'SERVICE', 'Equipment needed for the cargo.', ['20 ft dry', '40 ft dry', '40 ft high cube', '20 ft reefer', '40 ft reefer', 'Flat rack / open top', 'LCL (shared)', 'Air ULD', 'Break bulk', 'Tanker']);
export const HS_CODE = text('HS_CODE', 'HS tariff code', 'COMPLIANCE', 'Customs tariff code of the goods (8–10 digits), from the supplier invoice or a previous customs entry.', '8413.70.00', 14);
export const STORAGE_REGIME = pick('STORAGE_REGIME', 'Storage conditions', 'SERVICE', 'Conditions the goods need.', ['Ambient', 'Air-conditioned (15–25 °C)', 'Chilled (2–8 °C)', 'Frozen (−18 °C or colder)', 'Bonded', 'Hazardous goods store']);
export const PALLET_POSITIONS = int('PALLET_POSITIONS', 'Pallet positions / space', 'pallets', 'SERVICE', 'Average space needed (or m² if not palletised — note it).', '300', 1);
export const VEHICLE_TYPE = pick('VEHICLE_TYPE_SERVICE', 'Vehicle type', 'SERVICE', 'Vehicle needed for the load.', ['Motorbike / courier', 'Van (≤ 3.5 t)', '7–10 t truck', 'Flatbed / trailer 28–30 t', 'Refrigerated truck', 'Tanker', 'Lowbed (abnormal load)', 'Bus / shuttle']);
export const ADR = yes('ADR_REQUIRED', 'Dangerous goods (ADR) transport', 'COMPLIANCE', 'Yes if the load is dangerous goods — vehicle placards, trained driver and transport document needed.');

// --- professional services ------------------------------------------------------------------------------------
export const MATTER = text('MATTER_DESCRIPTION', 'Matter / assignment', 'SERVICE', 'Short description of the legal or advisory matter.', 'Review of supply agreement with ABC Ltd', 160);
export const JURISDICTION = text('JURISDICTION', 'Jurisdiction / governing law', 'SERVICE', 'Country (and court or regulator) whose law applies.', 'Kenya — High Court Commercial Division', 80);
export const FEE_BASIS = pick('PROFESSIONAL_FEE_BASIS', 'Fee basis', 'SERVICE', 'How the professional charges. Fixed fees are easiest to control.', ['Fixed fee', 'Hourly rates with cap', 'Retainer', 'Success fee', 'Statutory scale (e.g. Advocates Remuneration Order)']);
export const CONFLICT_CHECK = yes('CONFLICT_CHECK', 'Conflict-of-interest declaration', 'COMPLIANCE', 'Yes so the firm confirms it does not act for the other side.');
export const LANGUAGES = text('LANGUAGE_PAIR', 'Languages (from → to)', 'SERVICE', 'Source and target languages.', 'English → French', 60);
export const WORD_COUNT = int('WORD_COUNT', 'Volume (words / minutes)', '', 'SERVICE', 'Words for translation, minutes for transcription or hours for interpretation (note which).', '12000', 1);
export const CERTIFIED_TRANSLATION = yes('CERTIFIED_TRANSLATION', 'Certified / sworn translation', 'COMPLIANCE', 'Yes if courts, embassies or regulators will receive the document.');
export const FINANCIAL_PERIOD = text('FINANCIAL_PERIOD', 'Period covered', 'SERVICE', 'Financial year or months the work covers.', 'FY 2026 (Jan–Dec)', 40);
export const ENTITY_COUNT = int('ENTITY_COUNT', 'Entities / companies in scope', '', 'SERVICE', 'Number of legal entities, branches or ledgers.', '3', 1);
export const PRO_BODY = text('PROFESSIONAL_BODY', 'Professional body membership', 'COMPLIANCE', 'Body the lead professional must be registered with (ICPAK, LSK, IHRM, ISK, KMPDC, EBK…).', 'ICPAK practising certificate', 60);
export const POSITIONS = int('POSITIONS_TO_FILL', 'Positions to fill', 'positions', 'SERVICE', 'Number of hires.', '3', 1);
export const ROLE_LEVEL = pick('ROLE_LEVEL', 'Role level', 'SERVICE', 'Seniority of the roles.', ['Entry / graduate', 'Skilled / technician', 'Supervisor', 'Middle management', 'Senior management', 'Executive / board']);
export const GUARANTEE = int('REPLACEMENT_GUARANTEE_DAYS', 'Replacement guarantee', 'days', 'SERVICE', 'Free replacement period if the candidate leaves.', '90');
export const EMPLOYEES = int('EMPLOYEES_IN_SCOPE', 'Employees in scope', 'people', 'SERVICE', 'Headcount covered.', '450', 1);
export const TRAINING_ACCREDITATION = text('TRAINING_ACCREDITATION', 'Course accreditation', 'COMPLIANCE', 'Body that approves the course or certificate (NITA, DOSHS, NEMA, OEM academy, awarding body).', 'NITA-approved / DOSHS-approved', 60);

// --- health, lab, agriculture ---------------------------------------------------------------------------------
export const PRACTITIONER = text('PRACTITIONER_REGISTRATION', 'Practitioner / facility licence', 'COMPLIANCE', 'Licence the clinician or facility must hold (KMPDC, NCK, PPB, KMLTTB).', 'KMPDC registered facility', 60);
export const TEST_PARAMS = text('TEST_PARAMETERS', 'Tests / parameters', 'SERVICE', 'List the analyses needed.', 'TPC, coliforms, E. coli, Salmonella', 200);
export const TEST_METHOD = text('TEST_METHOD_STANDARD', 'Test method / standard', 'SERVICE', 'Method each result must follow, so results are comparable.', 'ISO 4833-1, ISO 6579-1', 120);
export const SAMPLE_MATRIX = text('SAMPLE_MATRIX', 'Sample type', 'SERVICE', 'What is sent: water, product, swab, soil, oil, air filter…', 'Finished juice 500 mL bottle', 80);
export const RESULT_DAYS = int('RESULTS_WITHIN_DAYS', 'Results within', 'days', 'SERVICE', 'Maximum days from sample receipt to report.', '5');
export const SPECIES_COUNT = int('ANIMAL_COUNT', 'Number of animals', 'head', 'SERVICE', 'Animals to be treated or covered.', '120', 1);
export const VET_REG = yes('VET_REGISTERED', 'Registered veterinarian (KVB)', 'COMPLIANCE', 'Yes — treatment and vaccination must be done or supervised by a registered veterinary surgeon.');

// --- utilities, environment, facilities -----------------------------------------------------------------------
export const SUPPLY_QTY = text('SUPPLY_QUANTITY_PERIOD', 'Quantity per period', 'SERVICE', 'Expected volume with unit and period (kWh/month, m³/day, t/month).', '120,000 kWh / month', 60);
export const QUALITY_SPEC = text('SUPPLY_QUALITY_SPEC', 'Quality specification', 'SERVICE', 'Standard the supplied product must meet (e.g. KS EAS 12 potable water, steam 10 bar saturated, fuel KS EAS 177).', 'KS EAS 12 potable water', 120);
export const PV_CAPACITY = dec('PV_CAPACITY_KWP', 'System size', 'kWp', 'SERVICE', 'Installed solar or storage capacity (kWp, or kWh for batteries — note it).', '250');
export const EPRA_LICENCE = pick('EPRA_LICENCE_CLASS', 'EPRA licence class', 'COMPLIANCE', 'Electrical / solar contractor licence the installer must hold for the job size.', ['Class A1 (any voltage)', 'Class A2', 'Class B', 'Class C', 'Solar T1', 'Solar T2', 'Solar T3', 'Not applicable']);
export const WASTE_QTY = text('WASTE_QUANTITY', 'Waste quantity', 'SERVICE', 'Expected quantity and unit per collection or per month.', '6 t / month in 2 skips', 60);
export const NEMA_LICENCE = yes('NEMA_LICENSED', 'Licensed waste handler (NEMA)', 'COMPLIANCE', 'Yes — waste may only be transported and treated by a NEMA-licensed operator; copy the licence to the file.');
export const STUDY_STANDARD = text('ENV_STUDY_STANDARD', 'Standard / regulation', 'COMPLIANCE', 'Regulation or standard the study must follow (EMCA EIA regulations, GHG Protocol, ISO 14064, ISO 14040).', 'EMCA (EIA/EA) Regulations 2003', 100);
export const LEAD_EXPERT = text('LEAD_EXPERT', 'Lead expert registration', 'COMPLIANCE', 'Registration of the lead expert (NEMA EIA lead expert, EBK, ISO auditor).', 'NEMA-registered EIA lead expert', 60);
export const CLEAN_FREQ = pick('CLEANING_FREQUENCY', 'Cleaning frequency', 'SERVICE', 'How often each area is cleaned.', ['Continuous (on-site team)', 'Daily', 'Twice weekly', 'Weekly', 'Monthly', 'One-off deep clean']);
export const PEST_TYPES = many('PEST_TYPES', 'Pests', 'SERVICE', 'Pests to control.', ['Rodents', 'Cockroaches', 'Flies', 'Mosquitoes', 'Termites', 'Stored-product insects', 'Birds', 'Bed bugs', 'Snakes']);
export const PCPB = yes('PCPB_REGISTERED', 'Registered products and operator (PCPB)', 'COMPLIANCE', 'Yes — only Pest Control Products Board registered products and licensed operators may be used.');
export const TANK_SIZE = text('VESSEL_TO_CLEAN', 'Vessel / system to clean', 'SERVICE', 'Tank, duct or line with size and what it contained.', 'Diesel tank 50 m³, 3 m dia', 120);
export const GUARD_TYPE = pick('GUARD_TYPE', 'Guard type', 'SERVICE', 'Armed guards need police or licensed armed services.', ['Unarmed guard', 'Armed guard (police / licensed)', 'Supervisor', 'Dog handler', 'Control-room operator']);
export const PSRA = yes('PSRA_LICENSED', 'Licensed security provider (PSRA)', 'COMPLIANCE', 'Yes — private security services must be licensed by the Private Security Regulatory Authority.');
export const DEVICE_POINTS = int('SECURITY_DEVICE_COUNT', 'Cameras / devices', '', 'SERVICE', 'Number of cameras, readers or alarm points.', '64', 1);
export const FOOD_HANDLER = yes('FOOD_HANDLER_CERTIFICATES', 'Food handler medical certificates', 'COMPLIANCE', 'Yes — every food handler must carry a valid medical certificate; the kitchen needs a health licence.');
export const ROOMS_NIGHTS = int('ROOM_NIGHTS', 'Room nights / guests', '', 'SERVICE', 'Rooms × nights, or number of guests for venue services.', '40', 1);
export const PROPERTY_REF = text('PROPERTY_REFERENCE', 'Property (title / address)', 'SERVICE', 'Title number, LR number or address of the property.', 'LR 209/12345, Industrial Area', 120);
export const VALUER = yes('REGISTERED_VALUER', 'Registered valuer / estate agent', 'COMPLIANCE', 'Yes — valuations and agency must be done by a person registered with the Valuers / Estate Agents Registration Board.');
export const KPI_REPORTING = text('KPI_REPORTING', 'Service KPIs', 'SERVICE', 'Measurable KPIs the provider reports each month.', 'Helpdesk response < 2 h; PPM compliance ≥ 95 %', 160);

// --- vehicles, aviation, marine, rental, production -----------------------------------------------------------
export const VEHICLE_ID = text('VEHICLE_IDENTIFICATION', 'Vehicle / vessel / aircraft', 'SERVICE', 'Make, model and registration (or tail / IMO number).', 'Toyota Hilux 2.4, KDA 123A, 85,000 km', 120);
export const MRO_APPROVAL = text('MAINTENANCE_APPROVAL', 'Maintenance approval', 'COMPLIANCE', 'Approval the organisation must hold (KCAA / EASA Part-145, class society, rail authority, dealer authorisation).', 'KCAA Part-145 AMO', 80);
export const RENTAL_SPEC = text('RENTAL_EQUIPMENT_SPEC', 'Equipment specification', 'SERVICE', 'Size and key rating of the equipment to hire.', '50 t mobile crane, 40 m boom', 120);
export const PROCESS_SPEC = text('PROCESS_SPECIFICATION', 'Process specification', 'SERVICE', 'Result the process must achieve, with tolerance (coating thickness, hardness, finish, standard).', 'Powder coat RAL 7035, 60–80 µm, ISO 2409 adhesion', 160);
export const PART_MATERIAL = text('PART_MATERIAL', 'Part material', 'SERVICE', 'Material of the parts being processed (grade).', 'S355 steel', 60);
export const PRODUCTION_VOLUME = text('VOLUME_PER_PERIOD', 'Volume per period', 'SERVICE', 'Expected volume (units, kg, copies, calls, pages) and the period.', '20,000 units / month', 60);
export const BENEFICIARIES = int('BENEFICIARIES', 'People served', 'people', 'SERVICE', 'Number of people or households served.', '500', 1);
export const SUM_INSURED = text('SUM_INSURED', 'Class and sum insured', 'SERVICE', 'Insurance class and the value to be covered.', 'Fire & perils, KES 850 m', 80);
export const IRA = yes('IRA_LICENSED', 'Licensed by insurance regulator (IRA)', 'COMPLIANCE', 'Yes — brokers, loss adjusters and insurers must be licensed by the Insurance Regulatory Authority.');
export const AREA_LOCATION = text('SERVICE_AREA', 'Area / location covered', 'SERVICE', 'Where the work happens: site, block, region or route.', 'Plant A and staff housing', 120);
export const OUTPUT_FORMAT = many('OUTPUT_FORMAT', 'Output format', 'SERVICE', 'Formats you must receive.', ['Report (PDF)', 'Raw data files', 'Map / GIS layers', 'Video (MP4)', 'Images', 'Presentation', 'Editable source files', 'Dashboard']);

// Existing catalogue names for the same thing (prevents a second field on the same service).
alias(L.EQUIP, ['equipment identification']);
alias(L.LICENCE, ['required license or accreditation']);
alias(L.FREQ_SERVICE, ['service frequency']);
alias(L.TRANSPORT_MODE, ['transport mode']);
alias(L.PARTICIPANTS, ['participant count']);
