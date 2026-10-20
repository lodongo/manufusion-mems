import { storage } from './platform/sdk';
import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, rateLimit, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { allowedNodeIds } from './positions';
import { audited, requireAt } from './scopeGuard';
import { detectImage } from './branding';

// ---------------------------------------------------------------------------
// Material photos and the supplier list of a material (Inventory › material detail).
//
// Photos belong to the material (every warehouse shows the same pictures). They are taken with the phone camera or
// chosen from the gallery, reduced on the device, checked here again (JPEG or PNG by file header, at most 1.5 MB),
// and stored privately; the screen only ever receives short-lived signed links.
//   organizations/{org}/material_photos/{materialId}/{random}.jpg    the image
//   organizations/{org}/material_media/{materialId}                  photos, cover photo, removals (kept as evidence)
// Adding, removing (with a reason) and choosing the cover photo need INV.edit at the warehouse and are audited.
//
// Preferred supplier: only APPROVED vendors whose material scope covers the material's category, either for its
// subcategory or for the whole category, can be chosen. The server checks this again on save.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PHOTO_ID = /^[a-f0-9]{24}$/;
const MAX_PHOTOS = 8;
const MAX_REMOVED = 50;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

export interface SupplierOption {
    id: string;
    number: string;
    name: string;
    /** 'subcategory': the vendor supplies exactly this subcategory; 'category': the vendor supplies the whole category. */
    match: 'subcategory' | 'category';
    classLabel: string;
    sourcingLabel: string;
}

/** Approved vendors whose material scope covers the material's category and subcategory (exact subcategory first). */
export function suppliersFor(vendors: Array<Pick<Doc, 'id' | 'data'>>, material: Obj): SupplierOption[] {
    const category = str(material.categoryCode);
    const subcategory = str(material.subcategoryCode);
    if (!category) return [];
    const out: SupplierOption[] = [];
    for (const v of vendors) {
        if (str(v.data.status) !== 'approved') continue;
        const scopes = objs(v.data.scopes).filter((s) => str(s.kind) === 'material' && str(s.categoryCode) === category);
        const exact = !!subcategory && scopes.some((s) => str(s.subcategoryCode) === subcategory);
        const whole = scopes.some((s) => !str(s.subcategoryCode));
        if (!exact && !whole) continue;
        out.push({
            id: v.id,
            number: str(v.data.number) || v.id,
            name: str(v.data.tradeName) || str(v.data.legalName) || v.id,
            match: exact ? 'subcategory' : 'category',
            classLabel: str(v.data.classLabel),
            sourcingLabel: str(v.data.sourcingLabel),
        });
    }
    return out.sort((a, b) => (a.match === b.match ? a.name.localeCompare(b.name) : a.match === 'subcategory' ? -1 : 1));
}

export async function vendorsForMaterial(orgId: string, material: Obj): Promise<SupplierOption[]> {
    if (!str(material.categoryCode)) return [];
    return suppliersFor(await listDocs(`organizations/${orgId}/vendors`), material);
}

// ----- Photos -----

const photoRoot = (orgId: string, materialId: string) => `organizations/${orgId}/material_photos/${materialId}/`;
const mediaPath = (orgId: string, materialId: string) => `organizations/${orgId}/material_media/${materialId}`;

export interface PhotoOut {
    id: string;
    url: string;
    uploadedAt: string;
    uploadedByName: string;
    cover: boolean;
}

