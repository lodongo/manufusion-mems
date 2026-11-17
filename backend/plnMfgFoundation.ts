/**
 * PLN/MFG Phase 1 foundation: shared product, versioned BOM/recipe, resources and routings.
 * The module does not create stock, purchase requisitions or accounting entries.
 * Firestore is tenant-scoped through orgRoute; mutations use optimistic concurrency.
 */
import { HttpError, getDoc, isObj, listDocs, nowIso, num, str, writeDoc, type Obj, type Plain } from './core';
import { orgRoute, type OrgContext } from './guards';
import { audit } from './audit';
import { getNode } from './structure';

export const MASTER_KINDS = ['items', 'boms', 'resources', 'routings'] as const;
export type MasterKind = typeof MASTER_KINDS[number];
const COLLECTION: Record<MasterKind,string> = {
    items: 'mfg_items', boms: 'mfg_boms', resources: 'mfg_resources', routings: 'mfg_routings',
};
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,59}$/;
const ROOT = (orgId:string, kind:MasterKind) => 'organizations/'+orgId+'/'+COLLECTION[kind];
const DOC = (orgId:string, kind:MasterKind, id:string) => ROOT(orgId,kind)+'/'+id;
const ARR = (v:unknown): Obj[] => Array.isArray(v) ? v.filter(isObj) : [];
const REQUIRED = (v:unknown,label:string,max=120):string => {
    const x=str(v).trim(); if(!x||x.length>max) throw new HttpError(400,label+' is required (up to '+max+' characters).'); return x;
};
const POSITIVE = (v:unknown,label:string):number => {
    const x=typeof v==='number'?v:Number(v);if(!Number.isFinite(x)||x<=0||x>1e12)throw new HttpError(400,label+' must be greater than zero.');return x;
};
const NONNEGATIVE = (v:unknown,label:string,max=1e12):number => {
    const x=typeof v==='number'?v:Number(v);if(!Number.isFinite(x)||x<0||x>max)throw new HttpError(400,label+' must be a valid nonnegative number.');return x;
};
const VALID_ID = (v:unknown,label='Code') => {const x=REQUIRED(v,label,60);if(!ID.test(x))throw new HttpError(400,label+' must contain letters, numbers, underscores or hyphens.');return x;};
const UOM=(v:unknown)=>{const x=REQUIRED(v,'Unit of measure',20);if(!CODE.test(x))throw new HttpError(400,'Invalid unit code.');return x;};
const ENUM=<T extends string>(v:unknown, options:readonly T[],label:string):T=>{
    if(!options.includes(v as T))throw new HttpError(400,'Invalid '+label+'.');return v as T;
};
const STAGES=['RAW','INTERMEDIATE','FINISHED','PACKAGING'] as const;
const RESOURCE_TYPES=['LINE','WORK_CENTER','MACHINE','BATCH_VESSEL','ASSEMBLY_CELL','OTHER'] as const;
const BOM_TYPES=['BOM','RECIPE'] as const;

