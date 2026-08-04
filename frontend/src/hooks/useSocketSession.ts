/**
 * ============================================================================
 * SOKET OTURUMU VE VARLIK YÖNETİMİ HOOK'U (useSocketSession)
 * ============================================================================
 * 
 * Bu hook; Socket.IO istemci bağlantısının kurulmasını, JWT token yenilemelerini,
 * inaktivite zaman aşımı takibini ve çevrimiçi varlık (online/offline) listesini yönetir.
 */

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_ORIGIN } from '../config/runtime';
import type { TypedSocket } from '../types/socket';
import { getAccessToken, subscribeAccessToken } from '../auth/tokenStore';

const SOCKET_INACTIVITY_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const SOCKET_ACTIVITY_PING_INTERVAL_MS = 60 * 1000;

interface UseSocketSessionOptions {
  currentView: 'login' | 'register' | 'chat';
  onAuthExpired: () => void;
}

export function useSocketSession({ currentView, onAuthExpired }: UseSocketSessionOptions) {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  const [socketConnectionStatus, setSocketConnectionStatus] = useState<
    'connected' | 'inactive' | 'reconnecting' | 'disconnected'
  >('connected');
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  const isSocketActiveRef = useRef(true);
  const socketInactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSocketActivityPingRef = useRef(0);
  const lastUserActivityAtRef = useRef(Date.now());
  const onlineUserIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onlineUserIdsRef.current = onlineUserIds;
  }, [onlineUserIds]);

  const scheduleSocketInactivityTimer = (targetSocket: TypedSocket) => {
    if (socketInactivityTimerRef.current) clearTimeout(socketInactivityTimerRef.current);
    socketInactivityTimerRef.current = setTimeout(() => {
      isSocketActiveRef.current = false;
      setSocketConnectionStatus('inactive');
      targetSocket.disconnect();
    }, SOCKET_INACTIVITY_TIMEOUT_MS);
  };

  const emitSocketActivityPing = (targetSocket: TypedSocket | null) => {
    if (!targetSocket || !targetSocket.connected || !isSocketActiveRef.current) return;
    const now = Date.now();
    if (now - lastSocketActivityPingRef.current < SOCKET_ACTIVITY_PING_INTERVAL_MS) return;
    lastSocketActivityPingRef.current = now;
    targetSocket.emit('client_activity');
  };

  // Socket.IO Bağlantı Kurulumu ve Olay Dinleyicileri
  useEffect(() => {
    if (currentView !== 'chat') {
      if (socketInactivityTimerRef.current) clearTimeout(socketInactivityTimerRef.current);
      setSocket((previous) => {
        previous?.disconnect();
        return null;
      });
      return;
    }

    const token = getAccessToken();
    if (!token) return;

    isSocketActiveRef.current = true;
    const newSocket: TypedSocket = io(API_ORIGIN, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    scheduleSocketInactivityTimer(newSocket);

    newSocket.on('connect', () => {
      setSocketConnectionStatus('connected');
      emitSocketActivityPing(newSocket);
    });

    newSocket.on('disconnect', (reason) => {
      if (!isSocketActiveRef.current || reason === 'io client disconnect') {
        setSocketConnectionStatus('inactive');
        return;
      }
      setSocketConnectionStatus('disconnected');
    });

    newSocket.on('connect_error', () => {
      if (isSocketActiveRef.current) setSocketConnectionStatus('reconnecting');
    });

    newSocket.on('auth:expired', () => {
      onAuthExpired();
    });

    newSocket.on('presence_snapshot', (payload) => {
      if (payload && Array.isArray(payload.onlineUserIds)) {
        const set = new Set(payload.onlineUserIds);
        setOnlineUserIds(set);
      }
    });

    newSocket.on('presence_changed', (payload) => {
      if (!payload || !payload.userId) return;
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (payload.isOnline) next.add(payload.userId);
        else next.delete(payload.userId);
        return next;
      });
    });

    setSocket(newSocket);

    const unsubscribeToken = subscribeAccessToken((newToken) => {
      if (!isSocketActiveRef.current) return;
      if (newToken) {
        newSocket.auth = { token: newToken };
        if (newSocket.connected) {
          emitSocketActivityPing(newSocket);
        } else {
          newSocket.connect();
        }
      }
    });

    const handleUserActivity = () => {
      lastUserActivityAtRef.current = Date.now();
      if (!isSocketActiveRef.current) {
        isSocketActiveRef.current = true;
        setSocketConnectionStatus(newSocket.connected ? 'connected' : 'reconnecting');
        scheduleSocketInactivityTimer(newSocket);
        if (newSocket.disconnected) newSocket.connect();
        else emitSocketActivityPing(newSocket);
        return;
      }
      scheduleSocketInactivityTimer(newSocket);
      emitSocketActivityPing(newSocket);
    };

    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('click', handleUserActivity);
    window.addEventListener('touchstart', handleUserActivity);

    return () => {
      if (socketInactivityTimerRef.current) clearTimeout(socketInactivityTimerRef.current);
      unsubscribeToken();
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      newSocket.disconnect();
    };
  }, [currentView]);

  return {
    socket,
    socketConnectionStatus,
    onlineUserIds,
    onlineUserIdsRef
  };
}
