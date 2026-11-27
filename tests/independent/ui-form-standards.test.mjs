import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

// Maintenance, Production Planning / MRP, Manufacturing and Procurement screens use the MEMS standard form templates.
const read=(p)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const SCOPE=/^(Mnt|mnt|Pln|Mfg)\w*\.tsx$|^(ProductionFoundation|ManufacturingResources|WorkRequests|WorkOrders)\.tsx$/;
// Procurement and MRP screens (requisitions, quotations, purchase orders, vendors, replenishment, forecasting).
const PROCUREMENT=/^(AccountsPayable|BuyerGroups|CriticalityAnalysis|Forecasting|InventoryPendingPos|InventoryRequirements|MaterialsMaster|PoBudgetPilotPage|PoConsolidation|PoDeliveries|PoExtras|ProcurementCatalog|ProcurementDashboard|ProcurementPlaceholder|ProcurementRules|ProcurementSetup|PurchaseAgreements|SupplierEvaluation|srmVisuals|PurchaseOrders|PurchaseRequirements|Quotations|ReplenishmentRequests|RequirementInsights|StoresIssueVouchers|Vendors|materialCreateUi)\.tsx$/;
const screens=readdirSync(new URL('../../src/org/',import.meta.url)).filter(f=>SCOPE.test(f)||PROCUREMENT.test(f)).map(f=>['src/org/'+f,read('src/org/'+f)]);
const NON_TEXT=/type=['"{](checkbox|radio|file|hidden|range|color)/;

test('scope covers the maintenance, planning and manufacturing screens',()=>{
    assert.ok(screens.length>=69,'found '+screens.length);
    for(const name of ['WorkRequests','MntTaskAssessment','ProductionFoundation','PlnProcessRoutingEditor','MfgSkuSetup','PurchaseRequirements','Quotations','PurchaseOrders','Vendors','ReplenishmentRequests','Forecasting'])
        assert.ok(screens.some(([f])=>f.endsWith('/'+name+'.tsx')),name);
});

test('no native text inputs, text areas or dropdowns: Field, TextArea, SearchField and SelectField only',()=>{
    const problems=[];
    for(const [file,src] of screens){
        for(const m of src.matchAll(/<(input|textarea|select)\b[^>]{0,300}/g)){
            if(m[1]==='input'&&NON_TEXT.test(m[0]))continue;
            problems.push(file+': <'+m[1]+'> '+m[0].slice(0,80));
        }
    }
    assert.deepEqual(problems,[]);
});

test('dropdowns are never restyled with old input class strings',()=>{
    const problems=[];
    for(const [file,src] of screens)
        for(const m of src.matchAll(/<(SelectField|MemsSelectField|MntSelect)\b[^>]{0,400}?className=\{(input|field|mntInput|fld|fieldClass|inputClass|textClass)\}/g))
            problems.push(file+': '+m[1]+' className={'+m[2]+'}');
    assert.deepEqual(problems,[]);
});

test('readable text and touch targets on phones',()=>{
    for(const [file,src] of screens){
        assert.doesNotMatch(src,/text-\[(?:9|10|11)px\]/,file+' has text below 12px');
        assert.doesNotMatch(src,/<button\b[^>]*className=['"][^'"]*\b(?:h-[6-9]|min-h-[6-9])\b/,file+' has a button below 44px');
    }
});

test('text on brand-coloured surfaces uses the on-brand colour in every theme',()=>{
    const all=[];
    const walk=(dir)=>{for(const e of readdirSync(new URL('../../'+dir,import.meta.url),{withFileTypes:true})){
        if(e.isDirectory())walk(dir+e.name+'/');else if(/\.tsx$/.test(e.name))all.push(dir+e.name);}};
    walk('src/');
    for(const f of all)assert.doesNotMatch(read(f),/bg-brand text-white|text-white bg-brand/,f);
});

test('standard templates: themed, labelled, with hint and error, and one TextArea for the whole app',()=>{
    const ui=read('src/components/ui.tsx');
    for(const name of ['Field','TextArea','SearchField'])assert.match(ui,new RegExp('export function '+name+'\\('));
    assert.match(ui,/export \{ default as SelectField \} from '\.\/SearchableSelect'/);
    assert.match(ui,/const fieldId = id \|\| generated;/,'id is optional; labels stay linked');
    assert.doesNotMatch(ui,/slate-950|text-white|emerald-500/,'templates use theme tokens only');
    assert.match(read('src/admin/kit.tsx'),/export \{ TextArea \} from '\.\.\/components\/ui';/);
    const select=read('src/components/SearchableSelect.tsx');
    assert.match(select,/const id = providedId \|\| generatedId;/);
    assert.match(select,/<div className=\{`block min-w-0 \$\{className\}`\}>/,'className positions the dropdown like the other fields');
});

test('multi-part forms use the standard step navigation on phones',()=>{
    const nav=read('src/components/StepNav.tsx');
    assert.match(nav,/sm:hidden/);assert.match(nav,/label='Go to section'/);assert.match(nav,/hidden gap-2 sm:grid/);
    for(const f of ['src/org/mntSourcing.tsx','src/org/MntTaskAssessment.tsx','src/org/MntWorkOrder.tsx'])
        assert.match(read(f),/<StepNav\b/,f);
});

test('standard fields rendered from a list keep a React key',async()=>{
    const ts=(await import('typescript')).default;
    const STD=/^(Field|MemsField|TextArea|MemsTextArea|SearchField|SelectField|MemsSelectField|MntSelect)$/;
    const missing=[];
    for(const [file,text] of screens){
        const src=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
        const visit=(n)=>{
            if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='map'){
                const cb=n.arguments[0];let body=cb&&(ts.isArrowFunction(cb)||ts.isFunctionExpression(cb))?cb.body:null;
                while(body&&ts.isParenthesizedExpression(body))body=body.expression;
                const el=body&&(ts.isJsxSelfClosingElement(body)?body:ts.isJsxElement(body)?body.openingElement:null);
                if(el&&STD.test(el.tagName.getText())&&!el.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText()==='key'))
                    missing.push(file+':'+(src.getLineAndCharacterOfPosition(el.getStart()).line+1));
            }
            ts.forEachChild(n,visit);
        };
        visit(src);
    }
    assert.deepEqual(missing,[]);
});
