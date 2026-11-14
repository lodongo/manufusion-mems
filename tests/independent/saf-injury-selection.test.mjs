import test from 'node:test';
import assert from 'node:assert/strict';
import {injuryCodes,combinedControlCodes} from '../../backend/safInjurySelection.ts';
test('multiple potential injuries are deduplicated and singular historical rows remain readable',()=>{
 assert.deepEqual(injuryCodes({impact:'old'}),['old']);
 assert.deepEqual(injuryCodes({impact:'old',impactCodes:[]}),[]);
 assert.deepEqual(injuryCodes({impact:'old',impactCodes:['A','B','A']}),['A','B']);
});
test('combined mitigations include the union of mechanisms, never inactive or guidance-only measures',()=>{
 const profile={ injuries:[{code:'A',mechanism:'Toxic',effective:true},{code:'B',mechanism:'Asphyxia',effective:true},{code:'C',mechanism:'Toxic',effective:true}],layers:[{measures:[{code:'M1',mechanism:'Toxic',effective:true},{code:'M2',mechanism:'Asphyxia',effective:true},{code:'M3',mechanism:'Toxic',effective:false},{code:'M4',mechanism:'Asphyxia',effective:true,guidance:true},{code:'M1',mechanism:'Toxic',effective:true}]}]};
 assert.deepEqual([...combinedControlCodes(profile,['A','C'])],['M1']);
 assert.deepEqual([...combinedControlCodes(profile,['A','B','C'])],['M1','M2']);
 assert.deepEqual([...combinedControlCodes(profile,[])],[]);
});
