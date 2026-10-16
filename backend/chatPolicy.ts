import {HttpError,getDoc,listDocs,isObj,nowIso,str,writeDoc} from './core';
import {orgRoute} from './guards';
import {people} from './chatCommon';
const POLICY_VERSION='CHAT_WORKPLACE_2026_10';
const policyText='Chat is a workplace communication tool provided for organization business. Messages, files, actions and votes may be retained, accessed by authorized business personnel and disclosed where legitimately required by applicable law or policy. Appropriate notice, lawful processing, access safeguards and statutory employee/data-protection rights continue to apply. Do not share personal or sensitive data unless authorized.';
const path=(uid:string)=>'users/'+uid+'/chat_policy/acknowledgement';
export const chatPolicyRoutes={
 'POST /api/org/quick/chat/policy/status':[orgRoute('chat.policy.status',null,async ctx=>{
    const record=await getDoc(path(ctx.uid));
    return {version:POLICY_VERSION,accepted:record?.data.version===POLICY_VERSION,
       acceptedAt:str(record?.data.acceptedAt),policyText};
 })],
 'POST /api/org/quick/chat/policy/accept':[orgRoute('chat.policy.accept',null,async ctx=>{
    if(str(ctx.body.version)!==POLICY_VERSION||ctx.body.acknowledged!==true)
        throw new HttpError(400,'Read and acknowledge the current workplace Chat notice.');
    await writeDoc(path(ctx.uid),{version:POLICY_VERSION,acceptedAt:nowIso(),
        orgId:ctx.orgId,uid:ctx.uid,acknowledgement:'workplace notice, not waiver of statutory rights'});
    return {accepted:true,version:POLICY_VERSION};
 })],
};
export const chatReportingRoutes={
 'POST /api/org/quick/chat/reporting':[orgRoute('chat.reporting',null,async ctx=>{
    const roster=await people(ctx);
    const today=new Date().toISOString().slice(0,10);
    const positions=await listDocs('organizations/'+ctx.orgId+'/positions');
    const parent=new Map(positions.map(p=>[p.id,str(p.data.parentCode)]));
    const validAssignments=(u:typeof roster[number])=>
        (Array.isArray(u.data.assignments)?u.data.assignments:[]).filter(isObj)
        .filter(a=>str(a.positionCode)&&str(a.nodeId)&&(!str(a.startsOn)||str(a.startsOn)<=today)
            &&(!str(a.endsOn)||str(a.endsOn)>=today))
        .map(a=>({role:str(a.positionCode),node:str(a.nodeId)}));
    const mine=validAssignments(ctx.me);
    const structure=await listDocs('organizations/'+ctx.orgId+'/structure');
    const nodes=new Map(structure.map(d=>[d.id,str(d.data.parentId)]));
    const descendant=(child:string,root:string)=>{
        let node=child;
        for(let step=0;step<35&&node;step++){
            if(node===root)return true;
            const next=nodes.get(node);if(!next||next===node)break;node=next;
        }
        return false;
    };
    function roleDepth(code:string,ancestor:string) {
        let cursor=code;
        for(let level=1;level<=30;level++){
            const next=parent.get(cursor)||'';
            if(!next||next===cursor)break;
            if(next===ancestor)return level;
            cursor=next;
        }
        return 0;
    }
    const direct:string[]=[],team:string[]=[];
    for(const u of roster){
        if(u.id===ctx.uid)continue;
        const assigned=validAssignments(u);
        const distances=assigned.flatMap(a=>mine
            .filter(m=>descendant(a.node,m.node))
            .map(m=>roleDepth(a.role,m.role))).filter(Boolean);
        if(distances.length){
            team.push(u.id);
            if(distances.includes(1))direct.push(u.id);
        }
    }
    return {direct:[...new Set(direct)],team:[...new Set(team)],matchedBy:'assigned-job-role-hierarchy'};
 })]
};
