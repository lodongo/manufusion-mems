/**
 * Additional catalogue attributes (beyond the MRO core in library.ts). Every attribute says where a person who
 * is not a specialist finds the value and gives an example; fixed value sets are pick-lists.
 */
import { text, dec, int, pick, many, yes, def, alias, aliasSet } from './library';

const OTHER: [string, string] = ['OTHER', 'Other — state in notes'];

// ---------------------------------------------------------------------------------------------------------------
// Identity & supply (shared)
// ---------------------------------------------------------------------------------------------------------------
export const OEM_MAKER = text('OEM_MACHINE_MAKER', 'Machine maker (OEM)', 'IDENTITY', 'The company that built the machine this part belongs to, as on the machine nameplate or the spare parts manual.', 'Krones, Sidel, Tetra Pak, KHS', 80);
export const OEM_MODEL = text('OEM_MACHINE_MODEL', 'Machine model / type', 'IDENTITY', 'Model or type of the machine the part fits, from the machine nameplate or parts manual cover.', 'Contiform S12', 80);
export const OEM_SERIAL = text('OEM_MACHINE_SERIAL', 'Machine serial number', 'IDENTITY', 'Serial number of the machine (nameplate). OEMs need it to supply the correct revision of a part.', 'SN 3456-019', 60);
export const OEM_PN = text('OEM_PART_NUMBER', 'OEM part number', 'IDENTITY', 'The machine maker’s own number for the part, from the spare parts manual, parts list or the old part/box. Copy it exactly.', '0-900-12-345-0', 80);
export const OEM_POSITION = text('POSITION_ON_MACHINE', 'Position / station on the machine', 'IDENTITY', 'Where the part is fitted (station, unit, drawing position number) so the stores person can match it to the parts manual.', 'Filler valve station, pos. 12', 120);
export const QTY_PER_MACHINE = int('QUANTITY_PER_MACHINE', 'Quantity fitted per machine', 'pcs', 'IDENTITY', 'How many of this part are installed on one machine. Helps plan stock for planned overhauls.', '24', 1);
export const FORMAT_SIZE = text('FORMAT_SIZE', 'Format / product size it is for', 'IDENTITY', 'Bottle, can, carton or product size the change part is made for (format parts only fit one size).', '500 ml PET, PCO 1881', 80);
export const DRAWING_NO = text('DRAWING_NUMBER', 'Drawing number and revision', 'IDENTITY', 'Engineering drawing the part is made to, with revision letter. Needed when the part is made locally.', 'DRG-1043 rev B', 60);
export const PRODUCT_CODE = text('PRODUCT_CODE', 'Product / SKU code', 'IDENTITY', 'Your internal product or SKU code for the item, as used in sales and production.', 'FG-COLA-500-24', 40);
export const BRAND = text('BRAND_NAME', 'Brand / product line', 'IDENTITY', 'Brand name printed on the pack or label.', 'Coca-Cola, Omo, Panadol', 60);
export const GTIN = text('GTIN_BARCODE', 'Barcode (GTIN / EAN)', 'IDENTITY', 'The 8, 12, 13 or 14 digit barcode number printed under the bars on the pack or case.', '5449000000996', 14);
export const VARIANT = text('VARIANT', 'Variant / flavour / colour', 'IDENTITY', 'Variant that tells this item apart from others of the same brand (flavour, fragrance, colour, model year).', 'Lemon, 2024 edition', 60);
export const COMPATIBLE_WITH = text('COMPATIBLE_WITH', 'Compatible with (make / model)', 'IDENTITY', 'Equipment, printer, dispenser or system this item is made for. Copy the model from the machine label.', 'HP LaserJet M507, Tork H1 dispenser', 160);
export const GENUINE = pick('GENUINE_OR_COMPATIBLE', 'Genuine or compatible', 'IDENTITY', 'Genuine = made or branded by the original maker. Compatible = third-party equivalent. Say which is acceptable.', [['GENUINE', 'Genuine (original maker) only'], ['COMPATIBLE_OK', 'Compatible equivalent accepted'], ['EITHER', 'Either']]);
export const WARRANTY_MONTHS_ITEM = int('PRODUCT_WARRANTY_MONTHS', 'Product warranty', 'months', 'IDENTITY', 'Warranty the supplier must give on the item.', '12', 0, 120);

// ---------------------------------------------------------------------------------------------------------------
// Packaging & storage (shared)
// ---------------------------------------------------------------------------------------------------------------
export const PACK_SIZE_TEXT = text('PACK_SIZE', 'Pack size (as sold)', 'PACK', 'Quantity in one sellable or issued pack, with unit, exactly as printed on the pack.', '25 kg bag, 500 ml bottle, box of 100', 40);
export const UNITS_PER_CASE = int('UNITS_PER_CASE', 'Units per case / carton', 'pcs', 'PACK', 'Number of packs in one outer case or carton, from the case label.', '24', 1);
export const CONTAINER_TYPE = pick('CONTAINER_TYPE', 'Container / packaging type', 'PACK', 'How the item is packed when delivered.', ['Bag / sack', 'Bulk (tanker / loose)', 'Bottle', 'Can / tin', 'Carton / box', 'Drum', 'IBC (1000 L)', 'Jerrycan', 'Pail / bucket', 'Pouch / sachet', 'Roll / reel', 'Tube / cartridge', 'Aerosol', 'Cylinder', 'Bale', 'Pallet load', 'Vacuum pack', 'Tray / crate', OTHER]);
export const SHELF_LIFE_DAYS = int('SHELF_LIFE_DAYS', 'Shelf life', 'days', 'PACK', 'Days from production to expiry, printed on the pack or the specification. MEMS uses it for expiry control (FEFO).', '365', 0, 7300);
export const STORAGE_TEMP = pick('STORAGE_TEMPERATURE', 'Storage temperature', 'PACK', 'Storage condition on the label. Cold-chain items must never leave the stated range.', ['Ambient (below 30 °C)', 'Cool (8–15 °C)', 'Chilled (2–8 °C)', 'Chilled (0–4 °C)', 'Frozen (−18 °C or colder)', 'Deep frozen (−70 °C or colder)', 'Dry, away from sunlight', 'Controlled room 15–25 °C']);
export const BATCH_TRACKED = yes('BATCH_TRACKED', 'Batch / lot tracked', 'PACK', 'Yes if every receipt must record the supplier batch or lot number (food, medicines, chemicals, safety-critical parts).');
export const EXPIRY_TRACKED = yes('EXPIRY_TRACKED', 'Expiry date tracked', 'PACK', 'Yes if each receipt must record the expiry date so the oldest stock is issued first.');
export const HAZMAT_STORE = yes('SEGREGATED_STORAGE', 'Needs segregated (dangerous goods) storage', 'PACK', 'Yes if the safety data sheet says it must be stored apart (flammables cage, acid store, oxidiser store).');

// ---------------------------------------------------------------------------------------------------------------
// Compliance (shared)
// ---------------------------------------------------------------------------------------------------------------
export const KEBS = text('STANDARD_MARK', 'Standard / quality mark', 'COMPLIANCE', 'National or international standard and mark the item must carry, e.g. KEBS Standardization Mark, KS EAS number, ISO, CE.', 'KEBS S-Mark, KS EAS 18-1', 80);
export const REG_NUMBER = text('REGULATORY_REGISTRATION', 'Regulator registration number', 'COMPLIANCE', 'Registration or approval number from the regulator printed on the pack or certificate (PPB, PCPB, KEPHIS, VMD, NEMA).', 'PCPB(CR)1234', 40);
export const FOOD_CONTACT = yes('FOOD_CONTACT_APPROVED', 'Approved for food contact', 'COMPLIANCE', 'Yes if the item touches food, drink or product and must have a food-contact declaration (EU 10/2011, FDA 21 CFR, EC 1935/2004).');
export const HALAL = yes('HALAL_CERTIFIED', 'Halal certified', 'COMPLIANCE', 'Yes if a halal certificate is required for this item.');
export const COA = yes('CERTIFICATE_OF_ANALYSIS', 'Certificate of analysis required', 'COMPLIANCE', 'Yes if each batch must arrive with a certificate of analysis (CoA) showing it meets the specification.');
export const MILL_CERT = pick('MILL_CERTIFICATE', 'Material certificate required', 'COMPLIANCE', 'Certificate the supplier must send with the material. 3.1 (EN 10204) is needed for pressure, lifting and structural uses.', [['NONE', 'Not required'], ['EN10204_21', 'EN 10204 2.1 / 2.2 (declaration)'], ['EN10204_31', 'EN 10204 3.1 (inspection certificate)'], ['EN10204_32', 'EN 10204 3.2 (third-party witnessed)']]);
export const SDS_REF = yes('SDS_ON_FILE', 'Safety data sheet (SDS) on file', 'COMPLIANCE', 'A current SDS (16 sections, less than 5 years old) must be on file before chemicals are received or used.');
export const ISPM15 = yes('ISPM15', 'Heat treated to ISPM 15', 'COMPLIANCE', 'Yes for wooden packaging that is exported — it must carry the IPPC wheat-ear stamp (HT).');
export const CERT_REQUIRED = text('CERTIFICATION_REQUIRED', 'Certificate / approval required', 'COMPLIANCE', 'Certificate the item must come with (type approval, test certificate, conformity certificate).', 'EASA Form 1, EN 1090 CE', 80);

// ---------------------------------------------------------------------------------------------------------------
// Metals & raw materials
// ---------------------------------------------------------------------------------------------------------------
export const METAL_GRADE = text('METAL_GRADE', 'Material grade / alloy', 'MATERIAL', 'Grade on the mill certificate or stamped on the material, e.g. S275JR, 304L, 6061-T6, C45, CW614N. Different grades are not interchangeable.', 'S355JR', 40);
export const METAL_STANDARD = text('MATERIAL_STANDARD', 'Material standard', 'COMPLIANCE', 'Standard the grade is specified to, from the mill certificate.', 'EN 10025-2, ASTM A240', 60);
export const METAL_FORM = pick('METAL_FORM', 'Form as supplied', 'DIMENSION', 'Shape the material arrives in from the mill or stockist.', ['Plate', 'Sheet', 'Coil', 'Strip', 'Round bar', 'Square bar', 'Flat bar', 'Hexagon bar', 'Tube / pipe', 'Wire / wire rod', 'Billet', 'Ingot', 'Cathode', 'Granules / shot', 'Powder', 'Sponge', 'Foil', 'Extrusion profile', 'Lamination stock', 'Scrap', OTHER]);
export const METAL_CONDITION = pick('METAL_CONDITION', 'Condition / finish', 'MATERIAL', 'Surface or heat-treatment condition on the certificate (HR = hot rolled, CR = cold rolled).', ['Hot rolled (HR)', 'Hot rolled, pickled & oiled', 'Cold rolled (CR)', 'Annealed', 'Normalised', 'Quenched & tempered', 'Bright drawn / peeled', 'Galvanised (hot-dip)', 'Electro-galvanised', 'Pre-painted', '2B (stainless)', 'BA (stainless bright annealed)', 'No. 4 brushed (stainless)', 'As cast', 'Mill finish (aluminium)', 'Anodised', OTHER]);
export const DIMENSIONS_TEXT = text('DIMENSIONS', 'Dimensions', 'DIMENSION', 'Size with units in the order the supplier uses: thickness × width × length for plate and sheet, diameter × length for bar.', '6 × 1500 × 3000 mm', 60);
export const PURITY_PCT = dec('PURITY_PERCENT', 'Purity / main content', '%', 'RATING', 'Minimum content of the main element or compound, from the specification or certificate of analysis.', '99.9', 0, 100);
export const PARTICLE = text('PARTICLE_SIZE', 'Particle / grain size', 'DIMENSION', 'Size range or mesh from the specification (D50 in µm, mesh, or mm range).', 'D50 45 µm; 0.6–1.2 mm; 200 mesh', 40);
export const MOISTURE = dec('MOISTURE_MAX_PCT', 'Moisture (maximum)', '%', 'RATING', 'Maximum moisture allowed, from the specification or certificate of analysis.', '0.5', 0, 100);
export const BULK_DENSITY = dec('BULK_DENSITY', 'Bulk density', 'kg/m³', 'RATING', 'Weight of one cubic metre as poured, from the datasheet. Needed for silo and transport planning.', '1450');
export const COIL_WEIGHT = dec('COIL_WEIGHT_T', 'Coil / bundle weight', 't', 'PACK', 'Weight of one coil or bundle as delivered.', '8');

// Polymers & rubber
export const POLYMER = pick('POLYMER_TYPE', 'Polymer type', 'MATERIAL', 'Plastic family from the datasheet or bag. Resin codes: 1 PET, 2 HDPE, 3 PVC, 4 LDPE, 5 PP, 6 PS.', ['PET', 'rPET (recycled PET)', 'HDPE', 'LDPE', 'LLDPE', 'PP homopolymer', 'PP copolymer', 'PVC', 'ABS', 'Polycarbonate (PC)', 'Nylon PA6', 'Nylon PA66', 'POM (acetal)', 'PBT', 'PEEK', 'TPU', 'EVA', 'Polystyrene (PS / HIPS)', 'EPS (expandable PS)', 'PLA', 'Bio-polymer compound', OTHER]);
export const RESIN_GRADE = text('RESIN_GRADE', 'Grade / product code', 'IDENTITY', 'Producer’s grade name printed on the bag and datasheet. Grades of the same polymer behave differently on the machine.', 'SABIC HDPE B5823; Indorama RAMAPET N1', 60);
export const PROCESS_USE = pick('PROCESS_METHOD', 'Intended process', 'MATERIAL', 'Process the grade is made for — a blow-moulding grade will not run on an injection machine.', ['Injection moulding', 'Blow moulding', 'Stretch blow (preforms)', 'Film extrusion (blown)', 'Film extrusion (cast)', 'Pipe / profile extrusion', 'Fibre / filament', 'Thermoforming', 'Rotational moulding', 'Compounding / masterbatch', 'Foam', OTHER]);
export const MFI = dec('MELT_FLOW_INDEX', 'Melt flow index (MFI)', 'g/10 min', 'RATING', 'From the datasheet, with the test condition (e.g. 190 °C / 2.16 kg). Higher MFI flows more easily.', '0.3');
export const IV_PET = dec('INTRINSIC_VISCOSITY', 'Intrinsic viscosity (IV)', 'dL/g', 'RATING', 'PET resin quality figure from the datasheet: bottle grades are about 0.76–0.84.', '0.80');
export const RECYCLED_PCT = dec('RECYCLED_CONTENT_PCT', 'Recycled content', '%', 'MATERIAL', 'Share of recycled material declared by the supplier (needed for EPR reporting).', '30', 0, 100);
export const RESIN_FORM = pick('RESIN_FORM', 'Physical form', 'DIMENSION', 'How the polymer is supplied.', ['Pellets / granules', 'Flakes', 'Powder', 'Beads', 'Bales', 'Liquid / latex', 'Sheets / crumb']);
export const ELASTOMER_TYPE = pick('ELASTOMER_TYPE', 'Rubber type', 'MATERIAL', 'Rubber polymer from the specification.', ['Natural rubber (NR)', 'SBR', 'NBR (nitrile)', 'EPDM', 'FKM (Viton)', 'Butyl (IIR)', 'Silicone (VMQ)', 'Neoprene (CR)', 'Natural latex concentrate', OTHER]);
export const RUBBER_GRADE = text('RUBBER_GRADE', 'Grade', 'IDENTITY', 'Grade on the bale or datasheet (e.g. TSR 20, RSS 3, SBR 1502, 60% HA latex).', 'TSR 20', 30);
export const MOONEY = int('MOONEY_VISCOSITY', 'Mooney viscosity ML(1+4) 100 °C', 'MU', 'RATING', 'Processing viscosity from the certificate of analysis.', '60', 0, 200);
export const SHORE_A = int('HARDNESS_SHORE_A', 'Hardness', 'Shore A', 'RATING', 'Hardness of the rubber or compound (higher = harder).', '70', 10, 100);

// Chemicals (generic)
export const CHEM_NAME = text('CHEMICAL_NAME', 'Chemical name', 'IDENTITY', 'Full chemical name as on the safety data sheet section 3 — not a trade name.', 'Sodium hydroxide', 80);
export const CAS = text('CAS_NUMBER', 'CAS number', 'COMPLIANCE', 'Chemical identity number from SDS section 3, digits in three groups.', '1310-73-2', 15);
export const CHEM_GRADE = pick('CHEMICAL_GRADE', 'Grade', 'COMPLIANCE', 'Purity grade printed on the pack. Food and pharma uses need food (FCC/E-number) or pharmacopoeia grade; laboratories need AR/HPLC.', [['TECH', 'Technical / industrial'], ['COMMERCIAL', 'Commercial'], ['FOOD', 'Food grade (FCC / E-number)'], ['PHARMA', 'Pharmacopoeia (USP / BP / Ph. Eur.)'], ['AR', 'Analytical reagent (AR / ACS)'], ['HPLC', 'HPLC / LC-MS grade'], ['ELECTRONIC', 'Electronic / battery grade'], ['FEED', 'Feed grade']]);
export const ASSAY = dec('ASSAY_PCT', 'Concentration / assay', '%', 'RATING', 'Strength of the active substance, from the label or certificate of analysis (e.g. 98% sulphuric, 48% caustic lye).', '98', 0, 100);
export const PHYS_FORM = pick('PHYSICAL_FORM', 'Physical form', 'MATERIAL', 'State of the product as delivered.', ['Liquid', 'Solution', 'Powder', 'Granules', 'Flakes', 'Pellets / prills', 'Paste / gel', 'Gas', 'Liquefied gas', 'Tablets', 'Emulsion', 'Aerosol', 'Solid block']);
export const FUNCTION = text('FUNCTION_USE', 'Function / use', 'MATERIAL', 'What the product does in your process, in plain words.', 'Antifoam in fermentation', 80);
export const DILUTION = text('DILUTION', 'Use dilution / dose', 'RATING', 'How much is used, from the product label or technical sheet.', '1:100 in water; 20 ppm', 40);
export const PH_VALUE = text('PH', 'pH (as supplied / 1% solution)', 'RATING', 'pH from the technical sheet. Shows how acidic or alkaline it is.', '12.5–13.5', 20);
export const FLASH_C = dec('FLASH_POINT_C', 'Flash point', '°C', 'COMPLIANCE', 'From SDS section 9. Below 60 °C means flammable storage rules apply.', '62', -100, 400);
export const ACTIVE = text('ACTIVE_INGREDIENT', 'Active ingredient and strength', 'MATERIAL', 'Active substance(s) and amount printed on the label.', 'Benzalkonium chloride 10%', 120);
export const TRADE_REF = text('EQUIVALENT_PRODUCT', 'Reference product (equivalent to)', 'IDENTITY', 'A well-known product this item must be equal to, so suppliers can offer equivalents.', 'Equivalent to Loctite 243', 80);
export const MIX_RATIO = text('MIX_RATIO', 'Mix ratio (two-part products)', 'RATING', 'Resin : hardener ratio by weight or volume from the technical sheet.', '100:30 by weight', 30);
export const POT_LIFE = dec('POT_LIFE_MIN', 'Pot life / working time', 'min', 'RATING', 'Time you can work with it after mixing, from the technical sheet.', '45');
export const CURE = text('CURE_TIME', 'Cure / drying time', 'RATING', 'Time to handle and to full cure at 25 °C.', 'Touch dry 2 h, full cure 24 h', 40);
export const COVERAGE = text('COVERAGE', 'Coverage', 'RATING', 'Area covered per litre or kg at the stated thickness, from the technical sheet.', '8–10 m²/L at 50 µm', 40);
export const WATER_TREAT_FN = pick('WATER_TREATMENT_FUNCTION', 'Treatment function', 'MATERIAL', 'What the chemical does in the water system.', ['Coagulant', 'Flocculant', 'Antiscalant / scale inhibitor', 'Corrosion inhibitor', 'Biocide / disinfectant', 'Oxygen scavenger', 'pH adjustment / alkalinity', 'Dechlorination', 'Membrane cleaner', 'Resin regenerant', 'Activated carbon', OTHER]);
export const ION_RESIN = pick('ION_EXCHANGE_TYPE', 'Resin type', 'MATERIAL', 'Resin type from the datasheet: strong-acid cation for softening, strong-base anion for demineralisation.', ['Strong acid cation (SAC)', 'Weak acid cation (WAC)', 'Strong base anion type I', 'Strong base anion type II', 'Weak base anion', 'Mixed bed', 'Chelating / selective']);
export const IONIC_FORM = pick('IONIC_FORM', 'Ionic form', 'MATERIAL', 'Form the resin is supplied in (Na for softeners).', ['Na⁺', 'H⁺', 'Cl⁻', 'OH⁻', 'Free base']);
export const EXCH_CAPACITY = dec('EXCHANGE_CAPACITY', 'Total exchange capacity', 'eq/L', 'RATING', 'From the datasheet; higher means more water treated per regeneration.', '2.0');
export const ADSORBENT = pick('ADSORBENT_TYPE', 'Adsorbent type', 'MATERIAL', 'Material type from the datasheet.', ['Molecular sieve 3A', 'Molecular sieve 4A', 'Molecular sieve 5A', 'Molecular sieve 13X', 'Activated alumina', 'Silica gel', 'Activated carbon (granular)', 'Activated carbon (powder)', 'Catalyst', OTHER]);

