import { useState, useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import { api } from '../../api/httpClient';
import type { User, Conversation, Message, ScheduledMessage } from '../../types/chat';
import './ChatArea.css';
import { useFileAttachment } from '../../hooks/useFileAttachment';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { useMessageInput } from '../../hooks/useMessageInput';
import Button from '../UI/Button';

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
  newMessage: string;
  setNewMessage: (val: string) => void;
  mesajGonder: (replyToId?: string) => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  openGroupSettings: () => void;
  closeChat: () => void;
  isDarkMode: boolean;
  usersList: User[];
  groupMembers: User[];
  loadMoreMessages: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  typingUsername?: string;
  recordingUsername?: string;
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

type ConversationInfoTab = 'media' | 'links' | 'scheduled' | 'starred';

type SystemTimelineEntry = {
  id: string;
  conversationId: string;
  text: string;
  createdAt: string;
};

type TimelineItem =
  | { type: 'message'; createdAt: string; id: string; message: Message }
  | { type: 'system'; createdAt: string; id: string; entry: SystemTimelineEntry };

type TimelineRenderItem =
  | TimelineItem
  | { type: 'date'; id: string; label: string; createdAt: string };

const formatSeconds = (totalSeconds: number) => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

export default function ChatArea({
  currentUser, activeConversation, selectedUser, messages, newMessage: newMessageProp,
  setNewMessage: setNewMessageProp, mesajGonder, messagesEndRef, openGroupSettings, closeChat, isDarkMode,
  usersList, groupMembers, loadMoreMessages, hasMore, isLoadingMore, typingUsername, recordingUsername, onTyping, onVoiceRecording,
  onToggleConversationPin, onToggleConversationArchive, onToggleConversationMute, onSetDisappearingMode,
  onStartCall, socketConnectionStatus, onStartDirectChat, onStartCallWithUser
}: ChatAreaProps) {

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
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editMessageText, setEditMessageText] = useState('');

  // ZAMANLAMA VE BEKLEYEN MESAJ DURUMLARI
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<ScheduledMessage[]>([]);

  // Zamanlanmış mesaj düzenleme
  const [editingScheduled, setEditingScheduled] = useState<ScheduledMessage | null>(null);
  const [editScheduledText, setEditScheduledText] = useState('');
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
    setReplyingTo,
    isScheduling,
    setIsScheduling,
    scheduleTime,
    setScheduleTime
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
    cancelFile, handleFileUpload, handlePaste, openFilePicker
  } = useFileAttachment();
  const scheduledFileInputRef = useRef<HTMLInputElement>(null);
  const [scheduledFileTarget, setScheduledFileTarget] = useState<string | null>(null);

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

  // Çevrimdışı gönderilen mesajları otomatik yeniden deneme (Auto-retry on reconnect)
  useEffect(() => {
    if (socketConnectionStatus === 'connected' && offlineQueue.length > 0) {
      const retryQueue = async () => {
        const toSend = [...offlineQueue];
        setOfflineQueue([]); // Kuyruğu sıfırla ki mükerrer deneme olmasın
        
        for (const msg of toSend) {
          try {
            await api.post('/messages', {
              conversationId: msg.conversationId,
              clientId: msg.id.replace('offline-', ''), // temp uuid
              content: msg.content,
              replyToId: msg.replyToId
            });
          } catch {
            // Hata durumunda kuyruğa geri ekle
            setOfflineQueue(prev => [...prev, msg]);
          }
        }
      };
      void retryQueue();
    }
  }, [socketConnectionStatus, offlineQueue]);

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

  const fetchPendingMessages = useCallback(async () => {
    if (!activeConversation?.id) return;
    try {
      const response = await api.get(`/messages/scheduled/${activeConversation.id}`);
      setPendingMessages(response.data);
    } catch {
      console.error('Bekleyen mesajlar alınamadı.');
    }
  }, [activeConversation?.id]);

  // F5 GEREKTİRMEDEN ANLIK VERİ YENİLEME FONKSİYONU
  const fetchSidebarData = useCallback(() => {
    if (!activeConversation?.id || !isConversationInfoOpen) return;

    api.get(`/conversations/${activeConversation.id}/media`)
      .then((response) => setMediaPanelData(response.data))
      .catch(() => setMediaPanelData({ mediaMessages: [], linkItems: [] }));

    fetchPendingMessages();

    api.get('/messages/starred')
      .then((response) => {
        const starredInConversation = (response.data as Message[]).filter((message) => message.conversationId === activeConversation?.id);
        setConversationStarredMessages(starredInConversation);
      })
      .catch(() => setConversationStarredMessages([]));
  }, [activeConversation?.id, isConversationInfoOpen, fetchPendingMessages]);


  useEffect(() => {
    if (activeConversation?.id) {
      setReplyingTo(null);
      setIsConversationInfoOpen(false);
      cancelFile();
    }
  }, [activeConversation?.id, cancelFile, setReplyingTo]);

  useEffect(() => {
    if (activeConversation?.id && isPendingModalOpen) {
      fetchPendingMessages();
    }
  }, [isPendingModalOpen, activeConversation?.id, fetchPendingMessages]);

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

  const cancelScheduledMessage = async (id: string) => {
    try {
      await api.delete(`/messages/schedule/${id}`);
      setPendingMessages(prev => prev.filter(m => m.id !== id));
      fetchSidebarData();
    } catch { alert("İptal işlemi başarısız."); }
  };

  const sendNowScheduledMessage = async (id: string) => {
    try {
      await api.post(`/messages/schedule/send-now/${id}`);
      setPendingMessages(prev => prev.filter(m => m.id !== id));
      fetchSidebarData();
    } catch { alert("Mesaj anında gönderilemedi."); }
  };

  const openEditScheduledModal = (pm: ScheduledMessage) => {
    setEditingScheduled(pm);
    setEditScheduledText(pm.content || '');
  };

  const handleSaveScheduledEdit = async () => {
    if (!editingScheduled) return;
    try {
      await api.put(`/messages/schedule/${editingScheduled.id}`, { content: editScheduledText });
      setPendingMessages(prev => prev.map(m => m.id === editingScheduled.id ? { ...m, content: editScheduledText } : m));
      setEditingScheduled(null);
      fetchSidebarData();
    } catch { alert("Mesaj güncellenemedi."); }
  };

  const handleSend = async () => {
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

    if (isScheduling) {
      if (!scheduleTime || scheduleTime.getTime() <= Date.now()) return alert("Geçerli bir gelecek zaman seçin!");

      try {
        let uploadedFileKey = null;
        let uploadedFileType = null;
        let uploadedFileName = null;

        if (selectedFile) {
          setIsUploading(true);
          const formData = new FormData();
          formData.append('file', selectedFile);

          const uploadRes = await api.post('/upload', formData, uploadConfig);

          uploadedFileKey = uploadRes.data.fileKey;
          uploadedFileType = uploadRes.data.fileType;
          uploadedFileName = uploadRes.data.fileName;
        }

        await api.post('/messages/schedule', {
          conversationId: activeConversation?.id,
          clientId: crypto.randomUUID(),
          content: newMessage,
          sendAt: scheduleTime.toISOString(),
          fileKey: uploadedFileKey,
          fileType: uploadedFileType,
          fileName: uploadedFileName
        });

        clearMessageInput();
        cancelFile();
        fetchSidebarData();
      } catch {
        alert("Mesaj zamanlanırken hata oluştu.");
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
      }
    } else {
      if (selectedFile) {
        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
          const uploadRes = await api.post('/upload', formData, uploadConfig);
          const { fileKey, fileType, fileName } = uploadRes.data;

          await api.post('/messages', {
            conversationId: activeConversation?.id,
            clientId: crypto.randomUUID(),
            content: newMessage,
            fileKey, fileType, fileName,
            replyToId: replyingTo?.id
          });

          clearMessageInput();
          cancelFile();
        } catch {
          alert("Dosya yüklenirken hata oluştu.");
        } finally {
          setIsUploading(false);
          setUploadProgress(0);
        }
      }
      else {
        mesajGonder(replyingTo?.id);
        clearMessageInput();
      }
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
      for (const msg of forwardMessages) {
        await api.post('/messages', {
          conversationId: convRes.data.id,
          clientId: crypto.randomUUID(),
          content: msg.content || '',
          isForwarded: true,
          fileKey: msg.fileKey,
          fileType: msg.fileType,
          fileName: msg.fileName
        });
      }
      alert(`Mesaj(lar) ${targetUser.username} kişisine iletildi!`);
      setForwardMessages([]);
      setSelectedMessageIds(new Set());
      setIsSelectMode(false);
    } catch { alert("Mesajlar iletilemedi."); }
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
    if (!window.confirm("Seçilen mesajları kendinizden silmek istediğinize emin misiniz?")) return;
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

    if (!window.confirm(`${mySelectedIds.length} mesajı herkesten silmek istediğinize emin misiniz?`)) return;
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
      await api.put(`/messages/${msgId}/star`);
      fetchSidebarData();
    } catch { alert("İşlem başarısız."); }
  };

  const handlePin = async (msgId: string) => {
    try { await api.put(`/messages/${msgId}/pin`); } catch { alert("İşlem başarısız."); }
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
      const file = new File([audioBlob], `voice-${Date.now()}.webm`, { type: audioBlob.type || 'audio/webm' });
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await api.post('/upload', formData, uploadConfig);

      const formattedDuration = formatSeconds(durationSeconds);
      const contentText = `Sesli mesaj (${formattedDuration})`;

      await api.post('/messages', {
        conversationId: activeConversation.id,
        clientId: crypto.randomUUID(),
        content: contentText,
        fileKey: uploadRes.data.fileKey,
        fileType: uploadRes.data.fileType,
        fileName: uploadRes.data.fileName
      });
    } catch {
      alert('Sesli mesaj gönderilemedi.');
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
    setEditingMessage(message);
    setEditMessageText(message.content || '');
  };

  const handleSaveMessageEdit = async () => {
    if (!editingMessage) return;
    const content = editMessageText.trim();
    if (!content || content === editingMessage.content) return setEditingMessage(null);
    try {
      await api.put(`/messages/${editingMessage.id}`, { content });
      setEditingMessage(null);
    } catch { alert('Mesaj düzenlenemedi.'); }
  };

  const replaceScheduledFile = (id: string) => {
    setScheduledFileTarget(id);
    setTimeout(() => scheduledFileInputRef.current?.click(), 0);
  };

  const handleScheduledFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const target = pendingMessages.find((message) => message.id === scheduledFileTarget);
    if (!file || !target) return;
    if (file.size > 50 * 1024 * 1024) return alert('Maksimum 50 MB!');

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const upload = await api.post('/upload', formData, uploadConfig);
      const response = await api.put(`/messages/schedule/${target.id}`, {
        content: target.content,
        fileKey: upload.data.fileKey,
        fileType: upload.data.fileType,
        fileName: upload.data.fileName
      });
      setPendingMessages((previous) => previous.map((message) => message.id === target.id ? response.data.updatedMessage : message));
      setEditingScheduled((previous) => previous?.id === target.id ? response.data.updatedMessage : previous);
      fetchSidebarData();
    } catch { alert('Zamanlanmış dosya değiştirilemedi.'); }
    finally {
      setIsUploading(false);
      setUploadProgress(0);
      setScheduledFileTarget(null);
      event.target.value = '';
    }
  };

  const removeScheduledFile = async (message: ScheduledMessage) => {
    if (!message.content?.trim()) return alert('Dosyayı kaldırmadan önce mesaj metni ekleyin.');
    try {
      const response = await api.put(`/messages/schedule/${message.id}`, {
        content: message.content,
        fileKey: null,
        fileType: null,
        fileName: null
      });
      setPendingMessages((previous) => previous.map((item) => item.id === message.id ? response.data.updatedMessage : item));
      fetchSidebarData();
    } catch { alert('Dosya kaldırılamadı.'); }
  };

  const handleDeleteForMe = async (msgId: string) => {
    if (!window.confirm("Bu mesajı kendinizden silmek istediğinize emin misiniz?")) return;
    try { await api.delete(`/messages/${msgId}?forEveryone=false`); } catch { alert("İşlem başarısız."); }
  };

  const handleDeleteForEveryone = async (msgId: string) => {
    if (!window.confirm("Bu mesajı HERKESTEN silmek istediğinize emin misiniz?")) return;
    try { await api.delete(`/messages/${msgId}?forEveryone=true`); } catch { alert("İşlem başarısız."); }
  };

  const formatDetailedDate = (dateString?: string) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getUnixEpoch = (dateString?: string) => dateString ? Math.floor(new Date(dateString).getTime() / 1000) : "-";

  const getDateKey = (dateString?: string) => {
    const date = dateString ? new Date(dateString) : new Date();
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  };

  const getDateSeparatorLabel = (dateString?: string) => {
    const date = dateString ? new Date(dateString) : new Date();
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (getDateKey(date.toISOString()) === getDateKey(today.toISOString())) return 'Bugün';
    if (getDateKey(date.toISOString()) === getDateKey(yesterday.toISOString())) return 'Dün';

    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const getMessagePreview = (message?: Message | null) => {
    if (!message) return '';
    if (message.content?.trim()) return message.content;
    if (message.fileType === 'image' || message.fileType?.startsWith('image')) return '📷 Görsel';
    if (message.fileType === 'audio') return '🎤 Ses kaydı';
    if (message.fileKey) return `📎 ${message.fileName || 'Dosya'}`;
    return '';
  };

  const scrollToMessage = (messageId?: string) => {
    if (!messageId || !messagesListRef.current) return;
    setIsConversationInfoOpen(false);
    const target = messagesListRef.current.querySelector(`[data-message-id="${messageId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => setHighlightedMessageId((current) => current === messageId ? null : current), 1600);
  };

  if (!activeConversation && !selectedUser) {
    return <EmptyChatState panelBg={panelBg} textColor={textColor} iconColor={iconColor} />;
  }

  const displayedMessages = messageSearchTerm.trim() !== ''
    ? messages.filter(m => m.content.toLowerCase().includes(messageSearchTerm.toLowerCase()))
    : messages;

  const conversationOfflineMessages = offlineQueue.filter(m => m.conversationId === activeConversation?.id);
  const combinedMessages = [...displayedMessages, ...conversationOfflineMessages];

  const pinnedMessages = displayedMessages.filter(m => m.isPinned);
  const mediaMessages = mediaPanelData.mediaMessages;
  const linkItems = mediaPanelData.linkItems;
  const conversationSystemEntries = activeConversation?.id
    ? systemTimelineEntries.filter((entry) => entry.conversationId === activeConversation.id)
    : [];
  const timelineItems: TimelineItem[] = [
    ...combinedMessages.map((message) => ({ type: 'message' as const, createdAt: message.createdAt || new Date(0).toISOString(), id: message.id, message })),
    ...conversationSystemEntries.map((entry) => ({ type: 'system' as const, createdAt: entry.createdAt, id: entry.id, entry }))
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const timelineItemsWithDateSeparators = timelineItems.reduce<TimelineRenderItem[]>((items, item) => {
    const dateKey = getDateKey(item.createdAt);
    const previousMessageLikeItem = [...items].reverse().find((existing) => existing.type !== 'date');
    const previousDateKey = previousMessageLikeItem ? getDateKey(previousMessageLikeItem.createdAt) : null;

    if (dateKey !== previousDateKey) {
      items.push({
        type: 'date',
        id: `date-${dateKey}`,
        label: getDateSeparatorLabel(item.createdAt),
        createdAt: item.createdAt
      });
    }

    items.push(item);
    return items;
  }, []);

  const chatPartner = (selectedUser || activeConversation?.otherUser) || undefined;
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
      <div className="chat-area" onPaste={handlePaste} style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, background: chatBg }}>

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
          isPendingModalOpen={isPendingModalOpen}
          setIsPendingModalOpen={setIsPendingModalOpen}
          pendingMessages={pendingMessages}
          isSearchOpen={isSearchOpen}
          setIsSearchOpen={setIsSearchOpen}
          setMessageSearchTerm={setMessageSearchTerm}
          isChatMenuOpen={isChatMenuOpen}
          setIsChatMenuOpen={setIsChatMenuOpen}
          openConversationInfoPanel={openConversationInfoPanel}
          onToggleConversationMute={onToggleConversationMute}
          onToggleConversationPin={onToggleConversationPin}
          onToggleConversationArchive={onToggleConversationArchive}
          handleDisappearingMode={handleDisappearingMode}
          isBlockedLocally={isBlockedLocally}
          handleBlockToggle={handleBlockToggle}
        />
        
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

        {/* BEKLEYEN MESAJLAR LİSTESİ MODALI */}
        {isPendingModalOpen && (
          <div style={{ position: 'absolute', top: '75px', right: '20px', width: '380px', background: inputBg, borderRadius: '16px', boxShadow: '0 12px 40px rgba(0,0,0,0.22)', zIndex: 110, padding: '18px', border: `1px solid ${borderColor}`, backdropFilter: 'blur(12px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: `1px solid ${borderColor}`, paddingBottom: '8px' }}>
              <div>
                <h3 style={{ fontSize: '16px', color: '#f97316', margin: 0, fontWeight: 700 }}>⏳ Zamanlanmış Mesajlar</h3>
                <span style={{ fontSize: '11px', color: iconColor }}>İletilmeyi bekleyen mesajlarınız</span>
              </div>
              <button onClick={() => setIsPendingModalOpen(false)} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', fontSize: '14px', cursor: 'pointer', color: iconColor, width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            {pendingMessages.length === 0 ? (
              <p style={{ fontSize: '13px', color: iconColor, textAlign: 'center', padding: '10px 0' }}>Bekleyen mesaj yok.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto', paddingRight: '4px' }}>
                {pendingMessages.map((pm) => (
                  <div key={pm.id} style={{ background: panelBg, borderLeft: '4px solid #f97316', padding: '12px', borderRadius: '8px', fontSize: '13px', border: `1px solid ${borderColor}`, borderLeftWidth: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 600, color: '#f97316', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        ⏳ {new Date(pm.sendAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div style={{ color: textColor, wordBreak: 'break-word', marginBottom: '10px', fontSize: '13px', lineHeight: '1.4' }}>
                      {pm.fileUrl && (
                        <div style={{ marginBottom: '6px', color: '#f97316', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                          {pm.fileType === 'image' || pm.fileType?.startsWith('image') ? '📷 Görsel Eklentisi' : `📄 ${pm.fileName || 'Dosya Eklentisi'}`}
                        </div>
                      )}
                      {pm.content}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: `1px solid ${borderColor}`, paddingTop: '8px', marginTop: '4px' }}>
                      <button onClick={() => sendNowScheduledMessage(pm.id)} style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: 'rgba(249, 115, 22, 0.1)', color: '#f97316', cursor: 'pointer', fontWeight: 600, fontSize: '11px', transition: 'all 0.2s' }}>⚡ Şimdi Gönder</button>
                      <button onClick={() => openEditScheduledModal(pm)} style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: 'rgba(0, 123, 255, 0.1)', color: '#007bff', cursor: 'pointer', fontWeight: 600, fontSize: '11px', transition: 'all 0.2s' }}>✏️ Düzenle</button>
                      <button onClick={() => replaceScheduledFile(pm.id)} style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: 'rgba(124, 77, 255, 0.1)', color: '#7c4dff', cursor: 'pointer', fontWeight: 600, fontSize: '11px', transition: 'all 0.2s' }}>{pm.fileKey ? '🔄 Dosyayı Değiştir' : '📎 Dosya Ekle'}</button>
                      {pm.fileKey && <button onClick={() => removeScheduledFile(pm)} style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: 'rgba(239, 108, 0, 0.1)', color: '#ef6c00', cursor: 'pointer', fontWeight: 600, fontSize: '11px', transition: 'all 0.2s' }}>🗑️ Kaldır</button>}
                      <button onClick={() => cancelScheduledMessage(pm.id)} style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: 'rgba(229, 57, 53, 0.1)', color: '#e53935', cursor: 'pointer', fontWeight: 600, fontSize: '11px', transition: 'all 0.2s', marginLeft: 'auto' }}>❌ İptal</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ZAMANLANMIŞ MESAJ DÜZENLEME MODALI */}
        {editingScheduled && (
          <div className="settings-overlay" onClick={() => setEditingScheduled(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
            <div style={{ width: '400px', maxWidth: '100%', background: panelBg, borderRadius: '20px', padding: '20px', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', color: textColor, border: `1px solid ${borderColor}` }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#f97316', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Zamanlanmış Mesaj Düzenleme</div>
                  <h3 style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 700 }}>
                    📅 {new Date(editingScheduled.sendAt).toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short' })}
                  </h3>
                </div>
                <button onClick={() => setEditingScheduled(null)} style={{ border: 'none', background: inputBg, color: iconColor, borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
              </div>

              {editingScheduled.fileKey && (
                <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '12px', background: inputBg, border: `1px solid ${borderColor}`, fontSize: '13px', color: iconColor, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{editingScheduled.fileType === 'image' || editingScheduled.fileType?.startsWith('image') ? '📷 Görsel Eklentisi' : `📄 ${editingScheduled.fileName || 'Dosya Eklentisi'}`}</span>
                </div>
              )}

              <textarea
                value={editScheduledText}
                onChange={(e) => setEditScheduledText(e.target.value)}
                autoFocus
                style={{ width: '100%', minHeight: '120px', padding: '14px', borderRadius: '14px', border: `1px solid ${borderColor}`, background: inputBg, color: textColor, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontSize: '14px', lineHeight: '1.5' }}
                placeholder="Mesaj metni..."
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <Button variant="outline" text="Vazgeç" onClick={() => setEditingScheduled(null)} style={{ background: 'transparent', color: iconColor, border: `1px solid ${borderColor}` }} />
                <Button text="Kaydet" onClick={handleSaveScheduledEdit} />
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
              {activeConversation?.isGroup && (
                <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 25px 0' }}>
                  <div style={{ background: isDarkMode ? '#182229' : '#fff5c4', color: isDarkMode ? '#8696a0' : '#54656f', padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', maxWidth: '85%' }}>
                    <span style={{ fontSize: '14px', marginRight: '5px' }}>🔒</span>
                    <strong>Mesajlar güvenli bağlantı üzerinden iletilir.</strong><br />
                    <span style={{ marginTop: '5px', display: 'inline-block' }}>{activeConversation.adminId === currentUser.id ? `Siz "${activeConversation.name}" grubunu oluşturdunuz.` : `Grup yöneticisi sizi "${activeConversation.name}" grubuna ekledi.`}</span>
                  </div>
                </div>
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
                  highlightedMessageId={highlightedMessageId}
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
                "{messageInfo.content}"
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

        {/* DÜZENLEME MODALI */}
        {editingMessage && (
          <div className="settings-overlay" onClick={() => setEditingMessage(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div style={{ width: '380px', maxWidth: '100%', background: panelBg, borderRadius: '16px', padding: '18px', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', color: textColor, border: `1px solid ${borderColor}` }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#f97316', fontWeight: 700 }}>Mesaj düzenleme</div>
                  <h3 style={{ margin: '2px 0 0', fontSize: '18px' }}>Gönderilmiş mesaj</h3>
                </div>
                <button onClick={() => setEditingMessage(null)} style={{ border: 'none', background: inputBg, color: iconColor, borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
              </div>

              {editingMessage.fileKey && (
                <div style={{ marginBottom: '12px', padding: '10px', borderRadius: '12px', background: inputBg, border: `1px solid ${borderColor}`, fontSize: '13px', color: iconColor }}>
                  {editingMessage.fileType === 'image' || editingMessage.fileType?.startsWith('image') ? '📷 Görsel eklentisi' : `📎 ${editingMessage.fileName || 'Dosya eklentisi'}`}
                </div>
              )}

              <textarea
                value={editMessageText}
                onChange={(e) => setEditMessageText(e.target.value)}
                autoFocus
                style={{ width: '100%', minHeight: '110px', padding: '12px', borderRadius: '12px', border: `1px solid ${borderColor}`, background: inputBg, color: textColor, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontSize: '14px' }}
                placeholder="Mesaj metni..."
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                <Button variant="outline" text="Vazgeç" onClick={() => setEditingMessage(null)} style={{ background: 'transparent', color: iconColor, border: `1px solid ${borderColor}` }} />
                <Button text="Kaydet" onClick={handleSaveMessageEdit} />
              </div>
            </div>
          </div>
        )}

        {/* ALT KISIM: YAZMA VE ARAÇLAR ALANI */}
        <ChatInput
          isBlockedLocally={isBlockedLocally}
          chatPartner={chatPartner}
          isDarkMode={isDarkMode}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          replyingTo={replyingTo}
          setReplyingTo={setReplyingTo}
          isScheduling={isScheduling}
          setIsScheduling={setIsScheduling}
          scheduleTime={scheduleTime}
          setScheduleTime={setScheduleTime}
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
          scheduledFileInputRef={scheduledFileInputRef}
          handleScheduledFileChange={handleScheduledFileChange}
          newMessage={newMessage}
          setNewMessage={setNewMessage}
          onTyping={onTyping}
          handleSend={handleSend}
          handleBlockToggle={handleBlockToggle}
          panelBg={panelBg}
          inputBg={inputBg}
          borderColor={borderColor}
          textColor={textColor}
          iconColor={iconColor}
          toggleVoiceRecording={toggleVoiceRecordingWrapper}
        />

        <style>{`
          .msg-dropdown-btn { width: 100%; text-align: left; padding: 12px 15px; border: none; background: transparent; color: ${textColor}; font-size: 14px; cursor: pointer; transition: background 0.2s; }
          .msg-dropdown-btn:hover { background: ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}; }
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
        pendingMessages={pendingMessages}
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
