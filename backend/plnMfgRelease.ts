/**
 * Controlled activation for manufacturing BOMs and routings.
 * Distinct master codes preserve previously approved versions. Released masters are
 * immutable; future-effective versions are selected by their effective date.
 * This module does NOT authorize production, stock movements or procurement.
 */
import { HttpError, commitChecked, getDoc, listDocs, nowIso, randomId, str } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { canAt, nodePath, scopeOf } from './access';
import { audit } from './audit';
import { referenceChecks, bomAlternative } from './plnMfgFoundation';
import {reviewManufacturingRouting} from './mfgRoutingReadiness';
import { bomClassificationCode, bomReleaseSlotGroup, mfgMaterialPolicyForOrg } from './mfgMaterialPolicy';

type Kind = 'boms'|'routings';
const TABLE:Record<Kind,string> = {boms:'mfg_boms',routings:'mfg_routings'};
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;
const kindOf=(v:unknown):Kind=>{
    if(v!=='boms'&&v!=='routings')throw new HttpError(400,'Select a BOM or routing.');
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

export function selectEffectiveForSite<T extends {siteId?:string;status?:string;effectiveFrom?:string;approvedAt?:string;id?:string}>(
    records:T[],date:string,siteId:string,
):T|null {
    // A site-specific approved release wins over the organization default only
    // after its own effective date; until then use the organization release.
    const applicable=(scope:string)=>selectEffectiveRelease(records.filter(r=>(r.siteId||'')===scope),date);
    return (siteId?applicable(siteId):null)??applicable('');
}
async function authorized(ctx:OrgContext,permission:string,siteId:string) {
    if(ctx.role==='org_super_admin')return true;
    if(!siteId)return permission==='MFG.view'?hasPerm(ctx.permissions,permission):hasPerm(ctx.directPermissions,permission);
    return canAt(ctx,permission,await nodePath(ctx.orgId,siteId),await scopeOf(ctx));
}
const auditAction=(ctx:OrgContext,action:string,target:string,note:string)=>audit([{
    category:'data',action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,
    target:{label:target},details:note.slice(0,400),
}]);

export const plnMfgReleaseRoutes={
    'POST /api/org/pln-mfg/foundation/effective':[
        orgRoute('org.mfg.foundation.effective','MFG.view',async ctx=>{
            const kind=kindOf(ctx.body.kind),skuId=idOf(ctx.body.skuId);
            const siteId=str(ctx.body.siteId).trim(),date=str(ctx.body.date).trim();
            if(siteId&&!idPattern.test(siteId))throw new HttpError(400,'Invalid production site.');
            if(!await authorized(ctx,'MFG.view',siteId))
                throw new HttpError(403,'This production site is outside your authorized scope.');
            const all=await listDocs(root(ctx.orgId,kind));
            const matching=all.filter(row=>str(kind==='boms'?row.data.parentSkuId:row.data.skuId)===skuId);
            const existingTypeIds=new Set(matching.filter(row=>
                !str(row.data.classificationCode)&&!!str(row.data.type)).map(row=>row.id));
            const records=matching.map(row=>{
                const data={...row.data};
                if(kind==='boms'){
                    data.classificationCode=bomClassificationCode(row.data);
                    data.productVariantId=str(data.productVariantId)||str(data.flavorVariantId);
                    delete data.type;delete data.flavorVariantId;
                }
                return {id:row.id,...data,alternativeCode:str(data.alternativeCode)};
            });
            if(kind==='boms'){
                const usage=str(ctx.body.usage)||'PRODUCTION';
                if(!['PRODUCTION','MRP','VIEW'].includes(usage))
                    throw new HttpError(400,'Choose production, MRP or view usage.');
                const configured=(await mfgMaterialPolicyForOrg(ctx.orgId)).policy.bomClassifications;
                const requestedClassification=str(ctx.body.classificationCode).toUpperCase();
                const requestedAlternative=str(ctx.body.alternativeCode);
                const groups=new Map<string,typeof records>();
                for(const record of records){
                    const classificationCode=bomClassificationCode(record);
                    const alternative=bomAlternative(record.alternativeCode);
                    if(requestedClassification&&classificationCode!==requestedClassification)continue;
                    if(requestedAlternative&&alternative!==bomAlternative(requestedAlternative))continue;
                    const cls=configured.find(c=>c.code===classificationCode);
                    if(usage!=='VIEW'&&!existingTypeIds.has(record.id)&&
                        (!cls||!cls.enabled||(usage==='MRP'?!cls.mrpRelevant:!cls.productionEligible)))continue;
                    const key=classificationCode+'__'+alternative,list=groups.get(key)||[];
                    list.push(record);groups.set(key,list);
                }
                const options=[...groups.entries()].map(([key,versions])=>{
                    const selected=selectEffectiveForSite(versions,date,siteId);
                    return selected?{classificationCode:bomClassificationCode(selected),
                        alternativeCode:bomAlternative(selected.alternativeCode),record:selected}:null;
                }).filter((x):x is NonNullable<typeof x>=>x!==null);
                const record=options.length===1?options[0].record:null;
                return {kind,skuId,siteId,date,record,available:!!record,
                    requiresSelection:options.length>1,options,
                    explanation:options.length>1?'Choose an explicit BOM classification and alternative for this production version':
                        record?'Approved effective BOM alternative':'No approved BOM alternative is effective'};
            }
            const requestedAlternative=str(ctx.body.alternativeCode);
            const alternatives=new Map<string,typeof records>();
            for(const record of records){
                const alternative=bomAlternative(record.alternativeCode);
                if(requestedAlternative&&alternative!==bomAlternative(requestedAlternative))continue;
                const list=alternatives.get(alternative)||[];
                list.push(record);alternatives.set(alternative,list);
            }
            const options=[...alternatives.entries()].map(([alternativeCode,versions])=>{
                const selected=selectEffectiveForSite(versions,date,siteId);
                return selected?{alternativeCode,record:selected}:null;
            }).filter((x):x is NonNullable<typeof x>=>x!==null);
            const selected=options.length===1?options[0].record:null;
            return {kind,skuId,siteId,date,record:selected,available:!!selected,
                requiresSelection:options.length>1,options,
                explanation:options.length>1?'Choose an explicit approved routing alternative':
                    selected?'Approved effective manufacturing version':'No approved version is effective for the selected site and date'};
        }),
    ],
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
            if(kind==='routings'&&doc.data.routingModelVersion===2){
                const review=await reviewManufacturingRouting(ctx,doc.data);
                if(!review.ready)
                    throw new HttpError(409,'Routing is not ready for approval: '+
                        review.issues.slice(0,4).map(i=>i.stageCode+': '+i.message).join('; '));
            }
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
                if(kind==='routings'&&doc.data.routingModelVersion===2){
                    const review=await reviewManufacturingRouting(ctx,doc.data);
                    if(!review.ready)
                        throw new HttpError(409,'Routing release readiness changed: '+
                            review.issues.slice(0,4).map(i=>i.stageCode+': '+i.message).join('; '));
                }
                const comparable=await listDocs(root(ctx.orgId,kind));
                const same=comparable.filter(other=>other.id!==id&&str(other.data.status)==='active'&&
                    str(other.data.siteId)===str(doc.data.siteId)&&
                    str(other.data.effectiveFrom)===str(doc.data.effectiveFrom)&&
                    (kind==='boms'
                        ?str(other.data.parentSkuId)===str(doc.data.parentSkuId)&&
                            bomClassificationCode(other.data)===bomClassificationCode(doc.data)&&
                            bomAlternative(other.data.alternativeCode)===bomAlternative(doc.data.alternativeCode)
                        :str(other.data.skuId)===str(doc.data.skuId)&&
                            bomAlternative(other.data.alternativeCode)===bomAlternative(doc.data.alternativeCode)));
                if(same.length)throw new HttpError(409,'Another approved version already applies to this SKU, site and effective date.');
            }
            const at=nowIso(),status=decision==='approve'?'active':'rejected';
            const data={...doc.data,status,decisionNote:note,decidedAt:at,decidedBy:ctx.uid,
                ...(status==='active'?{approvedAt:at,approvedBy:ctx.uid}:{})};
            // Lock the unique approved SKU/site/effective-date slot in the same Firestore
            // commit. Two simultaneous approvals cannot publish conflicting versions.
            const skuId=str(kind==='boms'?doc.data.parentSkuId:doc.data.skuId);
            const slotKey=[kind,str(doc.data.siteId)||'ORG',skuId,
                ...(kind==='boms'?[bomReleaseSlotGroup(doc.data),bomAlternative(doc.data.alternativeCode)]:
                    kind==='routings'&&doc.data.routingModelVersion===2?[bomAlternative(doc.data.alternativeCode)]:[]),
                str(doc.data.effectiveFrom)||'BASE'].join('__');
            const slotPath='organizations/'+ctx.orgId+'/mfg_release_slots/'+slotKey;
            const saved=await commitChecked([
                {path,data,precondition:{updateTime:doc.updateTime}},
                {path:path+'/release_events/'+randomId(10),data:{action:decision,kind,revision:doc.data.revision,by:ctx.uid,at,note},precondition:{exists:false}},
                ...(status==='active'?[{path:slotPath,data:{kind,skuId,siteId:str(doc.data.siteId),effectiveFrom:str(doc.data.effectiveFrom),
                    ...(kind==='boms'?{classificationCode:bomClassificationCode(doc.data),alternativeCode:bomAlternative(doc.data.alternativeCode)}:
                        kind==='routings'?{alternativeCode:bomAlternative(doc.data.alternativeCode)}:{}),
                    masterId:id,activatedAt:at,activatedBy:ctx.uid},precondition:{exists:false}}]:[]),
            ]);
            if(!saved)throw new HttpError(409,'This release changed. Refresh and decide again.');
            await auditAction(ctx,'mfg.release.'+decision,kind+':'+id,note||'Technical manufacturing release decision');
            return {ok:true,status};
        }),
    ],
};