/** Validation is shared with executable tests; rejects malformed graphs before persistence. */
export function normalizeMaster(kind:MasterKind, raw:unknown): Obj {
    if(!isObj(raw))throw new HttpError(400,'A master-data object is required.');
    const id=VALID_ID(raw.id,'Master code'), name=REQUIRED(raw.name,'Name',160);
    const siteId=str(raw.siteId).trim();
    if(siteId&&!ID.test(siteId))throw new HttpError(400,'Invalid site code.');
    const base:Obj={id,name,siteId,description:str(raw.description).slice(0,600)};
    if(kind==='items'){
        const category=ENUM(raw.category,STAGES,'item category');
        const inventoryMaterialId=str(raw.inventoryMaterialId).trim();
        if(inventoryMaterialId&&!ID.test(inventoryMaterialId))throw new HttpError(400,'Invalid Inventory material reference.');
        if((category==='RAW'||category==='PACKAGING')&& !inventoryMaterialId)throw new HttpError(400,'Raw materials must refer to the existing Inventory material master. Demo raw materials are available as read-only samples.');
        return {...base,category,family:str(raw.family).slice(0,100),uom:UOM(raw.uom),inventoryMaterialId,packQty:POSITIVE(raw.packQty??1,'Pack quantity')};
    }
    if(kind==='resources'){
        return {...base,type:ENUM(raw.type,RESOURCE_TYPES,'resource type'),rate:POSITIVE(raw.rate,'Rated units per hour'),rateUom:UOM(raw.rateUom),assetId:str(raw.assetId).slice(0,60),efficiency:NONNEGATIVE(raw.efficiency??100,'Efficiency percentage',100)};
    }
    if(kind==='boms'){
        const type=ENUM(raw.type,BOM_TYPES,'BOM/recipe type');
        const parentSkuId=VALID_ID(raw.parentSkuId,'Parent SKU');
        const components=ARR(raw.components);
        if(!components.length||components.length>150)throw new HttpError(400,'A BOM/recipe must have 1–150 components.');
        const seen=new Set<string>();
        const lines=components.map((c,i)=>{
            const skuId=VALID_ID(c.skuId,'Component SKU');
            if(skuId===parentSkuId)throw new HttpError(400,'A SKU cannot consume itself.');
            if(seen.has(skuId))throw new HttpError(400,'Duplicate component SKU '+skuId+'. Combine quantities in one line.');
            seen.add(skuId);
            return {line:i+1,skuId,quantity:POSITIVE(c.quantity,'Component quantity'),uom:UOM(c.uom),scrapPct:NONNEGATIVE(c.scrapPct??0,'Scrap percentage',100)};
        });
        return {...base,type,parentSkuId,outputQty:POSITIVE(raw.outputQty??1,'Output basis'),outputUom:UOM(raw.outputUom),components:lines as unknown as Plain,effectiveFrom:str(raw.effectiveFrom).slice(0,10),versionNote:str(raw.versionNote).slice(0,300)};
    }
    const skuId=VALID_ID(raw.skuId,'Routed SKU');
    const operations=ARR(raw.operations);
    if(!operations.length||operations.length>60)throw new HttpError(400,'A routing must have 1–60 operations.');
    const codes=new Set<string>();
    const steps=operations.map((o,i)=>{
        const code=VALID_ID(o.code,'Operation code');
        if(codes.has(code))throw new HttpError(400,'Duplicate operation '+code+'.');
        codes.add(code);
        return {code,sequence:i+1,name:REQUIRED(o.name,'Operation name',120),resourceId:VALID_ID(o.resourceId,'Resource code'),setupMinutes:NONNEGATIVE(o.setupMinutes??0,'Setup minutes',100000),runMinutesPerUnit:NONNEGATIVE(o.runMinutesPerUnit??0,'Minutes per output unit',100000)};
    });
    return {...base,skuId,operations:steps as unknown as Plain};
}

export function detectBomCycle(boms:Array<{parentSkuId:string;components:Array<{skuId:string}>}>,parentSkuId:string,components:Array<{skuId:string}>):boolean {
    const byParent=new Map(boms.map(b=>[b.parentSkuId,b.components.map(c=>c.skuId)]));
    byParent.set(parentSkuId,components.map(c=>c.skuId));
    const active=new Set<string>(), visited=new Set<string>();
    const visit=(node:string):boolean=>{
        if(active.has(node))return true;
        if(visited.has(node))return false;
        active.add(node);
        for(const child of byParent.get(node)??[])if(visit(child))return true;
        active.delete(node);visited.add(node);return false;
    };
    return visit(parentSkuId);
}

