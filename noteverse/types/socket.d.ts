/**
 * Shared Socket.io Type Definitions
 * 
 * This file contains all type definitions used by Socket.io server and client
 * for real-time collaboration features.
 */

export interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
}

export interface SocketData {
  documentId?: string;
  user?: User;
}

export interface JoinDocumentData {
  documentId: string;
  user: User;
}

export interface SyncUpdateData {
  documentId: string;
  update: string;
}

export interface CursorUpdateData {
  documentId: string;
  position: number;
  selection?: {
    from: number;
    to: number;
  };
}

export interface TypingData {
  documentId: string;
}

export interface LeaveDocumentData {
  documentId: string;
}

export interface CursorInfo {
  position: number;
  selection?: {
    from: number;
    to: number;
  };
  user: User;
}

export interface UserInfo {
  socketId: string;
  user: User;
}

export interface ServerToClientEvents {
  'document-state': (data: { state: string; users: UserInfo[] }) => void;
  'user-joined': (data: { user: User; socketId: string; users: UserInfo[] }) => void;
  'user-left': (data: { socketId: string; user?: User; users: UserInfo[] }) => void;
  'sync-update': (data: { update: string; origin?: User }) => void;
  'cursor-update': (data: { 
    socketId: string; 
    user: User; 
    position: number; 
    selection?: { from: number; to: number } 
  }) => void;
  'user-typing': (data: { socketId: string; user: User; isTyping: boolean }) => void;
}

export interface ClientToServerEvents {
  'join-document': (data: JoinDocumentData) => void;
  'leave-document': (data: LeaveDocumentData) => void;
  'sync-update': (data: SyncUpdateData) => void;
  'cursor-update': (data: CursorUpdateData) => void;
  'typing-start': (data: TypingData) => void;
  'typing-stop': (data: TypingData) => void;
}
