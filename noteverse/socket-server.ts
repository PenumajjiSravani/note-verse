/**
 * Standalone Socket.io + Yjs Server
 * 
 * This server runs INDEPENDENTLY from the Next.js app.
 * Deploy this to Render, Railway, or any Node.js hosting service.
 * 
 * Deploy Instructions:
 * 1. Push this file to a separate Git repo or use the same repo
 * 2. Deploy to Render/Railway with start command: ts-node socket-server.ts
 * 3. Set environment variable: ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
 * 4. Update frontend with: NEXT_PUBLIC_SOCKET_URL=https://your-socket-server.com
 * 
 * Run locally: ts-node socket-server.ts
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as Y from 'yjs';

const PORT: number = parseInt(process.env.PORT || '3000', 10);

// CORS configuration - Allow your frontend domain
const ALLOWED_ORIGINS: string[] = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://note-verse-zeta.vercel.app',
      'https://noteverse.vercel.app'
    ];

console.log('🔒 CORS allowed origins:', ALLOWED_ORIGINS);

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

interface LeaveDocumentData {
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
  'leave-document': (data: LeaveDocumentData) => void;
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

// Create HTTP server
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Root endpoint
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('NoteVerse Socket.io Server - WebSocket only');
});

// Initialize Socket.io
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`⚠️ Blocked CORS request from: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  maxHttpBufferSize: 1e6,
  allowEIO3: true
});

console.log('✅ Socket.io server initialized');

// Yjs document storage (in-memory)
const documents = new Map<string, Y.Doc>();
const documentUsers = new Map<string, Set<string>>();
const cursorPositions = new Map<string, Map<string, CursorInfo>>();

// Socket.io event handlers
io.on('connection', (socket: CustomSocket) => {
  console.log(`🔌 Client connected: ${socket.id} from ${socket.handshake.address}`);

  // Join document room
  socket.on('join-document', async ({ documentId, user }: JoinDocumentData) => {
    console.log(`📄 User ${user.name} (${user.email}) joining document ${documentId}`);
    
    socket.join(documentId);
    socket.data.documentId = documentId;
    socket.data.user = user;

    // Initialize Yjs document if not exists
    if (!documents.has(documentId)) {
      documents.set(documentId, new Y.Doc());
      console.log(`📝 Created new Yjs document: ${documentId}`);
    }
    
    if (!documentUsers.has(documentId)) {
      documentUsers.set(documentId, new Set<string>());
    }
    documentUsers.get(documentId)!.add(socket.id);

    if (!cursorPositions.has(documentId)) {
      cursorPositions.set(documentId, new Map<string, CursorInfo>());
    }

    // Get current document state
    const ydoc = documents.get(documentId)!;
    const state = Y.encodeStateAsUpdate(ydoc);
    
    // Get all users in this document
    const sockets = await io.in(documentId).fetchSockets();
    const users: UserInfo[] = sockets
      .map(s => ({
        socketId: s.id,
        user: (s as CustomSocket).data.user!
      }))
      .filter(u => u.user);

    // Send state to joining user
    socket.emit('document-state', {
      state: Buffer.from(state).toString('base64'),
      users
    });

    // Notify others that user joined
    socket.to(documentId).emit('user-joined', { 
      user, 
      socketId: socket.id, 
      users 
    });

    console.log(`✅ User ${user.name} joined. Active users: ${users.length}`);
  });

  // Leave document room
  socket.on('leave-document', ({ documentId }: LeaveDocumentData) => {
    console.log(`👋 User leaving document ${documentId}`);
    socket.leave(documentId);
    
    const docUsers = documentUsers.get(documentId);
    if (docUsers) {
      docUsers.delete(socket.id);
    }
  });

  // Sync Yjs updates
  socket.on('sync-update', ({ documentId, update }: SyncUpdateData) => {
    const ydoc = documents.get(documentId);
    if (!ydoc) {
      console.warn(`⚠️ Document ${documentId} not found for sync-update`);
      return;
    }

    try {
      const updateBuffer = Buffer.from(update, 'base64');
      Y.applyUpdate(ydoc, updateBuffer);
      
      // Broadcast to all other users in the room
      socket.to(documentId).emit('sync-update', { 
        update, 
        origin: socket.data.user 
      });
    } catch (error) {
      console.error('❌ Error applying Yjs update:', error);
    }
  });

  // Cursor position updates
  socket.on('cursor-update', ({ documentId, position, selection }: CursorUpdateData) => {
    const user = socket.data.user;
    if (!user) return;

    const docCursors = cursorPositions.get(documentId);
    if (docCursors) {
      docCursors.set(socket.id, { position, selection, user });
    }

    // Broadcast cursor position to others
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

  // Chat messages
  socket.on('send-chat-message' as any, ({ documentId, message }: any) => {
    const user = socket.data.user;
    if (!user || !documentId) return;

    const chatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      senderId: user.id || 'anonymous',
      senderName: user.name || 'Anonymous',
      senderEmail: user.email || 'anonymous@example.com',
      message,
      timestamp: new Date().toISOString()
    };

    // Broadcast to everyone in the room INCLUDING the sender
    io.in(documentId).emit('receive-chat-message' as any, chatMessage);
    console.log(`💬 Chat: ${user.name} in ${documentId}: ${message.substring(0, 20)}...`);
  });

  // Handle disconnection
  socket.on('disconnect', async (reason: string) => {
    const documentId = socket.data.documentId;
    const user = socket.data.user;

    console.log(`🔌 Client disconnected: ${socket.id} (${reason})`);

    if (documentId) {
      const docUsers = documentUsers.get(documentId);
      if (docUsers) {
        docUsers.delete(socket.id);
        
        // Clean up empty documents after 1 minute
        if (docUsers.size === 0) {
          setTimeout(() => {
            const currentUsers = documentUsers.get(documentId);
            if (currentUsers && currentUsers.size === 0) {
              documents.delete(documentId);
              documentUsers.delete(documentId);
              cursorPositions.delete(documentId);
              console.log(`🗑️ Cleaned up empty document: ${documentId}`);
            }
          }, 60000);
        }
      }

      // Remove cursor
      const docCursors = cursorPositions.get(documentId);
      if (docCursors) {
        docCursors.delete(socket.id);
      }

      // Get remaining users
      const sockets = await io.in(documentId).fetchSockets();
      const users: UserInfo[] = sockets
        .map(s => ({
          socketId: s.id,
          user: (s as CustomSocket).data.user!
        }))
        .filter(u => u.user);
      
      // Notify others
      socket.to(documentId).emit('user-left', { 
        socketId: socket.id, 
        user, 
        users 
      });

      console.log(`👋 User ${user?.name || 'Unknown'} left. Remaining: ${users.length}`);
    }
  });

  // Handle errors
  socket.on('error', (error: Error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

// Handle server errors
io.engine.on('connection_error', (err: { code: string; message: string; context: any }) => {
  console.error('❌ Connection error:', {
    code: err.code,
    message: err.message,
    context: err.context
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🚀 NoteVerse Socket.io Server        ║
╠════════════════════════════════════════╣
║   📍 Port: ${PORT}                        
║   🔌 WebSocket: Ready                  ║
║   🌐 Environment: ${process.env.NODE_ENV || 'development'}       
║   🔒 CORS: Configured                  ║
╚════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📡 SIGTERM received, closing server gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n📡 SIGINT received, closing server gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
