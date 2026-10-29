import { Settings2, UserCog } from 'lucide-react';
import { workspaceNavigate as navigate } from '../lib/route';
import { gateFromMessage } from './mntGateSuggest';

/** Shows a maintenance action error and, when the cause is a workflow gate, how to resolve it. Theme tokens keep it
 *  readable on light and dark tenant themes. */
export default function MntGateHint({ message }: { message: string }) {
    const hit = gateFromMessage(message);
    const button = 'flex min-h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-semibold text-ink active:bg-page';
    return (
        <div role='alert' className='space-y-2 rounded-lg border border-danger/50 bg-danger/10 p-3 text-sm'>
            <p className='font-semibold text-danger'>{message}</p>
            {hit && (
                <>
                    <p className='text-xs text-soft'>
                        {hit.kind === 'unconfigured'
                            ? `No job role is accountable for ${hit.gate} yet. A workflow administrator assigns one in Maintenance Workflows and saves it with a reason.`
                            : `Only people holding ${hit.jobRole ? `the job role ${hit.jobRole}` : 'the configured job role'} at this equipment's location can do this, administrators included. Assign the job role to the person (Users › Job roles and scope), or change the role configured for ${hit.gate}.`}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                        {hit.kind === 'not_held' && (
                            <button type='button' onClick={() => navigate('organization_admin/users')} className={button}>
                                <UserCog className='h-4 w-4' />Assign job roles
                            </button>
                        )}
                        <button type='button' onClick={() => navigate('organization_home/mnt_workflows')} className={button}>
                            <Settings2 className='h-4 w-4' />Open Maintenance Workflows
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
