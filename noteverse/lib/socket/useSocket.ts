/**
 * Socket.io Client Hook
 * 
 * React hook for managing WebSocket connection
 * Handles connection lifecycle and provides socket instance
 */

'use client';

import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseSocketOptions {
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionDelay?: number;
  reconnectionAttempts?: number;
}

export function useSocket(options: UseSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Get Socket.io server URL from environment variable
    // CRITICAL: Use environment variable, NOT localhost or window.location
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
    
    console.log('🔌 Connecting to Socket.io server:', socketUrl);

    // Initialize socket connection
    const socketInstance = io(socketUrl, {
      path: '/socket.io/', // Explicitly set the default path
      transports: ['websocket'], // Stick to websocket
      upgrade: false, // Don't try to upgrade from polling if we are forcing websocket
      secure: true,
      autoConnect: options.autoConnect !== false,
      reconnection: options.reconnection !== false,
      reconnectionDelay: options.reconnectionDelay || 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: options.reconnectionAttempts || Infinity,
      timeout: 20000,
      forceNew: false,
      // Production settings
      withCredentials: true,
      extraHeaders: {
        'Access-Control-Allow-Origin': '*'
      }
    });

    socketRef.current = socketInstance;
    
    // Set socket in next tick/callback to avoid synchronous setState warning
    setTimeout(() => {
      console.log('🔄 Setting socket state for useSocket hook');
      setSocket(socketInstance);
    }, 0);

    // Connection event handlers
    socketInstance.on('connect', () => {
      console.log('✅ Socket connected successfully!');
      console.log('   Socket ID:', socketInstance.id);
      console.log('   Transport:', socketInstance.io.engine.transport.name);
      setIsConnected(true);
      setIsConnecting(false);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      setIsConnected(false);
      
      // Auto-reconnect on unexpected disconnections
      if (reason === 'io server disconnect') {
        // Server forcefully disconnected, need manual reconnection
        console.log('🔄 Manual reconnection required');
        socketInstance.connect();
      }
    });

    socketInstance.on('connect_error', (error) => {
      console.error('❌ Socket connection error summary:', error.message);
      console.error('❌ Full Error Object:', error);
      console.error('   Error Type/Name:', error.name);
      if ((error as any).description) console.error('   Description:', (error as any).description);
      if ((error as any).context) console.error('   Context:', (error as any).context);
      
      console.error('   Attempted Server URL:', socketUrl);
      setIsConnecting(false);
      setIsConnected(false);
    });

    socketInstance.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Socket reconnecting... (attempt ${attemptNumber})`);
      setIsConnecting(true);
    });

    socketInstance.on('reconnect', (attemptNumber) => {
      console.log(`✅ Socket reconnected after ${attemptNumber} attempts`);
      setIsConnected(true);
      setIsConnecting(false);
    });

    socketInstance.on('reconnect_failed', () => {
      console.error('❌ Socket reconnection failed');
      setIsConnecting(false);
    });

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        console.log('🔌 Disconnecting socket on cleanup');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [options.autoConnect, options.reconnection, options.reconnectionDelay, options.reconnectionAttempts]); // Added missing dependencies

  return { socket, isConnected, isConnecting };
}
