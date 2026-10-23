/** Pure HR skill catalogue browsing; preserves original skill codes and descriptions. */
export type BrowseSkill = {
 code:string; name:string; category:string; subcategory:string;
 description:string; enabled:boolean;
};
const fallback=(name:string)=>name.trim()||'Uncategorized';
export const skillCategory=(skill:BrowseSkill)=>fallback(skill.category);
export const skillSubcategory=(skill:BrowseSkill)=>fallback(skill.subcategory);
const sortLabels=(a:string,b:string)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true});
export function skillCategories(skills:BrowseSkill[]){
 const counts=new Map<string,number>();
 for(const s of skills){const key=skillCategory(s);counts.set(key,(counts.get(key)||0)+1)}
 return [...counts].map(([name,count])=>({name,count})).sort((a,b)=>sortLabels(a.name,b.name));
}
export function skillSubcategories(skills:BrowseSkill[],category:string){
 const counts=new Map<string,number>();
 for(const s of skills)if(skillCategory(s)===category){
  const key=skillSubcategory(s);counts.set(key,(counts.get(key)||0)+1);
 }
 return [...counts].map(([name,count])=>({name,count})).sort((a,b)=>sortLabels(a.name,b.name));
}
export function browseSkills(skills:BrowseSkill[],category:string,subcategory:string,search:string){
 const q=search.trim().toLocaleLowerCase();
 return skills.filter(s=>
   (!category||skillCategory(s)===category)&&(!subcategory||skillSubcategory(s)===subcategory)&&
   (!q||[s.code,s.name,s.category,s.subcategory,s.description].some(v=>v.toLocaleLowerCase().includes(q)))
 ).sort((a,b)=>sortLabels(a.name,b.name)||sortLabels(a.code,b.code));
}
