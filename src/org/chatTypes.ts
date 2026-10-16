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
    unread?: boolean;
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
    serverTime: string;
}
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
