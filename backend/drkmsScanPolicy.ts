/**
 * Malware scanning policy for controlled document (DOC) source files, set in MEMS Admin.
 *
 *   system/drkms_scanning   { enabled, reason, updatedBy, updatedAt, version }
 *
 * enabled  → every upload stays quarantined (scanStatus 'pending') until the trusted scanner signs a
 *            'clean' verdict (see drkmsScanner.ts). Nothing can be reviewed, signed or published before.
 * disabled → scanning is bypassed: the upload is still type-checked by its file header, size-limited,
 *            hashed (SHA-256), stored privately and immutably, but released at once with
 *            scanStatus 'not_required'. The bypass is recorded on the file and in the audit trail.
 *
 * The default (no setting saved) is DISABLED, because no scanner service is provisioned yet; MEMS Admin
 * turns scanning on once the scanner is running. Turning it on never releases files; turning it off lets
 * authors release files that were waiting for a scan (audited).
 */
import { HttpError, getDoc, nowIso, str, writeDoc } from './core';
import { staff } from './guards';
import { audit } from './audit';

const PATH = 'system/drkms_scanning';

export interface ScanPolicy { enabled: boolean; reason: string; updatedBy: string; updatedAt: string; version: number; scannerConfigured: boolean }

const scannerConfigured = () => (process.env.MEMS_DRKMS_SCANNER_HMAC_SECRET ?? '').length >= 32;

export async function scanPolicy(): Promise<ScanPolicy> {
    const d = await getDoc(PATH);
    return {
        enabled: d?.data.enabled === true,
        reason: str(d?.data.reason),
        updatedBy: str(d?.data.updatedBy),
        updatedAt: str(d?.data.updatedAt),
        version: Number(d?.data.version) || 0,
        scannerConfigured: scannerConfigured(),
    };
}

/**
 * True when a stored source file may be used (opened, reviewed, signed, published): scanned clean by the
 * trusted scanner, or released while scanning was disabled in MEMS Admin. Quarantined, infected and failed
 * files are never released.
 */
export function fileReleased(file: Record<string, unknown> | undefined | null): boolean {
    if (!file || str(file.availability) !== 'verified') return false;
    const status = str(file.scanStatus);
    return status === 'clean' || (status === 'not_required' && str(file.scanBypass) === 'disabled_in_mems_admin');
}

/** Fields written on a file released without a scan. */
export const bypassFields = (by: string) => ({ scanStatus: 'not_required', availability: 'verified', scanBypass: 'disabled_in_mems_admin', scanBypassAt: nowIso(), scanBypassBy: by });

export const drkmsScanPolicyRoutes = {
    'POST /api/admin/drkms/scanning/get': [
        staff('admin.drkms.scanning.get', 'read', async () => ({ policy: await scanPolicy() })),
    ],
    'POST /api/admin/drkms/scanning/set': [
        staff('admin.drkms.scanning.set', 'super', async (ctx) => {
            const enabled = ctx.body.enabled;
            const reason = str(ctx.body.reason).trim();
            if (typeof enabled !== 'boolean') throw new HttpError(400, 'Choose whether scanning is on or off.');
            if (reason.length < 10 || reason.length > 500) throw new HttpError(400, 'Give a reason of 10 to 500 characters.');
            const current = await scanPolicy();
            if (current.enabled === enabled) throw new HttpError(409, `Scanning is already ${enabled ? 'on' : 'off'}.`);
            const old = await getDoc(PATH);
            const next = { enabled, reason, updatedBy: ctx.actor.email || ctx.uid, updatedAt: nowIso(), version: current.version + 1 };
            const ok = await writeDoc(PATH, next, old ? { updateTime: old.updateTime } : { exists: false });
            if (!ok) throw new HttpError(409, 'The scanning setting changed at the same time. Refresh and try again.');
            await audit([{ category: 'security', action: enabled ? 'drkms.scanning.enabled' : 'drkms.scanning.disabled', actor: ctx.actor, meta: ctx.meta, target: { type: 'platform_setting', label: 'DOC malware scanning' }, outcome: 'success', details: reason }]);
            return { policy: await scanPolicy() };
        }),
    ],
};
