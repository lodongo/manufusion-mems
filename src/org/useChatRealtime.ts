import { useEffect, useRef, useState } from 'react';
import { ws } from '@appdeploy/client';
import { callBackend } from '../lib/backend';
import type { ChatLiveEvent } from './chatTypes';

interface LiveHandlers {
    inbox: () => void;
    room: (message: ChatLiveEvent) => void;
}
interface ChatLiveState {
    connected: boolean;
    notice: string;
}

export function useChatRealtime(uid: string, roomId: string, handlers: LiveHandlers): ChatLiveState {
    const callbacks = useRef(handlers);
    callbacks.current = handlers;
    const roomRef = useRef(roomId);
    roomRef.current = roomId;
    const connectionRef = useRef<ReturnType<typeof ws.connect> | null>(null);
    const [connectionId, setConnectionId] = useState('');
    const [connected, setConnected] = useState(false);
    const [notice, setNotice] = useState('');

    useEffect(() => {
        let active = true;
        let retry: ReturnType<typeof setTimeout> | null = null;
        let current: ReturnType<typeof ws.connect> | null = null;

        const connect = () => {
            if (!active) return;
            const conn = ws.connect();
            current = conn;
            connectionRef.current = conn;
            conn.onMessage((incoming: unknown) => {
                const raw = incoming as Record<string, unknown>;
                let payload: unknown = raw?.data ?? raw?.payload ?? incoming;
                if (typeof payload === 'string') {
                    try { payload = JSON.parse(payload); } catch { return; }
                }
                if (!payload || typeof payload !== 'object') return;
                const message = payload as ChatLiveEvent;
                if (message.type !== 'entity.update') return;
                if (message.entity_type === 'chat.inbox' && message.entity_id === uid) {
                    callbacks.current.inbox();
                } else if (message.entity_type === 'chat.room' && message.entity_id === roomRef.current) {
                    callbacks.current.room(message);
                }
            });
            conn.onOpen(() => { if (active) setConnected(true); });
            conn.onClose(() => {
                if (!active) return;
                setConnected(false);
                setConnectionId('');
                if (retry) clearTimeout(retry);
                retry = setTimeout(connect, 2400);
            });
            conn.onError(() => {
                if (active) { setConnected(false); setNotice('Reconnecting live messages…'); }
            });
            void conn.ready.then(() => {
                if (!active || conn !== current || !conn.connectionId) return;
                const id = conn.connectionId;
                setConnected(true);
                setNotice('');
                setConnectionId(id);
                return callBackend('/api/org/quick/chat/subscribe', {
                    entity_type: 'chat.inbox', entity_id: uid, connection_id: id,
                }).catch(() => { if (active) setNotice('Live inbox connection unavailable.'); });
            }).catch(() => { if (active) setNotice('Connecting to live messaging…'); });
        };
        connect();
        return () => {
            active = false;
            if (retry) clearTimeout(retry);
            const id = current?.connectionId;
            if (id) {
                void callBackend('/api/org/quick/chat/unsubscribe', {
                    entity_type: 'chat.inbox', entity_id: uid, connection_id: id,
                }).catch(() => undefined);
            }
            current?.disconnect();
            connectionRef.current = null;
        };
    }, [uid]);

    // Chat room subscriptions change with the visible thread while the WebSocket stays up.
    useEffect(() => {
        if (!connectionId || !roomId) return;
        let subscribed = false;
        let released = false;
        void callBackend('/api/org/quick/chat/subscribe', {
            entity_type: 'chat.room', entity_id: roomId, connection_id: connectionId,
        }).then(() => {
            subscribed = true;
            if (released) {
                void callBackend('/api/org/quick/chat/unsubscribe', {
                    entity_type: 'chat.room', entity_id: roomId, connection_id: connectionId,
                }).catch(() => undefined);
            }
        }).catch(() => { if (!released) setNotice('Unable to subscribe to this conversation.'); });
        return () => {
            released = true;
            if (subscribed) {
                void callBackend('/api/org/quick/chat/unsubscribe', {
                    entity_type: 'chat.room', entity_id: roomId, connection_id: connectionId,
                }).catch(() => undefined);
            }
        };
    }, [connectionId, roomId]);

    // Revalidate long-running subscriptions without polling message data.
    useEffect(() => {
        if (!connectionId) return;
        const timer = setInterval(() => {
            void callBackend('/api/org/quick/chat/subscribe', {
                entity_type: 'chat.inbox', entity_id: uid, connection_id: connectionId,
            }).catch(() => undefined);
            const room = roomRef.current;
            if (room) {
                void callBackend('/api/org/quick/chat/subscribe', {
                    entity_type: 'chat.room', entity_id: room, connection_id: connectionId,
                }).catch(() => undefined);
            }
        }, 45 * 60_000);
        return () => clearInterval(timer);
    }, [connectionId, uid]);

    return { connected, notice };
}