async function referenceChecks(ctx:OrgContext,kind:MasterKind,item:Obj,existingId:string) {
    const siteId=str(item.siteId);
    if(siteId){
        const site=await getNode(ctx,siteId);
        if(str(site.data.level)!=='site')throw new HttpError(400,'Choose an actual organization site.');
    }
    if(kind==='boms'){
        const parent=await getDoc(DOC(ctx.orgId,'items',str(item.parentSkuId)));
        if(!parent)throw new HttpError(400,'Parent SKU does not exist in Manufacturing master data.');
        if(str(parent.data.category)==='RAW')throw new HttpError(400,'Raw materials cannot be manufactured as a BOM output.');
        const components=ARR(item.components);
        for(const c of components){
            if(!await getDoc(DOC(ctx.orgId,'items',str(c.skuId))))throw new HttpError(400,'Component '+str(c.skuId)+' is missing from SKU master.');
        }
        const others=(await listDocs(ROOT(ctx.orgId,'boms')))
            .filter(d=>d.id!==existingId)
            .map(d=>({parentSkuId:str(d.data.parentSkuId),components:ARR(d.data.components).map(c=>({skuId:str(c.skuId)}))}));
        if(detectBomCycle(others,str(item.parentSkuId),components.map(c=>({skuId:str(c.skuId)}))))
            throw new HttpError(400,'The BOM introduces a circular manufacturing dependency.');
    }
    if(kind==='routings'){
        if(!await getDoc(DOC(ctx.orgId,'items',str(item.skuId))))throw new HttpError(400,'Routing SKU not found.');
        for(const o of ARR(item.operations))
            if(!await getDoc(DOC(ctx.orgId,'resources',str(o.resourceId))))
                throw new HttpError(400,'Routing resource '+str(o.resourceId)+' not found.');
    }
}

const track=(ctx:OrgContext,action:string,target:string)=>
    audit([{category:'data',action,actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,target:{label:target},details:'Production master data; approval and release remain separate from draft editing.'}]);
const out=(d:{id:string;data:Obj;updateTime?:string})=>({id:d.id,...d.data,updatedAt:str(d.data.updatedAt),revision:num(d.data.revision)??1});
const readKind=(v:unknown):MasterKind=>ENUM(v,MASTER_KINDS,'master-data kind');

