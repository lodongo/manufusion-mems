import { secrets } from './platform/sdk';
import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, num, orderDesc, randomId, rateLimit, runQuery, str, updateFields, writeDoc, type Doc } from './core';
import { audit } from './audit';
import { orgRoute, publicRoute, type OrgContext } from './guards';

// Organization modules and subscription billing.
// Payments run in simulation until IntaSend keys are stored as secrets:
//   INTASEND_PUBLISHABLE_KEY, INTASEND_SECRET_KEY, INTASEND_ENV (sandbox | live), INTASEND_WEBHOOK_CHALLENGE

const APP_URL = (process.env.MEMS_PUBLIC_URL || '').replace(/\/?$/, '/');

interface ModuleInfo {
    code: string;
    name: string;
    category: string;
    description: string;
    mandatory: boolean;
    monthlyPriceKes: number;
    pricePerUserKes: number;
    dependencies: string[];
    sortOrder: number;
    features: string[];
}

function moduleInfo(doc: Doc): ModuleInfo {
    const d = doc.data;
    return {
        code: doc.id,
        name: str(d.name),
        category: str(d.category),
        description: str(d.description),
        mandatory: d.mandatory === true,
        monthlyPriceKes: num(d.monthlyPriceKes) ?? 0,
        pricePerUserKes: num(d.pricePerUserKes) ?? 0,
        dependencies: Array.isArray(d.dependencies) ? d.dependencies.map(str) : [],
        sortOrder: num(d.sortOrder) ?? 100,
        features: Array.isArray(d.features) ? d.features.map(str) : [],
    };
}

