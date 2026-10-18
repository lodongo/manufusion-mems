/**
 * Non-destructive compatibility mapping of installed security permissions.
 * This is a display/migration crosswalk, NOT an authorization grant.
 * Ambiguous permissions remain explicitly unmapped for manual certification.
 */
import { discoverTransactionActions } from './transactionRegistry';

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
  return discoverTransactionActions().map(p=>{
    const tokens=p.legacyPermission.split('.');
    const prefix=tokens.length>=3?tokens.slice(0,2).join('.'):p.legacyPermission;
    const area=groupByPrefix[prefix] ?? null;
    const suffix=actionBySuffix[tokens[tokens.length-1].toLowerCase()] ?? null;
    const suggestedCode=area&&suffix?`${p.module}-${area}-${suffix}`:null;
    return {
      existingPermission:p.legacyPermission,
      module:p.module,
      label:p.label,
      suggestedCode,
      status:suggestedCode?'proposed_mapping' as const:'manual_mapping_required' as const,
      mappingCertified:false as const,
    };
  });
}
