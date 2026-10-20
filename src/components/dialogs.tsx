import { useEffect, useId, useState } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// In-app replacements for window.confirm / window.alert / window.prompt.
//   appConfirm(message)          -> Promise<boolean>
//   appAlert(message)            -> Promise<void>
//   appPrompt(message, initial)  -> Promise<string | null>   (null when cancelled)
// Native browser dialogs are unthemed, block the page, and are suppressed or hidden in many
// in-app browsers (WhatsApp, Facebook, some Android WebViews). These sheets follow the tenant
// theme, open as a bottom sheet on phones, and keep 44px+ touch targets.
// <DialogHost /> is mounted once in App.
// ---------------------------------------------------------------------------

type Kind = 'confirm' | 'alert' | 'prompt';

interface Request {
    id: number;
    kind: Kind;
    message: string;
    initial: string;
    resolve: (value: boolean | string | null | undefined) => void;
}

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<(q: Request[]) => void>();

function publish() {
    for (const l of listeners) l(queue);
}

function open(kind: Kind, message: string, initial = ''): Promise<boolean | string | null | undefined> {
    return new Promise((resolve) => {
        queue = [...queue, { id: nextId++, kind, message: String(message ?? ''), initial, resolve }];
        publish();
    });
}

function settle(id: number, value: boolean | string | null | undefined) {
    const item = queue.find((r) => r.id === id);
    queue = queue.filter((r) => r.id !== id);
    publish();
    item?.resolve(value);
}

/** Ask the person to confirm. Resolves true when they confirm, false when they cancel. */
export function appConfirm(message: string): Promise<boolean> {
    return open('confirm', message).then((v) => v === true);
}

/** Show a message the person must acknowledge. */
export function appAlert(message: string): Promise<void> {
    return open('alert', message).then(() => undefined);
}

/** Ask for a line of text. Resolves the text, or null when cancelled. */
export function appPrompt(message: string, initial = ''): Promise<string | null> {
    return open('prompt', message, initial).then((v) => (typeof v === 'string' ? v : null));
}

/** Renders the oldest pending dialog. Mount once near the app root. */
export function DialogHost() {
    const [items, setItems] = useState<Request[]>(queue);
    useEffect(() => {
        listeners.add(setItems);
        return () => {
            listeners.delete(setItems);
        };
    }, []);
    const current = items[0];
    if (!current) return null;
    return <DialogSheet key={current.id} request={current} />;
}

function DialogSheet({ request }: { request: Request }) {
    const [text, setText] = useState(request.initial);
    const baseId = useId();
    const isPrompt = request.kind === 'prompt';
    const isAlert = request.kind === 'alert';
    const cancelValue = isAlert ? undefined : isPrompt ? null : false;

    const cancel = () => settle(request.id, cancelValue);
    const accept = () => settle(request.id, isPrompt ? text : true);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        };
        window.addEventListener('keydown', onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = previous;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request.id]);

    const title = isAlert ? 'Notice' : isPrompt ? 'Enter details' : 'Please confirm';

    return (
        <div className='fixed inset-0 z-[1300] flex items-end justify-center sm:items-center sm:p-4' role='presentation'>
            <button type='button' aria-label='Cancel' tabIndex={-1} className='absolute inset-0 bg-black/60' onClick={cancel} />
            <div
                role={isAlert ? 'alertdialog' : 'dialog'}
                aria-modal='true'
                aria-labelledby={`${baseId}-title`}
                aria-describedby={`${baseId}-message`}
                className='relative flex max-h-[90dvh] w-full flex-col rounded-t-2xl border border-line bg-panel text-ink shadow-2xl sm:max-w-md sm:rounded-2xl'
            >
                <div className='flex items-start gap-3 border-b border-line p-4'>
                    {isAlert ? <Info className='mt-0.5 h-5 w-5 shrink-0 text-brand' /> : !isPrompt && <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0 text-amber-400' />}
                    <h2 id={`${baseId}-title`} className='min-w-0 flex-1 text-base font-semibold text-ink'>
                        {title}
                    </h2>
                    <button type='button' aria-label='Close' onClick={cancel} className='-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-page'>
                        <X className='h-5 w-5' />
                    </button>
                </div>
                <form
                    className='flex min-h-0 flex-1 flex-col'
                    onSubmit={(e) => {
                        e.preventDefault();
                        accept();
                    }}
                >
                    <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4'>
                        <p id={`${baseId}-message`} className='whitespace-pre-line text-sm text-soft'>
                            {request.message}
                        </p>
                        {isPrompt && (
                            <input
                                aria-label={request.message.slice(0, 120) || 'Your answer'}
                                value={text}
                                maxLength={500}
                                autoComplete='off'
                                onChange={(e) => setText(e.target.value)}
                                className='h-12 w-full rounded-xl border border-line bg-page px-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none'
                            />
                        )}
                    </div>
                    <div className='flex gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>
                        {!isAlert && (
                            <button type='button' onClick={cancel} className='flex h-12 flex-1 items-center justify-center rounded-xl border border-line text-sm font-semibold text-soft active:bg-page'>
                                Cancel
                            </button>
                        )}
                        <button type='submit' className='flex h-12 flex-1 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-onbrand active:opacity-80'>
                            {isAlert ? 'OK' : isPrompt ? 'Continue' : 'Confirm'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
