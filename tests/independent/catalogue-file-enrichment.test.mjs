// Catalogue files carry their own type-specific attributes and set-up guidance (tools/catalogue/enrich.ts).
// The app reads them as uploaded: no attributes are added at read time and exports return the file unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enrichCatalogue, TYPES } from '../../tools/catalogue/enrich.ts';
import { checkCatalogueFile } from '../../backend/procurement.ts';
import { checkAssetDictionaryFile } from '../../backend/assets.ts';
import { catalogueGuidance } from '../../backend/catalogueGuidance.ts';

const DATE = '2026-10-28';
const clone = (x) => JSON.parse(JSON.stringify(x));

function materialsFile() {
    return {
        catalogType: 'materials',
        schemaVersion: '5.2.0',
        attributeDomains: [{ code: 'TECH', name: 'Technical' }, { code: 'UID', name: 'Identity' }],
        attributes: [
            { code: 'AT-UID-001', name: 'Applicable technical standard', dataType: 'text', domain: 'UID', description: 'Applicable technical standard technical specification' },
            { code: 'AT-RATED-POWER', name: 'Rated Power', dataType: 'decimal', unit: 'kW', domain: 'TECH', description: 'Rated Power technical specification' },
            { code: 'AT-BORE', name: 'Bore Diameter', dataType: 'decimal', unit: 'mm', domain: 'TECH', description: 'Bore Diameter technical specification' },
        ],
        profiles: [],
        categories: [{ code: 'MAT-005', name: 'MRO spares' }],
        subcategories: [{ code: 'MAT-005-S008', name: 'Electrical', categoryCode: 'MAT-005' }, { code: 'MAT-005-S001', name: 'Bearings', categoryCode: 'MAT-005' }],
        families: [{ code: 'MAT-005-S008-F001', name: 'Motors', subcategoryCode: 'MAT-005-S008' }, { code: 'MAT-005-S001-F001', name: 'Rolling bearings', subcategoryCode: 'MAT-005-S001' }],
        materials: [
            { code: 'MAT-005-S008-F001-N001', name: 'Three Phase Induction Motor', categoryCode: 'MAT-005', subcategoryCode: 'MAT-005-S008', familyCode: 'MAT-005-S008-F001', attributes: ['AT-UID-001', 'AT-RATED-POWER'], requiredAttributes: ['AT-UID-001'], accounting: { glResolution: { mappingStatus: 'reference_proposed' } } },
            { code: 'MAT-005-S001-F001-N001', name: 'Deep Groove Ball Bearing', categoryCode: 'MAT-005', subcategoryCode: 'MAT-005-S001', familyCode: 'MAT-005-S001-F001', attributes: ['AT-UID-001', 'AT-BORE'], requiredAttributes: ['AT-UID-001', 'AT-BORE'] },
        ],
    };
}

test('materials: specific attributes become mandatory, existing ones are reused and placeholders relaxed', () => {
    const before = materialsFile();
    const file = clone(before);
    const report = enrichCatalogue('materials', file, TYPES.materials, { date: DATE });
    assert.equal(report.fallback.length, 0);
    assert.deepEqual(report.unresolved, []);
    const motor = file.materials[0];
    const names = (codes) => codes.map((c) => file.attributes.find((a) => a.code === c).name);
    // The existing "Rated Power" attribute is reused — never a second power field on the same entry.
    assert.ok(motor.requiredAttributes.includes('AT-RATED-POWER'));
    const lower = names(motor.attributes).map((n) => n.toLowerCase());
    assert.equal(new Set(lower).size, lower.length, 'no duplicate field names on one entry');
    assert.ok(names(motor.requiredAttributes).some((n) => /voltage/i.test(n)), 'voltage is mandatory for a motor');
    // The generic placeholder stays on the entry but is no longer mandatory.
    assert.ok(motor.attributes.includes('AT-UID-001'));
    assert.ok(!motor.requiredAttributes.includes('AT-UID-001'));
    assert.equal(motor.setupGuidance.id, 'MOTOR');
    assert.ok(motor.setupGuidance.supply.usual.length > 0);
    assert.ok(motor.setupGuidance.madeOptional.includes('Applicable technical standard'));
    // Bearing keeps its own bore field mandatory.
    assert.ok(file.materials[1].requiredAttributes.includes('AT-BORE'));
    // Finance and other fields are untouched.
    assert.deepEqual(motor.accounting, before.materials[0].accounting);
    // New attributes follow the file's code scheme and every attribute now has a plain description.
    for (const a of file.attributes) {
        assert.match(a.code, /^AT-[A-Z0-9-]+$/);
        assert.ok(!/technical specification$/i.test(a.description), `${a.code} still has a generic description`);
    }
    const check = checkCatalogueFile('materials', file);
    assert.deepEqual(check.errors, []);
});

