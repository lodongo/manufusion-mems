/**
 * Non-destructive compatibility mapping of installed security permissions.
 * This is a display/migration crosswalk, NOT an authorization grant.
 * Ambiguous permissions remain explicitly unmapped for manual certification.
 */
import { discoverTransactionActions } from './transactionRegistry';
import { plannedTransactionBlueprints } from './transactionBlueprints';

const groupByPrefix: Record<string, string> = {
  'ADM.users':'USR','ADM.structure':'ORG','ADM.roles':'SEC','ADM.modules':'MDL',
  'ADM.audit':'AUD','ADM.workflows':'GOA','ADM.settings':'ORG',
  'PRC.req':'REQ','PRC.prq':'PRQ','PRC.po':'PUR','PRC.quotes':'RFQ',
  'PRC.vendors':'VEN','PRC.materials':'MAT','PRC.services':'SVC',
  'PRC.authority':'AUT','PRC.setup':'AUT',
  'MNT.WR':'WRQ','MNT.WO':'WOR','MNT.PM':'PMS','MNT.AM':'AMS',
  'AST.register':'REG','AST.utilities':'EQP','AST.catalog':'REG',
  'INV.warehouse':'STK','INV.bin':'STK','INV.cluster':'STK',
  'WHS.warehouse':'WHM','WHS.bin':'BIN','WHS.cluster':'BIN',
  'FIN.gl':'GLA','FIN.journal':'JRN',
};
const actionBySuffix: Record<string,string> = {
  view:'VW',viewall:'VW',list:'VW',create:'CR',edit:'ED',update:'ED',
  submit:'SB',approve:'AP',reject:'RJ',return:'RT',cancel:'CN',
  post:'PS',close:'CL',reverse:'RV',report:'RP',
};
/** Never infer a grant from a matching display name. */
export function existingPermissionCrosswalk() {
  const blueprintCodes = new Set(plannedTransactionBlueprints().filter(b=>b.kind==='transaction').map(b=>b.code));
  const proposed = discoverTransactionActions().map(p=>{
    const tokens=p.legacyPermission.split('.');
    const prefix=tokens.length>=3?tokens.slice(0,2).join('.'):p.legacyPermission;
    const area=groupByPrefix[prefix] ?? null;
    const suffix=actionBySuffix[tokens[tokens.length-1].toLowerCase()] ?? null;
    const candidate=area&&suffix?`${p.module}-${area}-${suffix}`:null;
    const suggestedCode=candidate&&blueprintCodes.has(candidate)?candidate:null;
    return {
      existingPermission:p.legacyPermission,
      module:p.module,
      label:p.label,
      suggestedCode,
      status:suggestedCode?'proposed_mapping' as const:'manual_mapping_required' as const,
      mappingCertified:false as const,
    };
  });
  const counts = new Map<string, number>();
  for (const p of proposed) if(p.suggestedCode) counts.set(p.suggestedCode,(counts.get(p.suggestedCode)??0)+1);
  return proposed.map(p=>({
    ...p,
    // Multiple old grants cannot silently merge into one new permission.
    status: p.suggestedCode && (counts.get(p.suggestedCode)??0)>1 ? 'collision_review_required' as const : p.status,
    mappingCertified: false as const,
  }));
}

/** Counts are diagnostic only, never evidence that mapped routes are operational. */
export function existingPermissionMappingSummary() {
  const rows=existingPermissionCrosswalk();
  return {
    total:rows.length,
    proposed:rows.filter(r=>r.status==='proposed_mapping').length,
    collisions:rows.filter(r=>r.status==='collision_review_required').length,
    manualReview:rows.filter(r=>r.status==='manual_mapping_required').length,
    certified:0,
  };
}