// Gases
export const GAS = pick('GAS_TYPE', 'Gas', 'MATERIAL', 'Gas name on the cylinder label and shoulder colour.', ['Nitrogen', 'Oxygen', 'Argon', 'Carbon dioxide', 'Hydrogen', 'Helium', 'Acetylene', 'LPG', 'Propane', 'Argon/CO₂ mix (MAG)', 'Calibration gas mixture', 'Refrigerant', 'Nitrous oxide', 'Medical air', OTHER]);
export const GAS_PURITY = pick('GAS_PURITY', 'Purity grade', 'RATING', 'Purity on the label. 4.6 = 99.996%, 5.0 = 99.999%. Food and medical gases need their own grade.', ['Industrial', 'Food grade (E290/E941)', 'Medical', '4.6 (99.996%)', '5.0 (99.999%)', '6.0 (99.9999%)', 'Welding grade', 'Laser grade', 'Certified calibration mixture']);
export const GAS_SUPPLY = pick('GAS_SUPPLY_FORM', 'Supply form', 'PACK', 'How the gas is delivered.', ['Cylinder', 'Cylinder bundle / pack', 'Bulk liquid (tanker)', 'Dewar', 'Pipeline', 'On-site generator']);
export const CYL_SIZE = text('CYLINDER_SIZE', 'Cylinder size', 'PACK', 'Water capacity in litres or content in kg/m³ stamped on the cylinder.', '50 L / 9 m³; 13 kg', 30);
export const VALVE_OUTLET = text('VALVE_OUTLET', 'Valve outlet / connection', 'CONNECTION', 'Valve thread standard on the cylinder (must match the regulator).', 'BS 341 No.3; CGA 580', 30);

// Fibres, paper, wood
export const FIBRE = pick('FIBRE_TYPE', 'Fibre', 'MATERIAL', 'Fibre material from the label or specification.', ['Cotton', 'Wool', 'Polyester', 'Viscose / rayon', 'Nylon', 'Aramid', 'Carbon', 'Glass', 'Jute', 'Flax / linen', 'Hemp', 'Spandex / elastane', 'Polypropylene', 'Blend — state in notes']);
export const FIBRE_FORM = pick('FIBRE_FORM', 'Form', 'DIMENSION', 'How the fibre is supplied.', ['Bale (raw fibre)', 'Staple fibre', 'Filament yarn', 'Spun yarn', 'Tow / roving', 'Sliver', 'Chopped strand']);
export const LINEAR_DENSITY = text('LINEAR_DENSITY', 'Yarn count / linear density', 'DIMENSION', 'Count printed on the cone or bale label: Ne for cotton, dtex or denier for man-made fibres, tex for glass.', 'Ne 30/1; 150D/48F; 2400 tex', 30);
export const STAPLE = dec('STAPLE_LENGTH_MM', 'Staple length', 'mm', 'DIMENSION', 'Fibre length (staple fibres only), from the bale certificate.', '38');
export const MICRONAIRE = dec('MICRONAIRE', 'Micronaire / fineness', '', 'RATING', 'Fibre fineness from the HVI test report (cotton 3.5–4.9 is premium).', '4.2');
export const PAPER_GRADE = pick('PAPER_GRADE', 'Paper / board grade', 'MATERIAL', 'Grade from the mill specification.', ['Kraft liner (virgin)', 'Test liner (recycled)', 'Fluting / medium', 'White top liner', 'Folding box board (FBB)', 'White lined chipboard (WLC)', 'Solid bleached board (SBS)', 'Sack kraft', 'Newsprint', 'Tissue base', 'Bleached kraft pulp', 'Unbleached kraft pulp', 'Dissolving pulp', 'Recycled pulp', 'Bagasse pulp', OTHER]);
export const GSM = int('GRAMMAGE_GSM', 'Grammage', 'g/m²', 'DIMENSION', 'Paper or board weight (gsm), from the reel label or ream wrapper.', '80', 1, 2000);
export const REEL_WIDTH = int('REEL_WIDTH_MM', 'Reel / roll width', 'mm', 'DIMENSION', 'Width of the reel or roll, on the reel label. Must suit the machine deckle or film width.', '1600', 1);
export const REEL_DIA = int('REEL_DIAMETER_MM', 'Reel / roll outside diameter', 'mm', 'DIMENSION', 'Maximum roll diameter the machine unwind can take.', '1200', 1);
export const CORE_ID = pick('CORE_DIAMETER', 'Core inside diameter', 'DIMENSION', 'Inside diameter of the cardboard or plastic core. Must fit the machine shaft.', ['25 mm (1")', '38 mm (1.5")', '40 mm', '76 mm (3")', '152 mm (6")', 'Coreless', OTHER]);
export const BRIGHTNESS = dec('BRIGHTNESS_ISO', 'Brightness', '% ISO', 'RATING', 'Whiteness of pulp or paper from the mill certificate.', '88', 0, 100);
export const WOOD_SPECIES = text('WOOD_SPECIES', 'Wood species', 'MATERIAL', 'Tree species (common and botanical name) from the delivery note or certificate.', 'Cypress (Cupressus lusitanica)', 60);
export const WOOD_GRADE = text('TIMBER_GRADE', 'Timber / board grade', 'COMPLIANCE', 'Strength or appearance grade, e.g. C24, GS, marine plywood BS 1088, MR / WBP.', 'C24 kiln dried', 40);
export const TREATMENT = pick('WOOD_TREATMENT', 'Treatment', 'MATERIAL', 'Preservative or drying treatment applied.', ['Untreated', 'Kiln dried (KD)', 'Air dried', 'CCA pressure treated', 'Creosote', 'Boron', 'Fire retardant', 'Heat treated (ISPM 15)']);
export const DIAMETER_CM = dec('LOG_DIAMETER_CM', 'Diameter (mid / small end)', 'cm', 'DIMENSION', 'Log diameter measured as your buying rule says.', '30');

// Food & agricultural inputs
export const COMMODITY = text('COMMODITY_VARIETY', 'Product and variety / type', 'IDENTITY', 'What it is, with variety or type that changes price or use.', 'White maize; Basmati rice; Arabica AA', 80);
export const FOOD_GRADE_CLASS = text('GRADE_STANDARD', 'Grade and standard', 'COMPLIANCE', 'Grade as defined by the standard you buy to, e.g. KS EAS 2 Grade 1, ICUMSA 45, Class I.', 'KS EAS 2:2017 Grade 1', 60);
export const AFLATOXIN = dec('AFLATOXIN_MAX_PPB', 'Aflatoxin (maximum)', 'ppb', 'COMPLIANCE', 'Maximum total aflatoxin allowed (EAC limit for maize is 10 ppb).', '10');
export const FOREIGN_MATTER = dec('FOREIGN_MATTER_MAX_PCT', 'Foreign matter (maximum)', '%', 'RATING', 'Maximum stones, husks, dust or other grains allowed.', '0.5', 0, 100);
export const BRIX = dec('BRIX', 'Brix / soluble solids', '°Bx', 'RATING', 'Sugar concentration from the certificate (syrups, juices, concentrates).', '65', 0, 100);
export const ICUMSA = int('ICUMSA_COLOUR', 'ICUMSA colour', 'IU', 'RATING', 'Sugar colour: ICUMSA 45 = refined white; 100–150 = plantation white; 600–1200 = brown.', '45', 0, 5000);
export const FAT_PCT = dec('FAT_PCT', 'Fat content', '%', 'RATING', 'Fat content from the label or specification.', '26', 0, 100);
export const PROTEIN_PCT = dec('PROTEIN_PCT', 'Protein content', '%', 'RATING', 'Protein content from the label or specification.', '34', 0, 100);
export const FFA = dec('FFA_MAX_PCT', 'Free fatty acids (maximum)', '%', 'RATING', 'Oil quality: refined oils are normally below 0.1%.', '0.1', 0, 100);
export const OIL_TYPE = pick('EDIBLE_OIL_TYPE', 'Oil / fat type', 'MATERIAL', 'Oil source as on the label.', ['Palm olein', 'Palm oil', 'Palm stearin', 'Sunflower', 'Soybean', 'Rapeseed / canola', 'Maize / corn', 'Cottonseed', 'Coconut', 'Olive (extra virgin)', 'Olive (refined)', 'Groundnut', 'Blended vegetable', 'Shortening', 'Margarine', 'Ghee / butter oil']);
export const REFINING = pick('REFINING', 'Processing', 'MATERIAL', 'How the oil was processed.', ['Crude', 'Refined, bleached & deodorised (RBD)', 'Cold pressed / virgin', 'Fractionated', 'Hydrogenated']);
export const FORTIFIED = yes('FORTIFIED', 'Fortified', 'COMPLIANCE', 'Yes if the product must be fortified as required by law (vitamin A in oil; iron, zinc and folic acid in flour; iodine in salt).');
export const ORIGIN_TEXT = text('ORIGIN_SOURCE', 'Origin / source', 'IDENTITY', 'Country, region or farm the product comes from, if it matters for quality or regulation.', 'Kenya highlands', 60);
export const ALLERGENS = many('ALLERGENS', 'Allergens present', 'COMPLIANCE', 'Allergens declared on the label or specification.', ['None declared', 'Gluten (cereals)', 'Milk', 'Egg', 'Peanuts', 'Tree nuts', 'Soy', 'Fish', 'Crustaceans', 'Sesame', 'Mustard', 'Celery', 'Sulphites', 'Lupin', 'Molluscs']);
export const PACKAGING_FOOD = pick('FOOD_PACKAGING', 'Packing', 'PACK', 'How the food is packed.', ['Bulk', 'Jute / PP bag', 'Paper bag', 'Carton', 'Bottle / jar', 'Tin', 'Vacuum pack', 'Tray, cling film', 'Crate', 'Aseptic bag-in-drum', 'Sachet', 'Frozen block', OTHER]);

// ---------------------------------------------------------------------------------------------------------------
// Production intermediates & finished goods
// ---------------------------------------------------------------------------------------------------------------
export const RECIPE = text('RECIPE_FORMULA', 'Recipe / formula / BOM reference', 'IDENTITY', 'Recipe, formula or bill of materials that defines the item.', 'RCP-COLA-07 v3', 40);
export const OPERATION = text('ROUTING_STAGE', 'Last operation completed', 'IDENTITY', 'The production step the item has reached (from the routing), e.g. turned, heat treated, wound.', 'Op 30 — heat treated', 60);
export const BATCH_SIZE = text('STANDARD_BATCH', 'Standard batch size', 'RATING', 'Normal batch or lot size produced, with unit.', '5000 L', 30);
export const HOLD_TIME = dec('MAX_HOLD_HOURS', 'Maximum hold time', 'h', 'PACK', 'Longest time the intermediate may wait before the next step (quality limit).', '24');
export const KEY_SPEC = text('KEY_SPECIFICATION', 'Key release specification', 'RATING', 'The measurements quality checks before release (with limits).', 'Brix 11.2 ±0.2, pH 2.6–2.8', 120);
export const DOSAGE_FORM = pick('DOSAGE_FORM', 'Dosage form', 'MATERIAL', 'Pharmaceutical form as on the pack.', ['Tablet', 'Film-coated tablet', 'Capsule', 'Oral solution / syrup', 'Oral suspension', 'Injection (vial)', 'Injection (ampoule)', 'Infusion', 'Cream / ointment', 'Gel', 'Eye / ear drops', 'Inhaler', 'Suppository', 'Powder for reconstitution', 'Vaccine', 'Patch', OTHER]);
export const STRENGTH = text('STRENGTH', 'Strength', 'RATING', 'Amount of active ingredient per unit, as on the pack.', '500 mg; 250 mg/5 ml', 40);
export const INN = text('GENERIC_NAME', 'Generic name (INN)', 'IDENTITY', 'International non-proprietary name of the medicine (not the brand).', 'Amoxicillin', 80);
export const ATC = text('ATC_CODE', 'ATC code', 'COMPLIANCE', 'WHO Anatomical Therapeutic Chemical code, if known.', 'J01CA04', 10);
export const RX = pick('PRESCRIPTION_CLASS', 'Prescription class', 'COMPLIANCE', 'Legal category on the pack.', ['Prescription only (POM)', 'Pharmacy only (P)', 'General sale (OTC)', 'Controlled / scheduled drug']);

// ---------------------------------------------------------------------------------------------------------------
// Packaging materials
// ---------------------------------------------------------------------------------------------------------------
export const PKG_MATERIAL = pick('PACKAGING_MATERIAL', 'Material', 'MATERIAL', 'Material of the pack, from the specification or recycling mark.', ['PET', 'rPET', 'HDPE', 'LDPE / LLDPE', 'PP', 'PS', 'PVC', 'Glass (flint)', 'Glass (amber)', 'Glass (green)', 'Aluminium', 'Tinplate / steel', 'Paper', 'Paperboard', 'Corrugated board', 'Moulded pulp', 'Bagasse', 'PLA / compostable', 'Wood', 'Foam (EPE / EPS)', 'Multi-layer laminate', 'Rubber (bromobutyl / chlorobutyl)', OTHER]);
export const CAPACITY_ML = dec('NOMINAL_CAPACITY_ML', 'Nominal capacity', 'ml', 'DIMENSION', 'Fill volume the container is designed for (brimful is larger), from the drawing.', '500');
export const NECK = pick('NECK_FINISH', 'Neck / closure finish', 'CONNECTION', 'Neck standard that the cap must match, from the bottle drawing (e.g. PCO 1881 for carbonated soft drinks).', ['PCO 1810', 'PCO 1881', '26 mm crown', '29 mm crown', '28 mm ROPP', '30/25 (water)', '38 mm 3-start', '38 mm 2-start (dairy)', '43 mm', '48 mm', '53 mm', '55 mm (5-gallon)', '63 mm', '70 mm lug', '82 mm lug', 'GL45 (lab)', '13 mm vial', '20 mm vial', 'Can end 200/202', 'Can end 206', OTHER]);
export const PREFORM_WEIGHT = dec('UNIT_WEIGHT_G', 'Unit weight', 'g', 'DIMENSION', 'Weight of one bottle, preform, cap or can, from the drawing. Lighter weights affect machine settings.', '21.5');
export const PKG_COLOUR = text('PACK_COLOUR', 'Colour', 'MATERIAL', 'Colour or Pantone reference of the pack.', 'Clear; Pantone 485 C; amber', 30);
export const HEIGHT_MM = dec('HEIGHT_MM', 'Height', 'mm', 'DIMENSION', 'Overall height from the drawing.', '230');
export const DIA_MM = dec('DIAMETER_MM', 'Diameter', 'mm', 'DIMENSION', 'Outside diameter from the drawing.', '65');
export const CLOSURE_TYPE = pick('CLOSURE_TYPE', 'Closure type', 'MATERIAL', 'Type of cap or closure.', ['Plastic screw cap', 'Sports / push-pull cap', 'Flip-top cap', 'Crown cork', 'ROPP aluminium cap', 'Lug cap (glass jars)', 'Trigger sprayer', 'Pump dispenser', 'Rubber stopper', 'Aluminium crimp seal', 'Child-resistant closure', 'Induction seal liner', 'Tamper-evident band', 'Can end', OTHER]);
export const LINER = pick('CLOSURE_LINER', 'Liner / seal', 'MATERIAL', 'Sealing system inside the cap.', ['Linerless', 'PE foam liner', 'Induction foil liner', 'PVC-free compound', 'Oxygen scavenging liner', 'Pressure-sensitive liner']);
export const DECORATION = pick('PRINT_DECORATION', 'Printing / decoration', 'MATERIAL', 'Print on the pack. Printed items need the approved artwork reference.', ['Plain (unprinted)', '1 colour', '2 colours', '3–4 colours', 'Full colour (CMYK)', 'Full colour + spot', 'Embossed / hot foil', 'Laser / inkjet coded only']);
export const ARTWORK = text('ARTWORK_REFERENCE', 'Approved artwork reference', 'IDENTITY', 'Artwork number and version approved by marketing/regulatory. Printed packaging must match it exactly.', 'ART-LBL-0457 v6', 40);
export const FILM_STRUCTURE = text('FILM_STRUCTURE', 'Film structure', 'MATERIAL', 'Layers from outside to inside with thickness in µm, from the specification.', 'PET 12 / ALU 7 / PE 50', 80);
export const FILM_TYPE = pick('FILM_TYPE', 'Film type', 'MATERIAL', 'Kind of film.', ['Stretch film (hand)', 'Stretch film (machine)', 'Pre-stretched film', 'Shrink film (POF / PE)', 'Shrink sleeve (PETG / PVC / OPS)', 'BOPP', 'PET', 'Cast PP', 'PE (LDPE / LLDPE)', 'Barrier laminate', 'Foil laminate', 'Cling film', 'Blister PVC / PVDC', 'Lidding foil', 'Stretch hood film', OTHER]);
export const MICRON = int('THICKNESS_MICRON', 'Thickness', 'µm', 'DIMENSION', 'Film thickness in microns (1 mil = 25.4 µm), from the specification or roll label.', '23', 1, 2000);
export const ROLL_LENGTH = int('ROLL_LENGTH_M', 'Roll length', 'm', 'DIMENSION', 'Metres of film, label stock or ribbon on one roll.', '1500', 1);
export const SEAL_TEMP = text('SEALING_RANGE', 'Sealing temperature range', 'RATING', 'Heat-seal window from the specification.', '120–160 °C', 30);
export const OTR = text('BARRIER', 'Barrier (OTR / WVTR)', 'RATING', 'Oxygen and water-vapour transmission rates from the specification.', 'OTR < 1 cc/m²/day', 60);
export const CARTON_STYLE = pick('CARTON_STYLE', 'Box style (FEFCO)', 'MATERIAL', 'Box design code from the drawing. 0201 = regular slotted carton (most common).', ['FEFCO 0201 (RSC)', 'FEFCO 0203 (full overlap)', 'FEFCO 0300 (telescope lid)', 'FEFCO 0409 / 0427 (die-cut mailer)', 'FEFCO 0711 (crash lock bottom)', 'Tray / half slotted', 'Wrap-around blank', 'Folding carton (reverse tuck)', 'Folding carton (crash lock)', 'Sleeve', 'Partition / divider', OTHER]);
export const FLUTE = pick('BOARD_FLUTE', 'Board / flute', 'MATERIAL', 'Corrugated wall: single wall (B, C, E flute), double wall (BC), triple wall.', ['Single wall E flute', 'Single wall B flute', 'Single wall C flute', 'Double wall BC', 'Double wall EB', 'Triple wall', 'Solid board', 'Folding boxboard', 'Micro flute (F)']);
export const BOARD_STRENGTH = text('BOARD_STRENGTH', 'Board strength', 'RATING', 'Edge crush (ECT), bursting strength or box compression (BCT) required.', 'ECT 44 lb/in; BCT 350 kgf', 40);
export const INTERNAL_DIMS = text('INTERNAL_DIMENSIONS', 'Internal dimensions L × W × H', 'DIMENSION', 'Inside size in mm from the box drawing (length × width × height).', '400 × 300 × 250 mm', 40);
export const LABEL_TYPE = pick('LABEL_TYPE', 'Label type', 'MATERIAL', 'How the label is applied.', ['Pressure-sensitive (self-adhesive)', 'Wet-glue paper', 'Shrink sleeve', 'Stretch sleeve', 'Wrap-around (hot-melt)', 'In-mould (IML)', 'Thermal transfer label', 'Direct thermal label', 'RFID / smart label', 'Tamper-evident / security', 'Indicator (shock / tilt / temperature)']);
export const LABEL_SIZE = text('LABEL_SIZE', 'Label size W × H', 'DIMENSION', 'Width × height in mm, from the artwork.', '100 × 150 mm', 30);
export const ADHESIVE_TYPE = pick('LABEL_ADHESIVE', 'Adhesive', 'MATERIAL', 'Adhesive on the label. Freezer grade sticks below 0 °C; removable comes off cleanly.', ['Permanent', 'Removable', 'Freezer / cold-temperature', 'High-tack (rough surfaces)', 'Wash-off (returnable bottles)', 'Not applicable']);
export const LABELS_PER_ROLL = int('LABELS_PER_ROLL', 'Labels per roll', 'pcs', 'PACK', 'Number of labels on one roll.', '1000', 1);
export const WIND = pick('WINDING_DIRECTION', 'Winding / unwind position', 'CONNECTION', 'Position of the label coming off the roll (from the label printer or applicator manual).', ['Outside wound', 'Inside wound', 'Position 1', 'Position 2', 'Position 3', 'Position 4', 'Position 5', 'Position 6', 'Position 7', 'Position 8']);
export const RIBBON_TYPE = pick('RIBBON_TYPE', 'Ribbon type', 'MATERIAL', 'Ink type: wax for paper labels; wax-resin for coated paper and some films; resin for synthetic labels and harsh conditions.', ['Wax', 'Wax-resin', 'Resin', 'Near-edge', 'Flat-head', 'Dot-matrix fabric']);
export const RIBBON_WIDTH = int('RIBBON_WIDTH_MM', 'Ribbon width', 'mm', 'DIMENSION', 'Width printed on the core or box.', '110', 1, 300);
export const INK_SIDE = pick('INK_SIDE', 'Ink side', 'CONNECTION', 'Coated side of the ribbon — must match the printer (check the old ribbon).', ['Ink out (CSO)', 'Ink in (CSI)']);
export const PALLET_SIZE = pick('PALLET_SIZE', 'Pallet size', 'DIMENSION', 'Footprint in mm. Must fit racking, trucks and customer requirements.', ['1200 × 800 (EUR)', '1200 × 1000', '1200 × 1200', '1100 × 1100', '1140 × 1140', '1219 × 1016 (48 × 40")', '800 × 600 (half)', OTHER]);
export const PALLET_ENTRY = pick('PALLET_ENTRY', 'Fork entry', 'DIMENSION', 'Sides a forklift can enter from.', ['2-way', '4-way', 'Partial 4-way']);
export const PALLET_LOAD = dec('PALLET_LOAD_KG', 'Load capacity (dynamic / racking)', 'kg', 'RATING', 'Safe load when moved by forklift or stored in racking, from the supplier specification.', '1000');
export const STRAP_MATERIAL = pick('STRAP_MATERIAL', 'Strap material', 'MATERIAL', 'PP for light loads; PET (polyester) replaces steel for heavy loads.', ['PP (polypropylene)', 'PET (polyester)', 'Steel', 'Woven / corded polyester', 'Paper']);
export const STRAP_SIZE = text('STRAP_SIZE', 'Strap width × thickness', 'DIMENSION', 'Size printed on the coil label.', '12 × 0.6 mm', 20);
export const BREAK_STRENGTH = dec('BREAK_STRENGTH_KG', 'Break strength', 'kg', 'RATING', 'Breaking load from the specification.', '220');
export const BAG_TYPE = pick('BAG_TYPE', 'Bag / sack type', 'MATERIAL', 'Construction.', ['Woven PP sack', 'Woven PP sack with liner', 'Paper sack (multi-wall)', 'Valve sack', 'Open-mouth sack', 'Bulk bag (FIBC)', 'Stand-up pouch', 'Spout pouch', 'Flat pouch / sachet', 'Vacuum bag', 'Bag-in-box', 'Mailer / courier bag', OTHER]);
export const BAG_CAPACITY = text('BAG_CAPACITY', 'Fill capacity', 'DIMENSION', 'Weight or volume one bag holds.', '50 kg; 1000 kg; 250 ml', 20);
export const FIBC_SF = pick('FIBC_SAFETY_FACTOR', 'Safe working load / safety factor', 'RATING', 'FIBC rating printed on the label (ISO 21898). 5:1 single trip; 6:1 multi-trip.', ['SWL 500 kg 5:1', 'SWL 1000 kg 5:1', 'SWL 1500 kg 5:1', 'SWL 1000 kg 6:1', 'SWL 2000 kg 5:1', 'Not applicable']);
export const DESICCANT_UNITS = text('DESICCANT_SIZE', 'Desiccant size', 'DIMENSION', 'Grams or DIN 55473 units per sachet or canister.', '5 g; 16 units', 20);
export const DESICCANT_TYPE = pick('DESICCANT_TYPE', 'Desiccant type', 'MATERIAL', 'Absorbing material.', ['Silica gel', 'Montmorillonite clay', 'Molecular sieve', 'Calcium chloride', 'Activated carbon']);
export const VIAL_GLASS = pick('GLASS_TYPE', 'Glass type (pharmacopoeia)', 'COMPLIANCE', 'Type I borosilicate for injectables; type III soda-lime for oral liquids.', ['Type I (borosilicate)', 'Type II (treated soda-lime)', 'Type III (soda-lime)', 'Not glass']);
export const FOODSERVICE_ITEM = pick('FOODSERVICE_ITEM', 'Item', 'MATERIAL', 'What the disposable item is.', ['Cup (hot)', 'Cup (cold)', 'Cup lid', 'Food box / clamshell', 'Bowl', 'Plate', 'Tray', 'Foil container', 'Container lid', 'Cutlery / cutlery kit', 'Straw', 'Napkin', 'Wrap / sheet', 'Cup sleeve', 'Bag', OTHER]);
export const COMPOSTABLE = yes('COMPOSTABLE', 'Compostable / plastic-free', 'COMPLIANCE', 'Yes if it must be certified compostable (EN 13432) or plastic-free to meet single-use plastic rules.');

