import { commitChecked, getDoc, HttpError, nowIso, num, str } from './core';

type Data = Record<string, unknown>;
type Classification = { numberingPattern?: unknown; majorBranch?: unknown; immutableLegacyTemplateCode?: unknown };

/** Extract an approved catalogue prefix; refuse arbitrary client-supplied codes. */
export function classifiedMaterialPrefix(template: Data | undefined): string | null {
    const accounting = template?.accounting;
    const classification: Classification = accounting && typeof accounting === 'object' && !Array.isArray(accounting)
        ? ((accounting as Data).catalogueClassification as Classification || {})
        : {};
    const pattern = str(classification.numberingPattern);
    if (!pattern.endsWith('-{SEQ:06d}')) return null;
    const prefix = pattern.slice(0, -'-{SEQ:06d}'.length);
    return /^[A-Z0-9]{2,5}-[A-Z0-9]{2,8}-[A-Z0-9]{2,8}$/.test(prefix) ? prefix : null;
}

/**
 * Allocate one immutable operational material number, transactionally.
 * The counter, reservation and material update either all commit, or none commit.
 * This method only applies to Finance-approved integrated material catalogues.
 * Legacy materials retain their historical numbering flow.
 */
export async function allocateIntegratedMaterialNumber(args: {
    orgId: string; materialId: string; prefix: string; actorUid: string;
}): Promise<string> {
    const { orgId, materialId, prefix, actorUid } = args;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(orgId) || !/^[A-Za-z0-9_-]{1,128}$/.test(materialId)
        || !/^[A-Z0-9]{2,5}-[A-Z0-9]{2,8}-[A-Z0-9]{2,8}$/.test(prefix))
        throw new HttpError(400, 'Invalid material number scope or classification prefix.');
    const root = 'organizations/' + orgId;
    const path = root + '/materials/' + materialId;
    const counterPath = root + '/material_number_counters/' + prefix;
    for (let attempt = 0; attempt < 30; attempt++) {
        const [material, counter] = await Promise.all([getDoc(path), getDoc(counterPath)]);
        if (!material) throw new HttpError(404, 'Material not found.');
        if (str(material.data.materialNumber)) return str(material.data.materialNumber);
        if (str(material.data.status) !== 'approved')
            throw new HttpError(409, 'Only an approved material can receive its operational number.');
        const last = num(counter?.data.lastSequence) ?? 0;
        if (!Number.isSafeInteger(last) || last < 0 || last >= 999999)
            throw new HttpError(409, 'Material sequence range exhausted.');
        const next = last + 1;
        const number = prefix + '-' + String(next).padStart(6, '0');
        const now = nowIso();
        const reservation = root + '/material_number_reservations/' + number;
        const ok = await commitChecked([
            {
                path: counterPath,
                data: { prefix, lastSequence: next, lastMaterialId: materialId, updatedAt: now },
                precondition: counter ? { updateTime: counter.updateTime } : { exists: false },
            },
            {
                path,
                data: { ...material.data, materialNumber: number, numberAllocatedAt: now, numberAllocatedBy: actorUid, materialNumberScheme: 'STORES-TECH-FAMILY-SEQ' },
                precondition: { updateTime: material.updateTime },
            },
            {
                path: reservation,
                data: { materialId, materialNumber: number, codePrefix: prefix, sequence: next, createdBy: actorUid, createdAt: now },
                precondition: { exists: false },
            },
        ]);
        if (ok) return number;
    }
    throw new HttpError(409, 'Material number changed concurrently. Retry the request.');
}
