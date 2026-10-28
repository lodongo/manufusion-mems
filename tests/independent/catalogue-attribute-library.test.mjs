import test from 'node:test';
import assert from 'node:assert/strict';
import {
    archetypes, libraryAttributes, libraryAttribute, matchArchetype, enrichmentFor, enrichCatalogue, stripLibrary, LIB_SOURCE,
} from '../../backend/catalogueAttributeLibrary.ts';

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._ /-]{0,59}$/;
const TYPES = ['text', 'integer', 'decimal', 'boolean', 'date', 'enum', 'multi_select', 'country', 'currency', 'file'];

test('Every library attribute is a valid catalogue attribute with plain guidance', () => {
    const attrs = libraryAttributes();
    assert.ok(attrs.length > 250, 'library is comprehensive');
    for (const a of attrs) {
        assert.match(a.code, CODE_RE, a.code);
        assert.ok(TYPES.includes(a.dataType), a.code);
        assert.ok(a.name.length >= 2 && a.name.length <= 160, a.code);
        assert.ok(a.description.length >= 40 && a.description.length <= 2000, a.code + ' needs guidance');
        if (a.dataType === 'enum' || a.dataType === 'multi_select') {
            assert.ok(a.options?.length, a.code + ' options');
            const codes = a.options.map((o) => o.code);
            assert.equal(new Set(codes).size, codes.length, a.code + ' duplicate option codes');
            for (const c of codes) assert.ok(c.length > 0 && c.length <= 60, a.code + ' option ' + c);
        }
    }
});

