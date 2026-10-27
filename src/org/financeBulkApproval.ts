/** Safe batch selection for Finance configuration approvals.
 * Approval is NEVER granted here: every request still goes through FIN.requests.decide,
 * with maker-checker, legal-entity authority, version/GL checks and immutable audit.
 * Value-bearing FCRs and catalogue draft imports are deliberately excluded.
 *
 * Multiple outstanding requests touching the same legal entity and mapping
 * document are NEVER bulk approved together: the later approval could silently
 * replace the earlier complete mapping. They require individual conflict review.
 */
export type FinanceApprovalRow={
 id:string;leId:string;type:string;status:string;canDecide:boolean;mine:boolean;amount:number|null;
};
export const BULK_FINANCE_APPROVAL_TYPES=Object.freeze(['mapping.save','gltxn.save'] as const);
export const MAX_BULK_FINANCE_APPROVALS=40;
const isConfig=(type:string)=>(BULK_FINANCE_APPROVAL_TYPES as readonly string[]).includes(type);
export function eligibleFinanceMappingApprovals<T extends FinanceApprovalRow>(rows:readonly T[]):T[]{
 const pendingByTarget=new Map<string,number>();
 for(const r of rows){
  if(r.status!=='pending'||!isConfig(r.type)||!r.leId)continue;
  const key=r.leId+'|'+r.type;
  pendingByTarget.set(key,(pendingByTarget.get(key)||0)+1);
 }
 return rows.filter(r=>r.canDecide&&!r.mine&&r.status==='pending'&&r.amount===null
  &&/^FCR\d{8}$/.test(r.id)&&!!r.leId&&isConfig(r.type)
  &&pendingByTarget.get(r.leId+'|'+r.type)===1)
  .slice(0,MAX_BULK_FINANCE_APPROVALS);
}
