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
import type { ActiveCall, CallType } from '../components/Call/CallModal';
import type { IncomingCall } from '../components/Call/IncomingCallPrompt';
import type { Conversation, User } from '../types/chat';
import type { TypedSocket } from '../types/socket';
import { api } from '../api/httpClient';

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
  activeConversation: Conversation | null;
  conversationList: Conversation[];
  groupsList: Conversation[];
  selectedUser: User | null;
}

export function useCallManager({
  socket,
  activeConversation,
  conversationList,
  groupsList,
  selectedUser
}: UseCallManagerOptions) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('callHistory') || '[]');
    } catch {
      return [];
    }
  });

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

  const getCallTitle = (conversationId: string, fallback?: string | null) => {
    const conversation = activeConversationRef.current?.id === conversationId
      ? activeConversationRef.current
      : conversationListRef.current.find((item) => item.id === conversationId) || groupsListRef.current.find((item) => item.id === conversationId);

    if (conversation?.isGroup) return conversation.name || fallback || 'Grup görüşmesi';
    return conversation?.otherUser?.username || selectedUserRef.current?.username || fallback || 'Görüşme';
  };

  const rememberCall = (entry: CallHistoryItem) => {
    setCallHistory((previous) => {
      const next = [entry, ...previous.filter((item) => item.callId !== entry.callId)].slice(0, 50);
      localStorage.setItem('callHistory', JSON.stringify(next));
      return next;
    });
  };

  const updateCallStatus = (callId: string, status: CallHistoryItem['status']) => {
    setCallHistory((previous) => {
      const next = previous.map((item) => item.callId === callId ? { ...item, status } : item);
      localStorage.setItem('callHistory', JSON.stringify(next));
      return next;
    });
  };

  const createCallConnection = async (conversationId: string, callId: string, callType: CallType): Promise<ActiveCall> => {
    const response = await api.post('/calls/token', { conversationId, callId, callType });
    return response.data;
  };

  const emitCallSignal = (eventName: 'call:invite' | 'call:accepted' | 'call:declined' | 'call:ended', call: {
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
      emitCallSignal('call:invite', nextCall);
    } catch {
      alert('Görüşme başlatılamadı. LiveKit ayarlarını kontrol edin.');
    }
  };

  const startCallWithUser = async (targetUser: User, callType: CallType) => {
    try {
      const res = await api.post('/conversations/direct', { targetUserId: targetUser.id });
      const conversation = res.data;
      const callId = crypto.randomUUID();
      const nextCall = await createCallConnection(conversation.id, callId, callType);
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
      emitCallSignal('call:invite', nextCall);
    } catch {
      alert('Arama başlatılamadı. LiveKit ayarlarını kontrol edin.');
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;
    try {
      const nextCall = await createCallConnection(incomingCall.conversationId, incomingCall.callId, incomingCall.callType);
      emitCallSignal('call:accepted', incomingCall);
      updateCallStatus(incomingCall.callId, 'accepted');
      setIncomingCall(null);
      setActiveCall(nextCall);
    } catch {
      alert('Görüşmeye bağlanılamadı.');
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
    setActiveCall,
    startConversationCall,
    startCallWithUser,
    acceptIncomingCall,
    declineIncomingCall,
    closeActiveCall
  };
}