test('services: provider route and technical specifics are added; commercial mandatory fields are kept', () => {
    const file = {
        catalogType: 'services',
        attributeDomains: ['SCP', 'COM', 'TEC', 'CTR', 'QAC', 'HSE', 'PLN', 'LOC', 'RES'].map((code) => ({ code, name: code })),
        attributes: [
            { code: 'SA-COM-001', key: 'pricing_basis', name: 'Pricing Basis', dataType: 'enum', domain: 'COM', inputControl: 'dropdown', description: 'How the service is priced.', options: [{ code: 'FIXED_FEE', label: 'Fixed fee' }] },
            { code: 'SA-TEC-006', key: 'equipment_identification', name: 'Equipment Identification', dataType: 'text', domain: 'TEC', inputControl: 'text', description: 'Equipment Identification for this service. Free text.' },
            { code: 'SA-SCP-009', key: 'work_extent', name: 'Work Extent', dataType: 'enum', domain: 'SCP', inputControl: 'dropdown', description: 'Work Extent for this service. Choose one option.', options: [{ code: 'FULL_OVERHAUL', label: 'Full overhaul' }] },
        ],
        profiles: [],
        categories: [{ code: 'SMR', name: 'Maintenance' }],
        subcategories: [{ code: 'SMR-REQ', name: 'Rotating equipment', categoryCode: 'SMR' }],
        families: [{ code: 'SMR-REQ-PMN', name: 'Pump maintenance', subcategoryCode: 'SMR-REQ' }],
        services: [{ code: 'SMR-REQ-PMN-001', name: 'Centrifugal Pump Overhaul', categoryCode: 'SMR', subcategoryCode: 'SMR-REQ', familyCode: 'SMR-REQ-PMN', attributes: ['SA-COM-001', 'SA-TEC-006', 'SA-SCP-009'], requiredAttributes: ['SA-COM-001'], specificAttributes: ['SA-TEC-006'] }],
    };
    enrichCatalogue('services', file, TYPES.services, { date: DATE });
    const svc = file.services[0];
    assert.equal(svc.setupGuidance.id, 'PUMP_REPAIR');
    assert.ok(svc.setupGuidance.providers.usual.includes('SPECIALIST'));
    assert.ok(svc.requiredAttributes.includes('SA-COM-001'), 'existing commercial mandatory field kept');
    assert.ok(svc.requiredAttributes.includes('SA-TEC-006'), 'equipment identification reused and mandatory');
    assert.ok(svc.specificAttributes.includes('SA-TEC-006'));
    for (const a of file.attributes) {
        assert.match(a.code, /^SA-[A-Z]{3}-\d{3}$/);
        assert.ok(a.key && a.inputControl, `${a.code} has key and input control`);
        assert.ok(!/for this service\. (Yes or no|Free text|Choose one option)\.$/.test(a.description), `${a.code} still generic`);
    }
    assert.deepEqual(checkCatalogueFile('services', file).errors, []);
});

