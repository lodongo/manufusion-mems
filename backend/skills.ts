import {HttpError,getDoc,listDocs,nowIso,str,writeDoc} from './core';
import {staff} from './guards';
import {HR_SKILL_EXPANDED} from './hrSkillsExpanded';
import {HR_SKILL_METADATA_PATH} from './hrSkillSources';
import {isObj} from './core';
const ROOT='reference/skills_master/items';
type Skill={code:string;category:string;subcategory:string;name:string;description:string;enabled:boolean};
const clean=(x:unknown,max:number)=>str(x).trim().slice(0,max);
export const skillRoutes={
    'POST /api/admin/skills/import-expanded':[staff('admin.skills.import_expanded','write',async ctx=>{
        const codes=ctx.body.codes;
        if(!Array.isArray(codes)||codes.length<1||codes.length>40||codes.some(c=>typeof c!=='string'||!/^HR_NSK_\d{3}_\d{3}$/.test(c)))throw new HttpError(400,'Supply 1–40 expanded skill codes.');
        const catalogue=new Map(HR_SKILL_EXPANDED.map(s=>[s.code,s]));
        const unique=[...new Set(codes as string[])];
        if(unique.some(c=>!catalogue.has(c)))throw new HttpError(400,'Unknown expanded catalogue skill: '+unique.filter(c=>!catalogue.has(c)).join(', '));
        const meta=await getDoc(HR_SKILL_METADATA_PATH),rows=(Array.isArray(meta?.data.items)?meta.data.items:[]).filter(isObj);
        const disabled=new Set(rows.filter(r=>r.active===false||r.enabled===false||r.selectable===false).map(r=>str(r.code)));
        let inserted=0;const existing:string[]=[],blocked:string[]=[];
        for(const code of unique){const path=ROOT+'/'+code;if(disabled.has(code)){blocked.push(code);continue;}const prior=await getDoc(path);if(prior){if(prior.data.enabled===false||prior.data.active===false||prior.data.selectable===false)blocked.push(code);else existing.push(code);continue;}const s=catalogue.get(code)!;if(await writeDoc(path,{code,category:s.category,subcategory:s.subcategory,name:s.label,description:s.description,enabled:true,source:'MEMS expanded catalogue',createdAt:nowIso(),createdBy:ctx.uid},{exists:false}))inserted++;else existing.push(code);}
        return {inserted,existing,blocked};
    })],
    'POST /api/admin/skills/list':[staff('admin.skills.list','read',async()=>{
        const docs=await listDocs(ROOT);
        const skills=docs.map(d=>({code:d.id,category:str(d.data.category),subcategory:str(d.data.subcategory),name:str(d.data.name),description:str(d.data.description),enabled:d.data.enabled!==false})).sort((a,b)=>a.code.localeCompare(b.code));
        return {skills,count:skills.length};
    })],
    'POST /api/admin/skills/import':[staff('admin.skills.import','write',async ctx=>{
        const items=ctx.body.skills;
        if(!Array.isArray(items)||items.length<1||items.length>40)throw new HttpError(400,'Supply 1–40 skills per import.');
        let inserted=0;
        for(const item of items){
            if(!item||typeof item!=='object'||Array.isArray(item))throw new HttpError(400,'Invalid skill.');
            const x=item as Record<string,unknown>;
            const code=clean(x.code,40);
            const category=clean(x.category,100),subcategory=clean(x.subcategory,100),name=clean(x.name,140),description=clean(x.description,600);
            if(!/^HR_SK_\d{3}_\d{3}$/.test(code)||!category||!subcategory||!name||!description)throw new HttpError(400,'Invalid skill code or mandatory fields.');
            const path=ROOT+'/'+code;
            if(await getDoc(path))continue;
            await writeDoc(path,{code,category,subcategory,name,description,enabled:x.enabled!==false,createdAt:nowIso(),createdBy:ctx.uid});
            inserted++;
        }
        return {inserted};
    })],
    'POST /api/admin/skills/update':[staff('admin.skills.update','write',async ctx=>{
        const code=clean(ctx.body.code,40);
        if(!/^HR_(?:SK|NSK)_\d{3}_\d{3}$/.test(code))throw new HttpError(400,'Invalid skill code.');
        const path=ROOT+'/'+code;
        const existing=await getDoc(path);
        if(!existing)throw new HttpError(404,'Skill not found.');
        if(typeof ctx.body.enabled!=='boolean')throw new HttpError(400,'Invalid status.');
        await writeDoc(path,{...existing.data,enabled:ctx.body.enabled,updatedAt:nowIso(),updatedBy:ctx.uid});
        return {ok:true};
    })],
};
