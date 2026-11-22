import { useEffect, useRef, useState } from 'react';
import { Plus, ArrowLeft, ArrowRight, Save, Send } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField, Tabs } from '../components/ui';
import RichTable from '../components/RichTable';
import { Button, Card, PageTitle, Spinner, useLoad } from '../admin/kit';
import type { AttrDef, DictTree, ClassDetail } from '../components/AssetDictionaryBrowser';
import { MATERIAL_LABELS } from '../components/AssetDictionaryBrowser';
import { appConfirm, appPrompt } from '../components/dialogs';
import CatalogueAttributeForm, { attributeIssues } from '../components/CatalogueAttributeForm';
import { ChoiceChip, ConfirmBox, MatchCard, OpenItems, OptionCard, ReviewSection, ShortTextPreview, StepSection, WizardBar, type WizardStep } from './materialCreateUi';
import { materialMasterHierarchy } from './materialMasterHierarchy';
import { navigate } from '../lib/route';
import MaterialMasterDashboard from './MaterialMasterDashboard';

/** Supply relationships, including a selection-only confidential proprietary route. */
const SUPPLY_TYPES: Array<{ code: 'OEM' | 'OCM' | 'BIDDED' | 'PROPRIETARY_SUPPLIER'; title: string; text: string; part: string }> = [
    { code: 'OEM', title: 'OEM — machine maker', text: 'The company that built the machine (e.g. Krones, Tetra Pak, Atlas Copco). Use for parts designed only for that machine: impellers, castings, special boards. Usually the most expensive and the only source.', part: 'OEM part number from the machine parts list or manual' },
    { code: 'OCM', title: 'OCM — component maker', text: 'The company that made the component inside the machine (e.g. SKF bearing in a pump, Siemens motor on a conveyor). Same part, often much cheaper and easier to get than through the OEM.', part: 'Component maker’s part number (printed on the part)' },
    { code: 'BIDDED', title: 'Bidded', text: 'Competitive bidding is required. No supplier is nominated or recommended at material creation; Procurement selects the winning supplier later.', part: '' },
    { code: 'PROPRIETARY_SUPPLIER', title: 'Proprietary Supplier', text: 'Material supplied through a proprietary source. No vendor details are needed; an optional proprietary part number may be recorded.', part: '' },
];

type SavedMaterial = {requestId?:string;masterDataId?:string;warehouseRestrictionCodes?:string[];warehouseRestriction?:string;clusterCode?:string; canApprove?:boolean;canEdit?:boolean;canDelete?:boolean;canSubmit?:boolean;workflowStage?:string;workflowCode?:string;createdBy?:string;submittedBy?:string;warehouseId?:string;approvalLevel?:number;uom?:string;oemPartNumber?:string;ocmPartNumber?:string;generalPartNumber?:string;proprietaryPartNumber?:string; id: string; name: string; shortText: string; categoryCode: string; subcategoryCode: string; familyCode: string; materialCode: string; createdAt: string; status?:string; attributes?:Record<string,string>; assemblyIds?:string[]; supplyType?:string;materialNumber?:string;pushedAt?:string;warehouseIds?:string[] };
const treeApi = '/api/org/procurement/catalog/tree';
const itemApi = '/api/org/procurement/catalog/item';
const endpoint = '/api/org/procurement/materials';
type WarehouseClusterOption={code:string;name:string;locationCode:string;locationName:string;
    subcategoryCodes:string[];restrictionCodes:string[];restrictionLabels:string[];storageTypeCode:string;
    compatible:boolean;reason:string;adoptable:boolean;requiresSubcategoryExtension:boolean};

/** Readable value of an attribute: option labels instead of codes (short form for the short text). */
function shownValue(a: AttrDef, raw: string | undefined, short = false): string {
    const v = String(raw ?? '').trim();
    if (!v) return '';
    if (a.dataType === 'boolean') return v === 'true' ? 'Yes' : v === 'false' ? 'No' : v;
    const label = (code: string) => {
        const l = a.options.find((o) => o.code === code)?.label ?? code;
        return short ? l.split(' (')[0].split(' — ')[0] : l;
    };
    if (a.dataType === 'multi_select') return v.split(',').filter(Boolean).map(label).join(', ');
    if (a.options.length) return label(v);
    return v + (a.unit ? ' ' + a.unit : '');
}
const SUPPLY_WORD: Record<string, string> = { OEM: 'the machine maker (OEM)', OCM: 'the component maker (OCM)', GENERAL: 'competitive bidding (supplier selected later)', BIDDED: 'competitive bidding (supplier selected later)', PROPRIETARY_SUPPLIER: 'a proprietary supplier' };

