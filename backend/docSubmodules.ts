/** Single source of truth for DOC section switches. Role and tenant checks remain independent. */
export const DOC_AREAS=['register','engineering','sds','rca','review','knowledge','forms'] as const;
export type DocArea=typeof DOC_AREAS[number];
export function docAreaForTransaction(name:string):DocArea|null{
 if(!name.startsWith('drkms.')||name==='drkms.setup'||name==='drkms.configure'||name==='drkms.submodules.status')return null;
 const [,family,action='']=name.split('.');
 if(family==='engineering'||family==='industrial')return 'engineering';
 if(family==='sds')return 'sds';
 if(family==='rca')return 'rca';
 if(family==='troubleshoot'||family==='ai')return 'knowledge';
 if(family==='documents'&&['review_decision','submit_review','approval_packet','publish'].includes(action))return 'review';
 if(family==='digital'||family==='forms')return 'forms';
 return 'register';
}
export function enabledDocAreas(configured:unknown):DocArea[]{
 if(!Array.isArray(configured))return [...DOC_AREAS];
 return DOC_AREAS.filter(area=>configured.includes(area));
}
