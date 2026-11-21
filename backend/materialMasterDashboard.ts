/**
 * Organization Material Master dashboard read model.
 *
 * Combines tenant material, creation warehouse, approved/pending warehouse extensions,
 * authorized stock journals and the existing tenant audit trail. No mutation is made.
 * Stock quantities are only provided for warehouses in the requesting user's read scope.
 */
import { getDoc, isObj, listDocs, orderDesc, runQuery, str, HttpError, type Doc } from './core';
import { allowedNodeIds } from './positions';
import { type OrgContext } from './guards';

type SourceAttribute = { code: string; name: string; unit?: string; options?: Array<{code: string; label: string}> };
type AttributeLookup = (code: string) => Promise<{ attributes: SourceAttribute[] } | null>;
type WarehouseEntry = {
    warehouseId: string; warehouseName: string; warehouseCode: string;
    relation: 'Created here' | 'Extended' | 'Existing mapping';
    status: string; requestedAt: string; approvedAt: string;
    requestId: string; requestedBy: string;
    mapped: boolean; accessible: boolean;
};
type StockRow = WarehouseEntry & {
    ledgerState: 'Tracked' | 'Not tracked' | 'Unreconciled' | 'Unavailable' | 'Restricted';
    physicalStock: number | null; reservedStock: number | null;
    quarantinedStock: number | null; damagedStock: number | null;
    expiredStock: number | null; otherStock: number | null;
    availableStock: number | null; onOrder: number | null; inTransit: number | null;
    journalEntries: number;
};
type HistoryRow = { id: string; at: string; action: string; by: string; details: string; origin: 'Audit' | 'Workflow' | 'Record' };

const idPattern = /^[A-Za-z0-9_-]{1,120}$/;
const formatStatus = (s: string) => s.replaceAll('_',' ').replace(/\b\w/g, x => x.toUpperCase());
const asNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};
const tokenMatch = (text: string, token: string) => {
    if (!token) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^A-Za-z0-9_-])' + escaped + '(?=$|[^A-Za-z0-9_-])').test(text);
};

/** Use only journal deltas already posted and reconciled; missing journals never imply zero stock. */
export function summarizeMaterialWarehouseStock(entries: Array<{data:Record<string,unknown>}>, mapped: boolean, accessible: boolean, complete: boolean) {
    const empty = {physicalStock:null,reservedStock:null,quarantinedStock:null,damagedStock:null,
        expiredStock:null,otherStock:null,availableStock:null,onOrder:null,inTransit:null};
    if (!accessible) return {ledgerState:'Restricted' as const,...empty,journalEntries:0};
    if (!mapped) return {ledgerState:'Unavailable' as const,...empty,journalEntries:0};
    if (!complete) return {ledgerState:'Unreconciled' as const,...empty,journalEntries:entries.length};
    if (!entries.length) return {ledgerState:'Not tracked' as const,...empty,journalEntries:0};
    if (entries.some(x => str(x.data.status)!=='posted' || x.data.reconciled!==true))
        return {ledgerState:'Unreconciled' as const,...empty,journalEntries:entries.length};
    const keys=['physicalStock','reservedStock','quarantinedStock','damagedStock','expiredStock','other','onOrder','inTransit'] as const;
    const sums:Record<string,number>={};
    for(const key of keys)sums[key]=0;
    for(const item of entries){
        const delta=isObj(item.data.balancesDelta)?item.data.balancesDelta:{};
        for(const key of keys)sums[key]+=asNumber(delta[key]);
    }
    return {
        ledgerState:'Tracked' as const,
        physicalStock:sums.physicalStock,reservedStock:sums.reservedStock,
        quarantinedStock:sums.quarantinedStock,damagedStock:sums.damagedStock,
        expiredStock:sums.expiredStock,otherStock:sums.other,
        availableStock:sums.physicalStock-sums.reservedStock-sums.quarantinedStock-
            sums.damagedStock-sums.expiredStock-sums.other,
        onOrder:sums.onOrder,inTransit:sums.inTransit,journalEntries:entries.length,
    };
}

