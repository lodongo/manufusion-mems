/**
 * Payroll → one employee's pay details: bank account and personal earnings and deductions (check-offs, loans, bonuses...).
 *
 * These are what turn the payslip preview into a real payslip for one person. They are entered by a payroll officer
 * (HRM.payroll.manage) and have to be VERIFIED by someone else (HRM.payroll.verify) before they count as verified:
 * a changed bank account is the classic way to divert pay, and a fake deduction or bonus is the classic way to take it.
 *
 * Security:
 *  - The full account number is write-only. Every read returns it masked (••••1234). A verifier can ask for the full
 *    number to compare it with the bank's letter; that call is rate limited and audited (without the number).
 *  - Entering needs the number twice. Any change to a verified item or to the bank details makes it pending again.
 *  - Nobody enters or verifies their own details. The person who changed something can never be the one who verifies it.
 *  - Saves are locked per employee, version-checked and written with an update-time precondition; every save and every
 *    verification keeps an immutable history record. The history never holds a full account number.
 *  - Audit text carries counts only: never names, amounts or account numbers.
 *
 * Not a payroll run: nothing is paid, posted or filed from here.
 */
import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, rateLimit, str, writeDoc } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { withLock } from './finCore';
import { hrAudit } from './hrAudit';
import { brandingOut, logoDataFromPath, logoDataUrl } from './branding';
import { signedUrl } from './structure';
import { entityContext } from './hrJobGrades';
import { buildPayrollRows } from './hrPayrollRows';
import {
    ACCOUNT_NUMBER, MAX_ITEMS, itemProblem, maskAccount, normalAccountNumber, typeOf,
    type BankDetails, type PayItemKind, type PersonalItem,
} from '../src/shared/hrPayItems';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ITEM_ID = /^[a-f0-9]{12}$/;
const NAME = /^[\p{L}\p{N} _.,/()&'’-]*$/u;

const isSuper = (ctx: OrgContext) => ctx.role === 'org_super_admin';
const can = (ctx: OrgContext, key: string) => isSuper(ctx) || hasPerm(ctx.permissions, key);

export const peoplePath = (org: string, uid: string) => `organizations/${org}/hr_payroll_people/${uid}`;
export const peopleHistoryPath = (org: string, uid: string, version: number) => `${peoplePath(org, uid)}/history/v${String(version).padStart(6, '0')}`;

type StoredBank = BankDetails;

const bankFrom = (raw: unknown): StoredBank | null => {
    if (!isObj(raw)) return null;
    const number = str(raw.accountNumber);
    if (!number) return null;
    return {
        bankId: str(raw.bankId), bankName: str(raw.bankName), branch: str(raw.branch), accountName: str(raw.accountName), accountNumber: number,
        status: str(raw.status) === 'verified' ? 'verified' : 'pending',
        changedBy: str(raw.changedBy), changedAt: str(raw.changedAt), verifiedBy: str(raw.verifiedBy), verifiedAt: str(raw.verifiedAt),
    };
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const itemsFrom = (raw: unknown): PersonalItem[] =>
    (Array.isArray(raw) ? raw.filter(isObj) : [])
        .map((x) => ({
            id: str(x.id), kind: (str(x.kind) === 'deduction' ? 'deduction' : 'earning') as PayItemKind, type: str(x.type), label: str(x.label), reference: str(x.reference),
            amount: num(x.amount), taxable: x.taxable === true, principal: num(x.principal), startMonth: str(x.startMonth), endMonth: str(x.endMonth),
            status: (str(x.status) === 'verified' ? 'verified' : 'pending') as PersonalItem['status'],
            changedBy: str(x.changedBy), changedAt: str(x.changedAt), verifiedBy: str(x.verifiedBy), verifiedAt: str(x.verifiedAt),
        }))
        .filter((x) => ITEM_ID.test(x.id));

const sameItem = (a: PersonalItem, b: PersonalItem) =>
    a.kind === b.kind && a.type === b.type && a.label === b.label && a.reference === b.reference && a.amount === b.amount && a.taxable === b.taxable &&
    a.principal === b.principal && a.startMonth === b.startMonth && a.endMonth === b.endMonth;

const nameOf = (d: Record<string, unknown>) => [str(d.firstName), str(d.lastName)].filter(Boolean).join(' ').trim();
const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
/** Whether the account holder's name looks like the employee's (a verification aid, not a rule). */
export function accountNameMatches(employee: string, account: string) {
    const e = tokens(employee), a = new Set(tokens(account));
    if (!e.length || !a.size) return false;
    const hits = e.filter((t) => a.has(t)).length;
    return hits >= Math.min(2, e.length);
}

/** The employee must be on the payroll of this legal entity (one placed employee in that entity). Returns the user and payroll row. */
async function onePerson(ctx: OrgContext, entityId: string, uid: string) {
    if (!ID.test(entityId)) throw new HttpError(400, 'Select a legal entity.');
    if (!ID.test(uid)) throw new HttpError(400, 'Select an employee.');
    const { current, currency } = await entityContext(ctx, entityId);
    if (!current) throw new HttpError(404, 'Select an active legal entity.');
    const user = await getDoc(`users/${uid}`);
    if (!user || str(user.data.orgId) !== ctx.orgId) throw new HttpError(404, 'That employee is not in this organization.');
    const [structure, positions] = await Promise.all([listDocs(`organizations/${ctx.orgId}/structure`), listDocs(`organizations/${ctx.orgId}/positions`)]);
    const { rows } = buildPayrollRows({
        entityId, users: [{ id: uid, data: user.data }], nodes: new Map(structure.map((d) => [d.id, d.data])),
        positions: new Map(positions.map((d) => [d.id, d.data])), grades: [], salaries: {},
    });
    if (!rows.length) throw new HttpError(404, 'That employee is not on this legal entity’s payroll.');
    return { user, row: rows[0], current, currency };
}

/** Banks the platform knows, as id to name. */
async function bankNames() {
    const doc = await getDoc('reference/banks');
    const out = new Map<string, string>();
    for (const b of Array.isArray(doc?.data.items) ? doc!.data.items.filter(isObj) : []) if (str(b.id)) out.set(str(b.id), str(b.name));
    return out;
}

const userNames = async (ids: string[]) => {
    const out: Record<string, string> = {};
    for (const id of [...new Set(ids.filter((x) => ID.test(x)))].slice(0, 20)) {
        const u = await getDoc(`users/${id}`);
        out[id] = u ? nameOf(u.data) : '';
    }
    return out;
};

const entityLogoPath = (orgId: string, node: { id: string; data: Record<string, unknown> }) => {
    const path = str(node.data.logoPath);
    return path.startsWith(`organizations/${orgId}/entities/${node.id}/logo_`) ? path : '';
};

export const hrPayrollPeopleRoutes = {
    'POST /api/org/hr/payroll/person/get': [
        orgRoute('org.hr.payroll.person.get', 'HRM.payroll.view', async (ctx) => {
            const entityId = str(ctx.body.legalEntityId).trim().slice(0, 128);
            const uid = str(ctx.body.uid).trim().slice(0, 128);
            const { user, current } = await onePerson(ctx, entityId, uid);
            const [doc, node] = await Promise.all([getDoc(peoplePath(ctx.orgId, uid)), getDoc(`organizations/${ctx.orgId}/structure/${entityId}`)]);
            const bank = bankFrom(doc?.data.bank);
            const items = itemsFrom(doc?.data.items);
            const attributes = node && isObj(node.data.attributes) ? node.data.attributes : {};
            const entityLogo = node ? entityLogoPath(ctx.orgId, { id: node.id, data: node.data }) : '';
            const [branding, entityLogoUrl, names] = await Promise.all([
                brandingOut(ctx.org),
                signedUrl(entityLogo),
                userNames([bank?.changedBy || '', bank?.verifiedBy || '', ...items.flatMap((i) => [i.changedBy, i.verifiedBy])]),
            ]);
            await hrAudit(ctx, 'read.payroll.person', { type: 'employee', id: uid }, `bank=${bank ? 1 : 0} items=${items.length}`);
            const who = (id: string) => names[id] || '';
            return {
                employer: {
                    name: str(current.name), displayName: str(branding?.displayName), tradingName: str(attributes.tradingName),
                    registrationNumber: str(attributes.registrationNumber), taxNumber: str(attributes.taxNumber),
                    address: [str(attributes.address), str(attributes.city)].filter(Boolean).join(', '), phone: str(attributes.phone), email: str(attributes.email),
                    logoUrl: entityLogoUrl || str(branding?.logoUrl),
                },
                bank: bank && {
                    bankId: bank.bankId, bankName: bank.bankName, branch: bank.branch, accountName: bank.accountName, accountMasked: maskAccount(bank.accountNumber),
                    status: bank.status, changedByName: who(bank.changedBy), changedAt: bank.changedAt, verifiedByName: who(bank.verifiedBy), verifiedAt: bank.verifiedAt,
                    canVerify: bank.status === 'pending' && bank.changedBy !== ctx.uid, nameMatch: accountNameMatches(nameOf(user.data), bank.accountName),
                },
                items: items.map((i) => ({ ...i, changedByName: who(i.changedBy), verifiedByName: who(i.verifiedBy), canVerify: i.status === 'pending' && i.changedBy !== ctx.uid })),
                version: Number(doc?.data.version || 0),
                isSelf: uid === ctx.uid,
                canManage: can(ctx, 'HRM.payroll.manage') && uid !== ctx.uid,
                canVerify: can(ctx, 'HRM.payroll.verify') && uid !== ctx.uid,
            };
        }),
    ],

    'POST /api/org/hr/payroll/person/save': [
        orgRoute('org.hr.payroll.person.save', 'HRM.payroll.manage', async (ctx) => {
            const entityId = str(ctx.body.legalEntityId).trim().slice(0, 128);
            const uid = str(ctx.body.uid).trim().slice(0, 128);
            if (uid === ctx.uid) throw new HttpError(403, 'You cannot change your own bank or pay details. Ask another payroll officer.');
            await onePerson(ctx, entityId, uid);
            const sendsBank = isObj(ctx.body.bank);
            const sendsItems = Array.isArray(ctx.body.items);
            if (!sendsBank && !sendsItems) throw new HttpError(400, 'Send the bank details or the pay items to save.');
            if (sendsItems && (ctx.body.items as unknown[]).length > MAX_ITEMS) throw new HttpError(400, `At most ${MAX_ITEMS} pay items per employee.`);

            return withLock(ctx.orgId, 'hr_payroll_person_' + uid, async () => {
                const prev = await getDoc(peoplePath(ctx.orgId, uid));
                const prevVersion = Number(prev?.data.version || 0);
                if (ctx.body.expectedVersion !== undefined && Number(ctx.body.expectedVersion) !== prevVersion)
                    throw new HttpError(409, 'These pay details changed since you opened them. Reload before saving.');
                const at = nowIso();
                const prevBank = bankFrom(prev?.data.bank);
                const prevItems = itemsFrom(prev?.data.items);

                // ---- bank details ----
                let bank: StoredBank | null = prevBank;
                let bankChanged = false;
                if (sendsBank) {
                    const b = ctx.body.bank as Record<string, unknown>;
                    const number = normalAccountNumber(b.accountNumber);
                    if (!ACCOUNT_NUMBER.test(number)) throw new HttpError(400, 'Enter the account number: 4 to 34 letters and numbers.');
                    if (normalAccountNumber(b.confirmAccountNumber) !== number) throw new HttpError(400, 'The account number and its confirmation are different. Type it again.');
                    const bankId = str(b.bankId).trim().slice(0, 64);
                    const names = await bankNames();
                    if (!bankId || !names.has(bankId)) throw new HttpError(400, 'Choose the bank from the list.');
                    const branch = str(b.branch).trim().slice(0, 60);
                    const accountName = str(b.accountName).trim().slice(0, 80);
                    if (!NAME.test(branch)) throw new HttpError(400, 'The branch can use letters, numbers and . , / ( ) & - only.');
                    if (accountName.length < 2 || !NAME.test(accountName)) throw new HttpError(400, 'Enter the account name (2 to 80 letters, numbers and . , / ( ) & -).');
                    const unchanged = prevBank && prevBank.bankId === bankId && prevBank.branch === branch && prevBank.accountName === accountName && prevBank.accountNumber === number;
                    if (!unchanged) {
                        bank = { bankId, bankName: names.get(bankId) || '', branch, accountName, accountNumber: number, status: 'pending', changedBy: ctx.uid, changedAt: at, verifiedBy: '', verifiedAt: '' };
                        bankChanged = true;
                    }
                }

                // ---- personal earnings and deductions ----
                let items: PersonalItem[] = prevItems;
                const added: string[] = [], changed: string[] = [], removed: string[] = [];
                if (sendsItems) {
                    const byId = new Map(prevItems.map((i) => [i.id, i]));
                    const seen = new Set<string>();
                    items = (ctx.body.items as unknown[]).map((raw, index) => {
                        if (!isObj(raw)) throw new HttpError(400, `Pay item ${index + 1} is not valid.`);
                        const kind: PayItemKind = str(raw.kind) === 'deduction' ? 'deduction' : 'earning';
                        const t = typeOf(kind, str(raw.type));
                        const next: PersonalItem = {
                            id: str(raw.id), kind, type: str(raw.type), label: str(raw.label).trim(), reference: str(raw.reference).trim(),
                            amount: typeof raw.amount === 'number' ? raw.amount : NaN, taxable: kind === 'earning' ? raw.taxable === true : false,
                            principal: typeof raw.principal === 'number' ? raw.principal : 0, startMonth: str(raw.startMonth), endMonth: str(raw.endMonth),
                            status: 'pending', changedBy: ctx.uid, changedAt: at, verifiedBy: '', verifiedAt: '',
                        };
                        const problem = itemProblem(next);
                        if (problem) throw new HttpError(400, `${next.label || 'Pay item ' + (index + 1)}: ${problem}`);
                        if (!t) throw new HttpError(400, `Pay item ${index + 1}: choose the type.`);
                        const old = next.id ? byId.get(next.id) : undefined;
                        if (next.id && !old) throw new HttpError(400, `${next.label}: this item no longer exists. Reload before saving.`);
                        if (old) {
                            if (seen.has(old.id)) throw new HttpError(400, 'An item was sent twice.');
                            seen.add(old.id);
                            if (sameItem(old, next)) return old; // untouched: keeps its status
                            changed.push(old.id);
                            return { ...next, id: old.id };
                        }
                        const id = randomId(6);
                        added.push(id);
                        return { ...next, id };
                    });
                    for (const old of prevItems) if (!seen.has(old.id)) removed.push(old.id);
                }
                if (!bankChanged && !added.length && !changed.length && !removed.length) throw new HttpError(400, 'Nothing changed. Change a detail before saving.');

                const version = prevVersion + 1;
                // History first (overwritten only if an earlier attempt at this version never committed), then the live document.
                await writeDoc(peopleHistoryPath(ctx.orgId, uid, version), {
                    version, at, by: ctx.uid, previousVersion: prevVersion, action: 'save', legalEntityId: entityId,
                    bankChanged, bankLast4: bank ? bank.accountNumber.slice(-4) : '', bankId: bank?.bankId || '', bankBranch: bank?.branch || '', bankAccountName: bank?.accountName || '',
                    added, changed, removed, items,
                });
                const ok = await writeDoc(peoplePath(ctx.orgId, uid), { legalEntityId: entityId, version, bank, items, updatedAt: at, updatedBy: ctx.uid }, prev ? { updateTime: prev.updateTime } : { exists: false });
                if (!ok) throw new HttpError(409, 'These pay details changed while saving. Reload and try again.');
                await hrAudit(ctx, 'payroll.person.save', { type: 'employee', id: uid }, `version=${version} bankChanged=${bankChanged ? 1 : 0} added=${added.length} changed=${changed.length} removed=${removed.length}`);
                return { ok: true, version, added: added.length, changed: changed.length, removed: removed.length, bankChanged };
            });
        }),
    ],

    'POST /api/org/hr/payroll/person/verify': [
        orgRoute('org.hr.payroll.person.verify', 'HRM.payroll.verify', async (ctx) => {
            const entityId = str(ctx.body.legalEntityId).trim().slice(0, 128);
            const uid = str(ctx.body.uid).trim().slice(0, 128);
            if (uid === ctx.uid) throw new HttpError(403, 'You cannot verify your own pay details.');
            await onePerson(ctx, entityId, uid);
            const verifyBank = ctx.body.bank === true;
            const ids = Array.isArray(ctx.body.itemIds) ? [...new Set((ctx.body.itemIds as unknown[]).map(str))] : [];
            if (!verifyBank && !ids.length) throw new HttpError(400, 'Choose what to verify.');
            if (ids.length > MAX_ITEMS || ids.some((x) => !ITEM_ID.test(x))) throw new HttpError(400, 'Choose valid pay items.');

            return withLock(ctx.orgId, 'hr_payroll_person_' + uid, async () => {
                const prev = await getDoc(peoplePath(ctx.orgId, uid));
                if (!prev) throw new HttpError(404, 'There are no pay details to verify.');
                const prevVersion = Number(prev.data.version || 0);
                if (ctx.body.expectedVersion !== undefined && Number(ctx.body.expectedVersion) !== prevVersion)
                    throw new HttpError(409, 'These pay details changed since you opened them. Reload before verifying.');
                const at = nowIso();
                let bank = bankFrom(prev.data.bank);
                if (verifyBank) {
                    if (!bank || bank.status !== 'pending') throw new HttpError(409, 'The bank details are not waiting for verification.');
                    if (bank.changedBy === ctx.uid) throw new HttpError(403, 'You entered these bank details, so another person must verify them.');
                    bank = { ...bank, status: 'verified', verifiedBy: ctx.uid, verifiedAt: at };
                }
                const items = itemsFrom(prev.data.items);
                for (const id of ids) {
                    const i = items.find((x) => x.id === id);
                    if (!i || i.status !== 'pending') throw new HttpError(409, 'A pay item is not waiting for verification. Reload.');
                    if (i.changedBy === ctx.uid) throw new HttpError(403, `You entered “${i.label}”, so another person must verify it.`);
                }
                const next = items.map((i) => (ids.includes(i.id) ? { ...i, status: 'verified' as const, verifiedBy: ctx.uid, verifiedAt: at } : i));
                const version = prevVersion + 1;
                await writeDoc(peopleHistoryPath(ctx.orgId, uid, version), {
                    version, at, by: ctx.uid, previousVersion: prevVersion, action: 'verify', legalEntityId: str(prev.data.legalEntityId),
                    verifiedBank: verifyBank, verifiedItems: ids,
                });
                const ok = await writeDoc(peoplePath(ctx.orgId, uid), { ...prev.data, version, bank, items: next, updatedAt: at, updatedBy: ctx.uid }, { updateTime: prev.updateTime });
                if (!ok) throw new HttpError(409, 'These pay details changed while verifying. Reload and try again.');
                await hrAudit(ctx, 'payroll.person.verify', { type: 'employee', id: uid }, `version=${version} bank=${verifyBank ? 1 : 0} items=${ids.length}`);
                return { ok: true, version, verifiedItems: ids.length, verifiedBank: verifyBank };
            });
        }),
    ],

    'POST /api/org/hr/payroll/person/reveal': [
        orgRoute('org.hr.payroll.person.reveal', 'HRM.payroll.verify', async (ctx) => {
            const entityId = str(ctx.body.legalEntityId).trim().slice(0, 128);
            const uid = str(ctx.body.uid).trim().slice(0, 128);
            if (uid === ctx.uid) throw new HttpError(403, 'You cannot view your own account number here.');
            await rateLimit('payroll-reveal', ctx.uid, 30, 3600);
            await onePerson(ctx, entityId, uid);
            const doc = await getDoc(peoplePath(ctx.orgId, uid));
            const bank = bankFrom(doc?.data.bank);
            if (!bank) throw new HttpError(404, 'No bank details are saved for this employee.');
            await hrAudit(ctx, 'payroll.bank.reveal', { type: 'employee', id: uid }, 'bank=1');
            return { accountNumber: bank.accountNumber };
        }),
    ],

    /** The logo for the payslip PDF: the legal entity's own logo, else the organization's. Only fetched when a PDF is asked for. */
    'POST /api/org/hr/payroll/logo': [
        orgRoute('org.hr.payroll.logo', 'HRM.payroll.view', async (ctx) => {
            const entityId = str(ctx.body.legalEntityId).trim().slice(0, 128);
            if (!ID.test(entityId)) throw new HttpError(400, 'Select a legal entity.');
            await rateLimit('payroll-logo', ctx.uid, 60, 3600);
            const node = await getDoc(`organizations/${ctx.orgId}/structure/${entityId}`);
            const own = node ? await logoDataFromPath(entityLogoPath(ctx.orgId, { id: node.id, data: node.data })) : '';
            const logo = own || (await logoDataUrl(ctx.org));
            await hrAudit(ctx, 'payroll.logo.read', { type: 'legal_entity', id: entityId }, `logo=${logo ? 1 : 0}`);
            return { logo };
        }),
    ],
};

/** Per employee: whether bank details exist and are verified, and how many personal items there are and wait for verification. */
export async function paySummaries(org: string) {
    const docs = await listDocs(`organizations/${org}/hr_payroll_people`);
    return new Map(
        docs.map((d) => {
            const bank = bankFrom(d.data.bank);
            const items = itemsFrom(d.data.items);
            return [d.id, { bank: (bank ? bank.status : 'none') as 'none' | 'pending' | 'verified', items: items.length, pending: items.filter((i) => i.status === 'pending').length }] as const;
        }),
    );
}
