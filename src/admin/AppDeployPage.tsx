import type { ReactNode } from 'react';
import { Activity, ExternalLink, Info, Rocket, ShieldCheck } from 'lucide-react';
import { Screen } from '../components/screen';
import { Badge, Card } from './kit';

// MEMS staff administration › Platform › AppDeploy dashboard (super admins only, see AdminShell).
// Read-only launchpad: links to the live MEMS app and the AppDeploy console. No credentials are kept in the
// browser and no deployment actions are available here.

/** External link styled as a kit secondary button (44px). */
function LinkButton({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a href={href} target='_blank' rel='noopener noreferrer' className='mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold text-brandsoft active:bg-page sm:w-auto'>
            {children}
            <ExternalLink className='h-4 w-4' />
        </a>
    );
}

export default function AppDeployPage() {
    return (
        <Screen title='AppDeploy · MEMS' subtitle='Deployment control center for the MEMS application only.' actions={<Badge>Read-only</Badge>}>
            <div className='grid gap-3 sm:grid-cols-2'>
                <Card>
                    <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'>
                        <Rocket className='h-[18px] w-[18px] text-brandsoft' />
                        Application
                    </h2>
                    <p className='mt-3 text-xl font-bold text-ink'>MEMS</p>
                    <p className='mt-1 break-all text-xs text-muted'>App ID: mems-a6ztx8</p>
                    <LinkButton href='https://mems-a6ztx8.v2.appdeploy.ai/'>Open live MEMS</LinkButton>
                </Card>
                <Card>
                    <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'>
                        <Activity className='h-[18px] w-[18px] text-brandsoft' />
                        Deployment management
                    </h2>
                    <p className='mt-3 text-sm text-muted'>Review current deployment status, deployment versions, errors and available actions in the AppDeploy console.</p>
                    <LinkButton href='https://dashboard.appdeploy.ai/my/dashboard'>Open AppDeploy console</LinkButton>
                </Card>
            </div>
            <Card>
                <h2 className='flex items-center gap-2 font-semibold text-ink'>
                    <ShieldCheck className='h-[18px] w-[18px] text-brandsoft' />
                    Integration status
                </h2>
                <p className='mt-2 text-sm text-muted'>
                    Read-only launchpad. Live AppDeploy deployment status, version history, logs and credit usage are not yet connected to the MEMS backend. No
                    credentials are stored in the browser and no deployment actions are available on this page.
                </p>
            </Card>
            <Card>
                <p className='flex items-start gap-2 text-sm text-muted'>
                    <Info className='mt-0.5 h-[17px] w-[17px] shrink-0' />
                    AppDeploy credits are account-wide, not specific to MEMS. View the authoritative balance in the AppDeploy console.
                </p>
            </Card>
        </Screen>
    );
}
