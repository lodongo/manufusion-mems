/**
 * Organization-managed SKU parameters and database-managed three-letter codes.
 * Separate from physical Inventory and from the future manufacturing batch ledger.
 */
import { HttpError, commitChecked, getDoc, isObj, listDocs, nowIso, num, str, type Obj } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { audit } from './audit';
import { PROCUREMENT_UNITS } from './procurementUnits';
import {DEFAULT_SKU_NAMING_SEQUENCE,validateSkuNamingSequence,type SkuNamingSequence} from '../src/shared/mfgSkuNaming';
import { primaryContainerCatalogueFromAdmin } from './mfgPrimaryContainerMetadata';
import {normalizePackagingTypes,packagingHierarchyRank} from './mfgPackagingMetadata';
import {
    SKU_PARAMETERS, SKU_PARAMETER_KINDS, managedCode, normalizeSkuParameter, skuUnitCategories,
    packagingPrimaryContainerCount,
    type SkuParameter, type SkuParameterKind,
} from './mfgSkuModel';

const pathRoot=(orgId:string)=>'organizations/'+orgId;
const SEQ=(orgId:string,prefix:string)=>pathRoot(orgId)+'/mfg_code_sequences/'+prefix;
const PARAMS=(orgId:string)=>pathRoot(orgId)+'/mfg_sku_parameters';
const NAMING=(orgId:string)=>pathRoot(orgId)+'/mfg_sku_naming/config';