/** Modules MEMS has initialised and made available to tenants. */
async function availableModules(): Promise<ModuleInfo[]> {
    return (await listDocs('modules'))
        .filter((d) => d.data.initialized === true && d.data.enabled === true)
        .map(moduleInfo)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

function enabledMap(org: Doc): Record<string, boolean> {
    const raw = isObj(org.data.modules) ? org.data.modules : {};
    const out: Record<string, boolean> = {};
    for (const key of Object.keys(raw)) if (raw[key] === true) out[key] = true;
    return out;
}

/** Modules the organization has adopted from the MEMS catalogue (enabled modules count as adopted). */
function adoptedMap(org: Doc): Record<string, boolean> {
    const raw = isObj(org.data.moduleAdopted) ? org.data.moduleAdopted : {};
    const out: Record<string, boolean> = {};
    for (const key of Object.keys(raw)) if (raw[key] === true) out[key] = true;
    return out;
}

function listOut(mods: ModuleInfo[], map: Record<string, boolean>, adopted: Record<string, boolean> = {}) {
    return mods.map((m) => ({ ...m, enabled: m.mandatory || map[m.code] === true, adopted: m.mandatory || map[m.code] === true || adopted[m.code] === true }));
}

const period = () => nowIso().slice(0, 7);

async function secret(name: string): Promise<string> {
    try {
        return String((await secrets.readSecret(name)) ?? '').trim();
    } catch {
        return '';
    }
}

async function intasendKeys(): Promise<{ publishable: string; secretKey: string; live: boolean } | null> {
    const [publishable, secretKey, env] = await Promise.all([secret('INTASEND_PUBLISHABLE_KEY'), secret('INTASEND_SECRET_KEY'), secret('INTASEND_ENV')]);
    if (!publishable || !secretKey) return null;
    return { publishable, secretKey, live: env.toLowerCase() === 'live' };
}

function paymentOut(doc: Doc) {
    const d = doc.data;
    return {
        id: doc.id,
        period: str(d.period),
        amount: num(d.amount) ?? 0,
        currency: str(d.currency) || 'KES',
        method: str(d.method),
        provider: str(d.provider),
        status: str(d.status),
        reference: str(d.reference),
        createdAt: str(d.createdAt),
        paidAt: str(d.paidAt),
        createdBy: str(d.createdBy),
    };
}

async function subscriptionFor(ctx: OrgContext) {
    const current = period();
    const [mods, users, payments, billing, keys] = await Promise.all([
        availableModules(),
        runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', ctx.orgId) }),
        runQuery({ from: [{ collectionId: 'payments' }], orderBy: orderDesc('createdAt'), limit: 24 }, `organizations/${ctx.orgId}`),
        getDoc(`organizations/${ctx.orgId}/billing/${current}`),
        intasendKeys(),
    ]);
    const userCount = users.filter((u) => str(u.data.status) !== 'disabled').length;
    const map = enabledMap(ctx.org);
    const lines = mods
        .filter((m) => m.mandatory || map[m.code])
        .map((m) => ({ code: m.code, name: m.name, monthly: m.monthlyPriceKes, perUser: m.pricePerUserKes, users: userCount, amount: m.monthlyPriceKes + m.pricePerUserKes * userCount }));
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const paid = num(billing?.data.paidAmount) ?? 0;
    const status = total === 0 ? 'free' : paid >= total ? 'paid' : paid > 0 ? 'partial' : 'due';
    return {
        period: current,
        currency: 'KES',
        users: userCount,
        lines,
        total,
        paid,
        balance: Math.max(0, total - paid),
        status,
        payments: payments.map(paymentOut),
        provider: keys ? { name: 'IntaSend', mode: keys.live ? 'live' : 'sandbox' } : { name: 'Simulation', mode: 'test' },
    };
}

async function markPaid(orgId: string, forPeriod: string, amount: number) {
    const path = `organizations/${orgId}/billing/${forPeriod}`;
    const existing = await getDoc(path);
    const paidAmount = (num(existing?.data.paidAmount) ?? 0) + amount;
    await writeDoc(path, { period: forPeriod, paidAmount, currency: 'KES', updatedAt: nowIso(), createdAt: existing ? str(existing.data.createdAt) : nowIso() });
}

/** Starts an IntaSend hosted checkout. To be verified against IntaSend's live API once keys are added. */
async function intasendCheckout(
    keys: { publishable: string; live: boolean },
    p: { amount: number; currency: string; email: string; phone: string; apiRef: string; method: string }
): Promise<{ url: string; id: string }> {
    const base = keys.live ? 'https://payment.intasend.com' : 'https://sandbox.intasend.com';
    const res = await fetch(`${base}/api/v1/checkout/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-IntaSend-Public-API-Key': keys.publishable },
        body: JSON.stringify({
            public_key: keys.publishable,
            amount: p.amount,
            currency: p.currency,
            email: p.email,
            phone_number: p.phone,
            api_ref: p.apiRef,
            method: p.method === 'card' ? 'CARD-PAYMENT' : 'M-PESA',
            redirect_url: `${APP_URL}#organization_admin/subscription`,
        }),
    });
    if (!res.ok) throw new HttpError(502, 'The payment provider could not start the payment. Please try again.');
    const data = (await res.json()) as { url?: string; id?: string };
    if (!data.url) throw new HttpError(502, 'The payment provider did not return a payment page.');
    return { url: data.url, id: str(data.id) };
}

