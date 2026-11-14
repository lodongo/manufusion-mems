import {getDoc,isObj,type Obj} from './core';
import {SAF_DEFAULT_LISTS} from './safDefaults';
import {AST_UTILITY_ITEMS} from './astUtilityDefaults';
import {categoryColor} from './safActivityClasses';
import {energyHazardCategory} from './safEnergyColors';
import {appendCatalogue} from './safHazardExpansion';
const items=(v:unknown):Obj[]=>Array.isArray(v)?v.filter(isObj):[];
const defaults=(key:string)=>items(SAF_DEFAULT_LISTS.find(x=>x.key===key)?.items);
const text=(v:unknown)=>typeof v==='string'?v:'';
// A source is a reference, not proof of exposure. Include both the same-code source and mapped risk hazards.
const related:Record<string,string[]>={Electrical:['SAF_01_02_001','SAF_01_02_006','SAF_01_02_007','SAF_01_02_012'],Mechanical:['SAF_01_01_006','SAF_01_01_009','SAF_01_01_010'],Lifting:['SAF_01_06_003','SAF_01_06_006','SAF_01_06_008'],Pressure:['SAF_01_09_001','SAF_01_09_004','SAF_01_09_009','SAF_01_09_010'],Chemicals:['SAF_01_08_001','SAF_01_08_002','SAF_01_08_004'],Thermal:['SAF_01_10_001','SAF_01_10_002','SAF_01_10_007'],'Physical agents':['SAF_01_11_005','SAF_01_11_008','SAF_01_11_009'],'Fire and explosion':['SAF_01_07_001','SAF_01_07_003','SAF_01_07_008'],'Process safety':['SAF_01_18_001','SAF_01_18_003'],'Environment':['SAF_01_17_008'],'Specialist operations':[]};
export function buildSafetyHazardMaster(hazards:Obj[],energy:Obj[],utilities:Obj[],overrides:Record<string,unknown>={}){
 const sourceCodes=new Set([...energy,...utilities].map(x=>text(x.code)));
 const base=hazards.filter(h=>!sourceCodes.has(text(h.code))&&!h.energySourceCode);
 const hazardMap=new Map(base.map(h=>[text(h.code),h]));
 const project=(source:Obj)=>{
  const code=text(source.code),hazardCategory=energyHazardCategory(source);
  const hazardCodes=[code,...(related[hazardCategory]||[]).filter(c=>hazardMap.has(c))];
  return {...source,hazardCategory,hazardCodes,color:categoryColor(hazardCategory,overrides)};
 };
 const internal=energy.map(project),external=utilities.map(project);
 const entries=[...base.map(h=>({...h,color:categoryColor(text(h.category),overrides)})),...[...internal,...external].map(s=>({code:text(s.code),label:text(s.label),category:s.hazardCategory,subcategory:'Energy sources · '+text(s.category),description:'Energy-source reference: '+text(s.label)+'. Assess the actual exposure and applicable controls. '+text(s.description),active:s.active!==false,selectable:s.selectable!==false,energySourceCode:text(s.code),hazardCodes:s.hazardCodes,color:s.color}))];
 return {hazards:entries,internal,external};
}
export async function loadSafetyHazardMaster(){
 const [h,e,u]=await Promise.all([getDoc('module_workspaces/SAF/metadata/hazards'),getDoc('module_workspaces/SAF/metadata/hazardousEnergy'),getDoc('module_workspaces/AST/metadata/utilitySupplies')]);
 return buildSafetyHazardMaster(appendCatalogue(items(h?.data.items),defaults('hazards')),appendCatalogue(items(e?.data.items),defaults('hazardousEnergy')),u&&Array.isArray(u.data.items)?items(u.data.items):items(AST_UTILITY_ITEMS),isObj(h?.data.categoryColors)?h.data.categoryColors:{});
}
