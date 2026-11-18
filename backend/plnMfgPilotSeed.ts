/**
 * Optional fictional Line 11 pilot data loader.
 *
 * This is NOT a materials import, ledger posting, procurement action, or a
 * manufacturing execution order. It writes only to a dedicated simulation
 * sub-tree, and only when the named tenant is in development test mode.
 * The fixture is repeatable and immutable once seeded.
 */
import { HttpError, commitChecked, getDoc, isObj, listDocs, nowIso, str } from './core';
import { orgRoute } from './guards';
import { testModeEnvironmentAllowed } from './testModeCore';
import { detectBomCycle, fictionalLine11Demo } from './plnMfgFoundation';
import { audit } from './audit';

const SANDBOX_ID='LINE11_KHS_FICTIONAL_V1';
const ROOT=(orgId:string)=>'organizations/'+orgId+'/mfg_demo_sandboxes/'+SANDBOX_ID;
const FIXTURE_STOCK=[
    {id:'RAW_WATER',skuId:'DEMO-RAW-WATER',quantity:900000,uom:'L',warehouse:'DEMO-INGREDIENTS',status:'available'},
    {id:'MINERAL',skuId:'DEMO-MINERAL',quantity:400,uom:'KG',warehouse:'DEMO-INGREDIENTS',status:'available'},
    {id:'PREFORM500',skuId:'DEMO-PREFORM-500',quantity:650000,uom:'EA',warehouse:'DEMO-PACKAGING',status:'available'},
    {id:'PREFORM1000',skuId:'DEMO-PREFORM-1000',quantity:450000,uom:'EA',warehouse:'DEMO-PACKAGING',status:'available'},
    {id:'CAPS',skuId:'DEMO-CAP',quantity:600000,uom:'EA',warehouse:'DEMO-PACKAGING',status:'available'},
    {id:'LABEL500',skuId:'DEMO-LABEL-500',quantity:600000,uom:'EA',warehouse:'DEMO-PACKAGING',status:'available'},
    {id:'LABEL1000',skuId:'DEMO-LABEL-1000',quantity:400000,uom:'EA',warehouse:'DEMO-PACKAGING',status:'available'},
    {id:'CASE',skuId:'DEMO-CASE',quantity:80000,uom:'EA',warehouse:'DEMO-PACKAGING',status:'available'},
];
const FIXTURE_DEMAND=[
    {id:'WK1_500',skuId:'DEMO-FG-500',quantity:20000,uom:'CASE',bucket:'WEEK_1',source:'FICTIONAL_FORECAST'},
    {id:'WK1_1000',skuId:'DEMO-FG-1000',quantity:12000,uom:'CASE',bucket:'WEEK_1',source:'FICTIONAL_FORECAST'},
];

export function fictionalPilotSnapshot(){
    const demo=fictionalLine11Demo();
    return {...demo,stock:FIXTURE_STOCK,demand:FIXTURE_DEMAND};
}

const SECTION_KEYS=['items','boms','resources','routings','stock','demand'] as const;
type PilotSection=typeof SECTION_KEYS[number];
type PilotSnapshot=ReturnType<typeof fictionalPilotSnapshot>;
const expectedRows=(snapshot:PilotSnapshot,key:PilotSection):Array<{id:string}>=>
    snapshot[key] as Array<{id:string}>;

