import { HttpError, getDoc, isObj, str, type Obj, type Plain } from './core';
import { orgRoute, hasPerm } from './guards';
import { DEFAULT_MODULE_METADATA } from './moduleDefaults';
export const maintenanceReferenceRoutes = {
 'POST /api/org/mnt/references': [orgRoute('org.mnt.references',null,async ctx=>{
  if(!isObj(ctx.org.data.modules)||ctx.org.data.modules.MNT!==true)throw new HttpError(403,'MNT is not enabled.');
  if(!hasPerm(ctx.permissions,'MNT.view'))throw new HttpError(403,'MNT view permission required.');
  const lists=await Promise.all((DEFAULT_MODULE_METADATA.MNT||[]).map(async def=>{
   const doc=await getDoc('module_workspaces/MNT/metadata/'+def.key);
   const items=(Array.isArray(doc?.data.items)?(doc.data.items as Plain[]).filter(isObj):def.items) as unknown as Obj[];
   return {key:def.key,title:str(doc?.data.title)||def.title,description:str(doc?.data.description)||def.description,items:items.map(i=>({code:str(i.code),label:str(i.label),active:i.active!==false,color:str(i.color),category:str(i.category),selectable:i.selectable!==false}))};
  }));
  return {lists};
 })],
};