export async function materialMasterDashboard(ctx: OrgContext, id: string, lookup: AttributeLookup) {
    if(!idPattern.test(id))throw new HttpError(400,'Invalid material identifier.');
    const base='organizations/'+ctx.orgId;
    const material=await getDoc(base+'/materials/'+id);
    if(!material||str(material.data.status)==='deleted')throw new HttpError(404,'Material was not found in the organization master.');
    const d=material.data;
    const [warehouses,structure,extensions,user,definition]=await Promise.all([
        listDocs(base+'/warehouses'),listDocs(base+'/structure'),
        listDocs(base+'/material_extensions'),getDoc('users/'+ctx.uid),
        lookup(str(d.materialCode)),
    ]);
    const allowed=ctx.role==='org_super_admin'?'all':user?await allowedNodeIds(ctx.orgId,user,true):new Set<string>();
    const nodes=new Map(structure.map(x=>[x.id,x.data]));
    const whById=new Map(warehouses.map(w=>[w.id,w]));
    const warehouseLabel=(id:string)=>{
        const w=whById.get(id),node=nodes.get(id);
        return {warehouseName:str(node?.name)||str(w?.data.name)||id,
            warehouseCode:str(node?.code)||str(w?.data.code)||id};
    };
    const accessible=(id:string)=>!!whById.get(id)&&(allowed==='all'||allowed.has(id));
    const availabilityEnabled=['approved','active'].includes(str(d.status));
    const byWarehouse=new Map<string,WarehouseEntry>();
    const sourceId=str(d.warehouseId);
    // Extension approval may synchronize the original warehouse into warehouseIds.
    // Use the same effective mapping as Inventory rather than assuming pushAt is required.
    const sourceMapped=availabilityEnabled&&(
        !!str(d.pushedAt)||
        (Array.isArray(d.warehouseIds)&&d.warehouseIds.map(str).includes(sourceId))
    );
    if(sourceId){
        byWarehouse.set(sourceId,{warehouseId:sourceId,...warehouseLabel(sourceId),
            relation:'Created here',status:formatStatus(str(d.status)),
            requestedAt:str(d.createdAt),approvedAt:str(d.approvedAt),
            requestId:id,requestedBy:str(d.createdBy),mapped:sourceMapped,accessible:accessible(sourceId)});
    }
    const matchingExtensions=extensions.filter(x=>str(x.data.sourceId)===id)
        .sort((a,b)=>str(a.data.createdAt).localeCompare(str(b.data.createdAt)));
    // The latest extension request for each target warehouse is its current workflow state.
    for(const ext of matchingExtensions){
        const wId=str(ext.data.warehouseId);
        if(!wId)continue;
        const linked=availabilityEnabled&&str(ext.data.status)==='approved';
        byWarehouse.set(wId,{warehouseId:wId,...warehouseLabel(wId),relation:'Extended',
            status:formatStatus(str(ext.data.status)),requestedAt:str(ext.data.createdAt),
            approvedAt:str(ext.data.approvedAt),requestId:ext.id,
            requestedBy:str(ext.data.createdBy),mapped:linked,accessible:accessible(wId)});
    }
    for(const whId of Array.isArray(d.warehouseIds)?d.warehouseIds.map(str):[]){
        if(!whId)continue;
        const old=byWarehouse.get(whId);
        if(old){
            // A historical approved extension can remain mapped after a later rejected request.
            if(availabilityEnabled&&matchingExtensions.some(x=>str(x.data.warehouseId)===whId&&str(x.data.status)==='approved')){
                byWarehouse.set(whId,{...old,mapped:true});
            }
            continue;
        }
        byWarehouse.set(whId,{warehouseId:whId,...warehouseLabel(whId),
            relation:'Existing mapping',status:availabilityEnabled?'Mapped':'Inactive',
            requestedAt:'',approvedAt:'',requestId:'',requestedBy:'',
            mapped:availabilityEnabled,accessible:accessible(whId)});
    }
    const whRows=[...byWarehouse.values()].sort((a,b)=>
        (a.relation==='Created here'?-1:b.relation==='Created here'?1:0)||
        a.warehouseName.localeCompare(b.warehouseName));

    // A filtered journal query is bounded; never publish misleading balances when a cap is hit.
    const journalCap=2000;
    const journal=whRows.some(x=>x.accessible&&x.mapped)?
        await runQuery({from:[{collectionId:'material_journal'}],
            where:{fieldFilter:{field:{fieldPath:'materialId'},op:'EQUAL',value:{stringValue:id}}},
            limit:journalCap},base):[] as Doc[];
    const complete=journal.length<journalCap;
    const stock:StockRow[]=whRows.map(w=>{
        const rows=journal.filter(j=>str(j.data.warehouseId)===w.warehouseId);
        return {...w,...summarizeMaterialWarehouseStock(rows,w.mapped,w.accessible,complete)};
    });

    const attrValues=isObj(d.attributes)?d.attributes:{};
    const specMap=new Map((definition?.attributes||[]).map(x=>[x.code,x]));
    const attributes=Object.entries(attrValues).map(([code,value])=>{
        const spec=specMap.get(code),raw=Array.isArray(value)?value.map(str).join(', '):str(value);
        const option=spec?.options?.find(x=>x.code===raw);
        return {code,label:spec?.name||code,value:option?.label||raw,unit:spec?.unit||''};
    });

    // Material-specific history: recorded lifecycle fields and workflow decisions remain
    // visible even when older general tenant audit pages are outside the recent window.
    const history:HistoryRow[]=[];
    const add=(row:HistoryRow)=>{if(row.at)history.push(row);};
    add({id:'created',at:str(d.createdAt),action:'Material created',by:str(d.createdBy),details:'Original material request',origin:'Record'});
    add({id:'submitted',at:str(d.submittedAt),action:'Submitted for approval',by:str(d.submittedBy),details:str(d.workflowCode)||'PRC-001',origin:'Record'});
    add({id:'approved',at:str(d.approvedAt),action:'Material approved',by:str(d.approvedBy),details:str(d.workflowStage)||'',origin:'Record'});
    add({id:'allocated',at:str(d.numberAllocatedAt),action:'Approved master data ID assigned',by:str(d.numberAllocatedBy),details:str(d.masterDataId||d.materialNumber),origin:'Record'});
    add({id:'published',at:str(d.pushedAt),action:'Published to original warehouse',by:str(d.pushedBy),details:warehouseLabel(sourceId).warehouseName,origin:'Record'});
    add({id:'updated',at:str(d.updatedAt),action:'Material updated',by:str(d.updatedBy),details:'Latest saved change',origin:'Record'});
    add({id:'disabled',at:str(d.disabledAt),action:'Material disabled',by:str(d.disabledBy),details:'Status change',origin:'Record'});
    for(const [i,decision] of (Array.isArray(d.approvalHistory)?d.approvalHistory:[]).entries()){
        if(!isObj(decision))continue;
        add({id:'decision-'+i,at:str(decision.at),action:'Creation workflow: '+formatStatus(str(decision.decision)),
            by:str(decision.by),details:str(decision.comment)||str(decision.role),origin:'Workflow'});
    }
    for(const ext of matchingExtensions){
        const whName=warehouseLabel(str(ext.data.warehouseId)).warehouseName;
        add({id:'extension-'+ext.id,at:str(ext.data.createdAt),action:'Warehouse extension requested',
            by:str(ext.data.createdBy),details:whName,origin:'Record'});
        for(const [i,vote] of (Array.isArray(ext.data.approvalHistory)?ext.data.approvalHistory:[]).entries()){
            if(!isObj(vote))continue;
            add({id:'extension-'+ext.id+'-'+i,at:str(vote.at),
                action:'Extension workflow: '+formatStatus(str(vote.decision)),by:str(vote.by),
                details:whName+(str(vote.comment)?' · '+str(vote.comment):''),origin:'Workflow'});
        }
        add({id:'extension-approved-'+ext.id,at:str(ext.data.approvedAt),
            action:'Warehouse extension approved',by:str(ext.data.approvedBy),details:whName,origin:'Record'});
    }

    const auditCap=1000;
    const recent=await runQuery({from:[{collectionId:'audit_events'}],
        orderBy:orderDesc('at'),limit:auditCap},base);
    const extIds=matchingExtensions.map(x=>x.id);
    const tokens=[id,...extIds,str(d.masterDataId),str(d.materialNumber)].filter(Boolean);
    for(const item of recent){
        const ev=item.data;
        if(!['data','security','governance'].includes(str(ev.category)))continue;
        const joined=[str(ev.targetId),str(ev.targetLabel),str(ev.details)].join(' ');
        if(!tokens.some(t=>tokenMatch(joined,t)))continue;
        add({id:'audit-'+item.id,at:str(ev.at),
            action:str(ev.action).replaceAll(/[._]/g,' '),
            by:str(ev.actorEmail)||str(ev.actorUid),
            details:str(ev.details).slice(0,350),origin:'Audit'});
    }
    history.sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));

    return {
        material:{id,name:str(d.name),shortText:str(d.shortText),
            materialNumber:str(d.materialNumber),masterDataId:str(d.masterDataId),materialCode:str(d.materialCode),
            categoryCode:str(d.categoryCode),subcategoryCode:str(d.subcategoryCode),
            familyCode:str(d.familyCode),status:str(d.status),
            workflowStage:str(d.workflowStage),createdAt:str(d.createdAt),createdBy:str(d.createdBy),
            submittedAt:str(d.submittedAt),submittedBy:str(d.submittedBy),
            updatedAt:str(d.updatedAt),supplyType:str(d.supplyType),uom:str(d.uom),
            warehouseId:sourceId,pushedAt:str(d.pushedAt),
            vendorId:str(d.vendorId),oemPartNumber:str(d.oemPartNumber),
            ocmPartNumber:str(d.ocmPartNumber),generalPartNumber:str(d.generalPartNumber),
            warehouseRestrictionCodes:Array.isArray(d.warehouseRestrictionCodes)?d.warehouseRestrictionCodes.map(str):[],
            ...(isObj(d.attributes)?{attributes:d.attributes}:{}),
            approvalLevel:Number(d.approvalLevel)||0,workflowCode:str(d.workflowCode),
        },
        attributes,warehouses:whRows,availability:stock,
        history:history.slice(0,500),
        historyNote:recent.length>=auditCap?
            'Recent audit window is capped at 1,000 events; older editing events may be absent. Lifecycle and workflow records are included.':
            'History combines recorded lifecycle, workflow and tenant audit events.',
        ledgerNote:complete?'Stock is calculated from reconciled posted journal deltas.':'Stock journal query reached its safety cap; quantities are withheld until reconciled.',
    };
}
