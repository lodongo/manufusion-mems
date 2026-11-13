/** Narrow development-only exception: GL may be assigned after an automatic request is released, but before procurement acknowledgement. */
export function mayDeferReplenishmentGl(ctx: { role: string; testMode?: boolean }, glCode: string): boolean {
    return ctx.role === 'org_super_admin' && ctx.testMode === true && !glCode.trim();
}

/** A deferred accounting assignment may never pass into procurement uncorrected. */
export function requiresGlResolution(lines: ReadonlyArray<{ glResolutionRequired?: unknown; glCode?: unknown }>): boolean {
    return lines.some((l) => l.glResolutionRequired === true && !(typeof l.glCode === 'string' && l.glCode.trim()));
}
