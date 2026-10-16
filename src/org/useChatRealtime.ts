/**
 * Independent migration bridge for chat refresh.
 * AppDeploy WebSocket IDs cannot be moved to Cloud Run. This explicitly
 * refreshes the authenticated chat views every 12 seconds instead of
 * falsely claiming WebSocket support. Replace with a tenant-aware
 * Pub/Sub+SSE/WebSocket broker before commercial production.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChatLiveEvent } from './chatTypes';
interface LiveHandlers {
    inbox: () => void;
    room: (message: ChatLiveEvent) => void;
}
interface ChatLiveState { connected: boolean; notice: string }
export function useChatRealtime(_uid: string, roomId: string, handlers: LiveHandlers): ChatLiveState {
    const latest = useRef(handlers);
    latest.current = handlers;
    const activeRoom = useRef(roomId);
    activeRoom.current = roomId;
    const [connected, setConnected] = useState(false);
    useEffect(() => {
        const cycle = () => {
            if (document.visibilityState === 'hidden') return;
            latest.current.inbox();
            if (activeRoom.current) latest.current.room({
                type: 'entity.update', entity_type: 'chat.room', entity_id: activeRoom.current,
                at: new Date().toISOString(),
            } as ChatLiveEvent);
        };
        const id = setInterval(cycle, 12000);
        setConnected(false);
        return () => clearInterval(id);
    }, []);
    return { connected, notice: 'Chat refreshes every 12 seconds until independent live messaging is configured.' };
}
