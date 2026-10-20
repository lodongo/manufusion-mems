import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPublicationGate } from './drkmsPublicationGate';
const base = { state: 'approved', creatorUid: 'author', reviewerUid: 'reviewer', hasSourceEvidence: true, verificationRequired: true, verified: true, hasApprovalProof: true, validScope: true, revisionId: 'rev01' };
test('valid independently approved revision passes readiness gate', () => assert.equal(assessPublicationGate(base).ready,true));
test('draft with no approval can never publish', () => assert.equal(assessPublicationGate({...base,state:'draft',hasApprovalProof:false}).ready,false));
test('creator cannot verify own output', () => assert.equal(assessPublicationGate({...base,reviewerUid:'author'}).ready,false));
test('AI output without verified source cannot publish', () => assert.equal(assessPublicationGate({...base,verified:false,hasSourceEvidence:false}).ready,false));
test('invalid location and missing revision block publication', () => assert.equal(assessPublicationGate({...base,validScope:false,revisionId:''}).ready,false));