test('Every equipment type references existing attributes and has mandatory fields and guidance', () => {
    for (const a of archetypes()) {
        for (const code of [...a.required, ...a.optional, ...a.specific]) assert.ok(libraryAttribute(code), a.id + ' → ' + code);
        assert.ok(a.required.length >= 2, a.id + ' must say what is mandatory');
        assert.ok(a.guidance.length > 20, a.id + ' guidance');
        for (const s of a.specific) assert.ok(a.required.includes(s) || a.optional.includes(s), a.id + ' short-text attribute ' + s);
    }
    const ids = archetypes().map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('Items are recognised specifically, including names that contain other equipment words', () => {
    const cases = [
        ['materials', 'Electric motor 7.5 kW 4-pole', 'MOTOR'],
        ['materials', 'Three phase induction motor', 'MOTOR'],
        ['materials', 'Helical gear motor', 'GEARMOTOR'],
        ['materials', 'Motor bearing 6308', 'BEARING'],
        ['materials', 'Motor starter DOL 11 kW', 'CONTACTOR'],
        ['materials', 'Motor oil 15W-40', 'OIL'],
        ['materials', 'Deep groove ball bearing', 'BEARING'],
        ['materials', 'Pillow block bearing UCP208', 'BEARING_HOUSING'],
        ['materials', 'Concentric reducer DN100', 'PIPE_FITTING'],
        ['materials', 'Worm gear reducer', 'GEARBOX'],
        ['materials', 'MIG wire ER70S-6', 'WELDING'],
        ['materials', 'Power cable 4C x 16', 'CABLE'],
        ['materials', 'Cable tie 300 mm', 'MRO_GENERIC'],
        ['materials', 'Wiring harness', 'MRO_GENERIC'],
        ['materials', 'Oil seal 40x62x8', 'OIL_SEAL'],
        ['materials', 'Mechanical seal for pump', 'MECH_SEAL'],
        ['materials', 'Hydraulic oil HLP 68', 'OIL'],
        ['materials', 'Hydraulic hose 2SN', 'HOSE'],
        ['materials', 'Oil filter element', 'FILTER'],
        ['materials', 'V-belt SPB 2000', 'VBELT'],
        ['materials', 'V-belt pulley SPB', 'PULLEY'],
        ['materials', 'Timing belt 8M', 'TIMING_BELT'],
        ['materials', 'Hex bolt M12x50', 'FASTENER'],
        ['materials', 'Screw pump', 'PD_PUMP'],
        ['materials', 'Centrifugal pump end suction', 'PUMP'],
        ['materials', 'Pump impeller', 'MRO_GENERIC'],
        ['materials', 'Bearing bracket', 'MRO_GENERIC'],
        ['materials', 'Pump base plate', 'MRO_GENERIC'],
        ['materials', 'Motor cable gland', 'MRO_GENERIC'],
        ['materials', 'Fan guard', 'MRO_GENERIC'],
        ['materials', 'Valve repair kit', 'MRO_GENERIC'],
        ['materials', 'Socket head cap screw M8', 'FASTENER'],
        ['materials', 'Motor mounting bolt M16', 'FASTENER'],
        ['materials', 'Bearing housing SNL 516', 'BEARING_HOUSING'],
        ['materials', 'Ball valve 2"', 'VALVE'],
        ['materials', 'Solenoid valve 5/2', 'SOLENOID_VALVE'],
        ['materials', 'Proximity sensor M18', 'PROXIMITY'],
        ['materials', 'Variable frequency drive', 'VFD'],
        ['materials', 'Miniature circuit breaker', 'BREAKER'],
        ['materials', 'Grease lithium complex', 'GREASE'],
        ['materials', 'Safety boots', 'PPE'],
        ['assets', 'Electric motor', 'MOTOR'],
        ['assets', 'Boiler feed pump', 'PUMP'],
        ['assets', 'Steam boiler', 'BOILER'],
        ['assets', 'Diesel generator set', 'GENSET'],
        ['assets', 'Electric chain hoist', 'CRANE'],
        ['assets', 'Counterbalance forklift', 'FORKLIFT'],
        ['assets', 'Belt conveyor', 'CONVEYOR'],
        ['assets', 'Air-cooled chiller', 'HVAC'],
        ['services', 'Motor rewinding', 'SVC_REWIND'],
        ['services', 'Calibration of pressure gauges', 'SVC_CALIBRATION'],
        ['services', 'Annual maintenance contract', 'SVC_PM_CONTRACT'],
        ['services', 'Crane inspection and load test', 'SVC_LIFTING'],
        ['services', 'Gearbox overhaul', 'SVC_REPAIR'],
        ['services', 'Hazardous waste disposal', 'SVC_WASTE'],
    ];
    for (const [kind, item, id] of cases) assert.equal(matchArchetype(kind, { item }).id, id, kind + ': ' + item);
});

test('Hierarchy names are used when the item name is generic', () => {
    assert.equal(matchArchetype('materials', { item: 'Standard item 01', family: 'Rolling bearings' }).id, 'BEARING');
    assert.equal(matchArchetype('assets', { item: 'Unit A', family: 'Air compressors' }).id, 'COMPRESSOR');
    assert.equal(matchArchetype('materials', { item: 'Base plate 40', family: 'Centrifugal pumps' }).id, 'MRO_GENERIC', 'a part does not inherit the machine ratings');
});

test('A motor gets everything that tells one motor from another, with the ratings mandatory', () => {
    const e = enrichmentFor('materials', { item: 'Electric motor' }, []);
    const names = e.add.map((c) => libraryAttribute(c).name);
    for (const n of ['Rated power', 'Rated voltage', 'Frequency', 'Number of poles (speed)', 'Frame size', 'Mounting arrangement', 'Ingress protection (IP rating)', 'Efficiency class', 'Drive-end bearing', 'Manufacturer / brand', 'Manufacturer part number (MPN)'])
        assert.ok(names.includes(n), 'missing ' + n);
    const required = e.required.map((c) => libraryAttribute(c).name);
    assert.ok(required.includes('Rated power') && required.includes('Frame size') && required.includes('Efficiency class'));
    assert.ok(!required.includes('Drive-end bearing'), 'details stay optional');
    assert.ok(e.archetype.guidance.includes('nameplate'));
    assert.deepEqual(e.archetype.supply.usual, ['OCM', 'GENERAL']);
});

test('Attributes the catalogue already has are reused (no duplicates) and can become mandatory', () => {
    const e = enrichmentFor('materials', { item: 'Electric motor' }, [{ code: 'ATT-01', name: 'Brand' }, { code: 'ATT-02', name: 'Power (kW)' }, { code: 'ATT-03', name: 'IP rating' }]);
    assert.ok(!e.add.some((c) => libraryAttribute(c).name === 'Manufacturer / brand'));
    assert.ok(!e.add.some((c) => libraryAttribute(c).name === 'Rated power'));
    assert.ok(e.required.includes('ATT-02') && e.required.includes('ATT-03'), 'existing power and IP become mandatory');
});

test('Assets always require maker and model; enrichment is lossless for export', () => {
    const attributes = new Map([['ATT-1', { code: 'ATT-1', name: 'Asset tag' }]]);
    const domains = [];
    const entry = { code: 'AC-1', name: 'Centrifugal pump', attributes: ['ATT-1'], requiredAttributes: ['ATT-1'] };
    const original = structuredClone(entry);
    assert.equal(enrichCatalogue('assets', attributes, domains, [entry], () => ({})), 1);
    const names = entry.requiredAttributes.map((c) => attributes.get(c)?.name);
    assert.ok(names.includes('Manufacturer / brand') && names.includes('Model / type designation') && names.includes('Rated flow'));
    assert.ok(entry.attributes.includes('ATT-1') && entry.requiredAttributes.includes('ATT-1'), 'existing kept');
    assert.ok(attributes.get('MEMS.FLOW_M3H').source === LIB_SOURCE);
    assert.ok(domains.some((d) => d.code === 'MEMS.LIB.RATING'));
    assert.equal(enrichCatalogue('assets', attributes, domains, [entry], () => ({})), 0, 'idempotent');
    const restored = stripLibrary(entry);
    assert.deepEqual(restored.attributes, original.attributes);
    assert.deepEqual(restored.requiredAttributes, original.requiredAttributes);
    assert.equal(restored.libraryArchetype, undefined);
});

test('Services say who may do the work (OEM, OEM-authorised, specialist, general)', () => {
    const e = enrichmentFor('services', { item: 'Compressor overhaul' }, []);
    const provider = libraryAttribute('MEMS.PROVIDER_TYPE');
    assert.ok(e.required.includes('MEMS.PROVIDER_TYPE'));
    assert.deepEqual(provider.options.map((o) => o.code), ['OEM', 'OEM_AUTH', 'SPECIALIST', 'GENERAL']);
});
