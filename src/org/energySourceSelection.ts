// Linked utilities are owned by Equipment Utilities, not the Safety selector.
export function isLinkedEnergySource(source:{code:string;linkedUtility?:boolean}):boolean {
 return source.linkedUtility===true || source.code.startsWith('UTL-');
}
export function visibleEnergySources<T extends {code:string;label:string;category:string;subcategory:string}>(sources: readonly T[], category:string,subcategory:string,query:string,selectedCodes:ReadonlySet<string>=new Set()):T[] {
 if(!category || !subcategory)return sources.filter(x=>selectedCodes.has(x.code));
 const q=query.trim().toLowerCase();
 return sources.filter(x=>x.category===category&&x.subcategory===subcategory&&[x.label,x.category,x.subcategory,x.code].join(' ').toLowerCase().includes(q));
}
