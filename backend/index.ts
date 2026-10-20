import { router, json, storage } from './platform/sdk';
import { recordWiredRoutes } from './transactionRuntime';
import { AFRICAN_COUNTRIES, CURRENCIES, METADATA_LISTS, PUBLIC_EMAIL_DOMAINS } from './defaults';
import { DEFAULT_MODULES, FEATURE_ICONS, MODULE_CATEGORIES, SITE_DEFAULTS } from './catalog';
import { STOCK_META_BY_KEY } from './stockPolicyConfig';
import {
    EMAIL_LOCAL_RE,
    HttpError,
    PROJECT_ID,
    STAFF_DOMAIN,
    asPlain,
    authUserCount,
    checkPassword,
    clientInfo,
    countQuery,
    createAuthUser,
    deleteAuthUser,
    deleteDoc,
    emailDomain,
    fieldEq,
    fieldIn,
    getAccessToken,
    getCerts,
    getDoc,
    hasAnyAuthUser,
    int,
    isObj,
    listDocs,
    listSecretNames,
    lookupAuthByEmail,
    nowIso,
    num,
    orderDesc,
    phoneE164,
    runQuery,
    safe,
    str,
    text,
    updateAuthUser,
    updateFields,
    verifyIdToken,
    writeDoc,
    isValidEmail,
    rateLimit,
    revokeTokens,
    type Doc,
    type Fields,
    type Obj,
    type Plain,
} from './core';
import { AFRICAN_BANKS, extraRoutes } from './extra';
import { audit, queryAudit, type Actor, type Outcome } from './audit';
import {
    STAFF_ROLES,
    activateIfVerified,
    ensureOrgCode,
    ensureOrgDomain,
    isTokenStale,
    landingFor,
    effectiveAccess,
    normalizeOrgRole,
    publicRoute,
    secure,
    staff,
    type SecureContext,
} from './guards';
import { orgRoutes } from './org';
import { drkmsRoutes } from './drkmsRegistry';
import { drkmsFileRoutes } from './drkmsFiles';
import { drkmsEngineeringRoutes } from './drkmsEngineering';
import { drkmsSdsRoutes } from './drkmsSds';
import { drkmsDigitalRoutes } from './drkmsDigital';
import { drkmsTroubleshootingRoutes } from './drkmsTroubleshooting';
import { drkmsPublishRoutes } from './drkmsPublish';
import { drkmsReadRoutes } from './drkmsRead';
import { accessReviewRoutes } from './accessReview';
import { securityReviewRoutes } from './securityReview';
import { healthRoutes } from './healthRoutes';
import { personalWorkspaceRoutes } from './personalWorkspace';
import { quickPersonalRoutes } from './quickPersonal';
import { noteFileRoutes } from './noteFiles';
import { quickStatusRoutes } from './quickStatus';
import { quickGembaRoutes } from './quickGemba';
import { chatRoomRoutes } from './chatRooms';
import { chatMessageRoutes } from './chatMessages';
import { chatMemberRoutes } from './chatMembers';
import { chatActionRoutes } from './chatActions';
import { chatPollRoutes } from './chatPolls';
import { chatPolicyRoutes, chatReportingRoutes } from './chatPolicy';
import { mailRoutes } from './mail';
import { workGroupRoutes } from './workGroups';
import { actionHubRoutes } from './actionHub';
import { actionPhotoRoutes } from './actionPhotos';
import { calendarRoutes } from './mailCalendar';
import { mailPreferenceRoutes } from './mailPreferences';
import { healthOverview } from './healthPolicy';
import { roleCodeRoutes } from './roleCodes';
import { roleDocRoutes } from './roleDocs';
import { documentationRoutes } from './securityDocumentation';
import { workflowTraceRoutes } from './workflowTrace';
import { governanceDocumentRoutes } from './governanceDocumentRoutes';
import { governanceAuditRoutes } from './governanceAuditRoutes';
import { transactionBlueprintRoutes } from './transactionBlueprintRoutes';
import { platformTransactionRoutes } from './platformTransactionRoutes';
import { unifiedApprovalRoutes } from './unifiedApprovalRoutes';
import { procurementSetupRoutes } from './procurementSetup';
import { replenishmentVerificationRoutes, purchaseRequirementRoutes } from './purchaseRequirements';
import { replenishmentRoutes } from './replenishment';
import { procurementPolicyRoutes } from './procurementPolicy';
import { buyerGroupRoutes } from './buyerGroups';
import { quotationRoutes } from './quotations';
import { warehouseOverviewRoutes } from './warehouseOverview';
import { purchaseOrderRoutes } from './purchaseOrders';
import { poFinanceRoutes } from './poFinance';
import { procurementDashboardRoutes } from './procurementDashboard';
import { finRoutes } from './finRoutes';
import { glTransactionRoutes } from './glTransactionRoutes';
import { finLedgerRoutes } from './finLedger';
import { finOpsRoutes } from './finOps';
import { vendorRoutes } from './vendors';
import { orgHomeRoutes } from './orgHome';
import { registrationRoutes } from './registration';
import { applicationRoutes } from './applications';
import { explorerRoutes } from './explorer';
import { settingsRoutes } from './settings';
import { brandingOut, brandingRoutes, THEME_PRESETS as ORG_THEME_PRESETS } from './branding';
import { signedUrl, structureRoutes } from './structure';
import { adminOperationsRoutes } from './adminOperations';
import { fxManagementRoutes } from './fxManagement';
import { fxSchedulerRoutes } from './fxScheduler';
import { automationRoutes } from './automationEngine';
import { setupProgressRoutes } from './setupProgress';
import { positionRoutes } from './positions';
import { moduleDefaultRoutes, pendingDefaultKeys, seedModuleMetadata } from './moduleDefaults';
import { subscriptionRoutes } from './subscriptions';
import { billingRoutes } from './billing';
import { assetRoutes } from './assets';
import {skillRoutes} from './skills';
import { procurementRoutes } from './procurement';
import { stockTakeRoutes } from './stockTake';
import { shortcutRoutes } from './shortcuts';
import { maintenanceRoutes } from './maintenance';
import { maintenanceOperationRoutes } from './maintenanceOperations';
import {maintenanceMaterialCandidateRoutes} from './maintenanceMaterialCandidates';
import { warehouseRoutes } from './warehouse';
import { maintenanceReferenceRoutes } from './maintenanceReferences';
import { utilityRoutes } from './astUtilities';
import { storedEnergyRoutes } from './storedEnergy';
import {assemblyActivityRoutes} from './assemblyActivities';
import {activityRiskRoutes} from './activityRisk';
import {activityLegacyRoutes} from './activityRiskLegacy';
import { safRiskRoutes } from './safRiskMatrix';

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const RATES_SOURCE = 'ExchangeRate-API (open.er-api.com)';
const FIREBASE_STATUS_URL = 'https://status.firebase.google.com/incidents.json';
const SETUP_LOCK_TTL_MS = 10 * 60 * 1000;

const REF = {
    countries: 'reference/countries',
    currencies: 'reference/currencies',
    publicEmailDomains: 'reference/publicEmailDomains',
    metadata: 'reference/metadata',
    banks: 'reference/banks',
};

