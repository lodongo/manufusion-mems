import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {binningBlock,locationBlock,restrictionCodesOf} from '../../backend/restrictionRules.ts';

const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const ui=read('src/org/MaterialsMaster.tsx');
const warehouseUI=read('src/org/WarehouseSetup.tsx');
const procurement=read('backend/procurement.ts');
const warehouse=read('backend/warehouse.ts');

test('only similarities strictly above 85 percent are returned and rendered',()=>{
    assert.ok(procurement.includes('scored.filter(x=>x.score>85).slice(0,20)'));
    assert.ok(ui.includes('similar.items.filter(x=>x.score>85)'));
    assert.ok(ui.includes('No materials with similarity above 85% found'));
    assert.ok(procurement.includes('hardDuplicates:scored.filter(x=>x.score>90&&x.partMatch)'));
});
test('multiple material restrictions require a matching cluster that permits every code',()=>{
    const master=[
        {code:'RS01',label:'Temperature controlled',active:true},
        {code:'RS03',label:'Restricted access',active:true},
        {code:'RS08',label:'Dangerous goods',active:true},
    ];
    assert.equal(locationBlock(['RS01','RS03'],master), '');
    assert.equal(binningBlock(['RS01','RS03'],['RS01','RS03','RS08'],master), '');
    assert.match(binningBlock(['RS01','RS03'],['RS01','RS08'],master),/Restriction mismatch/);
    assert.equal(binningBlock('RS01',['RS01','RS03'],master), '');
    assert.deepEqual(restrictionCodesOf(['RS01','RS03','RS01']),['RS01','RS03']);
});
test('new material wizard includes cluster matching, detailed restrictions and explicit no-match state',()=>{
    assert.ok(ui.includes('Warehouse restrictions * · select multiple'));
    assert.ok(ui.includes("endpoint+'/clusters'"));
    assert.ok(ui.includes("matchingClusters=clusterOptions.filter(c=>c.compatible)"));
    assert.ok(ui.includes('No matching clusters in this warehouse'));
    assert.ok(ui.includes('View all existing clusters'));
    assert.ok(ui.includes('Existing restrictions:'));
    assert.ok(ui.includes('Tap to adopt restrictions and apply cluster'));
    assert.ok(ui.includes('Tap to add this subcategory, adopt restrictions and apply cluster'));
    assert.ok(ui.includes('onClick={()=>void selectCluster(c)}'));
    assert.ok(ui.includes("'/api/org/warehouse/cluster/adopt-subcategory'"));
    assert.ok(ui.includes('setRestrictionCodes([...adoptedRestrictions])'));
    assert.ok(ui.includes("clusterCode:cluster.code"));
    assert.ok(procurement.includes("'POST /api/org/procurement/materials/clusters'"));
    assert.ok(procurement.includes("const compatibleRestrictions=selected.every(code=>codes.includes(code))"));
});
test('draft may be saved without a cluster and redirected with safe prefilled material restrictions',()=>{
    assert.ok(ui.includes("if(submit&&issues.length)return setError(issues[0])"));
    assert.ok(ui.includes("endpoint+'/autosave'"));
    assert.ok(ui.includes("sessionStorage.setItem('mems.cluster.prefill.'+registration.warehouseId"));
    assert.ok(ui.includes("Save draft & create cluster"));
    assert.ok(ui.includes("navigate('organization_admin/structure/'+registration.warehouseId+'/storage')"));
    assert.ok(warehouseUI.includes("sessionStorage.getItem(key)"));
    assert.ok(warehouseUI.includes("Date.now()-Number(draft.createdAt)>30*60*1000"));
    assert.ok(warehouseUI.includes("const [subCodes, setSubCodes] = useState<string[]>(prefill?.subcategoryCode?"));
    assert.ok(warehouseUI.includes("const [restrictionCodes,setRestrictionCodes]=useState<string[]>(prefill?.restrictionCodes||[])"));
    assert.ok(warehouseUI.includes("callBackend('/api/org/procurement/materials/update'"));
});
test('automatic material-to-cluster association never creates an inventory transaction',()=>{
    assert.ok(procurement.includes("clusterAssignmentStatus:clusterCode?'assigned_pending_material_approval':'unassigned'"));
    assert.ok(procurement.includes("await synchronizeMaterialCluster(ctx,"));
    assert.ok(warehouse.includes('const clusterMaterials=materialDocs.filter'));
    assert.ok(warehouseUI.includes('Assigned materials'));
    assert.ok(warehouseUI.includes('Actual stock placement and physical positions are handled in Inventory after approval'));
    assert.ok(procurement.includes("const requiredCodes=materialRequiredRestrictions("));
});

test('tapping an existing same-category cluster adopts restrictions, and audited expansion respects segregation',()=>{
    assert.ok(ui.includes('requiresSubcategoryExtension'));
    assert.ok(ui.includes('appConfirm('));
    assert.ok(ui.includes('setRegistration(p=>({...p,clusterCode:cluster.code,warehouseRestriction:adoptedRestrictions[0]'));
    assert.ok(procurement.includes('const adoptable=!!loc&&loc.active!==false&&compatibleCategory'));
    assert.ok(procurement.includes('requiresSubcategoryExtension:adoptable&&!compatibleSubcategory'));
    assert.ok(procurement.includes('SEGREGATED_RESTRICTIONS.has(code)'));
    assert.ok(warehouse.includes("'POST /api/org/warehouse/cluster/adopt-subcategory'"));
    assert.ok(warehouse.includes('const node=await storageCostCenter(ctx,str(ctx.body.costCenterId))'));
    assert.ok(warehouse.includes('return withLock(ctx,node.id,async()=>'));
    assert.ok(warehouse.includes('warehouseRestrictionMaster(),materialCategories()'));
    assert.ok(warehouse.includes('cluster.subcategories.some(x=>x.categoryCode&&x.categoryCode!==categoryCode)'));
    assert.ok(warehouse.includes('codes.some(x=>SEGREGATED_RESTRICTIONS.has(x))'));
    assert.ok(warehouse.includes('materialSubcategoryCodes:newLocationCodes'));
    assert.ok(warehouse.includes('subcategories:[...existing,cls]'));
    assert.ok(warehouse.includes('org.warehouse.cluster.adopt_subcategory'));
});
