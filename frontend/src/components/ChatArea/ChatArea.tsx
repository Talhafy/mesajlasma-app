/**
 * ============================================================================
 * ANA SOHBET ALANI BİLEŞENİ (ChatArea Component)
 * ============================================================================
 * 
 * Bu bileşen, mesajlaşma uygulamasının orta gövdesini oluşturan ana sohbet ekranıdır.
 * 
 * ANA MİMARİ VE YETENEKLER:
 * 1. Alt Bileşenler (Subcomponents Orchestration):
 *    - ChatHeader: Üst bar (Arama, arama butonları, sohbet menüsü).
 *    - MessageBubble: Çizelgedeki mesaj balonu render edicisi (Medya, ses oynatıcı, tikler).
 *    - ChatInput: Alt mesaj yazma, ses kaydı alma, emoji/dosya seçici.
 *    - ConversationInfoSidebar: Sağ detay paneli (Medya galerisi, bağlantılar ve yıldızlılar).
 *    - EmptyChatState: Sohbet seçilmediğinde karşılama ekranı.
 * 2. Akıllı Sayfalama (Infinite Scroll & Cursor Pagination):
 *    - Yukarı kaydırıldığında geçmiş mesajların yüklenmesi ve scroll pozisyonunun korunması.
 * 3. Gerçek Zamanlı Socket Olayları & Durumlar:
 *    - Yazıyor... / Ses kaydediyor... sinyalleri, ve okundu bilgisi.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { api } from '../../api/httpClient';
import type { User, Conversation, Message } from '../../types/chat';
import { isReadOnlyGroup } from '../../types/chat';
import './ChatArea.css';
import { useFileAttachment } from '../../hooks/useFileAttachment';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { useMessageInput } from '../../hooks/useMessageInput';
import {
  decryptIncomingMessage,
  decryptMessageList,
  messageDeliveryError,
  deliverMlsMessage,
  encryptOutgoingMessage
} from '../../crypto/mlsClient';
import { encryptAttachmentFile } from '../../crypto/fileCrypto';
import { getLocalConversationMedia, type EncryptedFileMetadata } from '../../crypto/vault';
import { useConfirm } from '../../context/useConfirm';
import {
  buildTimelineWithDateSeparators,
  formatDetailedDate,
  getMessagePreview,
  getUnixEpoch,
  isPendingMessageDecryption,
  type SystemTimelineEntry
} from './chatTimeline';

// SUBCOMPONENTS
import EmptyChatState from './components/EmptyChatState';
import ChatHeader from './components/ChatHeader';
import ConversationInfoSidebar from './components/ConversationInfoSidebar';
import MessageBubble from './components/MessageBubble';
import ChatInput from './components/ChatInput';

interface ChatAreaProps {
  currentUser: User;
  activeConversation: Conversation | null;
  selectedUser: User | null;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  newMessage: string;
  setNewMessage: (val: string) => void;
  mesajGonder: (replyToId?: string) => Promise<void>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  openGroupSettings: () => void;
  onDeleteConversationHistory: (conversationId: string) => void;
  onClearPersonalHistory: (conversationId: string) => void;
  messageFocus: { conversationId: string; messageId: string } | null;
  onFocusMessage: (messageId?: string) => void;
  hasNewer: boolean;
  onDeleteMessageForMe: (message: Message) => Promise<void>;
  closeChat: () => void;
  isDarkMode: boolean;
  usersList: User[];
  groupMembers: User[];
  loadMoreMessages: () => Promise<void>;
  hasMore: boolean;
  isLoadingMore: boolean;
  typingUsername: string | null;
  recordingUsername: string | null;
  onTyping: (isTyping: boolean) => void;
  onVoiceRecording: (isRecording: boolean) => void;
  onToggleConversationPin: (conversationId: string) => void;
  onToggleConversationArchive: (conversationId: string) => void;
  onToggleConversationMute: (conversationId: string) => void;
  onSetDisappearingMode: (conversationId: string, durationSeconds: number | null) => void;
  onStartCall: (callType: 'audio' | 'video') => void;
  socketConnectionStatus: 'connected' | 'inactive' | 'reconnecting' | 'disconnected';
  onStartDirectChat?: (targetUser: User) => void;
  onStartCallWithUser?: (targetUser: User, callType: 'audio' | 'video') => void;
}

type ConversationInfoTab = 'media' | 'links' | 'starred';

const formatSeconds = (totalSeconds: number) => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

export default function ChatArea({
  currentUser, activeConversation, selectedUser, messages, newMessage: newMessageProp,
  setMessages, setNewMessage: setNewMessageProp, mesajGonder, messagesEndRef, openGroupSettings, closeChat, isDarkMode,
  onDeleteConversationHistory, onDeleteMessageForMe, onClearPersonalHistory, messageFocus, onFocusMessage, hasNewer,
  usersList, groupMembers, loadMoreMessages, hasMore, isLoadingMore, typingUsername, recordingUsername, onTyping, onVoiceRecording,
  onToggleConversationPin, onToggleConversationArchive, onToggleConversationMute, onSetDisappearingMode,
  onStartCall, socketConnectionStatus, onStartDirectChat, onStartCallWithUser
}: ChatAreaProps) {
  const confirm = useConfirm();
  const sendInFlightRef = useRef(false);

  // ARAMA VE MENÜ DURUMLARI
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [messageSearchTerm, setMessageSearchTerm] = useState('');
  const [isConversationInfoOpen, setIsConversationInfoOpen] = useState(false);
  const [conversationInfoTab, setConversationInfoTab] = useState<ConversationInfoTab>('media');
  const [mediaPanelData, setMediaPanelData] = useState<{ mediaMessages: Message[]; linkItems: Array<{ messageId: string; url: string; createdAt?: string }> }>({ mediaMessages: [], linkItems: [] });
  const [conversationStarredMessages, setConversationStarredMessages] = useState<Message[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const [isDisappearingSettingsOpen, setIsDisappearingSettingsOpen] = useState(false);
  const [systemTimelineEntries, setSystemTimelineEntries] = useState<SystemTimelineEntry[]>([]);
  const [avatarProfileUser, setAvatarProfileUser] = useState<User | null>(null);

  // MESAJ İŞLEM DURUMLARI (BİLGİ, YANITLA, İLET)
  const [messageInfo, setMessageInfo] = useState<Message | null>(null);
  const [forwardMessages, setForwardMessages] = useState<Message[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteMenuOpen, setIsBulkDeleteMenuOpen] = useState(false);
  const [pinnedIndex, setPinnedIndex] = useState(0);
  const [messageHighlight, setMessageHighlight] = useState<{ id: string; sequence: number } | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  // ZAMANLAMA VE BEKLEYEN MESAJ DURUMLARI

  const [isBlockedLocally, setIsBlockedLocally] = useState(false);

  // UX ENHANCEMENTS: CHAT LOADING SKELETON & IMAGE LIGHTBOX
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  
  // OFFLINE MODE: GEÇİCİ MESAJ KUYRUĞU
  const [offlineQueue, setOfflineQueue] = useState<Message[]>([]);
  
  // CUSTOM HOOKS
  const {
    isRecordingAudio,
    isRecordingPaused,
    recordingDuration,
    startRecording,
    pauseResumeRecording,
    cancelRecording,
    sendRecording
  } = useVoiceRecorder();

  const {
    newMessage,
    setNewMessage,
    clearMessageInput,
    replyingTo,
    setReplyingTo
  } = useMessageInput({
    onTyping,
    conversationId: activeConversation?.id,
    newMessageProp,
    setNewMessageProp
  });

  // DOSYA YÜKLEME DURUMLARI
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const {
    fileAccept, fileInputRef, filePreview, selectedFile,
    cancelFile, handleFileUpload, handlePaste, openFilePicker, selectFile
  } = useFileAttachment();

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    dragCounterRef.current = 0;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      selectFile(file);
    }
  };

  useEffect(() => {
    if (activeConversation?.id) {
      setIsLoadingChat(true);
    } else {
      setIsLoadingChat(false);
    }
  }, [activeConversation?.id]);

  useEffect(() => {
    setIsLoadingChat(false);
  }, [messages]);

  // Çevrimdışı gönderilen mesajları otomatik yeniden deneme (Auto-retry on reconnect - N5: E2EE + sonsuz döngü koruması)
  useEffect(() => {
    if (socketConnectionStatus === 'connected' && offlineQueue.length > 0) {
      const retryQueue = async () => {
        const toSend = [...offlineQueue];
        setOfflineQueue([]); // Kuyruğu sıfırla ki mükerrer deneme olmasın
        
        for (const msg of toSend) {
          try {
            const mlsEnvelope = await encryptOutgoingMessage(
              currentUser.id,
              msg.conversationId,
              getActiveParticipantIds(),
              msg.content, undefined, { clientId: msg.id.replace('offline-', ''), delivery: { replyToId: msg.replyToId } }
            );
            if (!mlsEnvelope) {
              continue;
            }
            await deliverMlsMessage(currentUser.id, msg.conversationId, mlsEnvelope.clientId);
          } catch (err: any) {
            // Yalnızca ağ bağlantısı kopuksa (HTTP yanıtı yoksa) kuyruğa geri ekle; 4xx hatalarında sonsuz döngüye girme!
            if (!err?.response) {
              setOfflineQueue((prev) => [...prev, msg]);
            }
          }
        }
      };
      void retryQueue();
    }
  }, [socketConnectionStatus, offlineQueue, currentUser.id]);

  useEffect(() => {
    const partner = selectedUser || activeConversation?.otherUser;
    setIsBlockedLocally(!!partner?.isBlocked);
  }, [selectedUser, activeConversation]);

  const messagesListRef = useRef<HTMLDivElement>(null);
  const previousScrollHeight = useRef<number>(0);
  const previousDisappearingModeRef = useRef<number | null | undefined>(undefined);
  const previousConversationIdRef = useRef<string | null>(null);

  // TEMA RENKLERİ
  const panelBg = isDarkMode ? '#202c33' : '#f0f2f5';
  const isDisappearingMode = Boolean(activeConversation?.disappearingDurationSeconds);
  const baseChatBg = isDarkMode ? '#0b141a' : '#efeae2';
  const chatBg = isDisappearingMode ? (isDarkMode ? '#0f241f' : '#e5f5ee') : baseChatBg;
  const textColor = isDarkMode ? '#e9edef' : '#111b21';
  const iconColor = isDarkMode ? '#aebac1' : '#54656f';
  const borderColor = isDarkMode ? '#313d45' : '#d1d7db';
  const inputBg = isDarkMode ? '#2a3942' : '#ffffff';

  const uploadConfig = {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event: { loaded: number; total?: number }) => {
      setUploadProgress(event.total ? Math.round((event.loaded * 100) / event.total) : 0);
    }
  };

  const getActiveParticipantIds = useCallback((): string[] => {
    if (activeConversation?.isGroup) {
      const ids = groupMembers.filter((m) => m.isActive !== false).map((m) => m.id);
      return ids.length > 0 ? ids : [currentUser.id];
    }
    const partnerId = selectedUser?.id || activeConversation?.otherUser?.id;
    return [currentUser.id, partnerId].filter((id): id is string => Boolean(id));
  }, [activeConversation?.isGroup, activeConversation?.otherUser?.id, currentUser.id, groupMembers, selectedUser?.id]);


  // F5 GEREKTİRMEDEN ANLIK VERİ YENİLEME FONKSİYONU
  const isReadOnlyHistory = isReadOnlyGroup(activeConversation);
  const fetchSidebarData = useCallback(() => {
    if (!activeConversation?.id || !isConversationInfoOpen || isReadOnlyHistory) return;
    const convId = activeConversation.id;

    Promise.all([
      api.get(`/conversations/${convId}/media`).catch(() => ({ data: { mediaMessages: [], linkItems: [] } })),
      getLocalConversationMedia(currentUser.id, convId).catch(() => ({ mediaMessages: [], linkItems: [] }))
    ])
      .then(async ([serverRes, localData]) => {
        const serverMedia = await decryptMessageList(
          currentUser.id,
          (serverRes.data?.mediaMessages || []) as Message[]
        );
        const serverLinks: Array<{ messageId: string; url: string; createdAt?: string }> =
          serverRes.data?.linkItems || [];

        const seenLinkKeys = new Set(serverLinks.map((l) => `${l.messageId}:${l.url}`));
        const mergedLinks = [...serverLinks];
        for (const item of localData.linkItems) {
          const key = `${item.messageId}:${item.url}`;
          if (!seenLinkKeys.has(key)) {
            seenLinkKeys.add(key);
            mergedLinks.push(item);
          }
        }

        setMediaPanelData({
          mediaMessages: serverMedia.filter((message) => !isPendingMessageDecryption(message)),
          linkItems: mergedLinks
        });
      })
      .catch(() => setMediaPanelData({ mediaMessages: [], linkItems: [] }));


    api.get('/messages/starred')
      .then(async (response) => {
        const starredInConversation = (response.data as Message[]).filter((message) => message.conversationId === convId);
        const decryptedStarred = await decryptMessageList(currentUser.id, starredInConversation);
        setConversationStarredMessages(decryptedStarred.filter((message) => !isPendingMessageDecryption(message)));
      })
      .catch(() => setConversationStarredMessages([]));
  }, [activeConversation?.id, activeConversation?.historyClearedAt, isConversationInfoOpen, isReadOnlyHistory, currentUser.id]);


  useEffect(() => {
    if (activeConversation?.id) {
      setReplyingTo(null);
      setIsConversationInfoOpen(false);
      cancelFile();
    }
  }, [activeConversation?.id, cancelFile, setReplyingTo]);

  useEffect(() => {
    if (!isReadOnlyHistory) return;

    setIsSelectMode(false);
    setSelectedMessageIds(new Set());
    setIsBulkDeleteMenuOpen(false);
    setEditingMessage(null);
    setReplyingTo(null);
    setIsChatMenuOpen(false);
    setIsDisappearingSettingsOpen(false);
    setIsConversationInfoOpen(false);
  }, [
    isReadOnlyHistory,
    setReplyingTo
  ]);


  // Mesajlar her değiştiğinde (yeni mesaj geldiğinde) yan paneli otomatik güncelle
  useEffect(() => {
    fetchSidebarData();
  }, [fetchSidebarData, messages]);

  useEffect(() => {
    const conversationId = activeConversation?.id || null;
    const currentMode = activeConversation?.disappearingDurationSeconds ?? null;

    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId;
      previousDisappearingModeRef.current = currentMode;
      return;
    }

    if (previousDisappearingModeRef.current !== undefined && previousDisappearingModeRef.current !== currentMode) {
      const timestamp = new Date().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
      setSystemTimelineEntries((previous) => {
        if (!conversationId) return previous;
        return [
          ...previous,
          {
            id: crypto.randomUUID(),
            conversationId,
            text: currentMode ? `Kaybolan mesaj modu açıldı • ${timestamp}` : `Kaybolan mesaj modu kapatıldı • ${timestamp}`,
            createdAt: new Date().toISOString()
          }
        ];
      });
      previousDisappearingModeRef.current = currentMode;
      return;
    }

    previousDisappearingModeRef.current = currentMode;
  }, [activeConversation?.id, activeConversation?.disappearingDurationSeconds]);

  useEffect(() => {
    if (isLoadingMore && messagesListRef.current) {
      const newScrollHeight = messagesListRef.current.scrollHeight;
      messagesListRef.current.scrollTop = newScrollHeight - previousScrollHeight.current;
    }
  }, [messages, isLoadingMore]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.currentTarget.scrollTop === 0 && hasMore && !isLoadingMore) {
      previousScrollHeight.current = e.currentTarget.scrollHeight;
      loadMoreMessages();
    }
  };

  const performSend = async () => {
    if (!newMessage.trim() && !selectedFile) return;
    onTyping(false);

    // OFFLINE OUTBOX QUEUE TRIGGER
    if (socketConnectionStatus !== 'connected') {
      if (selectedFile) {
        alert("İnternet bağlantısı yokken dosya gönderilemez.");
        return;
      }
      const tempMessage: Message = {
        id: `offline-${crypto.randomUUID()}`,
        conversationId: activeConversation?.id || '',
        senderId: currentUser.id,
        sender: currentUser,
        content: newMessage,
        createdAt: new Date().toISOString(),
        isOffline: true,
        replyToId: replyingTo?.id || undefined,
        replyTo: replyingTo || undefined
      };
      setOfflineQueue(prev => [...prev, tempMessage]);
      clearMessageInput();
      return;
    }

    if (selectedFile) {
        setIsUploading(true);

        try {
          const { encryptedFile, metadata } = await encryptAttachmentFile(selectedFile);
          const formData = new FormData();
          formData.append('file', encryptedFile);

          const uploadRes = await api.post('/upload', formData, uploadConfig);
          const { fileKey } = uploadRes.data;
          const fileType = selectedFile.type.startsWith('image/')
            ? 'image'
            : selectedFile.type.startsWith('video/')
              ? 'video'
              : selectedFile.type.startsWith('audio/')
                ? 'audio'
                : uploadRes.data.fileType;

          const mlsEnvelope = activeConversation?.id
            ? await encryptOutgoingMessage(
                currentUser.id,
                activeConversation.id,
                getActiveParticipantIds(),
                newMessage,
                metadata, { delivery: { fileKey, fileType, replyToId: replyingTo?.id } }
              )
            : null;

          if (!mlsEnvelope) {
            alert("Uçtan uca şifreleme (MLS) anahtarı doğrulanamadı; güvenliğiniz için dosya ve mesaj şifresiz gönderilmedi.");
            return;
          }

          await deliverMlsMessage(currentUser.id, activeConversation!.id, mlsEnvelope.clientId);

          clearMessageInput();
          cancelFile();
        } catch (error) {
          alert(messageDeliveryError(error, 'Dosya gönderilemedi.'));
        } finally {
          setIsUploading(false);
          setUploadProgress(0);
        }
      }
      else {
        await mesajGonder(replyingTo?.id);
      }
  };

  const handleSend = async () => {
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    try {
      await performSend();
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const handleReply = (msg: Message) => {
    setReplyingTo(msg);
  };

  const handleForward = (msg: Message) => {
    setForwardMessages([msg]);
  };

  const executeForward = async (targetUser: User) => {
    if (forwardMessages.length === 0) return;
    try {
      const convRes = await api.post('/conversations/direct', { targetUserId: targetUser.id });
      const targetConvId = convRes.data.id;
      for (const msg of forwardMessages) {
        let parsedFileMeta: EncryptedFileMetadata | null = null;
        if (msg.encryptedFileMetadata) {
          try {
            parsedFileMeta = JSON.parse(msg.encryptedFileMetadata) as EncryptedFileMetadata;
          } catch {
            parsedFileMeta = null;
          }
        }

        const mlsEnvelope = await encryptOutgoingMessage(
          currentUser.id,
          targetConvId,
          [currentUser.id, targetUser.id],
          msg.content || '',
          parsedFileMeta, { delivery: { fileKey: msg.fileKey, fileType: msg.fileType, isForwarded: true } }
        );
        if (!mlsEnvelope) {
          throw new Error('MLS encryption failed for forwarded message');
        }

        await deliverMlsMessage(currentUser.id, targetConvId, mlsEnvelope.clientId);
      }
      alert(`Mesaj(lar) ${targetUser.username} kişisine uçtan uca şifreli olarak iletildi!`);
      setForwardMessages([]);
      setSelectedMessageIds(new Set());
      setIsSelectMode(false);
    } catch (error) { alert(messageDeliveryError(error, 'Mesajlar iletilemedi.')); }
  };

  const toggleSelectMessage = (msgId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  };

  const handleSelectMessage = (msgId: string) => {
    setIsSelectMode(true);
    setSelectedMessageIds((previous) => {
      const next = new Set(previous);
      next.add(msgId);
      return next;
    });
  };

  const handleBulkStar = async () => {
    if (selectedMessageIds.size === 0) return;
    try {
      await Promise.all(
        [...selectedMessageIds].map(id => api.put(`/messages/${id}/star`))
      );
      fetchSidebarData();
      setIsSelectMode(false);
      setSelectedMessageIds(new Set());
    } catch {
      alert("Yıldızlama işlemi başarısız.");
    }
  };

  const handleBulkDeleteForMe = async () => {
    if (selectedMessageIds.size === 0) return;
    const isConfirmed = await confirm({
      title: "Mesajları Kendimden Sil",
      message: "Seçilen mesajları kendinizden silmek istediğinize emin misiniz? Diğer katılımcılar bu mesajları görmeye devam edecektir.",
      confirmText: "Sil",
      cancelText: "Vazgeç",
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await Promise.all(
        [...selectedMessageIds].map(id => api.delete(`/messages/${id}?forEveryone=false`))
      );
      setIsSelectMode(false);
      setSelectedMessageIds(new Set());
      setIsBulkDeleteMenuOpen(false);
    } catch {
      alert("Silme işlemi başarısız.");
    }
  };

  const handleBulkDeleteForEveryone = async () => {
    if (selectedMessageIds.size === 0) return;
    const mySelectedIds = messages
      .filter(m => selectedMessageIds.has(m.id) && m.senderId === currentUser.id)
      .map(m => m.id);
    
    if (mySelectedIds.length === 0) {
      alert("Sadece kendi gönderdiğiniz mesajları herkesten silebilirsiniz.");
      setIsBulkDeleteMenuOpen(false);
      return;
    }

    const isConfirmed = await confirm({
      title: "Mesajları Herkesten Sil",
      message: `${mySelectedIds.length} mesajı herkesten silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
      confirmText: "Herkesten Sil",
      cancelText: "Vazgeç",
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await Promise.all(
        mySelectedIds.map(id => api.delete(`/messages/${id}?forEveryone=true`))
      );
      setIsSelectMode(false);
      setSelectedMessageIds(new Set());
      setIsBulkDeleteMenuOpen(false);
    } catch {
      alert("Silme işlemi başarısız.");
    }
  };

  const handleStar = async (msgId: string) => {
    try {
      const response = await api.put(`/messages/${msgId}/star`);
      setMessages((previous) => previous.map((message) => (
        message.id === msgId ? { ...message, ...response.data } : message
      )));
      fetchSidebarData();
    } catch { alert("İşlem başarısız."); }
  };

  const handlePin = async (msgId: string) => {
    try {
      const response = await api.put(`/messages/${msgId}/pin`);
      setMessages((previous) => previous.map((message) => (
        message.id === msgId ? { ...message, ...response.data } : message
      )));
    } catch { alert("İşlem başarısız."); }
  };

  const handleDisappearingMode = () => {
    if (!activeConversation?.id) return;
    setIsDisappearingSettingsOpen(true);
    setIsChatMenuOpen(false);
  };

  const openConversationInfoPanel = (tab: ConversationInfoTab = 'media') => {
    setConversationInfoTab(tab);
    setIsConversationInfoOpen(true);
    setIsChatMenuOpen(false);
  };

  const handleHeaderClick = () => {
    openConversationInfoPanel('media');
  };

  const handleBlockToggle = async () => {
    const partner = selectedUser || activeConversation?.otherUser;
    if (!partner) return;
    try {
      if (isBlockedLocally) {
        await api.delete(`/users/${partner.id}/block`);
        setIsBlockedLocally(false);
      } else {
        await api.post(`/users/${partner.id}/block`);
        setIsBlockedLocally(true);
      }
    } catch {
      alert(isBlockedLocally ? 'Engel kaldırılamadı.' : 'Kullanıcı engellenemedi.');
    }
  };

  const uploadVoiceMessage = async (audioBlob: Blob, durationSeconds: number) => {
    if (!activeConversation?.id || audioBlob.size === 0) return;
    setIsUploading(true);
    try {
      const rawFile = new File([audioBlob], `voice-${Date.now()}.webm`, { type: audioBlob.type || 'audio/webm' });
      const { encryptedFile, metadata } = await encryptAttachmentFile(rawFile);
      const formData = new FormData();
      formData.append('file', encryptedFile);
      const uploadRes = await api.post('/upload', formData, uploadConfig);

      const formattedDuration = formatSeconds(durationSeconds);
      const contentText = `Sesli mesaj (${formattedDuration})`;

      const mlsEnvelope = await encryptOutgoingMessage(
        currentUser.id,
        activeConversation.id,
        getActiveParticipantIds(),
        contentText,
        metadata, { delivery: { fileKey: uploadRes.data.fileKey, fileType: 'audio' } }
      );
      if (!mlsEnvelope) {
        alert('Uçtan uca şifreleme (MLS) anahtarı doğrulanamadı; sesli mesaj gönderilmedi.');
        return;
      }

      await deliverMlsMessage(currentUser.id, activeConversation.id, mlsEnvelope.clientId);
    } catch (error) {
      alert(messageDeliveryError(error, 'Sesli mesaj gönderilemedi.'));
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const toggleVoiceRecordingWrapper = () => {
    if (isRecordingAudio) {
      sendRecording(onVoiceRecording);
      return;
    }
    void startRecording(onVoiceRecording, uploadVoiceMessage);
  };

  const handleCancelVoiceRecording = () => {
    cancelRecording(onVoiceRecording);
  };

  const handleSendVoiceRecording = () => {
    sendRecording(onVoiceRecording);
  };

  const handleEditMessage = async (message: Message) => {
    setReplyingTo(null);
    setEditingMessage(message);
    setNewMessage(message.content || '');
  };

  const handleSaveMessageEdit = async () => {
    if (!editingMessage) return;
    const content = newMessage.trim();
    if (!content) return;
    if (content === editingMessage.content) {
      setEditingMessage(null);
      setNewMessage('');
      return;
    }
    try {
      if (!activeConversation?.id) return;
      const fileMetadata = editingMessage.encryptedFileMetadata ? JSON.parse(editingMessage.encryptedFileMetadata) : null;
      const mlsEnvelope = await encryptOutgoingMessage(
        currentUser.id, activeConversation.id, getActiveParticipantIds(),
        content, fileMetadata, { editId: editingMessage.id }
      );
      if (!mlsEnvelope) {
        alert('Uçtan uca şifreleme anahtarı doğrulanamadı. Mesaj düzenlenemedi.');
        return;
      }
      const response = await deliverMlsMessage(currentUser.id, activeConversation.id, mlsEnvelope.clientId);
      const hydrated = await decryptIncomingMessage(currentUser.id, response.data);
      setMessages((previous) => previous.map((message) => (
        message.id === editingMessage.id ? { ...message, ...hydrated } : message
      )));
      setEditingMessage(null);
      setNewMessage('');
    } catch (error) { alert(messageDeliveryError(error, 'Mesaj düzenlenemedi.')); }
  };

  const handleDeleteForMe = async (msgId: string) => {
    const message = messages.find((item) => item.id === msgId);
    if (!message) return;
    const isConfirmed = await confirm({
      title: "Mesajı Kendimden Sil",
      message: "Bu mesajı kendinizden silmek istediğinize emin misiniz? Diğer katılımcılar bu mesajı görmeye devam edecektir.",
      confirmText: "Sil",
      cancelText: "Vazgeç",
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await onDeleteMessageForMe(message);
    } catch { alert("İşlem başarısız."); }
  };

  const handleDeleteForEveryone = async (msgId: string) => {
    const isConfirmed = await confirm({
      title: "Mesajı Herkesten Sil",
      message: "Bu mesajı herkesten silmek istediğinize emin misiniz? Bu işlem geri alınamaz.",
      confirmText: "Herkesten Sil",
      cancelText: "Vazgeç",
      isDanger: true
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/messages/${msgId}?forEveryone=true`);
      setMessages((previous) => previous.map((message) => message.id === msgId ? {
        ...message,
        content: '🚫 Bu mesaj silindi',
        fileKey: undefined,
        fileUrl: undefined,
        fileType: undefined,
        fileName: undefined,
        replyToId: undefined,
        replyTo: undefined,
        isForwarded: false
      } : message));
    } catch { alert("İşlem başarısız."); }
  };

  const scrollToMessage = (messageId?: string) => {
    if (!messageId) return;
    setIsConversationInfoOpen(false);
    onFocusMessage(messageId);
  };

  const focusIsLoaded = messages.some((message) => message.id === messageFocus?.messageId && !isPendingMessageDecryption(message));
  useEffect(() => {
    if (!messageFocus || !focusIsLoaded || isLoadingChat || messageFocus.conversationId !== activeConversation?.id) return;
    const { messageId } = messageFocus;
    if (messageSearchTerm) {
      setMessageSearchTerm('');
      return;
    }
    const target = messagesListRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'instant', block: 'center' });
    setMessageHighlight((current) => ({ id: messageId, sequence: (current?.sequence ?? 0) + 1 }));
    const timer = window.setTimeout(() => setMessageHighlight(null), 1000);
    return () => window.clearTimeout(timer);
  }, [messageFocus, activeConversation?.id, messageSearchTerm, focusIsLoaded, isLoadingChat]);

  if (!activeConversation && !selectedUser) {
    return <EmptyChatState panelBg={panelBg} textColor={textColor} iconColor={iconColor} />;
  }

  const displayedMessages = messages.filter((message) => !isPendingMessageDecryption(message) && (
    !messageSearchTerm.trim() || message.content.toLowerCase().includes(messageSearchTerm.toLowerCase())
  ));

  const conversationOfflineMessages = offlineQueue.filter(m => m.conversationId === activeConversation?.id);
  const combinedMessages = [...displayedMessages, ...conversationOfflineMessages];

  const pinnedMessages = displayedMessages.filter(m => m.isPinned);
  const mediaMessages = mediaPanelData.mediaMessages;
  const linkItems = mediaPanelData.linkItems;
  const conversationSystemEntries = activeConversation?.id
    ? systemTimelineEntries.filter((entry) => entry.conversationId === activeConversation.id &&
        (!activeConversation.historyClearedAt || entry.createdAt > activeConversation.historyClearedAt))
    : [];
  const timelineItemsWithDateSeparators = buildTimelineWithDateSeparators(
    combinedMessages,
    conversationSystemEntries,
    currentUser.username
  );

  const chatPartner = (selectedUser || activeConversation?.otherUser) || undefined;
  const adminMember = groupMembers.find(m => m.id === activeConversation?.adminId);
  const adminName = adminMember ? adminMember.username : 'Grup yöneticisi';
  const partnerStatus = typingUsername
    ? `${typingUsername} yazıyor...`
    : chatPartner?.isOnline
      ? 'Çevrimiçi'
      : chatPartner?.lastSeenAt
        ? `Son görülme: ${new Date(chatPartner.lastSeenAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}`
        : '';

  const disappearingOptions: Array<{ label: string; description: string; seconds: number | null }> = [
    { label: 'Kapalı', description: 'Mesajlar normal şekilde kalır.', seconds: null },
    { label: '1 saat', description: 'Yeni mesajlar 1 saat sonra silinir.', seconds: 3600 },
    { label: '24 saat', description: 'Günlük ve dengeli mod.', seconds: 86400 },
    { label: '7 gün', description: 'Daha uzun süreli geçici sohbet.', seconds: 604800 }
  ];

  return (
    <div className="chat-area-wrapper" style={{ position: 'relative', display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>

      {/* SOL TARAF: ANA SOHBET ALANI */}
      <div 
        className="chat-area" 
        onPaste={handlePaste} 
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, background: chatBg }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDraggingFile && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(249, 115, 22, 0.08)',
            backdropFilter: 'blur(3px)',
            border: '3px dashed #f97316',
            borderRadius: '16px',
            margin: '10px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 5000,
            color: '#f97316',
            pointerEvents: 'none',
            boxSizing: 'border-box'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>📁</div>
            <h3 style={{ margin: 0, fontWeight: 700, fontSize: '18px' }}>Dosyaları Buraya Bırakın</h3>
            <p style={{ margin: '6px 0 0', fontSize: '13px', opacity: 0.85 }}>Sohbet alanına sürüklediğiniz dosyaları göndermek için bırakın.</p>
          </div>
        )}

        {/* ÜST BAR (HEADER) */}
        <ChatHeader
          isSelectMode={isSelectMode}
          setIsSelectMode={setIsSelectMode}
          selectedMessageIds={selectedMessageIds}
          setSelectedMessageIds={setSelectedMessageIds}
          closeChat={closeChat}
          activeConversation={activeConversation}
          chatPartner={chatPartner}
          partnerStatus={partnerStatus}
          typingUsername={typingUsername}
          recordingUsername={recordingUsername}
          handleHeaderClick={handleHeaderClick}
          iconColor={iconColor}
          textColor={textColor}
          panelBg={panelBg}
          borderColor={borderColor}
          messages={messages}
          setForwardMessages={setForwardMessages}
          handleBulkStar={handleBulkStar}
          isBulkDeleteMenuOpen={isBulkDeleteMenuOpen}
          setIsBulkDeleteMenuOpen={setIsBulkDeleteMenuOpen}
          handleBulkDeleteForMe={handleBulkDeleteForMe}
          handleBulkDeleteForEveryone={handleBulkDeleteForEveryone}
          onStartCall={onStartCall}
          isSearchOpen={isSearchOpen}
          setIsSearchOpen={setIsSearchOpen}
          setMessageSearchTerm={setMessageSearchTerm}
          isChatMenuOpen={isChatMenuOpen}
          setIsChatMenuOpen={setIsChatMenuOpen}
          openConversationInfoPanel={openConversationInfoPanel}
          onToggleConversationMute={onToggleConversationMute}
          onToggleConversationPin={onToggleConversationPin}
          onToggleConversationArchive={onToggleConversationArchive}
          onDeleteConversationHistory={onDeleteConversationHistory}
          onClearPersonalHistory={onClearPersonalHistory}
          handleDisappearingMode={handleDisappearingMode}
          isBlockedLocally={isBlockedLocally}
          handleBlockToggle={handleBlockToggle}
        />
        {hasNewer && (
          <div className="chat-history-jump">
            <button type="button" className="action-btn-outline" onClick={() => onFocusMessage()}>Son mesajlara dön</button>
          </div>
        )}
        
        {/* KAYBOLAN MESAJ MODALI */}
        {isDisappearingSettingsOpen && activeConversation?.id && (
          <div className="settings-overlay" onClick={() => setIsDisappearingSettingsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div onClick={(event) => event.stopPropagation()} style={{ width: '430px', maxWidth: '100%', background: panelBg, border: `1px solid ${borderColor}`, borderRadius: '18px', boxShadow: '0 24px 70px rgba(0,0,0,0.38)', color: textColor, overflow: 'hidden' }}>
              <div style={{ padding: '18px 18px 14px', background: isDisappearingMode ? 'linear-gradient(135deg, #0f8f6f, #145c4d)' : inputBg }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: isDisappearingMode ? '#ffe3c2' : '#f97316' }}>Kaybolan mesaj modu</div>
                <h3 style={{ margin: '4px 0 6px', fontSize: '19px', color: isDisappearingMode ? 'white' : textColor }}>Mesajlar ne kadar sonra kaybolsun?</h3>
                <p style={{ margin: 0, fontSize: '13px', color: isDisappearingMode ? '#ffe3c2' : iconColor }}>Bu ayar açıldıktan sonra gönderilen yeni mesajlara uygulanır.</p>
              </div>

              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {disappearingOptions.map((option) => {
                  const isSelected = option.seconds === (activeConversation.disappearingDurationSeconds ?? null);
                  return (
                    <button
                      key={option.label}
                      onClick={() => {
                        onSetDisappearingMode(activeConversation.id, option.seconds);
                        setIsDisappearingSettingsOpen(false);
                      }}
                      style={{ border: `1px solid ${isSelected ? '#f97316' : borderColor}`, background: isSelected ? (isDarkMode ? 'rgba(249, 115, 22,0.18)' : '#ffedd5') : inputBg, color: textColor, borderRadius: '14px', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}
                    >
                      <span>
                        <strong style={{ display: 'block', fontSize: '14px' }}>{option.label}</strong>
                        <span style={{ display: 'block', fontSize: '12px', color: iconColor, marginTop: '3px' }}>{option.description}</span>
                      </span>
                      <span style={{ color: isSelected ? '#f97316' : iconColor, fontWeight: 800 }}>{isSelected ? '✓' : '○'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SABİTLENMİŞ MESAJ BANNERI */}
        {pinnedMessages.length > 0 && (
          <div
            onClick={() => scrollToMessage(pinnedMessages[pinnedIndex % pinnedMessages.length]?.id)}
            style={{ background: panelBg, borderBottom: `1px solid ${borderColor}`, padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: textColor, zIndex: 5, boxShadow: '0 2px 5px rgba(0,0,0,0.05)', cursor: 'pointer' }}
          >
            <span style={{ color: '#8696a0', fontSize: '16px' }}>📌</span>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <strong style={{ color: '#f97316' }}>
                Sabitlenmiş Mesaj {pinnedMessages.length > 1 && `(${(pinnedIndex % pinnedMessages.length) + 1}/${pinnedMessages.length})`}
              </strong>
              <span style={{ opacity: 0.8 }}>
                {getMessagePreview(pinnedMessages[pinnedIndex % pinnedMessages.length]).substring(0, 60)}...
              </span>
            </div>
            {pinnedMessages.length > 1 && (
              <button
                onClick={(event) => { event.stopPropagation(); setPinnedIndex((prev) => (prev + 1) % pinnedMessages.length); }}
                style={{ border: `1px solid ${borderColor}`, background: inputBg, color: textColor, borderRadius: '999px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}
              >
                Sonraki
              </button>
            )}
          </div>
        )}

        {/* ARAMA ÇUBUĞU */}
        {isSearchOpen && (
          <div className="chat-search-bar" style={{ padding: '10px 20px', background: panelBg, borderBottom: `1px solid ${borderColor}` }}>
            <input type="text" className="global-search-input" placeholder="Bu sohbette ara..." value={messageSearchTerm} onChange={(e) => setMessageSearchTerm(e.target.value)} autoFocus style={{ width: '100%', padding: '10px 15px', borderRadius: '8px', border: `1px solid ${borderColor}`, background: inputBg, color: textColor, outline: 'none' }} />
          </div>
        )}

        {/* MESAJ LİSTESİ */}
        <div className="messages-list"
          ref={messagesListRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '20px' }}
        >
          {isLoadingMore && (
            <div style={{ textAlign: 'center', padding: '10px', color: '#f97316', fontSize: '12px', fontWeight: 'bold' }}>
              Eski mesajlar yükleniyor... ⏳
            </div>
          )}

          {isLoadingChat ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
              <div className="skeleton-row them"><div className="skeleton-bubble" /></div>
              <div className="skeleton-row me"><div className="skeleton-bubble" /></div>
              <div className="skeleton-row them"><div className="skeleton-bubble" style={{ width: '40%', height: '50px' }} /></div>
              <div className="skeleton-row me"><div className="skeleton-bubble" style={{ width: '60%', height: '44px' }} /></div>
              <div className="skeleton-row them"><div className="skeleton-bubble" style={{ width: '30%', height: '56px' }} /></div>
            </div>
          ) : (
            <>
              {activeConversation?.isGroup && !activeConversation.historyClearedAt && (
                <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 25px 0' }}>
                  <div style={{ background: isDarkMode ? '#182229' : '#fff5c4', color: isDarkMode ? '#8696a0' : '#54656f', padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', maxWidth: '85%' }}>
                    <span style={{ fontSize: '14px', marginRight: '5px' }}>🔒</span>
                    <strong>Mesajlar güvenli bağlantı üzerinden iletilir.</strong><br />
                    <span style={{ marginTop: '5px', display: 'inline-block' }}>{activeConversation.adminId === currentUser.id ? `Siz "${activeConversation.name}" grubunu oluşturdunuz.` : `"${adminName}" sizi "${activeConversation.name}" grubuna ekledi.`}</span>
                  </div>
                </div>
              )}

              {isReadOnlyHistory && messages.length === 0 && (
                <p style={{ textAlign: 'center', color: iconColor }}>Bu cihazda görüntülenebilen grup mesajı yok.</p>
              )}
              {timelineItemsWithDateSeparators.map((item) => (
                <MessageBubble
                  key={item.id}
                  item={item}
                  currentUser={currentUser}
                  activeConversation={activeConversation}
                  groupMembers={groupMembers}
                  usersList={usersList}
                  isSelectMode={isSelectMode}
                  selectedMessageIds={selectedMessageIds}
                  toggleSelectMessage={toggleSelectMessage}
                  handleSelectMessage={handleSelectMessage}
                  highlightSequence={messageHighlight?.id === item.id ? messageHighlight.sequence : undefined}
                  setAvatarProfileUser={setAvatarProfileUser}
                  setLightboxImageUrl={setLightboxImageUrl}
                  isDarkMode={isDarkMode}
                  textColor={textColor}
                  iconColor={iconColor}
                  borderColor={borderColor}
                  inputBg={inputBg}
                  panelBg={panelBg}
                  handleReply={handleReply}
                  handleForward={handleForward}
                  handleStar={handleStar}
                  handlePin={handlePin}
                  handleDeleteForMe={handleDeleteForMe}
                  handleDeleteForEveryone={handleDeleteForEveryone}
                  handleEditMessage={handleEditMessage}
                  setMessageInfo={setMessageInfo}
                  selectedUser={selectedUser}
                />
              ))}

              {isBlockedLocally && (
                <div style={{ display: 'flex', justifyContent: 'center', margin: '15px 0', width: '100%' }}>
                  <div style={{
                    background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    color: iconColor,
                    padding: '8px 16px',
                    borderRadius: '12px',
                    fontSize: '13px',
                    fontStyle: 'italic',
                    textAlign: 'center',
                    maxWidth: '85%',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    opacity: 0.85
                  }}>
                    Bu kullanıcıyı engellediniz.
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* --- MODALLAR --- */}

        {/* MESAJ BİLGİSİ (INFO) MODALI */}
        {messageInfo && (
          <div className="settings-overlay" onClick={() => setMessageInfo(null)} style={{ zIndex: 10000 }}>
            <div style={{ width: '400px', background: panelBg, borderRadius: '12px', padding: '25px', boxShadow: '0 15px 50px rgba(0,0,0,0.3)', color: textColor }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 20px 0', borderBottom: `1px solid ${borderColor}`, paddingBottom: '10px', fontSize: '18px', display: 'flex', justifyContent: 'space-between' }}>
                Mesaj Bilgisi
                <span style={{ cursor: 'pointer', color: iconColor }} onClick={() => setMessageInfo(null)}>✖</span>
              </h3>

              <div style={{ background: inputBg, padding: '15px', borderRadius: '8px', marginBottom: '20px', border: `1px solid ${borderColor}`, fontSize: '14px', wordBreak: 'break-word', opacity: 0.9 }}>
                "{getMessagePreview(messageInfo)}"
              </div>

              <div style={{ marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ fontWeight: '600', color: '#f97316', fontSize: '15px' }}>✓ İletilme Tarihi</div>
                <div style={{ fontSize: '14px' }}>{formatDetailedDate(messageInfo.createdAt)}</div>
                <div style={{ fontSize: '12px', color: iconColor, fontFamily: 'monospace' }}>Unix Epoch: {getUnixEpoch(messageInfo.createdAt)}</div>
              </div>

              {messageInfo.senderId === currentUser.id && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <div style={{ fontWeight: '600', color: '#f97316', fontSize: '15px' }}>✓✓ Okuyanlar</div>
                  {messageInfo.readByIds && messageInfo.readByIds.length > 0 ? (
                    <div style={{ maxHeight: '120px', overflowY: 'auto', background: inputBg, padding: '10px', borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                      {messageInfo.readByIds.map(id => {
                        const u = id === currentUser.id ? currentUser : usersList.find(user => user.id === id);
                        return (
                          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#f97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                              {u?.username?.[0]?.toUpperCase() || '?'}
                            </div>
                            <span style={{ fontSize: '14px', color: textColor, fontWeight: '500' }}>{u?.username || 'Bilinmeyen Kullanıcı'}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '14px', color: iconColor }}>Henüz kimse okumadı</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* MESAJ İLETME MODALI */}
        {forwardMessages.length > 0 && (
          <div className="settings-overlay" onClick={() => setForwardMessages([])} style={{ zIndex: 10000 }}>
            <div style={{ width: '350px', background: panelBg, borderRadius: '12px', padding: '20px', boxShadow: '0 15px 50px rgba(0,0,0,0.3)', color: textColor, display: 'flex', flexDirection: 'column', maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 15px 0', borderBottom: `1px solid ${borderColor}`, paddingBottom: '10px', fontSize: '16px', display: 'flex', justifyContent: 'space-between' }}>
                Mesajı İlet...
                <span style={{ cursor: 'pointer', color: iconColor }} onClick={() => setForwardMessages([])}>✖</span>
              </h3>

              <div style={{ overflowY: 'auto', flex: 1, paddingRight: '5px' }}>
                {usersList.filter(u => u.id !== currentUser.id).length === 0 ? (
                  <div style={{ fontSize: '13px', color: iconColor, textAlign: 'center', padding: '20px 0' }}>İletilecek kişi bulunamadı.</div>
                ) : (
                  usersList.filter(u => u.id !== currentUser.id).map(u => (
                    <div key={u.id} onClick={() => executeForward(u)} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderBottom: `1px solid ${borderColor}`, cursor: 'pointer', transition: 'background 0.2s', borderRadius: '8px' }} onMouseOver={(e) => e.currentTarget.style.background = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#f97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px' }}>
                        {u.username[0].toUpperCase()}
                      </div>
                      <span style={{ fontWeight: '500', fontSize: '15px' }}>{u.username}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ALT KISIM: YAZMA VE ARAÇLAR ALANI */}
        <ChatInput
          isGroup={activeConversation?.isGroup}
          isActiveGroupMember={activeConversation?.isActive !== false}
          isDeleted={activeConversation?.isDeleted}
          isBlockedLocally={isBlockedLocally}
          chatPartner={chatPartner}
          isDarkMode={isDarkMode}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          replyingTo={replyingTo}
          setReplyingTo={setReplyingTo}
          selectedFile={selectedFile}
          filePreview={filePreview}
          cancelFile={cancelFile}
          isRecordingAudio={isRecordingAudio}
          isRecordingPaused={isRecordingPaused}
          recordingDuration={recordingDuration}
          handleCancelVoiceRecording={handleCancelVoiceRecording}
          togglePauseResumeRecording={pauseResumeRecording}
          handleSendVoiceRecording={handleSendVoiceRecording}
          showEmojiPicker={showEmojiPicker}
          setShowEmojiPicker={setShowEmojiPicker}
          showAttachmentMenu={showAttachmentMenu}
          setShowAttachmentMenu={setShowAttachmentMenu}
          openFilePicker={openFilePicker}
          fileInputRef={fileInputRef}
          fileAccept={fileAccept}
          handleFileUpload={handleFileUpload}
          newMessage={newMessage}
          setNewMessage={setNewMessage}
          handleSend={handleSend}
          handleBlockToggle={handleBlockToggle}
          panelBg={panelBg}
          inputBg={inputBg}
          borderColor={borderColor}
          textColor={textColor}
          iconColor={iconColor}
          toggleVoiceRecording={toggleVoiceRecordingWrapper}
          editingMessage={editingMessage}
          setEditingMessage={setEditingMessage}
          handleSaveMessageEdit={handleSaveMessageEdit}
        />

        <style>{`
          .msg-dropdown-btn { width: 100%; text-align: left; padding: 12px 15px; border: none; background: transparent; color: ${textColor}; font-size: 14px; cursor: pointer; transition: background 0.2s; }
          .msg-dropdown-btn:hover { background: ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}; }
          .msg-dropdown-menu .msg-dropdown-btn { padding: 10px 12px; border-radius: 8px; line-height: 1.25; white-space: nowrap; }
          .msg-dropdown-btn.danger-text { color: #e53935; font-weight: bold; }
          .msg-dropdown-btn.danger-text:hover { background: ${isDarkMode ? 'rgba(229, 57, 53, 0.15)' : '#ffebee'}; }
          .date-separator-row { display: flex; justify-content: center; margin: 12px 0; }
          .date-separator-pill { background: ${isDarkMode ? '#182229' : '#ffffff'}; color: ${iconColor}; border: 1px solid ${borderColor}; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 700; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
          .typing-dots { display: inline-flex; align-items: center; gap: 3px; height: 10px; }
          .typing-dots i { width: 4px; height: 4px; border-radius: 50%; background: #f97316; animation: typing-bounce 1s infinite ease-in-out; }
          .typing-dots i:nth-child(2) { animation-delay: 0.15s; }
          .typing-dots i:nth-child(3) { animation-delay: 0.3s; }
          .recording-dot { width: 9px; height: 9px; border-radius: 50%; background: #e53935; box-shadow: 0 0 0 0 rgba(229,57,53,0.4); animation: recording-pulse 1.15s infinite; }
          @keyframes typing-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.45; } 40% { transform: translateY(-3px); opacity: 1; } }
          @keyframes recording-pulse { 0% { box-shadow: 0 0 0 0 rgba(229,57,53,0.42); } 70% { box-shadow: 0 0 0 8px rgba(229,57,53,0); } 100% { box-shadow: 0 0 0 0 rgba(229,57,53,0); } }
          @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        `}</style>

      </div>

      <ConversationInfoSidebar
        isConversationInfoOpen={isConversationInfoOpen}
        setIsConversationInfoOpen={setIsConversationInfoOpen}
        activeConversation={activeConversation}
        chatPartner={chatPartner}
        partnerStatus={partnerStatus}
        openGroupSettings={openGroupSettings}
        handleBlockToggle={handleBlockToggle}
        isBlockedLocally={isBlockedLocally}
        mediaMessages={mediaMessages}
        linkItems={linkItems}
        conversationStarredMessages={conversationStarredMessages}
        conversationInfoTab={conversationInfoTab}
        setConversationInfoTab={setConversationInfoTab}
        scrollToMessage={scrollToMessage}
        panelBg={panelBg}
        inputBg={inputBg}
        borderColor={borderColor}
        textColor={textColor}
        iconColor={iconColor}
        isDarkMode={isDarkMode}
        lightboxImageUrl={lightboxImageUrl}
        setLightboxImageUrl={setLightboxImageUrl}
        avatarProfileUser={avatarProfileUser}
        setAvatarProfileUser={setAvatarProfileUser}
        onStartDirectChat={onStartDirectChat}
        onStartCallWithUser={onStartCallWithUser}
      />

    </div>
  );
}