function record(ctx: SecureContext, category: string, action: string, target: string, details = '', orgId = '') {
    return audit([{ category, action, actor: ctx.actor, meta: ctx.meta, target: { label: target }, details, orgId }]);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

interface UsdRates {
    rates: Record<string, number>;
    updatedAt: string;
}

async function fetchUsdRates(): Promise<UsdRates | null> {
    try {
        const res = await fetch(RATES_URL);
        if (!res.ok) return null;
        const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
        if (data.result !== 'success' || !data.rates) return null;
        const parsed = Date.parse(str(data.time_last_update_utc));
        return { rates: data.rates, updatedAt: Number.isNaN(parsed) ? nowIso() : new Date(parsed).toISOString() };
    } catch {
        return null;
    }
}

function withRates(items: Obj[], rates: UsdRates | null): Obj[] {
    return items.map((item) => {
        const unitsPerUsd = rates ? num(rates.rates[str(item.code)]) : num(item.unitsPerUsd);
        return { ...item, unitsPerUsd, usdPerUnit: unitsPerUsd ? 1 / unitsPerUsd : null };
    });
}

function listItems(doc: Doc | null): Obj[] {
    const value = doc?.data.items;
    return Array.isArray(value) ? value.filter(isObj) : [];
}

async function kesPerUsd(): Promise<number | null> {
    const kes = listItems(await getDoc(REF.currencies)).find((c) => str(c.code) === 'KES');
    return kes ? num(kes.unitsPerUsd) : null;
}

async function buildDefaultDocs(): Promise<Record<keyof typeof REF, Fields>> {
    const now = nowIso();
    const rates = await fetchUsdRates();
    const currencyItems = withRates(CURRENCIES.map((c) => asPlain(c) as Obj), rates);
    return {
        countries: { items: asPlain(AFRICAN_COUNTRIES), count: AFRICAN_COUNTRIES.length, loadedAt: now, source: 'MEMS defaults' },
        currencies: {
            items: currencyItems,
            count: currencyItems.length,
            loadedAt: now,
            source: 'MEMS defaults (ISO 4217)',
            ratesUpdatedAt: rates ? rates.updatedAt : '',
            ratesSource: rates ? RATES_SOURCE : '',
        },
        publicEmailDomains: { items: [...PUBLIC_EMAIL_DOMAINS].sort(), count: PUBLIC_EMAIL_DOMAINS.length, loadedAt: now, source: 'MEMS defaults' },
        metadata: { items: asPlain(METADATA_LISTS), count: METADATA_LISTS.length, loadedAt: now, source: 'MEMS defaults' },
        banks: {
            items: asPlain(AFRICAN_BANKS),
            count: AFRICAN_BANKS.length,
            loadedAt: now,
            source: 'MEMS starter list - verify against each central bank register',
        },
    };
}

const REF_LABELS: Record<keyof typeof REF, string> = {
    countries: 'African countries',
    currencies: 'World currencies',
    publicEmailDomains: 'Blocked public email domains',
    metadata: 'Organization & user metadata lists',
    banks: 'African banks',
};

type DocKey = Exclude<keyof typeof REF, 'metadata'>;
const DOC_KEYS: DocKey[] = ['countries', 'currencies', 'publicEmailDomains', 'banks'];

/** Default value lists are handled one at a time: a reference document, or one metadata list ("meta.<key>"). */
function parseListKey(raw: unknown): { kind: 'doc'; key: DocKey } | { kind: 'meta'; listKey: string } {
    const k = str(raw);
    if ((DOC_KEYS as string[]).includes(k)) return { kind: 'doc', key: k as DocKey };
    const m = /^meta\.([A-Za-z][A-Za-z0-9_]{0,40})$/.exec(k);
    if (m) return { kind: 'meta', listKey: m[1] };
    throw new HttpError(400, 'Unknown default value list.');
}

async function referenceStatus() {
    const keys = Object.keys(REF) as Array<keyof typeof REF>;
    const docs = await Promise.all(keys.map((key) => getDoc(REF[key])));
    const currencies = docs[keys.indexOf('currencies')];
    const metaDoc = docs[keys.indexOf('metadata')];
    const metaLists = listItems(metaDoc);
    const metaKeys = [...new Set([...METADATA_LISTS.map((l) => l.key), ...metaLists.map((l) => str(l.key))])].filter(Boolean);
    const entries = [
        ...DOC_KEYS.map((key) => {
            const d = docs[keys.indexOf(key)];
            return { key: key as string, label: REF_LABELS[key], loaded: !!d, count: num(d?.data.count) ?? 0, updatedAt: str(d?.data.updatedAt) || str(d?.data.loadedAt), hasDefault: true };
        }),
        ...metaKeys.map((k) => {
            const l = metaLists.find((x) => str(x.key) === k);
            const def = METADATA_LISTS.find((x) => x.key === k);
            return {
                key: `meta.${k}`,
                label: l ? str(l.title) : def?.title ?? k,
                loaded: !!l,
                count: l && Array.isArray(l.items) ? l.items.length : 0,
                updatedAt: str(l?.updatedAt) || str(l?.loadedAt) || str(metaDoc?.data.loadedAt),
                hasDefault: !!def,
            };
        }),
    ];
    return {
        entries,
        lists: keys.map((key, i) => ({
            key,
            label: REF_LABELS[key],
            loaded: !!docs[i],
            count: num(docs[i]?.data.count) ?? 0,
            loadedAt: str(docs[i]?.data.loadedAt),
        })),
        ratesUpdatedAt: str(currencies?.data.ratesUpdatedAt),
        ratesSource: str(currencies?.data.ratesSource),
    };
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

function moduleOut(doc: Doc) {
    const d = doc.data;
    return {
        code: doc.id,
        name: str(d.name),
        category: str(d.category),
        description: str(d.description),
        features: Array.isArray(d.features) ? d.features.map(str) : [],
        mandatory: d.mandatory === true,
        enabled: d.enabled === true,
        initialized: d.initialized === true,
        initializedAt: str(d.initializedAt),
        monthlyPriceKes: num(d.monthlyPriceKes) ?? 0,
        annualPriceKes: num(d.annualPriceKes) ?? 0,
        pricePerUserKes: num(d.pricePerUserKes) ?? 0,
        dependencies: Array.isArray(d.dependencies) ? d.dependencies.map(str) : [],
        sortOrder: num(d.sortOrder) ?? 100,
        updatedAt: str(d.updatedAt),
    };
}

async function allModules() {
    return (await listDocs('modules')).map(moduleOut).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

function readModule(raw: unknown): Fields {
    const m = (isObj(raw) ? raw : {}) as Record<string, unknown>;
    const code = str(m.code).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new HttpError(400, 'The module code must be exactly 3 letters, e.g. FIN.');
    const name = text(m, 'name', 2, 60, 'Enter a module name (2 to 60 characters).');
    const category = str(m.category);
    if (!MODULE_CATEGORIES.includes(category)) throw new HttpError(400, 'Choose a category from the list.');
    const description = text(m, 'description', 10, 3000, 'Enter a description (10 to 3000 characters).');
    const features = (Array.isArray(m.features) ? m.features : []).map((f) => str(f).trim()).filter(Boolean);
    if (features.length > 20 || features.some((f) => f.length > 160)) throw new HttpError(400, 'Use up to 20 features of up to 160 characters each.');
    const mandatory = m.mandatory === true;
    const price = (key: string, label: string) => int(m[key], 0, 100_000_000, `Enter a valid ${label} in KES.`);
    const dependencies = Array.from(
        new Set((Array.isArray(m.dependencies) ? m.dependencies : []).map((d) => str(d).toUpperCase()).filter((d) => /^[A-Z]{3}$/.test(d) && d !== code))
    );
    return {
        code,
        name,
        category,
        description,
        features,
        mandatory,
        enabled: mandatory || m.enabled === true,
        monthlyPriceKes: price('monthlyPriceKes', 'monthly price'),
        annualPriceKes: price('annualPriceKes', 'annual price'),
        pricePerUserKes: price('pricePerUserKes', 'price per user'),
        dependencies,
        sortOrder: int(m.sortOrder ?? 100, 0, 9999, 'Enter a sort order between 0 and 9999.'),
    };
}

function metaListOut(doc: Doc) {
    const d = doc.data;
    return {
        key: doc.id,
        title: str(d.title),
        description: str(d.description),
        items: (Array.isArray(d.items) ? d.items : []).filter(isObj).map((i) => ({ code: str(i.code), label: str(i.label), active: i.active !== false, color: str(i.color), category: str(i.category), subcategory: str(i.subcategory), description: str(i.description), attributes: Array.isArray(i.attributes) ? i.attributes : [], selectable: i.selectable !== false, symbol: str(i.symbol), system: str(i.system), baseUnit: str(i.baseUnit), categoryCode: str(i.categoryCode), multiplier: num(i.multiplier) ?? 1 })),
        updatedAt: str(d.updatedAt),
    };
}

// ---------------------------------------------------------------------------
// Site configuration
// ---------------------------------------------------------------------------

type SiteConfig = typeof SITE_DEFAULTS;

function mergeSite(stored: Fields | null): SiteConfig {
    const base = JSON.parse(JSON.stringify(SITE_DEFAULTS)) as SiteConfig;
    if (!stored) return base;
    const out = base as unknown as Record<string, unknown>;
    for (const key of Object.keys(base)) {
        if (key === 'theme' || key === 'features') continue;
        if (typeof stored[key] === 'string') out[key] = stored[key];
    }
    if (isObj(stored.theme)) {
        for (const key of Object.keys(base.theme)) {
            const value = str(stored.theme[key]);
            if (/^#[0-9a-fA-F]{6}$/.test(value)) (base.theme as Record<string, string>)[key] = value;
        }
    }
    if (Array.isArray(stored.features)) {
        base.features = stored.features.filter(isObj).map((f) => ({ icon: str(f.icon), title: str(f.title), text: str(f.text) }));
    }
    return base;
}

function validateSite(raw: unknown): SiteConfig {
    const c = (isObj(raw) ? raw : {}) as Record<string, unknown>;
    const t = (key: string, min: number, max: number, label: string) => text(c, key, min, max, `${label} must be ${min ? `${min} to ` : 'up to '}${max} characters.`);
    const companyWebsiteUrl = t('companyWebsiteUrl', 10, 200, 'Company website URL');
    if (!/^https:\/\/[^\s]+\.[^\s]+$/.test(companyWebsiteUrl)) throw new HttpError(400, 'The company website must start with https://');
    const supportEmail = t('supportEmail', 0, 120, 'Support email').toLowerCase();
    if (supportEmail && (!/^[^\s@]+@[^\s@]+$/.test(supportEmail) || emailDomain(supportEmail) !== STAFF_DOMAIN)) {
        throw new HttpError(400, `The support email must be a @${STAFF_DOMAIN} address.`);
    }
    const supportPhone = str(c.supportPhone).trim() ? phoneE164(c.supportPhone) : '';
    const featuresRaw = Array.isArray(c.features) ? c.features : [];
    if (featuresRaw.length > 8) throw new HttpError(400, 'Use up to 8 website features.');
    const features = featuresRaw.map((f) => {
        const item = (isObj(f) ? f : {}) as Record<string, unknown>;
        const icon = str(item.icon);
        if (!FEATURE_ICONS.includes(icon)) throw new HttpError(400, 'Choose a valid icon for each feature.');
        return {
            icon,
            title: text(item, 'title', 2, 40, 'Each feature needs a title (2 to 40 characters).'),
            text: text(item, 'text', 2, 160, 'Each feature needs a description (2 to 160 characters).'),
        };
    });
    const themeRaw = (isObj(c.theme) ? c.theme : {}) as Record<string, unknown>;
    const theme = { ...SITE_DEFAULTS.theme };
    for (const key of Object.keys(theme) as Array<keyof typeof theme>) {
        const value = str(themeRaw[key]);
        if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new HttpError(400, `Choose a valid colour for ${key}.`);
        theme[key] = value.toLowerCase();
    }
    return {
        brandName: t('brandName', 1, 30, 'Brand name'),
        tagline: t('tagline', 0, 120, 'Tagline'),
        platformName: t('platformName', 2, 80, 'Platform name'),
        heroTitle: t('heroTitle', 2, 120, 'Headline'),
        heroDescription: t('heroDescription', 2, 600, 'Description'),
        registerButtonLabel: t('registerButtonLabel', 2, 40, 'Register button label'),
        loginButtonLabel: t('loginButtonLabel', 2, 30, 'Login button label'),
        loginSubtitle: t('loginSubtitle', 0, 120, 'Login subtitle'),
        forgotPasswordText: t('forgotPasswordText', 0, 200, 'Forgot password note'),
        memsWebsiteLinkLabel: t('memsWebsiteLinkLabel', 2, 40, 'MEMS website link label'),
        companyWebsiteLabel: t('companyWebsiteLabel', 2, 40, 'Company website link label'),
        companyWebsiteUrl,
        supportEmail,
        supportPhone,
        footerText: t('footerText', 0, 160, 'Footer text'),
        organizationFooterMessage: t('organizationFooterMessage', 0, 160, 'Organization footer message'),
        features,
        theme,
    };
}

async function siteLocked() {
    const setup = await getDoc('system/setup');
    return { staffEmailDomain: STAFF_DOMAIN, firebaseProjectId: PROJECT_ID, setupCompletedAt: str(setup?.data.completedAt) };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

async function isSetupComplete(): Promise<boolean> {
    return str((await getDoc('system/setup'))?.data.status) === 'complete';
}

function staffOut(doc: Doc) {
    const d = doc.data;
    return {
        uid: doc.id,
        email: str(d.email),
        firstName: str(d.firstName),
        lastName: str(d.lastName),
        phone: str(d.phone),
        role: normalizeOrgRole(str(d.role)),
        status: str(d.status) || 'active',
        createdAt: str(d.createdAt),
        lastLoginAt: str(d.lastLoginAt),
    };
}

async function otherActiveSuperAdmins(excludeUid: string): Promise<number> {
    const docs = await runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('role', 'super_admin') });
    return docs.filter((d) => d.id !== excludeUid && str(d.data.status) !== 'disabled').length;
}

async function timed(label: string, fn: () => Promise<string>) {
    const start = Date.now();
    try {
        return { label, ok: true, ms: Date.now() - start, detail: await fn() };
    } catch (err) {
        return { label, ok: false, ms: Date.now() - start, detail: err instanceof Error ? err.message : 'Failed' };
    }
}

async function firebaseIncidents() {
    const res = await fetch(FIREBASE_STATUS_URL);
    if (!res.ok) throw new HttpError(502, 'Firebase status page unavailable');
    const data = (await res.json()) as Array<Record<string, any>>;
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    return (Array.isArray(data) ? data : [])
        .filter((i) => !i.end || Date.parse(str(i.end)) > weekAgo)
        .slice(0, 10)
        .map((i) => ({
            title: str(i.external_desc).slice(0, 200),
            service: str(i.service_name) || str(i.affected_products?.[0]?.title),
            severity: str(i.severity),
            begin: str(i.begin),
            end: str(i.end),
            active: !i.end,
        }));
}

const NOISY = new Set(['api', 'navigation', 'interaction', 'form']);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const handler = router(recordWiredRoutes({
    'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

    // ----- Setup -----
    'GET /api/setup/status': [
        publicRoute(async () => {
            if (await isSetupComplete()) return { needsSetup: false };
            return { needsSetup: !(await hasAnyAuthUser()) };
        }),
    ],

    'POST /api/setup/register': [
        publicRoute(async (body, meta) => {
            await rateLimit('setup-register', meta.ip, 10, 3600);
            const email = str(body.email).trim().toLowerCase();
            try {
                const firstName = str(body.firstName).trim();
                const lastName = str(body.lastName).trim();
                const password = str(body.password);
                if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
                if (emailDomain(email) !== STAFF_DOMAIN) throw new HttpError(400, `The super admin must use a @${STAFF_DOMAIN} email address.`);
                if (!firstName || firstName.length > 40) throw new HttpError(400, 'Enter your first name.');
                if (!lastName || lastName.length > 40) throw new HttpError(400, 'Enter your last name.');
                const phone = phoneE164(body.phone);
                checkPassword(password);
                const closed = new HttpError(409, 'Setup has already been completed. Please log in.');
                const busy = new HttpError(409, 'Setup is already in progress. Please try again in a few minutes.');
                const now = new Date();
                const lock = await getDoc('system/setup');
                if (lock) {
                    if (str(lock.data.status) === 'complete') throw closed;
                    const claimedAt = Date.parse(str(lock.data.claimedAt));
                    if (!Number.isNaN(claimedAt) && now.getTime() - claimedAt <= SETUP_LOCK_TTL_MS) throw busy;
                    if (!(await writeDoc('system/setup', { status: 'in_progress', claimedAt: now.toISOString() }, { updateTime: lock.updateTime }))) throw busy;
                } else if (!(await writeDoc('system/setup', { status: 'in_progress', claimedAt: now.toISOString() }, { exists: false }))) {
                    throw busy;
                }
                if (await hasAnyAuthUser()) {
                    await writeDoc('system/setup', { status: 'complete', completedAt: now.toISOString(), note: 'users already existed' });
                    throw closed;
                }
                let uid = '';
                try {
                    uid = await createAuthUser({ email, password, displayName: `${firstName} ${lastName}`, phoneNumber: phone });
                    await writeDoc(`users/${uid}`, { uid, email, firstName, lastName, phone, role: 'super_admin', status: 'active', createdAt: now.toISOString(), lastLoginAt: '' });
                    await writeDoc('system/setup', { status: 'complete', superAdminUid: uid, claimedAt: now.toISOString(), completedAt: nowIso() });
                } catch (err) {
                    if (uid) await deleteAuthUser(uid);
                    await deleteDoc('system/setup');
                    throw err;
                }
                await audit([{ category: 'registration', action: 'setup.complete', actor: { uid, email, role: 'super_admin' }, meta, target: { type: 'account', label: email }, details: `Phone: ${phone}`, client: clientInfo(body.client) }]);
                return { ok: true };
            } catch (err) {
                await audit([
                    {
                        category: 'registration',
                        action: 'setup.attempt',
                        outcome: 'failure',
                        actor: { uid: '', email: email || 'unknown' },
                        meta,
                        target: { type: 'account', label: email },
                        details: `${err instanceof Error ? err.message : 'Error'} · Phone: ${str(body.phone)}`,
                        client: clientInfo(body.client),
                    },
                ]);
                throw err;
            }
        }),
    ],

    // ----- Public site and reference data -----
    'GET /api/site': [
        publicRoute(async () => {
            const doc = await getDoc('site/config');
            const logoDoc=await getDoc('site/logo');const path=str(logoDoc?.data.path);const [signed]=path?await storage.url([path]):[null];return {config:{...mergeSite(doc?.data??null),logoUrl:signed?.url??'',tagline:str(doc?.data.tagline)||'Assets for a Stronger Africa'},locked:await siteLocked()};
        }),
    ],

    'GET /api/reference': [
        publicRoute(async () => {
            const [countries, currencies, metadata] = await Promise.all([getDoc(REF.countries), getDoc(REF.currencies), getDoc(REF.metadata)]);
            return {
                loaded: !!countries && !!currencies && !!metadata,
                countries: listItems(countries),
                currencies: listItems(currencies),
                metadataLists: listItems(metadata),
                ratesUpdatedAt: str(currencies?.data.ratesUpdatedAt),
                ratesSource: str(currencies?.data.ratesSource),
            };
        }),
    ],

    // ----- Audit intake (client-side events and login attempts) -----
    'POST /api/audit/login-attempt': [
        publicRoute(async (body, meta) => {
            await rateLimit('login-attempt', meta.ip, 30, 60);
            const email = str(body.email).trim().toLowerCase().slice(0, 254);
            const outcomeRaw = str(body.outcome);
            // A public client report is not proof of a successful Firebase login.
            let verifiedLogin = false;
            if (outcomeRaw === 'success' && typeof body.idToken === 'string') {
                try { const claims = await verifyIdToken(body.idToken); verifiedLogin = claims.email === email && claims.signInProvider === 'password'; }
                catch { verifiedLogin = false; }
            }
            const outcome: Outcome = outcomeRaw === 'success' ? (verifiedLogin ? 'success' : 'blocked') : outcomeRaw === 'blocked' ? 'blocked' : 'failure';
            const code = str(body.code).slice(0, 80);
            const account = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? await safe(() => lookupAuthByEmail(email), null) : null;
            const user = account ? await safe(() => getDoc(`users/${account.uid}`), null) : null;
            const actor: Actor = verifiedLogin && account
                ? { uid: account.uid, email, role: normalizeOrgRole(str(user?.data.role)), orgId: str(user?.data.orgId) }
                : { uid: '', email: 'anonymous' };
            await audit([
                {
                    category: 'auth',
                    action: outcomeRaw === 'success' ? (verifiedLogin ? 'auth.login_verified' : 'auth.login_unverified_report') : 'auth.login_attempt',
                    outcome,
                    actor,
                    orgId: str(user?.data.orgId),
                    meta,
                    source: verifiedLogin ? 'server' : 'client',
                    route: str(body.route),
                    target: { type: 'account', id: account?.uid, label: email },
                    details: [code && `Reason: ${code}`, verifiedLogin ? 'Authenticated Firebase session' : 'Unverified client report', account?.disabled ? 'Account disabled' : '']
                        .filter(Boolean)
                        .join(' · '),
                    client: clientInfo(body.client),
                },
            ]);
            return { ok: true };
        }),
    ],

    'POST /api/audit/events': [
        publicRoute(async (body, meta) => {
            await rateLimit('client-audit', meta.ip, 120, 60);
            const events = (Array.isArray(body.events) ? (body.events as unknown[]) : []).filter(isObj).slice(0, 50);
            if (!events.length) return { ok: true };
            let actor: Actor = { uid: '', email: 'anonymous' };
            if (typeof body.idToken === 'string' && body.idToken) {
                try {
                    const claims = await verifyIdToken(body.idToken);
                    const user = await getDoc(`users/${claims.sub}`);
                    actor = { uid: claims.sub, email: claims.email, role: normalizeOrgRole(str(user?.data.role)), orgId: str(user?.data.orgId) };
                } catch {
                    // treated as anonymous
                }
            }
            const client = clientInfo({ ...(isObj(body.client) ? body.client : {}), sessionId: str(body.sessionId) });
            const allowed = new Set(['navigation', 'interaction', 'form', 'error']);
            await audit(
                events.map((e) => ({
                    category: allowed.has(str(e.category)) ? str(e.category) : 'interaction',
                    action: str(e.action).slice(0, 100) || 'event',
                    actor,
                    meta,
                    client,
                    source: 'client' as const,
                    route: str(e.route),
                    target: { type: str(e.targetType), label: str(e.targetLabel) },
                    details: [str(e.details), str(e.clientAt) && `Client time: ${str(e.clientAt)}`].filter(Boolean).join(' · '),
                }))
            );
            // Remember the last page each user opened so they return to it next time.
            const lastNav = [...events].reverse().find((e) => str(e.category) === 'navigation' && str(e.route));
            const lastRoute = lastNav ? str(lastNav.route) : '';
            if (actor.uid && actor.role && /^(admin|organization_admin|organization_home)(\/[A-Za-z0-9_-]{1,128}){0,8}$/.test(lastRoute)) {
                await safe(() => updateFields(`users/${actor.uid}`, { lastRoute, lastRouteAt: nowIso() }), undefined);
            }
            return { ok: true };
        }),
    ],

    // ----- Session and profile -----
    'POST /api/session': [
        secure('session', async (ctx) => {
            const { uid, claims, actor, meta } = ctx;
            const user = await getDoc(`users/${uid}`);
            if (!user) {
                return { user: { uid, email: claims.email, firstName: '', lastName: '', phone: '' }, role: null, organization: null, permissions: [], landing: '' };
            }
            const data = user.data;
            if (str(data.status) === 'disabled') throw new HttpError(403, 'Your account has been disabled.');
            if (isTokenStale(user, claims)) throw new HttpError(401, 'Your session has expired. Please log in again.');
            let role = str(data.role);
            let roleName = role;
            let permissions: string[] = [];
            let landing = '';
            let organization: Record<string, unknown> | null = null;
            const orgId = str(data.orgId);
            if (STAFF_ROLES.includes(role)) {
                landing = 'admin';
            } else if (role === 'applicant') {
                landing = 'application';
            } else if (orgId) {
                role = normalizeOrgRole(role);
                actor.orgId = orgId;
                const org = await getDoc(`organizations/${orgId}`);
                if (org) {
                    const domain = await ensureOrgDomain(org);
                    const code = await ensureOrgCode(org);
                    await activateIfVerified(org, claims, actor, meta);
                    org.data.code = code;
                    if (domain && emailDomain(claims.email) !== domain) throw new HttpError(403, 'Your account does not belong to this organization.');
                    const access = await effectiveAccess(orgId, role, user);
                    permissions = access.permissions;
                    roleName = access.roleName;
                    landing = landingFor(role, permissions);
                    organization = {
                        id: org.id,
                        name: str(org.data.name),
                        domain,
                        countryCode: str(org.data.countryCode),
                        countryName: str(org.data.countryName),
                        currencyCode: str(org.data.currencyCode),
                        city: str(org.data.city),
                        status: str(org.data.status) === 'pending_verification' ? 'pending_approval' : str(org.data.status),
                        code: str(org.data.code),
                        rejectionReason: str(org.data.rejectionReason),
                        branding: await brandingOut(org),
                        emailVerified: org.data.creatorEmailVerified === true || claims.emailVerified,
                    };
                }
            }
            actor.role = role;
            const last = Date.parse(str(data.lastLoginAt));
            await updateFields(`users/${uid}`, { lastLoginAt: nowIso() });
            if (Number.isNaN(last) || Date.now() - last > 30 * 60 * 1000) {
                await audit([{ category: 'auth', action: 'auth.session_start', actor, meta, target: { type: 'account', label: claims.email }, details: `Phone: ${str(data.phone)}`, orgId }]);
            }
            return {
                user: { uid, email: str(data.email) || claims.email, firstName: str(data.firstName), lastName: str(data.lastName), phone: str(data.phone) },
                role,
                roleName,
                organization,
                permissions,
                landing,
                mustChangePassword: data.mustChangePassword === true,
                photoUrl: await signedUrl(str(data.photoPath)),
                lastRoute: str(data.lastRoute),
                health: !!orgId && role !== 'applicant' ? healthOverview(user) : undefined,
                preferences: {
                    appearance: (() => { const a = str(isObj(data.personalPreferences) ? data.personalPreferences.appearance : ''); return a === 'organization' || a === 'light' || a === 'dark' || Object.prototype.hasOwnProperty.call(ORG_THEME_PRESETS, a) ? a || 'organization' : 'organization'; })(),
                    startPage: str(isObj(data.personalPreferences) ? data.personalPreferences.startPage : '') === 'last' ? 'last' : 'home',
                },
                photoRequired: !!orgId && role !== 'applicant' && !STAFF_ROLES.includes(role) && !str(data.photoPath),
            };
        }),
    ],

    'POST /api/profile/update': [
        secure('profile.update', async (ctx) => {
            const user = await getDoc(`users/${ctx.uid}`);
            if (!user) throw new HttpError(404, 'Profile not found.');
            const firstName = text(ctx.body, 'firstName', 1, 40, 'Enter your first name.');
            const lastName = text(ctx.body, 'lastName', 1, 40, 'Enter your last name.');
            const phone = phoneE164(ctx.body.phone);
            const changes: Record<string, unknown> = { displayName: `${firstName} ${lastName}` };
            if (phone !== str(user.data.phone)) changes.phoneNumber = phone;
            await updateAuthUser(ctx.uid, changes);
            await updateFields(`users/${ctx.uid}`, { firstName, lastName, phone, updatedAt: nowIso() });
            await record(ctx, 'data', 'profile.update', ctx.actor.email, '', str(user.data.orgId));
            return { firstName, lastName, phone };
        }),
    ],

    // Individual organization member setup. These settings never edit tenant branding.
    'POST /api/profile/preferences': [
        secure('profile.preferences', async (ctx) => {
            const user = await getDoc('users/' + ctx.uid);
            if (!user || !str(user.data.orgId)) throw new HttpError(403, 'Personal organization setup is unavailable.');
            const appearance = str(ctx.body.appearance);
            const startPage = str(ctx.body.startPage);
            if (appearance !== 'organization' && appearance !== 'light' && appearance !== 'dark' && !Object.prototype.hasOwnProperty.call(ORG_THEME_PRESETS, appearance)) throw new HttpError(400, 'Choose an available organization theme preset.');
            if (startPage !== 'home' && startPage !== 'last') throw new HttpError(400, 'Choose homepage or last visited page.');
            const preferences = { appearance, startPage };
            await updateFields('users/' + ctx.uid, {
                personalPreferences: preferences,
                preferencesUpdatedAt: nowIso(),
            });
            await record(ctx, 'data', 'profile.preferences', ctx.actor.email,
                'Personal appearance: ' + appearance + '; start page: ' + startPage, str(user.data.orgId));
            return { preferences };
        }),
    ],

    // ----- Admin: dashboard -----
    'POST /api/admin/dashboard': [
        staff('admin.dashboard', 'read', async () => {
            const [staffUsers, tenants, activeTenants, allUsers, modules, enabledModules, mandatoryModules, initializedModules, authUsers, tenantsRecent, events, ref, kes] =
                await Promise.all([
                    countQuery('users', fieldIn('role', STAFF_ROLES)),
                    countQuery('organizations'),
                    countQuery('organizations', fieldEq('status', 'active')),
                    countQuery('users'),
                    countQuery('modules'),
                    countQuery('modules', fieldEq('enabled', true)),
                    countQuery('modules', fieldEq('mandatory', true)),
                    countQuery('modules', fieldEq('initialized', true)),
                    safe(authUserCount, null as number | null),
                    runQuery({ from: [{ collectionId: 'organizations' }], orderBy: orderDesc('createdAt'), limit: 5 }),
                    safe(() => queryAudit(150), [] as Awaited<ReturnType<typeof queryAudit>>),
                    referenceStatus(),
                    kesPerUsd(),
                ]);
            return {
                stats: {
                    staffUsers,
                    tenants,
                    activeTenants,
                    tenantUsers: Math.max(0, allUsers - staffUsers),
                    authUsers,
                    modules,
                    enabledModules,
                    mandatoryModules,
                    initializedModules,
                    referenceLoaded: ref.lists.filter((l) => l.loaded).length,
                    referenceTotal: ref.lists.length,
                    kesPerUsd: kes,
                    ratesUpdatedAt: ref.ratesUpdatedAt,
                    pendingApprovals: await countQuery('organizations', fieldIn('status', ['pending_approval', 'pending_verification'])),
                    failedLogins24h: events.filter((e) => e.action === 'auth.login_attempt' && e.outcome !== 'success' && Date.now() - Date.parse(e.at) < 86400000).length,
                },
                recentTenants: tenantsRecent.map((d) => ({ id: d.id, name: str(d.data.name), countryName: str(d.data.countryName), status: str(d.data.status), createdAt: str(d.data.createdAt) })),
                recentLogs: events.filter((e) => !NOISY.has(e.category)).slice(0, 8),
            };
        }),
    ],

    // ----- Admin: MEMS staff users -----
    'POST /api/admin/users/list': [
        staff('admin.users.list', 'read', async () => {
            const docs = (await listDocs('users')).filter((d) => STAFF_ROLES.includes(str(d.data.role)));
            return { users: docs.map(staffOut).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)) };
        }),
    ],

    'POST /api/admin/users/create': [
        staff('admin.users.create', 'super', async (ctx) => {
            const { body } = ctx;
            const local = str(body.emailLocal).trim().toLowerCase();
            if (!EMAIL_LOCAL_RE.test(local)) throw new HttpError(400, 'Enter a valid email ID using letters, numbers, dots, dashes or underscores.');
            const email = `${local}@${STAFF_DOMAIN}`;
            const firstName = text(body, 'firstName', 1, 40, 'Enter the first name.');
            const lastName = text(body, 'lastName', 1, 40, 'Enter the last name.');
            const phone = phoneE164(body.phone);
            const role = str(body.role);
            if (!STAFF_ROLES.includes(role)) throw new HttpError(400, 'Choose a role from the list.');
            const password = str(body.password);
            checkPassword(password);
            const uid = await createAuthUser({ email, password, displayName: `${firstName} ${lastName}`, phoneNumber: phone });
            try {
                await writeDoc(`users/${uid}`, { uid, email, firstName, lastName, phone, role, status: 'active', createdAt: nowIso(), createdBy: ctx.uid, lastLoginAt: '', mustChangePassword: true, passwordChangeRequiredAt: nowIso() });
            } catch (err) {
                await deleteAuthUser(uid);
                throw err;
            }
            await record(ctx, 'admin', 'staff.create', email, `Role: ${role}`);
            return { uid };
        }),
    ],

    'POST /api/admin/users/update': [
        staff('admin.users.update', 'super', async (ctx) => {
            const { body } = ctx;
            const uid = str(body.uid);
            const target = uid ? await getDoc(`users/${uid}`) : null;
            if (!target || !STAFF_ROLES.includes(str(target.data.role))) throw new HttpError(404, 'User not found.');
            const firstName = text(body, 'firstName', 1, 40, 'Enter the first name.');
            const lastName = text(body, 'lastName', 1, 40, 'Enter the last name.');
            const phone = phoneE164(body.phone);
            const role = str(body.role);
            if (!STAFF_ROLES.includes(role)) throw new HttpError(400, 'Choose a role from the list.');
            const status = str(body.status) === 'disabled' ? 'disabled' : 'active';
            const currentRole = str(target.data.role);
            if (uid === ctx.uid && (role !== currentRole || status === 'disabled')) throw new HttpError(400, 'You cannot change your own role or disable your own account.');
            if (currentRole === 'super_admin' && (role !== 'super_admin' || status === 'disabled') && (await otherActiveSuperAdmins(uid)) === 0) {
                throw new HttpError(400, 'MEMS needs at least one active super admin.');
            }
            const revoke = role !== currentRole || status !== (str(target.data.status) || 'active');
            const changes: Record<string, unknown> = { displayName: `${firstName} ${lastName}`, disableUser: status === 'disabled' };
            if (phone !== str(target.data.phone)) changes.phoneNumber = phone;
            await updateAuthUser(uid, changes);
            if (revoke) await revokeTokens(uid);
            await writeDoc(`users/${uid}`, {
                ...target.data,
                firstName,
                lastName,
                phone,
                role,
                status,
                updatedAt: nowIso(),
                updatedBy: ctx.uid,
                ...(revoke ? { tokensValidAfter: nowIso() } : {}),
            });
            await record(ctx, 'admin', 'staff.update', str(target.data.email), `Role: ${role}, status: ${status}`);
            return { ok: true };
        }),
    ],

    'POST /api/admin/users/delete': [
        staff('admin.users.delete', 'super', async (ctx) => {
            const uid = str(ctx.body.uid);
            if (uid === ctx.uid) throw new HttpError(400, 'You cannot delete your own account.');
            const target = uid ? await getDoc(`users/${uid}`) : null;
            if (!target || !STAFF_ROLES.includes(str(target.data.role))) throw new HttpError(404, 'User not found.');
            if (str(target.data.role) === 'super_admin' && (await otherActiveSuperAdmins(uid)) === 0) throw new HttpError(400, 'MEMS needs at least one active super admin.');
            await deleteAuthUser(uid, true);
            await deleteDoc(`users/${uid}`);
            await record(ctx, 'admin', 'staff.delete', str(target.data.email));
            return { ok: true };
        }),
    ],

    // ----- Admin: tenants -----
    'POST /api/admin/tenants/list': [
        staff('admin.tenants.list', 'read', async () => {
            const docs = await runQuery({ from: [{ collectionId: 'organizations' }], orderBy: orderDesc('createdAt'), limit: 300 });
            for (const d of [...docs].reverse()) {
                if (!str(d.data.code)) await ensureOrgCode(d);
            }
            return {
                tenants: docs.map((d) => ({
                    id: d.id,
                    code: str(d.data.code),
                    name: str(d.data.name),
                    domain: str(d.data.domain),
                    countryName: str(d.data.countryName),
                    countryCode: str(d.data.countryCode),
                    city: str(d.data.city),
                    currencyCode: str(d.data.currencyCode),
                    industry: str(d.data.industry),
                    status: str(d.data.status),
                    createdAt: str(d.data.createdAt),
                })),
            };
        }),
    ],

    'POST /api/admin/tenants/get': [
        staff('admin.tenants.get', 'read', async ({ body }) => {
            const orgId = str(body.orgId);
            const org = /^[A-Za-z0-9]{10,40}$/.test(orgId) ? await getDoc(`organizations/${orgId}`) : null;
            if (!org) throw new HttpError(404, 'Tenant not found.');
            await ensureOrgDomain(org);
            await ensureOrgCode(org);
            const fresh = (await getDoc(`organizations/${orgId}`)) ?? org;
            const [users, modules] = await Promise.all([runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', orgId) }), allModules()]);
            const enabledMap = isObj(fresh.data.modules) ? fresh.data.modules : {};
            const adoptedMap = isObj(fresh.data.moduleAdopted) ? fresh.data.moduleAdopted : {};
            return {
                tenant: { id: fresh.id, ...fresh.data },
                users: users.map(staffOut),
                modules: modules.map((m) => ({
                    code: m.code,
                    name: m.name,
                    category: m.category,
                    mandatory: m.mandatory,
                    available: m.enabled,
                    enabled: m.mandatory || enabledMap[m.code] === true,
                    adopted: m.mandatory || enabledMap[m.code] === true || adoptedMap[m.code] === true,
                    monthlyPriceKes: m.monthlyPriceKes,
                })),
            };
        }),
    ],

    'POST /api/admin/tenants/logs': [
        staff('admin.tenants.logs', 'read', async ({ body }) => {
            const orgId = str(body.orgId);
            if (!/^[A-Za-z0-9]{10,40}$/.test(orgId)) throw new HttpError(400, 'Tenant not specified.');
            return { logs: await queryAudit(200, orgId) };
        }),
    ],

    'POST /api/admin/tenants/status': [
        staff('admin.tenants.status', 'write', async (ctx) => {
            const orgId = str(ctx.body.orgId);
            const status = str(ctx.body.status);
            if (status !== 'active' && status !== 'suspended') throw new HttpError(400, 'Invalid status.');
            const org = /^[A-Za-z0-9]{10,40}$/.test(orgId) ? await getDoc(`organizations/${orgId}`) : null;
            if (!org) throw new HttpError(404, 'Tenant not found.');
            if (!['active', 'suspended'].includes(str(org.data.status))) {
                throw new HttpError(400, 'Pending or rejected registrations must be decided through the approval process.');
            }
            await updateFields(`organizations/${orgId}`, { status, updatedAt: nowIso() });
            await record(ctx, 'admin', 'tenant.status', str(org.data.name), `Status set to ${status}`, orgId);
            return { status };
        }),
    ],

    'POST /api/admin/tenants/module': [
        staff('admin.tenants.module', 'write', async (ctx) => {
            // MEMS staff can see an organization's modules but never adopt, enable or disable them on its behalf.
            await record(ctx, 'security', 'tenant.module.blocked', str(ctx.body.orgId), `Attempt to change ${str(ctx.body.code)} on behalf of the organization`, str(ctx.body.orgId));
            if (ctx.body.orgId !== undefined || ctx.body.orgId === undefined) throw new HttpError(403, 'Modules are adopted and enabled only by the organization itself. MEMS can view them but cannot change them.');
            const orgId = str(ctx.body.orgId);
            const code = str(ctx.body.code);
            const enabled = ctx.body.enabled === true;
            const [org, mod] = await Promise.all([
                /^[A-Za-z0-9]{10,40}$/.test(orgId) ? getDoc(`organizations/${orgId}`) : Promise.resolve(null),
                /^[A-Z]{3}$/.test(code) ? getDoc(`modules/${code}`) : Promise.resolve(null),
            ]);
            if (!org) throw new HttpError(404, 'Tenant not found.');
            if (!mod) throw new HttpError(404, 'Module not found.');
            if (mod.data.mandatory === true && !enabled) throw new HttpError(400, 'Mandatory modules cannot be switched off.');
            if (enabled && mod.data.enabled !== true) throw new HttpError(400, 'This module is not available to tenants.');
            const current: Obj = isObj(org.data.modules) ? { ...org.data.modules } : {};
            current[code] = enabled;
            await updateFields(`organizations/${orgId}`, { modules: current, updatedAt: nowIso() });
            await record(ctx, 'admin', 'tenant.module', str(org.data.name), `${code} ${enabled ? 'enabled' : 'disabled'}`, orgId);
            return { ok: true };
        }),
    ],

    // ----- Admin: modules -----
    'POST /api/admin/modules/list': [
        staff('admin.modules.list', 'read', async () => {
            const [modules, seed, kes] = await Promise.all([allModules(), getDoc('system/modules'), kesPerUsd()]);
            return { modules, seeded: seed?.data.seeded === true, kesPerUsd: kes, categories: MODULE_CATEGORIES };
        }),
    ],

    'POST /api/admin/modules/seed': [
        staff('admin.modules.seed', 'write', async (ctx) => {
            if (!(await writeDoc('system/modules', { seeded: true, seededAt: nowIso(), seededBy: ctx.actor.email }, { exists: false }))) {
                throw new HttpError(409, 'Default modules have already been uploaded. Use add, edit and delete to manage modules.');
            }
            let added = 0;
            for (const m of DEFAULT_MODULES) {
                if (await writeDoc(`modules/${m.code}`, { ...(asPlain(m) as Obj), initialized: false, createdAt: nowIso(), updatedAt: nowIso() }, { exists: false })) added++;
            }
            await record(ctx, 'admin', 'module.seed', 'Default modules', `${added} modules uploaded`);
            return { added };
        }),
    ],

    'POST /api/admin/modules/save': [
        staff('admin.modules.save', 'write', async (ctx) => {
            const mod = readModule(ctx.body.module);
            const code = str(mod.code);
            const existingCodes = new Set((await listDocs('modules')).map((d) => d.id));
            const missing = (mod.dependencies as string[]).filter((d) => !existingCodes.has(d));
            if (missing.length) throw new HttpError(400, `Unknown dependencies: ${missing.join(', ')}.`);
            if (ctx.body.isNew === true) {
                if (!(await writeDoc(`modules/${code}`, { ...mod, initialized: false, createdAt: nowIso(), updatedAt: nowIso() }, { exists: false }))) {
                    throw new HttpError(409, `A module with code ${code} already exists.`);
                }
                await record(ctx, 'admin', 'module.create', code, str(mod.name));
            } else {
                const existing = await getDoc(`modules/${code}`);
                if (!existing) throw new HttpError(404, 'Module not found. The module code cannot be changed.');
                await writeDoc(`modules/${code}`, {
                    ...mod,
                    initialized: existing.data.initialized === true,
                    initializedAt: str(existing.data.initializedAt),
                    createdAt: str(existing.data.createdAt),
                    updatedAt: nowIso(),
                });
                await record(ctx, 'admin', 'module.update', code, str(mod.name));
            }
            const saved = await getDoc(`modules/${code}`);
            return { module: saved ? moduleOut(saved) : null };
        }),
    ],

    'POST /api/admin/modules/delete': [
        staff('admin.modules.delete', 'write', async (ctx) => {
            const code = str(ctx.body.code);
            const target = /^[A-Z]{3}$/.test(code) ? await getDoc(`modules/${code}`) : null;
            if (!target) throw new HttpError(404, 'Module not found.');
            if (target.data.mandatory === true) throw new HttpError(400, 'Make the module optional before deleting it.');
            if (target.data.initialized === true) throw new HttpError(400, 'Initialised modules cannot be deleted. Disable the module instead.');
            const dependents = (await allModules()).filter((m) => m.dependencies.includes(code)).map((m) => m.code);
            if (dependents.length) throw new HttpError(400, `These modules depend on ${code}: ${dependents.join(', ')}.`);
            await deleteDoc(`modules/${code}`);
            await record(ctx, 'admin', 'module.delete', code, str(target.data.name));
            return { ok: true };
        }),
    ],

    // Initialise: creates the module's dedicated folder with its two core files.
    'POST /api/admin/modules/initialise': [
        staff('admin.modules.initialise', 'write', async (ctx) => {
            const code = str(ctx.body.code);
            const mod = /^[A-Z]{3}$/.test(code) ? await getDoc(`modules/${code}`) : null;
            if (!mod) throw new HttpError(404, 'Module not found.');
            const now = nowIso();
            const name = str(mod.data.name);
            const folder = `modules/${code}`;
            if (
                !(await writeDoc(
                    `module_workspaces/${code}`,
                    { code, name, folder, files: [`${code}_admin`, `${code}_user`], initializedAt: now, initializedBy: ctx.actor.email },
                    { exists: false }
                ))
            ) {
                throw new HttpError(409, `${code} has already been initialised.`);
            }
            const file = (kind: 'admin' | 'user'): Fields => ({
                name: `${code}_${kind}`,
                kind,
                module: code,
                path: `${folder}/${code}_${kind}`,
                title: kind === 'admin' ? `${name} administration` : name,
                description:
                    kind === 'admin'
                        ? `Administration and configuration for ${name}: setup, metadata, permissions and approval rules. Opened by organization administrators.`
                        : `Day-to-day screens for ${name}, used by organization users according to their role permissions.`,
                audience: kind === 'admin' ? 'organization_admin' : 'organization_home',
                version: 1,
                sections: [],
                createdAt: now,
                updatedAt: now,
            });
            await writeDoc(`module_workspaces/${code}/files/${code}_admin`, file('admin'));
            await writeDoc(`module_workspaces/${code}/files/${code}_user`, file('user'));
            await seedModuleMetadata(code);
            await updateFields(`modules/${code}`, { initialized: true, initializedAt: now });
            await record(ctx, 'admin', 'module.initialise', code, `Folder ${folder} created with ${code}_admin and ${code}_user`);
            return { ok: true };
        }),
    ],

    'POST /api/admin/modules/workspace': [
        staff('admin.modules.workspace', 'read', async ({ body }) => {
            const code = str(body.code);
            if (!/^[A-Z]{3}$/.test(code)) throw new HttpError(400, 'Invalid module code.');
            const workspace = await getDoc(`module_workspaces/${code}`);
            if (!workspace) return { workspace: null, files: [], metadata: [] };
            if (code === 'AST') await seedModuleMetadata('AST');
            const [files, metadata] = await Promise.all([listDocs(`module_workspaces/${code}/files`), listDocs(`module_workspaces/${code}/metadata`)]);
            return {
                workspace: { ...workspace.data, code },
                files: files.map((f) => ({ id: f.id, ...f.data })),
                metadata: metadata.map(metaListOut).sort((a, b) => a.title.localeCompare(b.title)),
                defaultsAvailable: pendingDefaultKeys(code, metadata),
            };
        }),
    ],

    'POST /api/admin/modules/metadata/skills/status': [staff('admin.modules.metadata.skills.status','write',async ctx=>{const changes=ctx.body.changes;if(!Array.isArray(changes)||changes.length>500)throw new HttpError(400,'Invalid skill updates.');const path='module_workspaces/HRM/metadata/skillsMaster';const doc=await getDoc(path);if(!doc)throw new HttpError(404,'Load HRM Skills Master defaults first.');const items=(Array.isArray(doc.data.items)?doc.data.items:[]).filter(isObj);const allowed=new Set(items.map(x=>str(x.code)));const updates=new Map<string,boolean>();for(const change of changes){if(!isObj(change)||!allowed.has(str(change.code))||typeof change.active!=='boolean')throw new HttpError(400,'Invalid skill status.');updates.set(str(change.code),change.active);}await writeDoc(path,{...doc.data,items:items.map(x=>updates.has(str(x.code))?{...x,active:updates.get(str(x.code))}:x),updatedAt:nowIso()});await record(ctx,'admin','module.metadata.skills.status','HRM.skillsMaster',String(updates.size)+' status updates');return {ok:true};})],

    'POST /api/admin/modules/metadata/save': [
        staff('admin.modules.metadata.save', 'write', async (ctx) => {
            const code = str(ctx.body.code);
            if (!/^[A-Z]{3}$/.test(code) || !(await getDoc(`module_workspaces/${code}`))) throw new HttpError(400, 'Initialise the module before adding metadata.');
            const raw = (isObj(ctx.body.list) ? ctx.body.list : {}) as Record<string, unknown>;
            const key = str(raw.key).trim();
            if (!/^[a-z][a-zA-Z0-9_]{1,39}$/.test(key)) throw new HttpError(400, 'The list key must start with a lower-case letter and use letters, numbers or underscores (2 to 40).');
            const title = text(raw, 'title', 2, 60, 'Enter a list title (2 to 60 characters).');
            const description = text(raw, 'description', 0, 300, 'Description can be up to 300 characters.');
            const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
            if (itemsRaw.length > 500) throw new HttpError(400, 'A list can have up to 500 entries.');
            const seen = new Set<string>();
            const items = itemsRaw.filter(isObj).map((i) => {
                const itemCode = str(i.code).trim();
                const label = str(i.label).trim();
                if (!/^[A-Za-z0-9_-]{1,40}$/.test(itemCode)) throw new HttpError(400, `Invalid entry code "${itemCode}". Use letters, numbers, dashes or underscores.`);
                if (!label || label.length > 120) throw new HttpError(400, `Entry ${itemCode} needs a label of up to 120 characters.`);
                if (seen.has(itemCode)) throw new HttpError(400, `Duplicate entry code ${itemCode}.`);
                seen.add(itemCode);
                return { code: itemCode, label, active: i.active !== false, color: /^#[0-9a-fA-F]{6}$/.test(str(i.color)) ? str(i.color) : '#64748B', category: str(i.category).slice(0,100), subcategory: str(i.subcategory).slice(0,100), description: str(i.description).slice(0,600), selectable: i.selectable !== false };
            });
            if (code === 'HRM' && key === 'skillsMaster') {
                const prev = await getDoc('module_workspaces/HRM/metadata/skillsMaster');
                if (!prev || ctx.body.isNew === true) throw new HttpError(400, 'Load the standard skills catalogue first.');
                const original = (Array.isArray(prev.data.items) ? prev.data.items : []).filter(isObj);
                const oldCodes = new Set(original.map(x => str(x.code)));
                if (itemsRaw.length !== original.length || itemsRaw.some(x => !isObj(x) || !oldCodes.has(str(x.code)))) throw new HttpError(400, 'Skills cannot be deleted or recoded; disable them instead.');
                const statuses = new Map(itemsRaw.filter(isObj).map(x => [str(x.code), x.active !== false]));
                await writeDoc('module_workspaces/HRM/metadata/skillsMaster', {...prev.data, items: original.map(x => ({...x, active: statuses.get(str(x.code)) !== false})), updatedAt: nowIso()});
                await record(ctx, 'admin', 'module.metadata.save', 'HRM.skillsMaster', 'Updated skill statuses');
                return {ok:true};
            }
            if (code === 'PRC' && key === 'unitsOfMeasure') {
                const existing = await getDoc('module_workspaces/PRC/metadata/unitsOfMeasure');
                if (!existing || ctx.body.isNew === true) throw new HttpError(400, 'Load the standard UOM catalogue first.');
                const oldItems = (Array.isArray(existing.data.items) ? existing.data.items : []).filter(isObj);
                const oldCodes = new Set(oldItems.map((u) => str(u.code)));
                if (itemsRaw.length !== oldItems.length || itemsRaw.some((u) => !isObj(u) || !oldCodes.has(str(u.code)))) throw new HttpError(400, 'Standard UOM entries cannot be removed or recoded. Disable an entry instead.');
                const requested = new Map(itemsRaw.filter(isObj).map((u) => [str(u.code), u.active !== false]));
                const updated = oldItems.map((u) => ({ ...u, active: requested.get(str(u.code)) !== false }));
                await writeDoc('module_workspaces/PRC/metadata/unitsOfMeasure', { ...existing.data, items: updated, updatedAt: nowIso() });
                await record(ctx, 'admin', 'module.metadata.save', 'PRC.unitsOfMeasure', `${updated.length} UOM entries; status only`);
                return { ok: true };
            }
            if (code === 'INV' && (key === 'materialClassifications' || key === 'storageLocationTypes')) {
                // Codified lists referenced by warehouse storage locations: entries can be disabled, never removed or renumbered.
                const prev = await getDoc(`module_workspaces/INV/metadata/${key}`);
                const missing = (Array.isArray(prev?.data.items) ? (prev?.data.items as unknown[]) : []).filter(isObj).map((i) => str(i.code)).filter((c) => c && !seen.has(c));
                if (missing.length) throw new HttpError(400, `${missing.slice(0, 10).join(', ')} may be used by warehouse storage locations. Disable entries instead of removing them.`);
            }
            if (code === 'PRC' && STOCK_META_BY_KEY.has(key)) {
                const def = STOCK_META_BY_KEY.get(key)!;
                if (ctx.body.isNew === true) throw new HttpError(409, 'Load the MEMS stock metadata defaults before editing.');
                const prior = await getDoc(`module_workspaces/PRC/metadata/${key}`);
                if (!prior) throw new HttpError(404, 'Load the stock reference defaults first.');
                const previous = (Array.isArray(prior.data.items) ? prior.data.items : []).filter(isObj);
                const prefix = def.items[0]?.code.replace(/\d+$/, '') || '';
                const absent = previous.map(x => str(x.code)).filter(v => !seen.has(v));
                if (absent.length) throw new HttpError(409, 'Disable existing stock codes instead of removing or renumbering them: ' + absent.slice(0, 8).join(', '));
                if (items.some(x => !new RegExp('^' + prefix + '[0-9]{2}' + '$').test(x.code) || x.description.trim().length < 20))
                    throw new HttpError(400, 'Stock variable codes must retain their master prefix and detailed description (at least 20 characters).');
            }
            const path = `module_workspaces/${code}/metadata/${key}`;
            if (ctx.body.isNew === true) {
                if (!(await writeDoc(path, { title, description, items, createdAt: nowIso(), updatedAt: nowIso() }, { exists: false }))) {
                    throw new HttpError(409, `A metadata list with key ${key} already exists.`);
                }
            } else {
                const existing = await getDoc(path);
                if (!existing) throw new HttpError(404, 'Metadata list not found.');
                await writeDoc(path, { title, description, items, createdAt: str(existing.data.createdAt), updatedAt: nowIso() });
            }
            await record(ctx, 'admin', 'module.metadata.save', `${code}.${key}`, `${items.length} entries`);
            return { ok: true };
        }),
    ],

    'POST /api/admin/modules/metadata/delete': [
        staff('admin.modules.metadata.delete', 'write', async (ctx) => {
            const code = str(ctx.body.code);
            const key = str(ctx.body.key);
            if (!/^[A-Z]{3}$/.test(code) || !/^[a-z][a-zA-Z0-9_]{1,39}$/.test(key)) throw new HttpError(400, 'Invalid metadata list.');
            if ((code === 'INV' && (key === 'materialClassifications' || key === 'storageLocationTypes')) ||  (code === 'PRC' && (key === 'unitsOfMeasure' || STOCK_META_BY_KEY.has(key))) || (code === 'HRM' && key === 'skillsMaster')) throw new HttpError(400, 'This controlled reference list cannot be deleted. Disable individual entries instead.');
            await deleteDoc(`module_workspaces/${code}/metadata/${key}`);
            await record(ctx, 'admin', 'module.metadata.delete', `${code}.${key}`);
            return { ok: true };
        }),
    ],

    // ----- Admin: site setup -----
    'POST /api/admin/site/save': [
        staff('admin.site.save', 'write', async (ctx) => {
            const config = validateSite(ctx.body.config);
            await writeDoc('site/config', { ...(asPlain(config) as Obj), updatedAt: nowIso(), updatedBy: ctx.actor.email });
            await record(ctx, 'admin', 'site.update', 'MEMS website');
            return { config };
        }),
    ],

    'POST /api/admin/site/logo': [staff('admin.site.logo','write',async ctx=>{const data=str(ctx.body.data);const mime=str(ctx.body.mime);if(!['image/png','image/jpeg','image/webp'].includes(mime)||data.length>1800000||!/^[A-Za-z0-9+/=]+$/.test(data))throw new HttpError(400,'Upload PNG, JPG or WebP under 1.2 MB.');const path=`site/logos/mems_${Date.now()}.${mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg'}`;const [ok]=await storage.write([{path,content:data,contentType:mime}]);if(!ok)throw new HttpError(502,'Could not store logo.');await writeDoc('site/logo',{path,updatedAt:nowIso()});const [signed]=await storage.url([path]);return {logoUrl:signed?.url??''};})],

    'POST /api/admin/site/reset': [
        staff('admin.site.reset', 'write', async (ctx) => {
            await deleteDoc('site/config');
            await record(ctx, 'admin', 'site.reset', 'MEMS website');
            return { config: mergeSite(null) };
        }),
    ],

    // ----- Admin: system health and audit -----
    'POST /api/admin/health': [
        staff('admin.health', 'read', async () => {
            const checks = await Promise.all([
                timed('Service account secret', async () => {
                    if (!(await listSecretNames()).includes('FIREBASE_SERVICE_ACCOUNT')) throw new Error('Not configured');
                    return 'Configured';
                }),
                timed('Firebase access token', async () => {
                    await getAccessToken();
                    return 'Valid';
                }),
                timed('Cloud Firestore', async () => {
                    await getDoc('system/setup');
                    return 'Reachable';
                }),
                timed('Firebase Authentication', async () => `${await authUserCount()} accounts`),
                timed('Token signing keys', async () => `${Object.keys(await getCerts()).length} keys loaded`),
                timed('Exchange rates', async () => {
                    const status = await referenceStatus();
                    if (!status.ratesUpdatedAt) throw new Error('Not loaded');
                    const hours = Math.round((Date.now() - Date.parse(status.ratesUpdatedAt)) / 3600000);
                    if (hours > 72) throw new Error(`Stale (${hours} hours old)`);
                    return `Updated ${hours} hours ago`;
                }),
            ]);
            const [organizations, users, auditEvents, modules, incidents] = await Promise.all([
                safe(() => countQuery('organizations'), null as number | null),
                safe(() => countQuery('users'), null as number | null),
                safe(() => countQuery('audit_events'), null as number | null),
                safe(() => countQuery('modules'), null as number | null),
                safe(firebaseIncidents, null as Awaited<ReturnType<typeof firebaseIncidents>> | null),
            ]);
            return { checkedAt: nowIso(), projectId: PROJECT_ID, checks, collections: { organizations, users, audit_events: auditEvents, modules }, incidents };
        }),
    ],

    'POST /api/admin/logs': [
        staff('admin.logs', 'read', async ({ body }) => ({ logs: await queryAudit(int(body.limit ?? 300, 1, 500, 'Invalid limit.')) })),
    ],

    // ----- Admin: default values -----
    'POST /api/admin/reference/status': [staff('admin.reference.status', 'read', async () => referenceStatus())],

    'POST /api/admin/reference/domains': [
        staff('admin.reference.domains', 'read', async () => {
            const doc = await getDoc(REF.publicEmailDomains);
            return { items: Array.isArray(doc?.data.items) ? (doc?.data.items as Plain[]).map(str) : [] };
        }),
    ],

    'POST /api/admin/reference/load': [
        staff('admin.reference.load', 'write', async (ctx) => {
            if (ctx.body.legacy !== true) throw new HttpError(410, 'Default values are now restored one list at a time under Default values.');
            const mode = str(ctx.body.mode) === 'reset' ? 'reset' : 'missing';
            const defaults = await buildDefaultDocs();
            for (const key of Object.keys(REF) as Array<keyof typeof REF>) {
                const existing = mode === 'reset' ? null : await getDoc(REF[key]);
                if (!existing) {
                    await writeDoc(REF[key], defaults[key]);
                } else if (key === 'metadata') {
                    // Add any new default metadata lists without touching existing ones.
                    const have = new Set(listItems(existing).map((l) => str(l.key)));
                    const missingLists = (Array.isArray(defaults.metadata.items) ? (defaults.metadata.items as Plain[]) : []).filter(isObj).filter((l) => !have.has(str(l.key)));
                    if (missingLists.length) {
                        const items = [...listItems(existing), ...missingLists];
                        await writeDoc(REF.metadata, { ...existing.data, items, count: items.length });
                    }
                }
            }
            await record(ctx, 'admin', mode === 'reset' ? 'reference.reset' : 'reference.load', 'Default values');
            return referenceStatus();
        }),
    ],

    'POST /api/admin/reference/clear': [
        staff('admin.reference.clear', 'write', async (ctx) => {
            if (ctx.body.legacy !== true) throw new HttpError(410, 'Default values are now cleared one list at a time under Default values.');
            await Promise.all(Object.values(REF).map((path) => deleteDoc(path)));
            await record(ctx, 'admin', 'reference.clear', 'Default values');
            return referenceStatus();
        }),
    ],

    'POST /api/admin/reference/rates': [
        staff('admin.reference.rates', 'write', async (ctx) => {
            const doc = await getDoc(REF.currencies);
            if (!doc) throw new HttpError(400, 'Load the default currencies first.');
            const rates = await fetchUsdRates();
            if (!rates) throw new HttpError(502, 'Could not fetch exchange rates right now. Please try again later.');
            const items = withRates(listItems(doc), rates);
            await writeDoc(REF.currencies, { ...doc.data, items, count: items.length, ratesUpdatedAt: rates.updatedAt, ratesSource: RATES_SOURCE });
            await record(ctx, 'admin', 'reference.rates', 'Exchange rates');
            return referenceStatus();
        }),
    ],

    // ----- Admin: default values, one list at a time -----
    'POST /api/admin/reference/list/get': [
        staff('admin.reference.list.get', 'read', async ({ body }) => {
            const target = parseListKey(body.key);
            if (target.kind === 'meta') {
                const doc = await getDoc(REF.metadata);
                const list = listItems(doc).find((l) => str(l.key) === target.listKey);
                const def = METADATA_LISTS.find((l) => l.key === target.listKey);
                return {
                    key: `meta.${target.listKey}`,
                    label: list ? str(list.title) : def?.title ?? target.listKey,
                    appliesTo: list ? str(list.appliesTo) : def?.appliesTo ?? '',
                    loaded: !!list,
                    hasDefault: !!def,
                    loadedAt: str(list?.loadedAt) || str(doc?.data.loadedAt),
                    updatedAt: str(list?.updatedAt),
                    items: list && Array.isArray(list.items) ? (list.items as Plain[]).filter(isObj) : [],
                };
            }
            const doc = await getDoc(REF[target.key]);
            const raw = Array.isArray(doc?.data.items) ? (doc?.data.items as Plain[]) : [];
            return {
                key: target.key,
                label: REF_LABELS[target.key],
                loaded: !!doc,
                hasDefault: true,
                loadedAt: str(doc?.data.loadedAt),
                updatedAt: str(doc?.data.updatedAt),
                ratesUpdatedAt: str(doc?.data.ratesUpdatedAt),
                ratesSource: str(doc?.data.ratesSource),
                items: target.key === 'publicEmailDomains' ? raw.map((d) => ({ domain: str(d) })) : target.key === 'banks' ? [] : raw.filter(isObj),
            };
        }),
    ],

    'POST /api/admin/reference/list/restore': [
        staff('admin.reference.list.restore', 'write', async (ctx) => {
            const target = parseListKey(ctx.body.key);
            const keyText = target.kind === 'meta' ? `meta.${target.listKey}` : target.key;
            if (str(ctx.body.confirm) !== keyText) throw new HttpError(400, 'Confirmation did not match. Nothing was changed.');
            const now = nowIso();
            if (target.kind === 'meta') {
                const def = METADATA_LISTS.find((l) => l.key === target.listKey);
                if (!def) throw new HttpError(400, 'This list has no MEMS default. You can only clear it.');
                const doc = await getDoc(REF.metadata);
                const items = listItems(doc);
                const before = items.find((l) => str(l.key) === target.listKey);
                const fresh = { ...(asPlain(def) as Obj), loadedAt: now, updatedAt: now, source: 'MEMS defaults' };
                const next = before ? items.map((l) => (str(l.key) === target.listKey ? fresh : l)) : [...items, fresh];
                await writeDoc(REF.metadata, { ...(doc?.data ?? { loadedAt: now, source: 'MEMS defaults' }), items: next, count: next.length, updatedAt: now });
                const was = before && Array.isArray(before.items) ? before.items.length : 0;
                await record(ctx, 'admin', 'reference.list.restore', def.title, `${was} entries replaced by ${def.items.length} default entries`);
                return { ok: true };
            }
            const defaults = await buildDefaultDocs();
            const existing = await getDoc(REF[target.key]);
            await writeDoc(REF[target.key], { ...defaults[target.key], updatedAt: now });
            await record(ctx, 'admin', 'reference.list.restore', REF_LABELS[target.key], `${num(existing?.data.count) ?? 0} entries replaced by ${num(defaults[target.key].count) ?? 0} default entries`);
            return { ok: true };
        }),
    ],

    'POST /api/admin/reference/list/clear': [
        staff('admin.reference.list.clear', 'write', async (ctx) => {
            const target = parseListKey(ctx.body.key);
            const keyText = target.kind === 'meta' ? `meta.${target.listKey}` : target.key;
            if (str(ctx.body.confirm) !== keyText) throw new HttpError(400, 'Confirmation did not match. Nothing was changed.');
            if (target.kind === 'meta') {
                const doc = await getDoc(REF.metadata);
                const items = listItems(doc);
                const before = items.find((l) => str(l.key) === target.listKey);
                if (!before || !doc) throw new HttpError(400, 'This list is already empty.');
                const next = items.filter((l) => str(l.key) !== target.listKey);
                await writeDoc(REF.metadata, { ...doc.data, items: next, count: next.length, updatedAt: nowIso() });
                await record(ctx, 'admin', 'reference.list.clear', str(before.title) || target.listKey, `${Array.isArray(before.items) ? before.items.length : 0} entries removed`);
                return { ok: true };
            }
            const existing = await getDoc(REF[target.key]);
            if (!existing) throw new HttpError(400, 'This list is already empty.');
            await deleteDoc(REF[target.key]);
            await record(ctx, 'admin', 'reference.list.clear', REF_LABELS[target.key], `${num(existing.data.count) ?? 0} entries removed`);
            return { ok: true };
        }),
    ],

    // Add or remove a single entry in a simple list (metadata lists and blocked email domains).
    'POST /api/admin/reference/list/entry': [
        staff('admin.reference.list.entry', 'write', async (ctx) => {
            const target = parseListKey(ctx.body.key);
            const op = str(ctx.body.op);
            if (op !== 'add' && op !== 'remove') throw new HttpError(400, 'Invalid action.');
            const now = nowIso();
            if (target.kind === 'doc') {
                if (target.key !== 'publicEmailDomains') throw new HttpError(400, 'Entries of this list are managed with Restore defaults or their own editor.');
                const domain = str(ctx.body.code).trim().toLowerCase();
                if (!/^(?=.{4,100}$)([a-z0-9-]+\.)+[a-z]{2,24}$/.test(domain)) throw new HttpError(400, 'Enter a valid domain such as example.com.');
                const doc = await getDoc(REF.publicEmailDomains);
                if (!doc) throw new HttpError(400, 'Restore the defaults for this list first.');
                const items = (Array.isArray(doc.data.items) ? (doc.data.items as Plain[]) : []).map(str);
                const has = items.includes(domain);
                if (op === 'add' && has) throw new HttpError(409, 'That domain is already blocked.');
                if (op === 'remove' && !has) throw new HttpError(404, 'That domain is not in the list.');
                const next = op === 'add' ? [...items, domain].sort() : items.filter((d) => d !== domain);
                await writeDoc(REF.publicEmailDomains, { ...doc.data, items: next, count: next.length, updatedAt: now });
                await record(ctx, 'admin', `reference.entry.${op}`, REF_LABELS.publicEmailDomains, domain);
                return { ok: true };
            }
            const doc = await getDoc(REF.metadata);
            const lists = listItems(doc);
            const list = lists.find((l) => str(l.key) === target.listKey);
            if (!doc || !list) throw new HttpError(400, 'Restore the defaults for this list first.');
            const entries = (Array.isArray(list.items) ? (list.items as Plain[]) : []).filter(isObj);
            let next: Obj[];
            let detail: string;
            if (op === 'add') {
                const label = text(ctx.body, 'label', 1, 80, 'Enter a label of 1 to 80 characters.');
                if (entries.length >= 500) throw new HttpError(400, 'A list can hold up to 500 entries.');
                if (entries.some((e) => str(e.label).toLowerCase() === label.toLowerCase())) throw new HttpError(409, 'An entry with this label already exists.');
                let code: string;
                let entry: Obj;
                if (target.listKey === 'industries') {
                    const categoryCode = str(ctx.body.categoryCode).trim();
                    const categories = lists.find((l) => str(l.key) === 'industryCategories');
                    const parent = (Array.isArray(categories?.items) ? (categories.items as Plain[]) : []).filter(isObj)
                        .find((i) => str(i.code) === categoryCode && i.active !== false);
                    if (!parent) throw new HttpError(400, 'Select a valid, enabled industry category first.');
                    const largest = entries.filter((e) => str(e.categoryCode) === categoryCode)
                        .map((e) => Number(/^IND-[A-Z0-9]+-(\d{3})$/.exec(str(e.code))?.[1] ?? 0))
                        .reduce((max, n) => Math.max(max, n), 0);
                    if (largest >= 999) throw new HttpError(400, 'This industry category has no available subcategory codes.');
                    code = `${categoryCode}-${String(largest + 1).padStart(3, '0')}`;
                    entry = { code, label, categoryCode, isicSection: str(parent.isicSection), active: true };
                } else if (target.listKey === 'industryCategories') {
                    code = str(ctx.body.code).trim().toUpperCase();
                    if (!/^IND-[A-Z0-9]{1,4}$/.test(code)) throw new HttpError(400, 'Enter a category code such as IND-W.');
                    entry = { code, label, isicSection: '', active: true };
                } else {
                    code = (str(ctx.body.code).trim() || label)
                        .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_+|_+$/g, '').slice(0, 60);
                    if (!code) throw new HttpError(400, 'Enter a code made of letters and numbers.');
                    entry = { code, label };
                }
                if (entries.some((e) => str(e.code) === code)) throw new HttpError(409, `The code ${code} already exists in this list.`);
                next = [...entries, entry];
                detail = `${code} · ${label}`;
            } else {
                const code = str(ctx.body.code);
                if (!entries.some((e) => str(e.code) === code)) throw new HttpError(404, 'Entry not found.');
                if (target.listKey === 'industryCategories') {
                    const subs = lists.find((l) => str(l.key) === 'industries');
                    const used = (Array.isArray(subs?.items) ? (subs.items as Plain[]) : []).filter(isObj)
                        .some((i) => str(i.categoryCode) === code);
                    if (used) throw new HttpError(409, 'This category still has industry subcategories; remove or reassign them before deleting the category.');
                }
                next = entries.filter((e) => str(e.code) !== code);
                detail = code;
            }
            const lists2 = lists.map((l) => (str(l.key) === target.listKey ? { ...l, items: next, updatedAt: now } : l));
            await writeDoc(REF.metadata, { ...doc.data, items: lists2, count: lists2.length, updatedAt: now });
            await record(ctx, 'admin', `reference.entry.${op}`, str(list.title), detail);
            return { ok: true };
        }),
    ],

    // ----- Public: organization registration (see registration.ts) -----
    'POST /api/organizations/register': [
        publicRoute(async () => {
            throw new HttpError(410, 'Organization registration now uses the staged application. Please start again from the website.');
        }),
    ],

    ...orgRoutes,
    ...drkmsRoutes,
    ...drkmsFileRoutes,
    ...drkmsEngineeringRoutes,
    ...drkmsSdsRoutes,
    ...drkmsDigitalRoutes,
    ...drkmsTroubleshootingRoutes,
    ...drkmsPublishRoutes,
    ...drkmsReadRoutes,
    ...accessReviewRoutes,
    ...securityReviewRoutes,
    ...healthRoutes,
    ...personalWorkspaceRoutes,
    ...quickPersonalRoutes,
    ...noteFileRoutes,
    ...quickStatusRoutes,
    ...quickGembaRoutes,
    ...chatRoomRoutes,
    ...chatMessageRoutes,
    ...chatMemberRoutes,
    ...chatActionRoutes,
    ...chatPollRoutes,
    ...chatPolicyRoutes,
    ...chatReportingRoutes,
    ...mailRoutes,
    ...workGroupRoutes,
    ...actionHubRoutes,
    ...actionPhotoRoutes,
    ...calendarRoutes,
    ...mailPreferenceRoutes,
    ...roleCodeRoutes,
    ...roleDocRoutes,
    ...documentationRoutes,
    ...workflowTraceRoutes,
    ...governanceDocumentRoutes,
    ...governanceAuditRoutes,
    ...transactionBlueprintRoutes,
    ...platformTransactionRoutes,
    ...unifiedApprovalRoutes,
    ...procurementSetupRoutes,
    ...purchaseRequirementRoutes,
    ...replenishmentVerificationRoutes,
    ...replenishmentRoutes,
    ...procurementPolicyRoutes,
    ...buyerGroupRoutes,
    ...quotationRoutes,
    ...warehouseOverviewRoutes,
    ...purchaseOrderRoutes,
    ...poFinanceRoutes,
    ...procurementDashboardRoutes,
    ...finRoutes,
    ...glTransactionRoutes,
    ...finLedgerRoutes,
    ...finOpsRoutes,
    ...vendorRoutes,
    ...orgHomeRoutes,
    ...extraRoutes,
    ...registrationRoutes,
    ...applicationRoutes,
    ...explorerRoutes,
    ...settingsRoutes,
    ...brandingRoutes,
    ...structureRoutes,
    ...setupProgressRoutes,
    ...adminOperationsRoutes,
    ...fxManagementRoutes,
    ...fxSchedulerRoutes,
    ...automationRoutes,
    ...positionRoutes,
    ...moduleDefaultRoutes,
    ...billingRoutes,
    ...subscriptionRoutes,
    ...assetRoutes,
    ...skillRoutes,
    ...procurementRoutes,
    ...stockTakeRoutes,
    ...shortcutRoutes,
    ...maintenanceRoutes,
    ...maintenanceOperationRoutes,
    ...maintenanceMaterialCandidateRoutes,
    ...warehouseRoutes,
    ...maintenanceReferenceRoutes,
    ...utilityRoutes,
    ...storedEnergyRoutes,
    ...assemblyActivityRoutes,
    ...activityRiskRoutes,
    ...activityLegacyRoutes,
    ...safRiskRoutes,
}));