export default function MaterialsMaster() {
    const { data: tree, loading: treeLoading, error: treeError, reload: reloadMaterialMaster } =
        useLoad(() => callBackend<DictTree>(treeApi, { kind: 'materials' }));
    const { data: records, loading: recordsLoading, reload } = useLoad(() => callBackend<{ items: SavedMaterial[];isApprover:boolean;currentUserId:string;canCreate:boolean;canExtend:boolean;testOverride:boolean }>(endpoint + '/list'));
    const {data:options}=useLoad(()=>callBackend<{warehouses:Array<{id:string;name:string;code:string;categoryCodes:string[]}>;costCenters:Array<{id:string;name:string;code:string}>;assets:Array<{id:string;name:string;code:string;parentId:string}>;scopedAssemblies:Array<{id:string;name:string;parentId:string}>;uoms:Array<{code:string;label:string;category:string}>;classifications:Array<{code:string;label:string}>;restrictions:Array<{code:string;label:string;description:string}>;vendors:Array<{id:string;name:string}>;assemblies:Array<{id:string;name:string}>}>(endpoint+'/options'));
    const [uomCategory,setUomCategory]=useState('');
    const [adding, setAdding] = useState(false);
    const [stage,setStage]=useState(1);
    const [editingId,setEditingId]=useState('');
    const [registration,setRegistration]=useState<Record<string,string>>({supplyType:'BIDDED',partyEntryMode:'none'});
    const [restrictionCodes,setRestrictionCodes]=useState<string[]>([]);
    const [clusterOptions,setClusterOptions]=useState<WarehouseClusterOption[]>([]);
    const [clustersLoading,setClustersLoading]=useState(false);
    const [applyingCluster,setApplyingCluster]=useState('');
    const [clustersError,setClustersError]=useState('');
    const [showAllClusters,setShowAllClusters]=useState(false);
    const [category, setCategory] = useState('');
    const [subcategory, setSubcategory] = useState('');
    const [family, setFamily] = useState('');
    const [material, setMaterial] = useState('');
    const [detail, setDetail] = useState<ClassDetail | null>(null);
    const lastDetailedMaterial=useRef('');
    const [name, setName] = useState('');
    const [values, setValues] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [reviewAgreed,setReviewAgreed]=useState(false);
    const [duplicateConfirmed,setDuplicateConfirmed]=useState(false);
    const [similarLoading,setSimilarLoading]=useState(false);
    const [liveMatches,setLiveMatches]=useState<Array<{id:string;name:string;shortText:string;status:string;score:number;partMatch:boolean}>>([]);
    const [hardDuplicates,setHardDuplicates]=useState<Array<{id:string;name:string;shortText:string;status:string;score:number;partMatch:boolean}>>([]);
    const [liveChecking,setLiveChecking]=useState(false);
    const [autoStatus,setAutoStatus]=useState('');
    const draftId=useRef('');
    const saveQueue=useRef<Promise<unknown>>(Promise.resolve());
    const [extendSource,setExtendSource]=useState<SavedMaterial|null>(null);
    const [extendSearchOpen,setExtendSearchOpen]=useState(false);
    const [extendSearch,setExtendSearch]=useState('');
    const [extendWarehouse,setExtendWarehouse]=useState('');
    const [extendVerified,setExtendVerified]=useState(false);
    const [extendBusy,setExtendBusy]=useState(false);
    const {data:extensionRecords,reload:reloadExtensions}=useLoad(()=>callBackend<{items:Array<{id:string;sourceId:string;warehouseId:string;materialName:string;status:string;approvalLevel:number;workflowStage?:string;canApprove?:boolean;createdBy?:string}>}>(endpoint+'/extensions'));
    const [reviewMaterial,setReviewMaterial]=useState<SavedMaterial|null>(null);
        const editDraft = (m:SavedMaterial) => {
        if(!m.canEdit)return;
        setEditingId(m.id);draftId.current=m.id;
        setRestrictionCodes(m.warehouseRestrictionCodes?.length?[...m.warehouseRestrictionCodes]:(m.warehouseRestriction?[m.warehouseRestriction]:[]));
        setClusterOptions([]);setAdding(true);setStage(3);setReviewAgreed(false);setDuplicateConfirmed(false);
        setSimilar(null);setUomCategory(options?.uoms?.find(x=>x.code===m.uom)?.category??'');
        setName(m.name);setCategory(m.categoryCode);setSubcategory(m.subcategoryCode);
        setFamily(m.familyCode);setMaterial(m.materialCode);setValues(m.attributes??{});
        setError('');setRegistration({
            ...Object.fromEntries(Object.entries(m).filter(([,v])=>typeof v==='string')) as Record<string,string>,
            supplyType:m.supplyType==='GENERAL'?'BIDDED':m.supplyType??'BIDDED',
            assemblyIds:Array.isArray(m.assemblyIds)?m.assemblyIds.join(','):'',
        });
    };
    const [listView,setListView]=useState('my_drafts');
    const testOverride=records?.testOverride===true;
    const openExtension=(source:{id:string;name:string;status?:string})=>{
        if(!records?.canExtend){setError('You do not have permission to extend an organization material.');return;}
        const record=records?.items.find(m=>m.id===source.id);
        if(!record||!['approved','active'].includes(record.status||'')){
            setError('Only an approved organization material can be extended. Pending or draft materials must first complete the creation workflow.');
            return;
        }
        setExtendSource(record);setExtendWarehouse('');setExtendVerified(false);setError('');
    };
    const approvedMasterMaterials=(records?.items??[]).filter(m=>['approved','active'].includes(m.status||''));
    const extensionSearchResults=approvedMasterMaterials.filter(m=>{
        const q=extendSearch.trim().toLowerCase();
        return !q||[m.name,m.shortText,m.materialNumber,m.id,m.categoryCode,m.familyCode]
            .some(v=>(v||'').toLowerCase().includes(q));
    }).slice(0,80);
    const extensionTargets=(options?.warehouses??[]).filter(w=>
        !!extendSource&&w.categoryCodes?.includes(extendSource.categoryCode)&&
        w.id!==extendSource.warehouseId&&
        !(extendSource.warehouseIds??[]).includes(w.id)&&
        !(extensionRecords?.items??[]).some(e=>e.sourceId===extendSource.id&&
            e.warehouseId===w.id&&!['rejected','cancelled','workflow_terminated'].includes(e.status)));
    const [listSearch,setListSearch]=useState('');
    const [similar,setSimilar]=useState<{items:Array<{id:string;name:string;shortText:string;warehouseId:string;score:number;matchedFields:string[];attributeMatches:number;attributeTotal:number;partMatch:boolean;status:string}>;totalCompared:number}|null>(null);
    // Every selection is derived from the active PRC Materials Master; no industry
    // recommendation may silently hide a valid material or a saved draft choice.
    const hierarchy=materialMasterHierarchy(tree,category,subcategory,family,material);
    const {categories,subcategories,families,materials}=hierarchy;
    const supplyType=registration.supplyType==='GENERAL'?'BIDDED':registration.supplyType??'BIDDED';
    const selectedVendor=options?.vendors?.find(v=>v.id===registration.vendorId)?.name??'';
    const partyName=['BIDDED','PROPRIETARY_SUPPLIER'].includes(supplyType)?'':(registration.partyEntryMode??'registered')==='manual'?registration.partyName??'':selectedVendor;
    const partNumber=supplyType==='OEM'?registration.oemPartNumber??'':supplyType==='OCM'?registration.ocmPartNumber??'':supplyType==='PROPRIETARY_SUPPLIER'?registration.proprietaryPartNumber??'':'';
    const shortText=[name.trim(),...((detail?.attributes??[]).filter(a=>a.specific).map(a=>shownValue(a,values[a.code],true)).filter(Boolean)),...(['OEM','OCM'].includes(supplyType)?[partyName.trim(),partNumber.trim()]:[])].filter(Boolean).join('; ').slice(0,120);
    useEffect(() => {
        if(!material||!hierarchy.validMaterial){setDetail(null);setLoadingDetail(false);return;}
        let live=true;
        setDetail(null); // Never display attributes from an earlier material during a new lookup.
        setLoadingDetail(true);
        callBackend<ClassDetail>(itemApi,{kind:'materials',code:material}).then(d=>{
            if(!live)return;
            if(d.code!==material||d.groupCode!==category||d.categoryCode!==subcategory||
                d.subcategoryCode!==family)throw new Error('The material classification changed in the active Materials Master. Refresh the master and select it again.');
            setDetail(d);
            // Refresh attribute definitions without losing user input for the same material.
            if(!editingId&&lastDetailedMaterial.current!==d.code){setName(d.name);setValues({});}
            lastDetailedMaterial.current=d.code;
        }).catch(e=>{if(live){setDetail(null);setError(e instanceof Error?e.message:'Unable to load the selected material attributes.');}})
            .finally(()=>{if(live)setLoadingDetail(false);});
        return()=>{live=false;};
    },[material,category,subcategory,family,editingId,hierarchy.validMaterial,tree]);
    useEffect(()=>{if(!adding||!material){setLiveMatches([]);setHardDuplicates([]);return;}let active=true;setLiveChecking(true);const timeout=setTimeout(()=>{callBackend<{items:Array<{id:string;name:string;shortText:string;status:string;score:number;partMatch:boolean}>;hardDuplicates:Array<{id:string;name:string;shortText:string;status:string;score:number;partMatch:boolean}>}>(endpoint+'/similar',{excludeId:draftId.current||editingId,material:{name,categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material,attributes:values,...registration}}).then(r=>{if(active){setLiveMatches(r.items.filter(x=>x.score>85));setHardDuplicates(r.hardDuplicates??[]);}}).catch(()=>{if(active){setLiveMatches([]);setHardDuplicates([]);}}).finally(()=>{if(active)setLiveChecking(false);});},450);return()=>{active=false;clearTimeout(timeout);};},[adding,material,name,category,subcategory,family,values,registration,editingId]);
    useEffect(()=>{if(!adding||!material||name.trim().length<2||extendSource)return;setAutoStatus('Saving draft…');const timer=setTimeout(()=>{const payload={name:name.trim(),shortText,categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material,attributes:values,...registration,warehouseRestrictionCodes:restrictionCodes,assemblyIds:(registration.assemblyIds??'').split(',').filter(Boolean)};saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{const result=await callBackend<{id:string}>(endpoint+'/autosave',{id:draftId.current||editingId,data:payload});draftId.current=result.id;setAutoStatus('Draft saved');}).catch(e=>setAutoStatus(e instanceof Error?'Autosave failed: '+e.message:'Autosave failed'));},650);return()=>clearTimeout(timer);},[adding,material,name,category,subcategory,family,values,registration,restrictionCodes,shortText,editingId,extendSource]);
    const eligibleWarehouses=(options?.warehouses??[]).filter(w=>w.categoryCodes?.includes(category));
    useEffect(()=>{
        const warehouseId=registration.warehouseId;
        if(!adding||!warehouseId||!category||!subcategory){
            setClusterOptions([]);setClustersError('');setClustersLoading(false);return;
        }
        let active=true;setClustersLoading(true);setClustersError('');
        callBackend<{clusters:WarehouseClusterOption[]}>(endpoint+'/clusters',{
            warehouseId,categoryCode:category,subcategoryCode:subcategory,restrictionCodes,
        }).then(r=>{if(active)setClusterOptions(r.clusters);})
            .catch(e=>{if(active){setClusterOptions([]);setClustersError(e instanceof Error?e.message:'Unable to load warehouse clusters.');}})
            .finally(()=>{if(active)setClustersLoading(false);});
        return()=>{active=false;};
    },[adding,registration.warehouseId,category,subcategory,restrictionCodes.join('|')]);
    const matchingClusters=clusterOptions.filter(c=>c.compatible);
    const selectedCluster=clusterOptions.find(c=>c.code===registration.clusterCode);
    const toggleRestriction=(code:string)=>{
        const next=restrictionCodes.includes(code)?restrictionCodes.filter(x=>x!==code):[...restrictionCodes,code];
        setRestrictionCodes(next);
        setRegistration(p=>({...p,warehouseRestriction:next[0]||'',clusterCode:''}));
        setReviewAgreed(false);setDuplicateConfirmed(false);
    };
    const selectCluster=async(cluster:WarehouseClusterOption)=>{
        if(!cluster.adoptable||applyingCluster)return;
        setError('');
        let adoptedRestrictions=cluster.restrictionCodes;
        if(cluster.requiresSubcategoryExtension){
            if(!(await appConfirm(
                'Add material subcategory '+subcategory+' to cluster '+cluster.code+' ('+cluster.name+') and adopt its restrictions ('+
                cluster.restrictionCodes.join(', ')+')? This updates the shared cluster and storage-location subcategory mapping, without moving stock.'
            )))return;
            setApplyingCluster(cluster.code);
            try{
                const adopted=await callBackend<{ok:boolean;restrictionCodes:string[];subcategoryCodes:string[]}>(
                    '/api/org/warehouse/cluster/adopt-subcategory',{
                        costCenterId:registration.warehouseId,code:cluster.code,categoryCode:category,
                        subcategoryCode:subcategory,confirm:true,
                    });
                adoptedRestrictions=adopted.restrictionCodes;
                setClusterOptions(all=>all.map(c=>c.code===cluster.code?{
                    ...c,subcategoryCodes:adopted.subcategoryCodes,restrictionCodes:adoptedRestrictions,
                    compatible:true,adoptable:true,requiresSubcategoryExtension:false,reason:'',
                }:c));
            }catch(e){
                setError(e instanceof Error?e.message:'Unable to adopt this warehouse cluster.');
                return;
            }finally{setApplyingCluster('');}
        }
        // The selected cluster is the source of truth for material restrictions.
        // The existing autosave persists clusterCode and the adopted restrictions.
        setRestrictionCodes([...adoptedRestrictions]);
        setRegistration(p=>({...p,clusterCode:cluster.code,warehouseRestriction:adoptedRestrictions[0]||''}));
        setReviewAgreed(false);setDuplicateConfirmed(false);
    };
    const duplicateBlocked=hardDuplicates.length>0;
    const [showAttrErrors,setShowAttrErrors]=useState(false);
    const stage1Issues = [
        !hierarchy.complete?(hierarchy.selectionIssue||'Select a category, subcategory, family and material from the active Materials Master.'):'',
        !detail?'Load the selected material attributes from the active Materials Master.':'',
        !name.trim()?'Enter material name.':'',
        ...attributeIssues(detail?.attributes??[],values).map(x=>x.a.name+': '+x.msg),
    ].filter(Boolean);
    const supply=registration.supplyType==='GENERAL'?'BIDDED':registration.supplyType??'BIDDED';
    const supplierless=['BIDDED','PROPRIETARY_SUPPLIER'].includes(supply);
    const mode=supplierless?'none':registration.partyEntryMode??'registered';
    const partKey=supply==='OEM'?'oemPartNumber':supply==='OCM'?'ocmPartNumber':supply==='PROPRIETARY_SUPPLIER'?'proprietaryPartNumber':'generalPartNumber';
    const stage2Issues=[!uomCategory?'Select a unit category.':'',!(options?.uoms??[]).some(x=>x.code===registration.uom&&(x.category||'Other')===uomCategory)?'Select a valid unit of measure.':'',!supplierless&&!registration[partKey]?.trim()?'Enter the '+supply+' part number.':'',!supplierless&&mode==='manual'&&((registration.partyName??'').trim().length<2)?'Enter a name (at least 2 characters).':'',!supplierless&&mode==='registered'&&!registration.vendorId?'Select a registered vendor or enter a name manually.':'',supply==='OEM'&&!(options?.costCenters??[]).some(x=>x.id===registration.costCenterId)?'Select an accessible cost center.':'',supply==='OEM'&&!(options?.assets??[]).some(x=>x.id===registration.assetId&&x.parentId===registration.costCenterId)?'Select an asset within that cost center.':'',supply==='OEM'&&(registration.assemblyIds??'').split(',').filter(Boolean).some(id=>!(options?.scopedAssemblies??[]).some(x=>x.id===id&&x.parentId===registration.assetId))?'All selected assemblies must belong to the asset.':''].filter(Boolean);
    const stage3Issues=[!eligibleWarehouses.some(x=>x.id===registration.warehouseId)?'Select a warehouse configured for this material category.':'',
        !restrictionCodes.length?'Choose at least one warehouse restriction.':'',
        restrictionCodes.some(code=>!(options?.restrictions??[]).some(x=>x.code===code))?'One or more warehouse restrictions are not enabled in the master.':'',
        !!registration.clusterCode&&!selectedCluster&&!clustersLoading?'The selected cluster is unavailable. Choose a current cluster.':''].filter(Boolean);
    const complete=!stage1Issues.length&&!stage2Issues.length&&!stage3Issues.length;
    const checkSimilar=async()=>{setSimilarLoading(true);setSimilar(null);setDuplicateConfirmed(false);setError('');try{const result=await callBackend<{items:Array<{id:string;name:string;shortText:string;warehouseId:string;score:number;matchedFields:string[];attributeMatches:number;attributeTotal:number;partMatch:boolean;status:string}>;totalCompared:number}>(endpoint+'/similar',{excludeId:draftId.current||editingId,material:{name,categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material,attributes:values,...registration}});setSimilar({...result,items:result.items.filter(x=>x.score>85)});setStage(5);}catch(e){setError(e instanceof Error?e.message:'Similarity comparison failed.');}finally{setSimilarLoading(false);}};
    const save = async (submit=false) => {
        setError('');
        const issues=[...stage1Issues,...stage2Issues,...stage3Issues];
        if(submit&&issues.length)return setError(issues[0]);
        if(submit&&duplicateBlocked)return setError('REPEAT MATERIAL: Same part number and similarity above 90%. Extend the existing material instead.');
        if(submit&&(!reviewAgreed||!duplicateConfirmed||!similar))return setError('Complete structured review and duplicate confirmation first.');
        setSaving(true);
        try {
            await saveQueue.current;
            let id=draftId.current||editingId;
            const data={name:name.trim(),attributes:values,shortText,...registration,
                warehouseRestrictionCodes:restrictionCodes,warehouseRestriction:restrictionCodes[0]||'',supplyType:supply,partyEntryMode:mode,
                ...(supplierless?{vendorId:'',partyName:'',oemPartNumber:'',ocmPartNumber:'',generalPartNumber:'',model:'',versionNumber:'',costCenterId:'',assetId:'',assemblyId:'',assemblyIds:[]}:{}),assemblyIds:(typeof registration.assemblyIds==='string'?registration.assemblyIds.split(',').map(x=>x.trim()).filter(Boolean):[])};
            if(!submit){
                const draft=await callBackend<{id:string}>(endpoint+'/autosave',{id,data:{
                    ...data,categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material}});
                id=draft.id;
            }else if(id)await callBackend(endpoint+'/update',{id,data});
            else {const created=await callBackend<{id:string}>(endpoint+'/create',{categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material,name:name.trim(),attributes:values});id=created.id;await callBackend(endpoint+'/update',{id,data});}
            draftId.current=id;
            if(submit)await callBackend(endpoint+'/submit',{id});
            setAdding(false);setStage(1);draftId.current='';setAutoStatus('');setEditingId('');setRestrictionCodes([]);setClusterOptions([]);setRegistration({supplyType:'BIDDED',partyEntryMode:'none'});setUomCategory('');setCategory('');setSubcategory('');setFamily('');setMaterial('');setDetail(null);setValues({});reload();
        } catch(e){setError(e instanceof Error?e.message:'Unable to save or submit material.');}
        finally{setSaving(false);}
    };
    // ----- verification: field messages appear once the user has tried to leave the step -----
    const [tried, setTried] = useState<Record<number, boolean>>({});
    const fieldError = (step: number, bad: boolean, message: string) => (tried[step] && bad ? message : undefined);
    const uomsInCategory = (options?.uoms ?? []).filter((x) => (x.category || 'Other') === uomCategory);
    const partLabel = supply === 'OEM' ? 'OEM part number' : supply === 'OCM' ? 'OCM part number' : 'Part number';
    const partyLabel = supply === 'OEM' ? 'OEM' : supply === 'OCM' ? 'Component maker (OCM)' : 'Supplier';
    const selectedAssemblies = (registration.assemblyIds ?? '').split(',').filter(Boolean);
    const topRef = useRef<HTMLDivElement>(null);
    const go = (next: number) => {
        setError('');
        setStage(next);
        requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    };
    const saveDraftAndCreateCluster=async()=>{
        if(!registration.warehouseId||!restrictionCodes.length)return setError('Choose the warehouse and at least one restriction first.');
        if(!hierarchy.complete)return setError('Choose a material from the Materials Master first.');
        setSaving(true);setError('');
        try{
            await saveQueue.current;
            const data={name:name.trim(),shortText,categoryCode:category,subcategoryCode:subcategory,
                familyCode:family,materialCode:material,attributes:values,...registration,
                supplyType:supply,partyEntryMode:mode,clusterCode:'',
                warehouseRestriction:restrictionCodes[0],warehouseRestrictionCodes:restrictionCodes};
            const res=await callBackend<{id:string}>(endpoint+'/autosave',{id:draftId.current||editingId,data});
            draftId.current=res.id;
            sessionStorage.setItem('mems.cluster.prefill.'+registration.warehouseId,JSON.stringify({
                warehouseId:registration.warehouseId,materialId:res.id,categoryCode:category,
                subcategoryCode:subcategory,restrictionCodes,createdAt:Date.now(),
            }));
            navigate('organization_admin/structure/'+registration.warehouseId+'/storage');
        }catch(e){setError(e instanceof Error?e.message:'Unable to save draft and open cluster configuration.');}
        finally{setSaving(false);}
    };
    const startNew = () => {
        setAdding(true);setStage(1);draftId.current='';setExtendSource(null);setAutoStatus('');setReviewAgreed(false);setDuplicateConfirmed(false);
        setSimilar(null);setEditingId('');setRestrictionCodes([]);setClusterOptions([]);setRegistration({supplyType:'BIDDED',partyEntryMode:'none'});setUomCategory('');setError('');setTried({});setShowAttrErrors(false);
        lastDetailedMaterial.current='';
        setCategory('');setSubcategory('');setFamily('');setMaterial('');setDetail(null);setName('');setValues({});
        reloadMaterialMaster(); // Resolve the latest published Materials Master when starting a new item.
    };
    const fail = (step: number, message: string) => { setTried((t) => ({ ...t, [step]: true })); setError(message); };
    const next1 = () => {
        if(!hierarchy.complete)return fail(1,hierarchy.selectionIssue||'Select category, subcategory, family and material from the active Materials Master.');
        if (!detail) return fail(1, 'Wait for the selected material attributes to load from the active Materials Master.');
        if (!name.trim()) return fail(1, 'Enter the material name.');
        const issues = attributeIssues(detail.attributes, values);
        if (issues.length) {
            setShowAttrErrors(true);
            return fail(1, issues.length + ' attribute' + (issues.length === 1 ? ' needs' : 's need') + ' attention: ' + issues.slice(0, 3).map((x) => x.a.name).join(', ') + (issues.length > 3 ? '…' : ''));
        }
        go(2);
    };
    const next2 = () => {
        if (stage2Issues.length) return fail(2, stage2Issues[0]);
        if (duplicateBlocked) return setError('This material already exists with the same part number. Extend the existing material instead.');
        if (liveChecking) return setError('Still checking for similar materials — try again in a moment.');
        go(3);
    };
    const next3 = () => {
        if (stage3Issues.length) return fail(3, stage3Issues[0]);
        if (!complete) return setError([...stage1Issues, ...stage2Issues][0] ?? 'Complete the earlier steps first.');
        if (duplicateBlocked || liveChecking) return setError(duplicateBlocked ? 'Repeat material — extend the existing material instead.' : 'Still checking for similar materials — try again in a moment.');
        setReviewAgreed(false); setSimilar(null); go(4);
    };
    const next4 = () => {
        if (!reviewAgreed) return setError('Tick the confirmation that you have reviewed the details.');
        void checkSimilar();
    };
    const steps: WizardStep[] = [
        { label: 'Classify & describe', open: stage1Issues.length },
        { label: 'Sourcing', open: stage2Issues.length },
        { label: 'Warehouse', open: stage3Issues.length },
        { label: 'Review', open: reviewAgreed ? 0 : 1 },
        { label: 'Duplicate check', open: duplicateConfirmed ? 0 : 1 },
    ];
    const back = stage > 1 ? <Button variant='secondary' className='flex-1 sm:flex-none' onClick={() => go(stage === 5 ? 4 : stage - 1)}><ArrowLeft className='h-4 w-4' /> Back</Button> : null;
    const canSubmitEditing= !editingId || !!records?.items.find(m=>m.id===editingId)?.canSubmit;
    const draftAction=<Button testOverride={testOverride} variant='secondary' className='flex-1 sm:flex-none' busy={saving}
        disabled={saving||!hierarchy.complete} onClick={()=>void save(false)}>
        <Save className='h-4 w-4'/> Save draft
    </Button>;
    const actions = stage === 1 ? <>{draftAction}<Button className='flex-1 sm:ml-auto sm:flex-none' disabled={loadingDetail} onClick={next1}>Continue <ArrowRight className='h-4 w-4' /></Button></>
        : stage === 2 ? <>{back}{draftAction}<Button className='flex-[2] sm:ml-auto sm:flex-none' onClick={next2}>Continue <ArrowRight className='h-4 w-4' /></Button></>
        : stage === 3 ? <>{back}{draftAction}<Button className='flex-[2] sm:flex-none' onClick={next3}>Review <ArrowRight className='h-4 w-4' /></Button></>
        : stage === 4 ? <>{back}{draftAction}<Button className='flex-[2] sm:ml-auto sm:flex-none' busy={similarLoading} disabled={!complete || similarLoading || duplicateBlocked || liveChecking} onClick={next4}>Check duplicates <ArrowRight className='h-4 w-4' /></Button></>
        : <>{back}{draftAction}<Button testOverride={testOverride} className='flex-[2] sm:ml-auto sm:flex-none' busy={saving} disabled={!canSubmitEditing || !complete || !similar || !duplicateConfirmed || saving || duplicateBlocked || liveChecking} onClick={() => save(true)}><Send className='h-4 w-4' /> Submit for approval</Button></>;
    const restrictionLabels=restrictionCodes.map(code=>{
        const r=options?.restrictions.find(x=>x.code===code);return r?r.label+' ('+r.code+')':code;
    });
    const extensionPanel=extendSource&&<StepSection title='Extend organization material' hint='Source: Organization Materials Master (not the MEMS Admin catalogue). Warehouse extension is governed by PRC-002.'>
        <p className='mb-3 break-words text-sm font-semibold text-ink'>{extendSource.name}
            <span className='block text-xs font-normal text-muted'>{extendSource.materialNumber||extendSource.id} · {extendSource.shortText}</span>
        </p>
        {extensionTargets.length===0&&<Alert tone='warn'>No eligible warehouses are available for extension. The material may already be mapped, an extension may be pending, or the warehouse category may not be configured.</Alert>}
        <SelectField id='mm-extend-wh' label='Target warehouse' required value={extendWarehouse}
            onChange={e=>{setExtendWarehouse(e.target.value);setExtendVerified(false);}}>
            <option value=''>Select accessible warehouse</option>
            {extensionTargets.map(w=><option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
        </SelectField>
        <div className='mt-3'><ConfirmBox checked={extendVerified} onChange={setExtendVerified}>
            I verified this existing approved material, its classification and the target warehouse. No duplicate extension should be created.
        </ConfirmBox></div>
        <div className='mt-4 flex flex-wrap gap-2'>
            <Button variant='secondary' className='flex-1 sm:flex-none' onClick={()=>setExtendSource(null)}>Cancel</Button>
            <Button testOverride={testOverride} className='flex-[2] sm:flex-none' disabled={!extendWarehouse||!extendVerified||extendBusy} busy={extendBusy}
                onClick={async()=>{setExtendBusy(true);setError('');try{
                    await callBackend(endpoint+'/extension',{sourceId:extendSource.id,warehouseId:extendWarehouse});
                    setExtendSource(null);setExtendSearchOpen(false);setAdding(false);reloadExtensions();reload();
                }catch(e){setError(e instanceof Error?e.message:'Material extension request failed.');}
                finally{setExtendBusy(false);}}}>Submit extension through PRC-002 workflow</Button>
        </div>
    </StepSection>;

    const wizard = <div className='space-y-4 pb-10'>
        <div ref={topRef} className='scroll-mt-[var(--mems-top,0px)]' />
        <WizardBar title={editingId ? 'Edit material' : 'New material'} steps={steps} stage={stage} onStep={go} onClose={() => setAdding(false)}
            status={autoStatus || (liveChecking ? 'Checking duplicates…' : '')} actions={actions} error={error}
            blocked={duplicateBlocked ? 'Repeat material — same part number and over 90% similar. Extend the existing material below instead of creating a new one.' : undefined} />

        {duplicateBlocked && <StepSection title='Existing material found' hint='Creating it again is blocked. Extend the existing material to your warehouse.'>
            <div className='space-y-2'>{hardDuplicates.map((x) => <MatchCard key={x.id} score={x.score} name={x.name} shortText={x.shortText} status={x.status}
                action={<Button disabled={!['approved','active'].includes(x.status)} onClick={()=>openExtension(x)}>{['approved','active'].includes(x.status)?'Extend this material':'Awaiting approval'}</Button>} />)}</div>
        </StepSection>}
        {!duplicateBlocked && !!liveMatches.length && <details key={stage === 1 ? 'open' : 'folded'} open={stage === 1} className='rounded-2xl border border-amber-400/50 bg-amber-400/5 p-3'>
            <summary className='cursor-pointer text-sm font-semibold text-amber-400'>{liveMatches.length === 1 ? '1 very similar material already exists' : liveMatches.length + ' very similar materials already exist'} — check before continuing</summary>
            <div className='mt-3 max-h-[40dvh] space-y-2 overflow-y-auto overscroll-contain'>{liveMatches.map((x) => <MatchCard key={x.id} score={x.score} name={x.name} shortText={x.shortText} status={x.status}
                action={<Button variant='secondary' disabled={!['approved','active'].includes(x.status)} onClick={()=>openExtension(x)}>{['approved','active'].includes(x.status)?'Extend instead':'Not yet approved'}</Button>} />)}</div>
        </details>}
        {extensionPanel}

        {stage === 1 && (treeLoading ? <Spinner /> : treeError || !tree ? <Alert tone='error'>{treeError || 'The material reference catalogue is not available. An administrator must load it first.'}</Alert> : <>
            <StepSection title='Find it in the Materials Master' hint='Choose the category, subcategory, family and material from the active MEMS PRC Materials Master. Every industry is included.'
                aside={<button type='button' onClick={()=>reloadMaterialMaster()}
                    className='shrink-0 rounded-lg border border-line px-2 py-1.5 text-xs text-soft active:bg-page'>
                    Refresh master
                </button>}>
                <p className='mb-3 text-xs text-muted'>Active Materials Master {tree?.version||'—'} · {categories.length} categories · {tree?.categories?.length??0} subcategories · {tree?.subcategories?.length??0} families · {tree?.classes?.length??0} materials. No industry-based exclusions.</p>
                {hierarchy.selectionIssue&&<Alert tone='error'>{hierarchy.selectionIssue} Refresh the master if it has recently changed; your draft has not been deleted.</Alert>}
                <div className='grid gap-4 sm:grid-cols-2'>
                    <SelectField id='mm-category' label='Material category' required value={category} error={fieldError(1, !hierarchy.validCategory, 'Choose a category from the Materials Master.')} onChange={(e) => { setCategory(e.target.value); setSubcategory(''); setFamily(''); setMaterial(''); setDetail(null);setValues({});lastDetailedMaterial.current=''; }}>
                        <option value=''>Select category</option>{categories.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                    </SelectField>
                    <SelectField id='mm-subcategory' label='Material subcategory' required disabled={!hierarchy.validCategory} value={subcategory} error={fieldError(1, !!category && !hierarchy.validSubcategory, 'Choose a subcategory from this category.')} onChange={(e) => { setSubcategory(e.target.value); setFamily(''); setMaterial('');setDetail(null);setValues({});lastDetailedMaterial.current=''; }}>
                        <option value=''>Select subcategory</option>{subcategories.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                    </SelectField>
                    <SelectField id='mm-family' label='Material family' required disabled={!hierarchy.validSubcategory} value={family} error={fieldError(1, !!subcategory && !hierarchy.validFamily, 'Choose a family from this subcategory.')} onChange={(e) => { setFamily(e.target.value); setMaterial('');setDetail(null);setValues({});lastDetailedMaterial.current=''; }}>
                        <option value=''>Select family</option>{families.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                    </SelectField>
                    <SelectField id='mm-material' label='Material type' required disabled={!hierarchy.validFamily} value={material} error={fieldError(1, !!family && !hierarchy.validMaterial, 'Choose the material from this family.')} onChange={(e) => {setMaterial(e.target.value);setDetail(null);setValues({});lastDetailedMaterial.current='';}}>
                        <option value=''>Select material</option>{materials.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                    </SelectField>
                </div>
            </StepSection>
            {loadingDetail && <Spinner />}
            {detail && <>
                <StepSection title='Name and short text' hint='Use the name people search for. The short text is built from the name, the key attributes and the part number.'>
                    <Field id='mm-name' label='Material name *' value={name} maxLength={160} onChange={(e) => setName(e.target.value)} error={fieldError(1, !name.trim(), 'Enter the material name.')} hint={`${name.length}/160`} />
                    <div className='mt-3'><ShortTextPreview text={shortText} /></div>
                </StepSection>
                <StepSection title='Technical attributes from Materials Master' hint='The selected material determines every technical attribute, option, requirement and validation rule. Fill required attributes first; optional details are available below.'>
                    <CatalogueAttributeForm attributes={detail.attributes} values={values} onChange={(code, v) => setValues((p) => ({ ...p, [code]: v }))} guidance={detail.guidance} showErrors={showAttrErrors} />
                </StepSection>
                {detail.financial && <details className='rounded-2xl border border-line bg-panel p-4'>
                    <summary className='cursor-pointer text-sm font-semibold text-ink'>Accounting reference <span className='font-normal text-muted'>· read only</span></summary>
                    <p className='mt-2 text-xs text-muted'>The actual GL account is chosen from the legal-entity policy and the receiving or consuming transaction.</p>
                    <dl className='mt-3 grid grid-cols-2 gap-2 text-xs'>
                        {[['Material branch', detail.financial.majorBranch], ['Stores category', detail.financial.storesClassCode], ['GL mapping', detail.financial.mappingStatus], ['Account determination', detail.financial.determinationMode]].map(([k, v]) => <div key={k} className='rounded-lg bg-page p-2'><dt className='text-muted'>{k}</dt><dd className='break-words font-semibold text-ink'>{v || 'Not configured'}</dd></div>)}
                    </dl>
                    {!!detail.financial.routes?.length && <ul className='mt-2 space-y-1'>{detail.financial.routes.map((r, i) => <li key={i} className='break-words text-xs text-soft'><span className='text-muted'>{r.event}:</span> <strong className='font-mono'>{r.glCode}</strong> {r.glName} <span className='text-amber-400'>({r.status})</span></li>)}</ul>}
                </details>}
            </>}
        </>)}

        {stage === 2 && <>
            <StepSection title='Unit of measure' hint='The unit the material is stocked, issued and ordered in.'>
                <div className='grid gap-4 sm:grid-cols-2'>
                    <SelectField id='mm-uom-cat' label='Unit category' required value={uomCategory} error={fieldError(2, !uomCategory, 'Choose a unit category.')} onChange={(e) => { setUomCategory(e.target.value); setRegistration((p) => ({ ...p, uom: '' })); }}>
                        <option value=''>Select unit category</option>{[...new Set((options?.uoms ?? []).map((x) => x.category || 'Other'))].sort().map((c) => <option key={c} value={c}>{c}</option>)}
                    </SelectField>
                    <SelectField id='mm-uom' label='Unit of measure' required disabled={!uomCategory} value={registration.uom ?? ''} error={fieldError(2, !uomsInCategory.some((x) => x.code === registration.uom), 'Choose the unit.')} onChange={(e) => setRegistration((p) => ({ ...p, uom: e.target.value }))}>
                        <option value=''>Select unit</option>{uomsInCategory.map((x) => <option key={x.code} value={x.code}>{x.label} ({x.code})</option>)}
                    </SelectField>
                </div>
            </StepSection>
            <StepSection title='How will this material be sourced?' hint={supply==='PROPRIETARY_SUPPLIER'?'The proprietary part number is optional; no supplier setup or disclosure is required.':supply==='BIDDED'?'Use competitive bidding. No supplier is recommended at material creation.':detail?.guidance?.supply ? `${detail.guidance.label}: usual supply route: ${detail.guidance.supply.usual.map((u) => SUPPLY_WORD[u] ?? u).join(' or ')}. ${detail.guidance.supply.note}` : 'Choose the supply relationship.'}>
                <div role='radiogroup' aria-label='Supply type' className='grid gap-2 sm:grid-cols-2'>
                    {SUPPLY_TYPES.map((t) => <OptionCard key={t.code} selected={supply === t.code} title={t.title} text={t.text} badge={!['BIDDED','PROPRIETARY_SUPPLIER'].includes(t.code)&&detail?.guidance?.supply?.usual.includes(t.code) ? 'usual' : undefined}
                        onSelect={() => setRegistration((p) => ({ ...p, supplyType: t.code, partyEntryMode: ['BIDDED','PROPRIETARY_SUPPLIER'].includes(t.code) ? 'none' : 'registered', vendorId: '', partyName: '', oemPartNumber: '', ocmPartNumber: '', generalPartNumber: '', proprietaryPartNumber: '', model: '', versionNumber: '', costCenterId: '', assetId: '', assemblyId: '', assemblyIds: '' }))} />)}
                </div>
                {supply==='BIDDED'?<Alert tone='info'>No supplier is nominated or recommended for a bidded material. A supplier will be selected later through approved procurement and competitive bidding.</Alert>:supply==='PROPRIETARY_SUPPLIER'?
                    <Field id='mm-proprietary-part' label='Proprietary part number (optional)' maxLength={160} value={registration.proprietaryPartNumber??''} autoComplete='off' spellCheck={false}
                        hint='Reference only. No supplier, OEM/OCM number, equipment or other sourcing fields are needed.'
                        onChange={(e)=>setRegistration((p)=>({...p,proprietaryPartNumber:e.target.value}))}/> :
                <div className='mt-4 space-y-4'>
                    <Tabs value={mode as 'registered' | 'manual'} onChange={(v) => setRegistration((p) => ({ ...p, partyEntryMode: v, vendorId: '', partyName: '' }))}
                        options={[{ value: 'registered', label: 'Registered vendor' }, { value: 'manual', label: 'Type the name' }]} />
                    <div className='grid gap-4 sm:grid-cols-2'>
                        {mode === 'manual'
                            ? <Field id='mm-party' label={`${partyLabel} name *`} maxLength={160} value={registration.partyName ?? ''} placeholder='Full registered name' onChange={(e) => setRegistration((p) => ({ ...p, partyName: e.target.value }))} error={fieldError(2, (registration.partyName ?? '').trim().length < 2, 'Enter at least 2 characters.')} />
                            : <SelectField id='mm-vendor' label={supply === 'GENERAL' ? 'Registered supplier' : `Registered ${partyLabel}`} required value={registration.vendorId ?? ''} error={fieldError(2, !registration.vendorId, 'Choose a vendor or type the name instead.')} onChange={(e) => setRegistration((p) => ({ ...p, vendorId: e.target.value }))}>
                                <option value=''>Choose existing vendor</option>{(options?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </SelectField>}
                        <Field id='mm-part' label={`${partLabel} *`} value={registration[partKey] ?? ''} autoComplete='off' spellCheck={false}
                            hint={`${SUPPLY_TYPES.find((t) => t.code === supply)?.part}. Copy it exactly, including dashes.`}
                            error={fieldError(2, !registration[partKey]?.trim(), 'Enter the part number.')}
                            onChange={(e) => setRegistration((p) => ({ ...p, [partKey]: e.target.value }))} />
                        {['OEM', 'OCM'].includes(supply) && <>
                            <Field id='mm-model' label='Model' value={registration.model ?? ''} maxLength={80} onChange={(e) => setRegistration((p) => ({ ...p, model: e.target.value }))} />
                            <Field id='mm-version' label='Version' value={registration.versionNumber ?? ''} maxLength={40} onChange={(e) => setRegistration((p) => ({ ...p, versionNumber: e.target.value }))} />
                        </>}
                    </div>
                </div>}
            </StepSection>
            {supply === 'OEM' && <StepSection title='Where it is used' hint='OEM parts belong to a machine. Choose the asset; add assemblies if the part fits only some of them.'>
                <div className='grid gap-4 sm:grid-cols-2'>
                    <SelectField id='mm-cc' label='Cost center' required value={registration.costCenterId ?? ''} error={fieldError(2, !(options?.costCenters ?? []).some((x) => x.id === registration.costCenterId), 'Choose a cost center.')} onChange={(e) => setRegistration((p) => ({ ...p, costCenterId: e.target.value, assetId: '', assemblyId: '', assemblyIds: '' }))}>
                        <option value=''>Select accessible cost center</option>{(options?.costCenters ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
                    </SelectField>
                    <SelectField id='mm-asset' label='Asset' required disabled={!registration.costCenterId} value={registration.assetId ?? ''} error={fieldError(2, !!registration.costCenterId && !(options?.assets ?? []).some((x) => x.id === registration.assetId && x.parentId === registration.costCenterId), 'Choose an asset in this cost center.')} onChange={(e) => setRegistration((p) => ({ ...p, assetId: e.target.value, assemblyId: '', assemblyIds: '' }))}>
                        <option value=''>Select asset</option>{(options?.assets ?? []).filter((x) => x.parentId === registration.costCenterId).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
                    </SelectField>
                </div>
                {registration.assetId && <div className='mt-4'>
                    <p className='mb-2 text-sm text-soft'>Assemblies <span className='text-xs text-muted'>· optional, choose any</span></p>
                    <div className='grid gap-2 sm:grid-cols-2'>
                        {(options?.scopedAssemblies ?? []).filter((x) => x.parentId === registration.assetId).map((x) => <ChoiceChip key={x.id} checked={selectedAssemblies.includes(x.id)}
                            onToggle={() => setRegistration((p) => { const current = (p.assemblyIds ?? '').split(',').filter(Boolean); return { ...p, assemblyId: '', assemblyIds: (current.includes(x.id) ? current.filter((id) => id !== x.id) : [...current, x.id]).join(',') }; })}>{x.name}</ChoiceChip>)}
                    </div>
                    <p className='mt-2 text-xs text-muted'>{selectedAssemblies.length ? `${selectedAssemblies.length} selected` : 'None selected: the material applies to the whole asset.'}</p>
                </div>}
            </StepSection>}
        </>}

        {stage === 3 && <StepSection title='Warehouse and storage restrictions' hint='Choose the warehouse, select all required restrictions, then select a matching cluster if one exists.'>
            {!(options?.warehouses??[]).length&&<Alert tone='warn'>No accessible warehouses are configured. Contact your administrator.</Alert>}
            <SelectField id='mm-wh' label='Warehouse' required value={registration.warehouseId??''}
                error={fieldError(3,!eligibleWarehouses.some(x=>x.id===registration.warehouseId),'Choose a warehouse configured for this category.')}
                onChange={e=>{setRegistration(p=>({...p,warehouseId:e.target.value,clusterCode:''}));setClusterOptions([]);setReviewAgreed(false);}}>
                <option value=''>Select accessible warehouse</option>
                {eligibleWarehouses.map(w=><option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </SelectField>
            <div className='mt-4 space-y-2'>
                <p className='text-sm font-semibold text-ink'>Warehouse restrictions * · select multiple</p>
                <p className='text-xs text-muted'>All selected restrictions must be permitted by the chosen cluster. Selecting a cluster automatically adopts its complete restriction list.</p>
                <div className='max-h-60 space-y-1 overflow-y-auto rounded-xl border border-line p-2'>
                    {(options?.restrictions??[]).map(r=><label key={r.code} className='flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-ink'>
                        <input type='checkbox' checked={restrictionCodes.includes(r.code)} disabled={!registration.warehouseId}
                            onChange={()=>toggleRestriction(r.code)}/>
                        <span>{r.label} ({r.code})</span>
                    </label>)}
                </div>
                {restrictionCodes.length>0&&<p className='text-xs text-soft'>Selected: {restrictionLabels.join(' · ')}</p>}
            </div>
            {!!registration.warehouseId&&!!subcategory&&<div className='mt-4 space-y-3 rounded-xl border border-line p-3'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <h3 className='font-semibold text-ink'>Matching warehouse clusters</h3>
                    <button type='button' className='rounded-lg border border-line px-3 py-2 text-xs text-ink'
                        onClick={()=>setShowAllClusters(p=>!p)}>{showAllClusters?'Hide other clusters':'View all existing clusters'}</button>
                </div>
                {clustersLoading?<p className='text-xs text-soft'>Checking cluster compatibility…</p>:
                    clustersError?<Alert tone='error'>{clustersError}</Alert>:
                    matchingClusters.length===0?<Alert tone='warn'>No matching clusters in this warehouse for the selected subcategory and restrictions. Select an eligible cluster below to adopt its restrictions, or create another cluster.</Alert>:
                    <p className='text-xs text-soft'>{matchingClusters.length} compatible cluster(s) found.</p>}
                {clusterOptions.filter(c=>showAllClusters||c.adoptable||c.code===registration.clusterCode)
                    .map(c=><button type='button' key={c.code}
                        aria-pressed={registration.clusterCode===c.code}
                        disabled={!c.adoptable||!!applyingCluster||saving}
                        className={`block w-full rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-70 ${registration.clusterCode===c.code?'border-emerald-600 bg-emerald-50/50':'border-line bg-panel'}`}
                        onClick={()=>void selectCluster(c)}>
                        <span className='block font-semibold text-ink'>{c.code} · {c.name}</span>
                        <span className='block text-xs text-soft'>{c.locationName} · Material subcategories: {c.subcategoryCodes.join(', ')||'None'}</span>
                        <span className='mt-1 block text-xs text-soft'>Existing restrictions: {c.restrictionCodes.map((v,i)=>c.restrictionLabels[i]+' ('+v+')').join(' · ')||'None'}</span>
                        {!c.compatible&&<span className='mt-1 block text-xs text-amber-700'>{c.reason}</span>}
                        <span className='mt-2 block text-sm font-semibold text-ink'>
                            {applyingCluster===c.code?'Applying cluster…':registration.clusterCode===c.code?'Selected — saves with material draft':
                                !c.adoptable?'Not eligible for this material':
                                c.requiresSubcategoryExtension?'Tap to add this subcategory, adopt restrictions and apply cluster':
                                'Tap to adopt restrictions and apply cluster'}
                        </span>
                    </button>)}
                {registration.clusterCode&&<p className='text-xs text-soft'>Material will be associated with cluster {registration.clusterCode} when the draft is saved. Physical stock and bin allocation still require material approval.</p>}
                {!registration.clusterCode&&restrictionCodes.length>0&&!clustersLoading&&
                    <div className='rounded-xl border border-dashed border-line p-3'>
                        <p className='text-sm font-semibold text-ink'>Create a matching cluster?</p>
                        <p className='text-xs text-soft'>{matchingClusters.length?'Existing matches are available above, but you may create a separate cluster. ':'No matching cluster is configured. '}Save this material as a draft and open cluster configuration with the subcategory and restrictions prefilled.</p>
                        <Button variant='secondary' busy={saving} disabled={saving||!hierarchy.complete}
                            onClick={()=>void saveDraftAndCreateCluster()}>Save draft & create cluster</Button>
                    </div>}
                {!registration.clusterCode&&matchingClusters.length>0&&<p className='text-xs text-soft'>You may select an existing cluster or save a draft without assigning one.</p>}
            </div>}
            <div className='mt-4'><ShortTextPreview text={shortText}/></div>
        </StepSection>}

        {stage === 4 && <>
            <ShortTextPreview text={shortText} />
            <ReviewSection title='Classification' onEdit={() => go(1)} items={[['Category', categories.find((x) => x.code === category)?.name], ['Subcategory', subcategories.find((x) => x.code === subcategory)?.name], ['Family', families.find((x) => x.code === family)?.name], ['Catalogue material', materials.find((x) => x.code === material)?.name], ['Material name', name]]} />
            <ReviewSection title='Technical attributes' onEdit={() => go(1)} items={(detail?.attributes ?? []).filter((x) => values[x.code]).map((x) => [x.name, shownValue(x, values[x.code])] as [string, string])} />
            <ReviewSection title='Sourcing' onEdit={() => go(2)} items={[['Unit', options?.uoms.find((x) => x.code === registration.uom)?.label ?? registration.uom], ['Supply type', SUPPLY_TYPES.find((t) => t.code === supply)?.title],
                ...(supply==='BIDDED'?[['Supplier','Not nominated — competitive bidding'] as [string,string]]:supply==='PROPRIETARY_SUPPLIER'?[['Supplier','Proprietary — no details required'] as [string,string],['Proprietary part number',registration.proprietaryPartNumber||'Not provided'] as [string,string]]:[[partyLabel,partyName] as [string,string],['Part number',registration[partKey]] as [string,string]]), ['Model', registration.model], ['Version', registration.versionNumber], ['Cost center', options?.costCenters.find((x) => x.id === registration.costCenterId)?.name], ['Asset', options?.assets.find((x) => x.id === registration.assetId)?.name], ['Assemblies', supply === 'OEM' ? (options?.scopedAssemblies ?? []).filter((x) => selectedAssemblies.includes(x.id)).map((x) => x.name).join(', ') || 'Whole asset' : '']]} />
            <ReviewSection title='Warehouse' onEdit={() => go(3)} items={[['Warehouse', options?.warehouses.find((x) => x.id === registration.warehouseId)?.name], ['Restrictions',restrictionLabels.join(' · ')],['Cluster',registration.clusterCode||'Not assigned']]} />
            <ConfirmBox checked={reviewAgreed} onChange={setReviewAgreed}>I have reviewed the short text, classification, attributes, sourcing and warehouse details and confirm they are correct.</ConfirmBox>
        </>}

        {stage === 5 && <StepSection title='Duplicate check' hint='The closest existing materials (approved and pending) across all warehouses. Percentages are weighted indicators, not proof that parts are interchangeable.'>
            {similar ? <>
                <p className='mb-3 text-xs text-muted'>Compared against {similar.totalCompared} existing materials.</p>
                {similar.items.filter(x=>x.score>85).length ? <div className='max-h-[55dvh] space-y-2 overflow-y-auto overscroll-contain pr-1'>{similar.items.filter(x=>x.score>85).map((x) => <MatchCard key={x.id} score={x.score} name={x.name} shortText={x.shortText} status={x.status}
                    meta={<>{options?.warehouses.find((w) => w.id === x.warehouseId)?.name ?? x.warehouseId} · {x.matchedFields.join(', ') || 'no hierarchy match'} · attributes {x.attributeMatches}/{x.attributeTotal}{x.partMatch ? ' · part number match' : ''}</>}
                    action={<Button variant='secondary' disabled={!['approved','active'].includes(x.status)}
                        onClick={()=>openExtension(x)}>{['approved','active'].includes(x.status)?'Extend existing':'Not yet approved'}</Button>} />)}</div>
                    : <Alert tone='success'>No materials with similarity above 85% found.</Alert>}
                <div className='mt-4'><ConfirmBox checked={duplicateConfirmed} onChange={setDuplicateConfirmed}>I have reviewed the closest materials, verified this request is not a duplicate, and confirm submission.</ConfirmBox></div>
            </> : <Spinner />}
        </StepSection>}

        {stage <= 3 && <OpenItems issues={stage === 1 ? stage1Issues : stage === 2 ? stage2Issues : stage3Issues} />}
    </div>;

    if (adding) return wizard;
    if (reviewMaterial) return <MaterialMasterDashboard
        id={reviewMaterial.id}
        onBack={()=>{setReviewMaterial(null);reload();reloadExtensions();}}
        onChanged={()=>{reload();reloadExtensions();}}
        onEdit={id=>{const m=records?.items.find(x=>x.id===id);if(m){editDraft(m);setReviewMaterial(null);}}}
        onExtend={id=>{const m=records?.items.find(x=>x.id===id);if(m){openExtension(m);setExtendSearchOpen(true);setReviewMaterial(null);}}}
    />;
    return <div className='space-y-4'>
        <PageTitle title='Materials Master' subtitle='Create and manage organization materials. Extend existing approved organization materials without creating a new catalogue entry.'
            action={<div className='flex flex-wrap gap-2'>
                {records?.canExtend&&<Button testOverride={testOverride} variant='secondary' onClick={()=>{setExtendSearchOpen(p=>!p);setExtendSource(null);setError('');}}>
                    Extend existing
                </Button>}
                {records?.canCreate&&<Button testOverride={testOverride} onClick={startNew}><Plus className='h-4 w-4'/>Add material</Button>}
            </div>}/>
        {error && <Alert tone='error'>{error}</Alert>}
        {extendSearchOpen&&<Card className='space-y-3'>
            <h2 className='font-semibold text-ink'>Extend from Organization Materials Master</h2>
            <p className='text-xs text-muted'>Search existing approved materials across this organization by material number, name, description, category or family. This is the organization's materials database, not the MEMS Admin catalogue.</p>
            <Field id='org-material-search' label='Search organization materials' value={extendSearch}
                placeholder='Material number, material name or family' onChange={e=>setExtendSearch(e.target.value)}/>
            <p className='text-xs text-muted'>{extensionSearchResults.length} matching approved material(s) shown</p>
            <div className='max-h-[50dvh] space-y-2 overflow-y-auto overscroll-contain'>
                {extensionSearchResults.map(m=><div key={m.id}
                    className='flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3'>
                    <div className='min-w-0 flex-1'>
                        <p className='text-sm font-semibold text-ink'>{m.name}</p>
                        <p className='text-xs text-soft'>{m.materialNumber||m.id} · {m.shortText||m.familyCode}</p>
                        <p className='text-xs text-soft'>Current warehouses: {[m.warehouseId,...(m.warehouseIds??[])].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).length}</p>
                    </div>
                    <Button testOverride={testOverride} variant='secondary' onClick={()=>openExtension(m)}>Extend</Button>
                </div>)}
                {!extensionSearchResults.length&&<Alert tone='info'>No approved organization material matches this search. A material must be approved before it can be extended.</Alert>}
            </div>
        </Card>}
        {extensionPanel}
        {recordsLoading?<Spinner/>:<Card><div className='-mx-1 mb-4 flex gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 sm:flex-wrap'>{([{key:'my_approvals',label:'Awaiting My Approval',count:(records?.items??[]).filter(m=>m.canApprove).length,show:!!records?.isApprover},{key:'my_requests',label:'My Submitted Requests',count:(records?.items??[]).filter(m=>m.submittedBy===records?.currentUserId&&m.status==='pending_approval').length,show:true},{key:'my_drafts',label:'Drafts I Can Manage',count:(records?.items??[]).filter(m=>m.status==='draft'&&(m.canEdit||m.canDelete||m.canSubmit)).length,show:true},{key:'approved',label:'Approved Materials',count:(records?.items??[]).filter(m=>['approved','active','disabled'].includes(m.status??'')).length,show:true},{key:'other_requests',label:'Other Pending Requests',count:(records?.items??[]).filter(m=>m.status==='pending_approval'&&m.submittedBy!==records?.currentUserId&&!m.canApprove).length,show:true}] as const).filter(t=>t.show).map(t=><button type='button' key={t.key} onClick={()=>setListView(t.key)} className={'min-h-11 shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium border '+(listView===t.key?'bg-brand/15 text-ink border-brand':'bg-page text-soft border-line')}>{t.label} <span className='ml-1 rounded-full bg-slate-700 px-2 py-0.5 text-xs'>{t.count}</span></button>)}</div><div className='flex flex-wrap items-center justify-between gap-2 mb-3'><h2 className='font-semibold text-white'>{({my_approvals:'Awaiting My Approval',my_requests:'My Submitted Requests',my_drafts:'Drafts I Can Manage',approved:'Approved Materials',other_requests:'Other Pending Requests'} as Record<string,string>)[listView]}</h2></div><RichTable<SavedMaterial> id={'materials-'+listView} title={({my_approvals:'Awaiting My Approval',my_requests:'My Submitted Requests',my_drafts:'Drafts I Can Manage',approved:'Approved Materials',other_requests:'Other Pending Requests'} as Record<string,string>)[listView]} fileName={'materials_'+listView} rows={(records?.items??[]).filter(m=>listView==='my_approvals'?m.canApprove:listView==='my_requests'?m.submittedBy===records?.currentUserId&&m.status==='pending_approval':listView==='my_drafts'?m.status==='draft'&&(m.canEdit||m.canDelete||m.canSubmit):listView==='approved'?['approved','active','disabled'].includes(m.status??''):m.status==='pending_approval'&&m.submittedBy!==records?.currentUserId&&!m.canApprove)} rowKey={m=>m.id} onRowClick={setReviewMaterial} empty='No materials in this view.' columns={[{key:'material',label:'Material / Short Text',value:m=>m.name+' '+(m.shortText??''),render:m=><span className='block min-w-[12rem] max-w-[18rem] whitespace-normal'><span className='block font-semibold text-white'>{m.name}</span><span className='block text-xs text-slate-400 line-clamp-2'>{m.shortText}</span></span>},{key:'reference',label:'Reference',value:m=>(m.masterDataId||m.id)+' '+(m.materialCode??''),render:m=><span className='block font-mono text-xs'>{m.masterDataId||m.id}<span className='block text-slate-400'>{m.masterDataId?'Request '+m.id+' · ':''}{m.materialCode}</span></span>},{key:'parts',label:'Part numbers',hidden:true,value:m=>[m.oemPartNumber,m.ocmPartNumber,m.generalPartNumber].filter(Boolean).join(', ')},{key:'category',label:'Category / Family',value:m=>m.categoryCode+' '+(m.familyCode??''),render:m=><span className='block'>{m.categoryCode}<span className='block text-xs text-slate-400'>{m.familyCode}</span></span>},{key:'warehouse',label:'Warehouse',value:m=>options?.warehouses.find(w=>w.id===m.warehouseId)?.name??m.warehouseId??'—'},{key:'status',label:'Status',value:m=>(m.status??'draft').replaceAll('_',' '),render:m=><span className='rounded-full bg-slate-800 px-2 py-1 text-xs'>{(m.status??'draft').replaceAll('_',' ')}</span>},{key:'submitted',label:'Submitted',type:'date',value:m=>m.createdAt??'',render:m=>m.createdAt?new Date(m.createdAt).toLocaleDateString():'—'},{key:'approval',label:'Workflow stage',value:m=>m.status==='pending_approval'?(m.workflowStage||'Workflow assignment required'):'—'},]}/></Card>}
    </div>;
}
