import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('Stock Take: separation of duties is relaxed only through the platform test mode, and still enforced otherwise', () => {
    const server = read('backend/stockTake.ts');
    assert.match(server, /import \{ bypass \} from '\.\/testModeCore';/);
    // The conflict is tested first, so a bypass is recorded only when the rule would have refused.
    assert.match(server, /\(countersOf\(d\)\.includes\(ctx\.uid\) \|\| str\(d\.countEditedBy\) === ctx\.uid\) && !bypass\(ctx, 'inv\.stocktake\.verify_independence'\)\) throw new HttpError\(403/);
    assert.match(server, /\(str\(d\.postingRequestedBy\) === ctx\.uid \|\| countersOf\(d\)\.includes\(ctx\.uid\)\) && !bypass\(ctx, 'inv\.stocktake\.approve_independence'\)\) throw new HttpError\(403/);
    assert.match(server, /countersOf\(d\)\.includes\(ctx\.uid\) && !bypass\(ctx, 'inv\.stocktake\.post_independence'\)\) throw new HttpError\(403/);
    // The rules themselves are still there for everybody who is not in test mode.
    assert.match(server, /Posting must be approved by someone other than the person who requested it or counted the stock\./);
    assert.match(server, /The person who counted the stock cannot post it\./);
    // Status, permission and warehouse checks are not relaxed.
    assert.match(server, /if \(status !== 'pending_post_approval'\) throw new HttpError\(409, 'Posting not awaiting approval'\)/);
    assert.match(server, /await requireAtWarehouse\(ctx, perm, warehouseId\);/);
});

test('Stock Take: the list tells the screen where the caller has a conflict, and test mode comes only from the server', () => {
    const server = read('backend/stockTake.ts');
    assert.match(server, /function independenceFor\(ctx: OrgContext, data: Record<string, unknown>\)/);
    assert.match(server, /testMode: ctx\.testMode === true/, 'test mode is the guarded flag orgRoute sets (super admin, development, unexpired)');
    assert.match(server, /you: independenceFor\(ctx, x\.data\)/);
    assert.match(server, /\.map\(\(x\) => publicSession\(x, ctx\)\)/);
});

test('Stock Take screen: a barred step is disabled with the reason, test mode is stated, counts read correctly', () => {
    const screen = read('src/org/StockTake.tsx');
    assert.match(screen, /const approveBarred = \(!!you\?\.approveConflict && !testMode\) \|\| coaBarred;/);
    assert.match(screen, /key='approve'\s+disabled=\{approveBarred\}/);
    assert.match(screen, /key='verify'\s+disabled=\{verifyBarred\}/);
    assert.match(screen, /key='post'\s+disabled=\{postBarred\}/);
    assert.match(screen, /so you cannot approve its posting\. Another person with the Stock Take posting approval permission/);
    assert.match(screen, /Platform test mode is on for your organization: as super administrator/);
    assert.match(screen, /const count = \(n: number, one: string, many = `\$\{one\}s`\)/);
    assert.match(screen, /\$\{count\(postable, 'line'\)\} will be released for posting to the material journal/);
    assert.doesNotMatch(screen, /\$\{postable\} lines will be released/, 'the "1 lines" wording is gone');
});
