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
type MappedStage={code:string;producesSkuId?:string;bomId?:string;
 setupMinutes?:number;runMinutesPerUnit?:number;batchSize?:number;cycleMinutes?:number;
 capacityBasis?:RoutingStep['capacityBasis']};
type SkuMapping={skuId:string;stages:MappedStage[]};
type RoutingRecord=Row&{skuId?:string;siteId?:string;processClassId?:string;alternativeCode?:string;
 effectiveFrom?:string;routingModelVersion?:number;operations?:RoutingStep[];
 skuMappings?:SkuMapping[]};
type CostCenter={id:string;name:string;code:string;siteId:string;legalEntityId:string;commissionedSkuIds:string[]};
type Diagnostic={stageCode:string;field:string;message:string};
type StagePreview={code:string;name:string;stageType:string;producesSkuId:string;costCenterId:string;
 resourceId:string;bomId:string;capacityBasis:string;dependsOn:string[];
 setupMinutes:number;runMinutesPerUnit:number;bomComponentCount:number;
 capacity:{quantity:number;unit:string;source:string;revision?:number}|null};
type Review={ready:boolean;issues:Diagnostic[];stages:StagePreview[];
 bottlenecks:Array<{outputSkuId:string;limitingStageCode:string;physicalContainersPerHour:number;
 comparableStageCodes:string[]}>;comparisonNote:string;
 skuReviews?:Array<{skuId:string;ready:boolean;issues:Diagnostic[];stages:StagePreview[]}>};
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
 ['BATCH_CYCLE','One batch: quantity and time'],
 ['TIME_PER_UNIT','Run minutes per output unit'],
];
const classes=['GENERAL','MATERIAL_PREPARATION','BLENDING','BLOW_MOULDING','FILLING',
 'CAPPING','INSPECTION','LABELLING','CASE_PACKING','PALLETIZATION','TRANSFER','QUALITY',
 'HEAT_TREATMENT','ASSEMBLY','MACHINING','FORMING','EXTRUSION','CLEANING','OTHER'];