// ---------------------------------------------------------------------------------------------------------------
// MRO additions (mechanical, electrical, instrumentation)
// ---------------------------------------------------------------------------------------------------------------
export const GEAR_KIND = pick('GEAR_KIND', 'Gear type', 'MATERIAL', 'Shape of the gear.', ['Spur', 'Helical', 'Double helical', 'Bevel (straight)', 'Spiral bevel', 'Worm', 'Worm wheel', 'Rack', 'Internal (ring) gear', 'Planetary set']);
export const MODULE = dec('GEAR_MODULE', 'Module (or DP)', 'mm', 'DIMENSION', 'Tooth size. Module = pitch diameter ÷ number of teeth. For inch gears give diametral pitch (DP) in notes.', '3', 0.1);
export const PRESSURE_ANGLE = pick('PRESSURE_ANGLE', 'Pressure angle', 'DIMENSION', 'Tooth profile angle (20° is standard).', ['20°', '14.5°', '25°']);
export const FACE_WIDTH = dec('FACE_WIDTH_MM', 'Face width', 'mm', 'DIMENSION', 'Width of the teeth.', '30');
export const HELIX = text('HELIX_ANGLE_HAND', 'Helix angle and hand', 'DIMENSION', 'For helical gears: angle and direction (left / right hand).', '15° right hand', 20);
export const GEAR_MATERIAL = pick('GEAR_MATERIAL', 'Material / treatment', 'MATERIAL', 'Material and hardening.', ['Steel C45', 'Steel C45 induction hardened', 'Case-hardened steel (16MnCr5 / 20MnCr5)', 'Through-hardened alloy (42CrMo4)', 'Cast iron', 'Bronze', 'Nylon / acetal', 'Stainless steel']);
export const LINEAR_SIZE = text('LINEAR_SIZE', 'Size / model code', 'IDENTITY', 'Size code from the carriage or rail label (e.g. HGH25CA, 20 mm rail).', 'HGH25CA', 30);
export const RAIL_LENGTH = int('RAIL_LENGTH_MM', 'Rail / screw length', 'mm', 'DIMENSION', 'Overall length.', '1000', 1);
export const PRELOAD = pick('PRELOAD', 'Preload / accuracy class', 'RATING', 'From the type code.', ['Light preload (Z0)', 'Medium preload (ZA)', 'Heavy preload (ZB)', 'Normal accuracy (C)', 'High accuracy (H)', 'Precision (P)', 'Ultra precision (SP / UP)']);
export const SCREW_DIA_LEAD = text('SCREW_SIZE', 'Diameter × lead', 'DIMENSION', 'Screw nominal diameter and lead (travel per turn), e.g. 25 × 10 mm or Tr 20×4.', '25 × 10 mm', 20);
export const SHAFT_SPEC = text('SHAFT_SPECIFICATION', 'Shaft dimensions', 'DIMENSION', 'Diameter(s), length, keyways and threads, or attach the drawing.', 'Ø50 × 650 mm, 2 keyways 14 mm', 120);
export const KEY_SIZE = text('KEY_SIZE', 'Key size b × h × l', 'DIMENSION', 'Width × height × length of the key in mm (DIN 6885 / ISO 773).', '14 × 9 × 80', 20);
export const COLLAR_TYPE = pick('COLLAR_TYPE', 'Collar type', 'MATERIAL', 'Set-screw collars mark the shaft; clamp collars do not.', ['Set-screw', 'One-piece clamp', 'Two-piece (split) clamp', 'Threaded']);
export const BUSH_SIZE = pick('TAPER_BUSH_SIZE', 'Taper bush size', 'DIMENSION', 'Number cast on the bush face.', ['1008', '1108', '1210', '1215', '1610', '1615', '2012', '2017', '2517', '2525', '3020', '3030', '3525', '3535', '4030', '4040', '4535', '5040', 'QD / other']);
export const BUSH_BORE = text('BUSH_BORE', 'Finished bore and keyway', 'DIMENSION', 'Shaft size and keyway the bush is bored to.', '35 mm, key 10 mm', 20);
export const FIXING_TYPE = pick('FIXING_TYPE', 'Fixing type', 'MATERIAL', 'What it is.', ['Flat washer', 'Spring washer', 'Belleville / disc washer', 'Lock washer (toothed)', 'Circlip external (shaft)', 'Circlip internal (bore)', 'Retaining ring (spiral)', 'Split / cotter pin', 'Clevis pin', 'Dowel pin', 'Roll / spring pin', 'Taper pin', 'Blind rivet', 'Solid rivet', 'Rivet nut', 'Expansion anchor', 'Chemical anchor capsule', 'Thread insert / helicoil', 'Shim', OTHER]);
export const NOMINAL_SIZE_MM = text('NOMINAL_SIZE', 'Nominal size', 'DIMENSION', 'Size that identifies it: thread or shaft/bore diameter, × length where relevant.', 'M12; 30 mm shaft; 4 × 40 mm', 20);
export const FIXING_STD = text('PART_STANDARD', 'Part standard (DIN / ISO)', 'COMPLIANCE', 'Standard number if known — lets any supplier offer the same part (e.g. DIN 471, DIN 125, ISO 8752).', 'DIN 471', 20);
export const HYD_SEAL_TYPE = pick('HYDRAULIC_SEAL_TYPE', 'Seal type', 'MATERIAL', 'Function and profile of the seal.', ['Rod seal (U-cup)', 'Rod seal (step / PTFE)', 'Piston seal (compact)', 'Piston seal (PTFE + O-ring)', 'Wiper / scraper', 'Guide ring / wear band', 'Back-up ring', 'Quad / X-ring', 'V-packing set', 'Rotary seal', 'Pneumatic piston seal', 'Pneumatic rod seal']);
export const GROOVE = text('SEAL_SIZE', 'Size d × D × H', 'DIMENSION', 'Rod or bore diameter × groove diameter × groove width in mm (measure the groove, not the worn seal).', '50 × 60 × 7.3', 30);
export const SHEET_SIZE = text('SHEET_SIZE', 'Sheet size', 'DIMENSION', 'Width × length of the sheet or roll.', '1500 × 1500 mm', 30);
export const MAX_TEMP_C = dec('MAX_SERVICE_TEMP_C', 'Maximum service temperature', '°C', 'RATING', 'Highest temperature it can handle continuously, from the datasheet.', '250', -273);
export const MAX_P = dec('MAX_SERVICE_PRESSURE_BAR', 'Maximum service pressure', 'bar', 'RATING', 'Highest pressure it is rated for, from the datasheet.', '40');
export const HPU_FLOW = dec('FLOW_LPM', 'Flow', 'L/min', 'RATING', 'Rated flow from the datasheet or nameplate.', '40');
export const RESERVOIR = dec('RESERVOIR_L', 'Reservoir / volume', 'L', 'DIMENSION', 'Tank or vessel volume.', '100');
export const ACCUM_TYPE = pick('ACCUMULATOR_TYPE', 'Accumulator type', 'MATERIAL', 'Construction.', ['Bladder', 'Piston', 'Diaphragm']);
export const PRECHARGE = dec('PRECHARGE_BAR', 'Nitrogen pre-charge', 'bar', 'RATING', 'Gas pre-charge pressure on the label.', '90');
export const CETOP = pick('VALVE_INTERFACE', 'Valve size / interface', 'CONNECTION', 'Mounting pattern: CETOP / NG size for sub-plate valves, cavity size for cartridges, or inline port.', ['NG6 / CETOP 3', 'NG10 / CETOP 5', 'NG16 / CETOP 7', 'NG25 / CETOP 8', 'NG32 / CETOP 10', 'Cartridge (state cavity)', 'Inline (threaded ports)', 'Manifold / sandwich']);
export const SPOOL = text('SPOOL_TYPE', 'Spool / function code', 'RATING', 'Spool symbol from the type code (e.g. 4WE6 J = closed centre).', 'J (closed centre)', 30);
export const SETTING = text('SETTING_RANGE', 'Setting range', 'RATING', 'Adjustable range of pressure or flow.', '20–210 bar', 30);
export const HYD_FIT_STD = pick('HYDRAULIC_THREAD', 'Connection standard', 'CONNECTION', 'Identify by thread and sealing (use a thread gauge): BSP = British pipe; JIC = 37° flare; ORFS = flat face with O-ring; DIN 2353 = metric bite type (L/S series).', ['BSPP (G) 60° cone', 'BSPT (R)', 'JIC 37°', 'ORFS', 'NPT / NPTF', 'Metric DIN 2353 L series', 'Metric DIN 2353 S series', 'SAE O-ring boss (UNF)', 'SAE flange code 61', 'SAE flange code 62', 'Quick coupling ISO 7241-A', 'Quick coupling flat face ISO 16028']);
export const FIT_SIZE = text('FITTING_SIZE', 'Size', 'DIMENSION', 'Thread or tube size at each end (dash size, inch, or tube OD in mm).', '-08 (1/2"); 12L', 20);
export const FIT_SHAPE = pick('FITTING_SHAPE', 'Shape', 'MATERIAL', 'Fitting shape.', ['Straight', 'Elbow 90°', 'Elbow 45°', 'Tee', 'Cross', 'Banjo', 'Bulkhead', 'Reducer / adapter', 'Plug / cap', 'Swivel nut', 'Quick coupling (male)', 'Quick coupling (female)']);
export const FRL_TYPE = pick('AIR_PREP_TYPE', 'Unit type', 'MATERIAL', 'Air preparation unit.', ['Filter', 'Regulator', 'Filter-regulator', 'Lubricator', 'Filter-regulator-lubricator (FRL)', 'Coalescing filter', 'Shut-off / soft-start valve', 'Precision regulator']);
export const AIR_FLOW = int('AIR_FLOW_NL_MIN', 'Flow', 'Nl/min', 'RATING', 'Rated air flow from the datasheet.', '2000');
export const DRAIN = pick('DRAIN_TYPE', 'Drain', 'MATERIAL', 'How condensate is removed.', ['Manual', 'Semi-automatic', 'Automatic (float)', 'Electronic timer', 'Zero-loss (level sensing)']);
export const TUBE_OD = pick('TUBE_OD_MM', 'Tube outside diameter', 'DIMENSION', 'Tube OD in mm (push-in fittings are sized by OD).', ['3', '4', '6', '8', '10', '12', '14', '16', '1/4"', '5/16"', '3/8"', '1/2"'], 'mm');
export const TUBE_MAT = pick('TUBE_MATERIAL', 'Tube material', 'MATERIAL', 'PU is flexible; PA (nylon) is stiffer and takes higher pressure and temperature.', ['Polyurethane (PU)', 'Polyamide (PA / nylon)', 'Polyethylene (PE)', 'PTFE / PFA', 'Anti-spark / flame resistant']);
export const GRIP_FORCE = dec('GRIP_FORCE_N', 'Grip force', 'N', 'RATING', 'Gripping force at 6 bar from the datasheet.', '200');
export const GRIPPER_TYPE = pick('GRIPPER_TYPE', 'Gripper type', 'MATERIAL', 'Jaw movement.', ['Parallel', 'Angular', 'Radial', 'Three-jaw (centric)', 'Vacuum cup']);
export const ROLLER_DIA = dec('ROLLER_DIAMETER_MM', 'Roller / tube diameter', 'mm', 'DIMENSION', 'Outside diameter of the roller.', '89');
export const ROLLER_FACE = int('ROLLER_FACE_LENGTH_MM', 'Face (shell) length', 'mm', 'DIMENSION', 'Length of the rolling shell, excluding shaft ends.', '600', 1);
export const SHAFT_END = text('SHAFT_END', 'Shaft and end type', 'CONNECTION', 'Shaft diameter and end form (flats, threaded, spring-loaded) so it drops into the frame.', '20 mm with 14 mm flats', 40);
export const ROLLER_STD = text('ROLLER_STANDARD', 'Standard / series', 'COMPLIANCE', 'CEMA class, ISO 1537 / DIN 15207 series or maker series.', 'CEMA C; DIN 15207', 30);
export const PROFILE_SHAPE = text('PROFILE', 'Profile / section', 'DIMENSION', 'Shape and size of the profile from the drawing or catalogue (e.g. T-slot 20 mm, U-channel 40 × 10).', 'Guide rail 40 × 10 mm', 60);
export const ROPE_DIA = dec('ROPE_DIAMETER_MM', 'Rope diameter', 'mm', 'DIMENSION', 'Measured across the widest point with a calliper.', '16');
export const ROPE_CONSTRUCTION = text('ROPE_CONSTRUCTION', 'Construction', 'MATERIAL', 'Strands × wires and core, from the rope certificate (e.g. 6×36 WS IWRC).', '6×36 WS IWRC', 30);
export const ROPE_GRADE = pick('ROPE_GRADE', 'Rope grade', 'RATING', 'Tensile grade on the certificate.', ['1570', '1770', '1960', '2160']);
export const ROPE_LAY = pick('ROPE_LAY', 'Lay and finish', 'MATERIAL', 'Lay direction and coating.', ['RHOL bright', 'RHOL galvanised', 'LHOL', 'RHLL (Lang)', 'Rotation-resistant']);
export const MBL = dec('MBL_KN', 'Minimum breaking load', 'kN', 'RATING', 'From the rope or chain certificate.', '160');
export const WLL_T = dec('WLL_T', 'Working load limit (WLL)', 't', 'RATING', 'Stamped or labelled on the item. Never exceed it.', '2');
export const LIFT_GRADE = pick('LIFTING_GRADE', 'Grade', 'RATING', 'Chain and fitting grade (stamped). Do not mix grades in one sling.', ['Grade 80', 'Grade 100', 'Grade 120', 'Stainless', 'Not applicable']);
export const LIFT_ACCESSORY = pick('LIFTING_ACCESSORY', 'Accessory type', 'MATERIAL', 'What it is.', ['Chain sling', 'Webbing sling (flat)', 'Round sling', 'Wire rope sling', 'Shackle (bow)', 'Shackle (D)', 'Hook (clevis)', 'Hook (eye)', 'Master link', 'Eye bolt', 'Lifting point (swivel)', 'Load chain (hoist)', 'Turnbuckle']);
export const LEGS = pick('SLING_LEGS', 'Legs / length', 'DIMENSION', 'Number of legs and effective length.', ['1 leg', '2 legs', '3 legs', '4 legs', 'Endless']);
export const LIFT_STD = text('LIFTING_STANDARD', 'Standard', 'COMPLIANCE', 'Standard on the tag (EN 818, EN 1492, EN 13414, US Fed RR-C-271).', 'EN 818-4', 20);
export const ELEC_COMP = pick('ELECTRONIC_COMPONENT', 'Component type', 'MATERIAL', 'What the component is.', ['Resistor', 'Capacitor (ceramic)', 'Capacitor (electrolytic)', 'Capacitor (film)', 'Inductor / choke', 'Ferrite bead', 'Potentiometer', 'Diode (rectifier)', 'Zener diode', 'MOSFET', 'IGBT module', 'Transistor (BJT)', 'Thyristor / SCR', 'Optocoupler', 'IC / microcontroller', 'Connector', 'Heat sink', 'Electronic fuse', 'Relay (PCB)', 'Printed circuit board', OTHER]);
export const ELEC_VALUE = text('COMPONENT_VALUE', 'Value and tolerance', 'RATING', 'Value printed or colour-coded on the part (Ω, µF, mH) with tolerance.', '4.7 kΩ ±1%; 470 µF', 30);
export const ELEC_RATING = text('COMPONENT_RATING', 'Voltage / current / power rating', 'RATING', 'Maximum rating from the datasheet.', '63 V, 0.25 W; 1200 V 300 A', 40);
export const PACKAGE = text('PACKAGE_CASE', 'Package / case', 'DIMENSION', 'Physical package: SMD size (0805, SOT-23) or through-hole (TO-220, radial 10 × 16 mm, 62 mm module).', 'TO-247; 0603', 30);
export const PCB_REV = text('BOARD_REVISION', 'Board revision', 'IDENTITY', 'Revision printed on the PCB (often “Rev” near the part number). Different revisions may not swap.', 'Rev C', 20);
export const TERMINAL_KIND = pick('TERMINAL_BLOCK_TYPE', 'Terminal type', 'MATERIAL', 'Clamping and function.', ['Screw', 'Spring (cage clamp)', 'Push-in', 'Fuse terminal', 'Disconnect / knife', 'Earth (PE)', 'Double-level', 'Sensor / actuator', 'Feed-through bolt']);
export const WIRE_RANGE = text('CONDUCTOR_RANGE', 'Conductor size', 'DIMENSION', 'Wire size it takes, in mm² (or AWG).', '0.2–4 mm²', 20);
export const BUSBAR = text('BUSBAR_SIZE', 'Bar size width × thickness', 'DIMENSION', 'Cross-section of the copper or aluminium bar.', '40 × 10 mm', 20);
export const LUG_TYPE = pick('LUG_TYPE', 'Lug type', 'MATERIAL', 'Construction.', ['Copper tube (crimp)', 'Tinned copper tube', 'Bimetal (Al–Cu)', 'Aluminium', 'Insulated ring (pre-insulated)', 'Fork / spade', 'Pin', 'Bell-mouthed (flexible cable)']);
export const LUG_SIZE = text('LUG_SIZE', 'Conductor size × stud hole', 'DIMENSION', 'Cable size in mm² and bolt hole size (e.g. 95 mm² × M12).', '95 mm² × M12', 20);
export const GLAND_THREAD = pick('GLAND_THREAD', 'Entry thread', 'CONNECTION', 'Thread into the enclosure.', ['M12', 'M16', 'M20', 'M25', 'M32', 'M40', 'M50', 'M63', 'M75', 'PG7', 'PG9', 'PG11', 'PG13.5', 'PG16', 'PG21', '1/2" NPT', '3/4" NPT', '1" NPT']);
export const CABLE_OD = text('CABLE_OD_RANGE', 'Cable outer diameter range', 'DIMENSION', 'Range of cable sheath diameters it seals on (measure the cable).', '10–14 mm', 20);
export const GLAND_TYPE = pick('GLAND_TYPE', 'Gland type', 'MATERIAL', 'Unarmoured = plastic/brass compression; armoured needs a cone (CW/BW type); Ex needs certification.', ['Nylon / polyamide (unarmoured)', 'Brass (unarmoured)', 'Armoured outdoor (CW)', 'Armoured indoor (BW)', 'Ex d / Ex e certified', 'EMC (screened)', 'Stainless steel']);
export const SPD_TYPE = pick('SPD_TYPE', 'Surge protector type', 'RATING', 'Type 1 at the main incomer (lightning), Type 2 at boards, Type 3 at equipment.', ['Type 1', 'Type 1+2', 'Type 2', 'Type 3', 'Data / signal line', 'PV (DC)']);
export const UC = text('UC_VOLTAGE', 'Max continuous voltage Uc', 'RATING', 'Printed on the device.', '275 V AC', 20);
export const IMAX = dec('IMAX_KA', 'Max discharge current Imax / Iimp', 'kA', 'RATING', 'Surge current rating printed on the device.', '40');
export const UTIL_CAT = pick('UTILISATION_CATEGORY', 'Utilisation category', 'RATING', 'AC-22 = mixed loads; AC-23 = motors (needed for motor isolators).', ['AC-21', 'AC-22', 'AC-23', 'DC-21', 'DC-PV2']);
export const PSU_OUT = text('PSU_OUTPUT', 'Output voltage and current', 'RATING', 'Output printed on the label.', '24 V DC, 10 A', 30);
export const PSU_IN = text('PSU_INPUT', 'Input voltage', 'RATING', 'Input range on the label.', '100–240 V AC', 30);
export const SHRINK_RATIO = text('SHRINK_SIZE', 'Size (supplied / recovered) and ratio', 'DIMENSION', 'Inside diameter before and after shrinking, e.g. 12.7/6.4 mm (2:1).', '12.7/6.4 mm 2:1', 30);
export const COLOUR = text('COLOUR', 'Colour', 'MATERIAL', 'Colour needed (wiring and safety colours follow standards).', 'Black; yellow/green', 20);
export const KVAR = dec('KVAR', 'Reactive power', 'kvar', 'RATING', 'Capacitor rating on the label.', '25');
export const BRUSH_DIMS = text('BRUSH_DIMENSIONS', 'Brush size t × a × r', 'DIMENSION', 'Thickness × width × length in mm (measure a new brush).', '16 × 32 × 40 mm', 30);
export const BRUSH_GRADE = text('BRUSH_GRADE', 'Carbon grade', 'MATERIAL', 'Grade stamped on the brush (e.g. EG34D, RC53). Wrong grade damages the commutator.', 'EG34D', 20);
export const BRUSH_LEAD = text('BRUSH_TERMINAL', 'Lead and terminal', 'CONNECTION', 'Shunt length and terminal type.', '50 mm lead, 6.4 mm fork', 40);
export const BRAKE_TORQUE = dec('BRAKE_TORQUE_NM', 'Braking torque', 'N·m', 'RATING', 'From the brake nameplate.', '40');
export const DEVICE_KIND = pick('CONTROL_DEVICE_TYPE', 'Device type', 'MATERIAL', 'Panel control device.', ['Push button (flush)', 'Push button (mushroom)', 'Emergency stop (twist release)', 'Emergency stop (key release)', 'Selector switch 2-position', 'Selector switch 3-position', 'Key switch', 'Pilot light', 'Illuminated push button', 'Potentiometer', 'Buzzer', 'Contact block', 'Enclosure / control station']);
export const DEVICE_DIA = pick('MOUNTING_DIAMETER', 'Mounting hole', 'DIMENSION', 'Panel cut-out diameter.', ['16 mm', '22 mm', '30 mm']);
export const DEVICE_COLOUR = pick('DEVICE_COLOUR', 'Colour', 'MATERIAL', 'Colour (IEC 60204: red = stop/emergency, green = start, yellow = abnormal).', ['Red', 'Green', 'Yellow', 'Blue', 'White', 'Black', 'Amber']);
export const STEP_FRAME = pick('STEPPER_FRAME', 'Frame size', 'DIMENSION', 'Square flange size (NEMA).', ['NEMA 8', 'NEMA 11', 'NEMA 14', 'NEMA 17', 'NEMA 23', 'NEMA 24', 'NEMA 34', 'NEMA 42']);
export const HOLD_TORQUE = dec('HOLDING_TORQUE_NM', 'Holding torque', 'N·m', 'RATING', 'From the label or datasheet.', '1.2');
export const STEP_ANGLE = pick('STEP_ANGLE', 'Step angle', 'RATING', 'Degrees per full step.', ['1.8° (200 steps)', '0.9° (400 steps)', '7.5°']);
export const PHASE_CURRENT = dec('PHASE_CURRENT_A', 'Current per phase', 'A', 'RATING', 'From the label.', '2.8');
export const CLIMATE_TYPE = pick('PANEL_CLIMATE_TYPE', 'Device', 'MATERIAL', 'Panel climate device.', ['Filter fan', 'Exhaust filter (grille)', 'Filter mat', 'Panel heater', 'Thermostat', 'Hygrostat', 'Panel air conditioner', 'Heat exchanger']);
export const CUTOUT = text('CUTOUT_SIZE', 'Cut-out / size', 'DIMENSION', 'Panel cut-out or mat size.', '125 × 125 mm', 30);
export const STORAGE_CAP = text('STORAGE_CAPACITY', 'Capacity', 'RATING', 'Storage capacity as labelled.', '32 GB; 1 TB', 20);
export const STORAGE_IF = pick('STORAGE_INTERFACE', 'Interface / form factor', 'CONNECTION', 'Must match the device slot.', ['SD / SDHC / SDXC', 'microSD', 'CompactFlash', 'CFast', 'USB-A', 'USB-C', '2.5" SATA', '3.5" SATA', 'M.2 SATA', 'M.2 NVMe 2280', 'DDR4 SODIMM', 'DDR4 DIMM', 'DDR5 SODIMM', 'DDR5 DIMM', 'SAS', OTHER]);
export const INDUSTRIAL_TEMP = yes('INDUSTRIAL_GRADE', 'Industrial grade (wide temperature)', 'RATING', 'Yes for PLC, HMI or outdoor devices — consumer cards fail in panels.');
export const POSITION_RANGE = text('MEASURING_STROKE', 'Measuring range / stroke', 'RATING', 'Measuring length or angle from the label.', '0–500 mm; ±60°', 30);
export const LINEARITY = text('LINEARITY', 'Linearity / resolution', 'RATING', 'From the datasheet.', '±0.05% FS; 1 µm', 30);
export const LOAD_CAP = dec('LOAD_CELL_CAPACITY_KG', 'Rated capacity', 'kg', 'RATING', 'Maximum load (Emax) on the label.', '500');
export const LC_TYPE = pick('LOAD_CELL_TYPE', 'Load cell type', 'MATERIAL', 'Construction.', ['Single point (platform)', 'Shear beam', 'Double-ended shear beam', 'S-type (tension/compression)', 'Compression canister', 'Tension link', 'Load pin', 'Torque transducer', 'Strain gauge', 'Weighing transmitter / indicator']);
export const OIML = pick('ACCURACY_CLASS_OIML', 'Accuracy class', 'RATING', 'OIML R60 class on the label (C3 = 3000 divisions). Trade-approved scales need certified cells.', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'D1', 'Non-approved']);
export const SENSITIVITY_MVV = dec('SENSITIVITY_MV_V', 'Rated output', 'mV/V', 'RATING', 'From the calibration certificate (usually 2 or 3 mV/V).', '2');
export const VIB_TYPE = pick('VIBRATION_SENSOR_TYPE', 'Sensor type', 'MATERIAL', 'What it measures.', ['Accelerometer (ICP / IEPE)', 'Accelerometer 4–20 mA', 'Velocity sensor', 'Eddy-current proximity probe', 'Vibration switch', 'Bearing condition (shock pulse)', 'Acoustic emission', 'Wireless vibration sensor', 'Keyphasor / speed probe']);
export const VIB_SENS = text('VIB_SENSITIVITY', 'Sensitivity', 'RATING', 'From the calibration certificate.', '100 mV/g; 8 mV/µm', 20);
export const FREQ_RANGE = text('FREQUENCY_RANGE', 'Frequency range', 'RATING', 'From the datasheet.', '0.5 Hz – 10 kHz', 30);
export const MOUNTING_METHOD = pick('SENSOR_MOUNTING', 'Mounting', 'CONNECTION', 'How it is fixed.', ['Stud M6', 'Stud M8', 'Stud 1/4-28 UNF', 'Magnetic base', 'Adhesive pad', 'Threaded housing', 'Bracket', 'Clamp-on', 'Flange']);
export const ANALYTE = pick('MEASURED_PARAMETER', 'Measured parameter', 'MATERIAL', 'What the sensor measures.', ['pH', 'ORP / redox', 'Conductivity', 'Dissolved oxygen', 'Turbidity', 'Free chlorine', 'Total chlorine', 'Ozone', 'Brix / refractive index', 'Density / concentration', 'Suspended solids', 'Colour', 'Moisture', 'Oil in water', OTHER]);
export const SENSOR_TECH = text('SENSOR_TECHNOLOGY', 'Sensor technology', 'MATERIAL', 'Measuring method from the datasheet (e.g. glass electrode, optical luminescent DO, 4-electrode conductivity).', 'Optical (luminescent) DO', 60);
export const ELECTRODE_CONN = text('SENSOR_CONNECTOR', 'Sensor head / connector', 'CONNECTION', 'Connector type (VP, K8S, S8, M12, Memosens) and thread (PG 13.5, 12 mm).', 'PG 13.5, VP6', 30);
export const GAS_MEASURED = many('GASES_MEASURED', 'Gas(es) measured', 'MATERIAL', 'Gases the detector reads.', ['Oxygen (O₂)', 'Carbon dioxide (CO₂)', 'Carbon monoxide (CO)', 'Hydrogen sulphide (H₂S)', 'Methane / LEL', 'Combustible (LEL)', 'Ammonia (NH₃)', 'Chlorine (Cl₂)', 'Sulphur dioxide (SO₂)', 'Nitrogen dioxide (NO₂)', 'VOC (PID)', 'Hydrogen (H₂)', 'Refrigerant', 'Dust / particulates (PM)', 'Dew point / moisture']);
export const GAS_RANGE = text('GAS_RANGE', 'Range', 'RATING', 'Measuring range with unit (ppm, % vol, % LEL).', '0–100 ppm; 0–100% LEL', 30);
export const GAS_TECH = pick('GAS_SENSOR_TECH', 'Sensor technology', 'MATERIAL', 'Detection method on the datasheet.', ['Electrochemical', 'Catalytic bead', 'Infrared (NDIR)', 'Photo-ionisation (PID)', 'Semiconductor', 'Paramagnetic', 'Zirconia', 'Laser', 'Optical scattering']);
export const CT_RATIO = text('CT_RATIO', 'Ratio', 'RATING', 'Primary/secondary on the label (e.g. 200/5 A, 11000/110 V).', '200/5 A', 20);
export const CT_CLASS = pick('CT_ACCURACY', 'Accuracy class', 'RATING', 'Metering classes 0.2–1; protection classes 5P / 10P.', ['0.2', '0.2S', '0.5', '0.5S', '1', '3', '5P10', '5P20', '10P10', 'PX']);
export const BURDEN = dec('BURDEN_VA', 'Burden', 'VA', 'RATING', 'Rated burden on the label.', '5');
export const WINDOW = text('WINDOW_SIZE', 'Window / busbar opening', 'DIMENSION', 'Size of the hole the cable or busbar passes through.', 'Ø32 mm; 40 × 10 mm bar', 30);
export const LIMIT_ACT = pick('ACTUATOR_HEAD', 'Actuator', 'MATERIAL', 'Operating head.', ['Roller lever', 'Adjustable roller lever', 'Rod lever', 'Plunger', 'Roller plunger', 'Spring rod / wobble stick', 'Fork lever', 'Rotary (cam)', 'Pull wire (rope)', 'Belt alignment roller']);
export const CONTACTS = text('CONTACT_ARRANGEMENT', 'Contacts', 'CONNECTION', 'Contact set (NO / NC, snap or slow action).', '1NO + 1NC snap action', 30);
export const LIMIT_STD = pick('LIMIT_SWITCH_STANDARD', 'Housing standard', 'COMPLIANCE', 'EN 50041 (metal, large) and EN 50047 (compact) switches are interchangeable between brands.', ['EN 50041', 'EN 50047', 'Maker standard']);
export const VISION_DEVICE = pick('VISION_DEVICE', 'Device', 'MATERIAL', 'Identification or vision device.', ['Area-scan camera', 'Line-scan camera', 'Smart camera / vision sensor', '3D sensor', 'Barcode reader (1D)', '2D code reader', 'OCR / OCV reader', 'RFID reader HF (13.56 MHz)', 'RFID reader UHF (860–960 MHz)', 'RFID antenna', 'UWB tag / anchor']);
export const READ_RANGE = text('READ_RANGE', 'Read range / field of view', 'RATING', 'Working distance and field of view or read range.', '100–300 mm; FOV 80 × 60 mm', 40);
export const RESOLUTION_MP = text('CAMERA_RESOLUTION', 'Resolution', 'RATING', 'Sensor resolution (MP) or code density (mil).', '5 MP; 5 mil', 20);
export const DIST_RANGE = text('DISTANCE_RANGE', 'Measuring range', 'RATING', 'Minimum–maximum distance with unit.', '50–500 mm', 20);
export const LASER_CLASS = pick('LASER_CLASS', 'Laser class', 'COMPLIANCE', 'Laser safety class on the label (IEC 60825-1).', ['Class 1', 'Class 2', 'Class 2M', 'Class 3R', 'Not laser']);
export const SAFETY_PL = pick('SAFETY_PERFORMANCE', 'Safety rating (PL / SIL / Type)', 'COMPLIANCE', 'Safety level from the certificate; must equal or exceed the machine risk assessment.', ['PL e / Cat. 4 / SIL 3', 'PL d / Cat. 3 / SIL 2', 'PL c', 'Type 4 (light curtain)', 'Type 2 (light curtain)', 'Type 3 (scanner)']);
export const RESOLUTION_MM = pick('DETECTION_CAPABILITY', 'Detection capability', 'RATING', 'Smallest object detected: 14 mm = finger, 30 mm = hand, 40+ mm = body.', ['14 mm (finger)', '20 mm', '30 mm (hand)', '40 mm', 'Body (multi-beam 2–4 beams)', 'Not applicable']);
export const PROTECTIVE_HEIGHT = int('PROTECTIVE_HEIGHT_MM', 'Protective height / field', 'mm', 'DIMENSION', 'Height of the protected field or scanner range.', '900', 0);
export const OSSD = yes('OSSD_OUTPUTS', 'OSSD safety outputs', 'CONNECTION', 'Yes if it has two OSSD outputs to a safety relay or safety PLC.');
export const ENV_PARAM = pick('ENVIRONMENT_PARAMETER', 'Parameter', 'MATERIAL', 'What is measured.', ['Barometric pressure', 'Wind speed', 'Wind direction', 'Rainfall', 'Solar radiation', 'UV index', 'Ambient light (lux)', 'Noise level', 'Temperature & humidity']);
export const CLEANLINESS = text('CLEANLINESS_RANGE', 'Measuring range', 'RATING', 'ISO 4406 code range, ppm water or viscosity range.', 'ISO 4406 10/8/5 – 25/24/23', 40);
export const FLAME_TYPE = pick('FLAME_DETECTION', 'Detection type', 'MATERIAL', 'Flame detection principle; must match the burner controller.', ['UV cell', 'IR cell', 'UV/IR', 'Ionisation flame rod', 'Flame scanner (self-check)', 'Flue gas O₂ probe', 'Opacity meter']);
export const BURNER_CTRL = text('BURNER_CONTROLLER', 'Compatible burner controller', 'IDENTITY', 'Burner control box it works with (on the burner panel).', 'Siemens LME22', 40);
export const SIGNAL_IN = text('INPUT_SIGNAL', 'Input signal', 'CONNECTION', 'Signal into the device.', '4–20 mA; PT100; 0–10 V', 30);
export const SIGNAL_OUT = text('OUTPUT_SIGNAL_TEXT', 'Output signal', 'CONNECTION', 'Signal out of the device.', '4–20 mA; relay', 30);
export const EX_CERT = text('EX_CERTIFICATE', 'Ex / IS certification', 'COMPLIANCE', 'Hazardous-area marking and certificate (e.g. II (1)G [Ex ia Ga] IIC).', 'ATEX II (1)G [Ex ia] IIC', 60);
export const DIN_WIDTH = dec('MODULE_WIDTH_MM', 'Module width', 'mm', 'DIMENSION', 'Width on the DIN rail.', '12.5');
export const ACCESSORY_TYPE = text('ACCESSORY_TYPE', 'Accessory type', 'MATERIAL', 'What the accessory is and what it is for.', 'M12 straight female connector, 5-pin, 5 m PUR cable', 120);
export const WELL_BORE = dec('THERMOWELL_BORE_MM', 'Bore', 'mm', 'DIMENSION', 'Inside diameter (must fit the sensor).', '7');
export const U_LENGTH = int('U_LENGTH_MM', 'Insertion (U) length', 'mm', 'DIMENSION', 'Length below the process connection.', '200', 1);

