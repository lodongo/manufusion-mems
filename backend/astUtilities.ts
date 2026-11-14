import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, str, writeDoc, type Doc, type Obj } from './core';
import { orgRoute, type OrgContext } from './guards';
import { seedModuleMetadata } from './moduleDefaults';
import { effectiveSafetyItems } from './safConfiguration';
import { PERMS, allowedAt, audited, diffByKey, requireAt, stableJson } from './scopeGuard';

// ---------------------------------------------------------------------------
// Utilities supplied to an equipment unit (power, compressed air, steam …), with the attributes defined
// in AST metadata (utilitySupplies).   organizations/{org}/equipment_utilities/{workCenterId}
// Reading needs AST.utilities.view (or edit / AST.view) at the unit; saving needs AST.utilities.edit
// (or AST.edit) at the unit. Every save is audited with the utilities added, removed and changed.
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const docPath = (org: string, id: string) => `organizations/${org}/equipment_utilities/${id}`;

async function equipmentUnit(ctx: OrgContext) {
    const id = str(ctx.body.workCenterId);
    if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid unit');
    const node = await getDoc(`organizations/${ctx.orgId}/structure/${id}`);
    if (!node || str(node.data.level) !== 'work_center') throw new HttpError(404, 'Equipment unit not found');
    return { id, node };
}

async function definitions() {
    const master = await getDoc('module_workspaces/AST/metadata/utilitySupplies');
    return (Array.isArray(master?.data.items) ? master.data.items : []).filter(isObj).filter((x) => x.active !== false);
}

