export interface User {
    id: number;
    username: string;
    password_hash: string;
    friend_code: string;
    is_admin: number;
    created_at: string;
    last_login?: string;
}
export interface Friendship {
    id: number;
    user_id: number;
    friend_id: number;
    status: 'pending' | 'accepted' | 'blocked';
    created_at: string;
}
export interface Message {
    id: number;
    sender_id: number;
    recipient_id: number;
    message_text?: string;
    message_type: 'text' | 'file' | 'folder';
    created_at: string;
}
export interface FileRecord {
    id: number;
    filename: string;
    original_filename: string;
    file_path: string;
    file_size: number;
    file_type?: string;
    sender_id: number;
    recipient_id: number;
    message_id?: number;
    uploaded_at: string;
    downloaded_at?: string;
}
export interface Session {
    id: number;
    user_id: number;
    token_hash: string;
    expires_at: string;
    created_at: string;
}
export interface CreateUserRequest {
    username: string;
    password: string;
}
export interface LoginRequest {
    username: string;
    password: string;
}
export interface AddFriendRequest {
    friendCode: string;
}
export interface SendMessageRequest {
    recipientId: number;
    message: string;
    messageType?: 'text' | 'file' | 'folder';
}
export interface AuthResponse {
    success: boolean;
    message: string;
    user?: {
        id: number;
        username: string;
        friendCode: string;
        isAdmin: boolean;
    };
    token?: string;
}
//# sourceMappingURL=types.d.ts.map