export async function namingSequenceForOrg(orgId:string):Promise<{
    sequence:SkuNamingSequence;revision:number;configured:boolean;
}>{
    const doc=await getDoc(NAMING(orgId));
    if(!doc)return {sequence:DEFAULT_SKU_NAMING_SEQUENCE,revision:0,configured:false};
    try{
        return {sequence:validateSkuNamingSequence(doc.data.sequence),
            revision:num(doc.data.revision)??1,configured:true};
    }catch{
        // Do not silently apply an invalid stored rule to new SKUs.
        throw new HttpError(409,'The saved SKU naming sequence is invalid. Contact the module administrator.');
    }
}
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
async function currentPackagingTypes(){
    const published=await getDoc('module_workspaces/MFG/metadata/packagingTypes');
    return normalizePackagingTypes(published?.data.items);
}
export const mfgSkuConfigurationRoutes={
    'POST /api/org/pln-mfg/sku/naming/save':[
        orgRoute('org.mfg.sku.naming.save','MFG.sku.configure',async ctx=>{
            if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'MFG.sku.configure'))
                throw new HttpError(403,'Organization SKU naming configuration requires a directly assigned administrator.');
            let sequence:SkuNamingSequence;
            try{sequence=validateSkuNamingSequence(ctx.body.sequence);}
            catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid SKU naming sequence.');}
            const path=NAMING(ctx.orgId),old=await getDoc(path);
            const currentRevision=old?(num(old.data.revision)??1):0;
            if(Number(ctx.body.expectedRevision)!==currentRevision)
                throw new HttpError(409,'The SKU naming configuration changed. Refresh before saving.');
            const revision=currentRevision+1,now=nowIso();
            const data={sequence,revision,updatedAt:now,updatedBy:ctx.uid};
            const committed=await commitChecked([{
                path,data,precondition:old?{updateTime:old.updateTime}:{exists:false},
            }]);
            if(!committed)throw new HttpError(409,'The SKU naming sequence changed during save.');
            await log(ctx,'mfg.sku.naming.update','naming:'+revision);
            return {sequence,revision,configured:true};
        }),
    ],
    'POST /api/org/pln-mfg/sku/setup':[
        orgRoute('org.mfg.sku.setup','MFG.view',async ctx=>{
            const [params,types,packagingTypes,naming]=await Promise.all([
                skuParametersForOrg(ctx.orgId),currentPrimaryContainerCatalogue(),currentPackagingTypes(),
                namingSequenceForOrg(ctx.orgId),
            ]);
            const packagingCategories=[...new Map(packagingTypes.map(t=>[t.category,
                {code:t.code.slice(0,3),name:t.category,level:t.level}])).values()];
            const primaryCategories=[...new Map(types.map(t=>[t.categoryCode,
                {code:t.categoryCode,name:t.category,sectors:t.sectors}])).values()];
            return {parameters:params,groups:SKU_PARAMETERS,
                namingSequence:naming.sequence,namingRevision:naming.revision,namingConfigured:naming.configured,
                // MEMS MFG platform master data, adopted by organization Physical Containers.
                primaryContainerMetadata:{
                    version:1,categories:primaryCategories,types,
                },
                packagingMetadata:{version:1,categories:packagingCategories,types:packagingTypes},
                categories:skuUnitCategories(),
                units:PROCUREMENT_UNITS.filter(x=>x.active&&x.selectable)
                    .map(x=>({code:x.code,label:x.label,symbol:x.symbol,category:x.category,
                        categoryCode:x.categoryCode,baseUnit:x.baseUnit,multiplier:x.multiplier})),
                conventions:{
                    items:'SKU',boms:'BOM',resources:'RSC',
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
            const existingId=str(input.id);
            if((kind==='packages'||kind==='transportPackages')&&!existingId&&!str(input.packagingTypeCode))
                throw new HttpError(400,'Choose a published MEMS packaging type before creating container packaging.');
            const all=await skuParametersForOrg(ctx.orgId);
            if(kind==='normalizationUnits'){
                const referenceFormId=str(input.referenceProductionFormId);
                if(!referenceFormId&&!existingId)
                    throw new HttpError(400,'Select a production form to define the normalized case reference.');
                if(referenceFormId){
                    const refForm=all.find(p=>p.kind==='productionForms'&&p.id===referenceFormId&&p.enabled!==false);
                    if(!refForm||!str(refForm.uom))
                        throw new HttpError(400,'Select an active production form from this organization.');
                    // The canonical reference UoM comes from the production form, not
                    // a free-text conversion factor or a second independently edited unit.
                    input.baseUom=refForm.uom;
                }
            }
            const normalized=normalizeSkuParameter(kind,input,
                kind==='containers'?await currentPrimaryContainerCatalogue():undefined,
                kind==='packages'||kind==='transportPackages'?await currentPackagingTypes():undefined);
            if(kind==='packages'&&normalized.containedUnit==='PACKAGING'&&normalized.containersPerLayer){
                if(normalized.containedPackagingId===existingId)
                    throw new HttpError(400,'A container packaging record cannot contain itself.');
                const child=all.find(p=>p.kind==='packages'&&p.id===normalized.containedPackagingId&&p.enabled!==false);
                if(!child)throw new HttpError(400,'Select an active lower-level container packaging record.');
                if(packagingHierarchyRank(str(child.packagingTypeCode))>=packagingHierarchyRank(str(normalized.packagingTypeCode)))
                    throw new HttpError(400,'A consolidated load must contain a lower-level packaging type, for example a pallet containing cases.');
                // Reject cycles (including edits to an existing ancestor) and excessive
                // resulting counts before anything is committed to the database.
                packagingPrimaryContainerCount({...normalized,id:existingId||'PKG_PENDING'} as SkuParameter,
                    [...all.filter(p=>p.id!==existingId)]);
            }
            if(all.some(p=>p.kind===kind&&p.id!==existingId&&p.name.trim().toLocaleLowerCase()===normalized.name.toLocaleLowerCase()))
                throw new HttpError(409,'That SKU parameter name already exists in this category.');
            if(kind==='productNames'&&all.some(p=>p.kind==='productNames'&&p.id!==existingId&&
                str(p.productCode).trim().toUpperCase()===str(normalized.productCode).trim().toUpperCase()))
                throw new HttpError(409,'The Product/Variant code is already in use.');
            if(kind==='processClasses'&&all.some(p=>p.kind==='processClasses'&&p.id!==existingId&&
                str(p.processCode).trim().toUpperCase()===str(normalized.processCode).trim().toUpperCase()))
                throw new HttpError(409,'The manufacturing process classification code is already in use. Choose another code.');
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
            if(kind==='processClasses'&&normalized.enabled===false&&prior.data.enabled!==false){
                // Class records are referenced by organization-wide SKUs and
                // site-specific routes. Prevent disabling a group that is in use;
                // do not cascade or silently rewrite an existing SKU/site mapping.
                const [skus,routes]=await Promise.all([
                    listDocs(pathRoot(ctx.orgId)+'/mfg_items'),
                    listDocs(pathRoot(ctx.orgId)+'/mfg_routings'),
                ]);
                if(skus.some(row=>str(row.data.processClassId)===existingId)||
                    routes.some(row=>str(row.data.processClassId)===existingId))
                    throw new HttpError(409,'This manufacturing process classification is in use by SKUs or routes. Reclassify the affected records before deactivating it.');
            }
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
