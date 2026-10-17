/** Pure staffing helpers shared by React and Cloud Run.
 * The implementation lives inside the deployed backend directory so runtime
 * imports do not depend on frontend source files omitted from the Docker image.
 */
export { matchingRoleNodes, staffingSummary, employmentCoverage } from '../../backend/positionStaffing';
export type { RoleStaffingRow, RoleStaffingCount, StaffingUnit } from '../../backend/positionStaffing';