// An asset can supply many equipment units independently of its own one-to-one equipment attribution.
const assetCol = (org: string) => 'organizations/'+org+'/assets';
const TAG_RE = /^AST-\d{6}$/;
const eligibleStatus = (a: Doc) => ['active','change_pending','draft','pending_approval'].includes(str(a.data.status));
const rowsOf = (d: Doc | null) => (Array.isArray(d?.data.items) ? d.data.items : []).filter(isObj);
const ratingsOf = (a: Doc) => isObj(a.data.utilitySupplyRatings) ? a.data.utilitySupplyRatings : {};
export function capacityDeterminant(def: Obj) {
    const attrs = (Array.isArray(def.attributes) ? def.attributes : []).filter(isObj);
    // Pressure, voltage, temperature, speed and concentration are compatibility conditions, not additive loads.
    const attr = ['current','flow','feed','power','force','mass'].map(k => attrs.find(x => x.key === k && x.type === 'number')).find(Boolean);
    return attr ? { key:str(attr.key), label:str(attr.label), unit:str(attr.unit) } : null;
}
const positive = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
export function capacityStatus(capacity: number | null, demand: number, unknown: number) {
    const percent = capacity ? demand / capacity * 100 : null;
    return { percent, status: percent !== null && percent > 100 ? 'overload' : percent !== null && percent > 84 ? 'warning' : unknown || percent === null ? 'unknown' : 'normal' };
}
async function siteOf(org: string, node: Doc) {
    let n: Doc | null = node;
    for(let i=0;n && i<15;i++){
        if(n.data.level === 'site') return n.id;
        const parent = str(n.data.parentId);
        n = ID_RE.test(parent) && parent !== 'root' ? await getDoc('organizations/'+org+'/structure/'+parent) : null;
    }
    return '';
}
async function checkedAsset(ctx: OrgContext, tag: string) {
    const asset = TAG_RE.test(tag) ? await getDoc(assetCol(ctx.orgId)+'/'+tag) : null;
    if(!asset) throw new HttpError(404,'Supply asset not found.');
    return asset;
}
function supplySummary(a: Doc, def: Obj, docs: Doc[], ownId = '') {
    const det = capacityDeterminant(def);
    const rating = ratingsOf(a)[str(def.code)];
    const capacity = det && isObj(rating) && rating.key === det.key && rating.unit === det.unit ? positive(rating.capacity) : null;
    const connections = docs.flatMap(d => rowsOf(d).filter(r => r.sourceAssetTag === a.id && r.code === def.code).map(r => ({
        workCenterId:d.id, demand: det && isObj(r.values) ? positive(r.values[det.key]) : null
    })));
    const total = connections.reduce((sum,c)=>sum+(c.demand ?? 0),0);
    const ownDemand = connections.filter(c=>c.workCenterId===ownId).reduce((sum,c)=>sum+(c.demand??0),0);
    const unknown = det ? connections.filter(c=>c.demand===null).length : 0;
    return {code:str(def.code), label:str(def.label), determinant:det, capacity, total, ownDemand, unknown, count:connections.length,
      ...capacityStatus(capacity,total,unknown), connections};
}
const publicSummary = (s: ReturnType<typeof supplySummary>) => {
    const {connections,...summary}=s;
    return summary;
};
async function sourceRows(ctx: OrgContext, id: string, node: Doc, def: Obj) {
    const site = await siteOf(ctx.orgId,node);
    const [assets,docs] = await Promise.all([listDocs(assetCol(ctx.orgId)),listDocs('organizations/'+ctx.orgId+'/equipment_utilities')]);
    const candidates=assets.filter(a=>site && a.data.siteId===site && eligibleStatus(a) && a.data.workCenterId!==id);
    const rights = new Map<string,Promise<boolean>>();
    const visible = (a:Doc) => {
        const location=str(a.data.nodeId);
        if(!rights.has(location)) rights.set(location,allowedAt(ctx,PERMS.utilitiesView,location,'read'));
        return rights.get(location)!;
    };
    const options = await Promise.all(candidates.map(async a=>await visible(a) ? {
        tag:a.id,name:str(a.data.name),assetStatus:str(a.data.status),className:str(a.data.className),
        ...publicSummary(supplySummary(a,def,docs,id))
    }:null));
    return options.filter(x=>x!==null);
}
async function assetSupplies(ctx:OrgContext, defs:Obj[], adopted:Set<string>) {
    const asset=await checkedAsset(ctx,str(ctx.body.assetTag));
    await requireAt(ctx,PERMS.utilitiesView,str(asset.data.nodeId),'read','You cannot view this source asset.');
    const docs=await listDocs('organizations/'+ctx.orgId+'/equipment_utilities');
    const linked=new Set(docs.flatMap(d=>rowsOf(d).filter(r=>r.sourceAssetTag===asset.id).map(r=>str(r.code))));
    const ratings=ratingsOf(asset);
    const available=defs.filter(d=>adopted.has(str(d.code))||linked.has(str(d.code))||Object.hasOwn(ratings,str(d.code)));
    const summaries=await Promise.all(available.filter(d=>linked.has(str(d.code))||Object.hasOwn(ratings,str(d.code))).map(async d=>{
        const s=supplySummary(asset,d,docs);
        const consumers=await Promise.all(s.connections.map(async c=>{
            if(!await allowedAt(ctx,PERMS.utilitiesView,c.workCenterId,'read')) return {name:'Restricted equipment',demand:c.demand};
            const n=await getDoc('organizations/'+ctx.orgId+'/structure/'+c.workCenterId);
            return {name:str(n?.data.name)||c.workCenterId,code:str(n?.data.code),demand:c.demand};
        }));
        return {...publicSummary(s),consumers};
    }));
    return {supplies:summaries,catalogue:available.filter(d=>adopted.has(str(d.code))).map(d=>({code:str(d.code),label:str(d.label),determinant:capacityDeterminant(d)})),
      canEdit:eligibleStatus(asset)&&await allowedAt(ctx,['AST.edit','AST.create'],str(asset.data.nodeId),'write')};
}
async function saveRating(ctx:OrgContext, defs:Obj[], adopted:Set<string>){
    const asset=await checkedAsset(ctx,str(ctx.body.assetTag));
    await requireAt(ctx,['AST.edit','AST.create'],str(asset.data.nodeId),'write','You cannot configure this source asset.');
    if(!eligibleStatus(asset))throw new HttpError(409,'Source asset is unavailable.');
    const code=str(ctx.body.code),def=defs.find(x=>x.code===code && adopted.has(code));
    if(!def)throw new HttpError(400,'Select an adopted utility.');
    const det=capacityDeterminant(def),capacity=positive(ctx.body.capacity);
    if(det&&!capacity)throw new HttpError(400,'Enter a positive usable supply capacity in '+det.unit+'.');
    const ratings=ratingsOf(asset);
    const prior=ratings[code];
    if(stableJson(prior??null)!==stableJson(ctx.body.expectedRating??null))throw new HttpError(409,'Supply rating changed. Reload before editing.');
    const next={...ratings,[code]:{key:det?.key??'',unit:det?.unit??'',capacity:det?capacity:null}};
    if(!await writeDoc(assetCol(ctx.orgId)+'/'+asset.id,{...asset.data,utilitySupplyRatings:next},{updateTime:asset.updateTime}))throw new HttpError(409,'Source asset changed. Reload.');
    await audited(ctx,'ast.utilities.supply_rating',asset.id,{code,before:prior??null,after:next[code]});
    return {saved:true};
}
export async function assertUtilitySourceUnlinked(org:string,tag:string){
    const docs=await listDocs('organizations/'+org+'/equipment_utilities');
    if(docs.some(d=>rowsOf(d).some(r=>r.sourceAssetTag===tag)))throw new HttpError(409,'This asset supplies equipment utilities. Reassign or remove those connections first.');
}

