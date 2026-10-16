import { api } from '@appdeploy/client';
import { firebaseAuth } from '../firebase';

function readError(err: unknown): string {
    const response = (err as { response?: { data?: { error?: string; message?: string } } } | null)?.response;
    return response?.data?.error || response?.data?.message || 'Something went wrong. Please try again.';
}

/** Calls a protected MEMS backend route with a fresh Firebase ID token. */
export async function callBackend<T>(path: string, data: Record<string, unknown> = {}): Promise<T> {
    const user = firebaseAuth.currentUser;
    if (!user) {
        throw new Error('Please log in again.');
    }
    const idToken = await user.getIdToken();
    try {
        const res = await api.post(path, { ...data, idToken });
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
