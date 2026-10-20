/**
 * Live chat: one authenticated long-poll (POST /api/org/quick/chat/subscribe) that returns the moment the
 * person's inbox or the open conversation changes. Replaces the old 12-second refresh.
 * The server sends revisions only — never message text — and checks membership on every call; the screen
 * then refetches through the normal membership-checked routes.
 */
import { useEffect, useRef, useState } from 'react';
import { callBackend } from '../lib/backend';
import type { ChatLiveState } from './chatTypes';

interface WaitResult {
    live: boolean;
    inboxRev: string;
    roomRev: string;
    roomDataRev: string;
    changed: { inbox: boolean; roomData: boolean; roomLive: boolean };
    state: ChatLiveState | null;
}
export interface LiveHandlers {
    inbox: () => void;
    roomData: () => void;
    roomLive: (state: ChatLiveState) => void;
}

export function useChatLive(roomId: string, handlers: LiveHandlers): { connected: boolean } {
    const latest = useRef(handlers);
    latest.current = handlers;
    const [connected, setConnected] = useState(false);
    useEffect(() => {
        let alive = true;
        let revs = { inboxRev: '', roomRev: '', roomDataRev: '' };
        let failures = 0;
        const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const visible = () => new Promise<void>((resolve) => {
            if (document.visibilityState !== 'hidden') return resolve();
            const on = () => { if (document.visibilityState !== 'hidden') { document.removeEventListener('visibilitychange', on); resolve(); } };
            document.addEventListener('visibilitychange', on);
        });
        const loop = async () => {
            let init = true;
            let resync = false;
            while (alive) {
                await visible();
                if (!alive) return;
                try {
                    const r = await callBackend<WaitResult>('/api/org/quick/chat/subscribe', { roomId, init, ...revs });
                    if (!alive) return;
                    revs = { inboxRev: r.inboxRev, roomRev: r.roomRev, roomDataRev: r.roomDataRev };
                    failures = 0;
                    setConnected(true);
                    if (r.state) latest.current.roomLive(r.state);
                    if (!init) {
                        if (r.changed.inbox) latest.current.inbox();
                        if (r.changed.roomData) latest.current.roomData();
                    } else if (resync) {
                        // Changes made while disconnected are fetched once the connection is back.
                        latest.current.inbox();
                        if (roomId) latest.current.roomData();
                    }
                    init = false;
                    resync = false;
                } catch {
                    if (!alive) return;
                    failures += 1;
                    setConnected(false);
                    // Back off on errors (offline, deploys) and resynchronise with a fresh init call.
                    await pause(Math.min(30_000, 1500 * 2 ** Math.min(failures, 5)));
                    init = true;
                    resync = true;
                }
            }
        };
        void loop();
        // After being offline the long-poll restarts at once when the network returns.
        const online = () => { failures = 0; };
        window.addEventListener('online', online);
        return () => { alive = false; window.removeEventListener('online', online); };
    }, [roomId]);
    return { connected };
}
