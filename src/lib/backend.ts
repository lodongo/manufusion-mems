import { api } from './httpClient';
import { firebaseAuth } from '../firebase';

function readError(err: unknown): string {
    const response = (err as { response?: { data?: { error?: string; message?: string } } } | null)?.response;
    return response?.data?.error || response?.data?.message || 'Something went wrong. Please try again.';
}

const CLEANUP_KEY='mems.maintenance.cleanup';
export function cleanupToken():string {try{return sessionStorage.getItem(CLEANUP_KEY)||'';}catch{return '';}}
export function storeCleanupToken(token:string){try{if(token)sessionStorage.setItem(CLEANUP_KEY,token);else sessionStorage.removeItem(CLEANUP_KEY);}catch{/* Fail closed if session storage is blocked. */}}
export async function revokeCleanupOnLogout(){const token=cleanupToken();storeCleanupToken('');if(!token)return;try{await callBackend('/api/org/mnt/test_deletion/authorization/set',{enabled:false,cleanupToken:token});}catch{/* New login cannot reuse the grant; server expiry remains authoritative. */}}
/** Calls a protected MEMS backend route with a fresh Firebase ID token. */
export async function callBackend<T>(path: string, data: Record<string, unknown> = {}): Promise<T> {
    const user = firebaseAuth.currentUser;
    if (!user) {
        throw new Error('Please log in again.');
    }
    const idToken = await user.getIdToken();
    try {
        const res = await api.post(path, { ...(path.startsWith('/api/org/mnt/test_deletion/')?{cleanupToken:cleanupToken()}:{}), ...data, idToken });
        return res.data as T;
    } catch (err) {
        throw new Error(readError(err));
    }
}

export async function publicGet<T>(path: string): Promise<T> {
    try {
        const res = await api.get(path);
        return res.data as T;
    } catch (err) {
        throw new Error(readError(err));
    }
}

export async function publicPost<T>(path: string, data: Record<string, unknown>): Promise<T> {
    try {
        const res = await api.post(path, data);
        return res.data as T;
    } catch (err) {
        throw new Error(readError(err));
    }
}
