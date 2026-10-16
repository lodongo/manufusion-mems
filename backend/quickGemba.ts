import { storage } from '@appdeploy/sdk';
import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, rateLimit, str, updateFields, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { audit } from './audit';
import { allowedNodeIds } from './positions';
import { detectImage } from './branding';
import { signedUrl } from './structure';
import { canAt, scopeOf } from './access';
import { DEFAULT_MODULE_METADATA } from './moduleDefaults';

const root = (org: string) => 'organizations/' + org + '/gembas';
const obsRoot = (org: string, id: string) => root(org) + '/' + id + '/observations';
const matchId = (s: string) => /^[A-Za-z0-9_-]{8,40}$/.test(s);
/**
 * Gemba types have one authoritative source: the active subtypes of the Gemba
 * group in MNT > Work Request Sources. The same code is saved on the Gemba
 * and carried into the originating work request.
 */
async function gembaTypes(): Promise<Array<{code:string;label:string}>> {
    const record=await getDoc('module_workspaces/MNT/metadata/workRequestSources');
    const seeded=(DEFAULT_MODULE_METADATA.MNT||[]).find(m=>m.key==='workRequestSources');
    const items:unknown[]=Array.isArray(record?.data.items)?record.data.items:(seeded?.items||[]);
    const available=items.filter(isObj).filter(item=>item.active!==false);
    const headings=new Set(available.filter(item=>
        item.selectable===false && /^gemba(?:\s|$)/i.test(str(item.label).trim())
    ).map(item=>str(item.code)));
    return available.filter(item=>item.selectable!==false && headings.has(str(item.category)))
        .map(item=>({code:str(item.code),label:str(item.label)}))
        .filter(item=>item.code&&item.label)
        .sort((a,b)=>a.label.localeCompare(b.label));
}
const log = (ctx: OrgContext, action: string, label: string, details = '') => audit([{
    category: 'maintenance', action, actor: ctx.actor, orgId: ctx.orgId, meta: ctx.meta,
    target: { type: 'gemba', label }, details,
}]);

