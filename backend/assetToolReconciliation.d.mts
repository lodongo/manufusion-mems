export interface AssetReconciliationClass {code:string;name:string;synonyms?:string[]}
export interface AssetReconciliationCandidate {code:string;name:string;score:number}
export function compareAssetTools<T extends {code:string;name:string}>(assets:AssetReconciliationClass[],toolsList:T[]):Array<T&{status:string;matches:AssetReconciliationCandidate[]}>;
