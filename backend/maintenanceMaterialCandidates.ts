/**
 * Planner-to-Materials Master handoff for assessed task spare requirements.
 * Planners create candidates, not approved material records. An authorized
 * catalogue maintainer completes the specification and creates the draft,
 * which then follows the existing Materials Master approval process.
 */
import { HttpError, getDoc, listDocs, nowIso, str, type Obj } from './core';
import { orgRoute, type OrgContext } from './guards';
import { canAt, scopeOf } from './access';
import { audit } from './audit';
import { commit, withLock } from './finCore';
import { catalogItemSpec, createMaterialDraft } from './procurement';
import { object, rows, identifier } from './maintenanceDomain';
import { stableJson } from './scopeGuard';

const base=(ctx:OrgContext)=>`organizations/${ctx.orgId}`;
async function maintainer(ctx:OrgContext, wo: {data:Obj}) {
    const path=Array.isArray(wo.data.path)?wo.data.path.map(str):[];
    if (!canAt(ctx, 'PRC.materials.manage', path, await scopeOf(ctx)))
        throw new HttpError(403,'Materials Master maintenance permission is required at this equipment location.');
}
export const maintenanceMaterialCandidateRoutes={
    'POST /api/org/mnt/material-candidates/list':[
        orgRoute('org.mnt.material_candidates.list','PRC.materials.manage',async(ctx)=>{
            const scope=await scopeOf(ctx);
            const docs=await listDocs(`${base(ctx)}/material_creation_candidates`);
            const items:Obj[]=[];
            for(const c of docs){
                const wo=await getDoc(`${base(ctx)}/work_orders/${str(c.data.woCode)}`);
                if(!wo||!canAt(ctx,'PRC.materials.manage',Array.isArray(wo.data.path)?wo.data.path.map(str):[],scope))continue;
                items.push({
                    id:c.id,...c.data,
                    workOrderTitle:str(wo.data.title),
                    workOrderStatus:str(wo.data.status),
                    siteName:str(wo.data.siteName),
                    equipmentName:str(wo.data.unitName),
                });
            }
            return {items:items.sort((a,b)=>str(b.updatedAt).localeCompare(str(a.updatedAt)))};
        })
    ],
    'POST /api/org/mnt/material-candidates/spec':[
        orgRoute('org.mnt.material_candidates.spec','PRC.materials.manage',async(ctx)=>{
            const spec=await catalogItemSpec('materials',str(ctx.body.catalogCode));
            if(!spec)throw new HttpError(404,'The technical catalogue item does not exist.');
            return {spec};
        })
    ],
    'POST /api/org/mnt/material-candidates/adopt':[
        orgRoute('org.mnt.material_candidates.adopt','PRC.materials.manage',async(ctx)=>
            withLock(ctx.orgId,'maintenance_operations',async()=>{
                const id=identifier(ctx.body.candidateId),
                    path=`${base(ctx)}/material_creation_candidates/${id}`,
                    candidate=await getDoc(path);
                if(!candidate)throw new HttpError(404,'The material creation candidate was not found.');
                if(candidate.data.materialDraftId)
                    return {ok:true,reused:true,materialDraftId:str(candidate.data.materialDraftId)};
                if(!['needs_specification','ready_for_material_creation'].includes(str(candidate.data.status)))
                    throw new HttpError(409,'The candidate is no longer awaiting specification or material creation.');
                const wo=await getDoc(`${base(ctx)}/work_orders/${identifier(candidate.data.woCode)}`);
                if(!wo)throw new HttpError(409,'The originating work order no longer exists.');
                await maintainer(ctx,wo);
                if(['cancelled','closed'].includes(str(wo.data.status)))
                    throw new HttpError(409,'The originating work order is no longer open.');
                if(Number(wo.data.assessmentTasksVersion)!==Number(candidate.data.assessmentVersion))
                    throw new HttpError(409,'This candidate refers to an obsolete work assessment.');
                const task=rows(wo.data.assessmentTasks).find(t=>t.id===candidate.data.taskId);
                const spare=task&&rows(task.spares).find(s=>s.id===candidate.data.spareId);
                if(!task||!spare)
                    throw new HttpError(409,'This candidate is no longer part of the assessed work-order task.');
                const code=str(ctx.body.catalogCode)||str(candidate.data.catalogCode),
                    spec=await catalogItemSpec('materials',code);
                if(!spec)throw new HttpError(400,'Complete a valid technical catalogue classification before creating the material.');
                const attrs={...object(candidate.data.attributes),...object(ctx.body.attributes)};
                const prior=(await listDocs(`${base(ctx)}/materials`)).find(m=>
                    m.data.materialCode===code &&
                    stableJson(object(m.data.attributes))===stableJson(attrs) &&
                    !['cancelled','rejected'].includes(str(m.data.status)));
                if(prior)
                    throw new HttpError(409,`Material ${prior.id} already has this technical specification. Use the existing material or complete its approval instead.`);
                const result=await createMaterialDraft({
                    ...ctx,body:{
                        materialCode:code,
                        categoryCode:spec.categoryCode,
                        subcategoryCode:spec.subcategoryCode,
                        familyCode:spec.familyCode,
                        name:str(spare.description),
                        attributes:attrs,
                    },
                });
                const planning=object(wo.data.taskPlanning),
                    taskState=object(planning[str(task.id)]),
                    priorState=object(taskState[str(spare.id)]);
                await commit([
                    {
                        path,
                        fields:{
                            ...candidate.data,catalogCode:code,catalogueSpecification:spec as unknown as Obj,
                            attributes:attrs,materialDraftId:result.id,
                            status:'awaiting_material_approval',processedAt:nowIso(),processedBy:ctx.uid,
                        },
                        updateTime:candidate.updateTime,
                    },
                    {
                        path:`${base(ctx)}/work_orders/${wo.id}`,
                        fields:{
                            taskPlanning:{
                                ...planning,
                                [str(task.id)]:{
                                    ...taskState,
                                    [str(spare.id)]:{
                                        ...priorState,candidateId:id,materialDraftId:result.id,
                                        catalogCode:code,status:'awaiting_material_approval',
                                    },
                                },
                            },
                            updatedAt:nowIso(),
                        },
                        mask:['taskPlanning','updatedAt'],
                        updateTime:wo.updateTime,
                    },
                ]);
                await audit([{category:'maintenance',action:'mnt.material_candidate.adopted',actor:ctx.actor,meta:ctx.meta,
                    target:{label:id},orgId:ctx.orgId,
                    details:`Work order ${wo.id}, task ${str(task.id)}, material draft ${result.id}`}]);
                return {ok:true,materialDraftId:result.id};
            })
        )
    ],
};
