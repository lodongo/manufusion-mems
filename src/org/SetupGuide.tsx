import { Building2, Briefcase, CheckCircle2, Circle, Factory, Layers, Wrench, ArrowRight } from 'lucide-react';
import { navigate } from '../lib/route';
import { Button, Card } from '../admin/kit';

export interface SetupProgress {
    ready: boolean;
    phase: 'organization' | 'site' | 'roles' | 'ready';
    nextRoute: string;
    counts: Record<string, number>;
    basicPercent: number;
    extendedPercent: number;
    assetConfigured: boolean;
}

const MILESTONES = [
    { key: 'legalEntities', label: 'Legal entity', Icon: Building2 },
    { key: 'sites', label: 'Site', Icon: Factory },
    { key: 'jobRoles', label: 'Job roles', Icon: Briefcase },
    { key: 'departments', label: 'Departments', Icon: Layers },
    { key: 'costCenters', label: 'Cost centers', Icon: Layers },
    { key: 'configuredAssets', label: 'Configured asset', Icon: Wrench },
] as const;

export default function SetupGuide({ progress, compact = false }: { progress: SetupProgress; compact?: boolean }) {
    const phaseText = progress.phase === 'organization' ? 'Configure your first legal entity'
        : progress.phase === 'site' ? 'Add a site under your legal entity'
        : progress.phase === 'roles' ? 'Configure your organization job roles'
        : 'Basic configuration complete';
    return (
        <Card className='mb-4 space-y-3 border border-line bg-panel text-ink'>
            <div className='flex items-start justify-between gap-3'>
                <div>
                    <h2 className='font-semibold text-ink'>Basic configuration</h2>
                    <p className='mt-1 text-sm text-soft'>{phaseText}</p>
                </div>
                <span className='shrink-0 rounded-lg bg-brand/10 px-2 py-1 text-lg font-bold text-brand'>{progress.basicPercent}%</span>
            </div>
            <div role='progressbar' aria-label='Basic configuration progress' aria-valuenow={progress.basicPercent} aria-valuemin={0} aria-valuemax={100} className='h-2 overflow-hidden rounded-full bg-page'>
                <div className='h-full rounded-full bg-brand transition-all' style={{ width: `${progress.basicPercent}%` }} />
            </div>
            {!compact && (
                <>
                    <div className='grid grid-cols-2 gap-2'>
                        {MILESTONES.map(({ key, label, Icon }, i) => (
                            <div key={key} className='flex min-h-16 items-center gap-2 rounded-xl border border-line bg-page p-3'>
                                <Icon className='h-5 w-5 shrink-0 text-brand' />
                                <span className='min-w-0 flex-1 text-xs font-medium text-ink'>{label}
                                    <span className='block text-xs font-normal text-soft'>{progress.counts[key] ?? 0} configured</span>
                                </span>
                                {(progress.counts[key] ?? 0) > 0 ? <CheckCircle2 className='h-4 w-4 shrink-0 text-brand'/> : <Circle className='h-4 w-4 shrink-0 text-muted'/>}
                            </div>
                        ))}
                    </div>
                    <p className='text-xs text-soft'>Extended organization readiness: {progress.extendedPercent}%. Configure at least one equipment asset and the levels above it to complete the reference path. Additional sites, roles and assets can be added later.</p>
                </>
            )}
            {!progress.ready && (
                <Button className='w-full' onClick={() => navigate(progress.nextRoute)}>
                    Continue configuration <ArrowRight className='h-4 w-4' />
                </Button>
            )}
        </Card>
    );
}
