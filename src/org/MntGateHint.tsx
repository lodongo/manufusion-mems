import { Settings2 } from 'lucide-react';
import { workspaceNavigate as navigate } from '../lib/route';
import { gateFromMessage } from './mntGateSuggest';

/** Shows a maintenance action error and, when the cause is a workflow gate, how to resolve it. */
export default function MntGateHint({ message }: { message: string }) {
    const hit = gateFromMessage(message);
    return (
        <div role='alert' className='space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200'>
            <p>{message}</p>
            {hit && (
                <>
                    <p className='text-xs text-slate-300'>
                        {hit.kind === 'unconfigured'
                            ? `No job role is accountable for ${hit.gate} yet. A workflow administrator assigns one in Maintenance Workflows and saves it with a reason.`
                            : `Only people holding the job role configured for ${hit.gate} at this location can do this. Ask HR or an administrator to assign you that job role, or change the configured role.`}
                    </p>
                    <button type='button' onClick={() => navigate('organization_home/mnt_workflows')}
                        className='flex min-h-11 items-center gap-2 rounded-lg border border-slate-600 px-3 text-sm font-semibold text-white active:bg-slate-800'>
                        <Settings2 className='h-4 w-4' />Open Maintenance Workflows
                    </button>
                </>
            )}
        </div>
    );
}
