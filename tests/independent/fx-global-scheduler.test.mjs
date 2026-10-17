import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRates, convertAmount } from '../../backend/fxRates.ts';
import { automationDue } from '../../backend/automationEngine.ts';

test('normalizes the whole world currency provider response, not only KES', () => {
    const received = Object.fromEntries(Array.from({length:100},(_,i)=>[String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26)+'X',100+i]));
    received.USD=1;received.KES=129.5;received.EUR=0.91;received.JPY=153.1;received.GBP=0.78;
    received.BAD=NaN;received.NIL=-1;
    const rates=normalizeRates(received);
    assert.ok(Object.keys(rates).length>=100);
    assert.equal(rates.KES,129.5);
    assert.equal(rates.EUR,0.91);
    assert.equal(rates.JPY,153.1);
    assert.equal(rates.GBP,0.78);
    assert.equal(rates.USD,1);
    assert.equal(rates.BAD,undefined);
    assert.equal(rates.NIL,undefined);
});

test('rejects truncated provider responses to preserve existing upload', () => {
    assert.throws(()=>normalizeRates({USD:1,KES:120,EUR:0.9}),/too few currencies/i);
    assert.throws(()=>normalizeRates({}),/too few currencies/i);
});

test('converts any two supported currencies through USD correctly', () => {
    const rates={ USD:1,KES:130,EUR:0.9,GBP:0.8,JPY:150 };
    assert.equal(convertAmount(100,'USD','KES',rates),13000);
    assert.equal(convertAmount(130,'KES','USD',rates),1);
    assert.equal(convertAmount(900,'EUR','KES',rates),130000);
    assert.equal(convertAmount(150,'JPY','GBP',rates),0.8);
    assert.equal(convertAmount(10,'ZAR','USD',rates),null);
    assert.equal(convertAmount(10,'USD','CHF',rates),null);
});

test('shared scheduler respects enable toggle and saved hourly frequency', () => {
    const c={enabled:true,frequency:'hourly',timeUtc:'06:00',weekday:1,provider:'open_er_api'};
    const now=new Date('2026-10-17T08:50:00.000Z');
    assert.equal(automationDue(c,'2026-10-17T08:00:00.000Z',now),false);
    assert.equal(automationDue(c,'2026-10-17T07:49:00.000Z',now),true);
    assert.equal(automationDue({...c,enabled:false},'',now),false);
});

test('shared scheduler runs a daily job only after configured UTC clock time', () => {
    const c={enabled:true,frequency:'daily',timeUtc:'06:00',weekday:1,provider:'open_er_api'};
    assert.equal(automationDue(c,'2026-10-16T06:00:00Z',new Date('2026-10-17T05:59:00Z')),false);
    assert.equal(automationDue(c,'2026-10-16T06:00:00Z',new Date('2026-10-17T06:00:00Z')),true);
    assert.equal(automationDue(c,'2026-10-17T06:00:01Z',new Date('2026-10-17T09:00:00Z')),false);
});
