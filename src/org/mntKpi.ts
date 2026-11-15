export type TargetDirection='minimum'|'maximum';
export type TargetStatus='met'|'missed'|'unavailable'|'unset';
export function targetStatus(actual:number|null|undefined,target:number|null|undefined,direction:TargetDirection):TargetStatus{
 if(target==null||!Number.isFinite(target))return 'unset';
 if(actual==null||!Number.isFinite(actual))return 'unavailable';
 return (direction==='minimum'?actual>=target:actual<=target)?'met':'missed';
}
export const targetText=(status:TargetStatus)=>status==='met'?'On target':status==='missed'?'Off target':status==='unavailable'?'Data unavailable':'';
export const targetColor=(status:TargetStatus)=>status==='met'?'#16a34a':status==='missed'?'#dc2626':'#64748b';
export const targetClass=(status:TargetStatus)=>status==='met'?'text-green-600 dark:text-green-400':status==='missed'?'text-red-600 dark:text-red-400':'text-soft';
