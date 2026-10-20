/** Industrial automation documentation contracts. Records never expose PLC control access to AI. */
export const CONTROL_TECHNOLOGIES = [
 'siemens_step7_tia','rockwell_studio5000','rockwell_rslogix500','schneider_ecostruxure',
 'codesys_iec61131','beckhoff_twincat','omron_sysmac','mitsubishi_gxworks',
 'abb_ac500','bosch_rexroth_indraworks','b_and_r_automation_studio',
 'delta_ispsoft','keyence_kv','generic_iec61131','other',
] as const;
export const PLC_LANGUAGES=['ladder','function_block','structured_text','instruction_list_legacy','sequential_function_chart','continuous_function_chart','vendor_proprietary'] as const;
export const UTILITY_KINDS=['electrical_ac','electrical_dc','water','steam','compressed_air','nitrogen','co2','vacuum','glycol','chilled_water','hot_water','hydraulic','thermal_oil','fuel','cip','other'] as const;
export type IndustrialKnowledgeRecord={
 assetTag:string;kind:'plc_program'|'hmi_scada'|'industrial_network'|'io_list'|'control_narrative'|'utility_feed'|'instrumentation'|'historian_mapping';
 technology?:typeof CONTROL_TECHNOLOGIES[number];programLanguages?:typeof PLC_LANGUAGES[number][];
 utilityKind?:typeof UTILITY_KINDS[number];equipmentNodeId?:string;
 plcSource?:'controller_read_only'|'controlled_backup';controllerReadAt?:string;
 runningVersionMatch?:'verified_match'|'verified_mismatch'|'not_verified';
 title:string;sourceDocumentId:string;sourceRevisionId:string;
 manufacturer?:string;controllerModel?:string;firmwareVersion?:string;softwareVersion?:string;
 checksum?:string;tagNamespace?:string;effectiveFrom?:string;validatedBy?:string;
 accessMode:'read_only';aiControlEnabled:false;
};
export function validIndustrialKnowledge(x:IndustrialKnowledgeRecord):boolean{
 return !!x&&/^AST-[0-9]{6}$/.test(x.assetTag)&&
 ['plc_program','hmi_scada','industrial_network','io_list','control_narrative','utility_feed','instrumentation','historian_mapping'].includes(x.kind)&&
 typeof x.title==='string'&&x.title.trim().length>=3&&x.title.length<=180&&
 /^[a-f0-9]{20}$/.test(x.sourceDocumentId)&&/^[a-f0-9]{64}$/.test(x.sourceRevisionId)&&
 x.accessMode==='read_only'&&x.aiControlEnabled===false&&
 (x.technology===undefined||CONTROL_TECHNOLOGIES.includes(x.technology))&&
 (x.utilityKind===undefined||UTILITY_KINDS.includes(x.utilityKind))&&
 (x.programLanguages===undefined||(Array.isArray(x.programLanguages)&&x.programLanguages.every(l=>PLC_LANGUAGES.includes(l))))&&
 (x.kind!=='plc_program'||(!!x.technology && !!x.plcSource &&
   (x.plcSource==='controller_read_only'||x.plcSource==='controlled_backup') &&
   !!x.runningVersionMatch && ['verified_match','verified_mismatch','not_verified'].includes(x.runningVersionMatch) &&
   (x.plcSource!=='controller_read_only'||!!x.controllerReadAt)))&&
 (x.kind!=='utility_feed'||!!x.utilityKind);
}