test('assets: equipment needs maker, model and serial; land does not', () => {
    const idn = (code, name) => ({ code, key: name.toLowerCase().replace(/[^a-z]+/g, '_'), name, dataType: 'text', domain: 'IDN', inputControl: 'text', description: name + '.' });
    const file = {
        dictionaryName: 'MEMS Universal Asset Master Dictionary',
        version: '2.2.0',
        attributeDomains: [{ code: 'IDN', name: 'Identity' }, { code: 'FLD', name: 'Fluid' }, { code: 'LND', name: 'Land' }, { code: 'MNT', name: 'Maintenance' }],
        attributes: [
            idn('ATT-IDN-001', 'Asset name'), idn('ATT-IDN-003', 'Manufacturer'), idn('ATT-IDN-004', 'Model or product identifier'), idn('ATT-IDN-005', 'Serial or registration number'),
            { code: 'ATT-FLD-001', key: 'rated_flow', name: 'Rated flow', dataType: 'decimal', unit: 'm³/h', domain: 'FLD', inputControl: 'number', description: 'Rated flow.' },
            { code: 'ATT-LND-001', key: 'land_area', name: 'Land area', dataType: 'decimal', unit: 'ha', domain: 'LND', inputControl: 'number', description: 'Land area.' },
        ],
        profiles: [],
        groups: [{ code: 'ME', name: 'Mechanical' }, { code: 'LP', name: 'Land' }],
        categories: [{ code: 'ME-PMP', name: 'Pumps', groupCode: 'ME' }, { code: 'LP-LND', name: 'Land', groupCode: 'LP' }],
        subcategories: [{ code: 'ME-PMP-CEN', name: 'Centrifugal', categoryCode: 'ME-PMP' }, { code: 'LP-LND-PAR', name: 'Parcels', categoryCode: 'LP-LND' }],
        assetClasses: [
            { code: 'ME-PMP-CEN-001', name: 'End-Suction Centrifugal Pump', groupCode: 'ME', categoryCode: 'ME-PMP', subcategoryCode: 'ME-PMP-CEN', attributes: ['ATT-IDN-001', 'ATT-IDN-003', 'ATT-IDN-004', 'ATT-IDN-005', 'ATT-FLD-001'], requiredAttributes: ['ATT-IDN-001'] },
            { code: 'LP-LND-PAR-001', name: 'Industrial Plot', groupCode: 'LP', categoryCode: 'LP-LND', subcategoryCode: 'LP-LND-PAR', attributes: ['ATT-IDN-001', 'ATT-LND-001'], requiredAttributes: ['ATT-IDN-001'] },
        ],
    };
    enrichCatalogue('assets', file, TYPES.assets, { date: DATE });
    const [pump, land] = file.assetClasses;
    for (const c of ['ATT-IDN-003', 'ATT-IDN-004', 'ATT-IDN-005', 'ATT-FLD-001']) assert.ok(pump.requiredAttributes.includes(c), c);
    assert.ok(pump.setupGuidance.providers.usual.length > 0);
    assert.ok(!land.requiredAttributes.includes('ATT-IDN-005'), 'land has no serial number');
    assert.ok(land.requiredAttributes.includes('ATT-LND-001'));
    assert.deepEqual(checkAssetDictionaryFile(file).errors, []);
});

test('guidance from the file is sanitised before it reaches the screen', () => {
    const g = catalogueGuidance({ setupGuidance: { id: 'MOTOR', label: 'Electric motor', guidance: 'x'.repeat(5000), supply: { usual: ['OEM', 'HACK'], usualLabels: ['OEM — maker'], note: 'n' } } });
    assert.equal(g.guidance.length, 1200);
    assert.deepEqual(g.supply.usual, ['OEM']);
    assert.equal(catalogueGuidance({}), null);
    assert.equal(catalogueGuidance({ setupGuidance: { label: '', guidance: 'g' } }), null);
});

test('the app no longer adds attributes at read time', () => {
    for (const f of ['backend/procurement.ts', 'backend/assets.ts']) {
        const src = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
        assert.ok(!/catalogueAttributeLibrary|enrichCatalogue|stripLibrary|LIB_SOURCE/.test(src), f);
        assert.ok(/catalogueGuidance\(c\)/.test(src), f + ' reads guidance from the file');
    }
});
