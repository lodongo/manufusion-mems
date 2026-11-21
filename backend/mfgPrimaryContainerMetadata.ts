/**
 * MEMS-admin-governed MFG primary-container metadata.
 *
 * This platform-wide reference catalogue is not tenant master data. A tenant
 * adopts one stable metadata code into its own Physical Containers setup,
 * then chooses the category-specific attributes from the controlled options.
 * Five attribute slots maximum, including all mandatory fields. Data is
 * reference-only: no procurement, packaging, inventory or accounting actions.
 */
import { HttpError, str } from './core';

type AttributeDefinition={key:string;label:string;required:boolean;choices:string[]};
export type MfgPrimaryContainerType={
    code:string;name:string;categoryCode:string;category:string;
    subcategoryCode:string;subcategory:string;sectors:string[];
    attributes:AttributeDefinition[];
};

const options={
    closure:['Screw cap','Snap fit','Crimp','Crown','Cork','Lug','Heat seal','Welded seal','Plug','Open top','Valve','Pump','Sprayer','Dispensing tip','Lid','Tamper band','No closure'],
    shape:['Round','Square','Rectangular','Oval','Cylindrical','Conical','Flat','Tubular','Custom'],
    contact:['Food contact','Pharmaceutical','Cosmetic','Industrial chemical','Agricultural','Medical device','Non-contact','Electrical/electronic'],
    barrier:['Standard','Oxygen barrier','Moisture barrier','Light barrier','Gas barrier','High barrier','Aseptic barrier'],
    tamper:['Tamper evident','Child resistant','Security seal','Induction seal','Not required'],
    strength:['Light duty','Medium duty','Heavy duty','UN performance rated'],
    sterile:['Sterile','Non-sterile','Aseptically filled','Sterilizable'],
    lining:['Uncoated','Food-grade lacquer','Epoxy-free lacquer','Polymer lined','Aluminium lined','Chemically resistant'],
    dispensing:['Pour','Pump','Dropper','Spray','Squeeze','Metered dose','Single dose','No dispenser'],
    reuse:['Single use','Returnable','Refillable','Reusable'],
    seal:['Heat sealed','Induction sealed','Zipper','Adhesive','Crimp','Mechanical closure','Valve','Unsealed'],
    esd:['Not ESD rated','Dissipative','Conductive','Shielding'],
    duty:['Ambient','Hot fill','Cold fill','Retort','Refrigerated','Frozen','Cryogenic'],
    handling:['Manual','Palletised','Forklift','Hoist','Automated line'],
    pressure:['Atmospheric','Carbonated','Pressurised','Vacuum rated'],
    grain:['Dry solids','Granules','Powder','Liquid','Paste','Tablets/capsules','Components'],
} as const;
type AttrKey=keyof typeof options;
const names:Record<AttrKey,string>={
    closure:'Closure',shape:'Shape',contact:'Contact class',barrier:'Barrier',tamper:'Tamper protection',
    strength:'Duty rating',sterile:'Sterility',lining:'Internal lining',dispensing:'Dispensing system',
    reuse:'Reuse',seal:'Seal type',esd:'ESD rating',duty:'Temperature duty',
    handling:'Handling',pressure:'Pressure rating',grain:'Contents form',
};
function attributes(keys:readonly AttrKey[]):AttributeDefinition[]{
    if(keys.length>5)throw new Error('MFG primary-container metadata exceeds five attributes');
    return keys.map((key,i)=>({key,label:names[key],required:i<Math.min(2,keys.length),choices:[...options[key]]}));
}
type CatalogSeed={
    code:string;name:string;sectors:string[];
    template:readonly AttrKey[];items:string[];
};
const seed:CatalogSeed[]=[
    {code:'GLA',name:'Glass containers',sectors:['Food & beverage','Pharmaceutical','Cosmetics','Laboratory','Chemicals'],
        template:['closure','shape','contact','barrier','reuse'],
        items:['Glass bottle','Returnable glass bottle','Glass jar','Glass vial','Glass ampoule','Glass carboy','Glass dropper bottle','Glass demijohn','Glass cosmetic bottle','Glass laboratory flask','Glass aerosol-free dispenser']},
    {code:'PET',name:'PET and polyester containers',sectors:['Beverage','Food','Personal care','Chemicals','Pharmaceutical'],
        template:['closure','shape','contact','barrier','duty'],
        items:['PET bottle','Hot-fill PET bottle','Returnable PET bottle','PET jar','PET tub','PET tray','PET blister cavity','PET clamshell','PET canister','PET preform container']},
    {code:'POL',name:'Other rigid plastic containers',sectors:['Food & beverage','Industrial','Agriculture','Medical','Cosmetics','Automotive'],
        template:['closure','shape','contact','strength','reuse'],
        items:['HDPE bottle','HDPE jerrycan','HDPE drum','LDPE squeeze bottle','PP tub','PP bucket','PP bottle','PP jar','PP vial','PP syringe barrel','PS cup','PS tub','PVC bottle','Polycarbonate bottle','Plastic canister','Plastic cartridge','Plastic pail','Plastic crate','Plastic pallet box','Bioplastic rigid container']},
    {code:'MET',name:'Metal containers',sectors:['Food & beverage','Chemicals','Paint','Industrial','Cosmetics','Pharmaceutical'],
        template:['closure','lining','contact','pressure','strength'],
        items:['Aluminium beverage can','Aluminium aerosol can','Aluminium bottle','Steel food can','Tinplate can','Metal paint tin','Metal pail','Steel drum','Metal keg','Aluminium foil tray','Metal tube','Metal cartridge','Metal pill tin','Metal chemical canister','Metal gas cylinder']},
    {code:'PAP',name:'Paper and fibre containers',sectors:['Food & beverage','Retail','Agriculture','Pharmaceutical','E-commerce'],
        template:['closure','barrier','contact','strength','seal'],
        items:['Folding carton','Gable-top carton','Aseptic carton','Paper cup','Paperboard tray','Paper bowl','Paper canister','Kraft paper sack','Moulded pulp tray','Fibre tube','Fibre drum','Paper sleeve','Fibreboard box','Corrugated shipping box','Paper envelope']},
    {code:'FLX',name:'Flexible films and pouches',sectors:['Food','Beverage','Cosmetics','Medical','Agriculture','Industrial'],
        template:['seal','barrier','contact','grain','duty'],
        items:['Stand-up pouch','Spouted pouch','Doypack','Pillow pouch','Sachet','Stick pack','Flow-wrap pack','Vacuum bag','Retort pouch','Zip-lock bag','Foil laminate pouch','Flexible film bag','Shrink sleeve','Stretch film bag','Woven sack','Fertilizer sack','Seed pouch','Snack bag','Wet-wipes pouch','Flexible refill pack']},
    {code:'COM',name:'Composite and multilayer containers',sectors:['Food & beverage','Industrial','Cosmetics','Pharmaceutical'],
        template:['seal','barrier','contact','strength','reuse'],
        items:['Composite canister','Laminated tube','Bag-in-box liner','Bag-in-box container','Composite cartridge','Multilayer bottle','Foil-lined paper cup','Composite drum','Multi-material blister pack','Aseptic laminate brick']},
    {code:'CER',name:'Ceramic and mineral containers',sectors:['Food','Beverage','Cosmetics','Industrial','Decorative'],
        template:['closure','shape','contact','strength','reuse'],
        items:['Ceramic jar','Ceramic bottle','Porcelain vial','Stoneware jug','Earthenware pot','Ceramic crucible','Ceramic cosmetic vessel','Glass-ceramic tub']},
    {code:'WOD',name:'Wood, bamboo and natural containers',sectors:['Agriculture','Food & beverage','Wine & spirits','Export','Retail'],
        template:['closure','strength','reuse','grain','handling'],
        items:['Wooden barrel','Wooden crate','Wooden box','Wooden basket','Bamboo tube','Bamboo canister','Wicker basket','Wooden produce bin','Wooden cask']},
    {code:'BUL',name:'Bulk, transport and hazardous-goods containers',sectors:['Chemicals','Oil & gas','Mining','Agriculture','Food','Logistics'],
        template:['closure','strength','contact','reuse','handling'],
        items:['Intermediate bulk container','Flexible intermediate bulk container','Bulk bag','Bulk tote','ISO tank container','Portable tank','Flexitank','Plastic drum','Hazardous goods jerrycan','Hazardous goods pail','Industrial hopper','Liquid liner','Dry bulk liner','Pressure vessel package','UN certified drum']},
    {code:'BST',name:'Bulk storage tanks, silos and vessels',sectors:['Food & beverage','Chemicals','Agriculture','Mining','Oil & gas','Pharmaceutical','Utilities','Bulk ingredients'],
        template:['grain','contact','pressure','duty','handling'],
        items:["Stainless-steel bulk liquid storage tank","Carbon-steel bulk storage tank","Food-grade syrup storage tank","Sugar solution storage tank","Water bulk storage tank","Concentrate storage tank","Aseptic holding tank","Jacketed process tank","Insulated bulk liquid tank","Refrigerated bulk storage tank","Heated bulk storage tank","Agitated blend and holding tank","Buffer and surge tank","Atmospheric vertical storage tank","Horizontal storage tank","Pressurized bulk vessel","Vacuum process vessel","CIP solution storage tank","Raw ingredient bulk silo","Sugar silo","Flour or powder silo","Grain storage silo","Cement and mineral silo","Dry powder hopper","Conical discharge hopper","Bulk feed bin","Bulk ingredient bunker","Bulk solid storage bay","Open-top bulk storage pit","Underground bulk storage tank","Flexible bulk storage bladder","Tank farm storage vessel","Bulk tote tank","Mobile bulk process tank","Cryogenic bulk tank","Intermediate process hold vessel","Fermentation storage vessel","Bulk milk storage tank","Oil and fat bulk storage tank","Molasses storage tank"]},
    {code:'MED',name:'Medical and pharmaceutical containers',sectors:['Pharmaceutical','Biotechnology','Healthcare','Diagnostics'],
        template:['sterile','closure','contact','tamper','barrier'],
        items:['Sterile vial','Ampoule','Prefilled syringe','IV infusion bag','Blood bag','Blister strip','Inhaler canister','Auto-injector cartridge','Medical dropper','Eye-drop bottle','Pharmaceutical HDPE jar','Vaccine vial','Specimen container','Diagnostic reagent bottle','Unit dose cup','Dialysis fluid bag']},
    {code:'ELC',name:'Electronics and precision-component containers',sectors:['Electronics','Semiconductor','Automotive','Aerospace'],
        template:['esd','seal','barrier','strength','reuse'],
        items:['ESD bag','Moisture-barrier bag','JEDEC tray','Semiconductor wafer carrier','Conductive plastic tote','Component reel','Component spool','Clamshell component pack','Antistatic blister','IC tube','Protective hard case','Optical component box']},
    {code:'TEX',name:'Textile and woven containers',sectors:['Agriculture','Apparel','Food','Logistics','Chemicals'],
        template:['closure','strength','grain','reuse','handling'],
        items:['Cotton sack','Jute sack','PP woven bag','Fabric tote','Textile garment bag','Filter bag','Linen pouch','Bulk fabric bag','Mesh produce sack']},
    {code:'COS',name:'Personal care and cosmetic containers',sectors:['Cosmetics','Personal care','Home care','Fragrance'],
        template:['dispensing','shape','contact','barrier','reuse'],
        items:['Perfume bottle','Airless pump bottle','Roll-on bottle','Cosmetic compact','Lipstick tube','Deodorant stick','Mascara tube','Cosmetic jar','Lotion pump','Shampoo bottle','Cream tube','Nail polish bottle']},
];
export const MFG_PRIMARY_CONTAINER_CATEGORIES=seed.map(s=>({code:s.code,name:s.name,sectors:s.sectors}));
export const MFG_PRIMARY_CONTAINER_TYPES:MfgPrimaryContainerType[]=seed.flatMap(s=>s.items.map((name,i)=>{
    const suffix=String(i+1).padStart(3,'0');
    return {code:s.code+'_'+suffix,name,categoryCode:s.code,category:s.name,
        subcategoryCode:s.code+'-'+suffix,subcategory:name,sectors:s.sectors,attributes:attributes(s.template)};
}));
const map=new Map(MFG_PRIMARY_CONTAINER_TYPES.map(t=>[t.code,t]));
export function primaryContainerCatalogueFromAdmin(source:unknown):MfgPrimaryContainerType[] {
    if(!Array.isArray(source))return MFG_PRIMARY_CONTAINER_TYPES;
    const published:MfgPrimaryContainerType[]=[];
    const codes=new Set<string>();
    for(const row of source){
        if(!row||typeof row!=='object'||Array.isArray(row))continue;
        const item=row as Record<string,unknown>;
        if(item.active===false||item.selectable===false)continue;
        const code=str(item.code),name=str(item.label),category=str(item.category);
        const categoryCode=str(item.categoryCode),subcategory=str(item.subcategory);
        const subcategoryCode=str(item.subcategoryCode);
        const fields=Array.isArray(item.attributes)?item.attributes:[];
        if(!/^[A-Z]{3}_[0-9]{3}$/.test(code)||!name||!category||!categoryCode||
            !subcategory||!subcategoryCode||fields.length>5||codes.has(code))continue;
        const normalized:AttributeDefinition[]=[];
        let valid=true;
        for(const field of fields){
            if(!field||typeof field!=='object'||Array.isArray(field)){valid=false;break;}
            const attr=field as Record<string,unknown>;
            const key=str(attr.key),label=str(attr.label);
            const choices=Array.isArray(attr.choices)?attr.choices.filter(x=>typeof x==='string'&&x.length>0&&x.length<=80):[];
            if(!/^[a-zA-Z][a-zA-Z0-9_]{1,29}$/.test(key)||!label||choices.length<2||choices.length>30||
                new Set(choices).size!==choices.length||normalized.some(x=>x.key===key)){valid=false;break;}
            normalized.push({key,label,required:attr.required===true,choices});
        }
        if(!valid)continue;
        codes.add(code);
        published.push({code,name,category,categoryCode,subcategory,subcategoryCode,
            sectors:Array.isArray(item.sectors)?item.sectors.filter(x=>typeof x==='string') as string[]:[],
            attributes:normalized});
    }
    // Expand previously published catalogs additively with new stationary bulk-storage
    // types. Never revive an explicitly disabled or non-selectable published code.
    if(!published.length)return MFG_PRIMARY_CONTAINER_TYPES;
    const present=new Set(source.filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'&&!Array.isArray(row))
        .map(row=>str(row.code)));
    return [...published,...MFG_PRIMARY_CONTAINER_TYPES.filter(type=>
        type.categoryCode==='BST'&&!present.has(type.code))];
}
export function getPrimaryContainerMetadata(code:string,types:MfgPrimaryContainerType[]=MFG_PRIMARY_CONTAINER_TYPES):MfgPrimaryContainerType|null{
    return types===MFG_PRIMARY_CONTAINER_TYPES?map.get(code)??null:types.find(t=>t.code===code)??null;
}
export function validatePrimaryContainerSelection(metadataCode:string,raw:unknown,types:MfgPrimaryContainerType[]=MFG_PRIMARY_CONTAINER_TYPES){
    const type=getPrimaryContainerMetadata(metadataCode,types);
    if(!type)throw new HttpError(400,'Select a published MEMS primary-container type.');
    const input=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw as Record<string,unknown>:{};
    const selected:Record<string,string>={};
    for(const field of type.attributes){
        const chosen=str(input[field.key]).trim();
        if(field.required&&!chosen)throw new HttpError(400,'Select '+field.label+' for '+type.name+'.');
        if(chosen&&!field.choices.includes(chosen))throw new HttpError(400,'Invalid '+field.label+' for '+type.name+'.');
        if(chosen)selected[field.key]=chosen;
    }
    const extras=Object.keys(input).filter(k=>!type.attributes.some(a=>a.key===k));
    if(extras.length)throw new HttpError(400,'Unrecognized container attribute: '+extras[0]+'.');
    return {metadataCode:type.code,categoryCode:type.categoryCode,subcategoryCode:type.subcategoryCode,
        name:type.name,containerAttributes:selected};
}
