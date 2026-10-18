import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SearchableSelect from '../../src/components/SearchableSelect.tsx';

const options=[
  React.createElement('option',{key:'',value:''},'Choose...'),
  React.createElement('option',{key:'MNT',value:'MNT'},'Maintenance'),
  React.createElement('option',{key:'PRC',value:'PRC'},'Procurement'),
];
function render(props){
  return renderToStaticMarkup(React.createElement(SearchableSelect,{
    id:'module-dropdown',label:'Module',name:'module',...props,
  },...options));
}
test('controlled selection remains visible after temporary popup state resets',()=>{
  const html=render({value:'MNT'});
  assert.match(html,/>Maintenance<\/span>/);
  assert.match(html,/type="hidden" name="module" value="MNT"/);
  assert.doesNotMatch(html,/>Choose\.\.\.<\/span>/);
});
test('uncontrolled default selection is displayed rather than an empty pending option',()=>{
  const html=render({defaultValue:'PRC'});
  assert.match(html,/>Procurement<\/span>/);
  assert.match(html,/type="hidden" name="module" value="PRC"/);
});
test('dependent empty and disabled selectors preserve their placeholder state',()=>{
  const html=render({value:'',disabled:true});
  assert.match(html,/>Choose\.\.\.<\/span>/);
  assert.match(html,/<button[^>]*disabled=""/);
});