/** Demo data is read-only and never writes to live stock/finance/procurement. */
export function fictionalLine11Demo(){
    // Read-only reference scenario, never written to an organization or Inventory ledger.
    const items=[
        {id:'DEMO-RAW-WATER',name:'Fictional untreated water',category:'RAW',uom:'L'},
        {id:'DEMO-MINERAL',name:'Fictional beverage treatment mineral',category:'RAW',uom:'KG'},
        {id:'DEMO-PREFORM-500',name:'Fictional 500 mL PET preform',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-PREFORM-1000',name:'Fictional 1 L PET preform',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-CAP',name:'Fictional 2622 cap',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-LABEL-500',name:'Fictional 500 mL label',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-LABEL-1000',name:'Fictional 1 L label',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-CASE',name:'Fictional 12-bottle case material',category:'PACKAGING',uom:'EA'},
        {id:'DEMO-PREPARED-WATER',name:'Fictional prepared beverage water',category:'INTERMEDIATE',uom:'L'},
        {id:'DEMO-BOTTLE-500',name:'Fictional 500 mL blown PET bottle',category:'INTERMEDIATE',uom:'EA'},
        {id:'DEMO-BOTTLE-1000',name:'Fictional 1 L blown PET bottle',category:'INTERMEDIATE',uom:'EA'},
        {id:'DEMO-FILLED-500',name:'Fictional filled 500 mL bottle',category:'INTERMEDIATE',uom:'EA'},
        {id:'DEMO-FILLED-1000',name:'Fictional filled 1 L bottle',category:'INTERMEDIATE',uom:'EA'},
        {id:'DEMO-FG-500',name:'Fictional PET water 500 mL x 12',category:'FINISHED',uom:'CASE'},
        {id:'DEMO-FG-1000',name:'Fictional PET water 1 L x 12',category:'FINISHED',uom:'CASE'},
    ];
    const c=(skuId:string,quantity:number,uom:string,scrapPct=0)=>({skuId,quantity,uom,scrapPct});
    const boms=[
        {id:'DEMO-RECIPE-WATER',type:'RECIPE',name:'Prepare fictional beverage water',parentSkuId:'DEMO-PREPARED-WATER',outputQty:1000,outputUom:'L',components:[c('DEMO-RAW-WATER',1000,'L',1),c('DEMO-MINERAL',0.3,'KG')]},
        {id:'DEMO-BOM-BLOW-500',type:'BOM',name:'Blow 500 mL PET bottle',parentSkuId:'DEMO-BOTTLE-500',outputQty:1,outputUom:'EA',components:[c('DEMO-PREFORM-500',1,'EA',1)]},
        {id:'DEMO-BOM-BLOW-1000',type:'BOM',name:'Blow 1 L PET bottle',parentSkuId:'DEMO-BOTTLE-1000',outputQty:1,outputUom:'EA',components:[c('DEMO-PREFORM-1000',1,'EA',1)]},
        {id:'DEMO-BOM-FILL-500',type:'BOM',name:'Fill and cap 500 mL',parentSkuId:'DEMO-FILLED-500',outputQty:1,outputUom:'EA',components:[c('DEMO-BOTTLE-500',1,'EA',0.5),c('DEMO-CAP',1,'EA',1),c('DEMO-PREPARED-WATER',0.5,'L',1)]},
        {id:'DEMO-BOM-FILL-1000',type:'BOM',name:'Fill and cap 1 L',parentSkuId:'DEMO-FILLED-1000',outputQty:1,outputUom:'EA',components:[c('DEMO-BOTTLE-1000',1,'EA',0.5),c('DEMO-CAP',1,'EA',1),c('DEMO-PREPARED-WATER',1,'L',1)]},
        {id:'DEMO-BOM-PACK-500',type:'BOM',name:'Label and case pack 500 mL',parentSkuId:'DEMO-FG-500',outputQty:1,outputUom:'CASE',components:[c('DEMO-FILLED-500',12,'EA',0.5),c('DEMO-LABEL-500',12,'EA',1),c('DEMO-CASE',1,'EA',0.5)]},
        {id:'DEMO-BOM-PACK-1000',type:'BOM',name:'Label and case pack 1 L',parentSkuId:'DEMO-FG-1000',outputQty:1,outputUom:'CASE',components:[c('DEMO-FILLED-1000',12,'EA',0.5),c('DEMO-LABEL-1000',12,'EA',1),c('DEMO-CASE',1,'EA',0.5)]},
    ];
    const resources=[
        {id:'DEMO-PREP',name:'Fictional water preparation',type:'BATCH_VESSEL',rate:4000,rateUom:'L',efficiency:90},
        {id:'DEMO-BLOW',name:'Fictional Line 11 bottle blowing',type:'MACHINE',rate:28000,rateUom:'EA',efficiency:85},
        {id:'DEMO-FILL',name:'Fictional KHS PET Line 11 filling',type:'LINE',rate:28000,rateUom:'EA',efficiency:80},
        {id:'DEMO-PACK',name:'Fictional Line 11 case packing',type:'WORK_CENTER',rate:2000,rateUom:'CASE',efficiency:80},
    ];
    const route=(id:string,name:string,skuId:string)=>({id,name,skuId,operations:[
        {code:'PREP',name:'Water preparation',resourceId:'DEMO-PREP'},
        {code:'BLOW',name:'PET bottle blowing',resourceId:'DEMO-BLOW'},
        {code:'FILL',name:'Fill and cap',resourceId:'DEMO-FILL'},
        {code:'PACK',name:'Label, pack and palletize',resourceId:'DEMO-PACK'},
    ]});
    const routings=[route('DEMO-ROUTE-500','Fictional 500 mL multi-stage process','DEMO-FG-500'),route('DEMO-ROUTE-1000','Fictional 1 L multi-stage process','DEMO-FG-1000')];
    return {demo:true,persisted:false,isolated:true,label:'READ-ONLY FICTIONAL DATA — no purchasing, inventory or finance postings',items,boms,resources,routings};
}

export const plnMfgFoundationRoutes={
    'POST /api/org/pln-mfg/foundation/list':[
        orgRoute('org.mfg.foundation.list','MFG.view',async ctx=>{
            const kind=readKind(ctx.body.kind);
            return {kind,records:(await listDocs(ROOT(ctx.orgId,kind))).map(out)};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/save':[
        orgRoute('org.mfg.foundation.save','MFG.master.edit',async ctx=>{
            const kind=readKind(ctx.body.kind);
            if(kind==='boms'&&!ctx.permissions.includes('*')&&!ctx.permissions.includes('MFG.bom.edit')&&ctx.role!=='org_super_admin')
                throw new HttpError(403,'BOM and recipe editing permission required.');
            if(kind==='routings'&&!ctx.permissions.includes('*')&&!ctx.permissions.includes('MFG.routing.edit')&&ctx.role!=='org_super_admin')
                throw new HttpError(403,'Routing editing permission required.');
            const item=normalizeMaster(kind,ctx.body.record);
            const id=str(item.id),path=DOC(ctx.orgId,kind,id);
            const existing=await getDoc(path);
            const expected=ctx.body.expectedRevision;
            if(existing && Number(expected)!==(num(existing.data.revision)??1))
                throw new HttpError(409,'This record was edited by another user. Refresh and retry.');
            if(!existing && expected!==0)throw new HttpError(409,'This record already exists or the new-record revision was not supplied.');
            await referenceChecks(ctx,kind,item,id);
            const now=nowIso();
            const revision=existing?(num(existing.data.revision)??1)+1:1;
            const data={...item,status:'draft',revision,createdAt:existing?str(existing.data.createdAt)||now:now,createdBy:existing?str(existing.data.createdBy)||ctx.uid:ctx.uid,updatedAt:now,updatedBy:ctx.uid};
            const ok=await writeDoc(path,data,existing?{updateTime:existing.updateTime}:{exists:false});
            if(!ok)throw new HttpError(409,'This record changed before saving. Please reload.');
            await track(ctx,'mfg.master.save',kind+':'+id);
            return {record:{...data},ok:true};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/config':[
        orgRoute('org.pln.foundation.config.view','PLN.view',async ctx=>{
            const doc=await getDoc('organizations/'+ctx.orgId+'/pln_config/master');
            return {config:doc?.data??{horizonDays:90,freezeDays:7,lotPolicy:'LOT_FOR_LOT',strategy:'MTS'},revision:num(doc?.data.revision)??0};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/config/save':[
        orgRoute('org.pln.foundation.config.save','PLN.configure',async ctx=>{
            const raw=isObj(ctx.body.config)?ctx.body.config:{};
            const horizonDays=POSITIVE(raw.horizonDays,'Horizon days'),freezeDays=NONNEGATIVE(raw.freezeDays,'Freeze days',3650);
            if(horizonDays>3650||freezeDays>horizonDays)throw new HttpError(400,'Freeze period must fit within the planning horizon.');
            const lotPolicy=ENUM(raw.lotPolicy,['LOT_FOR_LOT','FIXED','MIN_MAX','PERIOD','OPTIMIZED'] as const,'lot sizing rule');
            const strategy=ENUM(raw.strategy,['MTS','MTO','ATO','ETO','HYBRID'] as const,'production strategy');
            const path='organizations/'+ctx.orgId+'/pln_config/master';
            const prev=await getDoc(path),old=num(prev?.data.revision)??0;
            if(Number(ctx.body.expectedRevision)!==old)throw new HttpError(409,'Configuration changed. Reload and retry.');
            const config={horizonDays,freezeDays,lotPolicy,strategy,revision:old+1,updatedAt:nowIso(),updatedBy:ctx.uid};
            const ok=await writeDoc(path,config,prev?{updateTime:prev.updateTime}:{exists:false});
            if(!ok)throw new HttpError(409,'Concurrent planning configuration update detected.');
            await track(ctx,'pln.config.save','PLN planning configuration');
            return {config,revision:old+1};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/demo':[
        orgRoute('org.mfg.foundation.demo','MFG.view',async ()=>fictionalLine11Demo()),
    ],
};
