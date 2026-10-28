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

/** Plain explanation of the three supply relationships (MRO). */
const SUPPLY_TYPES: Array<{ code: 'OEM' | 'OCM' | 'GENERAL'; title: string; text: string; part: string }> = [
    { code: 'OEM', title: 'OEM — machine maker', text: 'The company that built the machine (e.g. Krones, Tetra Pak, Atlas Copco). Use for parts designed only for that machine: impellers, castings, special boards. Usually the most expensive and the only source.', part: 'OEM part number from the machine parts list or manual' },
    { code: 'OCM', title: 'OCM — component maker', text: 'The company that made the component inside the machine (e.g. SKF bearing in a pump, Siemens motor on a conveyor). Same part, often much cheaper and easier to get than through the OEM.', part: 'Component maker’s part number (printed on the part)' },
    { code: 'GENERAL', title: 'General supplier', text: 'Standard items any stockist can supply to a size or standard: bolts, O-rings, pipe fittings, PPE, consumables.', part: 'Supplier or standard part number (e.g. ISO 4017 M12x50 8.8)' },
];

type SavedMaterial = { canApprove?:boolean;createdBy?:string;submittedBy?:string;warehouseId?:string;approvalLevel?:number;uom?:string;oemPartNumber?:string;ocmPartNumber?:string;generalPartNumber?:string; id: string; name: string; shortText: string; categoryCode: string; subcategoryCode: string; familyCode: string; materialCode: string; createdAt: string; status?:string; attributes?:Record<string,string>; assemblyIds?:string[]; supplyType?:string;materialNumber?:string;pushedAt?:string;warehouseIds?:string[] };
const treeApi = '/api/org/procurement/catalog/tree';
const itemApi = '/api/org/procurement/catalog/item';
const endpoint = '/api/org/procurement/materials';

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
const SUPPLY_WORD: Record<string, string> = { OEM: 'the machine maker (OEM)', OCM: 'the component maker (OCM)', GENERAL: 'a general supplier' };

