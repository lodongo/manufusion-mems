import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Copy, ExternalLink, LayoutGrid, Table2, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Button, Card, PageTitle, Spinner } from '../admin/kit';
import { appConfirm } from '../components/dialogs';

interface SavedTable {
    id: string;
    tableId: string;
    name: string;
    title: string;
    route: string;
    tabKey?: string;
    updatedAt: string;
}
const routeValid = (route: string) => /^organization_(home|admin)\/[A-Za-z0-9_/-]{1,145}$/.test(route);

export default function MyTables({ allowedPaths, canAdmin, selectedId }: {
    allowedPaths: string[];
    canAdmin: boolean;
    selectedId?: string;
}) {
    const [items, setItems] = useState<SavedTable[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState('');

    const load = async () => {
        setError('');
        try {
            const result = await callBackend<{ items: SavedTable[] }>('/api/org/my-tables/list');
            setItems(result.items);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load My Tables.');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); }, []);

    const eligible = (entry: SavedTable) => {
        if (!routeValid(entry.route)) return false;
        if (entry.route.startsWith('organization_admin/')) return canAdmin;
        const path = entry.route.slice('organization_home/'.length);
        return allowedPaths.some((allowed) => path === allowed || path.startsWith(allowed + '/'));
    };
    const grouped = useMemo(() => {
        const groups = new Map<string, SavedTable[]>();
        for (const item of items) {
            const title = item.title || item.tableId;
            groups.set(title, [...(groups.get(title) ?? []), item]);
        }
        return [...groups.entries()];
    }, [items]);

    const copy = async (id?: string) => {
        const suffix = id ? '/' + id : '';
        const url = window.location.origin + window.location.pathname + window.location.search + '#organization_home/my_tables' + suffix;
        try {
            await navigator.clipboard.writeText(url);
            setNotice('Link copied. The person opening it must sign in; they will only see their own saved views.');
        } catch {
            setError('The browser did not allow copying. Open My Tables and copy its address from the address bar.');
        }
    };
    const open = (item: SavedTable) => {
        if (!eligible(item)) return;
        try {
            sessionStorage.setItem('mems.table.open.' + item.tableId, item.id);
            if (item.tabKey) sessionStorage.setItem('mems.table.tab.' + item.route, item.tabKey);
        } catch { /* The table can still open with its default view. */ }
        navigate(item.route);
    };
    const remove = async (item: SavedTable) => {
        if (!(await appConfirm('Remove the saved view ' + item.name + ' from My Tables?'))) return;
        setBusy(item.id);
        setError('');
        try {
            await callBackend('/api/org/my-tables/delete', { id: item.id });
            setItems((prev) => prev.filter((v) => v.id !== item.id));
            setNotice('Saved view removed from My Tables.');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not remove the saved view.');
        } finally {
            setBusy('');
        }
    };

    return (
        <div className='space-y-4'>
            <PageTitle title='My Tables' subtitle='Quick access to the table views you have customized' action={
                <Button variant='secondary' onClick={() => { void copy(); }}><Copy className='h-4 w-4' /> Copy link</Button>
            } />
            <p className='text-xs text-muted'>Saved views remember your column order, hidden columns, sorting and filters — not the underlying records. Every table still checks your current MEMS permissions.</p>
            {error && <Alert tone='error'>{error}</Alert>}
            {notice && <Alert tone='info'>{notice}</Alert>}
            {loading ? <Spinner /> : !items.length ? (
                <Card className='space-y-3 text-sm text-soft'>
                    <div className='flex items-center gap-2 font-semibold text-ink'><LayoutGrid className='h-5 w-5 text-brand' /> No saved tables yet</div>
                    <p>Open any MEMS data table, customize its columns and filters, then select Templates and Save. Your view will appear here and on your other devices.</p>
                    <Button variant='secondary' onClick={() => navigate('organization_home')}><ArrowRight className='h-4 w-4' /> Browse my modules</Button>
                </Card>
            ) : (
                <div className='space-y-4'>
                    {grouped.map(([title, views]) => (
                        <Card key={title} className='space-y-2'>
                            <h2 className='flex items-center gap-2 text-sm font-semibold text-ink'>
                                <Table2 className='h-4 w-4 text-brand' /> {title}
                            </h2>
                            <div className='divide-y divide-line'>
                                {views.map((v) => (
                                    <div key={v.id} className={'flex items-center gap-2 py-2 ' + (selectedId === v.id ? 'rounded-lg border border-brand/40 bg-brand/5 px-2' : '')}>
                                        <button type='button' disabled={!eligible(v)}
                                            onClick={() => open(v)} className='min-w-0 flex-1 rounded-lg py-2 text-left disabled:opacity-50'>
                                            <span className='block truncate text-sm font-medium text-ink'>{v.name}</span>
                                            <span className='block truncate text-xs text-muted'>
                                                {eligible(v) ? 'Open saved table view' : 'This table is no longer accessible with your mapped permissions'}
                                            </span>
                                        </button>
                                        <button type='button' title='Copy a link to My Tables' aria-label={'Copy link to ' + v.name}
                                            onClick={() => { void copy(v.id); }}
                                            className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-soft'>
                                            <Copy className='h-4 w-4' />
                                        </button>
                                        {eligible(v) && <button type='button' aria-label={'Open ' + v.name} onClick={() => open(v)}
                                            className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-brand'>
                                            <ExternalLink className='h-4 w-4' />
                                        </button>}
                                        <button type='button' disabled={busy === v.id} aria-label={'Remove ' + v.name}
                                            onClick={() => { void remove(v); }} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-500 disabled:opacity-40'>
                                            <Trash2 className='h-4 w-4' />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
