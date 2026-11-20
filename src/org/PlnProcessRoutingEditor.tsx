import {useEffect,useId,useMemo,useState,type ReactNode} from 'react';
import {callBackend} from '../lib/backend';
import {Field,SelectField} from '../components/ui';

type Row={id:string;name:string;[key:string]:unknown};
export type RoutingStep={
 code:string;name:string;resourceId:string;producesSkuId?:string;dependsOn?:string[];
 setupMinutes:number;runMinutesPerUnit:number;costCenterId?:string;bomId?:string;
 processClass?:string;stageType?:'PRODUCE'|'INSPECT'|'TRANSFER'|'OTHER';
 capacityBasis?:'PHYSICAL_CONTAINER'|'RESOURCE_RATE'|'BATCH_CYCLE'|'TIME_PER_UNIT';
 batchSize?:number;cycleMinutes?:number;
};
type RoutingRecord=Row&{skuId?:string;siteId?:string;alternativeCode?:string;
 effectiveFrom?:string;routingModelVersion?:number;operations?:RoutingStep[]};
type CostCenter={id:string;name:string;code:string;siteId:string;legalEntityId:string;commissionedSkuIds:string[]};
type Diagnostic={stageCode:string;field:string;message:string};
type StagePreview={code:string;name:string;stageType:string;producesSkuId:string;costCenterId:string;
 resourceId:string;bomId:string;capacityBasis:string;dependsOn:string[];
 setupMinutes:number;runMinutesPerUnit:number;bomComponentCount:number;
 capacity:{quantity:number;unit:string;source:string;revision?:number}|null};
type Review={ready:boolean;issues:Diagnostic[];stages:StagePreview[];
 bottlenecks:Array<{outputSkuId:string;limitingStageCode:string;physicalContainersPerHour:number;
 comparableStageCodes:string[]}>;comparisonNote:string};
const forms='w-full min-h-11 min-w-0 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink';
const fmt=(n:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n);
const str=(x:unknown)=>typeof x==='string'?x:'';
const num=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?x:0;
function Choice({label,value,options,onChange,disabled=false}:{label:string;value:string;
 options:Array<[string,string]>;onChange:(value:string)=>void;disabled?:boolean}){
 const id=useId();
 return <SelectField id={id} label={label} value={value} disabled={disabled}
  onChange={event=>onChange(event.target.value)}>
  {options.map(([id,text])=><option key={id} value={id}>{text}</option>)}
 </SelectField>;
}
function TextField({label,value,onChange,type='text',min}:{
 label:string;value:string|number;onChange:(v:string)=>void;type?:string;min?:string}){
 const id=useId();
 return <Field id={id} label={label} type={type} min={min}
  value={value} onChange={event=>onChange(event.target.value)}/>;
}
function Action({children,onClick,disabled=false,primary=false}:{children:ReactNode;onClick:()=>void;
 disabled?:boolean;primary?:boolean}){
 return <button type='button' onClick={onClick} disabled={disabled}
  className={'min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 '+
   (primary?'border-brand bg-brand text-onbrand':'border-line bg-panel text-ink')}>{children}</button>;
}
const stageTypes:Array<[RoutingStep['stageType'],string]>=[
 ['PRODUCE','Production / transformation'],['INSPECT','Inspection / quality'],
 ['TRANSFER','Transfer / handling'],['OTHER','Other non-transforming step'],
];
const capacityBases:Array<[RoutingStep['capacityBasis'],string]>=[
 ['PHYSICAL_CONTAINER','Commissioned primary-container speed'],
 ['RESOURCE_RATE','Manufacturing resource rate'],
 ['BATCH_CYCLE','Batch size and cycle time'],
 ['TIME_PER_UNIT','Run minutes per output unit'],
];
const classes=['GENERAL','MATERIAL_PREPARATION','BLENDING','BLOW_MOULDING','FILLING',
 'CAPPING','INSPECTION','LABELLING','CASE_PACKING','PALLETIZATION','TRANSFER','QUALITY',
 'HEAT_TREATMENT','ASSEMBLY','MACHINING','FORMING','EXTRUSION','CLEANING','OTHER'];
