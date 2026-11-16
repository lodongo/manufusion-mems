import {listDocs,str,type Doc} from './core';
import type {OrgContext} from './guards';
import {groupAt,loadWorkGroupPolicy} from './maintenanceWorkGroupPolicy';
import {texts} from './maintenanceDomain';
export async function assessmentExecutionRoles(ctx:OrgContext,record:Doc){
 const policy=ctx.workGroupPolicy||await loadWorkGroupPolicy(ctx.orgId,ctx.me),group=groupAt(policy,texts(record.data.path));
 if(!policy||!group)return {configured:false,roles:[] as {code:string;label:string;groupTitle:string}[]};
 const categories=(policy.config.tasks['MNT.TASK.FEEDBACK']||[]).filter(t=>(policy.config.tasks['MNT.WO.execute']||[]).includes(t));
 const codes=new Map<string,string>();
 for(const title of categories)for(const member of group.members[title]||[])if(policy.activePositions.has(member.positionCode)&&(policy.config.roleAlignment[title]||[]).includes(member.positionCode))codes.set(member.positionCode,title);
 const positions=await listDocs('organizations/'+ctx.orgId+'/positions');
 const roles=positions.filter(p=>codes.has(p.id)).map(p=>({code:p.id,label:str(p.data.title)||str(p.data.name)||p.id,groupTitle:codes.get(p.id)!})).sort((a,b)=>a.label.localeCompare(b.label));
 return {configured:true,roles};
}
export async function assessmentSkills(){return (await listDocs('reference/skills_master/items')).filter(s=>s.data.enabled!==false).map(s=>({code:s.id,label:str(s.data.name),category:str(s.data.category),subcategory:str(s.data.subcategory)})).filter(s=>s.label&&s.category&&s.subcategory);}
