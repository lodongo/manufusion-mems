import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { firebaseAuth } from './firebase';
import { flush, installAuditTracking, track } from './lib/audit';
import { callBackend, publicGet } from './lib/backend';
import { navigate, useHashRoute } from './lib/route';
import { EMPTY_LOCKED, SITE_DEFAULTS, SiteContext, applyTheme, fetchSite, type SiteConfig, type SiteLocked } from './lib/site';
import { effectivePersonalTheme } from './lib/personalTheme';
import { BRAND_PRESETS } from './lib/brandTheme';
import { STAFF_ROLES, type Session } from './types';
import LoginScreen from './components/LoginScreen';
import SetupScreen from './components/SetupScreen';
import SitePage from './components/SitePage';
import ChangePassword from './components/ChangePassword';
import PhotoRequired from './components/PhotoRequired';
import PendingApproval from './components/PendingApproval';
import RegisterStart from './apply/RegisterStart';
import ApplicationWizard from './apply/ApplicationWizard';
import AdminShell from './admin/AdminShell';
import OrgShell from './org/OrgShell';
import OrgHomePage from './org/OrgHomePage';
import DocumentSignatureVerification from './org/DocumentSignatureVerification';
import QuickWorkspace from './org/QuickWorkspace';
import OrganizationFooter from './components/OrganizationFooter';
import HealthTracker from './components/HealthTracker';
import { Alert } from './components/ui';
import GlobalSelectEnhancer from './components/GlobalSelectEnhancer';
import { DialogHost } from './components/dialogs';

type SetupState = 'checking' | 'needed' | 'done' | 'error';
type SessionState = 'idle' | 'loading' | 'ready' | 'error';

function Loading() {
    return (
        <div className='flex min-h-dvh items-center justify-center bg-page'>
            <Loader2 className='h-8 w-8 animate-spin text-brand' aria-label='Loading' />
        </div>
    );
}

function ErrorScreen({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut?: () => void }) {
    return (
        <div className='flex min-h-dvh items-center justify-center bg-page px-6'>
            <div className='w-full max-w-sm space-y-4'>
                <Alert tone='error'>{message}</Alert>
                <button onClick={onRetry} className='h-12 w-full rounded-xl bg-brand font-semibold text-onbrand'>
                    Try again
                </button>
                {onSignOut && (
                    <button onClick={onSignOut} className='h-12 w-full rounded-xl border border-line text-soft'>
                        Log out
                    </button>
                )}
            </div>
        </div>
    );
}

