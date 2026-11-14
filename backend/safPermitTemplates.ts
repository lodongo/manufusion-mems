// SAF master permit form definitions. Definitions are not issued permits or an authorization to work.
// Machine states retain the existing MNT codes for compatibility with stored tasks.
export const SAF_MACHINE_STATES = [
 {code:'total_shutdown',label:'Total shutdown',description:'Stopped, not proof of isolation. Assess hazardous energy and apply isolation where needed.'},
 {code:'full_loto',label:'Full LOTO',description:'Full hazardous energy isolation, lockout, tagout and verified zero energy.'},
 {code:'partial_isolation',label:'Partial isolation',description:'Specified energy sources isolated; remaining energy requires independent assessment and controls.'},
 {code:'live',label:'Work on live equipment',description:'Energized or moving equipment; independent risk assessment and authorized live-work permit required.'},
].map(x=>({...x,category:'Execution state',subcategory:'Machine status',active:true,selectable:true}));
export type PermitField={code:string;section:string;label:string;kind:'text'|'textarea'|'checkbox'|'number'|'datetime'|'employee'|'attachment'|'table'|'select';mandatory:boolean;description:string;options?:string[]};
const f=(code:string,section:string,label:string,kind:PermitField['kind'],mandatory:boolean,description:string,options?:string[]):PermitField=>({code,section,label,kind,mandatory,description,...(options?{options}:{})});
const common:PermitField[]=[
 f('work_reference','Work identification','Work order / task / request reference','text',true,'Traceable work identifier.'),
 f('location','Work identification','Site, area and equipment','text',true,'Unambiguous physical work location and boundaries.'),
 f('scope','Work identification','Scope and exclusions','textarea',true,'Describe permitted activity and what is excluded.'),
 f('valid_from','Validity','Valid from','datetime',true,'Authorized start date and time.'),
 f('valid_until','Validity','Valid until','datetime',true,'Expiry; stop and reassess before any extension.'),
 f('shift','Validity','Shift / crew','text',false,'Shift or crew identification.'),
 f('applicant','Responsibilities','Applicant / performing authority','employee',true,'Identified competent person responsible for the work.'),
 f('issuer','Responsibilities','Independent permit issuer','employee',true,'Authorized issuer separate from the performer.'),
 f('area_owner','Responsibilities','Area owner / operations acceptance','employee',true,'Area authority confirms coordination.'),
 f('team','Responsibilities','Work party and competency records','table',true,'Record workers, roles, training and competence verification.'),
 f('contractor','Responsibilities','Contractor details','text',false,'Company and responsible supervisor where applicable.'),
 f('risk_ref','Risk and controls','Task risk assessment / JSA reference','text',true,'Current assessment including initial and residual risk.'),
 f('hazards','Risk and controls','Hazards and persons exposed','table',true,'Identify affected persons and credible hazards.'),
 f('controls','Risk and controls','Controls and verification evidence','table',true,'Controls, verifier, evidence and outstanding restrictions.'),
 f('ppe','Risk and controls','PPE and special equipment','table',true,'Specified protection and inspection.'),
 f('isolation','Risk and controls','Isolation / cross-permit references','table',true,'Specify applicable isolations and linked permits or justified not applicable.'),
 f('simops','Risk and controls','Simultaneous operations / interfaces','textarea',true,'Conflicting permits, affected departments and exclusion boundaries.'),
 f('emergency','Emergency','Emergency arrangements','textarea',true,'Emergency contacts, rescue, communication and stop-work criteria.'),
 f('briefing','Authorization','Toolbox talk and work-party acknowledgement','checkbox',true,'Recorded briefing before work starts.'),
 f('site_check','Authorization','Independent pre-work site inspection','checkbox',true,'Verify actual conditions before issuance.'),
 f('attachments','Authorization','Supporting documents and drawings','attachment',false,'Attach relevant evidence, procedures and diagrams.'),
 f('suspend','Handover and closure','Suspension / revalidation record','table',true,'Change of conditions, expiry or shift: stop and revalidate.'),
 f('return_area','Handover and closure','Area restored and equipment status verified','checkbox',true,'Confirm safe condition, removal of temporary arrangements and handback.'),
 f('closure','Handover and closure','Closure signatures and timestamps','table',true,'Performing authority, issuer and operations acceptance as applicable.'),
];
const section='Permit-specific controls';
const special:Record<string,PermitField[]>={
 energy:[
 f('energy_sources',section,'Energy sources and isolation points','table',true,'Identify all hazardous energy, isolation points, devices and stored energy.'),
 f('energy_verification',section,'Isolation and verification evidence','table',true,'Record competent verifier, method and result; do not treat shutdown as isolation.'),
 f('energy_diagram',section,'Isolation / switching diagram','attachment',false,'Current controlled drawing or diagram.')],
 loto:[f('locks_tags',section,'Lock / tag register and personal locks','table',true,'Record lock/tag identities, persons and controlled isolation points.'),f('zero_energy',section,'Zero-energy verification','table',true,'Competent, documented verification before work.'),f('group_loto',section,'Group lockbox and custody','table',false,'Group isolation custody where applicable.'),f('deisolation',section,'Controlled de-isolation and handback','table',true,'Account for personnel, locks, tags and authorization.')],
 live:[f('live_justification',section,'Why de-energization is not feasible','textarea',true,'Document necessity, alternatives and competent independent authorization.'),f('live_limits',section,'Authorized boundaries and approach restrictions','textarea',true,'Competent person defines limits, protective systems and restrictions.'),f('live_monitor',section,'Standby / observer and emergency response','employee',true,'Designated competent support.'),f('live_equipment',section,'Insulating / tested protective equipment','table',true,'Record inspections and suitability.')],
 hot:[f('ignition',section,'Ignition sources and combustible controls','table',true,'Assess ignition exposure, combustibles and protection.'),f('firewatch',section,'Fire watch and post-work monitoring','table',true,'Competent person, coverage and monitoring duration.'),f('gas_test',section,'Atmosphere testing and acceptance criteria','table',true,'Where relevant, competent tester, readings, criteria and intervals; record justified N/A.'),f('extinguish',section,'Fire protection equipment','table',true,'Record suitable equipment and inspection.')],
 confined:[f('entry_register',section,'Entrant / attendant / entry supervisor register','table',true,'Record authorized persons and entry/exit times.'),f('atmosphere',section,'Atmospheric test readings and limits','table',true,'Competent tester, calibration, approved limits and monitoring.'),f('ventilation',section,'Ventilation and communication','textarea',true,'Specify arrangements, monitoring and loss-of-control response.'),f('rescue_plan',section,'Confined-space rescue plan and rescue team','attachment',true,'Site-approved rescue arrangements; no reliance on improvised rescue.')],
 height:[f('height_access',section,'Access method and platform inspection','table',true,'Fit-for-purpose access and inspection.'),f('fall',section,'Fall prevention, anchors and equipment','table',true,'Competent selection and inspection.'),f('dropped',section,'Dropped-object controls and exclusion zone','textarea',true,'Protect people below and adjacent operations.'),f('height_rescue',section,'Rescue arrangements and weather limits','textarea',true,'Site-specific response and stop criteria.')],
 ground:[f('services',section,'Buried services, survey and clearance','attachment',true,'Competent identification and approved drawings.'),f('ground_support',section,'Ground stability and protective systems','textarea',true,'Competent assessment and protective measures.'),f('ground_access',section,'Access, barriers and inspection schedule','table',true,'Safe access, restrictions and inspection.')],
 lift:[f('lift_plan',section,'Approved lift plan','attachment',true,'Competent planning and load/rigging details.'),f('lift_team',section,'Crane, rigging, operator and banksman checks','table',true,'Competency and inspection records.'),f('lift_limits',section,'Load path, exclusion zone and operating limits','textarea',true,'Approved limits, communication and weather criteria.')],
 pressure:[f('contents',section,'System contents, pressure, temperature and SDS','table',true,'Identify material and residual energy.'),f('drain',section,'Depressurization, draining and containment verification','table',true,'Record competent verification and containment.'),f('exposure',section,'Exposure controls and spill response','textarea',true,'Approved controls and emergency response.')],
 radiation:[f('rad_plan',section,'Radiation safety plan and competent authorization','attachment',true,'Approved radiation protection plan.'),f('rad_zone',section,'Controlled area, monitoring and dosimetry','table',true,'Competent verification of boundaries and monitoring.')],
 demolition:[f('demolition_plan',section,'Structural assessment and demolition plan','attachment',true,'Competent assessment and approved sequence.'),f('demolition_zone',section,'Services, collapse risk and exclusion zone','table',true,'Record protection and verification.')],
 traffic:[f('traffic_plan',section,'Traffic management and segregation plan','attachment',true,'Approved segregation and route controls.'),f('traffic_watch',section,'Traffic controllers, visibility and barriers','table',true,'Competent personnel and inspected arrangements.')],
 chemical:[f('sds',section,'Chemical identification and SDS','attachment',true,'Current safety data and compatibility assessment.'),f('chemical_transfer',section,'Transfer equipment, containment and exposure checks','table',true,'Competent verification and emergency provisions.')],
};
export function fieldsForPermit(code:string,category:string,label:string):PermitField[]{
 const name=label.toLowerCase();
 const groups:string[]=[];
 if(category==='Energy'||/electrical|isolation|switching/.test(name))groups.push('energy');
 if(/loto|lockout/.test(name))groups.push('loto');
 if(/live /.test(name))groups.push('live');
 if(category==='Hot work'||/welding|grinding|flame cutting|brazing/.test(name))groups.push('hot');
 if(/confined/.test(name))groups.push('confined');
 if(/height|roof/.test(name))groups.push('height');
 if(/excavat|trench|ground disturbance/.test(name))groups.push('ground');
 if(/lifting/.test(name))groups.push('lift');
 if(/pressure|line breaking/.test(name))groups.push('pressure');
 if(/radiograph/.test(name))groups.push('radiation');
 if(/demolition/.test(name))groups.push('demolition');
 if(/traffic/.test(name))groups.push('traffic');
 if(/chemical/.test(name))groups.push('chemical');
 // Stable code guards against renamed labels and assure essential controls.
 const keyed:Record<string,string[]>={'SAF_08_01_003':['energy','loto'],'SAF_08_01_004':['energy','live'],'SAF_08_03_001':['confined']};
 groups.push(...(keyed[code]||[]));
 return [...common,...[...new Set(groups)].flatMap(g=>special[g]||[])];
}
export const SAF_PERMIT_PARAMETER_MASTER=[...new Map([...common,...Object.values(special).flat()].map(x=>[x.code,x])).values()].map(x=>({
 code:x.code,label:x.label,description:x.description,category:x.section,subcategory:x.kind,active:true,selectable:true,
}));
export function normalizePermitFields(definitions:PermitField[],overrides:Record<string,{enabled?:boolean;required?:boolean}>){
 return definitions.map(f=>({...f,enabled:f.mandatory||overrides[f.code]?.enabled!==false,required:f.mandatory||(overrides[f.code]?.enabled!==false&&overrides[f.code]?.required===true)}));
}