const freshStage=(code:string):RoutingStep=>({
 code,name:'',resourceId:'',producesSkuId:'',dependsOn:[],setupMinutes:0,runMinutesPerUnit:0,
 costCenterId:'',bomId:'',processClass:'GENERAL',stageType:'PRODUCE',
 capacityBasis:'PHYSICAL_CONTAINER',batchSize:0,cycleMinutes:0,
});
const stageList=(input:unknown):RoutingStep[]=>Array.isArray(input)?input as RoutingStep[]:[];
/** Stage editor does not write to resources, BOMs or equipment; it only saves routing references. */
export default function PlnProcessRoutingEditor({value,onChange,items,boms,resources,sites,processClasses}:{
 value:RoutingRecord;onChange:(next:RoutingRecord)=>void;items:Row[];boms:Row[];resources:Row[];
 sites:Array<{id:string;name:string;code:string}>;processClasses:Array<{id:string;name:string;enabled?:boolean}>}){
 const [centers,setCenters]=useState<CostCenter[]>([]);
 const [loadError,setLoadError]=useState('');
 const [section,setSection]=useState<'setup'|'stages'|'skus'|'review'>('setup');
 const [skuToAdd,setSkuToAdd]=useState('');
 const [openStep,setOpenStep]=useState('');
 const [review,setReview]=useState<Review|null>(null);
 const [reviewBusy,setReviewBusy]=useState(false);
 const [reviewError,setReviewError]=useState('');
 const [speed,setSpeed]=useState<{text:string;detail:string}|null>(null);
 const [speedBusy,setSpeedBusy]=useState(false);
 const [stepNotice,setStepNotice]=useState('');
 const legacy=value.routingModelVersion!==2;
 const ops=stageList(value.operations);
 const skuMappings=Array.isArray(value.skuMappings)?value.skuMappings:[];
 const selected=ops.find(s=>s.code===openStep);
 const selectedOutput=items.find(x=>x.id===selected?.producesSkuId);
 const update=(field:string,input:unknown)=>{
  setReview(null);setReviewError('');
  onChange({...value,[field]:input});
 };
 const updateSteps=(next:RoutingStep[])=>update('operations',next);
 const updateStep=(code:string,changes:Partial<RoutingStep>)=>
  updateSteps(ops.map(s=>s.code===code?{...s,...changes}:s));
 const addSkuMapping=()=>{
  if(!skuToAdd||skuToAdd===value.skuId||skuMappings.some(x=>x.skuId===skuToAdd))return;
  const final=[...ops].reverse().find(x=>(x.stageType||'PRODUCE')==='PRODUCE');
  const stages:MappedStage[]=final?[{code:final.code,producesSkuId:skuToAdd,bomId:''}]:[];
  update('skuMappings',[...skuMappings,{skuId:skuToAdd,stages}]);
  setSkuToAdd('');
 };
 const updateSkuStage=(skuId:string,code:string,patch:Partial<MappedStage>)=>
  update('skuMappings',skuMappings.map(mapping=>mapping.skuId!==skuId?mapping:{
   ...mapping,stages:[...mapping.stages.filter(x=>x.code!==code),
    {...(mapping.stages.find(x=>x.code===code)||{code}),...patch}],
  }));
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
    !value.siteId||str(selectedOutput?.category)==='INTERMEDIATE')return;
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
 },[selected?.costCenterId,selected?.producesSkuId,selected?.capacityBasis,selectedOutput?.category,value.siteId]);
 // SKU identity is organization-wide; stage cost-centre mapping controls commissioned capacity.
 const availableOutputs=useMemo(()=>items.filter(x=>
  ['FINISHED','INTERMEDIATE'].includes(str(x.category))),[items]);
 // A process class groups final SKUs, not component and intermediate stage outputs.
 const classOptions=[...processClasses.filter(x=>x.enabled!==false),
  ...processClasses.filter(x=>x.id===value.processClassId&&x.enabled===false)];

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
  onChange({...value,routingModelVersion:2,alternativeCode:str(value.alternativeCode),
   operations:ops.map(s=>({...freshStage(s.code),...s}))});
  setSection('setup');setStepNotice('Legacy routing is now a draft of the enriched process path. Validate all stages before release.');
 };
 return <div className='min-w-0 space-y-4'>
  {legacy&&<div className='space-y-2 rounded-xl border border-amber-500/50 p-3 text-sm'>
   <p className='font-semibold'>Existing routing stage configuration</p>
   <p className='text-xs text-muted'>Existing route data remains intact. Complete the stage-level resource, BOM and capacity configuration in a revised route.</p>
   <Action onClick={upgrade}>Open stage-based editor</Action>
  </div>}
  {!legacy&&<div className='grid grid-cols-4 gap-1 rounded-xl border border-line bg-page p-1' role='group' aria-label='Routing configuration sections'>
   {([
    ['setup','1. Setup'],['stages','2. Stages'],['skus','3. SKUs'],['review','4. Review'],
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
     onChange={siteId=>{setReview(null);onChange({...value,siteId});}}/>
    <Choice label='Manufacturing process classification' value={value.processClassId||''}
     options={[['','No classification assigned'],...classOptions.map(x=>[x.id,x.name] as [string,string])]}
     onChange={processClassId=>{
      // Process classification never silently deletes a previously entered BOM,
      // stage or SKU allocation. Mismatches are shown for explicit correction.
      onChange({...value,processClassId});
      setSkuToAdd('');setReview(null);
     }}/>
    <p className='sm:col-span-2 text-xs text-muted'>Select the process family configured under Product Configuration. SKUs in the same family can share this route even when their recipes differ. Classifications are organization-managed, not limited to any particular industry.</p>
    {value.skuId&&<div className='sm:col-span-2 rounded-xl border border-line p-3 text-xs'>
     <p><strong>Already included SKU:</strong> {items.find(x=>x.id===value.skuId)?.name||value.skuId}</p>
     <p className='mt-1 text-muted'>This saved route includes the displayed SKU. Other SKUs are managed in the SKU allocation section.</p>
     {str(items.find(x=>x.id===value.skuId)?.processClassId)!==str(value.processClassId)&&
      <p role='alert' className='mt-1 text-amber-700'>The existing SKU and routing have different manufacturing process classifications. Reclassify deliberately; no SKU or BOM is changed automatically.</p>}
    </div>}
    <TextField label='Routing name' value={value.name} onChange={name=>update('name',name)}/>
    <div>
     <TextField label='Route alternative code' value={str(value.alternativeCode)}
      onChange={alternativeCode=>update('alternativeCode',alternativeCode.toUpperCase())}/>
     <p className='mt-1 text-xs text-muted'>Edit freely, including clearing the whole field. Enter a distinctive code for another manufacturing method. Empty codes are allowed while editing but must be completed before saving.</p>
    </div>
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
    One route describes a shared process: its stages, sequence and resources. The same route can serve multiple SKUs with different recipes.
    Map additional SKUs in the SKUs tab, each with its own stage BOMs. Create a different route if the equipment, stages or sequence changes.
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
        onChange={costCenterId=>updateStep(stage.code,{costCenterId,
         resourceId:resource&&str(resource.costCenterId)&&str(resource.costCenterId)!==costCenterId?'':stage.resourceId})}/>
       <Choice label='Primary manufacturing resource' value={stage.resourceId}
        options={[['','Select configured resource'],...resourcesForSite.filter(x=>
         !str(x.costCenterId)||str(x.costCenterId)===stage.costCenterId)
         .map(x=>[x.id,x.name] as [string,string])]}
        onChange={resourceId=>{
         const chosen=resources.find(x=>x.id===resourceId);
         updateStep(stage.code,{resourceId,
          ...(str(chosen?.sourceKind)==='PRODUCTION_COST_CENTER'?{
           capacityBasis:'PHYSICAL_CONTAINER',costCenterId:str(chosen?.costCenterId)
          }:{})});
        }}/>
       <Choice label='Stage output SKU / intermediate' value={stage.producesSkuId||''}
        options={[['','No manufactured output'],...availableOutputs.map(x=>[x.id,x.name] as [string,string])]}
        onChange={producesSkuId=>{
         const chosen=items.find(x=>x.id===producesSkuId);
         updateStep(stage.code,{producesSkuId,bomId:'',
          ...(str(chosen?.category)==='INTERMEDIATE'&&stage.capacityBasis==='PHYSICAL_CONTAINER'
             ?{capacityBasis:'BATCH_CYCLE' as const}:{})});
        }}/>
       {stage.stageType==='PRODUCE'&&<Choice label='Referenced stage BOM' value={stage.bomId||''}
        options={[['','Select BOM for this stage output'],...chosenBoms.map(x=>[x.id,
         x.name+' · '+(str(x.status)||'draft')+' · '+(str(x.alternativeCode)||'STANDARD')] as [string,string])]}
        onChange={bomId=>updateStep(stage.code,{bomId})}/>}
       <Choice label='Capacity basis — how do you measure this step?' value={stage.capacityBasis||'PHYSICAL_CONTAINER'}
        options={capacityBases.filter(x=>
         (str(resource?.sourceKind)!=='PRODUCTION_COST_CENTER'||x[0]!=='RESOURCE_RATE')&&
         (str(output?.category)!=='INTERMEDIATE'||x[0]!=='PHYSICAL_CONTAINER')) as Array<[string,string]>}
        onChange={capacityBasis=>updateStep(stage.code,{capacityBasis:capacityBasis as RoutingStep['capacityBasis']})}/>
       <div className='sm:col-span-2 rounded-xl border border-line bg-page p-3 text-xs'>
        <p className='font-semibold text-ink'>Which option should I use?</p>
        <p className='mt-1 text-muted'>
         {stage.capacityBasis==='BATCH_CYCLE'?
          'Use this when you make a fixed quantity at a time, like mixing a tank of syrup. Enter how much one batch makes and how long it runs.':
          stage.capacityBasis==='TIME_PER_UNIT'?
          'Use this if you know how many minutes it takes to make one item.':
          stage.capacityBasis==='RESOURCE_RATE'?
          'Use this when the selected machine already has an hourly rate saved in Manufacturing Resources.':
          'Use this for a finished product with a saved commissioned line speed, such as bottles per hour.'}
        </p>
        <details className='mt-2'>
         <summary className='cursor-pointer font-medium text-brand'>Help me choose a method</summary>
         <p className='mt-2 text-muted'>Bottling line with a recorded speed? Use commissioned physical-container speed. Machine with a known hourly rate? Use manufacturing resource rate. Mixing one tank at a time? Use batch quantity and time. One item takes a known number of minutes? Use time per unit.</p>
        </details>
       </div>
       <div>
        <TextField label='Preparation time (setup / changeover minutes)' type='number' min='0'
         value={num(stage.setupMinutes)} onChange={v=>updateStep(stage.code,{setupMinutes:Number(v)})}/>
        <p className='mt-1 text-xs text-muted'>Minutes to get ready before production, e.g. cleaning, adjusting settings or changing tools. Enter 0 if none.</p>
       </div>
       {stage.capacityBasis==='TIME_PER_UNIT'&&<div>
        <TextField label='Time to make one unit (minutes)' type='number' min='0'
         value={num(stage.runMinutesPerUnit)}
         onChange={v=>updateStep(stage.code,{runMinutesPerUnit:Number(v)})}/>
        <p className='mt-1 text-xs text-muted'>Example: enter 2 if one item needs 2 minutes.</p>
       </div>}
       {stage.capacityBasis==='BATCH_CYCLE'&&<>
        <div>
         <TextField label='Batch size — how much is made?' type='number' min='0'
          value={num(stage.batchSize)} onChange={v=>updateStep(stage.code,{batchSize:Number(v)})}/>
         <p className='mt-1 text-xs text-muted'>Amount made in ONE batch, not the daily target. For example, 30,000 litres if the output SKU is measured in litres.</p>
        </div>
        <div>
         <TextField label='Batch time — minutes to make one batch' type='number' min='0'
          value={num(stage.cycleMinutes)} onChange={v=>updateStep(stage.code,{cycleMinutes:Number(v)})}/>
         <p className='mt-1 text-xs text-muted'>How long one batch runs AFTER preparation. For a 2-hour batch, enter 120; do not include setup time.</p>
        </div>
        {num(stage.batchSize)>0&&num(stage.cycleMinutes)>0&&<div className='sm:col-span-2 space-y-1 rounded-xl border border-line bg-page p-3 text-xs' role='status'>
         <p className='font-semibold text-ink'>Your numbers explained</p>
         <p>You make <strong>{fmt(num(stage.batchSize))} output units</strong> in <strong>{fmt(num(stage.cycleMinutes))} minutes</strong>.</p>
         <p>Production pace: <strong>{fmt(num(stage.batchSize)*60/num(stage.cycleMinutes))} output units/hour</strong> (while running, without setup).</p>
         <p>First batch with one preparation: <strong>{fmt(num(stage.setupMinutes)+num(stage.cycleMinutes))} minutes</strong> ({fmt(num(stage.setupMinutes))} preparation + {fmt(num(stage.cycleMinutes))} production).</p>
         <p className='text-muted'>The output unit comes from the selected stage SKU. This preview does not change calculations: the app tracks preparation separately from the hourly production rate. Repeat setup only when it really happens.</p>
        </div>}
       </>}
      </div>
      <div className='rounded-lg bg-page p-3 text-xs'>
       {str(output?.category)==='INTERMEDIATE'?<>
        <p className='font-semibold'>Intermediate product: use this step's own capacity</p>
        <p className='mt-1 text-muted'>For a product still being made (e.g. syrup), the app does not assume the bottle-filling speed. Tell us how fast this step makes its own output, using the method above.</p>
       </>:stage.capacityBasis==='PHYSICAL_CONTAINER'?<>
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
    <Action onClick={()=>setSection('skus')} primary>Next: map SKUs</Action>
   </div>
  </div>}
  {!legacy&&section==='skus'&&<div className='space-y-3'>
   <div className='rounded-xl border border-line bg-page p-3'>
    <h3 className='text-sm font-semibold'>Which SKUs follow this manufacturing route?</h3>
    <p className='mt-1 text-xs text-muted'>Same site, same sequence and resources? Use this route for more SKUs, even when the recipes are different. Choose a separate alternative route if the manufacturing process changes.</p>
    <p className='mt-2 text-sm'><strong>Process classification:</strong> {classOptions.find(x=>x.id===value.processClassId)?.name||'Not selected'}</p>
    {value.skuId&&<p className='mt-1 text-sm'><strong>Already included SKU:</strong> {items.find(x=>x.id===value.skuId)?.name||value.skuId}</p>}
    <p className='mt-1 text-xs text-muted'>Assign the SKUs and their specific stage BOMs below. Existing site and cost-centre allocations are not changed.</p>
   </div>
   <div className='flex flex-col gap-2 sm:flex-row sm:items-end'>
    <div className='min-w-0 flex-1'>
     <Choice label='Add another SKU to the shared route' value={skuToAdd}
      options={[['','Choose manufactured SKU'],...availableOutputs.filter(x=>
       x.id!==value.skuId&&str(x.processClassId)===str(value.processClassId)&&!skuMappings.some(m=>m.skuId===x.id)).map(x=>[x.id,x.name] as [string,string])]}
      onChange={setSkuToAdd}/>
    </div>
    <Action primary disabled={!skuToAdd||!value.processClassId||skuMappings.length>=100||!ops.length} onClick={addSkuMapping}>Map SKU</Action>
   </div>
   {skuMappings.map(mapping=><section key={mapping.skuId} className='space-y-3 rounded-xl border border-line bg-panel p-3'>
    <div className='flex flex-wrap items-start justify-between gap-2'>
     <div>
      <h4 className='text-sm font-semibold'>{items.find(x=>x.id===mapping.skuId)?.name||mapping.skuId}</h4>
      <p className='text-xs text-muted'>Same route; different SKU-specific recipe and output settings</p>
     </div>
     <Action onClick={()=>update('skuMappings',skuMappings.filter(x=>x.skuId!==mapping.skuId))}>Remove SKU</Action>
    </div>
    {ops.filter(stage=>(stage.stageType||'PRODUCE')==='PRODUCE').map(stage=>{
     const override=mapping.stages.find(x=>x.code===stage.code);
     const outputSkuId=override?.producesSkuId??stage.producesSkuId??'';
     const selectedBom=override?.bomId??stage.bomId??'';
     const choices=boms.filter(b=>str(b.parentSkuId)===outputSkuId&&(!str(b.siteId)||str(b.siteId)===value.siteId));
     return <div key={stage.code} className='space-y-3 rounded-lg border border-line p-3'>
      <p className='text-xs font-semibold'>{stage.name||stage.code}</p>
      <Choice label='Output made at this stage' value={outputSkuId}
       options={[['','Choose stage output'],...availableOutputs.map(x=>[x.id,x.name] as [string,string])]}
       onChange={producesSkuId=>updateSkuStage(mapping.skuId,stage.code,{producesSkuId,bomId:''})}/>
      <Choice label='Recipe / BOM used by this SKU' value={selectedBom}
       options={[['','Select BOM for this output'],...choices.map(x=>[x.id,x.name+' · '+(str(x.status)||'draft')] as [string,string])]}
       onChange={bomId=>updateSkuStage(mapping.skuId,stage.code,{bomId})}/>
      <details className='text-xs'>
       <summary className='cursor-pointer font-semibold text-brand'>Different batch size or processing time? (optional)</summary>
       <div className='mt-2 grid gap-2 sm:grid-cols-2'>
        {([
         ['setupMinutes','Preparation minutes'],
         ['batchSize','Batch quantity'],
         ['cycleMinutes','Batch cycle minutes'],
         ['runMinutesPerUnit','Minutes per output unit'],
        ] as const).map(([field,label])=><div key={field}>
         <TextField label={label} type='number' min='0'
          value={override?.[field]??(stage[field]||0)}
          onChange={v=>updateSkuStage(mapping.skuId,stage.code,{[field]:Number(v)})}/>
        </div>)}
       </div>
       <p className='mt-1 text-muted'>Keep these unchanged to inherit the shared stage values. Commissioned SKU-specific speeds come automatically from the common manufacturing resource master.</p>
      </details>
     </div>;
    })}
   </section>)}
   {!skuMappings.length&&<p className='text-xs text-muted'>{value.skuId?'The previously included SKU is assigned. Map others if needed.':'No SKUs mapped yet. Map at least one product and its stage BOMs before submitting this route for approval.'}</p>}
   <div className='flex flex-wrap justify-between gap-2'>
    <Action onClick={()=>setSection('stages')}>Back to stages</Action>
    <Action primary onClick={()=>void check()}>Review all mapped SKUs</Action>
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
    {review.skuReviews&&review.skuReviews.length>1&&<div className='space-y-2 rounded-lg border border-line p-3'>
     <h4 className='text-sm font-semibold'>Mapped SKU readiness</h4>
     {review.skuReviews.map(r=><p key={r.skuId} className='text-xs'>
      <strong>{items.find(x=>x.id===r.skuId)?.name||r.skuId}</strong>
      {' · '+(r.ready?'Ready':r.issues.length+' issue(s) to correct')}
     </p>)}
    </div>}
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
