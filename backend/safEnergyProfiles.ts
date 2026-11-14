// Equipment energy profile schemas. Values describe installed equipment; never imply isolation or authorization.
export type EnergyField={code:string;label:string;kind:'number'|'select'|'text';required:boolean;unit?:string;options?:string[];min?:number;when?:{field:string;values:string[]};whenAll?:{field:string;values:string[]}[]};
export type EnergyTest={code:string;label:string;critical:boolean;conditional?:boolean;reference?:string;when?:{field:string;values:string[]};whenAll?:{field:string;values:string[]}[]};
export type EnergyProfile={fields:EnergyField[];tests:EnergyTest[]};
const n=(code:string,label:string,unit:string,required=true,min=0):EnergyField=>({code,label,kind:'number',unit,required,min});
const t=(code:string,label:string,required=true):EnergyField=>({code,label,kind:'text',required});
const s=(code:string,label:string,options:string[],required=true):EnergyField=>({code,label,kind:'select',options,required});
const check=(code:string,label:string,conditional=false):EnergyTest=>({code,label,critical:true,conditional});
const ifField=(field:EnergyField,code:string,values:string[]):EnergyField=>({...field,when:{field:code,values}});
const ifTest=(test:EnergyTest,code:string,values:string[]):EnergyTest=>({...test,when:{field:code,values}});
const modes=['Present','Not installed — justified by design','Unknown — investigate'];
const commonFields:EnergyField[]=[
 t('location','Physical location / equipment boundary'),t('source_id','Supply, circuit or equipment reference'),
 s('isolation_device','Isolation device type',['Lockable disconnect','Circuit breaker suitable for isolation','Lockable valve','Blank / blind / physical disconnection','Mechanical blocking or restraint','Dedicated isolation equipment','Other engineered arrangement','Not identified — investigate']),
 t('isolation_ref','Isolation point ID / procedure or drawing reference'),t('residual_energy','Stored or residual energy and reaccumulation considerations'),t('basis','Applicable standard, OEM or site examination reference')
];
const commonTests=[check('isolation_inspection','Isolation point identification and condition inspection'),check('energy_verification','Energy control / verification method review')];
const earthing=['TN-S','TN-C','TN-C-S','TT','IT','SELV','PELV','Protectively separated','Other documented arrangement','Unknown — investigate'];
const electrical:EnergyProfile={fields:[
 s('supply','Supply type',['AC','DC','AC and DC','Pulsed / variable frequency','Induced / backfeed','Unknown — investigate']),
 n('voltage','Nominal voltage','V',true,0.001),n('current','Rated current','A',true,0.001),s('phase','AC configuration',['Single phase','Split phase','Three phase — three wire','Three phase — four wire','Three phase — other','DC / not applicable','Unknown — investigate']),
 ifField(n('frequency','Nominal frequency','Hz'),'supply',['AC','AC and DC','Pulsed / variable frequency']),
 s('earthing','System earthing / grounding arrangement',earthing),s('protective_earth','Protective earthing / equipotential bonding',modes),
 t('earth_ref','Earthing / bonding design or conductor reference'),
 ifField(t('earth_exception','Approved design justification for no protective earthing'),'protective_earth',['Not installed — justified by design']),s('overcurrent','Overcurrent protection',['Fuse','MCB','MCCB','ACB','Protective relay','Electronic protection','Other engineered protection','Not fitted — justified by design','Unknown — investigate']),
 t('protection_rating','Protection device ID, ratings and settings'),
 s('rcd','Earth leakage / residual current protection',['RCD / RCCB','RCBO','Earth leakage relay','Ground fault relay','Insulation monitoring device','Not fitted — justified by design','Unknown — investigate']),
 ifField(t('rcd_setting','Earth leakage / ground fault device ID and settings'),'rcd',['RCD / RCCB','RCBO','Earth leakage relay','Ground fault relay','Insulation monitoring device']),
 ifField(t('rcd_exception','Approved design justification for no earth leakage / residual current protection'),'rcd',['Not fitted — justified by design']),
 t('fault_rating','Fault level / equipment short-circuit rating or engineering reference'),t('shock_arc','Shock / arc exposure assessment reference or documented applicability')
 ],tests:[check('electrical_visual','Electrical installation visual inspection'),check('protective_continuity','Protective conductor / bonding continuity',true),check('insulation','Insulation resistance / insulation verification',true),check('earth_electrode','Earth electrode / earthing system resistance',true),check('loop','Earth fault loop impedance / automatic disconnection verification',true),check('polarity','Polarity verification',true),
 ifTest(check('phase_sequence','Phase sequence / rotation verification'),'phase',['Three phase — three wire','Three phase — four wire','Three phase — other']),
 ifTest(check('earth_leakage','Earth leakage / RCD / ground fault protective function test'),'rcd',['RCD / RCCB','RCBO','Earth leakage relay','Ground fault relay','Insulation monitoring device']),
 check('protection_test','Protective device / functional safety verification'),check('arc_review','Shock / arc hazard assessment review',true)]};
