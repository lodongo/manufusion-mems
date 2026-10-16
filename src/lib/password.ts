export const PASSWORD_RULE = 'Use at least 10 characters with upper-case and lower-case letters, a number and a symbol.';

export function passwordProblem(password: string): string {
    if (
        password.length < 10 ||
        password.length > 128 ||
        !/[a-z]/.test(password) ||
        !/[A-Z]/.test(password) ||
        !/\d/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)
    ) {
        return PASSWORD_RULE;
    }
    return '';
}
