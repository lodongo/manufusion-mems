import {HttpError,getDoc,listDocs,nowIso,str,writeDoc} from './core';
import {staff} from './guards';
const ROOT='reference/skills_master/items';
type Skill={code:string;category:string;subcategory:string;name:string;description:string;enabled:boolean};
const clean=(x:unknown,max:number)=>str(x).trim().slice(0,max);
export const skillRoutes={
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
        if(!/^HR_SK_\d{3}_\d{3}$/.test(code))throw new HttpError(400,'Invalid skill code.');
        const path=ROOT+'/'+code;
        const existing=await getDoc(path);
        if(!existing)throw new HttpError(404,'Skill not found.');
        if(typeof ctx.body.enabled!=='boolean')throw new HttpError(400,'Invalid status.');
        await writeDoc(path,{...existing.data,enabled:ctx.body.enabled,updatedAt:nowIso(),updatedBy:ctx.uid});
        return {ok:true};
    })],
};
