/** RCA source trigger categories are metadata; these paths are existing operational registries. */
export const RCA_TRIGGER_TYPES=[
 ['MNT_BREAKDOWN','Maintenance breakdown / work order','work_orders'],
 ['MNT_REQUEST','Maintenance work request','work_requests'],
 ['SAF_INCIDENT','Safety incident','safety_incidents'],
 ['SAF_NEARMISS','Safety near miss','safety_incidents'],
 ['MFG_QUALITY','Manufacturing quality deviation',''],
 ['MFG_PROCESS','Manufacturing process / production loss',''],
 ['QLT_NONCONFORMANCE','Quality nonconformance',''],
 ['ENV_EVENT','Environmental incident',''],
 ['AUDIT_FINDING','Audit finding',''],
 ['OTHER','Other documented trigger','']
] as const;
export type RcaTrigger={typeCode:string;recordId:string;recordTitle:string;sourceModule:string;verification:'linked'|'pending_source_integration'};
export function triggerType(code:string){return RCA_TRIGGER_TYPES.find(t=>t[0]===code);}
export function validTriggerId(id:string){return /^[a-zA-Z0-9_-]{3,100}$/.test(id);}
