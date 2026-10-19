export async function resolve(specifier, context, next) {
    if (/(?:^|\/)guards(?:\.ts)?$/.test(specifier) && context.parentURL?.includes('/backend/')) {
        return { url: new URL('./maintenance-guards.ts', import.meta.url).href, shortCircuit: true };
    }
    if (/(?:^|\/)core(?:\.ts)?$/.test(specifier) && context.parentURL?.includes('/backend/')) {
        return { url: new URL('./maintenance-fixture.ts', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
}
