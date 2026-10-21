/** Codified global RCA reference catalogues. DMAIC governs all selectable analytical methods. */
export const RCA_METHODS=[
 ['5WHY','Five Whys','Iterative causal questioning; record each why and its evidence'],
 ['ISH','Ishikawa / Fishbone','Categorized causal branches using 5M1E, 6M or configured dimensions'],
 ['FTA','Fault Tree Analysis','Top event, Boolean logic and supporting causal branches'],
 ['FMEA','Failure Mode and Effects Analysis','Failure modes, causes, controls and scored risk priorities'],
 ['8D','Eight Disciplines','Team-based containment, cause, correction and prevention'],
 ['A3','A3 Problem Solving','Evidence-based one-page problem solving'],
 ['KT','Kepner-Tregoe','Problem specification and is/is-not distinction'],
 ['PARETO','Pareto Analysis','Prioritize causes by measured frequency or impact'],
 ['CAUSAL','Causal Factor Tree','Chronological event and condition causal mapping'],
 ['BOWTIE','Bow-Tie','Threats, consequences, prevention and recovery barriers'],
 ['DMAIC','DMAIC Analysis','Define, Measure, Analyze, Improve and Control'],
] as const;
const mk=(values:readonly (readonly [string,string,...string[]])[])=>
 values.map(([code,label,description])=>({code,label,description:description??label,active:true}));
export const RCA_METADATA_LISTS=[
 {key:'rcaMethods',title:'RCA analysis methods',description:'User-selectable investigation techniques governed by DMAIC stages.',version:1,items:mk(RCA_METHODS)},
 {key:'rcaFrameworks',title:'RCA standardized reference frameworks',description:'Controlled causal taxonomies and observation prompts.',version:1,items:mk([
 ['5M1E','5M + Environment','Man/People, Machine, Method, Material, Measurement, Mother Nature/Environment'],
 ['5M1W','5M1W','Man, Machine, Method, Material, Measurement and Workplace; use the configured organization glossary'],
 ['6M','6M','Man, Machine, Method, Material, Measurement, Mother Nature'],
 ['4M','4M','Man, Machine, Method and Material'],
 ['5W2H','5W2H','What, Why, Where, When, Who, How, How much'],
 ['ISNOT','Is / Is Not','What, where, when and extent comparisons'],
 ['6W','5W1H','Who, What, When, Where, Why, How'],
 ])},
 {key:'rca5m1wFactors',title:'5M1W factor taxonomy',description:'Codified 5M1W reference categories for cause grouping and analysis.',version:1,items:mk([
 ['MAN','Man / People','Competence, capability, behaviors, workload and human factors'],
 ['MACHINE','Machine / Equipment','Condition, design, wear, maintenance, control and reliability'],
 ['METHOD','Method / Process','Procedures, setup, sequence, standard work and controls'],
 ['MATERIAL','Material','Inputs, spares, consumables, specifications and quality'],
 ['MEASUREMENT','Measurement','Calibration, measurement uncertainty, methods and instruments'],
 ['WORKPLACE','Workplace / Environment','Physical work conditions, utilities, layout and ambient conditions']
 ])},
 {key:'rcaDmaicStages',title:'DMAIC investigation stages',description:'Mandatory phase sequence with controlled evidence and verification requirements.',version:1,items:mk([
 ['DEFINE','Define','Problem, impact, scope, team and expected outcome'],
 ['MEASURE','Measure','Baseline, magnitude, evidence, timelines and data reliability'],
 ['ANALYZE','Analyze','Chosen RCA method, testable causal hypotheses and validation'],
 ['IMPROVE','Improve','Containment, corrective and preventive action with accountable owners'],
 ['CONTROL','Control','Effectiveness verification, sustained monitoring and standardization']
 ])},
 {key:'rcaCauseTypes',title:'Root cause classifications',description:'Separate physical, human and systemic causes without assuming blame.',version:1,items:mk([
 ['PHYSICAL','Physical / technical','Direct physical, mechanical, electrical or automation failure'],
 ['HUMAN','Human factors','Human/system interaction and conditions'],
 ['SYSTEM','Systemic / organizational','Process, governance, competency or management-system weakness'],
 ['LATENT','Latent conditions','Unobserved weaknesses and systemic preconditions']
 ])},
 {key:'rcaActionTypes',title:'RCA corrective and preventive actions',description:'Controlled improvement and control-plan actions.',version:1,items:mk([
 ['CONTAIN','Immediate containment','Protect people, quality and equipment'],
 ['CORRECT','Corrective action','Remove verified root causes'],
 ['PREVENT','Preventive action','Prevent occurrence in other assets or processes'],
 ['VERIFY','Effectiveness verification','Demonstrate expected sustained results'],
 ['STANDARD','Standardization','Update SOP, PM, learning and asset knowledge']
 ])}
] as const;
