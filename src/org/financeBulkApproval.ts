/** Safe batch selection for Finance configuration approvals.
 * Approval is NEVER granted here: every request still goes through FIN.requests.decide,
 * with maker-checker, legal-entity authority, version/GL checks and immutable audit.
 * Value-bearing FCRs and catalogue draft imports are deliberately excluded.
 */
export type FinanceApprovalRow={
 id:string;type:string;status:string;canDecide:boolean;mine:boolean;amount:number|null;
};
export const BULK_FINANCE_APPROVAL_TYPES=Object.freeze(['mapping.save','gltxn.save'] as const);
export const MAX_BULK_FINANCE_APPROVALS=40;
export function eligibleFinanceMappingApprovals<T extends FinanceApprovalRow>(rows:readonly T[]):T[]{
 return rows.filter(r=>r.canDecide&&!r.mine&&r.status==='pending'&&r.amount===null
  &&/^FCR\d{8}$/.test(r.id)&&(BULK_FINANCE_APPROVAL_TYPES as readonly string[]).includes(r.type))
  .slice(0,MAX_BULK_FINANCE_APPROVALS);
}
