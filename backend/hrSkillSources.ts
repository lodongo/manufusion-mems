import {getDoc,listDocs,isObj,str} from './core';
export const HR_SKILL_REFERENCE_ROOT='reference/skills_master/items';
export const HR_SKILL_METADATA_PATH='module_workspaces/HRM/metadata/skillsMaster';
type SourceSkill={code:string;label:string;category:string;subcategory:string;description:string;enabled:boolean};
/** Keep both historically separate catalogues readable for work requirements.
 * Never infer enabled status from a compiled seed; explicit disabled status in
 * either database source takes precedence. No database writes on reads.
 */
export function mergeWorkSkillSources(reference:SourceSkill[],metadata:SourceSkill[]):SourceSkill[]{
 const result=new Map<string,SourceSkill>();
 for(const row of [...reference,...metadata]){
  if(!row.code)continue;
  const prior=result.get(row.code);
  result.set(row.code,{code:row.code,label:row.label||prior?.label||'',category:row.category||prior?.category||'',subcategory:row.subcategory||prior?.subcategory||'',description:row.description||prior?.description||'',enabled:row.enabled&&prior?.enabled!==false});
 }
 return [...result.values()].filter(s=>s.enabled&&s.label&&s.category&&s.subcategory).sort((a,b)=>a.code.localeCompare(b.code));
}
export async function readWorkSkillMaster(){
 const [docs,metadata]=await Promise.all([listDocs(HR_SKILL_REFERENCE_ROOT),getDoc(HR_SKILL_METADATA_PATH)]);
 const reference=docs.map(d=>({code:d.id,label:str(d.data.name)||str(d.data.label),category:str(d.data.category),subcategory:str(d.data.subcategory),description:str(d.data.description),enabled:d.data.enabled!==false&&d.data.active!==false&&d.data.selectable!==false}));
 const rows=(Array.isArray(metadata?.data.items)?metadata.data.items:[]).filter(isObj).map(s=>({code:str(s.code),label:str(s.label)||str(s.name),category:str(s.category),subcategory:str(s.subcategory),description:str(s.description),enabled:s.active!==false&&s.enabled!==false&&s.selectable!==false}));
 return mergeWorkSkillSources(reference,rows);
}
