import { RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Button, PageTitle, Spinner, useLoad } from '../admin/kit';
import { AuditBrowser } from '../admin/LogsPage';
import type { LogEntry } from '../admin/LogList';

export default function OrgAudit() {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ events: LogEntry[] }>('/api/org/audit'));
    return (
        <div>
            <PageTitle
                title='Audit trail'
                subtitle='Everything that happens in your organization (latest 300)'
                action={
                    <Button variant='secondary' busy={loading} onClick={reload} aria-label='Refresh audit trail'>
                        <RefreshCw className='h-4 w-4' />
                    </Button>
                }
            />
            {loading && !data ? <Spinner /> : error ? <Alert tone='error'>{error}</Alert> : <AuditBrowser logs={data?.events ?? []} />}
        </div>
    );
}
