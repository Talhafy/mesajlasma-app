/**
 * ============================================================================
 * SESLİ / GÖRÜNTÜLÜ ARAMA YÖNETİMİ HOOK'U (useCallManager)
 * ============================================================================
 * 
 * Bu hook; WebRTC (LiveKit) sesli ve görüntülü aramalarını, gelen çağrı
 * istemlerini (`incomingCall`), aktif görüşme durumunu (`activeCall`), soket
 * sinyalleşmelerini (`call:*`) ve arama geçmişini yönetir.
 */

import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import type { ActiveCall, CallType } from '../components/Call/CallModal';
import type { IncomingCall } from '../components/Call/IncomingCallPrompt';
import type { Conversation, User } from '../types/chat';
import type { TypedSocket } from '../types/socket';
import { api } from '../api/httpClient';
import { getActiveConversationCallMediaKey } from '../crypto/mlsClient';

export interface CallHistoryItem {
  callId: string;
  conversationId: string;
  title: string;
  callType: CallType;
  direction: 'incoming' | 'outgoing';
  status: 'started' | 'accepted' | 'declined' | 'missed' | 'ended';
  createdAt: string;
}

interface UseCallManagerOptions {
  socket: TypedSocket | null;
  currentUserId: string | null;
  activeConversation: Conversation | null;
  conversationList: Conversation[];
  groupsList: Conversation[];
  selectedUser: User | null;
}

