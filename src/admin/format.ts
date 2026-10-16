export function fmtDate(iso?: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtNum(value: number | null | undefined, digits = 0): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtKes(value: number): string {
    return `KES ${fmtNum(value)}`;
}

export function fmtUsdFromKes(kes: number, kesPerUsd: number | null): string {
    if (!kesPerUsd) return 'USD —';
    return `USD ${(kes / kesPerUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const CATEGORY_LABELS: Record<string, string> = {
    auth: 'Authentication',
    registration: 'Registration',
    data: 'Data changes',
    admin: 'Administration',
    approval: 'Approvals',
    api: 'API calls',
    navigation: 'Navigation',
    interaction: 'Clicks',
    form: 'Form submissions',
    error: 'Errors',
};

export const ACTION_LABELS: Record<string, string> = {
    'setup.complete': 'MEMS setup completed',
    'setup.attempt': 'MEMS setup attempt',
    'auth.login_attempt': 'Login attempt',
    'auth.session_start': 'Session started',
    'profile.update': 'Profile updated',
    'staff.create': 'MEMS user added',
    'staff.update': 'MEMS user updated',
    'staff.delete': 'MEMS user deleted',
    'tenant.register': 'Organization registered',
    'tenant.register_attempt': 'Organization registration attempt',
    'tenant.status': 'Tenant status changed',
    'tenant.module': 'Tenant module changed',
    'module.seed': 'Default modules uploaded',
    'module.create': 'Module added',
    'module.update': 'Module updated',
    'module.delete': 'Module deleted',
    'module.initialise': 'Module initialised',
    'module.metadata.save': 'Module metadata saved',
    'module.metadata.delete': 'Module metadata deleted',
    'site.update': 'Site setup saved',
    'site.reset': 'Site setup reset',
    'reference.load': 'Default values loaded',
    'reference.reset': 'Default values reset',
    'reference.clear': 'Default values cleared',
    'reference.rates': 'Exchange rates updated',
    'org.user.create': 'User added',
    'org.user.update': 'User updated',
    'org.user.delete': 'User deleted',
    'org.role.create': 'Role created',
    'org.role.update': 'Role updated',
    'org.role.delete': 'Role deleted',
    'tenant.activated': 'Organization activated',
    'tenant.email_verified': 'Registrant email verified',
    'tenant.approved': 'Organization approved',
    'tenant.rejected': 'Organization rejected',
    'tenant.purged': 'Rejected registration deleted',
    'registration.document_viewed': 'Registration document viewed',
    'tenant.claim_released': 'Unverified registration released',
    'bank.create': 'Bank added',
    'bank.update': 'Bank updated',
    'bank.delete': 'Bank deleted',
    'bank.import': 'Banks imported',
    'sequence.set': 'Sequence changed',
    'application.start': 'Registration started',
    'application.start_attempt': 'Registration attempt',
    'application.save': 'Registration step saved',
    'application.upload': 'Registration document uploaded',
    'application.submit': 'Registration submitted',
    'application.view': 'Registration viewed',
    'application.approve': 'Registration approved',
    'application.return': 'Registration returned',
    'application.reject': 'Registration rejected',
    'application.released': 'Unverified registration released',
    'staff.reset_password': 'MEMS user password reset',
    'org.user.reset_password': 'User password reset',
    'auth.password_changed': 'Password changed',
    'explorer.view': 'Database document viewed',
    'staff.repair': 'MEMS user profile attached',
    'settings.registration': 'Registration settings changed',
    'org.branding.update': 'Branding updated',
    'org.branding.logo': 'Logo updated',
    'org.structure.create': 'Added to organization design',
    'org.structure.design': 'Organization design type changed',
    'org.position.create': 'Organization role added',
    'org.position.update': 'Organization role updated',
    'org.position.delete': 'Organization role deleted',
    'org.structure.site_roles': 'Site roles changed',
    'org.structure.logo': 'Legal entity logo changed',
    'org.structure.recode': 'Legal entity code changed',
    'org.user.scope': 'User roles and access changed',
    'org.modules.enable': 'Modules enabled',
    'org.modules.adopt': 'Module adopted',
    'org.modules.remove': 'Module removed from adopted',
    'org.modules.disable': 'Modules disabled',
    'org.subscription.paid': 'Subscription paid',
    'org.subscription.pay_start': 'Payment started',
    'org.subscription.webhook': 'Payment update received',
    'module.metadata.defaults': 'Default module lists loaded',
    'org.subscription.pay': 'Subscription payment',
    'payment.webhook': 'Payment update from IntaSend',
    'billing.provider': 'Payment provider changed',
    'org.structure.update': 'Updated in organization design',
    'org.structure.delete': 'Removed from organization design',
    'org.bom.save': 'Bill of materials saved',
    'org.bom.delete': 'Bill of materials deleted',
    'org.settings.update': 'Organization settings saved',
    'profile.photo': 'Photo changed',
    navigate: 'Navigated',
    click: 'Clicked',
    select: 'Selected',
    submit: 'Submitted form',
    'app.open': 'Opened app',
};
