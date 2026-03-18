/**
 * Custom Next.js Server with Socket.io
 * 
 * This server enables real-time collaboration by:
 * 1. Running Next.js app
 * 2. Initializing Socket.io for WebSocket connections
 * 3. Handling both HTTP and WebSocket traffic
 * 
 * Run with: ts-node server.ts
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as Y from 'yjs';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Type definitions
interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
}

interface SocketData {
  documentId?: string;
  user?: User;
}

interface JoinDocumentData {
  documentId: string;
  user: User;
}

interface SyncUpdateData {
  documentId: string;
  update: string;
}

interface CursorUpdateData {
  documentId: string;
  position: number;
  selection?: {
    from: number;
    to: number;
  };
}

interface TypingData {
  documentId: string;
}

interface CursorInfo {
  position: number;
  selection?: {
    from: number;
    to: number;
  };
  user: User;
}

interface UserInfo {
  socketId: string;
  user: User;
}

// Socket event type definitions
interface ServerToClientEvents {
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

interface ClientToServerEvents {
  'join-document': (data: JoinDocumentData) => void;
  'sync-update': (data: SyncUpdateData) => void;
  'cursor-update': (data: CursorUpdateData) => void;
  'typing-start': (data: TypingData) => void;
  'typing-stop': (data: TypingData) => void;
}

type CustomSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Yjs document storage
const documents = new Map<string, Y.Doc>();
const documentUsers = new Map<string, Set<string>>();
const cursorPositions = new Map<string, Map<string, CursorInfo>>();

app.prepare().then(() => {
  // Create HTTP server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = parse(req.url || '', true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('❌ Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize Socket.io
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(server, {
    cors: {
      origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
  });

  console.log('✅ Socket.io server initialized');

  // Socket.io event handlers
  io.on('connection', (socket: CustomSocket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Join document
    socket.on('join-document', async ({ documentId, user }: JoinDocumentData) => {
      console.log(`📄 User ${user.name} joining document ${documentId}`);
      
      socket.join(documentId);
      socket.data.documentId = documentId;
      socket.data.user = user;

      // Initialize document
      if (!documents.has(documentId)) {
        documents.set(documentId, new Y.Doc());
      }
      if (!documentUsers.has(documentId)) {
        documentUsers.set(documentId, new Set<string>());
      }
      documentUsers.get(documentId)!.add(socket.id);

      if (!cursorPositions.has(documentId)) {
        cursorPositions.set(documentId, new Map<string, CursorInfo>());
      }

      // Send state
      const ydoc = documents.get(documentId)!;
      const state = Y.encodeStateAsUpdate(ydoc);
      const sockets = await io.in(documentId).fetchSockets();
      const users: UserInfo[] = sockets
        .map(s => ({
          socketId: s.id,
          user: (s as CustomSocket).data.user!
        }))
        .filter(u => u.user);

      socket.emit('document-state', {
        state: Buffer.from(state).toString('base64'),
        users
      });

      socket.to(documentId).emit('user-joined', { user, socketId: socket.id, users });
    });

    // Sync updates
    socket.on('sync-update', ({ documentId, update }: SyncUpdateData) => {
      const ydoc = documents.get(documentId);
      if (!ydoc) return;

      try {
        const updateBuffer = Buffer.from(update, 'base64');
        Y.applyUpdate(ydoc, updateBuffer);
        socket.to(documentId).emit('sync-update', { update, origin: socket.data.user });
      } catch (error) {
        console.error('Error applying update:', error);
      }
    });

    // Cursor updates
    socket.on('cursor-update', ({ documentId, position, selection }: CursorUpdateData) => {
      const user = socket.data.user;
      if (!user) return;

      const docCursors = cursorPositions.get(documentId);
      if (docCursors) {
        docCursors.set(socket.id, { position, selection, user });
      }

      socket.to(documentId).emit('cursor-update', {
        socketId: socket.id,
        user,
        position,
        selection
      });
    });

    // Typing indicators
    socket.on('typing-start', ({ documentId }: TypingData) => {
      if (socket.data.user) {
        socket.to(documentId).emit('user-typing', {
          socketId: socket.id,
          user: socket.data.user,
          isTyping: true
        });
      }
    });

    socket.on('typing-stop', ({ documentId }: TypingData) => {
      if (socket.data.user) {
        socket.to(documentId).emit('user-typing', {
          socketId: socket.id,
          user: socket.data.user,
          isTyping: false
        });
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      const documentId = socket.data.documentId;
      const user = socket.data.user;

      if (documentId) {
        const docUsers = documentUsers.get(documentId);
        if (docUsers) {
          docUsers.delete(socket.id);
          if (docUsers.size === 0) {
            setTimeout(() => {
              if (documentUsers.get(documentId)?.size === 0) {
                documents.delete(documentId);
                documentUsers.delete(documentId);
                cursorPositions.delete(documentId);
              }
            }, 60000);
          }
        }

        const docCursors = cursorPositions.get(documentId);
        if (docCursors) {
          docCursors.delete(socket.id);
        }

        const sockets = await io.in(documentId).fetchSockets();
        const users: UserInfo[] = sockets
          .map(s => ({
            socketId: s.id,
            user: (s as CustomSocket).data.user!
          }))
          .filter(u => u.user);
        
        socket.to(documentId).emit('user-left', { socketId: socket.id, user, users });
      }
    });
  });

  // Start server
  server.listen(port, (err?: Error) => {
    if (err) throw err;
    console.log(`
    ╔════════════════════════════════════════╗
    ║   🚀 NoteVerse Server Running          ║
    ╠════════════════════════════════════════╣
    ║   📍 Local: http://${hostname}:${port}     ║
    ║   🔌 Socket.io: Ready                  ║
    ║   🌐 Environment: ${dev ? 'Development' : 'Production'}       ║
    ╚════════════════════════════════════════╝
    `);
  });
});
