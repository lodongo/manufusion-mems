export const HOME_CARDS = [
    { key: 'waiting', label: 'Waiting for me', hint: 'Pending approvals and stock-take steps' },
    { key: 'passed', label: 'Passed through me', hint: 'Workflows that previously passed your approval stage' },
    { key: 'requests', label: 'My requests', hint: 'Open work requests assigned to you' },
    { key: 'orders', label: 'My work orders', hint: 'Open maintenance work orders' },
    { key: 'favorites', label: 'Favorites', hint: 'Starred workspaces' },
    { key: 'recent', label: 'Recently opened', hint: 'Recently used workspaces' },
    { key: 'my_tables', label: 'My Tables', hint: 'Your saved table layouts and filters' },
    { key: 'modules', label: 'My modules', hint: 'Modules and workspaces accessible to you' },
    { key: 'quick_links', label: 'My quick links', hint: 'My access, activity and personal details' },
] as const;

export type HomeKey = typeof HOME_CARDS[number]['key'];
export type HomeCardSize = 'compact' | 'regular' | 'wide';
export type HomeLayout = {
    order: HomeKey[];
    hidden: HomeKey[];
    sizes: Record<HomeKey, HomeCardSize>;
};
export type HomeLayoutResponse = { layout: HomeLayout; available: HomeKey[] };

const KEYS = HOME_CARDS.map((c) => c.key);
export function defaultHomeLayout(): HomeLayout {
    return {
        order: [...KEYS],
        hidden: [],
        sizes: {
            waiting: 'wide',
            passed: 'regular',
            requests: 'regular',
            orders: 'regular',
            favorites: 'regular',
            recent: 'regular',
            my_tables: 'regular',
            modules: 'wide',
            quick_links: 'wide',
        },
    };
}
export const HOME_LABEL = Object.fromEntries(HOME_CARDS.map((card) => [card.key, card.label])) as Record<HomeKey, string>;