export default function MaterialsMaster() {
    const { data: tree, loading: treeLoading, error: treeError } = useLoad(() => callBackend<DictTree>(treeApi, { kind: 'materials' }));
    const { data: records, loading: recordsLoading, reload } = useLoad(() => callBackend<{ items: SavedMaterial[];isApprover:boolean;currentUserId:string }>(endpoint + '/list'));
    const {data:options}=useLoad(()=>callBackend<{warehouses:Array<{id:string;name:string;code:string;categoryCodes:string[]}>;costCenters:Array<{id:string;name:string;code:string}>;assets:Array<{id:string;name:string;code:string;parentId:string}>;scopedAssemblies:Array<{id:string;name:string;parentId:string}>;uoms:Array<{code:string;label:string;category:string}>;classifications:Array<{code:string;label:string}>;restrictions:Array<{code:string;label:string;description:string}>;vendors:Array<{id:string;name:string}>;assemblies:Array<{id:string;name:string}>}>(endpoint+'/options'));
    const [uomCategory,setUomCategory]=useState('');
    const [adding, setAdding] = useState(false);
    const [stage,setStage]=useState(1);
    const [editingId,setEditingId]=useState('');
    const [registration,setRegistration]=useState<Record<string,string>>({supplyType:'GENERAL'});
    const [category, setCategory] = useState('');
    const [subcategory, setSubcategory] = useState('');
    const [family, setFamily] = useState('');
    const [material, setMaterial] = useState('');
    const [showAllIndustryMaterials,setShowAllIndustryMaterials]=useState(false);
    const [detail, setDetail] = useState<ClassDetail | null>(null);
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
    const [extendSource,setExtendSource]=useState<{id:string;name:string;shortText:string;status:string}|null>(null);
    const [extendWarehouse,setExtendWarehouse]=useState('');
    const [extendVerified,setExtendVerified]=useState(false);
    const [extendBusy,setExtendBusy]=useState(false);
    const {data:extensionRecords,reload:reloadExtensions}=useLoad(()=>callBackend<{items:Array<{id:string;sourceId:string;warehouseId:string;materialName:string;status:string;approvalLevel:number}>}>(endpoint+'/extensions'));
    const [reviewMaterial,setReviewMaterial]=useState<SavedMaterial|null>(null);const lifecycle=async(action:'allocate'|'push'|'disable'|'delete')=>{if(!reviewMaterial)return;if((action==='delete'||action==='disable'||action==='push')&&!(await appConfirm((action==='delete'?'Delete':action==='disable'?'Disable':'Push to requesting warehouse')+' material '+reviewMaterial.name+'?')))return;setSaving(true);setError('');try{const result=await callBackend<{ok:boolean;materialNumber?:string}>(endpoint+'/lifecycle',{id:reviewMaterial.id,action});setReviewMaterial(p=>p?{...p,...(action==='allocate'?{materialNumber:result.materialNumber}:action==='push'?{status:'active',pushedAt:new Date().toISOString()}:action==='disable'?{status:'disabled'}:{status:'deleted'})}:null);reload();}catch(e){setError(String(e));}finally{setSaving(false);}};
    const [listView,setListView]=useState('my_drafts');
    const [listSearch,setListSearch]=useState('');
    const [similar,setSimilar]=useState<{items:Array<{id:string;name:string;shortText:string;warehouseId:string;score:number;matchedFields:string[];attributeMatches:number;attributeTotal:number;partMatch:boolean;status:string}>;totalCompared:number}|null>(null);
    // New material adoption defaults to the registered industry's recommendations.
    // Existing selected items remain visible, and the user can explicitly browse every class.
    const suggestedMaterials=(tree?.classes??[]).filter(x=>showAllIndustryMaterials||x.financial?.industryRecommended!==false||x.code===material);
    const categories = (tree?.groups ?? []).filter(x=>suggestedMaterials.some(m=>m.groupCode===x.code));
    const subcategories = (tree?.categories ?? []).filter(x => x.groupCode === category&&suggestedMaterials.some(m=>m.categoryCode===x.code));
    const families = (tree?.subcategories ?? []).filter(x => x.categoryCode === subcategory&&suggestedMaterials.some(m=>m.subcategoryCode===x.code));
    const materials = suggestedMaterials.filter(x => x.subcategoryCode === family);
    const supplyType=registration.supplyType??'GENERAL';
    const selectedVendor=options?.vendors?.find(v=>v.id===registration.vendorId)?.name??'';
    const partyName=(registration.partyEntryMode??(supplyType==='GENERAL'?'manual':'registered'))==='manual'?registration.partyName??'':selectedVendor;
    const partNumber=supplyType==='OEM'?registration.oemPartNumber??'':supplyType==='OCM'?registration.ocmPartNumber??'':'';
    const shortText=[name.trim(),...((detail?.attributes??[]).filter(a=>a.specific).map(a=>shownValue(a,values[a.code],true)).filter(Boolean)),...(['OEM','OCM'].includes(supplyType)?[partyName.trim(),partNumber.trim()]:[])].filter(Boolean).join('; ').slice(0,120);
    useEffect(() => {
        if (!material) { setDetail(null); return; }
        let live = true;
        setLoadingDetail(true);
        callBackend<ClassDetail>(itemApi, { kind: 'materials', code: material }).then(d => { if (live) { setDetail(d); if (!editingId) { setName(d.name); setValues({}); } } }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Unable to load attributes'); }).finally(() => { if (live) setLoadingDetail(false); });
        return () => { live = false; };
    }, [material]);
    useEffect(()=>{if(!adding||!material){setLiveMatches([]);setHardDuplicates([]);return;}let active=true;setLiveChecking(true);const timeout=setTimeout(()=>{callBackend<{items:Array<{id:string;name:string;shortText:string;status:string;score:number;partMatch:boolean}>;hardDuplicates:Array<{id:string;name:string;shortText:string;status:string;score:number;partMatch:boolean}>}>(endpoint+'/similar',{excludeId:draftId.current||editingId,material:{name,categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material,attributes:values,...registration}}).then(r=>{if(active){setLiveMatches(r.items.filter(x=>x.score>90));setHardDuplicates(r.hardDuplicates??[]);}}).catch(()=>{if(active){setLiveMatches([]);setHardDuplicates([]);}}).finally(()=>{if(active)setLiveChecking(false);});},450);return()=>{active=false;clearTimeout(timeout);};},[adding,material,name,category,subcategory,family,values,registration,editingId]);
    useEffect(()=>{if(!adding||!material||name.trim().length<2||extendSource)return;setAutoStatus('Saving draft…');const timer=setTimeout(()=>{const payload={name:name.trim(),shortText,categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material,attributes:values,...registration,assemblyIds:(registration.assemblyIds??'').split(',').filter(Boolean)};saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{const result=await callBackend<{id:string}>(endpoint+'/autosave',{id:draftId.current||editingId,data:payload});draftId.current=result.id;setAutoStatus('Draft saved');}).catch(e=>setAutoStatus(e instanceof Error?'Autosave failed: '+e.message:'Autosave failed'));},650);return()=>clearTimeout(timer);},[adding,material,name,category,subcategory,family,values,registration,shortText,editingId,extendSource]);
    const eligibleWarehouses=(options?.warehouses??[]).filter(w=>w.categoryCodes?.includes(category));
    const duplicateBlocked=hardDuplicates.length>0;
    const [showAttrErrors,setShowAttrErrors]=useState(false);
    const stage1Issues = [!material?'Select a catalogue material.':'',!detail?'Load material attributes.':'',!name.trim()?'Enter material name.':'',...attributeIssues(detail?.attributes??[],values).map(x=>x.a.name+': '+x.msg)].filter(Boolean);
    const supply=registration.supplyType??'GENERAL';
    const mode=registration.partyEntryMode??(supply==='GENERAL'?'manual':'registered');
    const partKey=supply==='OEM'?'oemPartNumber':supply==='OCM'?'ocmPartNumber':'generalPartNumber';
    const stage2Issues=[!uomCategory?'Select a unit category.':'',!(options?.uoms??[]).some(x=>x.code===registration.uom&&(x.category||'Other')===uomCategory)?'Select a valid unit of measure.':'',!registration[partKey]?.trim()?'Enter the '+supply+' part number.':'',mode==='manual'&&((registration.partyName??'').trim().length<2)?'Enter a name (at least 2 characters).':'',mode==='registered'&&!registration.vendorId?'Select a registered vendor or enter a name manually.':'',supply==='OEM'&&!(options?.costCenters??[]).some(x=>x.id===registration.costCenterId)?'Select an accessible cost center.':'',supply==='OEM'&&!(options?.assets??[]).some(x=>x.id===registration.assetId&&x.parentId===registration.costCenterId)?'Select an asset within that cost center.':'',supply==='OEM'&&(registration.assemblyIds??'').split(',').filter(Boolean).some(id=>!(options?.scopedAssemblies??[]).some(x=>x.id===id&&x.parentId===registration.assetId))?'All selected assemblies must belong to the asset.':''].filter(Boolean);
    const stage3Issues=[!eligibleWarehouses.some(x=>x.id===registration.warehouseId)?'Select a warehouse configured for this material category.':'',!(options?.restrictions??[]).some(x=>x.code===registration.warehouseRestriction)?'Select the warehouse restriction.':''].filter(Boolean);
    const complete=!stage1Issues.length&&!stage2Issues.length&&!stage3Issues.length;
    const checkSimilar=async()=>{setSimilarLoading(true);setSimilar(null);setDuplicateConfirmed(false);setError('');try{const result=await callBackend<{items:Array<{id:string;name:string;shortText:string;warehouseId:string;score:number;matchedFields:string[];attributeMatches:number;attributeTotal:number;partMatch:boolean;status:string}>;totalCompared:number}>(endpoint+'/similar',{excludeId:draftId.current||editingId,material:{name,categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material,attributes:values,...registration}});setSimilar(result);setStage(5);}catch(e){setError(e instanceof Error?e.message:'Similarity comparison failed.');}finally{setSimilarLoading(false);}};
    const save = async (submit=false) => {
        setError('');
        const issues=[...stage1Issues,...stage2Issues,...stage3Issues];
        if(issues.length)return setError(issues[0]);
        if(submit&&duplicateBlocked)return setError('REPEAT MATERIAL: Same part number and similarity above 90%. Extend the existing material instead.');
        if(submit&&(!reviewAgreed||!duplicateConfirmed||!similar))return setError('Complete structured review and duplicate confirmation first.');
        setSaving(true);
        try {
            await saveQueue.current;
            let id=draftId.current||editingId;
            const data={name:name.trim(),attributes:values,shortText,...registration,partyEntryMode:mode,assemblyIds:(typeof registration.assemblyIds==='string'?registration.assemblyIds.split(',').map(x=>x.trim()).filter(Boolean):[])};
            if(id)await callBackend(endpoint+'/update',{id,data});
            else {const created=await callBackend<{id:string}>(endpoint+'/create',{categoryCode:category,subcategoryCode:subcategory,familyCode:family,materialCode:material,name:name.trim(),attributes:values});id=created.id;await callBackend(endpoint+'/update',{id,data});}
            draftId.current=id;
            if(submit)await callBackend(endpoint+'/submit',{id});
            setAdding(false);setStage(1);draftId.current='';setAutoStatus('');setEditingId('');setRegistration({supplyType:'GENERAL'});setUomCategory('');setCategory('');setSubcategory('');setFamily('');setMaterial('');setDetail(null);setValues({});reload();
        } catch(e){setError(e instanceof Error?e.message:'Unable to save or submit material.');}
        finally{setSaving(false);}
    };
    // ----- verification: field messages appear once the user has tried to leave the step -----
    const [tried, setTried] = useState<Record<number, boolean>>({});
    const fieldError = (step: number, bad: boolean, message: string) => (tried[step] && bad ? message : undefined);
    const uomsInCategory = (options?.uoms ?? []).filter((x) => (x.category || 'Other') === uomCategory);
    const partLabel = supply === 'OEM' ? 'OEM part number' : supply === 'OCM' ? 'OCM part number' : 'Supplier / standard part number';
    const partyLabel = supply === 'OEM' ? 'OEM' : supply === 'OCM' ? 'Component maker (OCM)' : 'Supplier';
    const selectedAssemblies = (registration.assemblyIds ?? '').split(',').filter(Boolean);
    const topRef = useRef<HTMLDivElement>(null);
    const go = (next: number) => {
        setError('');
        setStage(next);
        requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    };
    const startNew = () => {
        setAdding(true); setStage(1); draftId.current = ''; setExtendSource(null); setAutoStatus(''); setReviewAgreed(false); setDuplicateConfirmed(false);
        setSimilar(null); setEditingId(''); setRegistration({ supplyType: 'GENERAL' }); setUomCategory(''); setError(''); setTried({}); setShowAttrErrors(false);
    };
    const fail = (step: number, message: string) => { setTried((t) => ({ ...t, [step]: true })); setError(message); };
    const next1 = () => {
        if (!material) return fail(1, 'Choose the material from the catalogue first.');
        if (!detail) return fail(1, 'Wait for the material attributes to load.');
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
    const actions = stage === 1 ? <Button className='flex-1 sm:ml-auto sm:flex-none' disabled={loadingDetail} onClick={next1}>Continue <ArrowRight className='h-4 w-4' /></Button>
        : stage === 2 ? <>{back}<Button className='flex-[2] sm:ml-auto sm:flex-none' onClick={next2}>Continue <ArrowRight className='h-4 w-4' /></Button></>
        : stage === 3 ? <>{back}<Button variant='secondary' className='flex-1 sm:ml-auto sm:flex-none' busy={saving} disabled={!complete || saving} onClick={() => save(false)}><Save className='h-4 w-4' /> Draft</Button><Button className='flex-[2] sm:flex-none' onClick={next3}>Review <ArrowRight className='h-4 w-4' /></Button></>
        : stage === 4 ? <>{back}<Button className='flex-[2] sm:ml-auto sm:flex-none' busy={similarLoading} disabled={!complete || similarLoading || duplicateBlocked || liveChecking} onClick={next4}>Check duplicates <ArrowRight className='h-4 w-4' /></Button></>
        : <>{back}<Button className='flex-[2] sm:ml-auto sm:flex-none' busy={saving} disabled={!complete || !similar || !duplicateConfirmed || saving || duplicateBlocked || liveChecking} onClick={() => save(true)}><Send className='h-4 w-4' /> Submit for approval</Button></>;
    const restriction = options?.restrictions.find((x) => x.code === registration.warehouseRestriction);
    const wizard = <div className='space-y-4 pb-10'>
        <div ref={topRef} className='scroll-mt-[var(--mems-top,0px)]' />
        <WizardBar title={editingId ? 'Edit material' : 'New material'} steps={steps} stage={stage} onStep={go} onClose={() => setAdding(false)}
            status={autoStatus || (liveChecking ? 'Checking duplicates…' : '')} actions={actions} error={error}
            blocked={duplicateBlocked ? 'Repeat material — same part number and over 90% similar. Extend the existing material below instead of creating a new one.' : undefined} />

        {duplicateBlocked && <StepSection title='Existing material found' hint='Creating it again is blocked. Extend the existing material to your warehouse.'>
            <div className='space-y-2'>{hardDuplicates.map((x) => <MatchCard key={x.id} score={x.score} name={x.name} shortText={x.shortText} status={x.status}
                action={<Button onClick={() => { setExtendSource(x); setExtendWarehouse(''); setExtendVerified(false); }}>Extend this material</Button>} />)}</div>
        </StepSection>}
        {!duplicateBlocked && !!liveMatches.length && <details key={stage === 1 ? 'open' : 'folded'} open={stage === 1} className='rounded-2xl border border-amber-400/50 bg-amber-400/5 p-3'>
            <summary className='cursor-pointer text-sm font-semibold text-amber-400'>{liveMatches.length === 1 ? '1 very similar material already exists' : liveMatches.length + ' very similar materials already exist'} — check before continuing</summary>
            <div className='mt-3 max-h-[40dvh] space-y-2 overflow-y-auto overscroll-contain'>{liveMatches.map((x) => <MatchCard key={x.id} score={x.score} name={x.name} shortText={x.shortText} status={x.status}
                action={<Button variant='secondary' onClick={async () => { if (await appConfirm('Extend existing material ' + x.name + ' to another warehouse instead of creating a new material?')) { setExtendSource(x); setExtendWarehouse(''); setExtendVerified(false); } }}>Extend instead</Button>} />)}</div>
        </details>}
        {extendSource && <StepSection title='Extend an existing material' hint='The original material stays unchanged. Only approved materials can be extended, and not to a warehouse that already has it or has a pending extension.'>
            <p className='mb-3 break-words text-sm font-medium text-ink'>{extendSource.name}<span className='block text-xs font-normal text-muted'>{extendSource.shortText}</span></p>
            <SelectField id='mm-extend-wh' label='Target warehouse' required value={extendWarehouse} onChange={(e) => { setExtendWarehouse(e.target.value); setExtendVerified(false); }}>
                <option value=''>Select another warehouse</option>{eligibleWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </SelectField>
            <div className='mt-3'><ConfirmBox checked={extendVerified} onChange={setExtendVerified}>I have verified the material identity, the target warehouse and that no extension exists yet.</ConfirmBox></div>
            <div className='mt-4 flex gap-2'>
                <Button variant='secondary' className='flex-1 sm:flex-none' onClick={() => setExtendSource(null)}>Cancel</Button>
                <Button className='flex-[2] sm:flex-none' disabled={!extendWarehouse || !extendVerified || extendBusy} busy={extendBusy} onClick={async () => { setExtendBusy(true); setError(''); try { await callBackend(endpoint + '/extension', { sourceId: extendSource.id, warehouseId: extendWarehouse }); setExtendSource(null); setAdding(false); reloadExtensions(); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Extension failed'); } finally { setExtendBusy(false); } }}>Submit extension for approval</Button>
            </div>
        </StepSection>}

        {stage === 1 && (treeLoading ? <Spinner /> : treeError || !tree ? <Alert tone='error'>{treeError || 'The material reference catalogue is not available. An administrator must load it first.'}</Alert> : <>
            <StepSection title='Find it in the catalogue' hint='Narrow down from category to the exact material. Each list is searchable.'
                aside={<button type='button' onClick={() => setShowAllIndustryMaterials((v) => !v)} className='shrink-0 rounded-lg border border-line px-2 py-1.5 text-xs text-soft active:bg-page'>{showAllIndustryMaterials ? 'Recommended only' : 'Show all industries'}</button>}>
                <div className='grid gap-4 sm:grid-cols-2'>
                    <SelectField id='mm-category' label='Category' required value={category} error={fieldError(1, !category, 'Choose a category.')} onChange={(e) => { setCategory(e.target.value); setSubcategory(''); setFamily(''); setMaterial(''); }}>
                        <option value=''>Select category</option>{categories.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                    </SelectField>
                    <SelectField id='mm-subcategory' label='Subcategory' required disabled={!category} value={subcategory} error={fieldError(1, !!category && !subcategory, 'Choose a subcategory.')} onChange={(e) => { setSubcategory(e.target.value); setFamily(''); setMaterial(''); }}>
                        <option value=''>Select subcategory</option>{subcategories.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                    </SelectField>
                    <SelectField id='mm-family' label='Family' required disabled={!subcategory} value={family} error={fieldError(1, !!subcategory && !family, 'Choose a family.')} onChange={(e) => { setFamily(e.target.value); setMaterial(''); }}>
                        <option value=''>Select family</option>{families.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                    </SelectField>
                    <SelectField id='mm-material' label='Material' required disabled={!family} value={material} error={fieldError(1, !!family && !material, 'Choose the material.')} onChange={(e) => setMaterial(e.target.value)}>
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
                <StepSection title='Technical attributes' hint='Fill in the required fields from the nameplate, label or box. Each field says where to find the value.'>
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
            <StepSection title='Who supplies this part?' hint={detail?.guidance?.supply ? `${detail.guidance.label}: usually bought from ${detail.guidance.supply.usual.map((u) => SUPPLY_WORD[u] ?? u).join(' or ')}. ${detail.guidance.supply.note}` : 'Choose the relationship that decides which part number to copy.'}>
                <div role='radiogroup' aria-label='Supply type' className='grid gap-2 sm:grid-cols-3'>
                    {SUPPLY_TYPES.map((t) => <OptionCard key={t.code} selected={supply === t.code} title={t.title} text={t.text} badge={detail?.guidance?.supply?.usual.includes(t.code) ? 'usual' : undefined}
                        onSelect={() => setRegistration((p) => ({ ...p, supplyType: t.code, partyEntryMode: t.code === 'GENERAL' ? 'manual' : 'registered', vendorId: '', partyName: '' }))} />)}
                </div>
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
                </div>
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

        {stage === 3 && <StepSection title='Warehouse and restriction' hint='Only warehouses configured for this material category are listed.'>
            {!(options?.warehouses ?? []).length && <div className='mb-3'><Alert tone='warn'>No configured warehouses are accessible to your account. Contact your administrator.</Alert></div>}
            <div className='grid gap-4 sm:grid-cols-2'>
                <SelectField id='mm-wh' label='Warehouse' required value={registration.warehouseId ?? ''} error={fieldError(3, !eligibleWarehouses.some((x) => x.id === registration.warehouseId), 'Choose a warehouse configured for this category.')} onChange={(e) => setRegistration((p) => ({ ...p, warehouseId: e.target.value }))}>
                    <option value=''>Select an accessible warehouse</option>{eligibleWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                </SelectField>
                <SelectField id='mm-restriction' label='Warehouse restriction' required disabled={!registration.warehouseId} value={registration.warehouseRestriction ?? ''}
                    hint={restriction?.description || 'Same master as storage locations: the material can only be binned where the restriction matches.'}
                    error={fieldError(3, !!registration.warehouseId && !restriction, 'Choose the restriction.')} onChange={(e) => setRegistration((p) => ({ ...p, warehouseRestriction: e.target.value }))}>
                    <option value=''>Select the restriction</option>{(options?.restrictions ?? []).map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                </SelectField>
            </div>
            <div className='mt-4'><ShortTextPreview text={shortText} /></div>
        </StepSection>}

        {stage === 4 && <>
            <ShortTextPreview text={shortText} />
            <ReviewSection title='Classification' onEdit={() => go(1)} items={[['Category', categories.find((x) => x.code === category)?.name], ['Subcategory', subcategories.find((x) => x.code === subcategory)?.name], ['Family', families.find((x) => x.code === family)?.name], ['Catalogue material', materials.find((x) => x.code === material)?.name], ['Material name', name]]} />
            <ReviewSection title='Technical attributes' onEdit={() => go(1)} items={(detail?.attributes ?? []).filter((x) => values[x.code]).map((x) => [x.name, shownValue(x, values[x.code])] as [string, string])} />
            <ReviewSection title='Sourcing' onEdit={() => go(2)} items={[['Unit', options?.uoms.find((x) => x.code === registration.uom)?.label ?? registration.uom], ['Supply type', SUPPLY_TYPES.find((t) => t.code === supply)?.title], [partyLabel, partyName], ['Part number', registration[partKey]], ['Model', registration.model], ['Version', registration.versionNumber], ['Cost center', options?.costCenters.find((x) => x.id === registration.costCenterId)?.name], ['Asset', options?.assets.find((x) => x.id === registration.assetId)?.name], ['Assemblies', supply === 'OEM' ? (options?.scopedAssemblies ?? []).filter((x) => selectedAssemblies.includes(x.id)).map((x) => x.name).join(', ') || 'Whole asset' : '']]} />
            <ReviewSection title='Warehouse' onEdit={() => go(3)} items={[['Warehouse', options?.warehouses.find((x) => x.id === registration.warehouseId)?.name], ['Restriction', restriction ? restriction.label + ' (' + restriction.code + ')' : '']]} />
            <ConfirmBox checked={reviewAgreed} onChange={setReviewAgreed}>I have reviewed the short text, classification, attributes, sourcing and warehouse details and confirm they are correct.</ConfirmBox>
        </>}

        {stage === 5 && <StepSection title='Duplicate check' hint='The closest existing materials (approved and pending) across all warehouses. Percentages are weighted indicators, not proof that parts are interchangeable.'>
            {similar ? <>
                <p className='mb-3 text-xs text-muted'>Compared against {similar.totalCompared} existing materials.</p>
                {similar.items.length ? <div className='max-h-[55dvh] space-y-2 overflow-y-auto overscroll-contain pr-1'>{similar.items.map((x) => <MatchCard key={x.id} score={x.score} name={x.name} shortText={x.shortText} status={x.status}
                    meta={<>{options?.warehouses.find((w) => w.id === x.warehouseId)?.name ?? x.warehouseId} · {x.matchedFields.join(', ') || 'no hierarchy match'} · attributes {x.attributeMatches}/{x.attributeTotal}{x.partMatch ? ' · part number match' : ''}</>} />)}</div>
                    : <Alert tone='success'>No similar materials found.</Alert>}
                <div className='mt-4'><ConfirmBox checked={duplicateConfirmed} onChange={setDuplicateConfirmed}>I have reviewed the closest materials, verified this request is not a duplicate, and confirm submission.</ConfirmBox></div>
            </> : <Spinner />}
        </StepSection>}

        {stage <= 3 && <OpenItems issues={stage === 1 ? stage1Issues : stage === 2 ? stage2Issues : stage3Issues} />}
    </div>;

    if (adding) return wizard;
    return <div className='space-y-4'>
        <PageTitle title='Materials Master' subtitle='Create and manage organization materials from the MEMS classification and attribute catalogue.' action={<Button onClick={startNew}><Plus className='h-4 w-4' /> Add material</Button>} />
        {error && <Alert tone='error'>{error}</Alert>}
            {extensionRecords?.items?.length?<Card><h2 className='font-semibold mb-3'>Material warehouse extensions</h2>{extensionRecords.items.map(x=><div key={x.id} className='flex flex-wrap items-center gap-3 border-b border-slate-800 py-2 text-sm'><span>{x.materialName} → {options?.warehouses.find(w=>w.id===x.warehouseId)?.name??x.warehouseId}</span><span className='text-slate-400'>{x.status} · Level {x.approvalLevel}</span>{x.status==='pending_approval'&&<><Button onClick={async()=>{try{await callBackend(endpoint+'/extension/approve',{id:x.id,decision:'approve'});reloadExtensions();}catch(e){setError(String(e));}}}>Approve</Button><Button onClick={async()=>{const comment=(await appPrompt('Reason for rejection'));if(!comment)return;try{await callBackend(endpoint+'/extension/approve',{id:x.id,decision:'reject',comment});reloadExtensions();}catch(e){setError(String(e));}}}>Reject</Button></>}</div>)}</Card>:null}{reviewMaterial&&<Card><div className='flex justify-between items-center'><h2 className='font-semibold'>Material review · {reviewMaterial.status??'draft'}</h2><Button onClick={()=>setReviewMaterial(null)}>Close</Button></div><p className='mt-3 font-semibold'>{reviewMaterial.shortText}</p>{['approved','active','disabled'].includes(reviewMaterial.status??'')&&<div className='mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 p-3'><span className='mr-2 text-sm font-semibold'>Material number: {reviewMaterial.materialNumber||'Not allocated'}</span>{reviewMaterial.status==='approved'&&!reviewMaterial.materialNumber&&<Button busy={saving} onClick={()=>void lifecycle('allocate')}>Allocate Material Number</Button>}{reviewMaterial.materialNumber&&reviewMaterial.status==='approved'&&!reviewMaterial.pushedAt&&<Button busy={saving} onClick={()=>void lifecycle('push')}>Push to configured warehouse</Button>}{reviewMaterial.status!=='disabled'&&<Button busy={saving} onClick={()=>void lifecycle('disable')}>Disable</Button>}{reviewMaterial.status==='approved'&&!reviewMaterial.pushedAt&&<Button busy={saving} onClick={()=>void lifecycle('delete')}>Delete</Button>}{reviewMaterial.pushedAt&&<span className='text-xs text-emerald-400'>Published to requesting warehouse</span>}</div>}<div className='grid sm:grid-cols-2 gap-3 mt-3 text-sm'>{Object.entries(reviewMaterial).filter(([k,v])=>!['attributes','approvalHistory'].includes(k)&&v!==null&&v!==undefined&&typeof v!=='object').map(([k,v])=><div key={k} className='border-b border-slate-800 pb-2'><p className='text-xs text-slate-400'>{k}</p><p>{String(v)}</p></div>)}</div><h3 className='mt-4 font-medium'>Technical attributes</h3>{Object.entries(reviewMaterial.attributes??{}).map(([k,v])=><p key={k} className='text-sm'><span className='text-slate-400'>{k}: </span>{v}</p>)}</Card>}{recordsLoading?<Spinner/>:<Card><div className='-mx-1 mb-4 flex gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 sm:flex-wrap'>{([{key:'my_approvals',label:'Awaiting My Approval',count:(records?.items??[]).filter(m=>m.canApprove).length,show:!!records?.isApprover},{key:'my_requests',label:'My Submitted Requests',count:(records?.items??[]).filter(m=>m.submittedBy===records?.currentUserId&&m.status==='pending_approval').length,show:true},{key:'my_drafts',label:'My Drafts',count:(records?.items??[]).filter(m=>m.createdBy===records?.currentUserId&&['draft','rejected'].includes(m.status??'draft')).length,show:true},{key:'approved',label:'Approved Materials',count:(records?.items??[]).filter(m=>['approved','active','disabled'].includes(m.status??'')).length,show:true},{key:'other_requests',label:'Other Pending Requests',count:(records?.items??[]).filter(m=>m.status==='pending_approval'&&m.submittedBy!==records?.currentUserId&&!m.canApprove).length,show:true}] as const).filter(t=>t.show).map(t=><button type='button' key={t.key} onClick={()=>setListView(t.key)} className={'min-h-11 shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium border '+(listView===t.key?'bg-brand/15 text-ink border-brand':'bg-page text-soft border-line')}>{t.label} <span className='ml-1 rounded-full bg-slate-700 px-2 py-0.5 text-xs'>{t.count}</span></button>)}</div><div className='flex flex-wrap items-center justify-between gap-2 mb-3'><h2 className='font-semibold text-white'>{({my_approvals:'Awaiting My Approval',my_requests:'My Submitted Requests',my_drafts:'My Drafts',approved:'Approved Materials',other_requests:'Other Pending Requests'} as Record<string,string>)[listView]}</h2></div><RichTable<SavedMaterial> id={'materials-'+listView} title={({my_approvals:'Awaiting My Approval',my_requests:'My Submitted Requests',my_drafts:'My Drafts',approved:'Approved Materials',other_requests:'Other Pending Requests'} as Record<string,string>)[listView]} fileName={'materials_'+listView} rows={(records?.items??[]).filter(m=>listView==='my_approvals'?m.canApprove:listView==='my_requests'?m.submittedBy===records?.currentUserId&&m.status==='pending_approval':listView==='my_drafts'?m.createdBy===records?.currentUserId&&['draft','rejected'].includes(m.status??'draft'):listView==='approved'?['approved','active','disabled'].includes(m.status??''):m.status==='pending_approval'&&m.submittedBy!==records?.currentUserId&&!m.canApprove)} rowKey={m=>m.id} empty='No materials in this view.' columns={[{key:'material',label:'Material / Short Text',value:m=>m.name+' '+(m.shortText??''),render:m=><span className='block min-w-[12rem] max-w-[18rem] whitespace-normal'><span className='block font-semibold text-white'>{m.name}</span><span className='block text-xs text-slate-400 line-clamp-2'>{m.shortText}</span></span>},{key:'reference',label:'Reference',value:m=>m.id+' '+(m.materialCode??''),render:m=><span className='block font-mono text-xs'>{m.id}<span className='block text-slate-400'>{m.materialCode}</span></span>},{key:'parts',label:'Part numbers',hidden:true,value:m=>[m.oemPartNumber,m.ocmPartNumber,m.generalPartNumber].filter(Boolean).join(', ')},{key:'category',label:'Category / Family',value:m=>m.categoryCode+' '+(m.familyCode??''),render:m=><span className='block'>{m.categoryCode}<span className='block text-xs text-slate-400'>{m.familyCode}</span></span>},{key:'warehouse',label:'Warehouse',value:m=>options?.warehouses.find(w=>w.id===m.warehouseId)?.name??m.warehouseId??'—'},{key:'status',label:'Status',value:m=>(m.status??'draft').replaceAll('_',' '),render:m=><span className='rounded-full bg-slate-800 px-2 py-1 text-xs'>{(m.status??'draft').replaceAll('_',' ')}</span>},{key:'submitted',label:'Submitted',type:'date',value:m=>m.createdAt??'',render:m=>m.createdAt?new Date(m.createdAt).toLocaleDateString():'—'},{key:'approval',label:'Approval',value:m=>m.status==='pending_approval'?'Level '+(m.approvalLevel??1):'—'},{key:'actions',label:'Actions',value:()=>'',render:m=><div className='flex flex-wrap gap-2' onClick={e=>e.stopPropagation()}><Button onClick={()=>setReviewMaterial(m)}>Review</Button>{m.canApprove&&<><Button onClick={async()=>{if(!(await appConfirm('Approve material '+(m.name||m.id)+'? It becomes available in the approved catalogue.')))return;try{await callBackend(endpoint+'/approve',{id:m.id,decision:'approve'});reload();}catch(e){setError(String(e));}}}>Approve</Button><Button onClick={async()=>{const comment=(await appPrompt('Reason for rejection'));if(!comment)return;try{await callBackend(endpoint+'/approve',{id:m.id,decision:'reject',comment});reload();}catch(e){setError(String(e));}}}>Reject</Button></>}{['draft','rejected'].includes(m.status??'draft')&&m.createdBy===records?.currentUserId&&<Button onClick={()=>{setEditingId(m.id);draftId.current=m.id;setAdding(true);setStage(3);setReviewAgreed(false);setDuplicateConfirmed(false);setSimilar(null);setUomCategory(options?.uoms?.find(x=>x.code===m.uom)?.category??'');setName(m.name);setCategory(m.categoryCode);setSubcategory(m.subcategoryCode);setFamily(m.familyCode);setMaterial(m.materialCode);setValues(m.attributes??{});setError('');setRegistration({...Object.fromEntries(Object.entries(m).filter(([,v])=>typeof v==='string')) as Record<string,string>,supplyType:m.supplyType??'GENERAL',assemblyIds:Array.isArray(m.assemblyIds)?m.assemblyIds.join(','):''});}}>Edit</Button>}</div>},]}/></Card>}
    </div>;
}
