import { Activity, ExternalLink, Info, Rocket, ShieldCheck } from 'lucide-react';
import { Screen } from '../components/screen';
import { Badge, Card } from './kit';

/** Read-only hosting panel. Infrastructure changes happen outside the app. */
export default function AppDeployPage() {
    return <Screen title='MEMS Hosting' subtitle='Independent deployment foundation · migration status' actions={<Badge>Read-only</Badge>}>
        <div className='grid gap-3 sm:grid-cols-2'>
            <Card>
                <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'><Rocket className='h-5 w-5 text-brandsoft'/> Application</h2>
                <p className='mt-3 text-xl font-bold text-ink'>MEMS</p>
                <p className='mt-1 text-xs text-muted'>Frontend and APIs are hosted together on your configured Cloud Run endpoint.</p>
                <a href={window.location.origin} target='_blank' rel='noopener noreferrer' className='mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brandsoft'>Open current environment <ExternalLink className='h-4 w-4'/></a>
            </Card>
            <Card>
                <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'><Activity className='h-5 w-5 text-brandsoft'/> Hosting controls</h2>
                <p className='mt-3 text-sm text-muted'>Manage deployments, revisions and logs using Google Cloud Run in your Google Cloud project.</p>
                <a href='https://console.cloud.google.com/run' target='_blank' rel='noopener noreferrer' className='mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brandsoft'>Open Google Cloud Run <ExternalLink className='h-4 w-4'/></a>
            </Card>
        </div>
        <Card>
            <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'><ShieldCheck className='h-5 w-5 text-brandsoft'/> Migration safeguards</h2>
            <p className='mt-2 text-sm text-muted'>Independent hosting requires verified IAM, environment-specific Firebase authentication, isolated Cloud Storage and authorized release procedures. This page does not change infrastructure or run migrations.</p>
        </Card>
        <Card>
            <p className='flex items-start gap-2 text-sm text-muted'><Info className='h-4 w-4 shrink-0'/>Chat currently uses a 12-second authenticated refresh, pending independent real-time messaging. Do not enable commercial production until realtime and payment callbacks are verified.</p>
        </Card>
    </Screen>;
}