function App() {
    const route = useHashRoute();
    const [site, setSite] = useState<{ config: SiteConfig; locked: SiteLocked }>({ config: SITE_DEFAULTS, locked: EMPTY_LOCKED });
    const [setup, setSetup] = useState<SetupState>('checking');
    const [setupError, setSetupError] = useState('');
    const [authUser, setAuthUser] = useState<User | null | undefined>(undefined);
    const [session, setSession] = useState<Session | null>(null);
    const [sessionState, setSessionState] = useState<SessionState>('idle');
    const [sessionError, setSessionError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);
    const [notice, setNotice] = useState('');

    useEffect(() => {
        const locked = (event: Event) => {
            const details = (event as CustomEvent<{
                uid: string;
                locked: true;
                kind: string;
                until: string;
                message: string;
            }>).detail;
            const signedInUser = firebaseAuth.currentUser;
            if (!signedInUser || !details?.uid || signedInUser.uid !== details.uid
                || !details.until || Date.parse(details.until) <= Date.now()) return;
            // Only the locked Firebase user is signed out. A stale event from an
            // earlier account must never sign out someone else on this device.
            const email = (signedInUser.email || '').trim().toLowerCase();
            if (!email) return;
            try {
                sessionStorage.setItem(
                    'mems.health.lock.' + email,
                    JSON.stringify({ email, kind: details.kind, until: details.until, message: details.message, locked: true, policyVersion: 2 })
                );
            } catch { /* Server-side account protection remains authoritative. */ }
            // A lockout message is never a global login notice for another user.
            setNotice('');
            setSession(null);
            navigate('');
            void signOut(firebaseAuth);
        };
        window.addEventListener('mems-health-lock', locked);
        return () => window.removeEventListener('mems-health-lock', locked);
    }, []);

    useEffect(() => {
        installAuditTracking();
        applyTheme(SITE_DEFAULTS.theme);
        fetchSite()
            .then((res) => {
                setSite({ config: { ...SITE_DEFAULTS, ...res.config }, locked: res.locked });
                applyTheme(res.config.theme);
            })
            .catch(() => undefined);
    }, []);

    // Personal appearance changes only neutral colors; MEMS organization branding is authoritative.
    useEffect(() => {
        const ownSession = session?.user.uid === authUser?.uid ? session : null;
        const orgTheme = ownSession?.organization?.branding?.theme;
        const appearance = ownSession?.preferences?.appearance ?? 'organization';
        applyTheme(orgTheme ? effectivePersonalTheme(orgTheme, appearance) : site.config.theme);
        if (ownSession?.organization && appearance !== 'organization') {
            const selected = appearance === 'light' ? 'daylight' : appearance === 'dark' ? 'emerald' : appearance;
            document.documentElement.dataset.memsAppearance = BRAND_PRESETS.find((p) => p.key === selected)?.dark ? 'dark' : 'light';
        } else {
            delete document.documentElement.dataset.memsAppearance;
        }
        document.title = ownSession?.organization?.branding?.displayName || 'MEMS | Manufusion';
        return () => { delete document.documentElement.dataset.memsAppearance; };
    }, [session, site, authUser]);

    const siteState = useMemo(
        () => ({
            config: site.config,
            locked: site.locked,
            setConfig: (config: SiteConfig) => {
                setSite((s) => ({ ...s, config }));
                applyTheme(config.theme);
            },
        }),
        [site]
    );

    const checkSetup = useCallback(async () => {
        setSetup('checking');
        setSetupError('');
        try {
            const res = await publicGet<{ needsSetup: boolean }>('/api/setup/status');
            setSetup(res.needsSetup ? 'needed' : 'done');
        } catch (err) {
            setSetupError(err instanceof Error ? err.message : 'Could not reach MEMS.');
            setSetup('error');
        }
    }, []);

    useEffect(() => {
        void checkSetup();
    }, [checkSetup]);

    useEffect(() => onAuthStateChanged(firebaseAuth, (user) => setAuthUser(user)), []);

    useEffect(() => {
        if (setup !== 'done' || !authUser) {
            setSession(null);
            setSessionState('idle');
            return;
        }
        let active = true;
        setSessionState('loading');
        callBackend<Session>('/api/session')
            .then((res) => {
                if (!active) return;
                if (res.health?.lock && Date.parse(res.health.lock.until) > Date.now()) {
                    window.dispatchEvent(new CustomEvent('mems-health-lock', { detail: { ...res.health.lock, uid: res.user.uid } }));
                    return;
                }
                setSession(res);
                setSessionState('ready');
                const current = window.location.hash.replace(/^#\/?/, '');
                if (current === 'site' || /^verify\/document\/[a-f0-9]{20}\/[a-f0-9]{64}$/.test(current)) return;
                // Personal landing preference applies on login; intentional deep links win.
                if (res.landing === 'organization_admin' || res.landing === 'organization_home') {
                    const last = res.lastRoute ?? '';
                    const validLast = /^(organization_home|organization_admin)(\/[A-Za-z0-9_-]{1,128}){0,8}$/.test(last)
                        && (res.landing === 'organization_admin' || !last.startsWith('organization_admin'));
                    // Explicitly remember the last organization-design or job-role configuration
                    // on this device; otherwise preserve the normal home/last-page preference.
                    let lastConfiguration = '';
                    if (res.landing === 'organization_admin' && res.organization?.id) {
                        try {
                            const key = 'mems.lastDesign.' + res.organization.id + '.' + res.user.uid;
                            const saved = localStorage.getItem(key) || '';
                            if (/^organization_admin\/(structure|positions)(\/[A-Za-z0-9_-]{1,128}){0,3}$/.test(saved)) lastConfiguration = saved;
                        } catch { /* no persisted route on this device */ }
                    }
                    const destination = lastConfiguration || (res.preferences?.startPage === 'last' && validLast ? last : 'organization_home');
                    if (!current || current === 'login' || current === 'organization_home' || current === 'organization_admin') {
                        navigate(destination);
                    } else if (!current.startsWith('organization_home/')
                        && !(res.landing === 'organization_admin' && current.startsWith('organization_admin/'))) {
                        navigate('organization_home');
                    }
                } else {
                    const last = res.lastRoute ?? '';
                    const area = res.landing === 'admin' ? 'admin' : '';
                    if (area && !current.startsWith(area)) navigate(last.startsWith(area) ? last : res.landing);
                    else if (res.landing === 'application' && current !== 'application') navigate('application');
                }
            })
            .catch((err: unknown) => {
                if (!active) return;
                setSessionError(err instanceof Error ? err.message : 'Could not load your account.');
                setSessionState('error');
            });
        return () => {
            active = false;
        };
    }, [setup, authUser, reloadKey]);

    const handleSignOut = useCallback(() => {
        track('auth', 'logout');
        void flush().finally(() => {
            setNotice('');
            navigate('');
            void signOut(firebaseAuth);
        });
    }, []);

    const render = () => {
        if (authUser === undefined) return <Loading />;
        if (route === 'site') return <SitePage />;
        if (!authUser && route === 'register') return <RegisterStart />;
        if (setup === 'checking') return <Loading />;
        if (setup === 'error') return <ErrorScreen message={setupError} onRetry={() => void checkSetup()} />;
        if (setup === 'needed') {
            return (
                <SetupScreen
                    onDone={(message) => {
                        setNotice(message ?? '');
                        setSetup('done');
                    }}
                />
            );
        }
        if (!authUser) return <LoginScreen notice={notice} />;
        if (sessionState === 'idle' || sessionState === 'loading' || session?.user.uid !== authUser.uid) return <Loading />;
        if (sessionState === 'error' || !session) {
            return <ErrorScreen message={sessionError || 'Could not load your account.'} onRetry={() => setReloadKey((key) => key + 1)} onSignOut={handleSignOut} />;
        }
        if (session.mustChangePassword) {
            return <ChangePassword email={session.user.email} onDone={() => setReloadKey((key) => key + 1)} onSignOut={handleSignOut} />;
        }
        if (session.photoRequired) {
            return (
                <PhotoRequired
                    name={session.user.firstName || session.user.email}
                    onDone={() => setReloadKey((key) => key + 1)}
                    onSignOut={handleSignOut}
                />
            );
        }
        if (session.role && STAFF_ROLES.includes(session.role)) {
            return <AdminShell session={session} route={route} onSignOut={handleSignOut} onSessionChange={setSession} />;
        }
        if (session.role === 'applicant') {
            return <ApplicationWizard session={session} onSignOut={handleSignOut} />;
        }
        if (session.organization) {
            if (['pending_approval', 'pending_verification', 'rejected'].includes(session.organization.status)) {
                return <PendingApproval session={session} onRefresh={() => setReloadKey((key) => key + 1)} onSignOut={handleSignOut} />;
            }
            if (session.organization.status === 'suspended') {
                return <ErrorScreen message='Your organization has been suspended. Please contact MEMS support.' onRetry={() => setReloadKey((key) => key + 1)} onSignOut={handleSignOut} />;
            }
            const signatureRoute = new RegExp('^verify/document/([a-f0-9]{20})/([a-f0-9]{64})
            if(signatureRoute)return <DocumentSignatureVerification documentId={signatureRoute[1]} proof={signatureRoute[2]}/>;
            const canAdmin = session.landing === 'organization_admin';
            if (route === 'organization_home/quick' || route.startsWith('organization_home/quick/')) {
                const [, , mode, id] = route.split('/');
                return <QuickWorkspace uid={session.user.uid} mode={mode} id={id} />;
            }
            if (canAdmin && route.startsWith('organization_admin')) {
                return <OrgShell session={session} route={route} onSignOut={handleSignOut} onSessionChange={setSession} />;
            }
            return <OrgHomePage session={session} route={route} canAdmin={canAdmin} onSignOut={handleSignOut} onSessionChange={setSession} />;
        }
        return (
            <ErrorScreen
                message='Your account has not been given access to MEMS yet. Please contact your administrator.'
                onRetry={() => setReloadKey((key) => key + 1)}
                onSignOut={handleSignOut}
            />
        );
    };

    const organizationReady = !!session?.organization && session.user.uid === authUser?.uid
        && sessionState === 'ready' && !!authUser && !session.mustChangePassword && !session.photoRequired
        && session.role !== 'applicant' && route !== 'site';
    const quickFullScreen = route === 'organization_home/quick' || route.startsWith('organization_home/quick/');
    return (
        <SiteContext.Provider value={siteState}>
            <GlobalSelectEnhancer />
            <DialogHost />
            <div className={organizationReady ? 'mems-organization-ui' + (quickFullScreen ? '' : ' pb-12') : ''}>{render()}</div>
            {organizationReady && session && <HealthTracker session={session} />}
            {organizationReady && !quickFullScreen && <OrganizationFooter />}
        </SiteContext.Provider>
    );
}

export default App;
).exec(route);
            if(signatureRoute)return <DocumentSignatureVerification documentId={signatureRoute[1]} proof={signatureRoute[2]}/>;
            const canAdmin = session.landing === 'organization_admin';
            if (route === 'organization_home/quick' || route.startsWith('organization_home/quick/')) {
                const [, , mode, id] = route.split('/');
                return <QuickWorkspace uid={session.user.uid} mode={mode} id={id} />;
            }
            if (canAdmin && route.startsWith('organization_admin')) {
                return <OrgShell session={session} route={route} onSignOut={handleSignOut} onSessionChange={setSession} />;
            }
            return <OrgHomePage session={session} route={route} canAdmin={canAdmin} onSignOut={handleSignOut} onSessionChange={setSession} />;
        }
        return (
            <ErrorScreen
                message='Your account has not been given access to MEMS yet. Please contact your administrator.'
                onRetry={() => setReloadKey((key) => key + 1)}
                onSignOut={handleSignOut}
            />
        );
    };

    const organizationReady = !!session?.organization && session.user.uid === authUser?.uid
        && sessionState === 'ready' && !!authUser && !session.mustChangePassword && !session.photoRequired
        && session.role !== 'applicant' && route !== 'site';
    const quickFullScreen = route === 'organization_home/quick' || route.startsWith('organization_home/quick/');
    return (
        <SiteContext.Provider value={siteState}>
            <GlobalSelectEnhancer />
            <DialogHost />
            <div className={organizationReady ? 'mems-organization-ui' + (quickFullScreen ? '' : ' pb-12') : ''}>{render()}</div>
            {organizationReady && session && <HealthTracker session={session} />}
            {organizationReady && !quickFullScreen && <OrganizationFooter />}
        </SiteContext.Provider>
    );
}

export default App;