/** Signed (15-minute) links to the material's photos, cover first. Paths outside the material's own folder are never signed. */
export async function materialPhotos(orgId: string, materialId: string): Promise<PhotoOut[]> {
    if (!SAFE_ID.test(materialId)) return [];
    const doc = await getDoc(mediaPath(orgId, materialId));
    const prefix = photoRoot(orgId, materialId);
    const photos = objs(doc?.data.photos).filter((p) => PHOTO_ID.test(str(p.id)) && str(p.path).startsWith(prefix) && /^[a-f0-9]{24}\.(jpg|png)$/.test(str(p.path).slice(prefix.length)));
    if (!photos.length) return [];
    const cover = str(doc?.data.coverId) || str(photos[0].id);
    const urls = await storage.url(photos.map((p) => str(p.path)));
    return photos
        .map((p, i) => ({ id: str(p.id), url: urls[i]?.url || '', uploadedAt: str(p.uploadedAt), uploadedByName: str(p.uploadedByName), cover: str(p.id) === cover }))
        .filter((p) => p.url)
        .sort((a, b) => Number(b.cover) - Number(a.cover));
}

/** The material, mapped to the warehouse, where the person holds INV.edit (location-bound, chart of authority). */
async function editableMaterial(ctx: OrgContext): Promise<{ id: string; warehouseId: string; material: Doc }> {
    const id = str(ctx.body.id);
    const warehouseId = str(ctx.body.warehouseId);
    if (!SAFE_ID.test(id) || !SAFE_ID.test(warehouseId)) throw new HttpError(400, 'Material and warehouse required.');
    await requireAt(ctx, ['INV.edit'], warehouseId, 'write', 'You can change material photos only in warehouses where you hold the inventory edit right.');
    const root = `organizations/${ctx.orgId}`;
    const [warehouse, material, extensions] = await Promise.all([getDoc(`${root}/warehouses/${warehouseId}`), getDoc(`${root}/materials/${id}`), listDocs(`${root}/material_extensions`)]);
    const allowed = ctx.role === 'org_super_admin' ? 'all' : await allowedNodeIds(ctx.orgId, ctx.me, false);
    if (!warehouse || (allowed !== 'all' && !allowed.has(warehouseId)) || !material) throw new HttpError(403, 'Warehouse or material inaccessible.');
    if (!str(material.data.materialNumber) || !['approved', 'active'].includes(str(material.data.status))) throw new HttpError(404, 'Published material not found.');
    const links = Array.isArray(material.data.warehouseIds) ? material.data.warehouseIds.map(str) : [];
    if (str(material.data.pushedAt)) links.push(str(material.data.warehouseId));
    if (extensions.some((x) => str(x.data.sourceId) === id && str(x.data.warehouseId) === warehouseId && str(x.data.status) === 'approved')) links.push(warehouseId);
    if (!links.includes(warehouseId)) throw new HttpError(403, 'Material not mapped to warehouse.');
    return { id, warehouseId, material };
}

const nameOf = (ctx: OrgContext) => [str(ctx.me?.data.firstName), str(ctx.me?.data.lastName)].filter(Boolean).join(' ') || str(ctx.me?.data.email) || ctx.uid;

/** Read-modify-write of the media record with an update-time precondition, so two people never overwrite each other. */
async function changeMedia(ctx: OrgContext, materialId: string, change: (d: Obj) => Obj) {
    const path = mediaPath(ctx.orgId, materialId);
    const old = await getDoc(path);
    const next = change({ ...(old?.data ?? {}) });
    const ok = await writeDoc(path, { ...next, materialId, updatedAt: nowIso(), updatedBy: ctx.uid }, old ? { updateTime: old.updateTime } : { exists: false });
    if (!ok) throw new HttpError(409, 'Someone changed the photos of this material at the same time. Refresh and try again.');
}

