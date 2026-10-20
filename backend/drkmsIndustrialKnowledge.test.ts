import assert from 'node:assert/strict';
import test from 'node:test';
import {CONTROL_TECHNOLOGIES,PLC_LANGUAGES,UTILITY_KINDS,validIndustrialKnowledge} from './drkmsIndustrialKnowledge';
const base={assetTag:'AST-000001',kind:'plc_program' as const,technology:'siemens_step7_tia' as const,
 programLanguages:['ladder' as const,'structured_text' as const],title:'Filler S7 logic',
 sourceDocumentId:'a'.repeat(20),sourceRevisionId:'b'.repeat(64),accessMode:'read_only' as const,aiControlEnabled:false as const};
test('multi-vendor PLC catalogue includes IEC languages and established environments',()=>{
 assert.ok(CONTROL_TECHNOLOGIES.includes('beckhoff_twincat'));
 assert.ok(CONTROL_TECHNOLOGIES.includes('rockwell_studio5000'));
 assert.ok(PLC_LANGUAGES.includes('function_block'));
});
test('utilities cover major equipment supply types',()=>assert.ok(UTILITY_KINDS.includes('compressed_air')));
test('versioned PLC reference requires read-only AI boundary',()=>{
 assert.equal(validIndustrialKnowledge(base),true);
 assert.equal(validIndustrialKnowledge({...base,accessMode:'write'} as never),false);
 assert.equal(validIndustrialKnowledge({...base,aiControlEnabled:true} as never),false);
});
test('PLC and utility binding require technology and utility classification',()=>{
 assert.equal(validIndustrialKnowledge({...base,technology:undefined}),false);
 assert.equal(validIndustrialKnowledge({...base,kind:'utility_feed',utilityKind:undefined} as never),false);
});
