import { useEffect, useState } from 'react';

function currentRoute(): string {
    return window.location.hash.replace(/^#\/?/, '');
}

export function useHashRoute(): string {
    const [route, setRoute] = useState(currentRoute);
    useEffect(() => {
        const onChange = () => setRoute(currentRoute());
        window.addEventListener('hashchange', onChange);
        return () => window.removeEventListener('hashchange', onChange);
    }, []);
    return route;
}

/** Keep operational workspaces inside organization home for non-admin users. */
export function workspaceNavigate(path: string) {
    const inHome = currentRoute().startsWith('organization_home/');
    if (inHome && /^organization_admin\/(work_requests|work_orders|assets|asset_approvals)(\/|$)/.test(path)) {
        navigate(path.replace(/^organization_admin\//, 'organization_home/'));
    } else navigate(path);
}

export function navigate(path: string) {
    if (path) {
        if (currentRoute() !== path) window.location.hash = path;
        return;
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
}