const freshStage=(code:string):RoutingStep=>({
 code,name:'',resourceId:'',producesSkuId:'',dependsOn:[],setupMinutes:0,runMinutesPerUnit:0,
 costCenterId:'',bomId:'',processClass:'GENERAL',stageType:'PRODUCE',
 capacityBasis:'RESOURCE_RATE',batchSize:0,cycleMinutes:0,
});
const stageList=(input:unknown):RoutingStep[]=>Array.isArray(input)?input as RoutingStep[]:[];
/** Stage editor does not write to resources, BOMs or equipment; it only saves routing references. */
export default function PlnProcessRoutingEditor({value,onChange,items,boms,resources,sites}:{
 value:RoutingRecord;onChange:(next:RoutingRecord)=>void;items:Row[];boms:Row[];resources:Row[];
 sites:Array<{id:string;name:string;code:string}>}){
 const [centers,setCenters]=useState<CostCenter[]>([]);
 const [loadError,setLoadError]=useState('');
 const [section,setSection]=useState<'setup'|'stages'|'review'>('setup');
 const [openStep,setOpenStep]=useState('');
 const [review,setReview]=useState<Review|null>(null);
 const [reviewBusy,setReviewBusy]=useState(false);
 const [reviewError,setReviewError]=useState('');
 const [speed,setSpeed]=useState<{text:string;detail:string}|null>(null);
 const [speedBusy,setSpeedBusy]=useState(false);
 const [stepNotice,setStepNotice]=useState('');
 const legacy=value.routingModelVersion!==2;
 const ops=stageList(value.operations);
 const selected=ops.find(s=>s.code===openStep);
 const selectedOutput=items.find(x=>x.id===selected?.producesSkuId);
 const update=(field:string,input:unknown)=>{
  setReview(null);setReviewError('');
  onChange({...value,[field]:input});
 };
 const updateSteps=(next:RoutingStep[])=>update('operations',next);
 const updateStep=(code:string,changes:Partial<RoutingStep>)=>
  updateSteps(ops.map(s=>s.code===code?{...s,...changes}:s));
 const selectedCostCenter=centers.find(x=>x.id===selected?.costCenterId);
 const selectedResource=resources.find(x=>x.id===selected?.resourceId);
 useEffect(()=>{
  let live=true;
  void callBackend<{costCenters:CostCenter[]}>('/api/org/pln-mfg/foundation/routing-references')
   .then(v=>{if(live)setCenters(v.costCenters);})
   .catch(e=>{if(live)setLoadError(e instanceof Error?e.message:'Cost centres could not be loaded.');});
  return ()=>{live=false;};
 },[]);
 useEffect(()=>{
  let live=true;
  setSpeed(null);
  if(!selected||selected.capacityBasis!=='PHYSICAL_CONTAINER'||!selected.costCenterId||!selected.producesSkuId||
    !value.siteId)return;
  setSpeedBusy(true);
  void callBackend<{rating:{ratingQuantity:number;projection:{source:{containerName:string;
    sizeName:string;physicalContainers:number;countUnit:string;timeUnit:string}}}}>(
    '/api/org/pln/cost-center/rating',{costCenterId:selected.costCenterId,skuId:selected.producesSkuId})
   .then(v=>{if(live)setSpeed({text:fmt(v.rating.ratingQuantity)+' '+
       v.rating.projection.source.countUnit+' / '+v.rating.projection.source.timeUnit,
      detail:v.rating.projection.source.containerName+' · '+v.rating.projection.source.sizeName});})
   .catch(e=>{if(live)setSpeed({text:'Commissioned rating unavailable',
    detail:e instanceof Error?e.message:'Check the cost centre and primary-container master.'});})
   .finally(()=>{if(live)setSpeedBusy(false);});
  return ()=>{live=false;};
 },[selected?.costCenterId,selected?.producesSkuId,selected?.capacityBasis,value.siteId]);
 // SKU identity is organization-wide; stage cost-centre mapping controls commissioned capacity.
 const availableOutputs=useMemo(()=>items.filter(x=>
  ['FINISHED','INTERMEDIATE'].includes(str(x.category))),[items]);
 const resourcesForSite=resources.filter(x=>!str(x.siteId)||!value.siteId||str(x.siteId)===value.siteId);
 const centersForSite=centers.filter(x=>x.siteId===value.siteId);
 const chosenBoms=selected?.producesSkuId?boms.filter(x=>str(x.parentSkuId)===selected.producesSkuId&&
  (!str(x.siteId)||str(x.siteId)===value.siteId)):[];
 const nextStageCode=()=>{
  let index=ops.length+1,code='';
  do{code='STG_'+String(index++).padStart(9,'0');}while(ops.some(s=>s.code===code));
  return code;
 };
 const addStage=()=>{
  if(ops.length>=60){setStepNotice('Routing supports a maximum of 60 stages.');return;}
  const code=nextStageCode();
  updateSteps([...ops,{...freshStage(code),dependsOn:ops.length?[ops[ops.length-1].code]:[]}]);
  setOpenStep(code);setSection('stages');setStepNotice('');
 };
 const duplicateStage=(source:RoutingStep)=>{
  if(ops.length>=60){setStepNotice('Routing supports a maximum of 60 stages.');return;}
  const code=nextStageCode(),at=ops.findIndex(s=>s.code===source.code);
  // Do not clone the producing SKU/BOM: that could duplicate material demand.
  // The user must explicitly configure the new stage output and inputs.
  const copy:RoutingStep={...source,code,name:source.name?'Copy of '+source.name:'',
   producesSkuId:'',bomId:'',dependsOn:[source.code]};
  updateSteps([...ops.slice(0,at+1),copy,...ops.slice(at+1)]);
  setOpenStep(code);
  setStepNotice('Stage copied without an output SKU or BOM to prevent duplicated consumption.');
 };
 const dropStage=(code:string)=>{
  updateSteps(ops.filter(s=>s.code!==code).map(s=>({...s,
   dependsOn:(s.dependsOn||[]).filter(x=>x!==code)})));
  if(openStep===code)setOpenStep('');
  setStepNotice('Stage removed from this draft. Its dependency links were also removed.');
 };
 const move=(code:string,offset:-1|1)=>{
  const index=ops.findIndex(s=>s.code===code),other=index+offset;
  if(index<0||other<0||other>=ops.length)return;
  const reordered=[...ops];[reordered[index],reordered[other]]=[reordered[other],reordered[index]];
  const seen=new Set<string>();
  for(const stage of reordered){
   if((stage.dependsOn||[]).some(dep=>!seen.has(dep))){
    setStepNotice('Cannot move this stage across one of its predecessors. Update dependencies first.');
    return;
   }
   seen.add(stage.code);
  }
  updateSteps(reordered);setStepNotice('');
 };
 const check=async()=>{
  setReviewBusy(true);setReview(null);setReviewError('');setSection('review');
  try{
   const found=await callBackend<Review>('/api/org/pln-mfg/foundation/routing-review',{
    record:{...value,routingModelVersion:2}});
   setReview(found);
  }catch(e){setReviewError(e instanceof Error?e.message:'Routing review failed.');}
  finally{setReviewBusy(false);}
 };
 const upgrade=()=>{
  update('routingModelVersion',2);
  onChange({...value,routingModelVersion:2,alternativeCode:str(value.alternativeCode)||'STANDARD',
   operations:ops.map(s=>({...freshStage(s.code),...s}))});
  setSection('setup');setStepNotice('Legacy routing is now a draft of the enriched process path. Validate all stages before release.');
 };
 return <div className='min-w-0 space-y-4'>
  {legacy&&<div className='space-y-2 rounded-xl border border-amber-500/50 p-3 text-sm'>
   <p className='font-semibold'>Legacy routing structure</p>
   <p className='text-xs text-muted'>Existing route data remains unchanged. Adopt the new stage-level cost centre, BOM and capacity model explicitly.</p>
   <Action onClick={upgrade}>Upgrade draft routing structure</Action>
  </div>}
  {!legacy&&<div className='grid grid-cols-3 gap-1 rounded-xl border border-line bg-page p-1' role='group' aria-label='Routing configuration sections'>
   {([
    ['setup','1. Setup'],['stages','2. Stages'],['review','3. Review'],
   ] as Array<[typeof section,string]>).map(([key,label])=>
    <button key={key} type='button' aria-pressed={section===key} onClick={()=>setSection(key)}
     className={'min-h-11 rounded-lg px-1 text-xs font-semibold '+
      (section===key?'bg-panel text-brand shadow-sm':'text-muted')}>{label}</button>)}
  </div>}
  {loadError&&<p role='alert' className='rounded-xl border border-amber-500/50 p-3 text-xs text-amber-700'>{loadError}</p>}
  {(section==='setup'||legacy)&&<div className='space-y-3'>
   <p className='text-sm font-semibold'>Routing setup</p>
   <div className='grid gap-3 sm:grid-cols-2'>
    <Choice label='Production site' value={value.siteId||''}
     options={[['','Select site'],...sites.map(s=>[s.id,s.name+' · '+s.code] as [string,string])]}
     onChange={siteId=>{setReview(null);onChange({...value,siteId,
      operations:ops.map(s=>({...s,costCenterId:'',resourceId:'',bomId:''}))});}}/>
    <Choice label='Manufactured output SKU' value={value.skuId||''}
     options={[['','Select produced finished or intermediate SKU'],
      ...availableOutputs.map(x=>[x.id,x.name] as [string,string])]}
     onChange={skuId=>{const chosen=items.find(x=>x.id===skuId);
      onChange({...value,skuId,
       name:str(value.name)||((chosen?.name||'New SKU')+' · Routing'),routingModelVersion:2});}}/>
    <TextField label='Routing name' value={value.name} onChange={name=>update('name',name)}/>
    <TextField label='Alternative code' value={value.alternativeCode||'STANDARD'}
     onChange={alternativeCode=>update('alternativeCode',alternativeCode.toUpperCase())}/>
    <TextField label='Effective from (optional)' type='date' value={value.effectiveFrom||''}
     onChange={effectiveFrom=>update('effectiveFrom',effectiveFrom)}/>
    <TextField label='Routing description (optional)' value={str(value.description)}
     onChange={description=>update('description',description)}/>
   </div>
   {value.skuId&&<p className='text-xs text-muted'>
    Main manufactured output: {items.find(x=>x.id===value.skuId)?.name||value.skuId}
    {' · '+str(items.find(x=>x.id===value.skuId)?.category)}
   </p>}
   <div className='rounded-xl bg-page p-3 text-xs text-muted'>
    Routing is a versioned description of how the selected SKU is manufactured. Stages may use different manufacturing
    cost centres within the same site. Commissioned rates, materials and assets remain owned by their respective masters.
   </div>
   {!legacy&&<div className='flex justify-end'><Action primary onClick={()=>setSection('stages')}>Configure stages</Action></div>}
  </div>}
  {!legacy&&section==='stages'&&<div className='space-y-3'>
   <div className='flex flex-wrap items-center justify-between gap-2'>
    <div><h3 className='text-sm font-semibold'>Manufacturing stages · {ops.length}</h3>
     <p className='text-xs text-muted'>Choose a card to edit. Parallel stages may share predecessors.</p></div>
    <Action onClick={addStage} primary disabled={ops.length>=60}>Add stage</Action>
   </div>
   {stepNotice&&<p role='status' className='rounded-lg border border-line p-2 text-xs'>{stepNotice}</p>}
   {ops.map((stage,i)=>{
    const expanded=openStep===stage.code;
    const center=centers.find(x=>x.id===stage.costCenterId);
    const resource=resources.find(x=>x.id===stage.resourceId);
    const output=items.find(x=>x.id===stage.producesSkuId);
    return <section key={stage.code} className='min-w-0 rounded-xl border border-line bg-panel p-3'>
     <div className='flex items-start justify-between gap-2'>
      <button type='button' className='min-w-0 flex-1 text-left'
       onClick={()=>{setOpenStep(expanded?'':stage.code);setStepNotice('');}}
       aria-expanded={expanded} aria-controls={'routing-stage-'+stage.code}>
       <p className='break-words text-sm font-semibold'>
        <span className='text-brand'>{expanded?'▾':'▸'} {i+1}.</span> {stage.name||'New manufacturing stage'}
       </p>
       <p className='mt-1 break-words text-xs text-muted'>
        {center?.name||'Cost centre missing'} · {resource?.name||'Resource missing'}
       </p>
       <p className='text-xs text-muted'>Output: {output?.name||stage.producesSkuId||'Not selected'}
        {' · '+(stage.dependsOn?.length||0)+' predecessor(s)'}</p>
      </button>
      <div className='flex flex-wrap justify-end gap-1'>
       <Action disabled={i===0} onClick={()=>move(stage.code,-1)}>↑</Action>
       <Action disabled={i===ops.length-1} onClick={()=>move(stage.code,1)}>↓</Action>
      </div>
     </div>
     {expanded&&<div id={'routing-stage-'+stage.code} className='mt-3 space-y-4 border-t border-line pt-3'>
      <div className='grid gap-3 sm:grid-cols-2'>
       <TextField label='Stage description' value={stage.name}
        onChange={name=>updateStep(stage.code,{name})}/>
       <TextField label='Process classification code' value={stage.processClass||'GENERAL'}
        onChange={processClass=>updateStep(stage.code,{processClass:processClass.toUpperCase().replace(/\s+/g,'_')})}/>
       <p className='sm:col-span-2 text-xs text-muted'>Suggested classes: {classes.slice(0,10).join(', ')}. Other codes are supported.</p>
       <Choice label='Stage type' value={stage.stageType||'PRODUCE'}
        options={stageTypes as Array<[string,string]>}
        onChange={stageType=>updateStep(stage.code,{stageType:stageType as RoutingStep['stageType'],
         ...(stageType!=='PRODUCE'?{bomId:''}:{})})}/>
       <Choice label='Manufacturing cost centre' value={stage.costCenterId||''}
        options={[['','Select site manufacturing cost centre'],...centersForSite.map(x=>[x.id,x.name+' · '+x.code] as [string,string])]}
        onChange={costCenterId=>updateStep(stage.code,{costCenterId})}/>
       <Choice label='Primary manufacturing resource' value={stage.resourceId}
        options={[['','Select configured resource'],...resourcesForSite.map(x=>[x.id,x.name] as [string,string])]}
        onChange={resourceId=>updateStep(stage.code,{resourceId})}/>
       <Choice label='Stage output SKU / intermediate' value={stage.producesSkuId||''}
        options={[['','No manufactured output'],...availableOutputs.map(x=>[x.id,x.name] as [string,string])]}
        onChange={producesSkuId=>updateStep(stage.code,{producesSkuId,bomId:''})}/>
       {stage.stageType==='PRODUCE'&&<Choice label='Referenced stage BOM' value={stage.bomId||''}
        options={[['','Select BOM for this stage output'],...chosenBoms.map(x=>[x.id,
         x.name+' · '+(str(x.status)||'draft')+' · '+(str(x.alternativeCode)||'STANDARD')] as [string,string])]}
        onChange={bomId=>updateStep(stage.code,{bomId})}/>}
       <Choice label='Capacity basis' value={stage.capacityBasis||'RESOURCE_RATE'}
        options={capacityBases as Array<[string,string]>}
        onChange={capacityBasis=>updateStep(stage.code,{capacityBasis:capacityBasis as RoutingStep['capacityBasis']})}/>
       <TextField label='Setup / changeover minutes' type='number' min='0' value={num(stage.setupMinutes)}
        onChange={v=>updateStep(stage.code,{setupMinutes:Number(v)})}/>
       {stage.capacityBasis==='TIME_PER_UNIT'&&<TextField label='Run minutes per output unit'
        type='number' min='0' value={num(stage.runMinutesPerUnit)}
        onChange={v=>updateStep(stage.code,{runMinutesPerUnit:Number(v)})}/>}
       {stage.capacityBasis==='BATCH_CYCLE'&&<>
        <TextField label='Batch size / output quantity' type='number' min='0'
         value={num(stage.batchSize)} onChange={v=>updateStep(stage.code,{batchSize:Number(v)})}/>
        <TextField label='Batch cycle minutes' type='number' min='0'
         value={num(stage.cycleMinutes)} onChange={v=>updateStep(stage.code,{cycleMinutes:Number(v)})}/>
       </>}
      </div>
      <div className='rounded-lg bg-page p-3 text-xs'>
       {stage.capacityBasis==='PHYSICAL_CONTAINER'?<>
        <p className='font-semibold'>Commissioned physical-container speed</p>
        <p className='mt-1'>{speedBusy?'Checking authoritative cost-centre rating…':
         speed?.text||'Choose a commissioned stage SKU and its manufacturing cost centre.'}</p>
        {speed?.detail&&<p className='mt-1 text-muted'>{speed.detail}</p>}
        {selectedCostCenter&&selectedOutput&&!selectedCostCenter.commissionedSkuIds.includes(selectedOutput.id)&&
         <p className='mt-1 text-amber-700'>This cost centre does not yet have a physical-container rating for the selected output SKU.</p>}
       </>:stage.capacityBasis==='RESOURCE_RATE'?<>
        <p className='font-semibold'>Resource master rate (not duplicated in routing)</p>
        <p className='mt-1'>{selectedResource?
         fmt(num(selectedResource.rate))+' '+str(selectedResource.rateUom)+'/hour':
         'Select a manufacturing resource to see its rating.'}</p>
       </>:<p>Derived cycle throughput is checked in Routing Review.</p>}
      </div>
      {stage.bomId&&<details className='rounded-lg border border-line p-3'>
       <summary className='cursor-pointer text-sm font-semibold'>Stage BOM components (read only)</summary>
       <div className='mt-2 space-y-1 text-xs'>
        {((boms.find(b=>b.id===stage.bomId)?.components||[]) as Array<{skuId:string;quantity:number;uom:string}>)
         .map((component,j)=><p key={j}>{items.find(x=>x.id===component.skuId)?.name||component.skuId}:
          {' '+fmt(component.quantity)+' '+component.uom}</p>)}
       </div>
      </details>}
      <fieldset className='space-y-2 rounded-lg border border-line p-3'>
       <legend className='px-1 text-xs font-semibold'>Required predecessor stages</legend>
       {ops.slice(0,i).map(previous=><label key={previous.code} className='flex min-h-10 items-center gap-2 text-xs'>
        <input type='checkbox' checked={(stage.dependsOn||[]).includes(previous.code)}
         onChange={event=>updateStep(stage.code,{dependsOn:event.target.checked?
          [...(stage.dependsOn||[]),previous.code]:(stage.dependsOn||[]).filter(x=>x!==previous.code)})}/>
        {previous.name||previous.code}
       </label>)}
       {i===0&&<p className='text-xs text-muted'>First stage has no predecessors.</p>}
      </fieldset>
      <div className='flex flex-wrap justify-end gap-2'>
       <Action disabled={ops.length>=60} onClick={()=>duplicateStage(stage)}>Duplicate stage</Action>
       <Action onClick={()=>dropStage(stage.code)}>Remove stage</Action>
      </div>
     </div>}
    </section>;
   })}
   {!ops.length&&<p className='text-sm text-muted'>Add your first process stage.</p>}
   <div className='flex flex-wrap justify-between gap-2'>
    <Action onClick={()=>setSection('setup')}>Routing setup</Action>
    <Action onClick={()=>void check()} primary>Review routing</Action>
   </div>
  </div>}
  {!legacy&&section==='review'&&<div className='space-y-3'>
   <div className='flex flex-wrap items-center justify-between gap-2'>
    <h3 className='text-sm font-semibold'>Routing readiness & capacity review</h3>
    <Action disabled={reviewBusy} onClick={()=>void check()}>{reviewBusy?'Checking…':'Refresh review'}</Action>
   </div>
   {reviewError&&<p role='alert' className='rounded-lg border border-red-400 p-3 text-xs text-red-600'>{reviewError}</p>}
   {reviewBusy&&<p role='status' className='text-sm text-muted'>Validating stage references and capacities…</p>}
   {!review&&!reviewBusy&&!reviewError&&<p className='text-sm text-muted'>
    Validate the draft to check stage dependencies, approved BOMs, configured cost centres and rate compatibility.
   </p>}
   {review&&<>
    <p role='status' className='rounded-lg border border-line p-3 text-sm font-semibold'>
     {review.ready?'Routing is ready for approval submission.':
      review.issues.length+' readiness issue(s) require correction before submission.'}
    </p>
    {review.issues.length>0&&<div className='space-y-2'>
     {review.issues.map((issue,i)=><p key={i} className='rounded-lg border border-amber-500/50 p-3 text-xs'>
      <strong>{issue.stageCode} · {issue.field}: </strong>{issue.message}
     </p>)}
    </div>}
    <h4 className='font-semibold'>Stage throughput — read-only sources</h4>
    <div className='grid gap-2 sm:grid-cols-2'>
     {review.stages.map(s=><div key={s.code} className='min-w-0 rounded-lg border border-line p-3'>
      <p className='break-words text-xs font-semibold'>{s.name||s.code}</p>
      <p className='mt-1 text-sm font-semibold'>{s.capacity?
       fmt(s.capacity.quantity)+' '+s.capacity.unit:'Capacity not ready'}</p>
      <p className='mt-1 text-xs text-muted'>{s.capacity?.source||s.capacityBasis}</p>
      <p className='mt-2 text-xs text-muted'>
       Predecessors: {s.dependsOn.length?s.dependsOn.join(', '):'None · parallel start possible'}
      </p>
      <p className='text-xs text-muted'>Setup: {fmt(s.setupMinutes)} min
       {s.runMinutesPerUnit>0?' · '+fmt(s.runMinutesPerUnit)+' min/unit':''}
       {s.bomComponentCount>0?' · '+s.bomComponentCount+' BOM component(s)':''}
      </p>
     </div>)}
    </div>
    {review.bottlenecks.map(b=><p key={b.outputSkuId} className='rounded-lg border border-line p-3 text-xs'>
     <strong>Comparable SKU bottleneck:</strong> {items.find(x=>x.id===b.outputSkuId)?.name||b.outputSkuId}
     {' · '+b.limitingStageCode+' · '+fmt(b.physicalContainersPerHour)+' physical containers/hour'}
    </p>)}
    <p className='text-xs text-muted'>{review.comparisonNote}</p>
   </>}
   <div className='flex justify-end'><Action onClick={()=>setSection('stages')}>Back to stages</Action></div>
  </div>}
  <p className='text-xs text-muted'>
   Save stores a manufacturing routing draft only. Technical submission and independent approval use the existing MFG governance workflow;
   no stock, supplier, production or finance posting is triggered here.
  </p>
 </div>;
}