export const subscriptionRoutes = {
    'POST /api/org/modules/list': [
        orgRoute('org.modules.list', 'ADM.modules', async (ctx) => ({ modules: listOut(await availableModules(), enabledMap(ctx.org), adoptedMap(ctx.org)) })),
    ],

    'POST /api/org/modules/set': [
        orgRoute('org.modules.set', 'ADM.modules', async (ctx) => {
            const enable = ctx.body.enabled === true;
            const codes = Array.from(new Set((Array.isArray(ctx.body.codes) ? ctx.body.codes : []).map(str)));
            if (!codes.length) throw new HttpError(400, 'Select at least one module.');
            const mods = await availableModules();
            const byCode = new Map(mods.map((m) => [m.code, m]));
            const unknown = codes.filter((c) => !byCode.has(c));
            if (unknown.length) throw new HttpError(400, `Not available: ${unknown.join(', ')}.`);
            const map = enabledMap(ctx.org);
            const isOn = (c: string) => byCode.get(c)?.mandatory === true || map[c] === true;
            const autoAdded: string[] = [];
            if (enable) {
                const stack = [...codes];
                while (stack.length) {
                    const c = stack.pop() as string;
                    const m = byCode.get(c);
                    if (!m) throw new HttpError(400, `A required module (${c}) is not available yet. Ask MEMS to enable it.`);
                    if (!map[c]) {
                        map[c] = true;
                        if (!codes.includes(c) && !m.mandatory) autoAdded.push(c);
                    }
                    for (const d of m.dependencies) if (!isOn(d)) stack.push(d);
                }
            } else {
                const mandatory = codes.filter((c) => byCode.get(c)?.mandatory);
                if (mandatory.length) throw new HttpError(400, `Mandatory modules cannot be disabled: ${mandatory.join(', ')}.`);
                const off = new Set(codes);
                const blockers = mods.filter((m) => isOn(m.code) && !off.has(m.code) && m.dependencies.some((d) => off.has(d)));
                if (blockers.length) throw new HttpError(400, `${blockers.map((b) => b.name).join(', ')} need the selected modules. Select them too to disable together.`);
                for (const c of codes) delete map[c];
            }
            await updateFields(`organizations/${ctx.orgId}`, { modules: map, modulesUpdatedAt: nowIso() });
            await audit([
                {
                    category: 'data',
                    action: enable ? 'org.modules.enable' : 'org.modules.disable',
                    actor: ctx.actor,
                    meta: ctx.meta,
                    orgId: ctx.orgId,
                    target: { label: codes.join(', ') },
                    details: autoAdded.length ? `Also enabled as required: ${autoAdded.join(', ')}` : '',
                },
            ]);
            return { modules: listOut(mods, map, adoptedMap(ctx.org)), autoAdded };
        }),
    ],

    // One module at a time: adopt from the MEMS catalogue, enable, disable, or remove from adopted.
    'POST /api/org/modules/action': [
        orgRoute('org.modules.action', 'ADM.modules', async (ctx) => {
            const code = str(ctx.body.code);
            const action = str(ctx.body.action);
            if (!['adopt', 'enable', 'disable', 'remove'].includes(action)) throw new HttpError(400, 'Unknown action.');
            const mods = await availableModules();
            const byCode = new Map(mods.map((m) => [m.code, m]));
            const mod = byCode.get(code);
            if (!mod) throw new HttpError(400, 'This module is not available.');
            const map = enabledMap(ctx.org);
            const adopted = adoptedMap(ctx.org);
            for (const k of Object.keys(map)) adopted[k] = true;
            const isOn = (c: string) => byCode.get(c)?.mandatory === true || map[c] === true;
            const also: string[] = [];
            if (action === 'adopt' || action === 'enable') {
                if (action === 'enable' && !adopted[code] && !mod.mandatory) throw new HttpError(400, 'Adopt the module first.');
                const stack = [code];
                while (stack.length) {
                    const c = stack.pop() as string;
                    const m = byCode.get(c);
                    if (!m) throw new HttpError(400, `A required module (${c}) is not available yet. Ask MEMS to enable it.`);
                    adopted[c] = true;
                    if (!isOn(c)) {
                        map[c] = true;
                        if (c !== code && !m.mandatory) also.push(m.name);
                    }
                    for (const d of m.dependencies) if (!isOn(d)) stack.push(d);
                }
            } else if (action === 'disable') {
                if (mod.mandatory) throw new HttpError(400, 'Mandatory modules are always on.');
                const blockers = mods.filter((m) => isOn(m.code) && m.code !== code && m.dependencies.includes(code));
                if (blockers.length) throw new HttpError(400, `${blockers.map((b) => b.name).join(', ')} need ${mod.name}. Disable them first.`);
                delete map[code];
            } else {
                if (mod.mandatory) throw new HttpError(400, 'Mandatory modules cannot be removed.');
                if (isOn(code)) throw new HttpError(400, 'Disable the module before removing it.');
                delete adopted[code];
            }
            await updateFields(`organizations/${ctx.orgId}`, { modules: map, moduleAdopted: adopted, modulesUpdatedAt: nowIso() });
            await audit([
                { category: 'data', action: `org.modules.${action}`, actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: `${mod.code} ${mod.name}` }, details: also.length ? `Also enabled: ${also.join(', ')}` : '' },
            ]);
            return { modules: listOut(mods, map, adopted), also };
        }),
    ],

    'POST /api/org/subscription': [orgRoute('org.subscription.get', 'ADM.modules', async (ctx) => subscriptionFor(ctx))],

    'POST /api/org/subscription/pay': [
        orgRoute('org.subscription.pay', 'ADM.modules', async (ctx) => {
            await rateLimit('org-pay', ctx.orgId, 10, 3600);
            const method = str(ctx.body.method) === 'card' ? 'card' : 'mpesa';
            const phone = str(ctx.body.phone).replace(/[\s-]/g, '');
            if (method === 'mpesa' && !/^\+?\d{9,15}$/.test(phone)) throw new HttpError(400, 'Enter the M-Pesa phone number, e.g. +254712345678.');
            const sub = await subscriptionFor(ctx);
            if (sub.balance <= 0) throw new HttpError(400, 'There is nothing to pay for this month.');
            const id = `PAY_${Date.now()}_${randomId(4)}`;
            const apiRef = `${ctx.orgId}__${id}`;
            const now = nowIso();
            const base = { period: sub.period, amount: sub.balance, currency: 'KES', method, phone: method === 'mpesa' ? phone : '', apiRef, createdAt: now, createdBy: ctx.actor.email };
            const keys = await intasendKeys();
            if (keys) {
                const checkout = await intasendCheckout(keys, { amount: sub.balance, currency: 'KES', email: ctx.actor.email, phone, apiRef, method });
                await writeDoc(`organizations/${ctx.orgId}/payments/${id}`, { ...base, provider: 'intasend', status: 'pending', checkoutId: checkout.id });
                await audit([{ category: 'data', action: 'org.subscription.pay_start', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: id }, details: `KES ${sub.balance} via IntaSend ${method}` }]);
                return { checkoutUrl: checkout.url };
            }
            const reference = `SIM-${randomId(8).toUpperCase()}`;
            await writeDoc(`organizations/${ctx.orgId}/payments/${id}`, { ...base, provider: 'simulation', status: 'paid', paidAt: now, reference });
            await markPaid(ctx.orgId, sub.period, sub.balance);
            await audit([{ category: 'data', action: 'org.subscription.paid', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: id }, details: `KES ${sub.balance} (simulated ${method}) ${reference}` }]);
            return { subscription: await subscriptionFor(ctx) };
        }),
    ],

    // IntaSend payment notifications. Verified by the challenge configured in IntaSend.
    'POST /api/payments/intasend/webhook': [
        publicRoute(async (body, meta) => {
            await rateLimit('intasend-webhook', meta.ip, 300, 3600);
            const challenge = await secret('INTASEND_WEBHOOK_CHALLENGE');
            if (!challenge || str(body.challenge) !== challenge) throw new HttpError(401, 'Invalid notification.');
            const match = /^([A-Za-z0-9]{6,64})__(PAY_[A-Za-z0-9_]{6,60})$/.exec(str(body.api_ref));
            if (!match) throw new HttpError(400, 'Unknown payment reference.');
            const [, orgId, id] = match;
            const path = `organizations/${orgId}/payments/${id}`;
            const payment = await getDoc(path);
            if (!payment) throw new HttpError(404, 'Payment not found.');
            if (str(payment.data.status) === 'paid') return { ok: true };
            const state = str(body.state).toUpperCase();
            if (state === 'COMPLETE') {
                const amount = num(payment.data.amount) ?? 0;
                await updateFields(path, { status: 'paid', paidAt: nowIso(), reference: str(body.invoice_id) || str(body.mpesa_reference) });
                await markPaid(orgId, str(payment.data.period), amount);
            } else if (state === 'FAILED') {
                await updateFields(path, { status: 'failed', failedReason: str(body.failed_reason).slice(0, 200), updatedAt: nowIso() });
            } else {
                await updateFields(path, { providerState: state.slice(0, 40), updatedAt: nowIso() });
            }
            await audit([{ category: 'data', action: 'org.subscription.webhook', actor: { uid: '', email: 'intasend' }, meta, orgId, target: { label: id }, details: state }]);
            return { ok: true };
        }),
    ],
};
