/** Structural checks shared by MEMS admin catalogues. No implicit cross-catalog conversion. */
export type AdminCatalogKind = 'assets'|'materials'|'services'|'gl_accounts';

const LABELS: Record<AdminCatalogKind,string>={
    assets:'Asset catalog',
    materials:'Material catalog (PRC)',
    services:'Service catalog (PRC)',
    gl_accounts:'GL account master (FIN)',
};
const ARRAYS:Record<AdminCatalogKind,string>={
    assets:'assetClasses',materials:'materials',services:'services',gl_accounts:'accounts',
};
const isRecord=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const fromType=(value:unknown):AdminCatalogKind|null=>{
    switch(value){
        case 'asset':case 'assets':return 'assets';
        case 'material':case 'materials':return 'materials';
        case 'service':case 'services':return 'services';
        case 'gl_account':case 'gl_accounts':case 'finance':return 'gl_accounts';
        default:return null;
    }
};

export function detectAdminCatalogKind(input:unknown):AdminCatalogKind|null{
    if(!isRecord(input))return null;
    const typed=fromType(input.catalogType);
    const kinds=(Object.keys(ARRAYS) as AdminCatalogKind[]).filter(k=>Array.isArray(input[ARRAYS[k]]));
    if(kinds.length===1)return kinds[0];
    if(kinds.length>1)return typed&&kinds.includes(typed)?typed:null;
    return typed;
}

/** Validate the actual array structure rather than trusting a filename or catalogType alone. */
export function catalogUploadIssue(expected:AdminCatalogKind,input:unknown):string|null{
    if(!isRecord(input))return 'Choose a complete JSON catalog object.';
    const found=detectAdminCatalogKind(input);
    if(found&&found!==expected)
        return `This is a ${LABELS[found]} JSON, not an ${LABELS[expected]}. Open ${LABELS[found]} to upload it. No catalog has been changed.`;
    const collection=ARRAYS[expected];
    const hasItems=Array.isArray(input[collection]);
    const hasAttributes=Array.isArray(input.attributes);
    if(!hasItems||!hasAttributes)
        return `The ${LABELS[expected]} JSON must contain top-level "${collection}" and "attributes" arrays. Missing: ${[!hasItems?collection:'',!hasAttributes?'attributes':''].filter(Boolean).join(', ')}. Choose the correct full master file; an inventory/material master is not an asset-class master.`;
    if(!(input[collection] as unknown[]).length)
        return `The ${LABELS[expected]} JSON has no ${collection} entries. Choose a complete master file.`;
    return null;
}

/** UTF-8 aware chunks: never split a surrogate pair and keep Firestore request payloads small. */
export function splitUtf8UploadParts(value:string,maxChars=500_000,maxBytes=650_000):string[]{
    if(maxChars<4||maxBytes<8)throw new Error('Invalid upload chunk limits.');
    const encoder=new TextEncoder();
    const parts:string[]=[];
    let offset=0;
    while(offset<value.length){
        let end=Math.min(value.length,offset+maxChars);
        // Never separate the two UTF-16 code units of a Unicode character.
        const boundary=()=>{
            if(end<value.length&&end>offset&&value.charCodeAt(end-1)>=0xD800&&
                value.charCodeAt(end-1)<=0xDBFF)end--;
        };
        boundary();
        let length=encoder.encode(value.slice(offset,end)).length;
        if(length>maxBytes){
            const guess=Math.max(1,Math.floor((end-offset)*(maxBytes/length))-4);
            end=Math.min(value.length,offset+guess);
            boundary();
            length=encoder.encode(value.slice(offset,end)).length;
            while(length>maxBytes&&end>offset+1){
                end=Math.max(offset+1,end-512);
                boundary();
                length=encoder.encode(value.slice(offset,end)).length;
            }
        }
        if(end<=offset||length>maxBytes)throw new Error('Could not create a safe UTF-8 upload part.');
        parts.push(value.slice(offset,end));
        offset=end;
    }
    return parts;
}
