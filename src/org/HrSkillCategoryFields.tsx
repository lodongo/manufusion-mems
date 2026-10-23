import { useMemo, useState } from 'react';
import { SelectField } from '../components/ui';
import { skillCategories, skillSubcategories, type BrowseSkill } from './hrSkillBrowse';

/** Reusable category → subcategory selection for HR skill records, proposals and assignments.
 * Free-text taxonomy creation is restricted to authorized HR catalogue editors.
 */
export default function HrSkillCategoryFields({
 idPrefix,skills,category,subcategory,onCategory,onSubcategory,allowCreate=false,disabled=false,
}:{
 idPrefix:string;skills:BrowseSkill[];category:string;subcategory:string;
 onCategory:(value:string)=>void;onSubcategory:(value:string)=>void;
 allowCreate?:boolean;disabled?:boolean;
}){
 const [newCategory,setNewCategory]=useState(false);
 const [newSubcategory,setNewSubcategory]=useState(false);
 const cats=useMemo(()=>skillCategories(skills).map(s=>s.name),[skills]);
 const categoryChoices=category&&!cats.includes(category)?[...cats,category].sort((a,b)=>a.localeCompare(b)):cats;
 const subs=useMemo(()=>skillSubcategories(skills,category).map(s=>s.name),[skills,category]);
 const subChoices=subcategory&&!subs.includes(subcategory)?[...subs,subcategory].sort((a,b)=>a.localeCompare(b)):subs;
 const selectCategory=(v:string)=>{
   if(v==='__new_category__'){setNewCategory(true);setNewSubcategory(true);onCategory('');onSubcategory('');return;}
   setNewCategory(false);setNewSubcategory(false);onCategory(v);onSubcategory('');
 };
 const selectSub=(v:string)=>{
   if(v==='__new_subcategory__'){setNewSubcategory(true);onSubcategory('');return;}
   setNewSubcategory(false);onSubcategory(v);
 };
 return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
  <div className="min-w-0 space-y-2">
   <SelectField id={idPrefix+'-category'} label="Skill category" required value={newCategory?'__new_category__':category}
    disabled={disabled} onChange={e=>selectCategory(e.target.value)}>
    <option value="">Select category</option>
    {categoryChoices.map(c=><option key={c} value={c}>{c}</option>)}
    {allowCreate&&<option value="__new_category__">+ Add new category…</option>}
   </SelectField>
   {newCategory&&allowCreate&&<label className="block text-sm text-muted">New category name
     <input aria-label="New skill category" autoComplete="off" maxLength={100} disabled={disabled}
      className="mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink"
      value={category} onChange={e=>{onCategory(e.target.value);onSubcategory('')}} placeholder="Enter category name"/>
    </label>}
  </div>
  <div className="min-w-0 space-y-2">
   <SelectField id={idPrefix+'-subcategory'} label="Skill subcategory" required
    value={newSubcategory?'__new_subcategory__':subcategory} disabled={disabled||!category.trim()}
    onChange={e=>selectSub(e.target.value)} hint={!category.trim()?'Choose a category first':undefined}>
    <option value="">Select subcategory</option>
    {subChoices.map(sub=><option key={sub} value={sub}>{sub}</option>)}
    {allowCreate&&<option value="__new_subcategory__">+ Add new subcategory…</option>}
   </SelectField>
   {newSubcategory&&allowCreate&&category.trim()&&<label className="block text-sm text-muted">New subcategory name
    <input aria-label="New skill subcategory" autoComplete="off" maxLength={100} disabled={disabled}
     className="mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink"
     value={subcategory} onChange={e=>onSubcategory(e.target.value)} placeholder="Enter subcategory name"/>
   </label>}
  </div>
 </div>;
}
