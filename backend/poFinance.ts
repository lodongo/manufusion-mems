import { HttpError, getDoc, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { nextOrgCounter } from './positions';
import { record } from './org';
import { can, requireProcurement } from './procurementSetup';
import { catalogSummary } from './procurement';
import { acceptService } from './finOps';
import {periodAt,yearsOf} from './finCore';
import {prepareServiceAcceptanceBudget} from './corporateServiceBudget';
import { getAuthority } from './procurementPolicy';
import {
    DELIVERING,
    baseOf,
    cleanText,
    loadPo,
    mutate,
    needOwner,
    nameOfUser,
    o,
    objs,
    oneLine,
    ordersPath,
    outstanding,
    ownedCostCenters,
    ownerOf,
    poTypeOf,
    reasonOf,
    reqsPath,
    round,
    today,
    unitsOf,
    versionsOf,
    ccOf,
} from './purchaseOrders';

// ---------------------------------------------------------------------------
// Supplier acknowledgement, service receipts and acceptance, and the journals they post.
//
//   organizations/{org}/procurement_files/{id}          one uploaded file (acknowledgement, timesheet, report, invoice)
//   organizations/{org}/procurement_setup/finance       payable GL account for accepted services
//   organizations/{org}/finance_journals/JNL#########   one balanced journal for each accepted service receipt
//
// A service is not delivered like goods. The requester who asked for it records what was rendered with the signed and
// stamped timesheets, reports and the supplier's invoice. The owner of the cost center it is charged to checks them and
// accepts. Acceptance reconciles at once: the order line is received and a journal is posted with the cost center,
// GL account, supplier, invoice and order reference. A journal can always be traced back to its source.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const MAX_FILE_CHARS = 620_000;
const MAX_FILES = 8;
const MAGIC: Record<string, string> = { 'application/pdf': 'JVBERi', 'image/jpeg': '/9j/', 'image/png': 'iVBORw0KGgo' };
const filesPath = (orgId: string) => `organizations/${orgId}/procurement_files`;
const financePath = (orgId: string) => `organizations/${orgId}/procurement_setup/finance`;
const journalsPath = (orgId: string) => `organizations/${orgId}/finance_journals`;
const JNL_ID = /^JNL\d{9}$/;
const KIND_LABEL: Record<string, string> = { acknowledgement: 'Acknowledgement', timesheet: 'Signed and stamped timesheet', report: 'Service report', invoice: 'Supplier invoice' };

interface Upload {
    kind: string;
    name: string;
    type: string;
    data: string;
}
function cleanFile(v: unknown, kinds: string[]): Upload {
    const f = o(v);
    const kind = str(f.kind);
    const type = str(f.type);
    const data = str(f.data);
    if (!kinds.includes(kind)) throw new HttpError(400, 'Unknown kind of document.');
    const magic = MAGIC[type];
    if (!magic || !data.startsWith(`data:${type};base64,`) || !/^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > MAX_FILE_CHARS) throw new HttpError(400, `${KIND_LABEL[kind]}: attach a PDF, JPEG or PNG of up to about 450 KB.`);
    if (!data.slice(data.indexOf(',') + 1).startsWith(magic)) throw new HttpError(400, `${KIND_LABEL[kind]}: the file is not a real ${type.split('/')[1].toUpperCase()}.`);
    const name = oneLine(str(f.name).replace(/[\\/:*?"<>|]/g, '_'), 80) || KIND_LABEL[kind];
    return { kind, name, type, data };
}
async function storeFiles(ctx: OrgContext, poId: string, uploads: Upload[], ref: string): Promise<Obj[]> {
    const out: Obj[] = [];
    for (const u of uploads) {
        const id = `F${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
        const ok = await writeDoc(`${filesPath(ctx.orgId)}/${id}`, { poId, ref, kind: u.kind, name: u.name, type: u.type, data: u.data, by: ctx.uid, byName: nameOfUser(ctx.me), at: nowIso() }, { exists: false });
        if (!ok) throw new HttpError(409, 'Could not store the file. Please try again.');
        out.push({ id, kind: u.kind, name: u.name });
    }
    return out;
}

async function finance(orgId: string) {
    const doc = await getDoc(financePath(orgId));
    return { payableGlCode: str(doc?.data.payableGlCode), version: Number(doc?.data.version) || 0 };
}

/** May this person see a journal: finance (journal right), or the people behind the order and the cost centers it was charged to. */
function journalVisible(ctx: OrgContext, j: Obj, owned: Set<string>): boolean {
    if (can(ctx, 'PRC.journal.view')) return true;
    if (objs(j.lines).some((l) => owned.has(str(l.costCenterId)))) return true;
    return [str(j.renderedBy), str(j.acceptedBy), str(j.poOwnerUid)].includes(ctx.uid);
}

export const poFinanceRoutes = {
    // ===== Supplier acknowledgement =====

    'POST /api/org/procurement/orders/acknowledge': [
        orgRoute('org.procurement.orders.acknowledge', 'PRC.po.manage', async (ctx) => {
            requireProcurement(ctx);
            const doc = await loadPo(ctx, str(ctx.body.id));
            needOwner(ctx, doc.data);
            const ref = oneLine(ctx.body.ref, 60);
            const date = str(ctx.body.date);
            const note = cleanText(ctx.body.note).slice(0, 300);
            if (ref.length < 2) throw new HttpError(400, "Enter the supplier's reference for the acknowledgement.");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) throw new HttpError(400, 'Enter the date of the acknowledgement. It cannot be in the future.');
            const file = cleanFile(ctx.body.file, ['acknowledgement']);
            return mutate(ctx, 'po', doc.id, 'acknowledge', async (d) => {
                needOwner(ctx, d);
                if (!['sent', 'partial'].includes(str(d.status))) throw new HttpError(409, 'Only an order that has been sent to the supplier can be acknowledged.');
                if (str(o(d.ack).at)) throw new HttpError(409, 'This order is already acknowledged.');
                if (date < str(d.sentAt).slice(0, 10)) throw new HttpError(400, 'The acknowledgement cannot be dated before the order was sent.');
                const [stored] = await storeFiles(ctx, doc.id, [file], ref);
                const at = nowIso();
                return {
                    patch: { ack: { at, by: ctx.uid, byName: nameOfUser(ctx.me), ref, date, note, fileId: str(stored.id), fileName: str(stored.name) } },
                    event: 'acknowledged by the supplier',
                    note: `${ref}, dated ${date}${note ? `. ${note}` : ''}`.slice(0, 380),
                    label: 'Supplier acknowledgement attached',
                };
            });
        }),
    ],

    // A stored file, for those who may see the order (acknowledgement) or the money behind it (service documents).
    'POST /api/org/procurement/orders/file': [
        orgRoute('org.procurement.orders.file', null, async (ctx) => {
            requireProcurement(ctx);
            const f = await getDoc(`${filesPath(ctx.orgId)}/${str(ctx.body.fileId)}`);
            if (!f) throw new HttpError(404, 'File not found.');
            const doc = await loadPo(ctx, str(f.data.poId));
            const a = doc.acc;
            const money = a.owner || a.ccOwner || a.requester || a.approver || can(ctx, 'PRC.journal.view');
            if (str(f.data.kind) !== 'acknowledgement' && !money) throw new HttpError(404, 'File not found.');
            await record(ctx, 'org.procurement.file.view', str(f.data.poId), `${str(f.data.kind)}: ${str(f.data.name)}`.slice(0, 200));
            return { name: str(f.data.name), type: str(f.data.type), data: str(f.data.data), kind: str(f.data.kind) };
        }),
    ],

    // ===== Finance settings =====

    'POST /api/org/procurement/finance/settings': [
        orgRoute('org.procurement.finance.settings', null, async (ctx) => {
            requireProcurement(ctx);
            const cur = await finance(ctx.orgId);
            const gl = await catalogSummary('gl_accounts');
            const canSet = can(ctx, 'PRC.setup.manage');
            if (ctx.body.set !== true) return { ...cur, payableName: gl?.items.find((i) => i.code === cur.payableGlCode)?.name ?? '', glAccounts: canSet && gl ? gl.items.slice(0, 3000).map((i) => ({ code: i.code, name: i.name })) : [], canSet };
            if (!canSet) throw new HttpError(403, 'You cannot change the finance settings.');
            const reason = reasonOf(ctx.body);
            const code = str(ctx.body.payableGlCode);
            if (!gl) throw new HttpError(409, 'The GL account master has not been loaded by MEMS yet.');
            if (!gl.items.some((i) => i.code === code)) throw new HttpError(400, 'Choose a GL account from the GL account master.');
            if (code === cur.payableGlCode) throw new HttpError(400, 'Nothing has changed.');
            await writeDoc(financePath(ctx.orgId), { payableGlCode: code, version: cur.version + 1, updatedAt: nowIso(), updatedBy: ctx.uid });
            await record(ctx, 'org.procurement.finance.settings', 'Finance settings', `Payable account for accepted services: ${cur.payableGlCode || 'none'} to ${code}. Reason: ${reason}`.slice(0, 400));
            return { ok: true };
        }),
    ],

    // ===== Services: rendered by the requester =====

    'POST /api/org/procurement/orders/service/render': [
        orgRoute('org.procurement.orders.service.render', null, async (ctx) => {
            requireProcurement(ctx);
            const doc = await loadPo(ctx, str(ctx.body.id));
            if (!doc.acc.requester) throw new HttpError(403, 'Only the person who asked for the service can record that it was rendered.');
            const periodFrom = str(ctx.body.periodFrom);
            const periodTo = str(ctx.body.periodTo);
            const re = /^\d{4}-\d{2}-\d{2}$/;
            if (!re.test(periodFrom) || !re.test(periodTo) || periodFrom > periodTo || periodTo > today()) throw new HttpError(400, 'Enter the period the service was rendered. It cannot end in the future.');
            const invoiceNo = oneLine(ctx.body.invoiceNo, 60);
            const invoiceDate = str(ctx.body.invoiceDate);
            const invoiceAmount = Number(ctx.body.invoiceAmount);
            if (invoiceNo.length < 2 || !re.test(invoiceDate) || invoiceDate > today() || !(invoiceAmount > 0) || invoiceAmount > 1e12) throw new HttpError(400, "Enter the supplier's invoice number, date and amount.");
            if (ctx.body.signedStamped !== true) throw new HttpError(400, 'Confirm that the timesheets and reports are signed and stamped.');
            const note = cleanText(ctx.body.note).slice(0, 400);
            const given = objs(ctx.body.lines).map((l) => ({ no: Number(l.no), qty: Number(l.qty), what: oneLine(l.what, 200) })).filter((l) => l.qty > 0);
            if (!given.length) throw new HttpError(400, 'Enter how much of at least one service line was rendered.');
            const filesIn = objs(ctx.body.files).map((f) => cleanFile(f, ['timesheet', 'report', 'invoice']));
            if (filesIn.length > MAX_FILES) throw new HttpError(400, `Attach up to ${MAX_FILES} documents.`);
            for (const k of ['timesheet', 'report', 'invoice']) if (!filesIn.some((f) => f.kind === k)) throw new HttpError(400, `Attach the ${KIND_LABEL[k].toLowerCase()}.`);
            const rqIds = Array.from(new Set(objs(doc.data.lines).map((l) => str(l.requisitionId)))).filter(Boolean);
            const rqs = new Map((await Promise.all(rqIds.map((i) => getDoc(`${reqsPath(ctx.orgId)}/${i}`)))).filter((x): x is Doc => !!x).map((x) => [x.id, x]));
            return mutate(ctx, 'po', doc.id, 'service.render', async (d) => {
                if ((str(d.poType) || poTypeOf(objs(d.lines))) !== 'service') throw new HttpError(409, 'This is not an order for services.');
                if (!DELIVERING.includes(str(d.status))) throw new HttpError(409, 'Services can only be recorded on an approved order.');
                if ((await versionsOf(ctx.orgId, baseOf(doc.id))).some((p) => p.id !== doc.id && str(p.data.status) === 'pending_approval')) throw new HttpError(409, 'An amendment of this order is in approval. Services wait for its decision.');
                if (periodFrom < str(d.approvedAt).slice(0, 10)) throw new HttpError(400, 'The service cannot start before the order was approved.');
                const receipts = objs(d.receipts);
                if (receipts.length >= 60) throw new HttpError(400, 'An order can have up to 60 service receipts.');
                let amount = 0;
                const lines = given.map((g) => {
                    const l = objs(d.lines).find((x) => Number(x.no) === g.no);
                    if (!l) throw new HttpError(400, 'A line does not exist on this order.');
                    if (str(rqs.get(str(l.requisitionId))?.data.requesterUid) !== ctx.uid) throw new HttpError(403, `Line ${g.no} was asked for by someone else.`);
                    const pending = receipts.filter((r) => str(r.status) === 'submitted').reduce((s, r) => s + (objs(r.lines).find((x) => Number(x.no) === g.no) ? Number(objs(r.lines).find((x) => Number(x.no) === g.no)!.qty) || 0 : 0), 0);
                    const left = round(outstanding(l) - pending, 4);
                    if (g.qty > left + 1e-9) throw new HttpError(400, `Line ${g.no}: only ${left} ${str(l.unit)} is still to be rendered (some may be waiting for acceptance).`);
                    const value = round(g.qty * (Number(l.netUnitPrice) || 0));
                    amount += value;
                    return { no: g.no, itemName: str(l.itemName), unit: str(l.unit), qty: g.qty, unitPrice: Number(l.netUnitPrice) || 0, amount: value, what: g.what, costCenterId: ccOf(l) };
                });
                amount = round(amount);
                const seq = (Number(d.receiptSeq) || 0) + 1;
                const rid = `${doc.id}_S${seq}`;
                const stored = await storeFiles(ctx, doc.id, filesIn, rid);
                const at = nowIso();
                const entry = { id: rid, status: 'submitted', periodFrom, periodTo, renderedBy: ctx.uid, renderedByName: nameOfUser(ctx.me), renderedAt: at, invoiceNo, invoiceDate, invoiceAmount: round(invoiceAmount), amount, lines, files: stored, signedStamped: true, note };
                return {
                    patch: { receipts: [...receipts, entry], receiptSeq: seq },
                    event: 'service rendered',
                    note: `${rid}: ${periodFrom} to ${periodTo}, invoice ${invoiceNo} ${round(invoiceAmount)}`.slice(0, 380),
                    label: 'Service recorded: waiting for the cost center owner to accept',
                    result: { receiptId: rid },
                };
            });
        }),
    ],

    // ===== Services: accepted by the cost center owner, which reconciles and posts the journal =====

    'POST /api/org/procurement/orders/service/accept': [
        orgRoute('org.procurement.orders.service.accept', 'PRC.service.accept', async (ctx) => {
            requireProcurement(ctx);
            const doc = await loadPo(ctx, str(ctx.body.id));
            const rid = str(ctx.body.receiptId);
            if (ctx.body.acknowledge !== true || ctx.body.verified !== true) throw new HttpError(400, 'Confirm that you checked the signed and stamped timesheets, the reports and the invoice against the service received.');
            const note = oneLine(ctx.body.note, 300);
            const [units, authority, orders] = await Promise.all([unitsOf(ctx.orgId), getAuthority(ctx.orgId), listDocs(ordersPath(ctx.orgId))]);
            const owned = ownedCostCenters(units, ctx.me);
            let journalId = '';
            const out = await mutate(ctx, 'po', doc.id, 'service.accept', async (d) => {
                if (!DELIVERING.includes(str(d.status))) throw new HttpError(409, 'This order is not open for services.');
                const receipts = objs(d.receipts);
                const r = receipts.find((x) => str(x.id) === rid);
                if (!r || str(r.status) !== 'submitted') throw new HttpError(409, 'This service receipt is not waiting for acceptance.');
                const rlines = objs(r.lines);
                const pl = (no: number) => objs(d.lines).find((x) => Number(x.no) === no);
                const foreign = rlines.filter((x) => !owned.has(ccOf(pl(Number(x.no)) ?? {})));
                if (foreign.length) throw new HttpError(403, `Only the owner of the cost center can accept. Line ${foreign.map((x) => x.no).join(', ')} is charged to a cost center you do not own.`);
                if (str(r.renderedBy) === ctx.uid) throw new HttpError(403, 'You recorded this service, so the cost center owner must be someone else.');
                if (ownerOf(d) === ctx.uid || str(d.createdBy) === ctx.uid) throw new HttpError(403, 'You prepared this order, so someone else must accept the service.');
                if (!objs(r.files).length || (['timesheet', 'report', 'invoice'] as const).some((k) => !objs(r.files).some((f) => str(f.kind) === k)) || r.signedStamped !== true) throw new HttpError(409, 'The signed timesheet, report and invoice are not all attached.');
                const tol = authority.controls.matchTolerancePct;
                const amount = Number(r.amount) || 0;
                const invoice = Number(r.invoiceAmount) || 0;
                if (Math.abs(invoice - amount) > (amount * tol) / 100 + 0.005) throw new HttpError(409, `The invoice (${fmt(invoice)}) differs from the value of the service rendered (${fmt(amount)}) by more than ${tol}%. Reject the receipt so the requester and the supplier can correct it.`);
                // One acceptance for each supplier invoice, across every order of the supplier.
                const dup = orders.find((p) => str(p.data.vendorId) === str(d.vendorId) && objs(p.data.receipts).some((x) => str(x.status) === 'accepted' && str(x.id) !== rid && str(x.invoiceNo).toLowerCase() === str(r.invoiceNo).toLowerCase()));
                if (dup) throw new HttpError(409, `Invoice ${str(r.invoiceNo)} from this supplier was already accepted on ${dup.id}.`);
                // The ledger of the cost center's legal entity: Dr the line account on the cost center, Cr GR/IR (cleared later by the invoice in Accounts Payable).
                const isBudgetPilot=d.budgetControlled===true;
                const acceptedLines=rlines.map((x) => ({ no: Number(x.no), qty: Number(x.qty) || 0, amount: Number(x.amount) || 0 }));
                // In the service pilot, posting must happen only after the complete PO patch is
                // prepared. The Finance journal owns the sole atomic commit (source+budget+GL).
                const posted=isBudgetPilot?{journals:[] as string[],note:''}:
                    await acceptService(ctx,{po:d,poId:doc.id,receiptId:rid,invoiceNo:str(r.invoiceNo),lines:acceptedLines});
                journalId = posted.journals.join(', ');
                const at = nowIso();
                const lines = objs(d.lines).map((l) => {
                    const x = rlines.find((q) => Number(q.no) === Number(l.no));
                    return x ? { ...l, receivedQty: round((Number(l.receivedQty) || 0) + (Number(x.qty) || 0), 4) } : l;
                });
                const full = lines.every((l) => outstanding(l) <= 0);
                const seqD = (Number(d.deliverySeq) || 0) + 1;
                const delivery = { id: `${doc.id}_D${seqD}`, at, date: today(), ref: `${rid} / ${str(r.invoiceNo)}`, by: ctx.uid, byName: nameOfUser(ctx.me), note: `Service accepted${journalId ? `, journal ${journalId}` : ''}${posted.note ? `. ${posted.note}` : ''}`.slice(0, 300), lines: rlines.map((x) => ({ no: Number(x.no), qty: Number(x.qty) })) };
                return {
                    patch: {
                        lines,
                        receipts: receipts.map((x) => (str(x.id) === rid ? { ...x, status: 'accepted', decidedBy: ctx.uid, decidedByName: nameOfUser(ctx.me), decidedAt: at, decisionNote: note, journalId, financeNote: posted.note } : x)),
                        deliveries: [...objs(d.deliveries), delivery],
                        deliverySeq: seqD,
                        status: full ? 'full' : 'partial',
                        ...(full ? { deliveredAt: at } : {}),
                        ...(!str(d.firstDeliveryAt) ? { firstDeliveryAt: at } : {}),
                    },
                    ...(isBudgetPilot?{atomicJournal:async(next:Obj,fresh:Doc)=>{
                        if(!fresh.updateTime)throw new HttpError(409,'Purchase order is stale for atomic service acceptance.');
                        const currentPeriod=periodAt(await yearsOf(ctx.orgId,str(d.budgetLegalEntityId)),at.slice(0,10));
                        if(!currentPeriod||currentPeriod.year.fy!==Number(d.budgetFy)||currentPeriod.period.status!=='open')
                            throw new HttpError(409,'Service posting must be in the same open financial year as its PO reservation. Finance carryforward is not configured.');
                        const booked=await acceptService(ctx,{
                            po:d,poId:doc.id,receiptId:rid,invoiceNo:str(r.invoiceNo),lines:acceptedLines,
                            strictBudget:{postingDate:at.slice(0,10),extraForJournal:async(glJournalId,costs,leId,_rate,currency)=>{
                                if(currency!==str(d.budgetCurrency)||leId!==str(d.budgetLegalEntityId))
                                    throw new HttpError(409,'Posting legal entity/currency differs from approved PO budget commitment.');
                                const prepared=await prepareServiceAcceptanceBudget(
                                    ctx.orgId,baseOf(doc.id),rid,costs,full);
                                const nextReceipts=objs(next.receipts).map(x=>str(x.id)===rid?
                                    {...x,journalId:glJournalId,financeNote:'GL and budget accepted together'}:x);
                                next.receipts=nextReceipts;
                                const nextDeliveries=objs(next.deliveries).map(x=>str(x.ref).startsWith(rid+' /')?
                                    {...x,note:('Service accepted, journal '+glJournalId).slice(0,300)}:x);
                                next.deliveries=nextDeliveries;
                                next.budgetActualMinor=(Number(d.budgetActualMinor)||0)+prepared.actualMinor;
                                next.budgetRemainingMinor=prepared.remainingMinor;
                                next.budgetLastJournal=glJournalId;
                                return [...prepared.writes,{path:ordersPath(ctx.orgId)+'/'+doc.id,
                                    fields:next,updateTime:fresh.updateTime!}];
                            }},
                        });
                        if(booked.journals.length!==1)
                            throw new HttpError(409,'Strict pilot requires exactly one successful GL journal.');
                        journalId=booked.journals[0];
                    }}:{}),
                    event: 'service accepted and reconciled',
                    note: `${rid}${journalId ? `, journal ${journalId}` : ''}${posted.note ? `. ${posted.note}` : ''}${note ? `. ${note}` : ''}`.slice(0, 380),
                    label: journalId ? `Service accepted: journal ${journalId} posted` : 'Service accepted (finance not live: not posted)',
                    result: { journalId },
                };
            });
            return { ...out, journalId };
        }),
    ],

    'POST /api/org/procurement/orders/service/reject': [
        orgRoute('org.procurement.orders.service.reject', 'PRC.service.accept', async (ctx) => {
            requireProcurement(ctx);
            const doc = await loadPo(ctx, str(ctx.body.id));
            const rid = str(ctx.body.receiptId);
            const reason = reasonOf(ctx.body);
            const owned = ownedCostCenters(await unitsOf(ctx.orgId), ctx.me);
            return mutate(ctx, 'po', doc.id, 'service.reject', async (d) => {
                const receipts = objs(d.receipts);
                const r = receipts.find((x) => str(x.id) === rid);
                if (!r || str(r.status) !== 'submitted') throw new HttpError(409, 'This service receipt is not waiting for acceptance.');
                const foreign = objs(r.lines).filter((x) => !owned.has(ccOf(objs(d.lines).find((l) => Number(l.no) === Number(x.no)) ?? {})));
                if (foreign.length) throw new HttpError(403, 'Only the owner of the cost center can reject.');
                const at = nowIso();
                return {
                    patch: { receipts: receipts.map((x) => (str(x.id) === rid ? { ...x, status: 'rejected', decidedBy: ctx.uid, decidedByName: nameOfUser(ctx.me), decidedAt: at, decisionNote: reason } : x)) },
                    event: 'service receipt rejected',
                    note: `${rid}: ${reason}`,
                    label: 'Service receipt rejected: the requester can record it again',
                };
            });
        }),
    ],

    // ===== Journals =====

    'POST /api/org/finance/journals/list': [
        orgRoute('org.finance.journals.list', null, async (ctx) => {
            requireProcurement(ctx);
            const owned = ownedCostCenters(await unitsOf(ctx.orgId), ctx.me);
            const docs = (await listDocs(journalsPath(ctx.orgId))).filter((j) => journalVisible(ctx, j.data, owned)).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 3000);
            const rows: Obj[] = [];
            for (const j of docs) {
                for (const l of objs(j.data.lines)) {
                    if (!can(ctx, 'PRC.journal.view') && !owned.has(str(l.costCenterId)) && ![str(j.data.renderedBy), str(j.data.acceptedBy), str(j.data.poOwnerUid)].includes(ctx.uid)) continue;
                    rows.push({
                        journalId: j.id,
                        journal: str(j.data.number),
                        line: Number(l.no),
                        postingDate: str(j.data.postingDate),
                        side: str(l.side),
                        glCode: str(l.glCode),
                        glName: str(l.glName),
                        costCenter: str(l.costCenterCode),
                        costCenterName: str(l.costCenterName),
                        currency: str(j.data.currency),
                        amount: Number(l.amount) || 0,
                        debit: str(l.side) === 'debit' ? Number(l.amount) || 0 : 0,
                        credit: str(l.side) === 'credit' ? Number(l.amount) || 0 : 0,
                        baseAmount: Number(l.baseAmount) || 0,
                        orgCurrency: str(j.data.orgCurrency),
                        vendor: str(j.data.vendorName),
                        po: str(j.data.poNumber),
                        invoiceNo: str(j.data.invoiceNo),
                        description: str(l.description),
                        acceptedBy: str(j.data.acceptedByName),
                        type: 'Service acceptance',
                        status: str(j.data.status),
                    });
                }
            }
            return { rows, count: docs.length };
        }),
    ],

    // One journal and the trail back to its source: receipt, order and version, requisitions, quotations, requirements.
    'POST /api/org/finance/journals/get': [
        orgRoute('org.finance.journals.get', null, async (ctx) => {
            requireProcurement(ctx);
            const id = str(ctx.body.id);
            if (!JNL_ID.test(id)) throw new HttpError(404, 'Journal not found.');
            const j = await getDoc(`${journalsPath(ctx.orgId)}/${id}`);
            const owned = ownedCostCenters(await unitsOf(ctx.orgId), ctx.me);
            if (!j || !journalVisible(ctx, j.data, owned)) throw new HttpError(404, 'Journal not found.');
            const d = j.data;
            const po = await getDoc(`${ordersPath(ctx.orgId)}/${str(d.poId)}`);
            const rqIds = Array.isArray(d.requisitionIds) ? (d.requisitionIds as unknown[]).map(str) : [];
            const reqDocs = await Promise.all(rqIds.map((r) => getDoc(`${reqsPath(ctx.orgId)}/${r}`)));
            const receipt = objs(po?.data.receipts).find((r) => str(r.id) === str(d.receiptId));
            return {
                id: j.id,
                number: str(d.number),
                status: str(d.status),
                type: 'Service acceptance',
                postingDate: str(d.postingDate),
                postedAt: str(d.postedAt),
                currency: str(d.currency),
                orgCurrency: str(d.orgCurrency),
                fxRate: Number(d.fxRate) || 1,
                totalDebit: Number(d.totalDebit) || 0,
                totalCredit: Number(d.totalCredit) || 0,
                baseTotal: Number(d.baseTotal) || 0,
                lines: objs(d.lines),
                vendorName: str(d.vendorName),
                invoiceNo: str(d.invoiceNo),
                invoiceDate: str(d.invoiceDate),
                invoiceAmount: Number(d.invoiceAmount) || 0,
                periodFrom: str(d.periodFrom),
                periodTo: str(d.periodTo),
                renderedByName: str(d.renderedByName),
                acceptedByName: str(d.acceptedByName),
                note: str(d.note),
                files: objs(d.files).map((f) => ({ id: str(f.id), kind: str(f.kind), name: str(f.name) })),
                trace: {
                    po: { id: str(d.poId), number: str(d.poNumber), base: str(d.poBase), ver: Number(d.poVer) || 1, status: str(po?.data.status), ownerName: str(po?.data.ownerName), approvedAt: str(po?.data.approvedAt), approvals: objs(o(po?.data.approval).steps).map((s) => ({ level: str(s.level), by: str(s.byName), at: str(s.at), title: str(s.positionTitle) })) },
                    receipt: { id: str(d.receiptId), renderedByName: str(d.renderedByName), renderedAt: str(receipt?.renderedAt), decidedByName: str(receipt?.decidedByName), decidedAt: str(receipt?.decidedAt), lines: objs(receipt?.lines) },
                    requisitions: rqIds.map((r, i) => ({ id: r, status: str(reqDocs[i]?.data.status), quotationId: str(reqDocs[i]?.data.quotationId), quotationNumber: str(reqDocs[i]?.data.quotationNumber), requirementId: str(reqDocs[i]?.data.requirementId), requirementTitle: str(reqDocs[i]?.data.requirementTitle), requesterName: str(reqDocs[i]?.data.requesterName) })),
                },
            };
        }),
    ],

    'POST /api/org/finance/journals/file': [
        orgRoute('org.finance.journals.file', null, async (ctx) => {
            requireProcurement(ctx);
            const id = str(ctx.body.id);
            if (!JNL_ID.test(id)) throw new HttpError(404, 'Journal not found.');
            const j = await getDoc(`${journalsPath(ctx.orgId)}/${id}`);
            const owned = ownedCostCenters(await unitsOf(ctx.orgId), ctx.me);
            if (!j || !journalVisible(ctx, j.data, owned)) throw new HttpError(404, 'Journal not found.');
            if (!objs(j.data.files).some((f) => str(f.id) === str(ctx.body.fileId))) throw new HttpError(404, 'File not found.');
            const f = await getDoc(`${filesPath(ctx.orgId)}/${str(ctx.body.fileId)}`);
            if (!f) throw new HttpError(404, 'File not found.');
            await record(ctx, 'org.finance.journal.file', id, `${str(f.data.kind)}: ${str(f.data.name)}`.slice(0, 200));
            return { name: str(f.data.name), type: str(f.data.type), data: str(f.data.data), kind: str(f.data.kind) };
        }),
    ],
};

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
