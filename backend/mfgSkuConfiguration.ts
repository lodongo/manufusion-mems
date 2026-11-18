/**
 * Organization-managed SKU parameters and database-managed three-letter codes.
 * Separate from physical Inventory and from the future manufacturing batch ledger.
 */
import { HttpError, commitChecked, getDoc, isObj, listDocs, nowIso, num, str, type Obj } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { audit } from './audit';
import { PROCUREMENT_UNITS } from './procurementUnits';
import { MFG_PRIMARY_CONTAINER_CATEGORIES, MFG_PRIMARY_CONTAINER_TYPES, primaryContainerCatalogueFromAdmin } from './mfgPrimaryContainerMetadata';
import {
    SKU_PARAMETERS, SKU_PARAMETER_KINDS, managedCode, normalizeSkuParameter, skuUnitCategories,
    type SkuParameter, type SkuParameterKind,
} from './mfgSkuModel';

const pathRoot=(orgId:string)=>'organizations/'+orgId;
const SEQ=(orgId:string,prefix:string)=>pathRoot(orgId)+'/mfg_code_sequences/'+prefix;
const PARAMS=(orgId:string)=>pathRoot(orgId)+'/mfg_sku_parameters';
const ID_PATTERN=/^[A-Z]{3}_[0-9]{9}$/;

export async function commitGeneratedCode(
    orgId:string,
    prefix:string,
    docPath:(id:string)=>string,
    makeData:(id:string)=>Promise<Record<string,unknown>>|Record<string,unknown>,
    options?:{snapshotSubcollection?:string},
):Promise<{id:string;data:Record<string,unknown>}>{
    for(let attempt=0;attempt<35;attempt++){
        const counterPath=SEQ(orgId,prefix),counter=await getDoc(counterPath);
        const next=(num(counter?.data.lastSequence)??0)+1;
        const id=managedCode(prefix,next),path=docPath(id),data=await makeData(id),at=nowIso();
        const writes=[
            {path:counterPath,data:{prefix,lastSequence:next,updatedAt:at,lastCode:id},
                precondition:counter?{updateTime:counter.updateTime}:{exists:false}},
            {path,data,precondition:{exists:false}},
        ];
        if(options?.snapshotSubcollection)
            writes.push({path:path+'/'+options.snapshotSubcollection+'/000001',
                data:{...data,masterId:id,versionSnapshot:true},precondition:{exists:false}});
        const created=await commitChecked(writes);
        if(created)return {id,data};
    }
    throw new HttpError(409,'Unable to allocate a unique sequential '+prefix+' code after concurrent updates. Retry.');
}
const parameterKind=(v:unknown):SkuParameterKind=>{
    if(!SKU_PARAMETER_KINDS.includes(v as SkuParameterKind))throw new HttpError(400,'Unknown SKU configuration category.');
    return v as SkuParameterKind;
};
const log=(ctx:OrgContext,action:string,id:string)=>audit([{category:'data',action,actor:ctx.actor,
    orgId:ctx.orgId,meta:ctx.meta,target:{label:id},details:'Organization SKU master configuration'}]);

export async function skuParametersForOrg(orgId:string):Promise<SkuParameter[]>{
    const docs=await listDocs(PARAMS(orgId));
    return docs.map(d=>({id:d.id,...d.data} as SkuParameter))
        .filter(x=>SKU_PARAMETER_KINDS.includes(x.kind));
}

