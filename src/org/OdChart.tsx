import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Card, Empty, PageTitle, Spinner, useLoad } from '../admin/kit';
import VisualTree from './VisualTree';
import { LEVELS, LEVEL_COLORS, operatingLabel, upperName } from './structureDefs';
import type { Position } from './PositionsPage';

interface TreeData {
    design: { mode: string; names: string[] };
    organization: string;
    nodes: Array<{ id: string; level: string; tier: number; parentId: string; code: string; name: string; status: string; managerName: string; roleCodes: string[] }>;
    positions: Position[];
}

/** Picture of the organization structure or of the organization role structure. */
export default function OdChart({ show }: { show: 'structure' | 'roles' }) {
    const { data, error, loading } = useLoad(() => callBackend<TreeData>('/api/org/structure/tree'));
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not draw the chart.'}</Alert>;
    const names = data.design.names;

    if (show === 'roles') {
        return (
            <div className='space-y-4'>
                <PageTitle title='Job roles' subtitle='Job role structure (ROL_) from the top down' />
                <Card>
                    {data.positions.length === 0 ? (
                        <Empty>Add job roles to see the structure here.</Empty>
                    ) : (
                        <VisualTree
                            rootTitle={data.organization}
                            rootSubtitle={`${data.positions.length} roles`}
                            items={data.positions.map((p) => ({ id: p.code, parentId: p.parentCode, code: p.code, title: p.title, subtitle: operatingLabel(p.operatingLevel, names), color: '#38bdf8' }))}
                            onSelect={() => navigate('organization_admin/positions')}
                        />
                    )}
                </Card>
            </div>
        );
    }

    const label = (n: TreeData['nodes'][number]) => (n.level === 'group' ? upperName(names, n.tier) : LEVELS[n.level]?.label ?? n.level);
    const counts = data.nodes.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n.level]: (acc[n.level] ?? 0) + 1 }), {});

    return (
        <div className='space-y-4'>
            <PageTitle title='Organization structure' subtitle='Your organization as you build it' />
            {data.nodes.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                    {Object.entries(LEVEL_COLORS).map(([level, color]) =>
                        counts[level] ? (
                            <span key={level} className='flex items-center gap-1.5 rounded-full border border-slate-800 px-2.5 py-1 text-xs text-slate-300'>
                                <span className='h-2 w-2 rounded-full' style={{ background: color }} />
                                {level === 'group' ? 'Upper levels' : LEVELS[level].label} · {counts[level]}
                            </span>
                        ) : null
                    )}
                </div>
            )}
            <Card>
                {data.nodes.length === 0 ? (
                    <Empty>Your chart appears here as you build the structure.</Empty>
                ) : (
                    <VisualTree
                        rootTitle={data.organization}
                        rootSubtitle={data.design.mode === 'single' ? 'Single legal entity' : names.length ? names.join(' › ') : 'Several legal entities'}
                        items={data.nodes.map((n) => ({
                            id: n.id,
                            parentId: n.parentId === 'root' ? '' : n.parentId,
                            code: n.code,
                            title: n.name,
                            subtitle: [label(n), n.managerName, n.level === 'site' && n.roleCodes.length ? `${n.roleCodes.length} roles` : ''].filter(Boolean).join(' · '),
                            color: LEVEL_COLORS[n.level] ?? '#94a3b8',
                        }))}
                        onSelect={(id) => navigate(`organization_admin/structure/${id}`)}
                    />
                )}
            </Card>
        </div>
    );
}
