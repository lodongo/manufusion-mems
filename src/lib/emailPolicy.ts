export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SUPER_ADMIN_DOMAIN = 'manufusion.com';
export const WEBSITE_URL = 'https://manufusion.com';

const PUBLIC_EMAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'hotmail.com',
    'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
    'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'mail.com', 'email.com',
    'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'tutanota.com', 'tuta.io', 'hey.com',
    'fastmail.com', 'qq.com', '163.com', '126.com', 'rediffmail.com', 'inbox.com', 'mail.ru',
    'hushmail.com', 'lycos.com', 'web.de', 'naver.com', 'yopmail.com', 'mailinator.com',
]);
const PUBLIC_EMAIL_PREFIXES = ['yahoo.', 'hotmail.', 'outlook.', 'live.', 'gmx.', 'yandex.', 'aol.'];

export function emailDomain(email: string): string {
    const at = email.lastIndexOf('@');
    return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

export function isPublicEmail(email: string): boolean {
    const domain = emailDomain(email);
    return PUBLIC_EMAIL_DOMAINS.has(domain) || PUBLIC_EMAIL_PREFIXES.some((prefix) => domain.startsWith(prefix));
}
