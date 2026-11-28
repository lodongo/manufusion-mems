// Production Planning & MRP is a module whose submodules are its stages of work, in the order they are set up and used.
// The side menu lists them; each one opens its own screens directly. `pln_foundation` keeps its old path so favourites and
// links that already point to it stay valid.
export type PlnPhase = 'foundation' | 'masters' | 'capacity' | 'planning' | 'guide';

export interface PlnSubmodule {
    phase: PlnPhase;
    path: string;
    label: string;
    hint: string;
    /** The submodule opens for a person holding any of these. The screens inside still check each stage's own permission. */
    anyPermission: string[];
}

export const PLN_SUBMODULES: PlnSubmodule[] = [
    { phase: 'foundation', path: 'pln_foundation', label: 'Foundation', hint: 'Manufacturing policies, form defaults and product configuration', anyPermission: ['MFG.view', 'PLN.view'] },
    { phase: 'masters', path: 'pln_masters', label: 'Master data', hint: 'Materials and products, bills of materials and manufacturing resources', anyPermission: ['MFG.view'] },
    { phase: 'capacity', path: 'pln_capacity', label: 'Capacity & process', hint: 'Process routings and the production capacity overview', anyPermission: ['MFG.view'] },
    { phase: 'planning', path: 'pln_planning', label: 'Planning', hint: 'S&OP planning cycle, commercial requirements, demand and planning rules', anyPermission: ['PLN.view'] },
    { phase: 'guide', path: 'pln_guide', label: 'Reference', hint: 'Setup guide, topics, troubleshooting and worked examples', anyPermission: ['PLN.view'] },
];

export const plnPhaseOfPath = (path: string): PlnPhase | undefined => PLN_SUBMODULES.find((s) => s.path === path)?.phase;
export const plnPathOfPhase = (phase: PlnPhase): string => PLN_SUBMODULES.find((s) => s.phase === phase)!.path;
