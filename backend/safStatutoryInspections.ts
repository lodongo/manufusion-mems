// Recognized examination reference catalogue. Applicability and interval depend on jurisdiction and equipment scope.
// Standards are not automatically law. Every candidate requires a competent applicability decision.
import {energyProfile,type EnergyProfile,type EnergyTest,type EnergyField} from './safEnergyProfiles';
import {AST_UTILITY_ITEMS} from './astUtilityDefaults';
import type {Obj} from './core';
const entry=(code:string,label:string,category:string,reference:string,description:string)=>({code,label,category,subcategory:'Formal examination / verification',reference,description:reference+' — '+description,active:true,selectable:true});
export const STATUTORY_INSPECTIONS=[
 entry('SI-EL-01','Electrical installation periodic verification','Electrical','IEC 60364-6; applicable national electrical law','Formal installation verification report, covering applicable tests and defects.'),
 entry('SI-EL-02','Protective earthing / bonding continuity','Electrical','IEC 60364-6; national electrical verification rules','Document continuity results within the formal verification scope.'),
 entry('SI-EL-03','Insulation resistance verification','Electrical','IEC 60364-6; national electrical verification rules','Applicable circuits and documented verification results.'),
 entry('SI-EL-04','Earth electrode / grounding resistance','Electrical','IEC 60364-6; national electrical verification rules','Where required for the installation earthing arrangement.'),
 entry('SI-EL-05','Earth fault loop / automatic disconnection verification','Electrical','IEC 60364-6; national electrical verification rules','Where applicable to protection arrangement.'),
 entry('SI-EL-06','Earth leakage / residual current protection verification','Electrical','IEC 60364-6; national electrical verification rules','Applicable installed RCD or ground-fault protection; formal report, not routine push-button check.'),
 entry('SI-EL-07','Polarity and phase sequence verification','Electrical','IEC 60364-6; national electrical verification rules','As applicable to installation and circuit configuration.'),
 entry('SI-EL-08','High-voltage installation / protective system examination','Electrical','IEC 61936-1; applicable national HV regulations','Formal examination when required by the installation regime.'),
 entry('SI-EL-10','Lightning protection system formal verification','Electrical','IEC 62305-3; applicable national lightning protection law','Formal inspection of installed systems where the equipment or site is in scope.'),
 entry('SI-EL-09','Hazardous-area electrical installation inspection','Electrical','IEC 60079-17; applicable explosion protection law','Formal Ex inspection when classified area scope applies.'),
 entry('SI-PR-01','Pressure system written scheme examination','Pressure systems','UK PSSR 2000; applicable national pressure equipment law','Qualifying vessels, pipework and protective devices covered by approved examination scheme.'),
 entry('SI-PR-02','Steam boiler statutory examination','Pressure systems','Kenya OSHA 2007; UK PSSR 2000','Boiler and fittings; formal report by authorized examiner.'),
 entry('SI-PR-03','Steam receiver statutory examination','Pressure systems','Kenya OSHA 2007; UK PSSR 2000','Qualifying receiver and fittings.'),
 entry('SI-PR-04','Air receiver statutory examination','Pressure systems','Kenya OSHA 2007; UK PSSR 2000; US OSHA 1910.169','Qualifying receiver; scope depends on jurisdiction.'),
 entry('SI-PR-05','Pressure vessel statutory examination','Pressure systems','UK PSSR 2000; applicable national pressure vessel law','Qualifying vessels, including refrigerant systems if in scope.'),
 entry('SI-PR-06','Pressure protective device examination','Pressure systems','UK PSSR 2000 written scheme; applicable pressure equipment law','Safety valves and protective devices within statutory examination scope.'),
 entry('SI-PR-07','Transportable gas cylinder periodic examination','Pressure systems','Applicable transportable pressure equipment / cylinder law; ADR where applicable','Regulated cylinder requalification and test certificate.'),
 entry('SI-PR-08','Regulated pipeline / process pipework examination','Pressure systems','UK PSSR 2000; applicable pipeline safety law','Only regulated pipeline or pipework within examination scheme.'),
 entry('SI-LF-01','Lifting equipment thorough examination','Lifting','UK LOLER reg. 9; Kenya OSHA 2007; US OSHA 1910.179 where applicable','Qualifying hoists, cranes and lifting equipment.'),
 entry('SI-LF-02','Lifting accessories thorough examination','Lifting','UK LOLER reg. 9; Kenya OSHA 2007','Qualifying slings, chains, shackles and lifting accessories.'),
 entry('SI-LF-03','Personnel lift / hoist thorough examination','Lifting','UK LOLER reg. 9; applicable national lift legislation','Qualifying equipment used to lift people.'),
 entry('SI-FR-01','Firefighting appliances formal inspection / test','Fire','Kenya Fire Risk Reduction Rules 2007 r.30; applicable local fire law','Firewater and suppression appliances within statutory scope.'),
 entry('SI-FR-02','Fire suppression cylinder periodic examination','Fire','Kenya Fire Risk Reduction Rules 2007 r.30; applicable cylinder law','Regulated fire suppression cylinders.'),
 entry('SI-FR-03','Fire detection and alarm formal inspection','Fire','Kenya Fire Risk Reduction Rules 2007 r.28; applicable local fire law','Fire detection appliances within statutory scope.'),
 entry('SI-RD-01','Radiation source / installation regulatory inspection','Radiation','IAEA GSR Part 3; national radiation licensing conditions','Formal regulator or qualified expert examination as required by licence.'),
 entry('SI-RD-02','Sealed radioactive source leak test','Radiation','IAEA GSR Part 3; national licence conditions','Only applicable sealed sources and approved intervals.'),
 entry('SI-RD-03','Radiation protection survey / exposure verification','Radiation','IAEA GSR Part 3; national radiation rules','Formal exposure or shielding verification required by applicable regime.'),
 entry('SI-CH-01','Regulated hazardous substance / explosion protection inspection','Chemical and explosion','Applicable national hazardous substance legislation; UK DSEAR where applicable','Formal inspection required by applicable law, not routine chemical checks.'),
 entry('SI-CH-02','Regulated fuel storage / gas installation examination','Chemical and explosion','Applicable petroleum, gas storage and installation legislation','Formal licence / inspection report where required.'),
 entry('SI-EN-01','Regulated discharge / emissions compliance monitoring','Environmental','Applicable environmental permit and national regulation','Only when the equipment connection is included in the legal monitoring scope.'),
 entry('SI-EN-02','Regulated water quality / abstraction compliance verification','Environmental','Applicable drinking water, water abstraction and public health rules','Only formal required monitoring within permit or legal scope.'),
 entry('SI-CH-03','Local exhaust ventilation statutory thorough examination and test','Chemical and explosion','UK COSHH reg. 9; applicable national exposure-control law','Formal LEV examination for equipment in legal scope.'),
 entry('SI-SP-01','Specialist regulated system examination','Specialized','Applicable national specialist equipment licensing and inspection law','Specific legal duty and competent authority must be identified.'),
];
export const utilityDefinition=(code:string)=>AST_UTILITY_ITEMS.find(x=>x.code===code);
const utilityGroup=(code:string)=>code.split('-')[1]||'';
export function utilityPointId(row:Record<string,unknown>):string{return 'utility-'+String(row.code)+'-'+String(row.connectionId||'legacy-'+row.code);}
export function utilityEnergyFamily(code:string):string{
 const g=utilityGroup(code);
 if(g==='01'||g==='02'||g==='28')return '01';
 if(['08','09'].includes(g))return '05';
 if(['11','12','13','17','18','19'].includes(g))return '07';
 if(g==='24')return code==='UTL-24-004'?'02':'04';
 if(['05','14','15','16','27'].includes(g))return '08';
 if(g==='25')return 'signal';
 if(g==='29')return code==='UTL-29-003'?'03':'02';
 if(code==='UTL-31-001')return 'signal';
 if(g==='21'||code==='UTL-31-005')return '06';
 if(g==='30')return '09';
 return '06';
}
export function candidateInspectionCodes(code:string):string[]{
 const utility=code.startsWith('UTL-'), g=utility?utilityGroup(code):code.split('_')[2],family=utility?utilityEnergyFamily(code):g;
 const out=new Set<string>();
 const add=(...codes:string[])=>codes.forEach(x=>out.add(x));
 if(family==='01'){add('SI-EL-01','SI-EL-02','SI-EL-03','SI-EL-04','SI-EL-05','SI-EL-06','SI-EL-07','SI-EL-08','SI-EL-09','SI-EL-10');}
 if(['04','05','06'].includes(family)||utility&&['05','14','15','16','27'].includes(g)){add('SI-PR-01','SI-PR-05','SI-PR-06','SI-PR-08');}
 if(utility&&['06','07'].includes(g)||code==='SAF_03_06_001'||code==='SAF_03_06_002')add('SI-PR-02','SI-PR-03');
 if(utility&&['08','09'].includes(g)||code==='SAF_03_05_002')add('SI-PR-04');
 if(utility&&['10','11','16','26','27'].includes(g)||code==='SAF_03_06_006')add('SI-PR-07');
 if(['02','03','04'].includes(family))add('SI-LF-01','SI-LF-02','SI-LF-03');
 if(family==='07'||utility&&['10','11','12','13','16','17','18','19','27','32'].includes(g))add('SI-CH-01','SI-CH-02');
 if(utility&&(g==='21'||code==='UTL-31-005'))add('SI-CH-03');
 if(family==='09')add('SI-RD-01','SI-RD-02','SI-RD-03');
 if(utility&&['03','04','22','23','26','31','33'].includes(g))add('SI-EN-01','SI-EN-02');
 if(utility&&(code==='UTL-26-001'||code==='UTL-26-002'||['UTL-31-002','UTL-31-003','UTL-31-004'].includes(code)))add('SI-FR-01');
 if(code==='UTL-26-002')add('SI-FR-02');
 if(code==='UTL-31-001')add('SI-FR-03');
 if(family==='10'||utility&&['26','27','30','31'].includes(g))add('SI-SP-01');
 return [...out];
}
const reviewFields:EnergyField[]=[
 {code:'legal_jurisdiction',label:'Applicable country / jurisdiction',kind:'text',required:true},
 {code:'legal_review',label:'Competent applicability review — authority, legal references and examination scope (include exclusions)',kind:'text',required:true},
];
export function statutoryProfile(code:string,adopted:ReadonlySet<string>,utilityAttrs:string[]=[]):EnergyProfile{
 const linked=code.startsWith('UTL-');
 const family=linked?utilityEnergyFamily(code):'';
 const specific:Record<string,string>={
 'UTL-01-001':'SAF_03_01_001','UTL-01-002':'SAF_03_01_001','UTL-01-003':'SAF_03_01_010',
 'UTL-02-001':'SAF_03_01_002','UTL-02-002':'SAF_03_01_005','UTL-02-003':'SAF_03_01_004','UTL-02-004':'SAF_03_01_008',
 'UTL-28-001':'SAF_03_01_003','UTL-28-002':'SAF_03_01_003','UTL-28-003':'SAF_03_01_005','UTL-28-004':'SAF_03_01_004','UTL-28-005':'SAF_03_01_006','UTL-28-006':'SAF_03_01_011',
 'UTL-16-001':'SAF_03_08_008','UTL-16-002':'SAF_03_08_008','UTL-16-003':'SAF_03_08_008','UTL-16-004':'SAF_03_08_007',
 'UTL-24-001':'SAF_03_04_002','UTL-29-001':'SAF_03_02_001','UTL-29-002':'SAF_03_02_003','UTL-29-003':'SAF_03_03_001',
 'UTL-30-001':'SAF_03_09_001','UTL-30-002':'SAF_03_09_007','UTL-30-003':'SAF_03_09_004'
 };
 const base=energyProfile(linked?(specific[code]||'SAF_03_'+(family==='signal'?'10':family)+'_000'):code);
 let fields=base.fields;
 if(linked){
  const common=['location','source_id','isolation_device','isolation_ref','residual_energy','basis'];
  const supplyField=fields.find(f=>f.code==='supply'),phaseField=fields.find(f=>f.code==='phase');
  if(supplyField&&['UTL-01-001','UTL-01-002','UTL-01-003','UTL-28-001','UTL-28-002','UTL-28-003','UTL-28-004','UTL-28-007','UTL-28-008'].includes(code)){
   fields=fields.map(f=>f.code==='supply'?{...f,options:code==='UTL-01-003'?['Pulsed / variable frequency']:['AC']}:f.code==='phase'&&phaseField?{...f,options:code==='UTL-01-001'?['Single phase']:code==='UTL-01-002'?phaseField.options?.filter(x=>x.startsWith('Three phase')):phaseField.options?.filter(x=>x!=='DC / not applicable')}:f);
  }
  if(['UTL-02-001','UTL-02-004','UTL-28-005'].includes(code))fields=fields.map(f=>f.code==='supply'?{...f,options:['DC']}:f.code==='phase'?{...f,options:['DC / not applicable']}:f);
  const hazard:EnergyField={code:'exposure',label:'Energy / hazardous exposure classification',kind:'select',required:true,options:['Hazardous energy present','No credible hazardous energy — documented assessment']};
  const aliases:Record<string,string[]>= {operating_pressure:['pressure'],temperature:['temperature','supplyTemp'],flow:['flow'],voltage:['voltage'],current:['current'],frequency:['frequency'],power:['power'],medium:['medium','chemical','refrigerant'],concentration:['concentration']};
  const shared=new Set(utilityAttrs);
  const duplicate=(f:EnergyField)=>shared.has(f.code)||(aliases[f.code]||[]).some(x=>shared.has(x));
  fields=[hazard,...fields.filter(f=>common.includes(f.code)||family!=='signal'&&!duplicate(f)).map(f=>f.code==='location'||f.code==='source_id'?f:{...f,whenAll:[{field:'exposure',values:['Hazardous energy present']}]})];
  fields.push({code:'exposure_basis',label:'Hazard screening / exposure and isolation applicability basis',kind:'text',required:true});
 }
 const tests:EnergyTest[]=candidateInspectionCodes(code).filter(x=>adopted.has(x)).map(code=>{const def=STATUTORY_INSPECTIONS.find(x=>x.code===code)!;return {code,label:def.label,critical:true,conditional:true,reference:def.reference};});
 return {fields:[...fields,...reviewFields],tests};
}
export function utilityFingerprint(row:{code:string;values?:unknown;connectionId?:unknown}):string{
 const values=row.values&&typeof row.values==='object'?row.values as Record<string,unknown>:{};
 return JSON.stringify([row.code,row.connectionId||'',Object.entries(values).sort(([a],[b])=>a.localeCompare(b))]);
}
// Exactly one external row per existing utility record. Safety-only points remain independent.
export function mergeUtilityEnergy(utilities:Obj[],saved:Obj[]):Obj[]{
 const external=utilities.map(u=>{
  const code=String(u.code),pointId=utilityPointId(u);
  const found:Obj=saved.find(x=>x.pointId===pointId&&x.code===code)||{};
  const old:Obj=found.utilityConnectionId&&found.utilityConnectionId!==String(u.connectionId||'legacy-'+code)?{}:found;
  const connectionId=String(u.connectionId||'legacy-'+code);
 const fingerprint=utilityFingerprint({code,values:u.values,connectionId});
  const changed=old.utilityFingerprint!==fingerprint;
  const values={...(old.values&&typeof old.values==='object'?old.values as Obj:{})};
  if(changed){delete values.legal_review;}
  return {...old,code,pointId,label:String(u.label||code),tag:old.tag||'',photoToken:old.photoToken||'',values,tests:old.tests||{},linkedUtility:true,utilityValues:u.values||{},utilityFingerprint:fingerprint,utilityConnectionId:connectionId,status:changed?'draft':old.status||'draft',utilityChanged:changed};
 });
 return [...external,...saved.filter(x=>!String(x.code).startsWith('UTL-')&&!String(x.pointId||'').startsWith('utility-'))];
}