export function useCallManager({
  socket,
  currentUserId,
  activeConversation,
  conversationList,
  groupsList,
  selectedUser
}: UseCallManagerOptions) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);

  const activeCallRef = useRef<ActiveCall | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const activeConversationRef = useRef<Conversation | null>(null);
  const conversationListRef = useRef<Conversation[]>([]);
  const groupsListRef = useRef<Conversation[]>([]);
  const selectedUserRef = useRef<User | null>(null);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);
  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);
  useEffect(() => { conversationListRef.current = conversationList; }, [conversationList]);
  useEffect(() => { groupsListRef.current = groupsList; }, [groupsList]);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);

  const callHistoryStorageKey = currentUserId ? `callHistory:${currentUserId}` : null;

  const resetCallSession = () => {
    activeCallRef.current = null;
    incomingCallRef.current = null;
    setActiveCall(null);
    setIncomingCall(null);
    setCallHistory([]);
  };

  useEffect(() => {
    localStorage.removeItem('callHistory');
    resetCallSession();
    if (!callHistoryStorageKey) return;
    try {
      const storedHistory = JSON.parse(localStorage.getItem(callHistoryStorageKey) || '[]');
      setCallHistory(Array.isArray(storedHistory) ? storedHistory : []);
    } catch {
      setCallHistory([]);
    }
  }, [callHistoryStorageKey]);

  const getCallTitle = (conversationId: string, fallback?: string | null) => {
    const conversation = activeConversationRef.current?.id === conversationId
      ? activeConversationRef.current
      : conversationListRef.current.find((item) => item.id === conversationId) || groupsListRef.current.find((item) => item.id === conversationId);

    if (conversation?.isGroup) return conversation.name || fallback || 'Grup görüşmesi';
    return conversation?.otherUser?.username || selectedUserRef.current?.username || fallback || 'Görüşme';
  };

  const rememberCall = (entry: CallHistoryItem) => {
    if (!callHistoryStorageKey) return;
    setCallHistory((previous) => {
      const next = [entry, ...previous.filter((item) => item.callId !== entry.callId)].slice(0, 50);
      localStorage.setItem(callHistoryStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const updateCallStatus = (callId: string, status: CallHistoryItem['status']) => {
    if (!callHistoryStorageKey) return;
    setCallHistory((previous) => {
      const next = previous.map((item) => item.callId === callId ? { ...item, status } : item);
      localStorage.setItem(callHistoryStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const createCallConnection = async (
    conversationId: string, callId: string, callType: CallType, expectedEpoch?: number
  ): Promise<ActiveCall> => {
    if (!currentUserId || !socket?.connected) throw new Error('Arama için bağlantının yeniden kurulmasını bekleyin.');
    const { data } = await api.post<Omit<ActiveCall, 'mlsEpoch' | 'e2eeKeyBase64'> & { participantIds: string[] }>(
      '/calls/token', { conversationId, callId, callType }
    );
    const { participantIds, ...room } = data;
    const serverUrl = new URL(room.serverUrl);
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(serverUrl.hostname);
    if (isLoopback && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
      throw new Error('Görüşme sunucusunun adresi bu cihazdan erişilemiyor.');
    }

    const mediaKey = await getActiveConversationCallMediaKey(
      currentUserId, conversationId, callId, participantIds, expectedEpoch
    ).catch(() => null);
    if (!mediaKey) throw new Error(expectedEpoch === undefined
      ? 'Görüşme anahtarı hazırlanamadı. Sohbeti açıp cihaz eşitlemesini kontrol edin.'
      : 'Görüşme anahtarı eşleşmedi. Aramanın yeniden başlatılması gerekiyor.');
    return { ...room, e2eeKeyBase64: mediaKey.e2eeKeyBase64, mlsEpoch: mediaKey.epoch };
  };

  const inviteToCall = async ({ conversationId, callId, callType, mlsEpoch }: ActiveCall) => {
    const result = await socket?.timeout(5000).emitWithAck('call:invite', { conversationId, callId, callType, mlsEpoch })
      .catch(() => null);
    if (!result?.ok) throw new Error(result?.error || 'Arama daveti iletilemedi. Bağlantınızı kontrol edin.');
  };

  const showCallError = (error: unknown) => {
    let message = 'Görüşme bağlantısı hazırlanamadı.';
    if (isAxiosError(error)) message = error.response?.data?.error || message;
    else if (error instanceof Error) message = error.message;
    alert(message);
  };

  const emitCallSignal = (eventName: 'call:accepted' | 'call:declined' | 'call:ended', call: {
    conversationId: string;
    callId: string;
    callType: CallType;
  }) => {
    socket?.emit(eventName, {
      conversationId: call.conversationId,
      callId: call.callId,
      callType: call.callType
    });
  };

  // Soket Arama Dinleyicileri
  useEffect(() => {
    if (!socket) return;

    const handleIncomingCall = (call: IncomingCall) => {
      if (activeCallRef.current || incomingCallRef.current) {
        emitCallSignal('call:declined', call);
        return;
      }
      const title = getCallTitle(call.conversationId, call.conversationName);
      rememberCall({
        callId: call.callId,
        conversationId: call.conversationId,
        title,
        callType: call.callType,
        direction: 'incoming',
        status: 'started',
        createdAt: new Date().toISOString()
      });
      setIncomingCall({ ...call, conversationName: title });
    };

    const handleCallAccepted = (payload: { callId: string }) => {
      if (activeCallRef.current?.callId === payload.callId) {
        updateCallStatus(payload.callId, 'accepted');
      }
    };

    const handleCallDeclined = (payload: { callId: string }) => {
      if (incomingCallRef.current?.callId === payload.callId) {
        updateCallStatus(payload.callId, 'declined');
        setIncomingCall(null);
      }
      if (activeCallRef.current?.callId === payload.callId) {
        updateCallStatus(payload.callId, 'declined');
        setActiveCall(null);
      }
    };

    const handleCallEnded = (payload: { callId: string }) => {
      if (incomingCallRef.current?.callId === payload.callId) {
        updateCallStatus(payload.callId, 'missed');
        setIncomingCall(null);
      }
      if (activeCallRef.current?.callId === payload.callId) {
        updateCallStatus(payload.callId, 'ended');
        setActiveCall(null);
      }
    };

    socket.on('call:incoming', handleIncomingCall);
    socket.on('call:accepted', handleCallAccepted);
    socket.on('call:declined', handleCallDeclined);
    socket.on('call:ended', handleCallEnded);

    return () => {
      socket.off('call:incoming', handleIncomingCall);
      socket.off('call:accepted', handleCallAccepted);
      socket.off('call:declined', handleCallDeclined);
      socket.off('call:ended', handleCallEnded);
    };
  }, [socket]);

  const startConversationCall = async (callType: CallType) => {
    if (!activeConversation?.id) return;
    const callId = crypto.randomUUID();

    try {
      const nextCall = await createCallConnection(activeConversation.id, callId, callType);
      await inviteToCall(nextCall);
      rememberCall({
        callId,
        conversationId: activeConversation.id,
        title: getCallTitle(activeConversation.id, activeConversation.name),
        callType,
        direction: 'outgoing',
        status: 'started',
        createdAt: new Date().toISOString()
      });
      setActiveCall(nextCall);
    } catch (error) {
      showCallError(error);
    }
  };

  const startCallWithUser = async (targetUser: User, callType: CallType) => {
    try {
      const res = await api.post('/conversations/direct', { targetUserId: targetUser.id });
      const conversation = res.data;
      const callId = crypto.randomUUID();
      const nextCall = await createCallConnection(conversation.id, callId, callType);
      await inviteToCall(nextCall);
      rememberCall({
        callId,
        conversationId: conversation.id,
        title: targetUser.username,
        callType,
        direction: 'outgoing',
        status: 'started',
        createdAt: new Date().toISOString()
      });
      setActiveCall(nextCall);
    } catch (error) {
      showCallError(error);
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;
    try {
      const nextCall = await createCallConnection(
        incomingCall.conversationId, incomingCall.callId, incomingCall.callType, incomingCall.mlsEpoch
      );
      if (incomingCallRef.current?.callId !== incomingCall.callId) return;
      emitCallSignal('call:accepted', incomingCall);
      updateCallStatus(incomingCall.callId, 'accepted');
      setIncomingCall(null);
      setActiveCall(nextCall);
    } catch (error) {
      showCallError(error);
    }
  };

  const declineIncomingCall = () => {
    if (incomingCall) emitCallSignal('call:declined', incomingCall);
    if (incomingCall) updateCallStatus(incomingCall.callId, 'declined');
    setIncomingCall(null);
  };

  const closeActiveCall = () => {
    if (activeCallRef.current) emitCallSignal('call:ended', activeCallRef.current);
    if (activeCallRef.current) updateCallStatus(activeCallRef.current.callId, 'ended');
    setActiveCall(null);
  };

  return {
    activeCall,
    incomingCall,
    callHistory,
    resetCallSession,
    setActiveCall,
    startConversationCall,
    startCallWithUser,
    acceptIncomingCall,
    declineIncomingCall,
    closeActiveCall
  };
}