export const materialMediaRoutes = {
    'POST /api/org/inventory/material/photo/add': [
        orgRoute('org.inventory.material.photo.add', 'INV.edit', async (ctx) => {
            await rateLimit('material-photo-upload', ctx.uid, 60, 3600);
            const { id, warehouseId, material } = await editableMaterial(ctx);
            const data = str(ctx.body.data).replace(/^data:image\/(?:jpeg|png);base64,/, '');
            if (!data || data.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(413, 'The photo must be a JPEG or PNG under 1.5 MB.');
            const binary = Buffer.from(data, 'base64');
            if (!binary.length || binary.length > 1_500_000) throw new HttpError(413, 'The photo must be a JPEG or PNG under 1.5 MB.');
            const image = detectImage(binary);
            if (!image) throw new HttpError(400, 'Use a JPEG or PNG photo.');
            const current = await getDoc(mediaPath(ctx.orgId, id));
            if (objs(current?.data.photos).length >= MAX_PHOTOS) throw new HttpError(409, `A material can have at most ${MAX_PHOTOS} photos. Remove one first.`);
            const photoId = randomId(12);
            const path = `${photoRoot(ctx.orgId, id)}${photoId}.${image.ext}`;
            const [saved] = await storage.write([{ path, content: data, contentType: image.contentType }]);
            if (!saved) throw new HttpError(502, 'The photo could not be stored. Try again.');
            await changeMedia(ctx, id, (d) => {
                const photos = objs(d.photos);
                if (photos.length >= MAX_PHOTOS) throw new HttpError(409, `A material can have at most ${MAX_PHOTOS} photos. Remove one first.`);
                photos.push({ id: photoId, path, uploadedAt: nowIso(), uploadedBy: ctx.uid, uploadedByName: nameOf(ctx), warehouseId, bytes: binary.length });
                return { ...d, photos, coverId: str(d.coverId) || photoId };
            });
            await audited(ctx, 'inventory.material.photo.add', `${str(material.data.materialNumber)} · ${warehouseId}`, { photoId, bytes: binary.length, type: image.contentType });
            return { ok: true, photos: await materialPhotos(ctx.orgId, id) };
        }),
    ],
    'POST /api/org/inventory/material/photo/remove': [
        orgRoute('org.inventory.material.photo.remove', 'INV.edit', async (ctx) => {
            const { id, warehouseId, material } = await editableMaterial(ctx);
            const photoId = str(ctx.body.photoId);
            const reason = str(ctx.body.reason).trim();
            if (!PHOTO_ID.test(photoId)) throw new HttpError(400, 'Choose a photo of this material.');
            if (reason.length < 5 || reason.length > 300) throw new HttpError(400, 'Give a reason of 5 to 300 characters.');
            await changeMedia(ctx, id, (d) => {
                const photos = objs(d.photos);
                const gone = photos.find((p) => str(p.id) === photoId);
                if (!gone) throw new HttpError(404, 'That photo is no longer on this material.');
                const rest = photos.filter((p) => str(p.id) !== photoId);
                // The image itself is kept (not shown) so the removal can be reviewed later.
                const removed = [{ ...gone, removedAt: nowIso(), removedBy: ctx.uid, reason }, ...objs(d.removed)].slice(0, MAX_REMOVED);
                return { ...d, photos: rest, removed, coverId: str(d.coverId) === photoId ? str(rest[0]?.id) : str(d.coverId) };
            });
            await audited(ctx, 'inventory.material.photo.remove', `${str(material.data.materialNumber)} · ${warehouseId}`, { photoId, reason });
            return { ok: true, photos: await materialPhotos(ctx.orgId, id) };
        }),
    ],
    'POST /api/org/inventory/material/photo/cover': [
        orgRoute('org.inventory.material.photo.cover', 'INV.edit', async (ctx) => {
            const { id, warehouseId, material } = await editableMaterial(ctx);
            const photoId = str(ctx.body.photoId);
            if (!PHOTO_ID.test(photoId)) throw new HttpError(400, 'Choose a photo of this material.');
            let from = '';
            await changeMedia(ctx, id, (d) => {
                if (!objs(d.photos).some((p) => str(p.id) === photoId)) throw new HttpError(404, 'That photo is no longer on this material.');
                from = str(d.coverId);
                return { ...d, coverId: photoId };
            });
            await audited(ctx, 'inventory.material.photo.cover', `${str(material.data.materialNumber)} · ${warehouseId}`, { from: from || null, to: photoId });
            return { ok: true, photos: await materialPhotos(ctx.orgId, id) };
        }),
    ],
};