/** Pure validation: checks the complete multi-stage demo graph without touching operational records. */
export function validateFictionalPilot(snapshot:PilotSnapshot):string[] {
    const errors:string[]=[];
    const items=new Map(snapshot.items.map(x=>[x.id,x]));
    const resources=new Map(snapshot.resources.map(x=>[x.id,x]));
    for(const section of SECTION_KEYS){
        const seen=new Set<string>();
        for(const row of expectedRows(snapshot,section)){
            if(!row.id||seen.has(row.id))errors.push(section+': missing or duplicate ID '+row.id);
            seen.add(row.id);
        }
    }
    for(const bom of snapshot.boms){
        const parent=items.get(bom.parentSkuId);
        if(!parent||!['INTERMEDIATE','FINISHED'].includes(parent.category))
            errors.push('BOM '+bom.id+': output must be a manufactured SKU');
        if(parent&&parent.uom!==bom.outputUom)
            errors.push('BOM '+bom.id+': output unit does not match the parent SKU');
        for(const component of bom.components){
            const child=items.get(component.skuId);
            if(!child)errors.push('BOM '+bom.id+': missing component '+component.skuId);
            else if(child.uom!==component.uom)errors.push('BOM '+bom.id+': component unit mismatch '+component.skuId);
            if(component.quantity<=0||component.scrapPct<0||component.scrapPct>100)
                errors.push('BOM '+bom.id+': invalid component quantity or loss');
        }
    }
    if(snapshot.boms.some(bom=>detectBomCycle(snapshot.boms.filter(other=>other.id!==bom.id),
        bom.parentSkuId,bom.components)))errors.push('Circular multi-stage BOM detected');
    for(const route of snapshot.routings){
        if(!items.has(route.skuId))errors.push('Routing '+route.id+': missing output SKU');
        const prior=new Set<string>();
        for(const step of route.operations){
            if(!resources.has(step.resourceId))errors.push('Routing '+route.id+': missing resource '+step.resourceId);
            if(!items.has(step.producesSkuId))errors.push('Routing '+route.id+': missing stage output '+step.producesSkuId);
            if(step.dependsOn.some(dep=>!prior.has(dep)))errors.push('Routing '+route.id+': invalid stage dependency '+step.code);
            prior.add(step.code);
        }
        if(route.operations.at(-1)?.producesSkuId!==route.skuId)
            errors.push('Routing '+route.id+': last output must match the routed SKU');
    }
    for(const row of [...snapshot.stock,...snapshot.demand]){
        const sku=items.get(row.skuId);
        if(!sku)errors.push('Stock/demand: unknown SKU '+row.skuId);
        if(sku&&sku.uom!==row.uom)errors.push('Stock/demand: unit mismatch '+row.skuId);
        if(!Number.isFinite(row.quantity)||row.quantity<0)errors.push('Stock/demand: invalid quantity');
    }
    return errors;
}

function isSubset(expected:unknown,actual:unknown):boolean {
    if(Array.isArray(expected))return Array.isArray(actual)&&expected.length===actual.length&&
        expected.every((row,i)=>isSubset(row,actual[i]));
    if(isObj(expected))return isObj(actual)&&Object.entries(expected).every(([key,value])=>isSubset(value,actual[key]));
    return expected===actual;
}

export async function verifySeededFictionalPilot(orgId:string){
    const root=ROOT(orgId),marker=await getDoc(root);
    if(!marker)return {seeded:false,valid:false,errors:['Pilot sandbox has not been seeded'],counts:null};
    if(marker.data.demo!==true||marker.data.simulationOnly!==true||marker.data.externalPostingEnabled!==false)
        return {seeded:true,valid:false,errors:['Sandbox isolation marker is invalid'],counts:null};
    const snapshot=fictionalPilotSnapshot(),errors=validateFictionalPilot(snapshot);
    const counts:Record<string,{expected:number;stored:number}>={};
    for(const section of SECTION_KEYS){
        const stored=await listDocs(root+'/'+section);
        const expected=expectedRows(snapshot,section);
        const byId=new Map(stored.map(doc=>[doc.id,doc]));
        counts[section]={expected:expected.length,stored:stored.length};
        if(stored.length!==expected.length)
            errors.push(section+': expected '+expected.length+' records but found '+stored.length);
        for(const item of expected){
            const record=byId.get(item.id);
            if(!record)errors.push(section+': missing '+item.id);
            else if(record.data.demo!==true||record.data.simulationOnly!==true||
                !isSubset(item,record.data))errors.push(section+': contents or isolation flag do not match '+item.id);
        }
    }
    return {seeded:true,valid:errors.length===0,errors,counts,verifiedAt:nowIso()};
}

export function assertPilotSeedAllowed(env:boolean,superAdmin:boolean,testMode:boolean,phrase:string) {
    if(!env||!superAdmin||!testMode)
        throw new HttpError(403,'Isolated Line 11 seeding is restricted to an explicitly authorized development test tenant and its organization super admin.');
    if(phrase!=='SEED FICTIONAL LINE 11')
        throw new HttpError(400,'Type the exact confirmation: SEED FICTIONAL LINE 11.');
}

