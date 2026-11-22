/**
 * Read-only, tenant-scoped SKU audit details.
 * Revision snapshots are the durable change source. Tenant security audit events
 * supply actor/action context; the bounded event query is reported as bounded.
 */
import {HttpError,getDoc,isObj,listDocs,num,runQuery,str,type Obj} from './core';
import {auditOut} from './audit';
import type {OrgContext} from './guards';

const AUDIT_IGNORE=new Set([
    'id','masterId','versionSnapshot','createdBy','createdAt',
    'updatedBy','updatedAt','revision',
]);
const stringify=(value:unknown):string=>{
    if(value===undefined||value===null||value==='')return 'Not set';
    if(typeof value==='string')return value;
    const result=JSON.stringify(value);
    return result===undefined?'Not set':result;
};
export type SkuFieldChange={field:string;before:string;after:string};
export function skuRevisionFieldChanges(before:Obj|null,after:Obj):SkuFieldChange[]{
    const changes:SkuFieldChange[]=[];
    const visit=(prefix:string,previous:unknown,next:unknown,level:number)=>{
        if(stringify(previous)===stringify(next))return;
        if(level<3&&(isObj(previous)||isObj(next))&&
            (previous===undefined||previous===null||isObj(previous))&&
            (next===undefined||next===null||isObj(next))){
            const a=isObj(previous)?previous:{};
            const b=isObj(next)?next:{};
            const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
            for(const key of keys){
                if(changes.length>=200)return;
                visit(prefix+'.'+key,a[key],b[key],level+1);
            }
            return;
        }
        if(changes.length<200)
            changes.push({field:prefix,before:stringify(previous),after:stringify(next)});
    };
    for(const key of [...new Set([...Object.keys(before||{}),...Object.keys(after)])].sort()){
        if(AUDIT_IGNORE.has(key)||changes.length>=200)continue;
        visit(key,before?.[key],after[key],0);
    }
    return changes;
}

const snapshotFingerprint=(data:Obj)=>JSON.stringify(Object.fromEntries(
    Object.keys(data).filter(key=>!AUDIT_IGNORE.has(key)).sort().map(key=>[key,data[key]])
));

export async function readSkuAuditLog(ctx:OrgContext,skuId:string){
    if(!/^SKU_[0-9]{9}$/.test(skuId)&&!/^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/.test(skuId))
        throw new HttpError(400,'Invalid SKU code.');
    const path='organizations/'+ctx.orgId+'/mfg_items/'+skuId;
    const master=await getDoc(path);
    if(!master)throw new HttpError(404,'SKU not found.');
    const [allRevisions,auditDocs]=await Promise.all([
        listDocs(path+'/revisions'),
        runQuery({
            from:[{collectionId:'audit_events'}],
            where:{fieldFilter:{
                field:{fieldPath:'targetLabel'},op:'EQUAL',
                value:{stringValue:'items:'+skuId},
            }},
            limit:500,
        },'organizations/'+ctx.orgId),
    ]);
    const revisions=allRevisions.map(row=>({data:row.data,current:false}))
        .sort((a,b)=>(num(a.data.revision)??0)-(num(b.data.revision)??0));
    const latest=revisions[revisions.length-1]?.data;
    if(!latest||snapshotFingerprint(latest)!==snapshotFingerprint(master.data)||
        (num(latest.revision)??0)!==(num(master.data.revision)??0))
        revisions.push({data:master.data,current:true});
    const limit=250,truncated=revisions.length>limit;
    const start=Math.max(0,revisions.length-limit);
    const entries=revisions.slice(start).map((snapshot,i)=>{
        const priorIndex=start+i-1;
        const previous=priorIndex>=0?revisions[priorIndex].data:null;
        const changes=skuRevisionFieldChanges(previous,snapshot.data);
        return {
            revision:num(snapshot.data.revision)??1,
            current:snapshot.current,
            action:previous?'Updated':'Created',
            at:str(snapshot.data.updatedAt)||str(snapshot.data.createdAt),
            actorUid:str(snapshot.data.updatedBy)||str(snapshot.data.createdBy),
            status:str(snapshot.data.status),
            changes,
            fieldsTruncated:changes.length>=200,
        };
    }).reverse();
    const events=auditDocs.map(auditOut)
        .filter(event=>event.target==='items:'+skuId)
        .sort((a,b)=>b.at.localeCompare(a.at))
        .map(event=>({
            id:event.id,at:event.at,action:event.action,
            actorUid:event.actorUid,actorEmail:event.actorEmail,
            actorRole:event.actorRole,outcome:event.outcome,
            priority:event.priority,controls:event.controls,
            details:event.details,
        }));
    return {skuId,name:str(master.data.name),currentRevision:num(master.data.revision)??1,
        entries,events,revisionHistoryLimited:truncated,
        auditEventLimitReached:auditDocs.length>=500};
}