async function mine(ctx: OrgContext, id: string): Promise<Doc> {
    if (!matchId(id)) throw new HttpError(400, 'Choose a Gemba session.');
    const doc = await getDoc(root(ctx.orgId) + '/' + id);
    if (!doc || str(doc.data.ownerUid) !== ctx.uid) throw new HttpError(404, 'Gemba session not found.');
    return doc;
}
async function assets(ctx: OrgContext) {
    const scope = ctx.role === 'org_super_admin' ? 'all' : await allowedNodeIds(ctx.orgId, ctx.me);
    return (await listDocs('organizations/' + ctx.orgId + '/assets'))
        .filter((d) => ['active', 'change_pending', 'pending_approval'].includes(str(d.data.status)))
        .filter((d) => scope === 'all' || scope.has(str(d.data.nodeId)) || scope.has(str(d.data.workCenterId)))
        .map((d) => ({ tag: d.id, name: str(d.data.name), nodeId: str(d.data.nodeId),
            workCenterId: str(d.data.workCenterId), siteId: str(d.data.siteId) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
async function asset(ctx: OrgContext, tag: string) {
    const chosen = (await assets(ctx)).find((a) => a.tag === tag);
    if (!chosen) throw new HttpError(403, 'Choose an asset from your operational area.');
    return chosen;
}
async function review(ctx: OrgContext, id: string, obsId: string) {
    const g = await mine(ctx, id);
    if (str(g.data.status) !== 'closed') throw new HttpError(409, 'Close the Gemba before reviewing observations.');
    if (!matchId(obsId)) throw new HttpError(400, 'Choose an observation.');
    const obs = await getDoc(obsRoot(ctx.orgId, id) + '/' + obsId);
    if (!obs) throw new HttpError(404, 'Observation not found.');
    if (str(obs.data.reviewStatus) !== 'pending') throw new HttpError(409, 'This observation was already reviewed.');
    return obs;
}
async function assemblyOptions(ctx: OrgContext, tag: string) {
    const a = await asset(ctx, tag);
    const enabled = isObj(ctx.org.data.modules) && ctx.org.data.modules.MNT === true;
    if (!enabled) return [];
    const nodes = await listDocs('organizations/' + ctx.orgId + '/structure');
    const indexed = new Map(nodes.map((node) => [node.id, node]));
    const scope = await scopeOf(ctx);
    const eligible = [];
    for (const assembly of nodes.filter((d) => str(d.data.level) === 'assembly' && str(d.data.status) !== 'inactive')) {
        const chain: string[] = [];
        let node: Doc | undefined = assembly;
        for (let i = 0; node && i < 15; i++) {
            chain.unshift(node.id);
            node = indexed.get(str(node.data.parentId));
        }
        if (!canAt(ctx, 'MNT.WR.create', chain, scope)) continue;
        const unit = chain.map((id) => indexed.get(id)).find((d) => d && ['work_center', 'equipment'].includes(str(d.data.level)));
        const site = chain.map((id) => indexed.get(id)).find((d) => d && str(d.data.level) === 'site');
        const linked = !!a.workCenterId && unit?.id === a.workCenterId;
        const nodeMatch = !!a.nodeId && chain.includes(a.nodeId);
        const siteMatch = !!a.siteId && site?.id === a.siteId;
        if (!linked && !nodeMatch && !siteMatch) continue;
        eligible.push({ id: assembly.id, code: str(assembly.data.code), name: str(assembly.data.name),
            unitName: str(unit?.data.name), siteName: str(site?.data.name) });
    }
    return eligible.sort((a, b) => a.code.localeCompare(b.code)).slice(0, 250);
}
export const quickGembaRoutes = {
    'POST /api/org/quick/gemba/options': [orgRoute('quick.gemba.options', null, async (ctx) => ({
        types: await gembaTypes(), assets: await assets(ctx),
    }))],
    'POST /api/org/quick/gemba/list': [orgRoute('quick.gemba.list', null, async (ctx) => ({
        items: (await listDocs(root(ctx.orgId)))
            .filter((g) => str(g.data.ownerUid) === ctx.uid)
            .sort((a, b) => str(b.data.createdAt).localeCompare(str(a.data.createdAt)))
            .map((g) => ({ id: g.id, ...g.data })),
    }))],
    'POST /api/org/quick/gemba/start': [orgRoute('quick.gemba.start', null, async (ctx) => {
        const typeCode = str(ctx.body.typeCode);
        const type = (await gembaTypes()).find((t) => t.code === typeCode);
        if (!type) throw new HttpError(400, 'Choose an enabled Gemba subtype from Maintenance > Work Request Sources.');
        const name = str(ctx.body.name).trim().slice(0, 120);
        if (name.length < 3) throw new HttpError(400, 'Enter a Gemba name.');
        const selected = [...new Set(Array.isArray(ctx.body.assetTags) ? ctx.body.assetTags.map(str) : [])];
        if (!selected.length || selected.length > 30) throw new HttpError(400, 'Select 1 to 30 assets.');
        const all = await assets(ctx);
        if (selected.some((t) => !all.some((a) => a.tag === t))) throw new HttpError(403, 'An asset is outside your operational scope.');
        const id = randomId(12);
        await writeDoc(root(ctx.orgId) + '/' + id, { name, typeCode, typeName: type.label,
            assetTags: selected, assetNames: selected.map((tag) => all.find((a) => a.tag === tag)?.name || tag),
            ownerUid: ctx.uid, status: 'open', createdAt: nowIso(), closedAt: '' }, { exists: false });
        await log(ctx, 'quick.gemba.start', name, type.label);
        return { id };
    })],
    'POST /api/org/quick/gemba/get': [orgRoute('quick.gemba.get', null, async (ctx) => {
        const id = str(ctx.body.id);
        const g = await mine(ctx, id);
        const observationDocs = (await listDocs(obsRoot(ctx.orgId, id)))
            .sort((a, b) => str(a.data.createdAt).localeCompare(str(b.data.createdAt)));
        const observations = await Promise.all(observationDocs.map(async (d) => {
            const path = str(d.data.photoPath);
            const prefix = 'organizations/' + ctx.orgId + '/gemba_photos/' + ctx.uid + '/' + id + '/';
            return { id: d.id, ...d.data, photoUrl: path.startsWith(prefix) ? await signedUrl(path) : '' };
        }));
        const draft = isObj(g.data.draft) ? g.data.draft : {};
        const draftPath = str(draft.photoPath);
        const prefix = 'organizations/' + ctx.orgId + '/gemba_photos/' + ctx.uid + '/' + id + '/';
        const draftPhotoUrl = draftPath.startsWith(prefix) ? await signedUrl(draftPath) : '';
        return { gemba: { id: g.id, ...g.data, draftPhotoUrl }, observations };
    })],
    'POST /api/org/quick/gemba/photo': [orgRoute('quick.gemba.photo', null, async (ctx) => {
        const id = str(ctx.body.id);
        const g = await mine(ctx, id);
        if (str(g.data.status) !== 'open') throw new HttpError(409, 'Gemba is closed.');
        await rateLimit('gemba-photo', ctx.uid, 60, 3600);
        const content = str(ctx.body.data);
        if (!content || content.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(content)) {
            throw new HttpError(400, 'Upload a JPEG or PNG photo under 1.5 MB.');
        }
        const buf = Buffer.from(content, 'base64');
        if (!buf.length || buf.length > 1_500_000) throw new HttpError(400, 'Photo must be under 1.5 MB.');
        const image = detectImage(buf);
        if (!image) throw new HttpError(400, 'The file is not a JPEG or PNG photo.');
        const path = 'organizations/' + ctx.orgId + '/gemba_photos/' + ctx.uid + '/' + id + '/' + randomId(12) + '.' + image.ext;
        const [ok] = await storage.write([{ path, content, contentType: image.contentType }]);
        if (!ok) throw new HttpError(502, 'Could not save the photo.');
        return { path, url: await signedUrl(path) };
    })],
    'POST /api/org/quick/gemba/observe': [orgRoute('quick.gemba.observe', null, async (ctx) => {
        const id = str(ctx.body.id);
        const g = await mine(ctx, id);
        if (str(g.data.status) !== 'open') throw new HttpError(409, 'Gemba is closed.');
        const tag = str(ctx.body.assetTag);
        if (!Array.isArray(g.data.assetTags) || !g.data.assetTags.includes(tag)) throw new HttpError(400, 'Choose an asset in this Gemba.');
        const selected = await asset(ctx, tag);
        const description = str(ctx.body.description).trim().slice(0, 5000);
        const path = str(ctx.body.photoPath);
        const prefix = 'organizations/' + ctx.orgId + '/gemba_photos/' + ctx.uid + '/' + id + '/';
        if (path && (!path.startsWith(prefix) || !new RegExp('^[A-Za-z0-9_-]{8,40}[.](jpg|png)$').test(path.slice(prefix.length)))) {
            throw new HttpError(400, 'Choose a photo uploaded during this Gemba.');
        }
        if (!path && !description) throw new HttpError(400, 'Enter a description, take a photo, or both.');
        const obsId = randomId(12);
        await writeDoc(obsRoot(ctx.orgId, id) + '/' + obsId, {
            assetTag: tag, assetName: selected.name, description, photoPath: path,
            reviewStatus: 'pending', closureReason: '', workRequestCode: '', assemblyId: '',
            createdAt: nowIso(), reviewedAt: '', reviewedBy: '',
        }, { exists: false });
        // Keep the capture form ready for another observation after successful save.
        try {
            await updateFields(root(ctx.orgId) + '/' + id, {
                draft: { assetTag: tag, description: '', photoPath: '' },
                draftUpdatedAt: nowIso(),
            });
        } catch (error) {
            console.error('Gemba draft reset failed after observation save', error);
        }
        await log(ctx, 'quick.gemba.observation', obsId, tag);
        return { id: obsId };
    })],
    'POST /api/org/quick/gemba/draft': [orgRoute('quick.gemba.draft', null, async (ctx) => {
        const id = str(ctx.body.id);
        const g = await mine(ctx, id);
        if (str(g.data.status) !== 'open') throw new HttpError(409, 'This Gemba no longer accepts observations.');
        const assetTag = str(ctx.body.assetTag);
        if (!Array.isArray(g.data.assetTags) || !g.data.assetTags.includes(assetTag)) {
            throw new HttpError(400, 'Choose an asset in this Gemba.');
        }
        await asset(ctx, assetTag);
        const description = str(ctx.body.description).trim().slice(0, 5000);
        const photoPath = str(ctx.body.photoPath);
        const prefix = 'organizations/' + ctx.orgId + '/gemba_photos/' + ctx.uid + '/' + id + '/';
        if (photoPath && (!photoPath.startsWith(prefix)
            || !new RegExp('^[A-Za-z0-9_-]{8,40}[.](jpg|png)' + String.fromCharCode(36)).test(photoPath.slice(prefix.length)))) {
            throw new HttpError(400, 'Use a photo uploaded during this Gemba.');
        }
        await updateFields(root(ctx.orgId) + '/' + id, {
            draft: { assetTag, description, photoPath },
            draftUpdatedAt: nowIso(),
        });
        await log(ctx, 'quick.gemba.draft.saved', str(g.data.name), 'Observation draft saved for later');
        return { saved: true };
    })],
    'POST /api/org/quick/gemba/close': [orgRoute('quick.gemba.close', null, async (ctx) => {
        const id = str(ctx.body.id);
        const g = await mine(ctx, id);
        if (str(g.data.status) !== 'open') throw new HttpError(409, 'This Gemba is already closed.');
        if (!(await listDocs(obsRoot(ctx.orgId, id))).length) throw new HttpError(400, 'Add an observation before closing.');
        await updateFields(root(ctx.orgId) + '/' + id, { status: 'closed', closedAt: nowIso() });
        await log(ctx, 'quick.gemba.close', str(g.data.name));
        return { closed: true };
    })],
    'POST /api/org/quick/gemba/assemblies': [orgRoute('quick.gemba.assemblies', null, async (ctx) => {
        const id = str(ctx.body.id);
        const obsId = str(ctx.body.observationId);
        const o = await review(ctx, id, obsId);
        return { assemblies: await assemblyOptions(ctx, str(o.data.assetTag)) };
    })],
    'POST /api/org/quick/gemba/resolve': [orgRoute('quick.gemba.resolve', null, async (ctx) => {
        const id = str(ctx.body.id);
        const obsId = str(ctx.body.observationId);
        await review(ctx, id, obsId);
        const reason = str(ctx.body.reason).trim().slice(0, 1400);
        if (reason.length < 5) throw new HttpError(400, 'Provide a closure reason of at least 5 characters.');
        await updateFields(obsRoot(ctx.orgId, id) + '/' + obsId, {
            reviewStatus: 'closed', closureReason: reason, reviewedAt: nowIso(), reviewedBy: ctx.uid,
        });
        await log(ctx, 'quick.gemba.observation.closed', obsId, reason);
        return { ok: true };
    })],
    'POST /api/org/quick/gemba/link-wr': [orgRoute('quick.gemba.link_wr', null, async (ctx) => {
        const id = str(ctx.body.id);
        const obsId = str(ctx.body.observationId);
        const wrCode = str(ctx.body.wrCode);
        if (!new RegExp('^WR[0-9]{8}$').test(wrCode)) throw new HttpError(400, 'Choose a submitted work request.');
        const o = await review(ctx, id, obsId);
        const wr = await getDoc('organizations/' + ctx.orgId + '/work_requests/' + wrCode);
        if (!wr || str(wr.data.requestedBy) !== ctx.uid || str(wr.data.assetTag) !== str(o.data.assetTag)) {
            throw new HttpError(403, 'Link a work request you submitted for this observation asset.');
        }
        await updateFields(obsRoot(ctx.orgId, id) + '/' + obsId, {
            reviewStatus: 'work_request', workRequestCode: wrCode,
            assemblyId: str(wr.data.assemblyId), reviewedAt: nowIso(), reviewedBy: ctx.uid,
        });
        await log(ctx, 'quick.gemba.observation.work_request', obsId, wrCode);
        return { ok: true };
    })],
};