/** The isolated fixture is not part of normal Manufacturing navigation or tenant APIs. */
export function assertPilotViewAllowed(env:boolean,superAdmin:boolean,testMode:boolean){
    if(!env||!superAdmin||!testMode)
        throw new HttpError(403,'Test fixture access is restricted to authorized development test mode.');
}
export const plnMfgPilotRoutes={
    'POST /api/org/pln-mfg/foundation/demo/status':[
        orgRoute('org.mfg.demo.status','MFG.view',async ctx=>{
            assertPilotViewAllowed(testModeEnvironmentAllowed(),ctx.role==='org_super_admin',ctx.testMode===true);
            const seeded=await getDoc(ROOT(ctx.orgId));
            return {sandboxId:SANDBOX_ID,seeded:!!seeded,isolated:true,
                canSeed:ctx.role==='org_super_admin'&&ctx.testMode===true&&testModeEnvironmentAllowed(),
                counts:seeded?.data.counts??null,createdAt:str(seeded?.data.createdAt),
                warning:'Demo records are isolated from actual Material Master, Inventory, Procurement, Finance and Manufacturing Execution.'};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/demo/seed':[
        orgRoute('org.mfg.demo.seed','MFG.master.edit',async ctx=>{
            assertPilotSeedAllowed(testModeEnvironmentAllowed(),ctx.role==='org_super_admin',ctx.testMode===true,str(ctx.body.confirm));
            const root=ROOT(ctx.orgId),existing=await getDoc(root);
            if(existing)return {ok:true,seeded:true,alreadySeeded:true,counts:existing.data.counts};
            const fixture=fictionalPilotSnapshot();
            const violations=validateFictionalPilot(fixture);
            if(violations.length)throw new HttpError(500,'Fictional pilot data failed integrity checks: '+violations.join('; '));
            const at=nowIso(),actor=ctx.uid;
            const counts={items:fixture.items.length,boms:fixture.boms.length,resources:fixture.resources.length,
                routings:fixture.routings.length,stock:fixture.stock.length,demand:fixture.demand.length};
            const writes:Array<{path:string;data:Record<string,unknown>;precondition:{exists:boolean}}>= [
                {path:root,data:{demo:true,simulationOnly:true,name:'Fictional Line 11 KHS PET pilot',createdAt:at,createdBy:actor,counts,
                    restrictedTo:'authorized_development_test_tenant',externalPostingEnabled:false},precondition:{exists:false}},
            ];
            const add=(kind:string,records:Array<{id:string}>)=>{
                for(const row of records)writes.push({path:root+'/'+kind+'/'+row.id,data:{...row,
                    demo:true,simulationOnly:true,source:'FICTIONAL_LINE11_V1',createdAt:at},precondition:{exists:false}});
            };
            add('items',fixture.items);add('boms',fixture.boms);add('resources',fixture.resources);
            add('routings',fixture.routings);add('stock',fixture.stock);add('demand',fixture.demand);
            if(writes.length>50)throw new HttpError(500,'Pilot fixture exceeds the atomic batch limit.');
            const ok=await commitChecked(writes);
            if(!ok) {
                const current=await getDoc(root);
                if(current)return {ok:true,seeded:true,alreadySeeded:true,counts:current.data.counts};
                throw new HttpError(409,'Pilot sandbox was changed by another request; retry.');
            }
            await audit([{category:'data',action:'mfg.pilot.fictional.seed',actor:ctx.actor,meta:ctx.meta,orgId:ctx.orgId,
                target:{label:SANDBOX_ID},details:'Atomic read-only simulation fixture: no production, financial, inventory or procurement postings.'}]);
            return {ok:true,seeded:true,alreadySeeded:false,counts};
        }),
    ],
    'POST /api/org/pln-mfg/foundation/demo/verify':[
        orgRoute('org.mfg.demo.verify','MFG.view',async ctx=>{
            assertPilotViewAllowed(testModeEnvironmentAllowed(),ctx.role==='org_super_admin',ctx.testMode===true);
            // Read-only verification against the tenant's isolated simulation collections.
            return verifySeededFictionalPilot(ctx.orgId);
        }),
    ],
    'POST /api/org/pln-mfg/foundation/demo/sandbox':[
        orgRoute('org.mfg.demo.sandbox','MFG.view',async ctx=>{
            assertPilotViewAllowed(testModeEnvironmentAllowed(),ctx.role==='org_super_admin',ctx.testMode===true);
            const root=ROOT(ctx.orgId),parent=await getDoc(root);
            if(!parent)throw new HttpError(404,'No isolated pilot data has been seeded for this tenant.');
            // Return the deterministic fixture only after verifying a sandbox marker;
            // never resolve IDs against operational tables or ledgers.
            return {sandboxId:SANDBOX_ID,seeded:true,source:'FICTIONAL_LINE11_V1',...fictionalPilotSnapshot()};
        }),
    ],
};
