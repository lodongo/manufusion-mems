import { secrets } from './platform/sdk';
import { timingSafeEqual } from 'node:crypto';
import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, randomId, rateLimit, runQuery, str, updateFields, writeDoc, type Doc, type Obj, type Plain } from './core';
import { audit } from './audit';
import { orgRoute, publicRoute, staff } from './guards';

// Organization modules and subscriptions.
// Prices come from each module (monthly price + price per user, in KES).
// Payments go through a provider: 'mock' (simulated) today; IntaSend checkout is wired in and
// switched on from MEMS admin > Billing once its secrets are added.

const APP_ORIGIN = (process.env.MEMS_PUBLIC_URL || '').replace(/\/$/, '');
const PROVIDERS = ['mock', 'intasend_sandbox', 'intasend_live'];
const INTASEND_BASE: Record<string, string> = {
    intasend_sandbox: 'https://sandbox.intasend.com/api/v1',
    intasend_live: 'https://payment.intasend.com/api/v1',
};

const toNum = (v: Plain | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

async function readSecretSafe(name: string): Promise<string> {
    try {
        return (await secrets.readSecret(name)) ?? '';
    } catch {
        return '';
    }
}

async function paymentProvider(): Promise<string> {
    const settings = await getDoc('system/settings');
    const value = str(settings?.data.paymentProvider);
    return PROVIDERS.includes(value) ? value : 'mock';
}

/** Modules MEMS has initialised and made available to organizations. */
async function catalog() {
    return (await listDocs('modules'))
        .map((d) => ({
            code: d.id,
            name: str(d.data.name),
            category: str(d.data.category),
            description: str(d.data.description),
            mandatory: d.data.mandatory === true,
            available: d.data.enabled === true && d.data.initialized === true,
            monthlyPriceKes: toNum(d.data.monthlyPriceKes),
            pricePerUserKes: toNum(d.data.pricePerUserKes),
            dependencies: Array.isArray(d.data.dependencies) ? (d.data.dependencies as Plain[]).map(str) : [],
            sortOrder: typeof d.data.sortOrder === 'number' ? d.data.sortOrder : 100,
        }))
        .filter((m) => m.available)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

function isOn(org: Doc, code: string, mandatory: boolean): boolean {
    return mandatory || (isObj(org.data.modules) && org.data.modules[code] === true);
}

async function activeUserCount(orgId: string): Promise<number> {
    const users = await runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', orgId) });
    return users.filter((u) => str(u.data.status) !== 'disabled').length;
}

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const invCol = (orgId: string) => `organizations/${orgId}/invoices`;

function invoiceOut(doc: Doc) {
    const d = doc.data;
    return {
        id: doc.id,
        period: str(d.period),
        amount: toNum(d.amount),
        total: toNum(d.total),
        currency: str(d.currency) || 'KES',
        status: str(d.status),
        provider: str(d.provider),
        reference: str(d.reference),
        checkoutUrl: str(d.status) === 'pending' ? str(d.checkoutUrl) : '',
        createdAt: str(d.createdAt),
        paidAt: str(d.paidAt),
        createdBy: str(d.createdBy),
    };
}

async function subscriptionState(org: Doc) {
    const orgId = org.id;
    const [mods, users, invoiceDocs] = await Promise.all([catalog(), activeUserCount(orgId), listDocs(invCol(orgId))]);
    const lines = mods
        .filter((m) => isOn(org, m.code, m.mandatory))
        .map((m) => ({ code: m.code, name: m.name, monthlyPriceKes: m.monthlyPriceKes, pricePerUserKes: m.pricePerUserKes, users, amount: m.monthlyPriceKes + m.pricePerUserKes * users }));
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const period = currentPeriod();
    const invoices = invoiceDocs.map(invoiceOut).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const paid = invoices.filter((i) => i.period === period && i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    const due = Math.max(0, total - paid);
    const pending = invoices.find((i) => i.period === period && i.status === 'pending');
    const status = total === 0 ? 'free' : due === 0 ? 'paid' : pending ? 'pending' : 'due';
    return { period, currency: 'KES', users, lines, total, paid, due, status, invoices: invoices.slice(0, 24) };
}

async function startPayment(provider: string, input: { apiRef: string; amount: number; email: string; firstName: string; lastName: string; phone: string }) {
    if (provider === 'mock') return { status: 'paid' as const, reference: `SIM-${randomId(8).toUpperCase()}`, checkoutUrl: '' };
    const publicKey = await readSecretSafe('INTASEND_PUBLISHABLE_KEY');
    if (!publicKey) throw new HttpError(503, 'Online payments are not set up yet. Please contact MEMS.');
    const res = await fetch(`${INTASEND_BASE[provider]}/checkout/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            public_key: publicKey,
            amount: input.amount,
            currency: 'KES',
            email: input.email,
            first_name: input.firstName,
            last_name: input.lastName,
            phone_number: input.phone.replace(/^\+/, ''),
            api_ref: input.apiRef,
            host: APP_ORIGIN,
            redirect_url: `${APP_ORIGIN}/#organization_admin/subscription`,
        }),
    });
    if (!res.ok) {
        console.error('IntaSend checkout failed', res.status, await res.text().catch(() => ''));
        throw new HttpError(502, 'The payment provider could not start the payment. Please try again.');
    }
    const data = (await res.json()) as { url?: string; id?: string };
    if (!data.url || !/^https:\/\//.test(data.url)) throw new HttpError(502, 'The payment provider returned an invalid checkout link.');
    return { status: 'pending' as const, reference: str(data.id), checkoutUrl: data.url };
}

function safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

export const billingRoutes = {
    'POST /api/org/modules/list': [
        orgRoute('org.modules.list', 'ADM.modules', async (ctx) => {
            const [mods, users] = await Promise.all([catalog(), activeUserCount(ctx.orgId)]);
            return { users, modules: mods.map((m) => ({ ...m, active: isOn(ctx.org, m.code, m.mandatory) })) };
        }),
    ],

    'POST /api/org/modules/set': [
        orgRoute('org.modules.set', 'ADM.modules', async (ctx) => {
            const enable = ctx.body.enabled === true;
            const codes = Array.from(new Set((Array.isArray(ctx.body.codes) ? ctx.body.codes : []).map(str)));
            if (!codes.length) throw new HttpError(400, 'Select at least one module.');
            const mods = await catalog();
            const byCode = new Map(mods.map((m) => [m.code, m]));
            const unknown = codes.filter((c) => !byCode.has(c));
            if (unknown.length) throw new HttpError(400, `Not available: ${unknown.join(', ')}.`);
            const current: Obj = isObj(ctx.org.data.modules) ? { ...ctx.org.data.modules } : {};
            const added: string[] = [];
            if (enable) {
                // Switch on the selected modules and everything they depend on.
                const stack = [...codes];
                while (stack.length) {
                    const code = stack.pop() as string;
                    const mod = byCode.get(code);
                    if (!mod) throw new HttpError(400, `${code} is needed but not available yet.`);
                    if (current[code] === true) continue;
                    current[code] = true;
                    if (!codes.includes(code)) added.push(code);
                    stack.push(...mod.dependencies);
                }
            } else {
                const mandatory = codes.filter((c) => byCode.get(c)?.mandatory);
                if (mandatory.length) throw new HttpError(400, `Required modules cannot be disabled: ${mandatory.join(', ')}.`);
                const remaining = mods.filter((m) => isOn(ctx.org, m.code, m.mandatory) && !codes.includes(m.code));
                const blockers = remaining.filter((m) => m.dependencies.some((d) => codes.includes(d)));
                if (blockers.length) throw new HttpError(400, `Disable these first, they depend on your selection: ${blockers.map((b) => b.code).join(', ')}.`);
                for (const c of codes) current[c] = false;
            }
            await updateFields(`organizations/${ctx.orgId}`, { modules: current, updatedAt: nowIso() });
            await audit([
                { category: 'data', action: enable ? 'org.modules.enable' : 'org.modules.disable', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: codes.join(', ') }, details: added.length ? `Also enabled: ${added.join(', ')}` : '' },
            ]);
            return { added };
        }),
    ],

    'POST /api/org/subscription/get': [
        orgRoute('org.subscription.get', 'ADM.billing', async (ctx) => ({ ...(await subscriptionState(ctx.org)), provider: await paymentProvider() })),
    ],

    'POST /api/org/subscription/pay': [
        orgRoute('org.subscription.pay', 'ADM.billing', async (ctx) => {
            await rateLimit('org-pay', ctx.orgId, 10, 3600);
            const state = await subscriptionState(ctx.org);
            if (state.due <= 0) throw new HttpError(400, 'There is nothing to pay for this month.');
            const provider = await paymentProvider();
            const me = await getDoc(`users/${ctx.uid}`);
            const code = str(ctx.org.data.code) || ctx.orgId.slice(0, 8);
            const id = `INV-${code}-${state.period.replace('-', '')}-${randomId(4).toUpperCase()}`;
            const now = nowIso();
            await writeDoc(
                `${invCol(ctx.orgId)}/${id}`,
                { period: state.period, lines: state.lines as unknown as Plain, total: state.total, paidBefore: state.paid, amount: state.due, currency: 'KES', status: 'pending', provider, createdAt: now, createdBy: ctx.actor.email },
                { exists: false }
            );
            const result = await startPayment(provider, {
                apiRef: `${ctx.orgId}__${id}`,
                amount: state.due,
                email: ctx.actor.email,
                firstName: str(me?.data.firstName),
                lastName: str(me?.data.lastName),
                phone: str(me?.data.phone),
            });
            if (result.status === 'paid') {
                await updateFields(`${invCol(ctx.orgId)}/${id}`, { status: 'paid', paidAt: nowIso(), reference: result.reference });
            } else {
                await updateFields(`${invCol(ctx.orgId)}/${id}`, { checkoutUrl: result.checkoutUrl, reference: result.reference });
            }
            await audit([
                { category: 'data', action: 'org.subscription.pay', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: id }, details: `KES ${state.due} · ${provider === 'mock' ? 'simulated, paid' : 'checkout started'}` },
            ]);
            return { invoiceId: id, status: result.status, checkoutUrl: result.checkoutUrl };
        }),
    ],

    // IntaSend calls this when a payment changes state. The request must carry the shared challenge,
    // and the payment is then confirmed directly with IntaSend before anything is marked paid.
    'POST /api/payments/intasend/webhook': [
        publicRoute(async (body, meta) => {
            const challenge = await readSecretSafe('INTASEND_WEBHOOK_CHALLENGE');
            if (!challenge) throw new HttpError(503, 'Not configured.');
            if (!safeEqual(str(body.challenge), challenge)) {
                await audit([{ category: 'admin', action: 'payment.webhook', outcome: 'blocked', actor: { uid: '', email: 'intasend' }, meta, target: { label: 'IntaSend webhook' }, details: 'Challenge mismatch' }]);
                throw new HttpError(401, 'Unauthorized.');
            }
            const providerInvoice = str(body.invoice_id);
            if (!/^[A-Za-z0-9_-]{3,64}$/.test(providerInvoice)) throw new HttpError(400, 'Invalid invoice.');
            const provider = await paymentProvider();
            const secret = await readSecretSafe('INTASEND_SECRET_KEY');
            if (!INTASEND_BASE[provider] || !secret) throw new HttpError(503, 'Not configured.');
            const res = await fetch(`${INTASEND_BASE[provider]}/payment/status/`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ invoice_id: providerInvoice }),
            });
            if (!res.ok) throw new HttpError(502, 'Could not confirm the payment.');
            const data = (await res.json()) as { invoice?: { state?: string; api_ref?: string; value?: string | number; currency?: string } };
            const inv = data.invoice ?? {};
            const [orgId, invoiceId] = str(inv.api_ref).split('__');
            if (!/^[A-Za-z0-9]{6,64}$/.test(orgId ?? '') || !/^INV-[A-Za-z0-9_-]+$/.test(invoiceId ?? '')) throw new HttpError(400, 'Unknown payment.');
            const doc = await getDoc(`${invCol(orgId)}/${invoiceId}`);
            if (!doc) throw new HttpError(404, 'Unknown payment.');
            const state = str(inv.state).toUpperCase();
            const amountOk = Number(inv.value) >= toNum(doc.data.amount) && str(inv.currency).toUpperCase() === 'KES';
            if (state === 'COMPLETE' && amountOk && str(doc.data.status) !== 'paid') {
                await updateFields(`${invCol(orgId)}/${invoiceId}`, { status: 'paid', paidAt: nowIso(), reference: providerInvoice });
            } else if (state === 'FAILED' && str(doc.data.status) === 'pending') {
                await updateFields(`${invCol(orgId)}/${invoiceId}`, { status: 'failed', reference: providerInvoice });
            }
            await audit([{ category: 'data', action: 'payment.webhook', actor: { uid: '', email: 'intasend' }, meta, orgId, target: { label: invoiceId }, details: `${state}${amountOk ? '' : ' (amount mismatch)'}` }]);
            return { ok: true };
        }),
    ],

    'POST /api/admin/billing/get': [
        staff('admin.billing.get', 'read', async () => {
            const [provider, pk, sk, ch] = await Promise.all([paymentProvider(), readSecretSafe('INTASEND_PUBLISHABLE_KEY'), readSecretSafe('INTASEND_SECRET_KEY'), readSecretSafe('INTASEND_WEBHOOK_CHALLENGE')]);
            return { provider, intasend: { publishableKey: !!pk, secretKey: !!sk, webhookChallenge: !!ch }, webhookUrl: `${APP_ORIGIN}/api/payments/intasend/webhook` };
        }),
    ],

    'POST /api/admin/billing/save': [
        staff('admin.billing.save', 'super', async (ctx) => {
            const provider = str(ctx.body.provider);
            if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'Choose a payment provider.');
            if (provider !== 'mock') {
                const [pk, sk, ch] = await Promise.all([readSecretSafe('INTASEND_PUBLISHABLE_KEY'), readSecretSafe('INTASEND_SECRET_KEY'), readSecretSafe('INTASEND_WEBHOOK_CHALLENGE')]);
                if (!pk || !sk || !ch) throw new HttpError(400, 'Add all three IntaSend secrets before switching to IntaSend.');
            }
            const existing = await getDoc('system/settings');
            await writeDoc('system/settings', { ...(existing?.data ?? {}), paymentProvider: provider, updatedAt: nowIso(), updatedBy: ctx.actor.email });
            await audit([{ category: 'admin', action: 'billing.provider', actor: ctx.actor, meta: ctx.meta, target: { label: 'Payment provider' }, details: provider }]);
            return { provider };
        }),
    ],
};
