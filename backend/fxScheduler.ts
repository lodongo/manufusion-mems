import { automationRoutes } from './automationEngine';

/** Compatibility alias for any existing FX scheduler HTTP target.
 * Uses the same verified OIDC identity, shared execution lock and all-currency worker.
 */
export const fxSchedulerRoutes = {
    'POST /api/internal/fx/scheduled-refresh': automationRoutes['POST /api/internal/automations/heartbeat'],
};
