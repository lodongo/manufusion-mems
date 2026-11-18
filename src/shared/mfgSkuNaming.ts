/**
 * Organization-managed SKU display naming convention.
 * Business naming never changes the generated, immutable SKU_######### record ID.
 * Pure shared logic: used by the frontend preview and the backend save route.
 */
export const SKU_NAME_FIELDS=[
    {key:'productName',label:'Product / SKU name',modes:['NAME','CODE']},
    {key:'productionForm',label:'Production form',modes:['NAME','CODE']},
    {key:'primaryContainer',label:'Physical container',modes:['NAME','CODE']},
    {key:'containerSize',label:'Container size',modes:['NAME','CODE','QUANTITY','QUANTITY_UNIT']},
    {key:'commercialPackaging',label:'Commercial packaging',modes:['NAME','CODE']},
    {key:'commercialPackSize',label:'Commercial packaging size',modes:['NAME','CODE','QUANTITY']},
    {key:'transportPackaging',label:'Transport & logistics packaging',modes:['NAME','CODE']},
    {key:'normalizationUnit',label:'Normalization unit',modes:['NAME','CODE','QUANTITY']},
    {key:'commercialProductQuantity',label:'Product quantity per commercial package',modes:['QUANTITY','QUANTITY_UNIT']},
    {key:'normalizedCommercialQuantity',label:'Normalized units per commercial package',modes:['QUANTITY']},
    {key:'transportPackagesPerLayer',label:'Commercial packages per layer',modes:['QUANTITY']},
    {key:'transportLayerCount',label:'Transport layer count',modes:['QUANTITY']},
    {key:'transportTotalUnits',label:'Commercial packages per transport unit',modes:['QUANTITY']},
    {key:'literal',label:'Custom text',modes:['TEXT']},
] as const;
export type SkuNameField=typeof SKU_NAME_FIELDS[number]['key'];
export type SkuNameMode='NAME'|'CODE'|'QUANTITY'|'QUANTITY_UNIT'|'TEXT';
export type SkuNameStep={field:SkuNameField;mode:SkuNameMode;enabled:boolean;text?:string};
export type SkuNamingSequence={separator:string;steps:SkuNameStep[]};
export type SkuNameToken={name?:string;code?:string;quantity?:number;unit?:string};
export type SkuNameValues=Partial<Record<SkuNameField,SkuNameToken>>;
export const SKU_NAME_SEPARATORS=[
    {value:'_',label:'Underscore ( _ )'},
    {value:' ',label:'Space'},
    {value:'-',label:'Hyphen ( - )'},
    {value:'.',label:'Dot ( . )'},
    {value:'/',label:'Slash ( / )'},
    {value:' · ',label:'Middle dot ( · )'},
    {value:'',label:'None'},
];
export const DEFAULT_SKU_NAMING_SEQUENCE:SkuNamingSequence={
    separator:'_',
    steps:[
        {field:'productName',mode:'CODE',enabled:true},
        {field:'containerSize',mode:'QUANTITY_UNIT',enabled:true},
        {field:'primaryContainer',mode:'NAME',enabled:true},
        {field:'commercialPackaging',mode:'NAME',enabled:true},
        {field:'commercialPackSize',mode:'QUANTITY',enabled:true},
        {field:'productionForm',mode:'NAME',enabled:false},
        {field:'transportPackaging',mode:'NAME',enabled:false},
        {field:'normalizationUnit',mode:'NAME',enabled:false},
        {field:'commercialProductQuantity',mode:'QUANTITY_UNIT',enabled:false},
        {field:'normalizedCommercialQuantity',mode:'QUANTITY',enabled:false},
        {field:'transportPackagesPerLayer',mode:'QUANTITY',enabled:false},
        {field:'transportLayerCount',mode:'QUANTITY',enabled:false},
        {field:'transportTotalUnits',mode:'QUANTITY',enabled:false},
    ],
};
export function validateSkuNamingSequence(raw:unknown):SkuNamingSequence{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('SKU naming configuration is required.');
    const value=raw as Record<string,unknown>;
    if(typeof value.separator!=='string'||!SKU_NAME_SEPARATORS.some(s=>s.value===value.separator))
        throw Error('Select an approved SKU name separator.');
    if(!Array.isArray(value.steps)||value.steps.length<1||value.steps.length>32)
        throw Error('Add between 1 and 32 SKU naming components.');
    const steps:SkuNameStep[]=[];
    for(const row of value.steps){
        if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid SKU naming step.');
        const item=row as Record<string,unknown>;
        const field=SKU_NAME_FIELDS.find(f=>f.key===item.field);
        if(!field)throw Error('Invalid SKU naming attribute.');
        if(typeof item.mode!=='string'||!(field.modes as readonly string[]).includes(item.mode))
            throw Error('Select Name, Code or Quantity as applicable to '+field.label+'.');
        if(typeof item.enabled!=='boolean')throw Error('SKU naming step must specify whether it is included.');
        const text=field.key==='literal'?String(item.text??'').trim():undefined;
        if(field.key==='literal'&&item.enabled===true&&(!text||text.length>60||/[\u0000-\u001f\u007f]/.test(text)))
            throw Error('Custom naming text must contain 1–60 printable characters.');
        steps.push({field:field.key,mode:item.mode as SkuNameMode,enabled:item.enabled,
            ...(field.key==='literal'?{text}:{} )});
    }
    if(!steps.some(s=>s.enabled))throw Error('Include at least one SKU naming attribute.');
    return {separator:value.separator,steps};
}
function quantity(v:number|undefined):string{
    return v===undefined||!Number.isFinite(v)?'':String(Number(v.toPrecision(12)));
}
export function formatSkuNameToken(token:SkuNameToken|undefined,mode:SkuNameMode):string{
    if(!token)return '';
    if(mode==='NAME')return String(token.name||'').trim();
    if(mode==='CODE')return String(token.code||'').trim();
    const n=quantity(token.quantity);
    return mode==='QUANTITY_UNIT'&&n?n+String(token.unit||'').trim():n;
}
export function composeSkuNameFromSequence(
    sequence:SkuNamingSequence,values:SkuNameValues,
):string {
    const checked=validateSkuNamingSequence(sequence);
    const parts=checked.steps.filter(s=>s.enabled).map(s=>
        s.field==='literal'?s.text||'':formatSkuNameToken(values[s.field],s.mode))
        .filter(Boolean);
    // Do not invent names from absent selections; an enabled field becomes
    // relevant when its corresponding SKU attribute is configured.
    return parts.join(checked.separator).slice(0,160);
}
