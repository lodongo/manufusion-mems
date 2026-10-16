export function authErrorMessage(err: unknown): string {
    const code = (err as { code?: string } | null)?.code ?? '';
    switch (code) {
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
        case 'auth/invalid-email':
            return 'Incorrect email or password.';
        case 'auth/user-disabled':
            return 'This account has been disabled. Contact your administrator.';
        case 'auth/password-does-not-meet-requirements':
            return 'Your password does not meet the security policy. Ask your administrator to reset it.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please wait a few minutes and try again.';
        case 'auth/network-request-failed':
            return 'No internet connection. Check your network and try again.';
        case 'auth/operation-not-allowed':
            return 'Email and password login is not enabled yet.';
        case 'auth/user-token-expired':
        case 'auth/requires-recent-login':
            return 'Your session has expired. Please log in again.';
        default:
            return code ? `Login failed (${code.replace('auth/', '')}). Please try again.` : 'Login failed. Please try again.';
    }
}
