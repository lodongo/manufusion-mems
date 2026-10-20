import { ArrowLeft, CalendarDays, Check, ClipboardList, FileText, Footprints, MessageCircle, Save, Zap } from 'lucide-react';
import QuickActions from './QuickActions';
import { QuickNotepad } from './QuickPersonal';
import QuickGemba from './QuickGemba';
import QuickChat from './QuickChat';
import QuickCalendar from './QuickCalendar';
import ChatPolicyGate from './ChatPolicyGate';
import { leaveQuick } from './quickNavigation';

const tools = [
    { value: 'todo', label: 'To-do', icon: ClipboardList },
    { value: 'gemba', label: 'Gemba', icon: Footprints },
    { value: 'notepad', label: 'Notepad', icon: FileText },
    { value: 'chat', label: 'Chat', icon: MessageCircle },
    { value: 'calendar', label: 'Calendar', icon: CalendarDays },
] as const;

function returnPage(uid: string) {
    try {
        const stored = sessionStorage.getItem('mems.quick.return.' + uid) || '';
        if ((stored.startsWith('organization_home') || stored.startsWith('organization_admin'))
            && !stored.includes('/quick')) return stored;
    } catch { /* Return home if there is no saved originating page. */ }
    return 'organization_home';
}
const quickRoute = (mode?: string) => 'organization_home/quick' + (mode ? '/' + mode : '');

export default function QuickWorkspace({ mode, id, uid }: { mode?: string; id?: string; uid: string }) {
    const active = tools.find((item) => item.value === mode);
    const exit = () => leaveQuick(returnPage(uid));
    const switchTo = (next: string) => leaveQuick(quickRoute(next));
    if (mode === 'chat') {
        return <div className='fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-hidden bg-page text-ink'
            aria-label='Full-screen Chat'>
            <ChatPolicyGate><QuickChat uid={uid} roomId={id} /></ChatPolicyGate>
        </div>;
    }
    return (
        <div className='fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-hidden bg-page text-ink'
            aria-label='Full-screen Quick links workspace'>
            <header className='z-10 shrink-0 border-b border-line bg-panel px-3 pt-[env(safe-area-inset-top)] shadow-sm sm:px-6'>
                <div className='mx-auto flex min-h-16 w-full max-w-5xl items-center gap-2'>
                    <button type='button' onClick={exit} aria-label='Save and exit quick workspace'
                        className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-page text-brand'>
                        <ArrowLeft className='h-5 w-5' />
                    </button>
                    <div className='min-w-0 flex-1'>
                        <p className='flex items-center gap-2 text-sm font-semibold text-ink'>
                            <Zap className='h-4 w-4 text-brand' />
                            {active ? active.label : 'Quick links'}
                        </p>
                        <p className='truncate text-[11px] text-muted'>
                            {mode === 'todo' ? 'Actions · progress · completion'
                                : mode === 'gemba' ? 'Capture now, review later'
                                    : mode === 'notepad' ? 'Notes with formatting'
                                        : mode === 'calendar' ? 'Meetings · action due dates · closures'
                                        : mode === 'chat' ? 'Conversations · groups · files'
                                            : 'Your mobile quick workspace'}
                        </p>
                    </div>
                    <button type='button' onClick={exit}
                        className='flex min-h-11 items-center gap-2 rounded-xl bg-brand px-3 text-xs font-semibold text-onbrand'>
                        <Save className='h-4 w-4' />
                        <span className='hidden min-[360px]:inline'>Save & exit</span>
                        <span className='min-[360px]:hidden'>Exit</span>
                    </button>
                </div>
                <nav aria-label='Quick tools' className='mx-auto grid w-full max-w-5xl grid-cols-5 gap-1 pb-2'>
                    {tools.map((item) => (
                        <button key={item.value} type='button' onClick={() => switchTo(item.value)}
                            aria-current={active?.value === item.value ? 'page' : undefined}
                            className={'flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-0.5 text-[11px] font-semibold transition-colors sm:flex-row sm:gap-1.5 sm:px-1.5 sm:text-xs ' +
                                (active?.value === item.value
                                    ? 'border-brand bg-brand/10 text-brand'
                                    : 'border-line bg-page text-soft')}>
                            <item.icon className='h-4 w-4 shrink-0' />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </nav>
            </header>
            <main className={'min-h-0 flex-1 ' + (mode === 'chat' ? 'overflow-hidden p-0' : 'overflow-y-auto overscroll-contain px-3 py-4 sm:px-6')}
                aria-label={active ? active.label + ' active workspace' : 'Quick links'}>
                <div className={mode === 'chat' ? 'mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden' : 'mx-auto w-full max-w-5xl'}>
                    {mode === 'todo' ? <QuickActions uid={uid} /> :
                        mode === 'notepad' ? <QuickNotepad uid={uid} /> :
                            mode === 'gemba' ? <QuickGemba uid={uid} id={id} /> :
                            mode === 'chat' ? <QuickChat uid={uid} roomId={id} /> :
                            mode === 'calendar' ? <QuickCalendar uid={uid} /> :
                                <div className='space-y-3'>
                                    <div className='rounded-2xl border border-line bg-panel p-5'>
                                        <h1 className='flex items-center gap-2 text-xl font-semibold text-ink'>
                                            <Zap className='h-5 w-5 text-brand' /> Quick links
                                        </h1>
                                        <p className='mt-1 text-sm text-muted'>Start work in one tap. Your progress remains ready when you return.</p>
                                    </div>
                                    {tools.map((item) => (
                                        <button type='button' key={item.value} onClick={() => switchTo(item.value)}
                                            className='flex min-h-20 w-full items-center gap-4 rounded-2xl border border-line bg-panel px-4 text-left'>
                                            <span className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand'>
                                                <item.icon className='h-6 w-6' />
                                            </span>
                                            <span className='min-w-0 flex-1'>
                                                <span className='block text-sm font-semibold text-ink'>{item.label}</span>
                                                <span className='block text-xs text-muted'>
                                                    {item.value === 'todo' ? 'Actions, deadlines and completion'
                                                        : item.value === 'gemba' ? 'Start or resume an asset walk'
                                                            : item.value === 'notepad' ? 'Take, format and save personal notes'
                                                                : item.value === 'calendar' ? 'Meetings, deadlines and confirmed action closures'
                                                                : 'Secure chat with colleagues, groups and reports'}
                                                </span>
                                            </span>
                                            <Check className='h-4 w-4 text-muted' />
                                        </button>
                                    ))}
                                </div>
                    }
                </div>
            </main>
            <footer className='z-10 shrink-0 border-t border-line bg-panel px-3 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6'>
                <div className='mx-auto flex w-full max-w-5xl items-center gap-2'>
                    <button type='button' onClick={() => leaveQuick(quickRoute())}
                        className='flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-page px-3 text-xs font-semibold text-ink'>
                        <Zap className='h-4 w-4' />
                        Quick links
                    </button>
                    <button type='button' onClick={exit}
                        className='flex min-h-12 flex-[1.6] items-center justify-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-onbrand'>
                        <Save className='h-4 w-4' />
                        Save & exit
                    </button>
                </div>
            </footer>
        </div>
    );
}