// Lifting, conveyor and lubrication hardware
export const NIPPLE = pick('GREASE_NIPPLE', 'Nipple type and thread', 'CONNECTION', 'Thread size (use a thread gauge) and head angle.', ['M6 × 1 straight', 'M8 × 1 straight', 'M10 × 1 straight', 'M8 × 1 45°', 'M8 × 1 90°', 'M10 × 1 90°', '1/8" BSP straight', '1/8" BSP 90°', '1/4" BSP straight', '1/4"-28 UNF straight', 'Button head', 'Flush type']);
export const LUBRICATOR = pick('LUBRICATOR_TYPE', 'Lubricator type', 'MATERIAL', 'Drive principle.', ['Gas-driven (electrochemical)', 'Electromechanical', 'Spring-driven', 'Centralised pump', 'Oil drip / wick']);
export const LUBE_VOLUME = int('LUBRICANT_VOLUME_ML', 'Lubricant volume', 'ml', 'DIMENSION', 'Volume of the cartridge.', '125', 1);
export const DISCHARGE_PERIOD = pick('DISCHARGE_PERIOD', 'Discharge period', 'RATING', 'Time to empty — set it from the bearing grease calculation.', ['1 month', '3 months', '6 months', '12 months', 'Adjustable']);
export const THREAD_SIZE = text('THREAD_SIZE', 'Thread size', 'CONNECTION', 'Thread (check with a thread gauge).', 'G 1/2"; M20 × 1.5', 20);
export const BREATHER_TYPE = pick('BREATHER_TYPE', 'Breather type', 'MATERIAL', 'Standard vent or desiccant breather (keeps moisture out of gearboxes and tanks).', ['Standard vent', 'Desiccant breather', 'Desiccant + check valve', 'Filter breather']);
export const PLUG_TYPE = pick('PLUG_TYPE', 'Plug / indicator type', 'MATERIAL', 'Type.', ['Drain plug', 'Magnetic drain plug', 'Fill plug', 'Vent plug', 'Sight glass (round)', 'Column level indicator', 'Sampling valve (pitot)', 'Sampling valve (push-button)']);

// Pump/compressor/HVAC/boiler spares
export const STEAM_TRAP = pick('STEAM_TRAP_TYPE', 'Trap type', 'MATERIAL', 'Operating principle on the body.', ['Thermodynamic (TD)', 'Float & thermostatic (F&T)', 'Inverted bucket', 'Balanced pressure thermostatic', 'Bimetallic', 'Venturi / orifice']);
export const TRAP_CAPACITY = dec('CONDENSATE_CAPACITY_KGH', 'Condensate capacity', 'kg/h', 'RATING', 'At the working pressure, from the sizing chart.', '300');
export const MEMBRANE_SIZE = pick('MEMBRANE_ELEMENT', 'Element size', 'DIMENSION', 'Diameter × length code: 4040 = 4" × 40", 8040 = 8" × 40".', ['2540', '4021', '4040', '8040', '8040 (400 ft²)', '8040 (440 ft²)', 'Hollow fibre module', 'Ceramic module']);
export const MEMBRANE_TYPE = pick('MEMBRANE_TYPE', 'Membrane type', 'MATERIAL', 'Application class.', ['RO brackish water', 'RO low-energy', 'RO seawater', 'Nanofiltration', 'Ultrafiltration', 'Microfiltration', 'Fouling-resistant']);
export const PERMEATE = dec('PERMEATE_FLOW', 'Permeate flow', 'm³/day', 'RATING', 'Nominal flow at test conditions (datasheet).', '9.1');
export const REJECTION = dec('SALT_REJECTION_PCT', 'Salt rejection', '%', 'RATING', 'Stabilised rejection (datasheet).', '99.7', 0, 100);
export const REFRIG_GAS = text('REFRIGERANT_TYPE', 'Refrigerant', 'MATERIAL', 'Refrigerant the part is rated for (R-number on the system nameplate).', 'R404A', 20);
export const REFRIG_CAPACITY = text('REFRIGERATION_CAPACITY', 'Capacity', 'RATING', 'Rated capacity in kW or TR and the orifice / cartridge size.', '10.5 kW, orifice 03', 30);
export const CONNECTION_SIZE = text('CONNECTION_SIZE', 'Connection size and type', 'CONNECTION', 'Size and type of the pipe connections (flare, solder ODF, thread).', '5/8" ODF solder', 30);
export const NOZZLE_FLOW = text('NOZZLE_RATING', 'Nozzle rating', 'RATING', 'Flow (USgph or kg/h), spray angle and pattern stamped on the nozzle.', '2.50 USgph 60° S', 30);
export const PHE_PART = text('PHE_PLATE_SPEC', 'Plate / gasket specification', 'MATERIAL', 'Plate model, material and thickness or gasket model and material (from the PHE nameplate and parts list).', 'M10-BFG plate AISI 316 0.5 mm; NBR clip-on gasket', 120);
export const UV_LAMP = text('UV_LAMP_SPEC', 'Lamp / sleeve specification', 'RATING', 'Lamp model, power and length, or sleeve OD × length.', '80 W, 843 mm; sleeve 25 × 900 mm', 60);
export const CT_PART = text('COOLING_TOWER_PART', 'Part specification', 'MATERIAL', 'Fill/eliminator type and flute size, nozzle size, fan blade diameter and pitch, with tower make/model.', 'PVC film fill 19 mm flute, 1220 × 305 × 1830 mm', 120);
export const BRUSH_TUBE = text('TUBE_ID_FOR_BRUSH', 'Tube inside diameter / length', 'DIMENSION', 'Tube bore the brush cleans and rod length.', '19 mm ID, 6 m', 30);
export const DRAIN_VALVE = pick('CONDENSATE_DRAIN', 'Drain type', 'MATERIAL', 'Condensate drain principle.', ['Timer solenoid', 'Zero-loss (level sensing)', 'Float', 'Manual ball valve']);
export const SAFETY_VALVE_SIZE = text('RELIEF_VALVE_SIZE', 'Inlet × outlet size and orifice', 'DIMENSION', 'Sizes and orifice letter/area from the valve tag.', '1" × 1-1/2", orifice F', 30);
export const RELIEF_CAPACITY = text('RELIEVING_CAPACITY', 'Relieving capacity', 'RATING', 'Certified capacity at set pressure (kg/h steam, Nm³/h air).', '850 kg/h steam', 30);