const mechanical:EnergyProfile={fields:[s('motion','Motion / stored energy type',['Rotary','Linear','Reciprocating','Spring / tension','Torsion','Counterbalance','Combined']),n('speed','Maximum operating speed','rpm or m/s',false),t('speed_unit','Speed unit / travel range',false),n('mass','Moving or stored mass','kg',false),n('force','Rated force / tension','N',false),n('torque','Rated torque','N·m',false),t('energy_rating','Maximum credible stored energy / design basis'),s('guard','Guarding / access protection',['Fixed guard','Interlocked guard','Presence sensing','Engineered barrier','Combination','Unknown — investigate']),t('restraint','Braking, restraint, blocking and residual motion reference')],tests:[check('guard_test','Guarding / interlock functional assessment'),check('restraint_test','Braking / mechanical restraint inspection'),check('mechanical_condition','Mechanical integrity and stored energy control inspection')]};
const gravity:EnergyProfile={fields:[n('mass','Maximum elevated / suspended mass','kg'),n('height','Maximum elevation / travel','m'),t('load_capacity','Support / lifting capacity and design reference'),s('restraint_type','Mechanical support or restraint',['Rated mechanical pin','Rated blocking / stand','Engineered support','Fixed structural support','Other approved system','Not identified — investigate']),t('restraint','Restraint and safe load position reference')],tests:[check('support_inspection','Supports / restraints integrity inspection'),check('lifting_examination','Lifting equipment / structural examination',true),check('gravity_control','Gravity energy-control review')]};
const fluids:EnergyProfile={fields:[t('medium','Fluid / gas and composition'),n('operating_pressure','Normal operating pressure','bar(g)',true,-1.1),n('design_pressure','Maximum allowable pressure','bar(g)',true,-1.1),n('temperature','Operating temperature','°C',true,-273.15),n('volume','Stored volume','L',false),n('flow','Rated flow','L/min',false),s('relief','Pressure protection',['Relief valve','Safety valve','Burst disc','Pressure switch / limiter','Combination','Not installed — justified by design','Unknown — investigate']),t('relief_ref','Pressure protection ID, settings and design basis'),s('residual_control','Residual pressure / energy control',['Engineered drain and vent','Accumulator discharge / isolation','Mechanical restraint','Physical isolation','Combination','Other engineered system','Not identified — investigate']),t('pressure_boundary','Pressure boundary, isolation and examination scheme reference')],tests:[check('leak_test','Leakage / pressure boundary condition inspection'),check('pressure_examination','Pressure equipment / written scheme examination',true),check('relief_test','Pressure protective device functional / certification test',true),check('gauge_test','Pressure gauge / instrument calibration',true),check('residual_test','Residual pressure control verification')]};
const chemical:EnergyProfile={fields:[t('chemical','Chemical / substance identification and CAS or product reference'),t('sds','Current SDS and revision reference'),s('state','Physical state',['Liquid','Gas','Solid','Dust / powder','Mixture','Aerosol']),n('quantity','Maximum inventory','quantity'),s('quantity_unit','Inventory unit',['kg','t','L','m³','Nm³','Other documented unit']),t('concentration','Concentration / purity and composition'),t('hazard_class','GHS hazard classification / incompatibilities'),n('temperature','Maximum process temperature','°C',false,-273.15),t('containment','Containment, segregation, ventilation and emergency control reference'),t('reaction','Credible reaction, ignition and residual energy assessment')],tests:[check('sds_review','SDS / chemical compatibility review'),check('containment_test','Containment / leakage inspection'),check('chemical_controls','Ventilation, detection and protective control verification',true),check('ignition_review','Ignition / static / explosion protection review',true)]};
const thermal:EnergyProfile={fields:[s('thermal_type','Thermal energy type',['Hot surface','Hot liquid','Hot gas / steam','Molten material','Radiant heat','Residual heat','Cryogenic / cold','Refrigerant','Combined']),n('temperature','Maximum credible temperature','°C',true,-273.15),n('min_temperature','Minimum credible temperature','°C',false,-273.15),n('power','Rated thermal power','kW',false),n('quantity','Thermal medium quantity','quantity',false),t('quantity_unit','Quantity unit',false),t('thermal_medium','Medium / material and heat source'),t('temperature_limits','Approved safe operating limits and thermal protection reference'),t('thermal_controls','Insulation, guarding, cooling and residual thermal energy reference')],tests:[check('thermal_guard','Thermal guarding / insulation condition inspection'),check('temperature_test','Temperature sensor / limiter verification',true),check('thermal_control_test','Thermal energy control / cooling verification')]};
const radiation:EnergyProfile={fields:[s('radiation_type','Radiation / field type',['Laser','Ultraviolet','X-ray','Sealed radioactive source','Microwave','Induction / electromagnetic','Radiofrequency','Other documented type']),t('source_rating','Source power / activity, units and source class'),t('wavelength','Frequency / wavelength / isotope and units'),t('limits','Approved exposure limits / exclusion boundaries reference'),t('license','Authorization / regulatory licence or applicability reference'),t('shield','Shielding, enclosure, access control and interlock reference')],tests:[check('radiation_survey','Radiation / field exposure survey'),check('radiation_guard','Shielding and access interlock verification'),check('radiation_instrument','Monitoring instrument calibration',true),check('license_review','Regulatory authorization and source accountability review',true)]};
const specialized:EnergyProfile={fields:[t('energy_rating','Maximum credible energy, quantity, units and design basis'),t('system_type','System classification / OEM model'),t('limits','OEM / engineering safe operating limits'),t('special_guard','Specialized containment / guarding and emergency controls'),t('authority','Competent technical authority and approved procedure reference')],tests:[check('special_inspection','Specialized equipment integrity examination'),check('special_protection','Engineered protective function verification'),check('special_authority','Competent authority / regulatory examination review')]};
const extras:Record<string,EnergyProfile>={
 'SAF_03_01_003':{fields:[t('switchgear','Switchgear / feeder designation'),t('switching','Approved HV switching, earthing and interlock reference')],tests:[check('relay_test','Protection relay / trip circuit verification'),check('hv_earthing','HV earthing and switching interlock inspection')]},
 'SAF_03_01_004':{fields:[n('generator_kva','Generator rating','kVA'),t('transfer','Transfer switch / anti-backfeed arrangement'),t('fuel','Fuel type and storage reference')],tests:[check('transfer_test','Transfer / anti-backfeed protection test'),check('generator_test','Generator protection and emergency stop verification')]},
 'SAF_03_01_005':{fields:[n('ups_kva','UPS apparent power','kVA'),n('battery_v','Battery string nominal voltage','V'),t('bypass','UPS bypass, stored energy and backfeed arrangement')],tests:[check('ups_test','UPS bypass / backfeed protection verification'),check('battery_test','Battery condition / protection test')]},
 'SAF_03_01_006':{fields:[s('battery_type','Battery chemistry',['Lead acid','Lithium ion','Nickel cadmium','Nickel metal hydride','Other']),n('battery_capacity','Rated capacity','Ah'),n('strings','Number of strings','count'),t('battery_protection','Battery isolation, BMS and thermal protection reference')],tests:[check('battery_test','Battery condition / protection test')]},
 'SAF_03_01_007':{fields:[n('capacitance','Capacitance','µF'),n('stored_j','Maximum stored energy','J'),t('discharge','Approved discharge and verification reference')],tests:[check('discharge_test','Discharge circuit / stored-energy verification')]},
 'SAF_03_01_008':{fields:[n('pv_kw','PV rated power','kW'),n('voc','Maximum open-circuit DC voltage','V'),t('pv_isolation','String isolation and generation / backfeed reference')],tests:[check('pv_test','PV isolation and protective function verification')]},
 'SAF_03_01_009':{fields:[n('power','Rated power','kW'),n('dc_bus','DC link voltage','V'),t('discharge','DC link stored energy and approved verification reference')],tests:[check('drive_test','Drive isolation / stored energy and protection verification')]},
 'SAF_03_01_010':{fields:[n('power','Rated motor / drive power','kW'),n('dc_bus','DC link voltage','V'),t('discharge','DC link discharge and safe torque / isolation reference')],tests:[check('drive_test','Drive isolation / protective safety function verification')]},
 'SAF_03_01_011':{fields:[t('alternate','Alternative supply and backfeed route')],tests:[check('backfeed_test','Alternative supply isolation / backfeed controls verification')]},
 'SAF_03_01_012':{fields:[t('induction','Adjacent source / induced voltage assessment')],tests:[check('induction_test','Induced energy controls verification')]},
 'SAF_03_02_001':{fields:[n('shaft_rpm','Maximum shaft speed','rpm'),n('shaft_torque','Rated shaft torque','N·m')],tests:[]},
 'SAF_03_02_002':{fields:[n('inertia','Rotational inertia','kg·m²'),n('flywheel_rpm','Maximum flywheel speed','rpm')],tests:[]},
 'SAF_03_02_003':{fields:[n('belt_speed','Maximum belt speed','m/s'),n('conveyor_load','Maximum load','kg')],tests:[]},
 'SAF_03_02_004':{fields:[n('robot_payload','Maximum payload','kg'),t('robot_zone','Robot work envelope and safe access reference')],tests:[check('robot_safety','Robot protective stop / safeguarding verification')]},
 'SAF_03_02_005':{fields:[n('spring_force','Maximum spring force','N'),n('spring_travel','Compression / extension travel','mm')],tests:[]},
 'SAF_03_04_001':{fields:[n('precharge','Accumulator precharge pressure','bar(g)'),n('acc_volume','Accumulator nominal volume','L')],tests:[check('accumulator_test','Accumulator precharge / integrity examination',true)]},
 'SAF_03_05_002':{fields:[n('receiver_volume','Receiver volume','L')],tests:[check('receiver_exam','Air receiver examination / certification')]},
 'SAF_03_06_001':{fields:[n('steam_capacity','Rated steam generation','kg/h'),t('boiler_scheme','Boiler examination / statutory certificate reference')],tests:[check('boiler_exam','Boiler statutory examination'),check('low_water','Low-water / burner protective system verification')]},
 'SAF_03_06_006':{fields:[t('cylinder_serial','Cylinder serial / certification reference'),n('cylinder_volume','Cylinder water capacity','L')],tests:[check('cylinder_exam','Cylinder periodic examination / certification')]},
 'SAF_03_07_003':{fields:[t('dust_data','Combustible dust characterization / explosion data reference')],tests:[check('dust_explosion','Dust explosion protection assessment')]},
 'SAF_03_07_007':{fields:[n('battery_v','Battery nominal voltage','V'),n('battery_wh','Rated stored energy','Wh'),t('bms','Battery management / thermal runaway controls')],tests:[check('battery_test','Battery management / protection inspection')]},
 'SAF_03_08_008':{fields:[t('refrigerant','Refrigerant identification / charge'),n('refrigerant_kg','Refrigerant charge','kg')],tests:[check('refrigerant_leak','Refrigerant leak detection / integrity examination')]},
 'SAF_03_09_001':{fields:[s('laser_class','Laser classification',['1','1M','1C','2','2M','3R','3B','4','Other / unknown — investigate']),n('laser_power','Rated output power','W')],tests:[check('laser_test','Laser enclosure / interlock and safety inspection')]},
 'SAF_03_09_004':{fields:[t('isotope','Radionuclide and source serial'),n('activity','Source activity','Bq')],tests:[check('source_test','Sealed source leak test / accountability',true)]},
 'SAF_03_10_001':{fields:[n('jet_pressure','Maximum water jet pressure','bar(g)'),n('jet_flow','Maximum water flow','L/min')],tests:[check('jet_test','Hose, nozzle and protective control inspection')]},
 'SAF_03_10_004':{fields:[n('voltage','Nominal voltage','V'),n('capacitance','Capacitance','F'),n('stored_j','Stored energy','J'),t('discharge','Approved stored energy discharge reference')],tests:[check('discharge_test','Stored electrical energy verification')]},
};
const exactFields:Record<string,EnergyField[]>={
 'SAF_03_01_001':[t('breaker_circuit','Incoming supply circuit / distribution board ID'),t('cable_rating','Supply cable size, type and rating')],
 'SAF_03_01_002':[t('dc_source','DC source, polarity and return path reference')],
 'SAF_03_02_006':[n('belt_tension','Maximum belt tension','N')],
 'SAF_03_02_007':[n('counterweight_mass','Counterweight mass','kg'),n('counterweight_travel','Travel','m')],
 'SAF_03_02_008':[n('cable_tension','Maximum cable tension','N')],
 'SAF_03_02_009':[n('torsional_torque','Maximum stored torsional torque','N·m')],
 'SAF_03_02_010':[t('moving_element','Moving element, direction and full travel range')],
 'SAF_03_03_001':[t('suspension','Suspension and lifting point identification')],
 'SAF_03_03_002':[t('platform','Platform supports and mechanical locking reference')],
 'SAF_03_03_003':[t('component_support','Elevated component support and potential movement')],
 'SAF_03_03_004':[n('stack_height','Maximum stack height','m'),t('stack_stability','Stacking stability and restraint design')],
 'SAF_03_03_005':[n('incline','Conveyor inclination','°'),t('rollback','Rollback prevention and brake reference')],
 'SAF_03_03_006':[n('counterbalance_mass','Counterbalance mass','kg'),t('counterbalance','Counterbalance restraint and travel')],
 'SAF_03_04_002':[n('pump_kw','Pump motor rating','kW')],
 'SAF_03_04_003':[t('hose_rating','Hose pressure rating / identification')],
 'SAF_03_04_004':[n('cylinder_bore','Cylinder bore','mm'),n('stroke','Cylinder stroke','mm')],
 'SAF_03_04_005':[n('press_force','Maximum press force','kN')],
 'SAF_03_04_006':[n('lift_load','Maximum lifting load','kg')],
 'SAF_03_05_001':[t('header_branch','Air header and branch isolation point reference')],
 'SAF_03_05_006':[t('air_tool','Air tool model, supply and permitted operating range')],
 'SAF_03_05_003':[n('cylinder_bore','Cylinder bore','mm'),n('stroke','Cylinder stroke','mm')],
 'SAF_03_05_004':[n('spring_load','Maximum supported load','kg')],
 'SAF_03_05_005':[t('fail_position','Fail position and actuator reference')],
 'SAF_03_06_002':[t('steam_class','Steam pipe class, condensate and trap arrangement')],
 'SAF_03_06_003':[t('condensate','Condensate return, temperature and flash steam considerations')],
 'SAF_03_06_004':[t('vessel_serial','Vessel serial / examination record'),n('vessel_volume','Vessel volume','L')],
 'SAF_03_06_005':[t('hot_water','Hot water circuit and expansion protection reference')],
 'SAF_03_06_007':[t('process_gas','Process gas header and branch isolation reference')],
 'SAF_03_07_001':[t('flash_point','Flash point and flammability classification from SDS')],
 'SAF_03_07_002':[t('flammable_gas','Gas classification and detection reference')],
 'SAF_03_07_004':[t('oxidizer','Oxidizer classification and compatibility basis')],
 'SAF_03_07_005':[t('reactivity','Reactivity and incompatible material review')],
 'SAF_03_07_006':[t('exotherm','Reaction heat and process thermal protection basis')],
 'SAF_03_07_008':[t('hydrogen','Hydrogen storage and gas detection reference')],
 'SAF_03_08_001':[t('furnace','Furnace heat source and burner / heater protection')],
 'SAF_03_08_002':[t('oven','Oven heat source and overtemperature protection')],
 'SAF_03_08_003':[n('tank_volume','Tank volume','L'),t('tank_heating','Tank heating circuit reference')],
 'SAF_03_08_004':[t('hot_surface','Accessible surface and exposure boundary')],
 'SAF_03_08_005':[t('molten','Molten material and containment design basis')],
 'SAF_03_08_006':[t('cooling_time','Approved cooling time / verification basis')],
 'SAF_03_10_002':[t('initiator','Licensed specialist system identification and authorization')],
 'SAF_03_10_003':[t('pyro_system','Licensed pyrotechnic system identification and authorization')],
 'SAF_03_10_005':[t('propulsion','Propulsion system type and energy source reference')],
 'SAF_03_06_008':[n('vacuum_rating','Maximum differential pressure','bar')],
 'SAF_03_08_007':[t('cryogen','Cryogen and oxygen displacement assessment')],
 'SAF_03_09_002':[n('uv_power','Rated UV output','W')],
 'SAF_03_09_003':[n('tube_voltage','Tube rating','kV'),n('tube_current','Tube current','mA')],
 'SAF_03_09_005':[n('microwave_power','Rated output','W')],
 'SAF_03_09_006':[n('induction_power','Rated input','kW')],
 'SAF_03_09_007':[n('rf_power','Rated output','W')],
};
export function energyProfile(code:string):EnergyProfile{
 const family=code.split('_')[2];
 const base=({'01':electrical,'02':mechanical,'03':gravity,'04':fluids,'05':fluids,'06':fluids,'07':chemical,'08':thermal,'09':radiation,'10':specialized} as Record<string,EnergyProfile>)[family]||specialized;
 const extra=extras[code]||{fields:[],tests:[]};
 // Defaults retain stable code mappings even when labels are renamed.
 let fields=[...commonFields,...base.fields,...extra.fields,...(exactFields[code]||[])];
 if(code==='SAF_03_01_002'||code==='SAF_03_01_006'||code==='SAF_03_01_007'||code==='SAF_03_01_008')fields=fields.map(f=>f.code==='supply'?{...f,options:['DC','Pulsed / variable frequency','Unknown — investigate']}:f);
 if(code==='SAF_03_01_001')fields=fields.map(f=>f.code==='supply'?{...f,options:['AC','Unknown — investigate']}:f.code==='phase'?{...f,options:f.options?.filter(x=>!x.startsWith('DC'))}:f);
 return {fields:[...new Map(fields.map(f=>[f.code,f])).values()],tests:[...new Map([...commonTests,...base.tests,...extra.tests].map(x=>[x.code,x])).values()]};
}
export function applies(field:{when?:{field:string;values:string[]};whenAll?:{field:string;values:string[]}[]},values:Record<string,unknown>){return [...(field.when?[field.when]:[]),...(field.whenAll||[])].every(w=>w.values.includes(String(values[w.field]??'')));}
export function validDay(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function configuredField(f:EnergyField,value:unknown){if(f.kind==='number')return typeof value==='number'&&Number.isFinite(value)&&value>=(f.min??0);if(typeof value!=='string'||!value.trim()||value.length>1000)return false;return f.kind!=='select'||!!f.options?.includes(value);}
export function configurationIssues(profile:EnergyProfile,values:Record<string,unknown>,tests:Record<string,unknown>,today:string):string[]{
 const issues:string[]=[];
 if(values.supply==='AC'&&values.phase==='DC / not applicable'||values.supply==='DC'&&typeof values.phase==='string'&&values.phase!=='DC / not applicable')issues.push('Supply type and phase configuration disagree');
 for(const f of profile.fields.filter(f=>applies(f,values))){const v=values[f.code];if(f.required&&!configuredField(f,v))issues.push(f.label);else if(typeof v==='string'&&/unknown|not identified/i.test(v))issues.push(f.label+' — unresolved');}
 for(const test of profile.tests.filter(t=>applies(t,values))){
  const x=tests[test.code] as Record<string,unknown>|undefined;
  if(!x){issues.push(test.label+' — missing');continue;}
  if(x.result==='not_applicable'&&test.conditional&&typeof x.justification==='string'&&x.justification.trim().length>=20&&typeof x.tester==='string'&&x.tester.trim()&&!!x.basis&&typeof x.evidenceToken==='string'&&x.evidenceToken)continue;
  if(x.result!=='pass'||!validDay(String(x.lastDate||''))||!validDay(String(x.nextDue||''))||String(x.lastDate)>today||String(x.nextDue)<=String(x.lastDate)||String(x.nextDue)<today||!x.tester||!x.basis||!x.measurement||!x.evidenceToken)issues.push(test.label+' — missing, failed or overdue evidence');
 }
 return issues;
}