async function currentPrimaryContainerCatalogue(){
    const published=await getDoc('module_workspaces/MFG/metadata/primaryContainers');
    return primaryContainerCatalogueFromAdmin(published?.data.items);
}
export const mfgSkuConfigurationRoutes={
    'POST /api/org/pln-mfg/sku/setup':[
        orgRoute('org.mfg.sku.setup','MFG.view',async ctx=>{
            const [params,types]=await Promise.all([
                skuParametersForOrg(ctx.orgId),currentPrimaryContainerCatalogue(),
            ]);
            const primaryCategories=[...new Map(types.map(t=>[t.categoryCode,
                {code:t.categoryCode,name:t.category,sectors:t.sectors}])).values()];
            return {parameters:params,groups:SKU_PARAMETERS,
                // MEMS MFG platform master data, adopted by organization Physical Containers.
                primaryContainerMetadata:{
                    version:1,categories:primaryCategories,types,
                },
                categories:skuUnitCategories(),
                units:PROCUREMENT_UNITS.filter(x=>x.active&&x.selectable)
                    .map(x=>({code:x.code,label:x.label,symbol:x.symbol,category:x.category,
                        categoryCode:x.categoryCode,baseUnit:x.baseUnit,multiplier:x.multiplier})),
                conventions:{
                    items:'SKU',boms:'BOM',recipes:'RCP',resources:'RSC',
                    routings:'RTG',batches:'BTH',digits:9,
                }};
        }),
    ],
    'POST /api/org/pln-mfg/sku/setup/save':[
        orgRoute('org.mfg.sku.setup.save','MFG.sku.configure',async ctx=>{
            if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'MFG.sku.configure'))
                throw new HttpError(403,'Organization SKU configuration requires a directly assigned administrator.');
            const kind=parameterKind(ctx.body.kind);
            const input=isObj(ctx.body.parameter)?ctx.body.parameter:{};
            const normalized=normalizeSkuParameter(kind,input,
                kind==='containers'?await currentPrimaryContainerCatalogue():undefined);
            const existingId=str(input.id);
            const all=await skuParametersForOrg(ctx.orgId);
            if(all.some(p=>p.kind===kind&&p.id!==existingId&&p.name.trim().toLocaleLowerCase()===normalized.name.toLocaleLowerCase()))
                throw new HttpError(409,'That SKU parameter name already exists in this category.');
            if(kind==='productNames'&&all.some(p=>p.kind==='productNames'&&p.id!==existingId&&
                str(p.productCode).trim().toUpperCase()===str(normalized.productCode).trim().toUpperCase()))
                throw new HttpError(409,'The manually entered SKU name code is already in use.');
            if(kind==='containers'&&all.some(p=>p.kind==='containers'&&p.id!==existingId&&
                str(p.metadataCode)===str(normalized.metadataCode)&&p.enabled!==false))
                throw new HttpError(409,'This primary-container master type has already been adopted. Edit its attributes instead.');
            if(!existingId){
                if(Number(ctx.body.expectedRevision??0)!==0)throw new HttpError(409,'New parameters must begin at revision zero.');
                const newRecord=await commitGeneratedCode(ctx.orgId,SKU_PARAMETERS[kind],id=>PARAMS(ctx.orgId)+'/'+id,
                    id=>({...normalized,id,revision:1,createdAt:nowIso(),createdBy:ctx.uid,updatedAt:nowIso(),updatedBy:ctx.uid}));
                await log(ctx,'mfg.sku.parameter.create',newRecord.id);
                return {record:newRecord.data};
            }
            if(!ID_PATTERN.test(existingId)||!existingId.startsWith(SKU_PARAMETERS[kind]+'_'))
                throw new HttpError(400,'SKU configuration code must be database-generated.');
            const path=PARAMS(ctx.orgId)+'/'+existingId,prior=await getDoc(path);
            if(!prior||str(prior.data.kind)!==kind)throw new HttpError(404,'SKU configuration record not found.');
            if(Number(ctx.body.expectedRevision)!==(num(prior.data.revision)??1))
                throw new HttpError(409,'SKU parameter changed. Refresh before editing.');
            const data={...prior.data,...normalized,id:existingId,revision:(num(prior.data.revision)??1)+1,
                updatedBy:ctx.uid,updatedAt:nowIso()};
            if(!await commitChecked([{path,data,precondition:{updateTime:prior.updateTime}}]))
                throw new HttpError(409,'SKU parameter was changed concurrently.');
            await log(ctx,'mfg.sku.parameter.update',existingId);
            return {record:data};
        }),
    ],
    // Batch identifiers are reservations only. They do not create batch inventory,
    // release a production order, or back-post materials.
    'POST /api/org/pln-mfg/batches/new-code':[
        orgRoute('org.mfg.batch.new_code','MFG.batch.create',async ctx=>{
            const ref=str(ctx.body.reference).trim().slice(0,160);
            const record=await commitGeneratedCode(ctx.orgId,'BTH',
                id=>pathRoot(ctx.orgId)+'/mfg_batch_identifiers/'+id,
                id=>({id,reference:ref,status:'identifier_reserved',productionOrderId:'',
                    createdAt:nowIso(),createdBy:ctx.uid,inventoryPosted:false}));
            await log(ctx,'mfg.batch.identifier.reserve',record.id);
            return {id:record.id,status:'identifier_reserved',inventoryPosted:false};
        }),
    ],
};
