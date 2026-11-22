import {useMemo,useRef,useState} from 'react';

type Chapter={
 id:string;title:string;phase:string;summary:string;screen?:string;status?:string;
 topics:Array<{title:string;purpose:string;steps:string[];example?:string;checks?:string[];warning?:string}>;
};
const guide:Chapter[]=[
 {id:'start',title:'Start here: configuration sequence',phase:'Orientation',summary:'Understand which records must exist before production planning can use them.',topics:[
  {title:'Configuration order and ownership',purpose:'Set up the hierarchy first, then the product, BOM, resources, line capacity, route and planning rules.',steps:[
   'Confirm your legal entity, site, manufacturing department and manufacturing-classified cost centres in Organization Design / Finance.',
   'Open Production Planning & MRP. Configure Manufacturing Setup and Product Configuration before creating manufactured SKUs.',
   'Create materials and finished/intermediate products, BOMs and manufacturing resources.',
   'Configure each resource’s SKU-specific commissioned throughput using its SKU allocation tab, then set up Process Routings.',
   'Set the planning horizon, frozen period and strategy; enter and review demand.',
   'Use role-specific maker-checker workflow to approve manufacturing BOMs and routings; drafts are not an approved production release.',
  ],example:'Fictional example: Demo LE → Demo Nairobi Site → Manufacturing → Filling/Packaging Cost Centre. This illustration is not live plant master data.',
   checks:['Only authorized legal entities and sites should be available.','A manufacturing cost centre must carry the adopted manufacturing classification.']},
  {title:'Permissions and draft controls',purpose:'Different teams own different master records.',steps:[
   'Product and SKU configuration requires organization manufacturing configuration permission.',
   'BOMs and routings have separate editing, submission and approval permissions.',
   'New masters are saved as drafts; approved versions must not be overwritten. Create a new managed revision instead.',
   'Reopen the relevant setup to review changes from other authorized users. Check the error shown after a failed save.',
  ],warning:'Documentation does not grant permissions or bypass required approvals.'},
 ]},
 {id:'manufacturing',title:'1. Manufacturing Setup',phase:'Foundation',summary:'Establish material consumption and intermediate tracking policies.',screen:'Manufacturing Setup',topics:[
  {title:'Intermediate handling',purpose:'Choose the default policy for in-process products.',steps:[
   'Open Manufacturing Setup under Foundation.',
   'Choose Non-stock or Stock-managed as the default intermediate tracking rule.',
   'Enable or disable non-stock direct consumption and metered utilities according to your operating model.',
   'Review production/MRP relevance of each configured BOM classification.',
   'Save manufacturing setup and confirm the success message and revision.',
  ],example:'Fictional syrup preparation may have a non-stock intermediate when it transfers directly to filling; an off-line batch in a holding tank may need stock-managed intermediate tracking.'},
  {title:'BOM classifications',purpose:'Classifications determine what may be used in manufacturing and MRP.',steps:[
   'Expand BOM classifications.',
   'Keep the required Production classification available.',
   'Add additional classifications only when needed and decide whether each may be used for production and MRP.',
   'Disable, rather than delete, classifications already referenced by saved BOMs.',
  ]},
 ]},
 {id:'product',title:'2. Product identity and production form',phase:'Foundation',summary:'Distinguish what a product is, how it is produced and the production units that become a specific SKU.',screen:'Product Configuration',topics:[
  {title:'Product/Variant, production form and SKU: what is the difference?',purpose:'Learn how reusable definitions become one specific product master record.',steps:[
   'Product/Variant is what the product or grade is: its reusable name and business code. Multiple sizes and packs can use one identity.',
   'Manufacturing Process Classification is how the product is made. It groups SKUs to compatible routings and does not mean flavour or recipe.',
   'Production Form describes its physical output form and measurement basis, such as liquid in litres, solids in kilograms or fabric in square metres.',
   'An SKU is the particular manufactured product or intermediate record with a separate SKU_ master ID. Containment and packaging, when required, distinguish otherwise similar finished SKUs.',
   'The same Product/Variant, Production Form and process group can belong to more than one SKU, while SKU BOMs and permitted production-resource mappings remain individually configured.',
   'In Materials & Products → Add SKU, select the process group and relevant Product/Variant and Production Form. Intermediate/WIP can use its own entered name; Production Form is required when its physical SKU composition and conversions are configured.',
  ],example:'Illustrative: Cola Original, Liquid (L) and a PET carbonated process are shared by a 500 mL PET 24-pack SKU and a different 1 L PET 12-pack SKU. Nothing here is an industry preset.'},

  {title:'Manufacturing process classifications',purpose:'Group different SKUs by their shared manufacturing method, not their product variant or recipe.',steps:[
   'Open Product Configuration → Manufacturing Process Classifications and create the process groups relevant to your organization.',
   'Name each classification, enter a unique readable business code and describe its manufacturing method. The generated PRC identifier remains separate. No industry list is hard-coded.',
   'Assign the classification when creating an SKU. For an existing approved SKU, use Classify manufacturing process on its card to change only classification metadata without changing its SKU code, BOM, site allocation or commissioned speeds.',
   'One process classification can offer different approved routing alternatives when a production method or equipment changes.',
  ],example:'Possible user-defined groups include continuous extrusion, batch blending, precision machining, textile weaving, industrial assembly and thermal processing. None are predefined classifications.'},
  {title:'Product/Variant',purpose:'Define reusable brand, flavour, grade or variant identity.',steps:[
   'Open Product Configuration → Product identity → Product/Variant.',
   'Add the product name and unique code; enter the description where useful.',
   'Save the active identity and return to the main configuration menu.',
  ],example:'Fictional: DEMO-ORANGE / Demo Orange Beverage. No commercial or financial record is created.'},
  {title:'Production forms',purpose:'Choose the dimensional output represented by each SKU.',steps:[
   'Open Production Forms and select the form or create one. This represents a material quantity, not its bottle, package or pallet.',
   'Select a published MEMS unit such as L for liquid, kg for bulk solids, m for wire, or m² for sheet material.',
   'Ensure the physical-container size can be converted into this dimension.',
  ],example:'A 400 mL bottle can be related to beverage production form L. A coil measured in metres must have an approved length-based size.'},
 ]},
 {id:'primary',title:'3. Primary containers and rated output',phase:'Foundation',summary:'Distinguish the material container from the unit that determines line speed.',screen:'Product Configuration → Physical Containers',topics:[
  {title:'Primary container category, type and attributes',purpose:'Describe the product’s physical containment or produced unit.',steps:[
   'Open Physical Containers → Add and select a published category.',
   'Select its subcategory/type (for example PET bottle, pouch, drum or other industrial container).',
   'Complete the technical properties required by the selected type.',
   'Define the actual size in Container Sizes: volume, mass, length or area as applicable.',
  ],example:'Fictional Demo 400 mL PET bottle: category PET, type PET bottle, size 400 mL.'},
  {title:'What is counted for line speed?',purpose:'The output type gives the throughput a meaning that Each (ea) alone cannot provide.',steps:[
   'In the physical-container editor, find Manufacturing line speed / rated output basis.',
   'Select Output type used for line speed. Examples include Bottle, Can, Case, Carton, Pallet, Piece, Component, Kilogram, Litre and Metre.',
   'Choose the Count multiplier (Each, Dozen, etc.) separately. Each is one of the selected output, not necessarily one bottle.',
   'Save. The chosen output type becomes the default on newly added cost-centre SKU ratings.',
   'If a line has a different output basis for a particular SKU, change it in that cost-centre SKU rating before saving.',
  ],example:'Fictional: Bottle + Each + Hour = bottles/hour; Case + Each + Hour = cases/hour; Kilogram + Each + Hour = kg/hour.',
   checks:['The unit of output and count multiplier are two distinct fields.','An existing saved SKU rating will not silently change when the primary-container default changes.']},
  {title:'How output conversions work',purpose:'Different output types need different verified source relationships.',steps:[
   'Primary/discrete output (bottle, piece, tube, part, roll): one rated output equals one configured SKU primary unit.',
   'Commercial output (case, carton, box): use the selected SKU commercial package containing a known number of primary units.',
   'Logistics output (pallet, load): use the selected SKU’s transport packaging hierarchy.',
   'Measured output (L, kg, m, m², m³): convert through the SKU production-form unit and primary-container size using the MEMS unit registry.',
   'Custom output: explicitly enter the number of physical primary units per rated output in the cost-centre editor.',
   'Resolve missing relationships before saving. The system must not assume a case always contains 12 bottles or that all units are bottles.',
  ],example:'Fictional: 2,000 cases/h × a configured 12 bottles/case = 24,000 bottles/h. A SKU with 24 bottles/case would produce 48,000 bottles/h at the same case rate.',
   warning:'A rating expressed in a different industry output dimension is converted only when the SKU master provides an exact, compatible relationship.'},
 ]},
 {id:'packs',title:'4. Commercial and logistics packaging',phase:'Foundation',summary:'Configure nested commercial and transport relationships for output conversion.',screen:'Product Configuration',topics:[
  {title:'Commercial packaging and size',purpose:'Define saleable unit and contents independently of the primary container.',steps:[
   'Open Commercial Packaging, select the published package type, enter its identity and save.',
   'Open Commercial Packaging Sizes and enter the quantity of primary units in the commercial package.',
   'When building the finished SKU, select the appropriate commercial package and size.',
  ],example:'Fictional: Demo 400 mL PET beverage, commercial package “Case”, 12 primary bottles.'},
  {title:'Transport and logistics',purpose:'Define an optional larger unit for logistics and palletized outputs.',steps:[
   'Open Transport & Logistics Packaging.',
   'Select an approved transport type and its relationships (packages per pallet or equivalent).',
   'On the finished SKU, select the transport configuration and layering data if applicable.',
   'Verify that derived cases/hour and pallets/hour use the same time period as the selected commissioned line speed.',
  ],example:'Fictional: 100 cases/pallet at 2,000 cases/h means 20 pallets/h, if the 100-case relationship is configured.'},
 ]},
 {id:'naming',title:'5. SKU Naming Sequence',phase:'Foundation',summary:'Configure naming independently of Product Identity.',screen:'Product Configuration → SKU Naming Sequence',topics:[
  {title:'Sequence rules',purpose:'Set the displayed manufactured-SKU name order without replacing internal generated codes.',steps:[
   'Open the standalone SKU Naming Sequence section.',
   'Add and order the required fields and separators. Choose Manufacturing process classification → Code to include its business code, or Name to include the classification name.',
   'Review the example name and save the naming sequence. Existing process classifications without a business code must be edited to supply one before it can appear in generated SKU names.',
   'Existing SKU names remain unchanged unless explicitly regenerated through their authorized edit process.',
  ],example:'Fictional: PROCESS_A_PRODUCT_400mL_12PACK, where PROCESS_A is an organization-defined manufacturing process classification code. The internal SKU_######### remains database-generated.'},
 ]},
 {id:'skus',title:'6. Materials & Products',phase:'Master data',summary:'Create manufactured, continuous, bulk and sourced materials without losing existing site allocations.',screen:'Materials & Products',topics:[
  {title:'Continuous and multi-source supply configuration',purpose:'Use one material identity for equivalent material from different sources, with separate source costs.',steps:[
   'Create or edit a manufactured or purchased material SKU; an internal continuously produced material can remain non-stocked when appropriate.',
   'Expand Material supply, continuous flow & buffers. Choose its production method and physical handling independently.',
   'Use Add source to enter each source, site, meter reference, approved unit, currency and tariff.',
   'Keep Inventory stock treatment in the existing material setup. Source profiles do not create receipts, actual metering or invoice charges.',
   'If two sources supply equivalent material specifications, keep one material SKU unless a quality or regulatory distinction requires separation.',
  ],example:'Two measured water intakes with distinct rates may feed one treated-water SKU; one gas specification may be supplied by a generator or bulk delivery.'},

  {title:'Create a manufactured SKU',purpose:'Establish the exact SKU identity and packaged output relationship.',steps:[
   'Open Materials & Products, then Add SKU.',
   'Select Finished or Intermediate and choose the manufacturing process classification. SKUs are organization-wide, not tied to a single site.',
   'For finished goods, choose Product/Variant, Production Form, Physical Container, Container Size, Commercial Packaging and size; transport packaging is optional.',
   'Check derived SKU name, physical size and packaged output conversion, then save the draft.',
   'Open View SKU to inspect existing permitted site/cost-centre mappings and commissioned speeds. Classifying a SKU does not change these allocations.',
  ],example:'Fictional finished SKU: Demo Orange 400 mL PET, 12 bottles/case, 100 cases/pallet.'},
  {title:'Raw and packaging materials',purpose:'Create a properly sourced component reference for BOM use.',steps:[
   'Choose Raw/Input or Packaging Component.',
   'For inventory-sourced materials, select an approved Inventory material reference.',
   'For allowed direct or metered inputs, use the available sourcing mode and required utility configuration.',
   'Save without creating an actual stock issue, PO or purchase requisition.',
  ]},
 ]},
 {id:'bom',title:'7. Bills of Materials / Recipes',phase:'Master data',summary:'Connect products to quantities consumed by each stage.',screen:'Bills of Materials',topics:[
  {title:'Build the material structure',purpose:'Define valid production quantities and exact component UOMs.',steps:[
   'Open Bills of Materials and choose the produced SKU.',
   'Set the output quantity and output unit.',
   'Add each input SKU with required quantity, unit and standard scrap allowance where applicable.',
   'Choose classification, alternative method and effective date if relevant.',
   'Save the draft; after review, submit for independent technical approval.',
  ],example:'Fictional filling output: one filled bottle consumes 0.4 L prepared liquid, one empty 400 mL PET bottle and one compatible cap.'},
  {title:'Multi-level production',purpose:'Separate upstream intermediates while preserving traceability.',steps:[
   'Define upstream intermediates (prepared bulk liquid, empty blown bottle) with their own BOMs.',
   'Use the downstream BOM to reference intermediate SKUs, rather than duplicating their raw inputs.',
   'Review the full manufacturing chain to prevent circular BOM dependencies.',
  ]},
 ]},
 {id:'resources',title:'8. Manufacturing Resources',phase:'Master data',summary:'Adopt authorized production cost centres, configure core information and allocate SKUs.',screen:'Manufacturing Resources',topics:[
  {title:'Resource master',purpose:'Configure core information in the shared manufacturing resource master.',steps:[
   'Open Manufacturing Resources and select Add resources.',
   'Filter your authorized hierarchy and add the required production cost centres.',
   'Open an added resource and save its name, rate unit and notes under Core information.',
   'Use SKU allocation for SKU mapping and commissioned ratings. These share the cost-centre setup used elsewhere.',
  ],example:'Fictional: Demo bottling-line resource with separate commissioned outputs for its mapped SKUs.'},
 ]},
 {id:'capacity',title:'SKU allocation in Manufacturing Resources',phase:'Capacity & process',summary:'Commission SKU throughput within an added resource, rather than a separate setup step.',screen:'Manufacturing Resources → SKU allocation',topics:[
  {title:'Select the manufacturing hierarchy',purpose:'Make sure the correct line/cost centre owns the speed.',steps:[
   'Open Manufacturing Resources and select an added resource.',
   'Open its SKU allocation tab to access the shared cost-centre SKU editor.',
   'Choose Add SKU and select an eligible manufactured SKU.',
  ],example:'Fictional: Demo Plant → Bottling Line A cost centre → Demo Orange 400 mL PET 12-pack.'},
  {title:'Commission rated output',purpose:'Record exact counts for one period without ambiguous output types.',steps:[
   'Expand the selected SKU card and verify physical-container category, type and size.',
   'Choose Output unit used to express line speed. A bottle filler may use Bottle; a case packer may use Case; a bulk system may use Kilogram or Litre.',
   'Choose the Count multiplier (Each, Dozen) and Time period (Hour, Minute etc.).',
   'Enter the commissioned throughput quantity for that output and time period.',
   'Select Calculate linked ratings. Check primary units, production-form, commercial and logistics outputs.',
   'Correct missing conversion errors, save, and confirm the saved revision. Add another SKU without overwriting earlier mappings.',
  ],example:'Fictional: 24,000 bottles/h, 12 bottles/case → 2,000 cases/h. Or enter 2,000 cases/h to derive 24,000 bottles/h from that SKU ratio.',
   checks:['The physical container size matches the selected SKU.','Every derived output retains the configured time denominator.','The output name makes bottles/hour and cases/hour distinguishable.']},
 ]},
 {id:'routing',title:'9. Process Routings',phase:'Capacity & process',summary:'Create a process once, map compatible SKUs, or create a separate route when the process changes.',screen:'Process Routings',topics:[
  {title:'Create a routing',purpose:'Start a manufacturing method for one site.',steps:[
   'Choose Add new route, select its production site and manufacturing process classification. No primary SKU is required to define the common process.',
   'Name the route and freely edit its alternative code. Leave it blank while editing, but enter a valid code before saving. The internal routing master ID remains automatically generated.',
   'Open Stages to configure the common activity sequence, resources and dependencies.',
   'Save the draft. Saving does not execute production or issue materials.',
  ],example:'Fictional: An assembly process can involve material preparation, fitting and testing on shared resources.'},
  {title:'Same process, different recipes',purpose:'Reuse stages and resources instead of making duplicate routings.',steps:[
   'Open SKUs and select Map SKU for the first and subsequent products in the chosen process group.',
   'For each producing stage, choose that SKU’s actual output and corresponding BOM.',
   'Change the batch size or processing time only if it differs from the shared stage.',
   'Review every mapped SKU before submitting the route for approval. At least one mapped SKU and its valid stage BOMs are required.',
  ],example:'Fictional: Different polymer grades may share extrusion equipment but use different recipes; beverage variants may share the same processing stages.'},
  {title:'Create a different route',purpose:'Use another route when the manufacturing process changes.',steps:[
   'Select Add new route to start from scratch or Create different route from this to copy an existing process.',
   'Change the stage order, resources or processing activities that genuinely differ.',
   'Keep the alternative code distinct. Add only SKUs that follow this route.',
   'Save and submit the alternative separately. An approved route alternative must be selected where more than one applies.',
  ],example:'Fictional: A fabricated part needing additional heat treatment or a product needing an extra sterilization stage can require another route.'},
  {title:'Continuous flow, yield and usable buffers',purpose:'Model continuously flowing material without inventing a batch cycle.',steps:[
   'Choose Continuous flow (quantity/hour) in a manufacturing stage.',
   'Enter its hourly rated output and its published UoM; include resource and predecessor links.',
   'Configure upstream material required per unit of output when process yield or recipe conversion differs from one-to-one.',
   'Enter usable buffer above minimum operating level, or leave it blank if unknown. Buffer depletion estimates need this value.',
   'Observe the capacity opportunity in Stages and the confirmed result in Review.',
  ],example:'Illustrative: 30,000 L/h mixer feeding 35,000 L/h filling demand creates a 5,000 L/h deficit, or 14.29% of demand.'},
  {title:'Review and approve',purpose:'Protect stage accuracy and existing maker-checker governance.',steps:[
   'Configure each stage’s resource, cost centre, output and predecessors.',
   'Use commissioned line speed, resource rate, batch cycle or time per unit as appropriate.',
   'Open Review to check each SKU’s BOM and capacity and verify the routing graph.',
   'Publish only through the independent technical approval workflow. Approved routing records remain immutable.',
  ],example:'Fictional: Preparation + bottle blowing → filling → packaging.'},
 ]},
 {id:'flowOverview',title:'Capacity Overview: all process flows',phase:'Capacity & process',
  summary:'Compare upstream and downstream capacities, percentage gaps and buffer constraints for permitted routes.',
  screen:'Production Capacity Overview',topics:[
   {title:'Capacity and improvement opportunities',purpose:'Inspect every permitted process and SKU-specific variant.',steps:[
    'Open Capacity overview in Configuration and select the permitted site or all permitted sites.',
    'Review each routing and the individual SKU variants, using the page controls when there are many flows.',
    'Read the shortfall as a percentage of required downstream input, hourly deficit and available-buffer coverage.',
    'Unmatched units or multiple independent feed branches are not silently added; resolve them with verified conversion ratios.',
    'Recalculate after changing capacities. This does not read live equipment telemetry or calculate invoiced source costs.',
   ],example:'Illustrative: 2,500 L usable buffer with a 5,000 L/h flow gap lasts about 30 minutes.'},
  ]},
 {id:'planning',title:'10. Planning Configuration',phase:'Planning',summary:'Set planning rules after the manufacturing masters are established.',screen:'Planning Configuration',topics:[
  {title:'Horizon and freeze period',purpose:'Provide a reproducible date horizon and constraints.',steps:[
   'Open Planning Configuration.',
   'Set planning horizon days and frozen period days (freeze must not exceed horizon).',
   'Choose strategy: make-to-stock, make-to-order, assemble-to-order, engineer-to-order or hybrid as applicable.',
   'Choose lot-sizing policy and save the controlled configuration.',
  ],example:'Fictional training setup: 90-day horizon, 7-day frozen period, Make to Stock, Lot-for-Lot. These are demonstration settings, not recommended site defaults.'},
 ]},
 {id:'demand',title:'11. Demand & S&OP',phase:'Planning',summary:'Review demand inputs using approved product identities and dates.',screen:'Demand & S&OP',topics:[
  {title:'Enter or review demand',purpose:'Keep demand source and SKU allocation auditable.',steps:[
   'Open Demand & S&OP and choose the authorized site and SKU scope.',
   'Enter or import supported demand records according to the current UI.',
   'Review duplicates, planned dates, revisions and forecast or firm-demand classification.',
   'Check records for conflicts before using them as inputs to later planning calculations.',
  ],example:'Fictional: Demo Orange 400 mL 12-pack, 10,000 cases required in a future planning week. This is training data only.'},
 ]},
 {id:'future',title:'12. Subsequent planning and execution',phase:'Roadmap',summary:'Understand which advanced areas still require implementation and verification.',status:'Planned / not part of this guide’s live setup',topics:[
  {title:'MPS, finite capacity, MRP and production orders',purpose:'Do not mistake design intent for an operational transaction function.',steps:[
   'Master Production Scheduling should translate approved demand into feasible proposed production quantities, using versioned BOMs and routings.',
   'Rough-cut and finite capacity should use validated output units and calendars without double-counting rated efficiency or downtime.',
   'MRP should explode effective approved BOMs and only create governed proposals for materials and replenishment.',
   'Production orders, stage confirmations, inventory receipts and financial posting require their own approved execution workflows.',
  ],warning:'These are target capabilities; do not treat the presence of a configuration screen as confirmation that end-to-end MPS, finite scheduling, stock posting or production execution is live.'},
 ]},
 {id:'examples',title:'Worked fictional examples by industry',phase:'Reference',summary:'Compare discrete, packaging, logistics and process-industry throughput.',topics:[
  {title:'Beverage bottle and case',purpose:'One SKU may be rated at either bottle count or commercial case count.',steps:[
   'Create PET bottle 400 mL as the primary output; configure commercial case = 12 bottles.',
   'For a filling line use Bottle / Each / Hour and 24,000 as an example rated output.',
   'For the downstream case packer use Case / Each / Hour and 2,000, with the same configured SKU case relationship.',
   'Both correspond to 24,000 primary bottles/hour when the rated-output basis is correctly selected.',
  ],example:'All names and quantities in this documentation are fictional.'},
  {title:'Powder filling, sheet forming, machining and pallets',purpose:'The rated output can be a physical count or a compatible dimensional quantity.',steps:[
   'Powder in 25 kg sacks: use Bag when counting sacks, or Kilogram when measuring compatible mass throughput.',
   'Metal sheet: use Sheet for discrete count; Square metre for area output only if the SKU production form and size use compatible area units.',
   'Machined parts: use Piece, Component or Part; line speed becomes pieces/hour, components/hour or parts/hour.',
   'Warehouse palletizer: use Pallet and a configured transport packaging relationship so pallets/hour can resolve to SKU primary units.',
  ],warning:'A tonne/hour flow cannot be converted to pieces/hour without an explicit production-form and per-piece size relationship.'},
 ]},
 {id:'trouble',title:'13. Troubleshooting and verification',phase:'Reference',summary:'Interpret save faults, missing speed mappings and incompatible conversions.',topics:[
  {title:'SKU does not save',purpose:'Resolve each required field rather than guessing a default.',steps:[
   'Open the SKU card with the displayed validation issue.',
   'Verify selected SKU, primary container and size match the adopted Product Configuration.',
   'Verify output type, Count multiplier, time period and positive commissioned quantity.',
   'For Case output confirm the SKU commercial pack size; for Pallet confirm transport layering.',
   'For mass, volume, length or area output confirm dimensional compatibility with the SKU production form.',
   'For Custom output enter primary units per rated output explicitly. Save again and confirm the revision.',
  ]},
  {title:'Throughput looks incorrect',purpose:'Trace the source rate before accepting derived logistics or product counts.',steps:[
   'Check whether your number represents Bottles/Hour, Cases/Hour, Kilograms/Hour or a different basis.',
   'Check Each versus Dozen and Hour versus Minute, which multiply or divide the stated number.',
   'Open the SKU and verify package sizes and transport ratios.',
   'Verify the cost centre is authorized and mapped to the same SKU.',
   'Use Calculate linked ratings and compare the displayed source basis and converted quantities.',
  ]},
 ]},
];
const pageTargets:Record<string,string>={
 manufacturing:'materialPolicy',product:'skuSetup',primary:'skuSetup',packs:'skuSetup',naming:'skuSetup',
 skus:'items',bom:'boms',resources:'resources',capacity:'resources',routing:'routings',flowOverview:'capacityOverview',
 planning:'config',demand:'demand',
};
function ExampleScreen(){
 return <figure className='overflow-hidden rounded-xl border border-line bg-page'>
  <div className='border-b border-line bg-panel px-3 py-2 text-xs font-semibold'>Illustrative screen layout · not a captured screenshot</div>
  <div className='grid gap-2 p-3 text-xs sm:grid-cols-2'>
   <div className='space-y-2'>
    <p className='font-semibold'>Manufacturing cost centre · Demo Line A</p>
    <div className='rounded-lg border border-line p-2'>Manufactured SKU: Demo Orange 400 mL / 12-pack</div>
    <div className='rounded-lg border border-line p-2'>Physical container: PET bottle · 400 mL</div>
   </div>
   <div className='space-y-2'>
    <div className='rounded-lg border border-line p-2'>Output type: <strong>Case</strong></div>
    <div className='rounded-lg border border-line p-2'>Count: <strong>Each</strong> · Period: <strong>Hour</strong></div>
    <div className='rounded-lg border border-line p-2'>Rated quantity: <strong>2,000 cases/hour</strong></div>
   </div>
   <div className='rounded-lg border border-line bg-panel p-2 sm:col-span-2'>Derived primary output: <strong>24,000 bottles/hour</strong> from configured 12 bottles/case</div>
  </div>
  <figcaption className='px-3 pb-3 text-xs text-muted'>Fictional calculation illustrating the fields and relationship, not a real commissioned line rating.</figcaption>
 </figure>;
}
export default function PlnDocumentation({onNavigate}:{onNavigate:(tab:string)=>void}){
 const [query,setQuery]=useState('');
 const [selected,setSelected]=useState('start');
 const view=useRef<HTMLDivElement>(null);
 const search=query.trim().toLowerCase();
 const visible=useMemo(()=>guide.filter(chapter=>!search||[
  chapter.title,chapter.phase,chapter.summary,...chapter.topics.flatMap(t=>[
   t.title,t.purpose,...t.steps,t.example||'',t.warning||'',
  ])].join(' ').toLowerCase().includes(search)),[search]);
 const index=Math.max(0,visible.findIndex(x=>x.id===selected));
 const current=visible[index];
 const choose=(id:string)=>{setSelected(id);if(view.current)view.current.scrollTop=0;};
 return <section className='min-w-0 space-y-3' aria-label='Production Planning and MRP documentation'>
  <header className='rounded-xl border border-line bg-panel p-3 sm:p-4'>
   <h2 className='text-lg font-semibold'>Production Planning & MRP · Documentation</h2>
   <p className='mt-1 text-sm text-muted'>Step-by-step setup, reference topics, validation checks and explicitly fictional examples. The guide is read-only; configurations must be saved in their own screens.</p>
   <label className='mt-3 block text-xs font-semibold' htmlFor='production-help-search'>Search topics, examples and errors</label>
   <input id='production-help-search' className='mt-1 min-h-11 w-full rounded-lg border border-line bg-page px-3 text-sm'
    value={query} onChange={e=>setQuery(e.target.value)}
    placeholder='e.g. cases/hour, BOM, cost centre, MRP'/>
  </header>
  <div className='grid min-w-0 gap-3 lg:grid-cols-[minmax(215px,270px)_minmax(0,1fr)]'>
   <nav aria-label='Documentation topics' className='min-w-0 rounded-xl border border-line bg-panel p-3 lg:sticky lg:top-3 lg:max-h-[72vh] lg:overflow-y-auto'>
    <p className='mb-2 text-xs font-semibold text-muted'>{visible.length} topic(s)</p>
    <div className='max-h-48 space-y-1 overflow-y-auto lg:max-h-none'>
     {visible.map(ch=><button key={ch.id} type='button' aria-current={current?.id===ch.id?'page':undefined}
      className={'w-full rounded-lg border p-2 text-left text-xs '+(current?.id===ch.id?'border-brand bg-brand/10 text-brand':'border-transparent text-ink hover:bg-page')}
      onClick={()=>choose(ch.id)}>
      <span className='block text-[10px] font-semibold text-muted'>{ch.phase}</span>
      <span className='mt-1 block break-words font-medium'>{ch.title}</span>
     </button>)}
    </div>
   </nav>
   <div ref={view} className='min-w-0 rounded-xl border border-line bg-panel p-3 sm:p-5 lg:max-h-[72vh] lg:overflow-y-auto'>
    {!current?<p className='text-sm text-muted'>No documentation topics match the search. Try “containers”, “throughput”, “planning” or “BOM”.</p>:
    <article className='min-w-0 space-y-4'>
     <div className='space-y-2'>
      <p className='text-xs font-semibold text-brand'>{current.phase} · Topic {index+1} of {visible.length}</p>
      <h3 className='break-words text-lg font-semibold'>{current.title}</h3>
      <p className='text-sm text-muted'>{current.summary}</p>
      {current.status&&<p className='text-xs font-semibold text-muted'>{current.status}</p>}
      {current.screen&&<p className='text-xs text-muted'>Configuration screen: <strong>{current.screen}</strong></p>}
      {pageTargets[current.id]&&<button type='button' onClick={()=>onNavigate(pageTargets[current.id])}
       className='min-h-10 rounded-lg border border-line bg-page px-3 py-2 text-xs font-semibold'>
       Open corresponding configuration screen
      </button>}
     </div>
     {current.id==='capacity'&&<ExampleScreen/>}
     <div className='space-y-3'>
      {current.topics.map((t,j)=><details key={t.title} className='rounded-xl border border-line p-3'
       open={j===0?true:undefined}>
       <summary className='cursor-pointer text-sm font-semibold'>{j+1}. {t.title}</summary>
       <div className='mt-3 space-y-3'>
        <p className='text-sm text-muted'>{t.purpose}</p>
        <ol className='list-decimal space-y-2 pl-5 text-sm'>
         {t.steps.map((step,k)=><li className='break-words' key={k}>{step}</li>)}
        </ol>
        {t.example&&<div className='rounded-lg border border-line bg-page p-3'>
         <p className='text-xs font-semibold'>Fictional example</p>
         <p className='mt-1 text-sm'>{t.example}</p>
        </div>}
        {t.checks&&<div className='space-y-1'>
         <p className='text-xs font-semibold'>Before continuing</p>
         {t.checks.map((check,k)=><p key={k} className='text-xs'>✓ {check}</p>)}
        </div>}
        {t.warning&&<p className='rounded-lg border border-amber-500/50 p-3 text-xs'>{t.warning}</p>}
       </div>
      </details>)}
     </div>
     <footer className='grid grid-cols-2 gap-2 border-t border-line pt-3'>
      <button type='button' disabled={index===0} className='min-h-11 rounded-lg border border-line px-2 text-xs font-semibold disabled:opacity-40'
       onClick={()=>choose(visible[index-1].id)}>Previous topic</button>
      <button type='button' disabled={index>=visible.length-1} className='min-h-11 rounded-lg border border-line px-2 text-xs font-semibold disabled:opacity-40'
       onClick={()=>choose(visible[index+1].id)}>Next topic</button>
     </footer>
    </article>}
   </div>
  </div>
  <p className='text-xs text-muted'>Documentation version: 20 November 2026 · Illustrations and worked examples are fictional. The guide does not itself create production orders, stock, purchases or financial transactions.</p>
 </section>;
}
