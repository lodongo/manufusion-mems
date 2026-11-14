// Controlled activity classes and application display colors. Class never authorizes execution.
export const ACTIVITY_CLASSES = [
 ['AC01','No Risk','screening',[], 'Only after documented screening establishes no credible exposure; otherwise choose a risk-bearing class.'],
 ['AC02','Short Intervention Control','short',[], 'Short duration does not remove isolation or permit requirements. Record hazards, controls and residual risk.'],
 ['AC03','Full LOTO','full',['SAF_08_01_003'],'Full hazardous energy isolation and verified zero energy. Requires LOTO permit planning.'],
 ['AC04','Line Breaking','full',['SAF_08_04_002'],'Process opening with approved isolation and residual energy controls.'],
 ['AC05','Working on Live Equipment','full',['SAF_08_01_004'],'Independent necessity and authorization; live work permit.'],
 ['AC06','Partial Isolation','full',['SAF_08_01_003'],'Document remaining energy and applicable additional permits.'],
 ['AC07','Electrical Work','full',['SAF_08_01_001'],'Electrical work by competent authorized personnel.'],
 ['AC08','High Voltage Switching','full',['SAF_08_01_002'],'Approved switching plan and qualified authorization.'],
 ['AC09','Hot Work','full',['SAF_08_02_001'],'Select applicable hot-work permit(s) for actual task.'],
 ['AC10','Confined Space Entry','full',['SAF_08_03_001'],'Entry controls and rescue readiness.'],
 ['AC11','Working at Height','full',['SAF_08_03_002'],'Fall prevention, access and rescue.'],
 ['AC12','Roof Access','full',['SAF_08_03_003'],'Roof integrity and fall prevention.'],
 ['AC13','Excavation / Ground Disturbance','full',['SAF_08_03_004'],'Services clearance and ground protection.'],
 ['AC14','Critical Lifting','full',['SAF_08_04_001'],'Competent lift plan and exclusion.'],
 ['AC15','Pressure System Opening','full',['SAF_08_01_005'],'Verified isolation and residual pressure controls.'],
 ['AC16','Chemical Transfer','full',['SAF_08_04_007'],'Compatibility and containment.'],
 ['AC17','Radiography','full',['SAF_08_04_003'],'Licensed activity and radiation protection.'],
 ['AC18','Demolition','full',['SAF_08_04_004'],'Engineering survey and structural controls.'],
 ['AC19','Work Near Traffic','full',['SAF_08_04_005'],'Traffic segregation and interface controls.'],
 ['AC20','Other Hazardous / Nonroutine Work','full',[],'Full assessment and applicable permit determination.'],
] .map(([code,label,assessmentKind,requiredPermits,description])=>({code:code as string,label:label as string,assessmentKind:assessmentKind as string,requiredPermits:requiredPermits as string[],description:description as string,category:'Activity class',subcategory:assessmentKind as string,active:true,selectable:true}));
export const HAZARD_COLORS:Record<string,string>={'Mechanical':'#F59E0B','Electrical':'#EAB308','Work at height':'#EA580C','Slips and trips':'#D97706','Transport':'#F59E0B','Lifting':'#EA580C','Fire and explosion':'#DC2626','Chemicals':'#9333EA','Pressure':'#EA580C','Thermal':'#DC2626','Physical agents':'#2563EB','Biological':'#9333EA','Ergonomics':'#0891B2','Confined spaces':'#B45309','Construction':'#D97706','Psychosocial':'#7C3AED','Environment':'#0E7490','Process safety':'#C2410C','Human factors':'#6366F1','Security':'#475569','Specialist operations':'#BE123C'};
// ISO/ANSI sign meanings inform the palette, but these are MEMS classification colors,
// not a standardized category-to-color mapping, signage or risk severity.
export function categoryColor(category:string, overrides:Record<string,unknown>={}):string {
 const value=overrides[category];return typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value)?value.toUpperCase():HAZARD_COLORS[category]||'#D97706';
}