// Seals/rubber/insulation
export const AV_MOUNT = pick('MOUNT_TYPE', 'Mount type', 'MATERIAL', 'Shape / function.', ['Cylindrical (stud–stud)', 'Cylindrical (stud–female)', 'Bobbin', 'Cone mount', 'Machine foot (levelling)', 'Spring mount', 'Pad (sheet)', 'Buffer / bump stop', 'Bellows', 'Grommet']);
export const AV_LOAD = dec('MOUNT_LOAD_KG', 'Rated load per mount', 'kg', 'RATING', 'Maximum static load from the datasheet.', '120');
export const EXPANSION_JOINT_TYPE = pick('EXPANSION_JOINT_TYPE', 'Joint type', 'MATERIAL', 'Construction.', ['Rubber single sphere', 'Rubber twin sphere', 'PTFE bellows', 'Metal bellows (axial)', 'Metal bellows (lateral)', 'Fabric (ducting)']);
export const MOVEMENT = text('MOVEMENT', 'Allowed movement', 'RATING', 'Axial compression / extension and lateral movement from the datasheet.', '-15 / +8 mm axial, ±10 mm lateral', 40);
export const REFRACTORY_TYPE = pick('REFRACTORY_TYPE', 'Product type', 'MATERIAL', 'Refractory or insulation product.', ['Fire brick (dense)', 'Insulating fire brick', 'Castable (dense)', 'Castable (insulating)', 'Ramming / plastic mass', 'Mortar', 'Ceramic fibre blanket', 'Ceramic fibre board', 'Calcium silicate board', 'Mineral wool slab', 'Ceramic rope / tape', 'Gasket sheet (high temp)']);
export const CLASS_TEMP = int('CLASSIFICATION_TEMP_C', 'Classification temperature', '°C', 'RATING', 'Maximum use temperature from the datasheet.', '1260', 0, 2000);
export const AL2O3 = dec('ALUMINA_PCT', 'Alumina (Al₂O₃) content', '%', 'MATERIAL', 'From the datasheet — higher alumina resists higher temperatures.', '42', 0, 100);
export const DENSITY_KGM3 = int('DENSITY_KG_M3', 'Density', 'kg/m³', 'RATING', 'Bulk density from the datasheet.', '128', 1);
export const THERMAL_K = dec('THERMAL_CONDUCTIVITY', 'Thermal conductivity', 'W/m·K', 'RATING', 'At mean temperature stated on the datasheet.', '0.035');
export const BRICK_SHAPE = text('BRICK_SHAPE', 'Shape / size', 'DIMENSION', 'Standard shape name or size in mm.', '230 × 114 × 76 mm straight', 40);

// Tools, test & LOTO
export const TOOL_KIND = text('TOOL_TYPE', 'Tool type', 'MATERIAL', 'Exact tool name as in a tool catalogue (open-end spanner, ratchet, side cutters…).', 'Combination spanner', 60);
export const TOOL_SIZE = text('TOOL_SIZE', 'Size / range', 'DIMENSION', 'Size in mm or inches, or the range of a set.', '13 mm; 8–32 mm (12 pcs)', 40);
export const DRIVE_SQUARE = pick('DRIVE_SIZE', 'Square drive', 'CONNECTION', 'For sockets, ratchets and torque wrenches.', ['1/4"', '3/8"', '1/2"', '3/4"', '1"', 'Not applicable']);
export const INSULATED = yes('INSULATED_1000V', 'Insulated 1000 V (VDE / IEC 60900)', 'COMPLIANCE', 'Yes for tools used on or near live electrical parts.');
export const TOOL_MATERIAL = pick('TOOL_MATERIAL', 'Material', 'MATERIAL', 'Tool material.', ['Chrome vanadium (Cr-V)', 'Chrome molybdenum (Cr-Mo, impact)', 'S2 tool steel', 'HSS', 'HSS-Co (cobalt)', 'Solid carbide', 'Carbide tipped', 'Diamond', 'Stainless steel', 'Non-sparking (Cu-Be / Al-Br)', 'Fibreglass handle', 'Wood handle']);
export const SET_PIECES = int('PIECES_IN_SET', 'Pieces in set', 'pcs', 'DIMENSION', 'Number of pieces (sets only).', '12', 1);
export const TORQUE_RANGE = text('TORQUE_RANGE', 'Torque range', 'RATING', 'Range on the tool scale.', '40–200 N·m', 30);
export const CAL_CERT = yes('CALIBRATION_CERTIFICATE', 'Calibration certificate required', 'COMPLIANCE', 'Yes for measuring and torque tools used for quality or safety-critical work (ISO/IEC 17025 certificate).');
export const POWER_SOURCE = pick('POWER_SOURCE', 'Power source', 'RATING', 'How the tool is powered.', ['Cordless 12 V', 'Cordless 18 V / 20 V', 'Cordless 36 V / 54 V', 'Corded 230 V', 'Corded 110 V (site)', 'Pneumatic', 'Hydraulic', 'Petrol']);
export const BATTERY_PLATFORM = text('BATTERY_PLATFORM', 'Battery system (brand platform)', 'IDENTITY', 'Cordless tools only take batteries from the same brand system.', 'Makita LXT 18 V', 40);
export const TOOL_POWER = dec('TOOL_POWER_W', 'Rated power', 'W', 'RATING', 'Input power on the label.', '1400');
export const CAPACITY_TOOL = text('TOOL_CAPACITY', 'Capacity', 'RATING', 'Maximum capacity (chuck, disc, cut depth, crimp range, pulling force).', '13 mm chuck; 125 mm disc; 16–240 mm²', 40);
export const CUT_FOR = many('CUTS_MATERIAL', 'For material', 'RATING', 'Materials it is meant for.', ['Steel', 'Stainless steel', 'Cast iron', 'Aluminium / non-ferrous', 'Hardened steel', 'Masonry / concrete', 'Tile / stone', 'Wood', 'Plastic', 'Glass']);
export const SHANK = text('SHANK', 'Shank / arbor', 'CONNECTION', 'Shank type and size (straight, SDS-plus, hex 1/4", M14 thread, 22.23 mm bore).', 'SDS-plus', 30);
export const ISO_INSERT = text('CUTTING_INSERT_ISO', 'Insert designation (ISO)', 'IDENTITY', 'ISO code on the insert box (e.g. CNMG 120408) plus grade and chip-breaker.', 'CNMG 120408-PM 4325', 40);
export const TAP_SIZE = text('THREAD_TO_CUT', 'Thread to cut', 'DIMENSION', 'Thread size and tolerance for taps and dies.', 'M10 × 1.5, 6H', 20);
export const MEAS_INSTR = text('INSTRUMENT_TYPE_TEXT', 'Instrument type', 'MATERIAL', 'What the instrument is.', 'Digital calliper', 60);
export const MEAS_RANGE_TEXT = text('RANGE', 'Measuring range', 'RATING', 'Range with unit.', '0–150 mm; 0–1000 V', 30);
export const MEAS_RES = text('RESOLUTION_TEXT', 'Resolution / graduation', 'RATING', 'Smallest reading.', '0.01 mm', 20);
export const MEAS_ACC = text('ACCURACY_TEXT', 'Accuracy', 'RATING', 'Accuracy from the datasheet or certificate.', '±0.02 mm; ±(0.5% + 2 d)', 30);
export const CAT_RATING = pick('CAT_RATING', 'Measurement category', 'COMPLIANCE', 'Electrical safety category (IEC 61010). CAT III/IV for distribution boards.', ['CAT II 600 V', 'CAT III 600 V', 'CAT III 1000 V', 'CAT IV 600 V', 'Not applicable']);
export const LOTO_KIND = pick('LOTO_DEVICE', 'Device', 'MATERIAL', 'Lock-out / tag-out device.', ['Safety padlock', 'Lockout hasp', 'Breaker lockout (MCB)', 'Breaker lockout (MCCB)', 'Plug lockout', 'Ball valve lockout', 'Gate valve lockout', 'Cable lockout', 'Group lock box', 'Lockout tag', 'Lockout station']);
export const KEYING = pick('KEYING', 'Keying', 'MATERIAL', 'Keyed different = each lock has its own key (standard for LOTO).', ['Keyed different', 'Keyed alike', 'Master keyed', 'Not applicable']);
export const SHACKLE = text('SHACKLE_SPEC', 'Shackle / fits size', 'DIMENSION', 'Shackle diameter and clearance, or the valve/breaker size range it fits.', '6 mm × 38 mm nylon; valves 25–75 mm', 40);
export const TEST_ACC = text('TEST_ACCESSORY_SPEC', 'Accessory specification', 'MATERIAL', 'What it is, rating and connector (e.g. silicone test leads CAT III 1000 V, 4 mm plugs).', 'Silicone test leads, CAT III 1000 V, 4 mm', 120);
export const CAL_WEIGHT_CLASS = pick('WEIGHT_CLASS', 'Weight class (OIML R111)', 'COMPLIANCE', 'Accuracy class: E2 for analytical balances, F1/F2 for precision scales, M1 for industrial.', ['E1', 'E2', 'F1', 'F2', 'M1', 'M2', 'Not applicable']);
export const NOMINAL_VALUE = text('NOMINAL_VALUE', 'Nominal value', 'RATING', 'Value of the standard (mass, temperature, conductivity, hardness).', '1 kg; 1413 µS/cm; 60 HRC', 30);
export const ABSORBENT_TYPE = pick('ABSORBENT_TYPE', 'Absorbent type', 'MATERIAL', 'Oil-only repels water (for outdoor/water spills); universal takes oil and water; chemical for acids and aggressive liquids.', ['Universal (grey)', 'Oil-only (white)', 'Chemical / hazmat (yellow)', 'Granules (clay / mineral)', 'Granules (organic)']);
export const ABSORBENCY = dec('ABSORBENCY_L', 'Absorbency per pack', 'L', 'RATING', 'Litres absorbed per pack/bale (on the packaging).', '80');
export const ITEM_SIZE = text('ITEM_SIZE', 'Size', 'DIMENSION', 'Size of one item (dimensions, length or volume).', '40 × 50 cm; 1.2 m', 30);
export const NET_DEVICE = pick('NETWORK_DEVICE', 'Device', 'MATERIAL', 'Network component.', ['Unmanaged switch', 'Managed switch', 'PoE switch', 'Router', 'Firewall', 'Gateway / protocol converter', 'IO-Link master', 'IO-Link hub', 'Media converter', 'SFP transceiver', 'Wireless access point', 'Patch cable', 'Installation cable', 'Connector', 'Fieldbus connector', 'Patch panel', 'PoE injector', 'Surge protector (data)', OTHER]);
export const PORTS = text('PORTS', 'Ports and speed', 'RATING', 'Number and speed of ports.', '8 × 1 Gb + 2 SFP', 30);
export const MANAGED = pick('MANAGEMENT', 'Management', 'RATING', 'Managed switches support VLANs and diagnostics.', ['Unmanaged', 'Smart / web managed', 'Fully managed (Layer 2)', 'Layer 3']);
export const PROTOCOLS = many('INDUSTRIAL_PROTOCOLS', 'Industrial protocols', 'CONNECTION', 'Protocols supported (check with the PLC).', ['Profinet', 'EtherNet/IP', 'Modbus TCP', 'Modbus RTU', 'EtherCAT', 'Profibus', 'CANopen', 'OPC UA', 'MQTT', 'IO-Link', 'BACnet']);
export const CABLE_CAT = pick('NETWORK_CATEGORY', 'Category / fibre type', 'RATING', 'Copper category or fibre mode.', ['Cat5e', 'Cat6', 'Cat6A', 'Cat7', 'Fibre OM3 multimode', 'Fibre OM4 multimode', 'Fibre OS2 single mode', 'Coaxial RG-6', 'Coaxial RG-58', 'Coaxial LMR-400']);
export const SHIELDING = pick('CABLE_SHIELDING', 'Shielding / jacket', 'MATERIAL', 'Shielding and jacket. Use shielded PUR in factories, LSZH in buildings.', ['U/UTP PVC', 'U/UTP LSZH', 'F/UTP', 'S/FTP', 'SF/UTP PUR (industrial)', 'Armoured outdoor', 'Gel-filled outdoor']);
export const CONNECTORS_ENDS = text('CONNECTOR_ENDS', 'Connectors (end A / end B)', 'CONNECTION', 'Connector at each end.', 'RJ45 / RJ45; LC duplex / SC duplex', 40);
export const SFP_SPEC = text('TRANSCEIVER_SPEC', 'Transceiver specification', 'RATING', 'Standard, wavelength, reach and connector (e.g. 1000BASE-LX 1310 nm 10 km LC).', '1000BASE-LX 1310 nm 10 km LC', 60);
export const RF_BAND = text('FREQUENCY_BAND', 'Frequency band', 'RATING', 'Operating frequencies in MHz/GHz.', '403–470 MHz; 5 GHz', 30);
export const RF_CONNECTOR = pick('RF_CONNECTOR', 'RF connector', 'CONNECTION', 'Connector type and gender.', ['N-type male', 'N-type female', 'SMA male', 'SMA female', 'RP-SMA', 'BNC', 'TNC', 'F-type', '4.3-10', '7/16 DIN', 'QMA', 'Not applicable']);
export const ANTENNA_GAIN = dec('ANTENNA_GAIN_DBI', 'Gain', 'dBi', 'RATING', 'Antenna gain from the datasheet.', '6');

// ---------------------------------------------------------------------------------------------------------------
// Fuels
// ---------------------------------------------------------------------------------------------------------------
export const FUEL_GRADE = text('FUEL_SPECIFICATION', 'Fuel grade / specification', 'COMPLIANCE', 'Grade and standard on the delivery note (e.g. AGO 50 ppm KS EAS 177, Jet A-1 DEF STAN 91-091, HFO 180 cSt).', 'Diesel AGO 50 ppm, KS EAS 177', 60);
export const SULPHUR = int('SULPHUR_PPM', 'Sulphur (maximum)', 'ppm', 'COMPLIANCE', 'Maximum sulphur; East African diesel limit is 50 ppm.', '50', 0, 50000);
export const DENSITY15 = dec('DENSITY_15C', 'Density at 15 °C', 'kg/m³', 'RATING', 'From the delivery certificate; used to convert litres and kg.', '835');
export const CALORIFIC = dec('CALORIFIC_VALUE', 'Calorific value', 'MJ/kg', 'RATING', 'Net heat value from the supplier certificate (solid fuels and biomass).', '17.5');
export const ASH = dec('ASH_PCT', 'Ash content (maximum)', '%', 'RATING', 'Maximum ash, from the certificate.', '1.5', 0, 100);
export const FUEL_SIZE = text('FUEL_SIZE', 'Size / form', 'DIMENSION', 'Pellet diameter, briquette size or lump size.', 'Ø6 mm pellets; 20–50 mm lumps', 30);
export const ENGINE_OIL_SPEC = text('ENGINE_OIL_SPEC', 'Engine oil approvals', 'COMPLIANCE', 'API / ACEA classes and OEM approvals on the drum (e.g. API CK-4, ACEA E9, Cummins CES 20086).', 'API CK-4, ACEA E9', 80);

