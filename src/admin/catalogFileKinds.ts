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