export const utilityRoutes = {
    'POST /api/org/ast/utilities/read': [
        orgRoute('org.ast.utilities.read', null, async (ctx) => {
            if(str(ctx.body.assetTag)) { await seedModuleMetadata('AST'); return assetSupplies(ctx,await definitions(),new Set((await effectiveSafetyItems(ctx.orgId,'externalEnergySources')).map(x=>str(x.code)))); }
            const { id, node } = await equipmentUnit(ctx);
            await requireAt(ctx, PERMS.utilitiesView, id, 'read', 'You do not have permission to view the utilities of this equipment unit.');
            await seedModuleMetadata('AST');
            const [defs, doc, adopted] = await Promise.all([definitions(), getDoc(docPath(ctx.orgId, id)), effectiveSafetyItems(ctx.orgId,'externalEnergySources')]);
            const allowed=new Set(adopted.map(x=>str(x.code)));
            const catalogue=defs.filter(x=>allowed.has(str(x.code)));
            const requested=str(ctx.body.code);
            if(requested){
                const def=catalogue.find(x=>x.code===requested);
                if(!def)throw new HttpError(400,'Utility is not adopted.');
                return {sources:await sourceRows(ctx,id,node,def),determinant:capacityDeterminant(def)};
            }
            const items=rowsOf(doc);
            const docs=items.some(r=>str(r.sourceAssetTag))?await listDocs('organizations/'+ctx.orgId+'/equipment_utilities'):[];
            const site=await siteOf(ctx.orgId,node);
            const enriched=await Promise.all(items.map(async row=>{
                const tag=str(row.sourceAssetTag),def=defs.find(d=>d.code===row.code);
                const asset=TAG_RE.test(tag)?await getDoc(assetCol(ctx.orgId)+'/'+tag):null;
                const valid=!!asset&&!!site&&asset.data.siteId===site&&eligibleStatus(asset)&&asset.data.workCenterId!==id;
                const supply=valid&&asset&&def?publicSummary(supplySummary(asset,def,docs,id)):null;
                const complete=valid&&!!def&&allowed.has(str(row.code))&&(!supply?.determinant||!!supply.capacity&&!!positive(isObj(row.values)?row.values[supply.determinant.key]:null));
                return {...row,sourceAssetName:valid?str(asset?.data.name):'',sourceAssetStatus:valid?str(asset?.data.status):'',supply,configurationComplete:complete};
            }));
            return { catalogue, items:enriched, configurationComplete:enriched.every(x=>x.configurationComplete),version:Number(doc?.data.version)||0 };
        }),
    ],

    'POST /api/org/ast/utilities/save': [
        orgRoute('org.ast.utilities.save', null, async (ctx) => {
            if(str(ctx.body.assetTag)){await seedModuleMetadata('AST');return saveRating(ctx,await definitions(),new Set((await effectiveSafetyItems(ctx.orgId,'externalEnergySources')).map(x=>str(x.code))));}
            const { id, node } = await equipmentUnit(ctx);
            await requireAt(ctx, PERMS.utilitiesEdit, id, 'write', 'You do not have permission to change the utilities of this equipment unit.');
            const rows = ctx.body.items;
            if (!Array.isArray(rows) || rows.length > 80) throw new HttpError(400, 'Invalid entries');
            await seedModuleMetadata('AST');
            const path=docPath(ctx.orgId,id), existing=await getDoc(path);
            const version=Number(existing?.data.version)||0;
            if(ctx.body.version!==undefined&&Number(ctx.body.version)!==version)throw new HttpError(409,'Utility register changed. Reload.');
            const before=(Array.isArray(existing?.data.items)?existing.data.items:[]).filter(isObj);
            const [defs,adopted]=await Promise.all([definitions(),effectiveSafetyItems(ctx.orgId,'externalEnergySources')]);
            const allowed=new Set(adopted.map(x=>str(x.code)));
            if (!defs.length) throw new HttpError(409, 'AST utility metadata is not loaded');
            const seen = new Set<string>();
            const site=await siteOf(ctx.orgId,node);
            const items = await Promise.all(rows.map(async (row: unknown) => {
                if (!isObj(row)) throw new HttpError(400, 'Invalid utility');
                const code = str(row.code);
                const def = defs.find((x) => str(x.code) === code);
                if(seen.has(code)) throw new HttpError(400,'Duplicate utility');
                seen.add(code);
                const prior=before.find(x=>str(x.code)===code);
                if(!def||!allowed.has(code)){
                    if(!prior||stableJson(row.values)!==stableJson(prior.values)||str(row.sourceAssetTag)!==str(prior.sourceAssetTag))throw new HttpError(400,'Select an adopted utility or retain the existing historical values.');
                    return prior;
                }
                const values: Record<string, string | number> = {};
                const raw = isObj(row.values) ? row.values : {};
                for (const attr of (Array.isArray(def.attributes) ? def.attributes : []).filter(isObj)) {
                    const key = str(attr.key);
                    const v = raw[key];
                    if (v == null || v === '') {
                        if (attr.required) throw new HttpError(400, `${str(def.label)}: ${str(attr.label)} required`);
                        continue;
                    }
                    if (attr.type === 'number') {
                        const n = Number(v);
                        if (!Number.isFinite(n)) throw new HttpError(400, `${str(def.label)}: ${str(attr.label)} must be a number`);
                        values[key] = n;
                    } else {
                        const value = String(v).trim();
                        const options = Array.isArray(attr.options) ? attr.options.map(str) : [];
                        if (value.length > 180 || (attr.type === 'select' && !options.includes(value))) throw new HttpError(400, `${str(def.label)}: invalid ${str(attr.label)}`);
                        values[key] = value;
                    }
                }
                const sourceAssetTag=str(row.sourceAssetTag);
                // Legacy rows can remain unchanged while colleagues repair links individually; they stay incomplete.
                if(!sourceAssetTag&&prior&&!str(prior.sourceAssetTag)&&stableJson(prior.values)===stableJson(values))return prior;
                const asset=await checkedAsset(ctx,sourceAssetTag);
                if(!site||asset.data.siteId!==site||!eligibleStatus(asset)||asset.data.workCenterId===id)throw new HttpError(400,'Choose an available supply asset at this site, other than the consuming equipment itself.');
                if(!prior||str(prior.sourceAssetTag)!==sourceAssetTag)await requireAt(ctx,PERMS.utilitiesView,str(asset.data.nodeId),'read','You cannot link to this source asset.');
                const det=capacityDeterminant(def),rating=ratingsOf(asset)[code];
                if(det&&(!positive(values[det.key])||!isObj(rating)||rating.key!==det.key||rating.unit!==det.unit||!positive(rating.capacity)))throw new HttpError(400,'A positive equipment demand and source supply capacity in '+det.unit+' are required.');
                return { code, label: str(def.label), values, sourceAssetTag, connectionId:prior?str(prior.connectionId)||'legacy-'+code:randomId(16) };
            }));

            if(!await writeDoc(path, { ...(existing?.data ?? {}), items, version:version+1, updatedAt: nowIso(), updatedBy: ctx.uid },existing?{updateTime:existing.updateTime}:{exists:false}))throw new HttpError(409,'Utility register changed. Reload.');
            const diff = diffByKey(before, items, (x: any) => str(x.code));
            await audited(ctx, 'ast.utilities.save', `Utilities of ${str(node.data.code) || id}`, diff);
            return { saved: items.length,version:version+1 };
        }),
    ],
};
