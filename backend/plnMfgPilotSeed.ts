/**
 * Optional fictional Line 11 pilot data loader.
 *
 * This is NOT a materials import, ledger posting, procurement action, or a
 * manufacturing execution order. It writes only to a dedicated simulation
 * sub-tree, and only when the named tenant is in development test mode.
 * The fixture is repeatable and immutable once seeded.
 */
import { HttpError, commitChecked, getDoc, nowIso, str } from './core';
import { orgRoute } from './guards';
import { testModeEnvironmentAllowed } from './testModeCore';
import { fictionalLine11Demo } from './plnMfgFoundation';
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
export function assertPilotSeedAllowed(env:boolean,superAdmin:boolean,testMode:boolean,phrase:string) {
    if(!env||!superAdmin||!testMode)
        throw new HttpError(403,'Isolated Line 11 seeding is restricted to an explicitly authorized development test tenant and its organization super admin.');
    if(phrase!=='SEED FICTIONAL LINE 11')
        throw new HttpError(400,'Type the exact confirmation: SEED FICTIONAL LINE 11.');
}

export const plnMfgPilotRoutes={
    'POST /api/org/pln-mfg/foundation/demo/status':[
        orgRoute('org.mfg.demo.status','MFG.view',async ctx=>{
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
    'POST /api/org/pln-mfg/foundation/demo/sandbox':[
        orgRoute('org.mfg.demo.sandbox','MFG.view',async ctx=>{
            const root=ROOT(ctx.orgId),parent=await getDoc(root);
            if(!parent)throw new HttpError(404,'No isolated pilot data has been seeded for this tenant.');
            // Return the deterministic fixture only after verifying a sandbox marker;
            // never resolve IDs against operational tables or ledgers.
            return {sandboxId:SANDBOX_ID,seeded:true,source:'FICTIONAL_LINE11_V1',...fictionalPilotSnapshot()};
        }),
    ],
};
