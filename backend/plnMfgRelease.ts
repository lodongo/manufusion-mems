/**
 * Controlled activation for Phase-1 manufacturing BOMs, recipes and routings.
 * Distinct master codes preserve previously approved versions. Released masters are
 * immutable; future-effective versions are selected by their effective date.
 * This module does NOT authorize production, stock movements or procurement.
 */
import { HttpError, commitChecked, getDoc, listDocs, nowIso, randomId, str } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { canAt, nodePath, scopeOf } from './access';
import { audit } from './audit';
import { referenceChecks } from './plnMfgFoundation';

type Kind = 'boms'|'routings';
const TABLE:Record<Kind,string> = {boms:'mfg_boms',routings:'mfg_routings'};
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;
const kindOf=(v:unknown):Kind=>{
    if(v!=='boms'&&v!=='routings')throw new HttpError(400,'Select a BOM/recipe or routing.');
    return v;
};
const idOf=(v:unknown):string=>{
    const id=str(v);
    if(!idPattern.test(id))throw new HttpError(400,'Invalid master code.');
    return id;
};
const root=(org:string,kind:Kind)=>'organizations/'+org+'/'+TABLE[kind];
const requiredPerm=(kind:Kind,action:'submit'|'approve')=>'MFG.'+(kind==='boms'?'bom':'routing')+'.'+action;

export function selectEffectiveRelease<T extends {status?:string;effectiveFrom?:string;approvedAt?:string;id?:string}>(
    records:T[],date:string,
):T|null {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new HttpError(400,'Valid planning date is required.');
    return records.filter(r=>r.status==='active'&&(!r.effectiveFrom||r.effectiveFrom<=date))
        .sort((a,b)=>(b.effectiveFrom||'0000-00-00').localeCompare(a.effectiveFrom||'0000-00-00')||
        (b.approvedAt||'').localeCompare(a.approvedAt||'')||
        (b.id||'').localeCompare(a.id||''))[0]??null;
}

async function authorized(ctx:OrgContext,permission:string,siteId:string) {
    if(ctx.role==='org_super_admin')return true;
    if(!siteId)return hasPerm(ctx.directPermissions,permission);
    return canAt(ctx,permission,await nodePath(ctx.orgId,siteId),await scopeOf(ctx));
}
const auditAction=(ctx:OrgContext,action:string,target:string,note:string)=>audit([{
    category:'data',action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,
    target:{label:target},details:note.slice(0,400),
}]);

export const plnMfgReleaseRoutes={
    'POST /api/org/pln-mfg/foundation/submit':[
        orgRoute('org.mfg.foundation.submit','MFG.master.edit',async ctx=>{
            const kind=kindOf(ctx.body.kind),id=idOf(ctx.body.id),permission=requiredPerm(kind,'submit');
            if(!await authorized(ctx,permission,'')&&!hasPerm(ctx.permissions,permission))
                throw new HttpError(403,'Manufacturing release submission permission required.');
            const path=root(ctx.orgId,kind)+'/'+id,doc=await getDoc(path);
            if(!doc)throw new HttpError(404,'Manufacturing master not found.');
            if(str(doc.data.status)!=='draft')throw new HttpError(409,'Only saved drafts can be submitted.');
            if(!await authorized(ctx,permission,str(doc.data.siteId)))
                throw new HttpError(403,'Submission is outside your authorized site.');
            await referenceChecks(ctx,kind,doc.data,id);
            const at=nowIso(),data={...doc.data,status:'pending_approval',submittedAt:at,submittedBy:ctx.uid};
            const saved=await commitChecked([
                {path,data,precondition:{updateTime:doc.updateTime}},
                {path:path+'/release_events/'+randomId(10),data:{action:'submitted',kind,revision:doc.data.revision,by:ctx.uid,at},precondition:{exists:false}},
            ]);
            if(!saved)throw new HttpError(409,'The draft changed. Refresh and resubmit.');
            await auditAction(ctx,'mfg.release.submit',kind+':'+id,'Submitted for independent technical approval');
            return {ok:true,status:'pending_approval'};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/decide':[
        orgRoute('org.mfg.foundation.decide','MFG.view',async ctx=>{
            const kind=kindOf(ctx.body.kind),id=idOf(ctx.body.id),permission=requiredPerm(kind,'approve');
            if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.permissions,permission))
                throw new HttpError(403,'Manufacturing release approval permission required.');
            const path=root(ctx.orgId,kind)+'/'+id,doc=await getDoc(path);
            if(!doc)throw new HttpError(404,'Manufacturing master not found.');
            if(str(doc.data.status)!=='pending_approval')throw new HttpError(409,'Only submitted revisions can be approved or rejected.');
            if(!await authorized(ctx,permission,str(doc.data.siteId)))
                throw new HttpError(403,'Approval is outside your authorized site.');
            if(ctx.uid===str(doc.data.createdBy)||ctx.uid===str(doc.data.submittedBy)){
                if(ctx.role==='org_super_admin'&&ctx.testMode===true)ctx.bypassed?.push('mfg.release.independent_checker');
                else throw new HttpError(403,'Independent maker-checker approval is mandatory.');
            }
            const decision=str(ctx.body.decision),note=str(ctx.body.note).trim().slice(0,400);
            if(!['approve','reject'].includes(decision))throw new HttpError(400,'Select approve or reject.');
            if(decision==='reject'&&!note)throw new HttpError(400,'A reason is required for rejection.');
            if(decision==='approve'){
                await referenceChecks(ctx,kind,doc.data,id);
                const comparable=await listDocs(root(ctx.orgId,kind));
                const same=comparable.filter(other=>other.id!==id&&str(other.data.status)==='active'&&
                    str(other.data.siteId)===str(doc.data.siteId)&&
                    str(other.data.effectiveFrom)===str(doc.data.effectiveFrom)&&
                    (kind==='boms'?str(other.data.parentSkuId)===str(doc.data.parentSkuId):str(other.data.skuId)===str(doc.data.skuId)));
                if(same.length)throw new HttpError(409,'Another approved version already applies to this SKU, site and effective date.');
            }
            const at=nowIso(),status=decision==='approve'?'active':'rejected';
            const data={...doc.data,status,decisionNote:note,decidedAt:at,decidedBy:ctx.uid,
                ...(status==='active'?{approvedAt:at,approvedBy:ctx.uid}:{})};
            const saved=await commitChecked([
                {path,data,precondition:{updateTime:doc.updateTime}},
                {path:path+'/release_events/'+randomId(10),data:{action:decision,kind,revision:doc.data.revision,by:ctx.uid,at,note},precondition:{exists:false}},
            ]);
            if(!saved)throw new HttpError(409,'This release changed. Refresh and decide again.');
            await auditAction(ctx,'mfg.release.'+decision,kind+':'+id,note||'Technical manufacturing release decision');
            return {ok:true,status};
        }),
    ],
};