// ---------------------------------------------------------------------------------------------------------------
// PPE detail
// ---------------------------------------------------------------------------------------------------------------
export const HELMET_STD = pick('HELMET_STANDARD', 'Standard / electrical class', 'COMPLIANCE', 'Marked inside the shell. EN 50365 / Class E for electrical work.', ['EN 397', 'EN 397 + EN 50365 (1000 V)', 'EN 12492 (climbing)', 'EN 812 (bump cap)', 'ANSI Z89.1 Type I Class E', 'ANSI Z89.1 Type II', 'KS 1876']);
export const HARNESS_TYPE = pick('HEAD_HARNESS', 'Suspension', 'MATERIAL', 'Adjustment of the head harness.', ['Ratchet (wheel)', 'Pinlock', 'Slip-ratchet', 'Not applicable']);
export const EYE_STD = pick('EYE_PROTECTION_STANDARD', 'Standard and impact rating', 'COMPLIANCE', 'Marked on the frame/lens: EN 166 F = low-energy impact, B = medium; ANSI Z87.1+.', ['EN 166 F', 'EN 166 B', 'EN 166 3 (liquid splash)', 'EN 175 / EN 169 (welding)', 'EN 207 (laser)', 'ANSI Z87.1+']);
export const LENS = pick('LENS_TINT', 'Lens / filter', 'MATERIAL', 'Lens colour or welding shade.', ['Clear', 'Smoke / grey', 'Amber / yellow', 'Indoor/outdoor mirror', 'Welding shade 3–5 (gas)', 'Welding shade 9–13 (arc, auto-darkening)', 'Laser filter (state wavelength)']);
export const ANTIFOG = yes('ANTI_FOG', 'Anti-fog / anti-scratch coating', 'MATERIAL', 'Yes if lenses must be coated (marking K and N on EN 166 lenses).');
export const GLOVE_STD = text('GLOVE_RATING', 'Protection rating', 'COMPLIANCE', 'Pictogram codes on the glove: EN 388 (abrasion, cut, tear, puncture, ISO cut A–F), EN 374 (chemicals), EN 407 (heat), EN 511 (cold), EN 60903 class 00–4 (electrical).', 'EN 388 4X42D; EN 374-1 Type A', 60);
export const GLOVE_MATERIAL = pick('GLOVE_MATERIAL', 'Material', 'MATERIAL', 'Main material / coating.', ['Nitrile', 'Latex (natural rubber)', 'Vinyl (PVC)', 'Neoprene', 'Butyl', 'Leather (cow grain)', 'Leather (split)', 'PU-coated knit', 'Nitrile-coated knit', 'HPPE / cut-resistant', 'Kevlar / aramid', 'Cotton', 'Rubber (electrical)', 'Aluminised (heat)']);
export const GLOVE_SIZE = pick('GLOVE_SIZE', 'Size', 'DIMENSION', 'Hand size (EN 420: 7 = S, 8 = M, 9 = L, 10 = XL).', ['6 / XS', '7 / S', '8 / M', '9 / L', '10 / XL', '11 / XXL', 'Assorted']);
export const GLOVE_LENGTH = int('GLOVE_LENGTH_MM', 'Length', 'mm', 'DIMENSION', 'Overall length (longer for chemicals and welding).', '300', 100, 900);
export const DISPOSABLE = yes('DISPOSABLE', 'Disposable / single use', 'MATERIAL', 'Yes if the item is thrown away after one use.');
export const POWDER_FREE = yes('POWDER_FREE', 'Powder-free', 'MATERIAL', 'Yes for food, medical and laboratory use.');
export const AQL = dec('AQL', 'AQL (pinhole quality)', '', 'COMPLIANCE', 'Acceptable quality level from the box: medical gloves 1.5 or lower.', '1.5', 0, 10);
export const RESP_CLASS = pick('RESPIRATOR_CLASS', 'Protection class', 'COMPLIANCE', 'Marking on the mask or filter: FFP2/N95 for dust; FFP3 for fine toxic dust; A = organic vapours, B = inorganic, E = acid, K = ammonia, P3 = particles.', ['FFP1', 'FFP2', 'FFP3', 'N95', 'N99', 'P100', 'A1', 'A2', 'ABEK1', 'A2P3', 'ABEK1P3', 'P3 (particle filter)', 'Surgical (EN 14683 Type IIR)']);
export const VALVE = yes('EXHALATION_VALVE', 'Exhalation valve', 'MATERIAL', 'Yes if the mask has a valve (more comfortable; not for sterile areas).');
export const FACEPIECE = text('COMPATIBLE_FACEPIECE', 'Compatible mask / facepiece', 'IDENTITY', 'Mask series the cartridge fits (filters are brand-specific).', '3M 6000 series (bayonet)', 60);
export const SNR = int('SNR_DB', 'Noise reduction (SNR)', 'dB', 'RATING', 'SNR value on the pack (EN 352). Choose so the wearer is below 80 dB(A).', '33', 0, 45);
export const HEARING_TYPE = pick('HEARING_PROTECTOR', 'Type', 'MATERIAL', 'Type of protector.', ['Foam ear plug (disposable)', 'Reusable ear plug', 'Corded ear plug', 'Banded ear plug', 'Ear muff (headband)', 'Ear muff (helmet-mounted)', 'Electronic / communication muff']);
export const FALL_ITEM = pick('FALL_PROTECTION_ITEM', 'Item', 'MATERIAL', 'Fall-protection component.', ['Full-body harness (EN 361)', 'Positioning belt (EN 358)', 'Energy-absorbing lanyard (EN 355)', 'Restraint lanyard (EN 354)', 'Self-retracting lifeline (EN 360)', 'Anchor sling / strap (EN 795 B)', 'Fixed anchor (EN 795 A)', 'Connector / karabiner (EN 362)', 'Rope grab (EN 353-2)', 'Rescue tripod (EN 795 B)', 'Rescue rope (EN 1891)']);
export const ATTACH_POINTS = text('ATTACHMENT_POINTS', 'Attachment points / length', 'DIMENSION', 'Harness D-rings (dorsal, sternal, side) or lanyard length.', 'Dorsal + sternal; 2 m twin-leg', 40);
export const USER_WEIGHT = int('MAX_USER_WEIGHT_KG', 'Maximum user weight', 'kg', 'RATING', 'Including tools, from the label.', '140', 50, 300);
export const GARMENT = pick('GARMENT_TYPE', 'Garment', 'MATERIAL', 'Protective clothing item.', ['Coverall (reusable)', 'Coverall (disposable)', 'Jacket', 'Trousers', 'Hi-vis vest', 'Hi-vis jacket', 'Apron', 'Lab coat', 'Rain suit', 'Welding jacket / apron', 'Knee pads', 'Metatarsal guard', 'Cooling vest']);
export const GARMENT_STD = many('GARMENT_STANDARDS', 'Protection standards', 'COMPLIANCE', 'Labels inside the garment.', ['EN ISO 20471 class 1 (hi-vis)', 'EN ISO 20471 class 2', 'EN ISO 20471 class 3', 'EN ISO 11612 (heat & flame)', 'EN ISO 11611 (welding)', 'IEC 61482 (arc flash)', 'EN 1149-5 (antistatic)', 'EN 13034 Type 6 (light chemical splash)', 'EN ISO 13982 Type 5 (dust)', 'EN 14605 Type 3/4 (liquid)', 'EN 343 (rain)', 'NFPA 2112']);
export const GARMENT_SIZE = pick('GARMENT_SIZE', 'Size', 'DIMENSION', 'Garment size.', ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', 'Assorted']);
export const FABRIC = text('FABRIC', 'Fabric composition and weight', 'MATERIAL', 'Fabric from the label.', '65/35 polycotton, 245 g/m²', 40);
export const BOOT_STD = pick('FOOTWEAR_CLASS', 'Safety class', 'COMPLIANCE', 'Code on the tongue (EN ISO 20345): S1 = basic toe cap + antistatic; S1P adds midsole; S3 = water-resistant + midsole; SRC = slip-resistant.', ['SB', 'S1', 'S1P', 'S2', 'S3', 'S3 SRC', 'S5 (gumboot)', 'S1P SRC ESD', 'Electrical hazard (EH)', 'Chemical (EN 13832)']);
export const TOE_CAP = pick('TOE_CAP', 'Toe cap', 'MATERIAL', 'Steel is cheaper; composite is lighter and non-metallic.', ['Steel', 'Composite (non-metallic)', 'Aluminium', 'None (occupational)']);
export const SHOE_SIZE = pick('SHOE_SIZE', 'Size (EU)', 'DIMENSION', 'European size (UK + 33 ≈ EU).', ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', 'Assorted']);
export const BOOT_HEIGHT = pick('BOOT_HEIGHT', 'Style', 'DIMENSION', 'Height of the boot.', ['Shoe', 'Ankle boot', 'Mid-calf boot', 'Gumboot (knee)', 'Thigh wader']);
export const SIGN_TYPE = pick('SIGN_TYPE', 'Sign type', 'MATERIAL', 'ISO 7010 category (shape and colour).', ['Prohibition (red circle)', 'Warning (yellow triangle)', 'Mandatory (blue circle)', 'Safe condition / emergency (green)', 'Fire equipment (red square)', 'Information / text', 'Traffic sign']);
export const SIGN_TEXT = text('SIGN_MESSAGE', 'Message / symbol', 'IDENTITY', 'Text and ISO 7010 symbol code (e.g. W012 electricity).', 'W012 Danger electricity', 80);
export const SIGN_MATERIAL = pick('SIGN_MATERIAL', 'Material', 'MATERIAL', 'Substrate.', ['Rigid PVC', 'Self-adhesive vinyl', 'Aluminium', 'Photoluminescent', 'Reflective (class 1/2)', 'Correx / polypropylene']);
export const FIRST_AID_ITEM = text('FIRST_AID_ITEM', 'Item and size', 'MATERIAL', 'What it is and its size (dressing size, volume).', 'Sterile dressing 12 × 12 cm', 60);
export const EXT_AGENT = pick('EXTINGUISHING_AGENT', 'Agent', 'MATERIAL', 'Extinguishing agent. CO₂ for electrical; ABC powder general; foam for liquids; wet chemical for cooking oil.', ['ABC dry powder', 'BC dry powder', 'CO₂', 'AFFF foam', 'Water', 'Wet chemical (F class)', 'Clean agent (FM-200 / Novec)', 'D class powder']);
export const EXT_SIZE = text('EXTINGUISHER_SIZE', 'Capacity and rating', 'RATING', 'Capacity and fire rating on the label.', '9 kg, 43A 233B C', 30);

// ---------------------------------------------------------------------------------------------------------------
// Laboratory
// ---------------------------------------------------------------------------------------------------------------
export const LAB_ITEM = text('LAB_ITEM', 'Item', 'MATERIAL', 'What the item is (beaker, volumetric flask, PCR tube…).', 'Volumetric flask', 60);
export const LAB_CAPACITY = text('LAB_CAPACITY', 'Capacity / volume', 'DIMENSION', 'Nominal volume.', '250 ml; 0.2 ml', 20);
export const VOL_CLASS = pick('VOLUMETRIC_CLASS', 'Accuracy class', 'COMPLIANCE', 'Class A for analysis and calibration; class B for routine use.', ['Class A (batch certified)', 'Class A (individual certificate)', 'Class B', 'Not volumetric']);
export const LAB_GLASS = pick('LAB_MATERIAL', 'Material', 'MATERIAL', 'Labware material.', ['Borosilicate glass 3.3', 'Soda-lime glass', 'Quartz', 'Polypropylene (PP)', 'Polystyrene (PS)', 'Polyethylene (PE)', 'PET', 'PTFE / PFA', 'Polycarbonate', 'Porcelain']);
export const JOINT = text('JOINT_THREAD', 'Joint / thread', 'CONNECTION', 'Ground glass joint (NS 14/23) or screw thread (GL45, 9 mm).', 'NS 29/32; GL45', 20);
export const STERILE = pick('STERILITY', 'Sterility', 'COMPLIANCE', 'Sterilised by the maker (state method) or non-sterile.', ['Sterile (gamma)', 'Sterile (EO)', 'Sterile (steam)', 'Non-sterile', 'Autoclavable']);
export const DNASE = yes('DNASE_RNASE_FREE', 'DNase / RNase / pyrogen free', 'COMPLIANCE', 'Yes for molecular biology and cell culture.');
export const REAGENT_VALUE = text('REAGENT_SPEC', 'Value / concentration', 'RATING', 'Certified value or concentration with uncertainty.', 'pH 7.00 ± 0.01 at 25 °C; 0.1 mol/L', 40);
export const CRM_CERT = pick('REFERENCE_CERTIFICATE', 'Certificate', 'COMPLIANCE', 'CRMs should be ISO 17034 accredited; reagents need a CoA.', ['ISO 17034 CRM', 'ISO/IEC 17025 calibrated', 'Certificate of analysis', 'Traceable to NIST / PTB', 'None']);
export const MEDIA_NAME = text('MEDIUM_NAME', 'Medium / method', 'IDENTITY', 'Name of the medium or test method as in the standard.', 'Plate Count Agar (ISO 4833)', 80);
export const MEDIA_FORM = pick('MEDIUM_FORM', 'Form', 'MATERIAL', 'How it is supplied.', ['Dehydrated powder', 'Prepared plates', 'Prepared bottles / tubes', 'Ready-to-use broth', 'Dip slides', 'Rapid test cassette']);
export const TESTS_PER_KIT = int('TESTS_PER_PACK', 'Tests / units per pack', 'tests', 'PACK', 'Number of tests, strips or plates per pack.', '100', 1);
export const TEST_PARAM = text('TEST_PARAMETER', 'Parameter / analyte', 'RATING', 'What the test measures and its range.', 'Free chlorine 0–5 mg/L', 60);
export const COLUMN = text('COLUMN_SPEC', 'Column / vial specification', 'DIMENSION', 'Phase, length × ID, particle size or vial volume, thread and septum.', 'C18, 150 × 4.6 mm, 5 µm', 60);
export const FILTER_GRADE = text('FILTER_PAPER_GRADE', 'Grade / pore size', 'RATING', 'Filter grade (Whatman-equivalent) or pore size and diameter.', 'Grade 1, 125 mm; 0.45 µm PES', 40);

// ---------------------------------------------------------------------------------------------------------------
// IT & office & print
// ---------------------------------------------------------------------------------------------------------------
export const IT_ITEM = text('IT_ITEM', 'Item', 'MATERIAL', 'What it is (cable type, mouse, charger…).', 'HDMI cable', 60);
export const CABLE_VERSION = text('INTERFACE_VERSION', 'Interface / version', 'CONNECTION', 'Interface standard and version (USB 3.2 Gen 1, HDMI 2.0, DisplayPort 1.4, USB-C PD 65 W).', 'USB-C PD 65 W', 40);
export const CABLE_LENGTH = dec('CABLE_LENGTH_M', 'Cable length', 'm', 'DIMENSION', 'Length of the cable.', '2');
export const CONNECTIVITY = pick('CONNECTIVITY', 'Connectivity', 'CONNECTION', 'How it connects.', ['Wired USB-A', 'Wired USB-C', 'Wireless 2.4 GHz (dongle)', 'Bluetooth', 'Bluetooth + dongle', '3.5 mm jack', 'Not applicable']);
export const KEY_LAYOUT = pick('KEYBOARD_LAYOUT', 'Keyboard layout', 'MATERIAL', 'Layout printed on the keys.', ['US English', 'UK English', 'French AZERTY', 'Arabic / English', 'Not applicable']);
export const WATTAGE = int('WATTAGE_W', 'Power', 'W', 'RATING', 'Output power on the charger label.', '65', 1);
export const CARTRIDGE_CODE = text('CARTRIDGE_CODE', 'Cartridge / consumable code', 'IDENTITY', 'Code printed on the old cartridge or box (e.g. HP 89A CF289A, Canon 052). This is the most reliable way to order.', 'HP 89A (CF289A)', 40);
export const PRINT_COLOUR = pick('PRINT_COLOUR', 'Colour', 'MATERIAL', 'Ink or toner colour.', ['Black', 'Cyan', 'Magenta', 'Yellow', 'Tri-colour', 'Photo black', 'Matte black', 'Grey', 'Not applicable']);
export const PAGE_YIELD = int('PAGE_YIELD', 'Page yield', 'pages', 'RATING', 'Pages at 5% coverage (ISO/IEC 19752) printed on the box.', '10000');
export const PAPER_SIZE = pick('PAPER_SIZE', 'Paper size', 'DIMENSION', 'Sheet size.', ['A3 (297 × 420 mm)', 'A4 (210 × 297 mm)', 'A5 (148 × 210 mm)', 'Letter (216 × 279 mm)', 'Legal (216 × 356 mm)', 'Foolscap', 'SRA3', 'Roll', 'Custom — state in notes']);
export const REAM = int('SHEETS_PER_PACK', 'Sheets per pack / ream', 'sheets', 'PACK', 'Number of sheets per ream or pack.', '500', 1);
export const WHITENESS = int('WHITENESS_CIE', 'Whiteness (CIE)', '', 'RATING', 'Whiteness on the ream wrapper (premium paper about 160+).', '161', 0, 200);
export const PAPER_FINISH = pick('PAPER_FINISH', 'Finish / type', 'MATERIAL', 'Paper type.', ['Office copy', 'Premium laser', 'Coloured', 'Cardstock', 'Photo gloss', 'Photo matt', 'Carbonless (NCR)', 'Tracing', 'Thermal', 'Recycled', 'Bond']);
export const PAGES = int('PAGES', 'Pages / leaves', 'pages', 'DIMENSION', 'Number of pages (or leaves) printed on the cover.', '96', 1);
export const RULING = pick('RULING', 'Ruling', 'MATERIAL', 'Line pattern.', ['Ruled (feint)', 'Ruled with margin', 'Squared 5 mm', 'Squared 10 mm', 'Plain', 'Dotted', 'Graph (1 mm)', 'Music']);
export const BINDING = pick('BINDING', 'Binding', 'MATERIAL', 'How pages are held.', ['Stitched (stapled)', 'Spiral / wire', 'Hardcover sewn', 'Glued pad', 'Perfect bound', 'Loose leaf']);
export const PEN_TYPE = pick('WRITING_TYPE', 'Type', 'MATERIAL', 'Writing instrument.', ['Ballpoint pen', 'Gel pen', 'Rollerball', 'Fountain pen', 'Permanent marker', 'Whiteboard marker', 'Highlighter', 'Paint marker', 'Technical / fineliner', 'Wooden pencil', 'Mechanical pencil', 'Lead refill', 'Pen refill', 'Crayon', 'Coloured pencil', 'Chalk']);
export const TIP = text('TIP_SIZE', 'Tip / line width', 'DIMENSION', 'Tip size or line width (mm) or pencil grade.', '0.7 mm; 2–5 mm chisel; HB', 20);
export const INK_COLOUR = text('INK_COLOUR', 'Ink colour(s)', 'MATERIAL', 'Colour(s).', 'Blue; black; assorted 4', 30);
export const FILING_ITEM = pick('FILING_ITEM', 'Item', 'MATERIAL', 'Filing product.', ['Lever arch file', 'Ring binder (2-ring)', 'Ring binder (4-ring)', 'Box file', 'Manila folder', 'Suspension file', 'Document wallet', 'Expanding file', 'Clear sleeve / pocket', 'Sheet protector', 'Divider / index tabs', 'Archive box', 'Clip folder', 'Binder clip', 'Paper clip', 'File label', 'Letter tray', 'Magazine holder', OTHER]);
export const SPINE = int('SPINE_WIDTH_MM', 'Spine / capacity', 'mm', 'DIMENSION', 'Spine width or ring size (capacity).', '75', 1);
export const OFFICE_ITEM = text('OFFICE_ITEM', 'Item', 'MATERIAL', 'What it is.', 'Heavy-duty stapler', 60);
export const OFFICE_SPEC = text('OFFICE_SPEC', 'Key specification', 'RATING', 'The specification that makes it fit for use (sheet capacity, staple size, tape width × length, digits).', '24/6 staples, 30 sheets', 60);
export const ENVELOPE_SIZE = pick('ENVELOPE_SIZE', 'Envelope size', 'DIMENSION', 'ISO size: DL fits A4 folded in three; C5 = A4 folded once; C4 = flat A4.', ['DL (110 × 220)', 'C6 (114 × 162)', 'C5 (162 × 229)', 'C4 (229 × 324)', 'B4', 'Manila 10 × 15"', 'Padded / bubble', 'Courier pouch', 'Custom']);
export const CLOSURE_ENV = pick('ENVELOPE_CLOSURE', 'Closure / window', 'MATERIAL', 'Seal and window.', ['Peel & seal', 'Self-seal', 'Gummed', 'Peel & seal with window', 'Tamper-evident']);

// ---------------------------------------------------------------------------------------------------------------
// Cleaning & hygiene
// ---------------------------------------------------------------------------------------------------------------
export const CLEAN_FUNCTION = pick('CLEANING_FUNCTION', 'Cleaning function', 'MATERIAL', 'What the product is for.', ['General / neutral cleaner', 'Alkaline degreaser', 'Acid / descaler', 'Disinfectant', 'Sanitiser (food contact)', 'Hand soap', 'Hand sanitiser', 'Glass cleaner', 'Floor polish', 'Floor stripper', 'Carpet / upholstery', 'Dishwashing (manual)', 'Dishwasher detergent', 'Rinse aid', 'Laundry detergent', 'Fabric softener', 'Bleach', 'Stain remover', 'Oven / grill cleaner', 'Drain cleaner', 'Air freshener', 'Stainless steel cleaner', OTHER]);
export const SURFACE = text('SURFACE_USE', 'Surfaces / use', 'MATERIAL', 'Where it may be used (food-contact surfaces, floors, toilets).', 'Food-contact surfaces, floors', 60);
export const FRAGRANCE = text('FRAGRANCE', 'Fragrance', 'MATERIAL', 'Scent, or “unperfumed” for food areas.', 'Unperfumed', 30);
export const IMPLEMENT = text('IMPLEMENT_TYPE', 'Item', 'MATERIAL', 'What it is (mop head, floor broom, squeegee…).', 'Kentucky mop head 400 g', 60);
export const IMPLEMENT_SIZE = text('IMPLEMENT_SIZE', 'Size / width / capacity', 'DIMENSION', 'Width, weight or capacity.', '600 mm; 400 g; 20 L', 30);
export const COLOUR_CODE = pick('HYGIENE_COLOUR_CODE', 'Colour code', 'MATERIAL', 'Colour-coding prevents cross-contamination (e.g. red = toilets, blue = general, green = kitchen, yellow = clinical).', ['Red', 'Blue', 'Green', 'Yellow', 'White', 'Black', 'Not colour-coded']);
export const BRISTLE = text('BRISTLE_MATERIAL', 'Material', 'MATERIAL', 'Head, bristle or cloth material.', 'Microfibre 300 gsm; polyester bristle', 40);
export const PLY = int('PLY', 'Ply', 'ply', 'MATERIAL', 'Number of layers.', '2', 1, 6);
export const SHEETS_ROLL = text('ROLL_CONTENT', 'Sheets or length per roll', 'DIMENSION', 'Sheets per roll or metres per roll.', '300 sheets; 200 m', 30);
export const ROLLS_PACK = int('ROLLS_PER_PACK', 'Rolls / packs per case', 'pcs', 'PACK', 'How many rolls or packs in one case.', '12', 1);
export const VIRGIN = pick('FIBRE_SOURCE', 'Fibre', 'MATERIAL', 'Virgin pulp is softer; recycled is cheaper.', ['Virgin pulp', 'Recycled', 'Mixed']);
export const BAG_SIZE = text('BAG_SIZE', 'Bag size / volume', 'DIMENSION', 'Volume or dimensions.', '120 L, 900 × 1100 mm', 30);
export const BAG_GAUGE = int('BAG_THICKNESS_MICRON', 'Thickness', 'µm', 'DIMENSION', 'Film thickness (heavier for sharp or wet waste).', '40', 5, 300);
export const WASTE_COLOUR = pick('WASTE_BAG_COLOUR', 'Colour (waste stream)', 'MATERIAL', 'Colour sets the waste stream: black general, yellow infectious, red highly infectious/anatomical, clear recyclables.', ['Black', 'Yellow (infectious)', 'Red (highly infectious)', 'Blue', 'Green', 'Clear', 'White']);
export const PEST = text('TARGET_PEST', 'Target pest', 'MATERIAL', 'Pests it controls.', 'Rats and mice', 60);
export const FORMULATION = pick('FORMULATION', 'Formulation', 'MATERIAL', 'Formulation code on the label.', ['EC (emulsifiable concentrate)', 'SC (suspension concentrate)', 'SL (soluble liquid)', 'WP (wettable powder)', 'WG / WDG (water-dispersible granules)', 'GR (granules)', 'DP (dustable powder)', 'Aerosol', 'Gel bait', 'Block / pellet bait', 'ULV', 'Seed treatment (FS)']);
export const PHI = int('PRE_HARVEST_INTERVAL', 'Pre-harvest / re-entry interval', 'days', 'COMPLIANCE', 'Days between application and harvest (or safe re-entry), from the label.', '14', 0, 365);
export const WHO_CLASS = pick('TOXICITY_CLASS', 'Toxicity class (WHO)', 'COMPLIANCE', 'Hazard class on the label band colour.', ['Ia — extremely hazardous (red)', 'Ib — highly hazardous (red)', 'II — moderately hazardous (yellow)', 'III — slightly hazardous (blue)', 'U — unlikely hazardous (green)']);

// ---------------------------------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------------------------------
export const CEMENT_CLASS = pick('CEMENT_TYPE', 'Cement type and strength class', 'COMPLIANCE', 'Printed on the bag (KS EAS 18-1 / EN 197-1). CEM I 42.5 for structural concrete; CEM II/B 32.5 for blocks and plaster.', ['CEM I 42.5N', 'CEM I 42.5R', 'CEM I 52.5N', 'CEM II/A 42.5N', 'CEM II/B-P 32.5N', 'CEM II/B-L 32.5R', 'CEM IV 32.5', 'White cement', 'Masonry cement', 'Ready mortar', 'Grout (non-shrink)', 'Self-levelling compound', 'Rapid hardening', OTHER]);
export const BAG_KG = dec('BAG_WEIGHT_KG', 'Bag / unit weight', 'kg', 'PACK', 'Weight of one bag or unit.', '50');
export const AGG_TYPE = pick('AGGREGATE_TYPE', 'Aggregate', 'MATERIAL', 'Type and source.', ['River sand', 'Quarry dust / crushed sand', 'Plaster sand', 'Crushed stone (ballast)', 'Gravel', 'Hardcore', 'Murram', 'Road base', 'Sub-base', 'Rail ballast']);
export const AGG_SIZE = pick('AGGREGATE_SIZE', 'Size / grading', 'DIMENSION', 'Particle size (concrete normally 20 mm; blocks 6 mm).', ['0–2 mm', '0–4 mm', '0–5 mm', '6 mm', '10 mm', '14 mm', '20 mm', '6–20 mm graded', '40 mm', '20–40 mm', '50–100 mm (hardcore)', 'Graded per specification']);
export const SILT = dec('SILT_MAX_PCT', 'Silt / clay content (maximum)', '%', 'RATING', 'Fines allowed — high silt weakens concrete.', '5', 0, 100);
export const CONCRETE_CLASS = text('STRENGTH_CLASS', 'Strength class', 'RATING', 'Required strength: concrete class (C25/30) or block/paver strength in N/mm².', 'C25/30; 7 N/mm²', 20);
export const UNIT_DIMS = text('UNIT_DIMENSIONS', 'Size L × W × H', 'DIMENSION', 'Dimensions of one unit in mm.', '400 × 200 × 200 mm', 30);
export const HOLLOW = pick('BLOCK_TYPE', 'Type', 'MATERIAL', 'Solid or hollow; finish.', ['Solid', 'Hollow', 'Interlocking', 'Cellular', 'Face / fair-faced']);
export const SLUMP = int('SLUMP_MM', 'Slump', 'mm', 'RATING', 'Workability of ready-mix concrete.', '75', 0, 250);
export const MAX_AGG = int('MAX_AGGREGATE_MM', 'Maximum aggregate size', 'mm', 'DIMENSION', 'Largest stone in the mix.', '20', 1, 63);
export const EXPOSURE = text('EXPOSURE_CLASS', 'Exposure class', 'COMPLIANCE', 'Environment class (EN 206 XC/XD/XS) or as specified by the engineer.', 'XC3', 20);
export const REBAR_DIA = pick('REBAR_DIAMETER', 'Bar diameter', 'DIMENSION', 'Y = high-yield deformed; R = round mild steel.', ['R6', 'R8', 'Y8', 'Y10', 'Y12', 'Y16', 'Y20', 'Y25', 'Y32', 'Y40']);
export const REBAR_GRADE = pick('REBAR_GRADE', 'Grade / standard', 'COMPLIANCE', 'Steel grade on the mill certificate.', ['B500B (KS EAS 412-2 / BS 4449)', 'B500C', 'Grade 460', 'Grade 60 (ASTM A615)', 'Mild steel 250']);
export const MESH_REF = text('MESH_REFERENCE', 'Mesh reference / aperture', 'DIMENSION', 'Mesh reference (A142, A193, A252, A393) or aperture × wire diameter.', 'A142; 50 × 50 × 4 mm', 30);
export const FENCE_TYPE = pick('FENCING_TYPE', 'Fencing', 'MATERIAL', 'Fencing product.', ['Chain-link mesh', 'Weld mesh panel', 'Barbed wire', 'Razor wire (concertina)', 'Razor wire (flat wrap)', 'Electric fence wire', 'Field fence', 'Palisade', 'Fence post']);
export const WIRE_GAUGE = text('WIRE_GAUGE', 'Wire diameter / gauge', 'DIMENSION', 'Wire diameter in mm or SWG.', '2.5 mm (12 SWG)', 20);
export const COATING = pick('COATING_FINISH', 'Coating / finish', 'MATERIAL', 'Corrosion protection.', ['Galvanised', 'Heavy galvanised', 'PVC coated', 'Zinc-aluminium', 'Black / uncoated', 'Powder coated', 'Stainless']);
export const BOARD_TYPE = pick('BOARD_TYPE', 'Board / sheet type', 'MATERIAL', 'Product.', ['Plywood (interior MR)', 'Plywood (exterior WBP)', 'Marine plywood', 'Blockboard', 'MDF', 'Moisture-resistant MDF', 'Chipboard / particle board', 'OSB', 'Hardboard', 'Gypsum board (standard)', 'Gypsum board (moisture resistant)', 'Gypsum board (fire)', 'Fibre cement board', 'Timber (sawn)', 'Timber (planed)']);
export const BOARD_THICK = dec('BOARD_THICKNESS_MM', 'Thickness', 'mm', 'DIMENSION', 'Sheet or board thickness.', '18');
export const BOARD_SIZE = text('BOARD_SIZE', 'Sheet / section size', 'DIMENSION', 'Sheet size (e.g. 2440 × 1220) or timber section × length.', '2440 × 1220 mm; 50 × 100 × 4800 mm', 40);
export const PRESSURE_PN = pick('PIPE_PRESSURE_CLASS', 'Pressure class / SDR', 'RATING', 'Printed along the pipe. Higher PN = thicker wall.', ['PN 4', 'PN 6', 'PN 10', 'PN 12.5', 'PN 16', 'PN 20', 'PN 25', 'SDR 11', 'SDR 17', 'SDR 21', 'Class B (BS 3505)', 'Class C', 'Class D', 'Drainage / non-pressure']);
export const PIPE_OD = text('PIPE_SIZE', 'Pipe size', 'DIMENSION', 'Outside diameter in mm for plastic pipes, nominal bore for metal pipes.', '110 mm OD; 2" NB', 20);
export const ROOF_PROFILE = pick('ROOF_PROFILE', 'Profile', 'DIMENSION', 'Sheet profile.', ['Corrugated (wave)', 'Box profile (IT4 / IT5)', 'Trapezoidal', 'Standing seam', 'Tile profile (versatile)', 'Translucent', 'Flat sheet']);
export const ROOF_GAUGE = pick('ROOF_GAUGE', 'Gauge / thickness', 'DIMENSION', 'Steel thickness. BWG 28 ≈ 0.40 mm; BWG 30 ≈ 0.30 mm (lighter).', ['BWG 26 (0.45 mm)', 'BWG 28 (0.40 mm)', 'BWG 30 (0.30 mm)', 'BWG 32 (0.25 mm)', '0.47 mm', '0.50 mm', '0.58 mm', '0.70 mm']);
export const ROOF_COATING = pick('ROOF_COATING', 'Coating', 'MATERIAL', 'Coating on the steel.', ['Galvanised (Z)', 'Aluzinc (AZ150)', 'Pre-painted on Aluzinc', 'Pre-painted on galvanised', 'Stone-coated', 'Aluminium', 'Polycarbonate']);
export const ROOF_LENGTH = dec('SHEET_LENGTH_M', 'Sheet length', 'm', 'DIMENSION', 'Length of each sheet (cut to roof length).', '3');
export const DOOR_ITEM = pick('JOINERY_ITEM', 'Item', 'MATERIAL', 'Door, window or hardware item.', ['Door leaf (flush)', 'Door leaf (panel)', 'Steel door', 'Fire door', 'Door frame', 'Window frame', 'Hinge', 'Mortice lock', 'Cylinder (euro profile)', 'Lever handle', 'Pull handle', 'Window handle / latch', 'Door closer', 'Door stop', 'Weather strip', 'Lockset', OTHER]);
export const DOOR_SIZE = text('JOINERY_SIZE', 'Size', 'DIMENSION', 'Opening or leaf size (H × W × thickness) or hardware size.', '2040 × 826 × 44 mm; hinge 100 mm', 40);
export const HANDING = pick('HANDING', 'Handing', 'CONNECTION', 'Opening direction looking from the push side.', ['Left hand', 'Right hand', 'Reversible', 'Not applicable']);
export const FIRE_RATING = text('FIRE_RATING', 'Fire rating', 'COMPLIANCE', 'Fire resistance required (e.g. FD30, EI60, Class 0).', 'FD30', 20);
export const FINISH_TEXT = text('SURFACE_FINISH', 'Finish', 'MATERIAL', 'Surface finish or colour.', 'Satin chrome; white gloss', 30);
export const SANITARY_ITEM = pick('SANITARY_ITEM', 'Item', 'MATERIAL', 'Sanitary item.', ['WC pan (close-coupled)', 'WC pan (wall-hung)', 'Squat pan', 'Cistern', 'Flush valve', 'Wash basin', 'Kitchen sink', 'Urinal', 'Mixer tap', 'Pillar tap', 'Shower head', 'Shower mixer', 'Floor drain', 'Trap (P / S / bottle)', OTHER]);
export const SANITARY_MAT = pick('SANITARY_MATERIAL', 'Material', 'MATERIAL', 'Main material.', ['Vitreous china', 'Stainless steel 304', 'Brass, chrome plated', 'ABS / plastic', 'Cast iron', 'Solid surface']);
export const MOUNTING_SAN = pick('SANITARY_MOUNTING', 'Mounting / outlet', 'CONNECTION', 'Mounting and outlet.', ['Floor-mounted, P-trap', 'Floor-mounted, S-trap', 'Wall-hung', 'Counter-top', 'Under-counter', 'Deck-mounted', 'Wall-mounted']);
export const FLOW_LPM = dec('FLOW_RATE_LPM', 'Flow rate', 'L/min', 'RATING', 'Water flow at 3 bar (water-saving taps ≤ 6 L/min).', '6');
export const TILE_TYPE = pick('TILE_TYPE', 'Floor / wall finish', 'MATERIAL', 'Product.', ['Ceramic wall tile', 'Ceramic floor tile', 'Porcelain tile', 'Vinyl tile', 'Vinyl sheet', 'Laminate flooring', 'Carpet tile', 'Ceiling tile', 'Skirting', 'Terrazzo', 'Artificial turf']);
export const TILE_SIZE = text('TILE_SIZE', 'Tile size', 'DIMENSION', 'Size in mm (e.g. 600 × 600) and thickness.', '600 × 600 × 9 mm', 30);
export const SLIP = pick('SLIP_RATING', 'Slip resistance', 'COMPLIANCE', 'R-rating (DIN 51130): R9 dry indoor; R10–R11 wet areas and kitchens; R12–R13 industrial.', ['R9', 'R10', 'R11', 'R12', 'R13', 'Not rated']);
export const PEI = pick('PEI_CLASS', 'Wear class (PEI)', 'RATING', 'Abrasion class for glazed floor tiles: PEI 3 homes, PEI 4 commercial, PEI 5 heavy traffic.', ['PEI 1', 'PEI 2', 'PEI 3', 'PEI 4', 'PEI 5', 'Not applicable']);
export const DESIGN_CODE_TILE = text('FINISH_DESIGN_CODE', 'Colour / design code', 'IDENTITY', 'Supplier design or colour code so later orders match (also note batch/shade).', 'Grey Stone 6060 shade B', 40);
export const M2_BOX = dec('M2_PER_BOX', 'Coverage per box', 'm²', 'PACK', 'Square metres in one box.', '1.44');
export const ADH_CLASS = text('ADHESIVE_CLASS', 'Class', 'COMPLIANCE', 'Classification on the bag (tile adhesive EN 12004 C1/C2/S1; grout EN 13888 CG2).', 'C2TE S1', 20);
export const GLASS_TYPE_B = pick('GLAZING_TYPE', 'Glass type', 'MATERIAL', 'Safety glass where people can impact it.', ['Clear float', 'Tinted float', 'Toughened / tempered', 'Laminated', 'Wired', 'Mirror', 'Obscure / patterned', 'Double glazed unit']);
export const GLASS_THICK = dec('GLASS_THICKNESS_MM', 'Thickness', 'mm', 'DIMENSION', 'Glass thickness.', '6');
export const SEALANT_TYPE = pick('SEALANT_TYPE', 'Sealant type', 'MATERIAL', 'Silicone for wet areas and glazing; acrylic for paintable gaps; PU for movement joints.', ['Silicone (sanitary)', 'Silicone (neutral cure)', 'Acrylic (paintable)', 'Polyurethane', 'MS polymer', 'Fire-rated', 'Bitumen', 'Expansion joint filler board']);
export const CARTRIDGE_ML = int('CARTRIDGE_ML', 'Cartridge / pack', 'ml', 'PACK', 'Volume of one cartridge or pack.', '300', 1);
export const MEMBRANE_WP = pick('WATERPROOFING_TYPE', 'Waterproofing type', 'MATERIAL', 'System.', ['Bituminous torch-on membrane', 'Self-adhesive membrane', 'Liquid polyurethane', 'Liquid acrylic', 'Cementitious coating', 'Bitumen primer', 'HDPE / PVC sheet', 'Bitumen felt', 'Vapour barrier']);
export const MEMBRANE_THICK = dec('MEMBRANE_THICKNESS_MM', 'Thickness', 'mm', 'DIMENSION', 'Membrane thickness (or dry film thickness).', '4');
export const GEOTEXTILE = text('GEOTEXTILE_SPEC', 'Geotextile / gabion specification', 'MATERIAL', 'Type and strength (woven / non-woven, g/m², kN/m) or gabion mesh and wire.', 'Non-woven 200 g/m², 12 kN/m', 60);
export const ROLL_SIZE = text('ROLL_SIZE', 'Roll size', 'DIMENSION', 'Width × length of a roll.', '4 m × 100 m', 30);
export const BITUMEN = pick('BITUMEN_GRADE', 'Bitumen grade', 'COMPLIANCE', 'Penetration grade or emulsion type.', ['60/70 pen', '80/100 pen', 'MC-30 cut-back', 'MC-70', 'K1-60 emulsion', 'Polymer modified']);
export const ADMIXTURE = pick('ADMIXTURE_TYPE', 'Admixture type', 'MATERIAL', 'Function.', ['Plasticiser', 'Superplasticiser', 'Retarder', 'Accelerator', 'Waterproofer', 'Air entrainer', 'Curing compound']);
export const DOSAGE = text('DOSAGE', 'Dosage', 'RATING', 'Dose per 100 kg of cement or per m².', '0.8–1.2 L per 100 kg cement', 40);

// ---------------------------------------------------------------------------------------------------------------
// Agriculture
// ---------------------------------------------------------------------------------------------------------------
export const CROP = text('CROP', 'Crop / species', 'IDENTITY', 'Crop or plant species.', 'Maize; tomato; avocado', 40);
export const VARIETY = text('VARIETY', 'Variety / hybrid', 'IDENTITY', 'Variety or hybrid name on the seed pack (e.g. H614D, Anna F1, Hass).', 'H614D', 40);
export const SEED_CLASS = pick('SEED_CLASS', 'Seed class', 'COMPLIANCE', 'Certification class on the KEPHIS/official label.', ['Certified', 'Basic / foundation', 'Pre-basic', 'Hybrid F1', 'Open-pollinated (OPV)', 'Quality declared seed', 'Planting material (cuttings / vines)', 'Grafted seedling']);
export const GERMINATION = dec('GERMINATION_MIN_PCT', 'Germination (minimum)', '%', 'COMPLIANCE', 'Minimum germination on the seed label.', '90', 0, 100);
export const SEED_PURITY = dec('SEED_PURITY_PCT', 'Physical purity (minimum)', '%', 'COMPLIANCE', 'Minimum purity on the seed label.', '98', 0, 100);
export const SEED_TREATED = yes('SEED_TREATED', 'Seed treated / dressed', 'COMPLIANCE', 'Yes if dressed with fungicide or insecticide — must not be used as food or feed.');
export const SEED_PACK = text('SEED_PACK', 'Pack size', 'PACK', 'Kilograms, seed count or plants per pack/tray.', '2 kg; 1000 seeds; 50 seedlings', 30);
export const MATURITY = int('MATURITY_DAYS', 'Maturity', 'days', 'RATING', 'Days to maturity from the variety description.', '120', 1, 3650);
export const NPK = text('NUTRIENT_ANALYSIS', 'Nutrient analysis (N-P-K + others)', 'RATING', 'Analysis printed on the bag, e.g. 17-17-17, DAP 18-46-0, CAN 26% N, + S, Mg, Zn.', '23-23-0 +5S', 40);
export const FERT_FORM = pick('FERTILISER_FORM', 'Form', 'MATERIAL', 'Physical form.', ['Granular', 'Prilled', 'Powder', 'Crystalline (water-soluble)', 'Liquid', 'Pellet (organic)', 'Compost / bulk organic']);
export const ORGANIC_MATTER = dec('ORGANIC_MATTER_PCT', 'Organic matter / CaCO₃ equivalent', '%', 'RATING', 'For organic manures (organic matter) or lime (calcium carbonate equivalent).', '40', 0, 100);
export const MEDIA_TYPE = text('MEDIA_SPEC', 'Growing medium specification', 'MATERIAL', 'Type, particle grade, EC/pH and compressed block or bag size.', 'Coco peat, washed, EC < 0.5, 5 kg block', 80);
export const TARGET_CROPS = text('TARGET_CROPS', 'Registered crops / pests', 'COMPLIANCE', 'Crops and pests the product is registered for (label).', 'Tomato — late blight', 80);
export const SPECIES_STAGE = text('ANIMAL_SPECIES_STAGE', 'Animal species and stage', 'IDENTITY', 'Who it is for (species and production stage).', 'Layers 18 weeks+; dairy cattle', 60);
export const FEED_FORM = pick('FEED_FORM', 'Feed form', 'MATERIAL', 'Physical form.', ['Mash', 'Pellet', 'Crumble', 'Block / lick', 'Powder', 'Liquid', 'Extruded (floating)', 'Extruded (sinking)']);
export const ENERGY = dec('ENERGY_ME', 'Metabolisable energy', 'MJ/kg', 'RATING', 'From the feed label or analysis.', '11.5');
export const CALCIUM = dec('CALCIUM_PCT', 'Calcium', '%', 'RATING', 'From the feed label (layers need 3.5–4%).', '3.8', 0, 100);
export const MEDICATED = yes('MEDICATED_FEED', 'Medicated (contains drug)', 'COMPLIANCE', 'Yes if it contains a coccidiostat or other veterinary drug (withdrawal period applies).');
export const VACCINE = text('VACCINE_SPEC', 'Disease / strain and doses', 'RATING', 'Disease, strain, doses per vial and route.', 'Newcastle LaSota, 1000 doses, eye drop', 80);
export const STRAW = text('SEMEN_SPEC', 'Breed / sire and straw', 'IDENTITY', 'Breed, sire code, sexed or conventional and straw size.', 'Friesian, sire 11HO12345, sexed 0.25 ml', 80);
export const IRRIGATION_ITEM = pick('IRRIGATION_COMPONENT', 'Component', 'MATERIAL', 'Irrigation component.', ['Drip tape', 'Drip line (inline emitters)', 'Online emitter / dripper', 'Micro sprinkler', 'Impact sprinkler', 'Pop-up sprinkler', 'Nozzle', 'Disc filter', 'Screen filter', 'Sand / media filter', 'Valve (manual)', 'Solenoid valve', 'Pressure regulator', 'Fitting / connector', 'End cap', 'Lay-flat hose', 'Garden hose', 'Fertigation injector (venturi)', 'Fertigation tank', 'Controller / timer', 'Soil moisture probe', 'Rain sensor']);
export const IRR_SIZE = text('IRRIGATION_SIZE', 'Size', 'DIMENSION', 'Diameter (mm or inch) and wall thickness (mil) for tape.', '16 mm, 8 mil', 20);
export const EMITTER = text('EMITTER_SPEC', 'Flow and spacing', 'RATING', 'Emitter flow (L/h) and spacing (cm), or sprinkler flow and radius.', '1.6 L/h at 30 cm', 30);
export const MESH = text('MESH_SIZE', 'Mesh / filtration', 'RATING', 'Filter mesh (120 mesh ≈ 130 µm).', '120 mesh', 20);
export const FILM_UV = text('FILM_SPEC', 'Film / net specification', 'MATERIAL', 'Thickness (µm), UV stabilisation (years/seasons), shade %, colour and width × length.', '200 µm, 3-year UV, 8 × 50 m', 80);
export const AGRI_ITEM = text('AGRI_ITEM', 'Item', 'MATERIAL', 'What it is.', 'Seedling tray 128 cells', 60);

// ---------------------------------------------------------------------------------------------------------------
// Medical
// ---------------------------------------------------------------------------------------------------------------
export const MED_DEVICE = text('DEVICE_TYPE', 'Device', 'MATERIAL', 'Exact device name.', 'IV cannula with injection port', 60);
export const MED_SIZE = text('DEVICE_SIZE', 'Size', 'DIMENSION', 'Size that identifies it: syringe ml, needle/cannula gauge × length, catheter Fr/Ch, dressing cm.', '22 G × 25 mm; 16 Fr; 10 ml', 30);
export const LUER = pick('LUER', 'Connector / tip', 'CONNECTION', 'Tip type.', ['Luer lock', 'Luer slip', 'Catheter tip', 'Eccentric', 'ENFit (enteral)', 'Not applicable']);
export const SAFETY_FEATURE = yes('SAFETY_ENGINEERED', 'Safety-engineered (needle-stick protection)', 'COMPLIANCE', 'Yes if a safety mechanism is required.');
export const MED_STD = text('MEDICAL_STANDARD', 'Standard / classification', 'COMPLIANCE', 'Standard and risk class (e.g. ISO 7886-1, EN 455, Class IIa).', 'ISO 7886-1, Class IIa', 60);
export const MED_MATERIAL = pick('MEDICAL_MATERIAL', 'Material', 'MATERIAL', 'Main material.', ['Latex', 'Nitrile', 'Vinyl', 'Silicone', 'PVC', 'PVC (DEHP-free)', 'Polyurethane', 'Cotton', 'Non-woven (SMS)', 'Polypropylene', 'Stainless steel', 'Polymer (absorbable)', 'Hydrocolloid', 'Foam', 'Alginate']);
export const SUTURE = text('SUTURE_SPEC', 'Suture specification', 'RATING', 'Material, USP size, length and needle (shape, type, length).', 'Polyglactin 910, 2-0, 75 cm, 3/8 circle reverse cutting 24 mm', 120);
export const BLADE_NO = text('BLADE_SIZE', 'Blade / instrument size', 'DIMENSION', 'Blade number or instrument size (No. 10, 11, 15, 22).', 'No. 15', 20);
export const IV_SPEC = text('INFUSION_SPEC', 'Set / fluid specification', 'RATING', 'Drop factor, length, filter, or fluid name and volume.', '20 drops/ml, 150 cm; 0.9% NaCl 500 ml', 80);
export const ANALYTE_MED = text('TEST_TARGET', 'Analyte / disease', 'RATING', 'What the test detects.', 'Malaria Pf/Pan antigen', 60);
export const SAMPLE_TYPE = pick('SAMPLE_TYPE', 'Sample type', 'MATERIAL', 'Sample the test uses.', ['Whole blood (finger prick)', 'Whole blood (venous)', 'Serum / plasma', 'Urine', 'Nasal / throat swab', 'Saliva', 'Stool', 'Other']);
export const SENS_SPEC = text('SENSITIVITY_SPECIFICITY', 'Sensitivity / specificity', 'RATING', 'From the package insert.', '98% / 99%', 20);
export const WHO_PQ = text('TEST_APPROVAL', 'Approval', 'COMPLIANCE', 'WHO prequalification, PPB registration or CE-IVD.', 'WHO PQ; CE-IVD', 40);
export const DENTAL = text('DENTAL_SPEC', 'Dental specification', 'RATING', 'Shade, viscosity, ISO bur number and shank, or gauge.', 'Shade A2, flowable; ISO 806 314 001 (FG)', 80);
export const STERI_ITEM = text('STERILISATION_SPEC', 'Sterilisation item specification', 'RATING', 'Process (steam 121/134 °C, EO, plasma), indicator class (ISO 11140-1 type 1–6), size.', 'Steam 134 °C, class 5 integrator', 80);
export const ABSORBENCY_ML = int('ABSORBENCY_ML', 'Absorbency', 'ml', 'RATING', 'Absorbency level from the pack (incontinence products).', '1500', 0);

// ---------------------------------------------------------------------------------------------------------------
// Food service & kitchen
// ---------------------------------------------------------------------------------------------------------------
export const FRESH_SIZE = text('PRODUCE_GRADE', 'Size / grade / ripeness', 'RATING', 'Size class, grade and ripeness you accept (e.g. Class I, 180–220 g, breaker stage).', 'Class I, 180–220 g each, firm-ripe', 60);
export const UNIT_SALE = pick('UNIT_OF_SALE', 'Sold by', 'PACK', 'How the supplier counts it.', ['Kilogram', 'Piece', 'Bunch', 'Crate', 'Tray', 'Bag', 'Carton', 'Litre', 'Dozen']);
export const ORGANIC_CERT = yes('ORGANIC_GAP', 'Organic / GLOBALG.A.P. certified', 'COMPLIANCE', 'Yes if certification is required.');
export const MEAT_CUT = text('MEAT_CUT', 'Species, cut and bone', 'IDENTITY', 'Species, cut and whether bone-in or boneless.', 'Beef topside, boneless', 60);
export const CHILL_STATE = pick('TEMPERATURE_STATE', 'Fresh / chilled / frozen', 'PACK', 'State on delivery.', ['Fresh (ambient)', 'Chilled 0–4 °C', 'Frozen −18 °C', 'Ambient shelf-stable', 'Live']);
export const PORTION = text('PORTION_SIZE', 'Portion / piece size', 'DIMENSION', 'Weight per piece or portion range.', '150–180 g portions', 30);
export const DAIRY_TYPE = text('DAIRY_PRODUCT', 'Product and fat level', 'IDENTITY', 'Product with fat level and treatment (UHT, pasteurised).', 'UHT whole milk 3.5%', 60);
export const EGG_GRADE = pick('EGG_GRADE', 'Egg size grade', 'DIMENSION', 'Weight grade.', ['Jumbo', 'Extra large', 'Large', 'Medium', 'Small', 'Not applicable']);
export const SPICE_FORM = pick('SPICE_FORM', 'Form', 'MATERIAL', 'Form of the product.', ['Whole', 'Ground / powder', 'Flakes', 'Paste', 'Liquid / sauce', 'Cube / tablet', 'Dried leaf']);
export const COFFEE_TEA = text('BEVERAGE_GRADE', 'Grade / roast / type', 'RATING', 'Coffee grade and roast, or tea type and grade.', 'Arabica AA, medium roast, beans; black CTC BP1', 60);
export const TABLEWARE_ITEM = text('TABLEWARE_ITEM', 'Item', 'MATERIAL', 'What it is.', 'Dinner plate', 40);
export const TABLEWARE_MAT = pick('TABLEWARE_MATERIAL', 'Material', 'MATERIAL', 'Material.', ['Porcelain', 'Vitrified / hotel china', 'Stoneware', 'Tempered glass', 'Glass', 'Crystal', 'Melamine', 'Stainless steel 18/10', 'Stainless steel 18/0', 'Polycarbonate', 'Polypropylene', 'Wood / bamboo', 'Cast iron', 'Aluminium', 'Non-stick aluminium', 'Copper', 'Silicone', 'Nylon']);
export const TABLEWARE_SIZE = text('TABLEWARE_SIZE', 'Size / capacity', 'DIMENSION', 'Diameter (cm) or capacity (ml / L).', '27 cm; 350 ml; 8 L', 30);
export const COMMERCIAL_GRADE = yes('COMMERCIAL_GRADE', 'Commercial / hotel grade', 'RATING', 'Yes for catering use (chip-resistant rims, heavy gauge, NSF).');
export const DISHWASHER = yes('DISHWASHER_SAFE', 'Dishwasher safe', 'RATING', 'Yes if it must withstand commercial dishwashers.');
export const INDUCTION = yes('INDUCTION_READY', 'Induction compatible', 'RATING', 'Yes if used on induction hobs (magnetic base).');
export const GN = pick('GASTRONORM', 'Gastronorm size', 'DIMENSION', 'Standard pan size (EN 631) and depth.', ['GN 2/1', 'GN 1/1', 'GN 1/2', 'GN 1/3', 'GN 1/4', 'GN 1/6', 'GN 1/9', 'Not GN']);
export const CUTLERY_PATTERN = text('PATTERN', 'Pattern / design', 'IDENTITY', 'Pattern name so later orders match.', 'Baguette', 30);
export const KNIFE_SPEC = text('KNIFE_SPEC', 'Blade length and type', 'DIMENSION', 'Blade length and edge (plain / serrated); HACCP handle colour.', '20 cm plain, yellow handle', 40);

// ---------------------------------------------------------------------------------------------------------------
// Merchandise, textiles, sports, misc
// ---------------------------------------------------------------------------------------------------------------
export const TYRE_SIZE = text('TYRE_SIZE', 'Tyre size', 'DIMENSION', 'Size on the tyre wall (e.g. 205/55 R16, 315/80 R22.5).', '265/65 R17', 20);
export const LOAD_SPEED = text('LOAD_SPEED_INDEX', 'Load index / speed rating', 'RATING', 'Numbers and letter after the size (e.g. 112T, 156/150L).', '112T', 15);
export const TYRE_USE = pick('TYRE_APPLICATION', 'Application', 'MATERIAL', 'Use.', ['Passenger', 'SUV / 4x4 (H/T)', 'SUV / 4x4 (A/T)', 'Light truck (LT)', 'Truck steer', 'Truck drive', 'Trailer', 'Forklift (solid)', 'Forklift (pneumatic)', 'Agricultural', 'OTR / earthmover', 'Motorcycle']);
export const BATTERY_GROUP = text('BATTERY_GROUP', 'Group size / CCA', 'RATING', 'Battery size code and cold cranking amps (e.g. N70, 650 CCA).', 'N70, 650 CCA', 20);
export const WIPER = text('WIPER_SPEC', 'Length and fitting', 'DIMENSION', 'Blade length and arm fitting (hook, pin, bayonet).', '24" (600 mm) hook', 30);
export const GARMENT_ITEM = text('CLOTHING_ITEM', 'Item', 'MATERIAL', 'Garment or textile item.', 'Polo shirt', 40);
export const CLOTH_SIZE = text('CLOTHING_SIZE', 'Size', 'DIMENSION', 'Size (S–XXL, waist/length, EU shoe size, bed size).', 'L; 34/32; queen 230 × 250 cm', 30);
export const COMPOSITION = text('FABRIC_COMPOSITION', 'Fabric composition', 'MATERIAL', 'Fibre content and weight from the care label.', '100% cotton, 180 gsm', 40);
export const GENDER = pick('FIT', 'Fit', 'DIMENSION', 'Cut / fit.', ['Unisex', 'Men', 'Women', 'Boys', 'Girls', 'Children', 'Infant']);
export const LOGO = text('BRANDING_LOGO', 'Branding / embroidery', 'MATERIAL', 'Logo or embroidery and position, if any.', 'Company logo, left chest, 8 cm', 60);
export const GSM_TEXTILE = int('TEXTILE_GSM', 'Fabric weight', 'g/m²', 'MATERIAL', 'Weight of towels, linen and fabrics (higher = heavier).', '500', 1, 2000);
export const THREAD_COUNT = int('THREAD_COUNT', 'Thread count', '', 'MATERIAL', 'For sheets and pillow cases (200–400 is hotel standard).', '300', 1, 2000);
export const ELECTRONIC_SPEC = text('ELECTRONIC_SPEC', 'Key electrical specification', 'RATING', 'Capacity, output, outlets or plug type that matter (e.g. 20 000 mAh 22.5 W; 4-way 13 A type G with surge protection).', '20 000 mAh, 22.5 W PD', 80);
export const PERSONAL_CARE = text('PERSONAL_CARE_TYPE', 'Product type and variant', 'IDENTITY', 'Product type, variant or skin/hair type.', 'Anti-dandruff shampoo', 60);
export const SPORT_ITEM = text('SPORT_ITEM', 'Item and sport', 'MATERIAL', 'What it is and for which sport.', 'Football (soccer) match ball', 60);
export const SPORT_SIZE = text('SPORT_SIZE', 'Size / weight', 'DIMENSION', 'Official size, weight or length.', 'Size 5; 10 kg; 2.7 m', 20);
export const SPORT_STD = text('SPORT_APPROVAL', 'Approval / standard', 'COMPLIANCE', 'Federation approval or safety standard (FIFA Quality, ITTF, EN 71).', 'FIFA Quality Pro', 40);
export const AGE_GROUP = text('AGE_GROUP', 'Age group / level', 'DIMENSION', 'Age or level it is for.', '6–9 years; senior', 20);
export const NON_TOXIC = yes('NON_TOXIC', 'Non-toxic (EN 71-3 / ASTM D4236)', 'COMPLIANCE', 'Yes for children’s and art materials.');
export const SET_COUNT = int('COUNT_IN_SET', 'Count / colours in set', 'pcs', 'PACK', 'Number of pieces or colours.', '12', 1);
export const SEWING_ITEM = pick('SEWING_ITEM', 'Item', 'MATERIAL', 'Sewing material.', ['Sewing thread', 'Machine needle', 'Hand needle', 'Zipper', 'Button', 'Elastic', 'Fabric (roll)', 'Interfacing', 'Hook & loop tape', 'Label / tag', OTHER]);
export const SEWING_SPEC = text('SEWING_SPEC', 'Size / specification', 'DIMENSION', 'Thread ticket/tex and cone length; needle system and size (DB×1 Nm 90); zipper type, gauge and length; button size (ligne).', 'Tex 27 (ticket 120), 5000 m cone', 80);
export const SECURITY_ITEM = text('SECURITY_ITEM_SPEC', 'Specification', 'RATING', 'Technology, numbering and print (e.g. MIFARE DESFire EV2 13.56 MHz CR80 printed both sides; seal numbered, red).', 'MIFARE Classic 1K, CR80, printed', 80);
export const AVIATION_PN = text('AVIATION_PART_NUMBER', 'Aircraft part number / specification', 'IDENTITY', 'Part number (with CAGE code) or the material specification (MIL / AMS / SAE).', 'MIL-PRF-5606; MS20995C32', 60);
export const AIRWORTHY = pick('AIRWORTHINESS_RELEASE', 'Release certificate', 'COMPLIANCE', 'Every aircraft part must have an authorised release certificate.', ['EASA Form 1', 'FAA 8130-3', 'TCCA Form One', 'Certificate of conformity (consumables)']);
export const AIRCRAFT_TYPE = text('AIRCRAFT_TYPE', 'Aircraft / vessel type', 'IDENTITY', 'Aircraft, vessel or rolling stock type the item is for.', 'Cessna 208B', 60);
export const ANODE = text('ANODE_SPEC', 'Anode material and weight', 'MATERIAL', 'Zinc, aluminium or magnesium; weight and mounting.', 'Zinc, 4 kg, bolt-on', 40);
export const BOLT_SPEC = text('ROCK_BOLT_SPEC', 'Bolt specification', 'DIMENSION', 'Type, diameter × length and steel grade.', 'Resin rebar bolt Ø20 × 2.4 m, 640 MPa', 60);
export const FILAMENT = text('PRINT_MATERIAL_SPEC', 'Material specification', 'MATERIAL', 'Filament diameter and spool weight, resin volume and printer compatibility, or powder alloy and particle size.', 'PLA 1.75 mm, 1 kg; 15–45 µm Ti6Al4V', 80);
export const PV_SPEC = text('PV_COMPONENT_SPEC', 'Component specification', 'RATING', 'Rating that matters (e.g. MC4 4–6 mm² 1500 V DC; gPV 15 A 1000 V 10×38; rail length and clamp module thickness).', 'MC4, 4–6 mm², 1500 V DC', 80);
export const CELL_FORMAT = pick('CELL_FORMAT', 'Cell format', 'DIMENSION', 'Physical format.', ['Prismatic', 'Pouch', 'Cylindrical 18650', 'Cylindrical 21700', 'Cylindrical 26650', 'Cylindrical 32700', 'Module', 'Not applicable']);
export const EV_CONNECTOR = pick('EV_CONNECTOR', 'EV connector standard', 'CONNECTION', 'Connector standard on the vehicle inlet.', ['Type 1 (J1772)', 'Type 2 (IEC 62196-2)', 'CCS1', 'CCS2', 'CHAdeMO', 'GB/T AC', 'GB/T DC', 'NACS']);
export const EV_RATING = text('EV_RATING', 'Current / phases / length', 'RATING', 'Rated current, phases and cable length.', '32 A, 3-phase, 5 m', 30);
export const HOSPITALITY = text('HOSPITALITY_SPEC', 'Specification', 'RATING', 'Size/volume, branding and contents (e.g. 30 ml shampoo, hotel logo; key card MIFARE compatible with VingCard).', '30 ml bottle, hotel logo', 80);
export const PET = text('PET_SPEC', 'Species and size', 'IDENTITY', 'Animal and life stage, size or weight.', 'Adult dog, 15 kg bag', 40);
export const CANDLE = text('CEREMONIAL_SPEC', 'Specification', 'RATING', 'Size, burn time, colour, or flag size.', 'Pillar 7 × 15 cm, 40 h, white', 60);
export const WOOD_ITEM = text('ITEM_DESCRIPTION', 'Item specification', 'MATERIAL', 'The specification that tells this item apart (type, size, material).', 'Stainless steel 50 L bucket', 120);

// Aliases so existing catalogue attributes are reused instead of duplicated
alias(METAL_GRADE, ['material grade', 'grade', 'alloy', 'material grade or chemical composition']);
alias(DIMENSIONS_TEXT, ['dimensions']);
alias(PURITY_PCT, ['purity', 'purity or assay']);
alias(PARTICLE, ['particle size']);
alias(CAS, ['cas number', 'cas registry number']);
alias(PHYS_FORM, ['physical form']);
alias(ASSAY, ['concentration']);
alias(FLASH_C, ['flash point']);
alias(MFI, ['melt flow index']);
alias(IV_PET, ['intrinsic viscosity']);
alias(MOISTURE, ['moisture content']);
alias(SHELF_LIFE_DAYS, ['shelf life days', 'shelf life']);
alias(STORAGE_TEMP, ['storage condition', 'storage conditions']);
alias(ALLERGENS, ['allergen declaration']);
alias(ACTIVE, ['active ingredient']);
alias(STRENGTH, ['strength']);
alias(DOSAGE_FORM, ['dosage form']);
alias(REG_NUMBER, ['regulatory registration number']);
alias(PAGE_YIELD, ['declared page yield']);
alias(PRINT_COLOUR, ['print color']);
alias(COMPATIBLE_WITH, ['compatible printer models', 'device compatibility', 'compatibility or application']);
alias(FOOD_CONTACT, ['food contact approved', 'food contact compliance', 'food contact suitability']);
alias(INDUCTION, ['induction compatible']);
alias(DISHWASHER, ['dishwasher safe']);
alias(HALAL, ['halal']);
alias(EX_CERT, ['ex certification']);
alias(PKG_MATERIAL, ['packaging material']);
alias(CAPACITY_ML, ['nominal capacity']);
alias(PKG_COLOUR, ['colour']);
alias(PIPE_OD, ['nominal diameter', 'nominal pipe diameter', 'nominal size']);

export const INGREDIENTS = def('INGREDIENTS', { name: 'Ingredients / composition', dataType: 'text', domain: 'COMPLIANCE', description: 'Ingredient list in descending order as on the label or specification sheet.', example: 'Wheat flour, sugar, vegetable fat, salt', validation: { maxLength: 400 }, aliases: ['ingredient composition'] });

// ---------------------------------------------------------------------------------------------------------------
// Late additions
// ---------------------------------------------------------------------------------------------------------------
export const SHEET_WIDTH = dec('ITEM_WIDTH_MM', 'Width', 'mm', 'DIMENSION', 'Width of the sheet, strip, coil, roll or item, from the label or drawing, or measured.', '1250');
export const LENGTH_MM = dec('LENGTH_MM', 'Length', 'mm', 'DIMENSION', 'Length of the item, bar or sheet as ordered (stock length), from the label or drawing.', '6000');
export const CAPACITY_L = dec('CAPACITY_L', 'Capacity', 'L', 'DIMENSION', 'Volume the container holds, from the drawing or label.', '200');
export const TAPE_SPEC = text('TAPE_SPEC', 'Tape width × length and adhesive', 'DIMENSION', 'Width × length on the roll core, and adhesive type (acrylic, hot-melt, rubber).', '48 mm × 66 m, acrylic', 40);
export const ROPE_MATERIAL = pick('ROPE_FIBRE', 'Rope material', 'MATERIAL', 'Fibre of the rope.', ['Polypropylene', 'Polyester', 'Nylon (polyamide)', 'HMPE (Dyneema)', 'Manila / sisal', 'Mixed / combination']);
export const BATTERY_ITEM = text('BATTERY_ACCESSORY', 'Battery accessory specification', 'MATERIAL', 'What it is and its specification (e.g. distilled water 5 L; terminal grease 100 g; separator sheet size).', 'Battery water, deionised, 5 L', 80);
export const OTHER_SPEC = text('MAIN_SPECIFICATION', 'Main specification', 'RATING', 'The one or two figures that identify this item to a supplier (size, capacity, rating).', '50 L; 1.2 m; 12 V 7 Ah', 80);
export const UNCLASSIFIED_REASON = text('REVIEW_REASON', 'Why it is not yet classified', 'IDENTITY', 'Explain what the item is and why no catalogue entry fits, so the catalogue team can classify it.', 'New laboratory reagent not in the catalogue', 300);

alias(LENGTH_MM, ['length', 'overall length']);
alias(SHEET_WIDTH, ['width']);

// Existing catalogue names for the same value (keeps one field per value on each entry).
alias('MEMS.SWITCHING_OUTPUT', ['output signal']);
alias('MEMS.AC3_CURRENT_A', ['rated current']);
alias('MEMS.CABLE_VOLTAGE_RATING', ['rated voltage']);
for (const c of ['MEMS.FLOW_PRINCIPLE', 'MEMS.LEVEL_PRINCIPLE', 'MEMS.SENSOR_TECHNOLOGY', 'MEMS.GAS_SENSOR_TECH']) alias(c, ['sensing principle']);
alias('MEMS.TABLEWARE_MATERIAL', ['tableware material', 'food contact material']);
alias('MEMS.LAB_MATERIAL', ['glass material']);
alias('MEMS.STORAGE_CAPACITY', ['nominal capacity']);
alias('MEMS.CAPACITY_L', ['nominal capacity']);
alias('MEMS.PACK_SIZE', ['package size', 'package volume', 'net weight']);
alias('MEMS.SDS_ON_FILE', ['safety data sheet reference']);
for (const c of ['MEMS.CHEMICAL_GRADE', 'MEMS.RESIN_GRADE', 'MEMS.RUBBER_GRADE', 'MEMS.STEEL_GRADE']) alias(c, ['material grade']);
alias('MEMS.STERILITY', ['sterile']);
alias('MEMS.DISPOSABLE', ['single use']);
alias('MEMS.GENERIC_NAME', ['active ingredient']);
alias('MEMS.ANIMAL_SPECIES_STAGE', ['target species']);
alias('MEMS.BAG_WEIGHT_KG', ['net weight']);
alias('MEMS.SPORT_ITEM', ['sport or activity']);
alias('MEMS.PIPE_PRESSURE_CLASS', ['wall thickness', 'pressure class']);
alias('MEMS.HOSE_ID', ['nominal diameter']);
alias('MEMS.PIPE_MATERIAL', ['body material']);
for (const c of ['MEMS.PORT_SIZE', 'MEMS.VALVE_INTERFACE']) alias(c, ['nominal size']);
alias('MEMS.NOMINAL_SIZE', ['nominal thread diameter']);
// Ranges the catalogue already keeps as a minimum and a maximum field.
for (const c of ['MEMS.SUPPLY_VOLTAGE']) aliasSet(c, ['supply voltage minimum', 'supply voltage maximum']);
for (const c of ['MEMS.MEASURING_RANGE', 'MEMS.RANGE', 'MEMS.GAS_RANGE', 'MEMS.DISTANCE_RANGE', 'MEMS.CLEANLINESS_RANGE']) {
    aliasSet(c, ['range minimum', 'range maximum']);
    aliasSet(c, ['flow range minimum', 'flow range maximum']);
    aliasSet(c, ['minimum temperature', 'maximum temperature']);
}
aliasSet('MEMS.FILTER_DIMENSIONS', ['element diameter', 'element length']);
