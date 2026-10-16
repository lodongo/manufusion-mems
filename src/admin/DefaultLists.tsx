import { useState } from 'react';
import { Download } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Button, Card } from './kit';

const LIST_TITLES: Record<string, string> = { skillsMaster: 'Skills master', unitsOfMeasure: 'Units of measure',  costCenterTypes: 'Cost center types', maintenanceTypes: 'Maintenance types', failureModes: 'Failure modes', solutionTypes: 'Solution types', workRequestSources: 'Work request sources', pmActivities: 'PM activities', amActivities: 'AM activities', rcaMethods: 'RCA methodologies', rootCauses: 'Root cause categories', rcaActions: 'RCA action types', impacts: 'Impact categories', disciplines: 'Technical disciplines', workPriorities: 'Work priorities', workStatuses: 'Work order statuses', workTypes: 'Work types', maintenanceTriggers: 'Maintenance triggers', defectStatuses: 'Defect statuses', riskLevels: 'Risk levels', downtimeClasses: 'Downtime classifications', executionLocations: 'Execution locations', verificationTypes: 'Work verification types', workOutcomes: 'Work outcomes', resourceTypes: 'Resource types', escalationReasons: 'Escalation reasons' };

/** Offers to load the default metadata lists that ship with a module. */
export default function DefaultLists({ code, keys, onDone }: { code: string; keys: string[]; onDone: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const load = async () => {
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/admin/modules/metadata/defaults', { code });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load the default lists.');
            setBusy(false);
        }
    };
    return (
        <Card className='space-y-3'>
            <p className='text-sm text-slate-300'>
                New or updated default lists for {code}: <span className='text-white'>{keys.map((k) => LIST_TITLES[k] ?? k).join(', ')}</span>
            </p>
            {error && <Alert tone='error'>{error}</Alert>}
            <Button className='w-full' busy={busy} onClick={load}>
                <Download className='h-4 w-4' />
                Load latest default lists
            </Button>
        </Card>
    );
}
