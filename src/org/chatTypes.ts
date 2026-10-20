export interface ChatPerson {
    uid: string;
    name: string;
    photoUrl: string;
    email?: string;
    role?: string;
}
export interface ChatRoom {
    id: string;
    kind: 'direct' | 'group';
    title: string;
    description?: string;
    members: string[];
    pendingInvites?: string[];
    admins: string[];
    createdBy: string;
    lastMessage: string;
    lastSenderUid: string;
    lastMessageAt?: string;
    lastMessageKind?: string;
    unread?: boolean;
    unreadCount?: number;
    /** Inbox: state of my last message (sent / delivered / read by everyone). */
    lastStatus?: 'sent' | 'delivered' | 'read';
    muted?: boolean;
    pinned?: boolean;
    workGroupId?: string;
    /** Group: who may send messages / edit the group name and description. */
    sendPolicy?: 'all' | 'admins';
    infoPolicy?: 'all' | 'admins';
    updatedAt: string;
    createdAt: string;
}
export interface ChatAttachment {
    id: string;
    name: string;
    mime: string;
    size: number;
    kind: 'image' | 'file';
    url: string;
}
export interface ChatMessage {
    id: string;
    roomId: string;
    senderUid: string;
    text: string;
    createdAt: string;
    eventKind?: 'action' | 'poll';
    referenceId?: string;
    deletedForAll: boolean;
    deletedAt: string;
    attachment: ChatAttachment | null;
    replyTo: { id: string; senderUid: string; text: string; attachment: string; imageUrl?: string } | null;
    reactions: Record<string, string[]>;
    /** Browser only: optimistic message still being sent, or a send that failed. */
    pending?: boolean;
    failed?: boolean;
}
export interface ChatRoomPayload {
    room: ChatRoom;
    people: ChatPerson[];
    messages: ChatMessage[];
    hasMore: boolean;
    before: string;
    typing: Array<{ uid: string; until: string }>;
    presence: Array<{ uid: string; until: string }>;
    readMarks: Array<{ uid: string; readAt: string }>;
    deliveryMarks?: Array<{ uid: string; at: string }>;
    online?: Array<{ uid: string; online: boolean; lastSeen: string }>;
    serverTime: string;
}
/** Live state of the open room returned by the long-poll. */
export interface ChatLiveState {
    typing: Array<{ uid: string; until: string }>;
    presence: Array<{ uid: string; until: string }>;
    readMarks: Array<{ uid: string; readAt: string }>;
    deliveryMarks: Array<{ uid: string; at: string }>;
    online: Array<{ uid: string; online: boolean; lastSeen: string }>;
}
export interface ChatSettingsValue {
    muteAll: boolean;
    appearance: 'system' | 'light' | 'dark';
    wallpaper: string;
    fontSize: 'small' | 'medium' | 'large';
    enterToSend: boolean;
    readReceipts: boolean;
    lastSeen: boolean;
    showPreviews: boolean;
    sound: boolean;
}
export const DEFAULT_CHAT_SETTINGS: ChatSettingsValue = {
    muteAll: false, appearance: 'system', wallpaper: 'default', fontSize: 'medium', enterToSend: false,
    readReceipts: true, lastSeen: true, showPreviews: true, sound: true,
};
export interface ChatMediaItem { messageId: string; kind: string; name: string; mime: string; size: number; url: string; createdAt: string; senderUid: string }
/** @deprecated Older periodic-refresh event shape; live updates now come from the long-poll. */
export interface ChatLiveEvent {
    type: 'entity.update';
    entity_type: 'chat.inbox' | 'chat.room';
    entity_id: string;
    event?: 'typing' | 'presence' | 'read' | 'action' | 'poll';
    uid?: string;
    active?: boolean;
    until?: string;
}
export const REACTIONS = ['👍','❤️','😂','🎉','🙏','👏','✅','👀','🔥','😮','😢','💯'] as const;
export const EMOJI_PICKER = ['😀','😁','😂','😊','😍','👍','👏','❤️','🎉','🔥','🙏','✅','💯','👀','💪','😎','🙂','😉','😮','😢','📌','⚠️','🚀','👋'] as const;
export const MEMBER_PALETTE = [
    '#d97706', '#8b5cf6', '#059669', '#0284c7', '#be185d', '#ca8a04', '#db2777', '#0d9488',
] as const;
