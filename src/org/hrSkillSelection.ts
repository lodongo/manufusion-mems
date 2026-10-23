import type { BrowseSkill } from './hrSkillBrowse';

export const MAX_SKILL_NOMINATIONS=25;

/** Skills are selected in one category/subcategory but retained across browsing changes.
 * Required job-role skills belong in the separate Role Skill Requirements tab.
 */
export function otherSkillOptions(
 skills:BrowseSkill[],
 category:string,
 subcategory:string,
 search:string,
 requiredCodes:readonly string[],
):BrowseSkill[]{
 if(!category||!subcategory)return [];
 const required=new Set(requiredCodes);
 const q=search.trim().toLocaleLowerCase();
 return skills.filter(skill=>
  skill.enabled && skill.category===category && skill.subcategory===subcategory &&
  !required.has(skill.code) &&
  (!q||[skill.name,skill.code,skill.description].some(v=>v.toLocaleLowerCase().includes(q)))
 ).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||a.code.localeCompare(b.code));
}
export function toggleSelectedSkill(selected:readonly string[],code:string,checked:boolean):string[]{
 if(!checked)return selected.filter(x=>x!==code);
 if(selected.includes(code)||selected.length>=MAX_SKILL_NOMINATIONS)return [...selected];
 return [...selected,code];
}
export function selectVisibleSkills(selected:readonly string[],codes:readonly string[]):string[]{
 const chosen=[...selected];
 for(const code of codes){
  if(chosen.length>=MAX_SKILL_NOMINATIONS)break;
  if(!chosen.includes(code))chosen.push(code);
 }
 return chosen;
}
