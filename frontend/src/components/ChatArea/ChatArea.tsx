import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../api/httpClient';
import type { User, Conversation, Message } from '../../types/chat';
import Button from '../UI/Button';
import './ChatArea.css';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { tr } from 'date-fns/locale';
import EmojiPicker, { Theme, EmojiStyle, type EmojiClickData, SuggestionMode } from 'emoji-picker-react';
import { useFileAttachment } from '../../hooks/useFileAttachment';

interface ChatAreaProps {
  currentUser: User;
  activeConversation: Conversation | null;
  selectedUser: User | null;
  messages: Message[];
  newMessage: string;
  setNewMessage: (val: string) => void;
  mesajGonder: (replyToId?: string) => void;
  messagesEndRef: any;
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

export default function ChatArea({
  currentUser, activeConversation, selectedUser, messages, newMessage,
  setNewMessage, mesajGonder, messagesEndRef, openGroupSettings, closeChat, isDarkMode,
  usersList, groupMembers, loadMoreMessages, hasMore, isLoadingMore, typingUsername, recordingUsername, onTyping, onVoiceRecording,
  onToggleConversationPin, onToggleConversationArchive, onToggleConversationMute, onSetDisappearingMode,
  onStartCall, socketConnectionStatus
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
  const [openOptionsId, setOpenOptionsId] = useState<string | null>(null);
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const [isDisappearingSettingsOpen, setIsDisappearingSettingsOpen] = useState(false);
  const [systemTimelineEntries, setSystemTimelineEntries] = useState<SystemTimelineEntry[]>([]);

  // MESAJ İŞLEM DURUMLARI (BİLGİ, YANITLA, İLET)
  const [messageInfo, setMessageInfo] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardMessages, setForwardMessages] = useState<Message[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteMenuOpen, setIsBulkDeleteMenuOpen] = useState(false);
  const [pinnedIndex, setPinnedIndex] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editMessageText, setEditMessageText] = useState('');

  // ZAMANLAMA VE BEKLEYEN MESAJ DURUMLARI
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleTime, setScheduleTime] = useState<Date | null>(null);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<any[]>([]);

  // Zamanlanmış mesaj düzenleme
  const [editingScheduled, setEditingScheduled] = useState<any>(null);
  const [editScheduledText, setEditScheduledText] = useState('');
  const [isBlockedLocally, setIsBlockedLocally] = useState(false);

  // UX ENHANCEMENTS: CHAT LOADING SKELETON & IMAGE LIGHTBOX
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  
  // OFFLINE MODE: GEÇİCİ MESAJ KUYRUĞU
  const [offlineQueue, setOfflineQueue] = useState<Message[]>([]);

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
  }, [socketConnectionStatus]);
  useEffect(() => {
    const partner = selectedUser || activeConversation?.otherUser;
    setIsBlockedLocally(!!partner?.isBlocked);
  }, [selectedUser, activeConversation]);

  // DOSYA YÜKLEME DURUMLARI
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const {
    fileAccept, fileInputRef, filePreview, selectedFile,
    cancelFile, handleFileUpload, handlePaste, openFilePicker
  } = useFileAttachment();
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledFileInputRef = useRef<HTMLInputElement>(null);
  const [scheduledFileTarget, setScheduledFileTarget] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedAudioChunksRef = useRef<Blob[]>([]);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);

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
  }, [activeConversation?.id, cancelFile]);

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
      fetchSidebarData(); // Anlık güncelleme
    } catch { alert("İptal işlemi başarısız."); }
  };

  const sendNowScheduledMessage = async (id: string) => {
    try {
      await api.post(`/messages/schedule/send-now/${id}`);
      setPendingMessages(prev => prev.filter(m => m.id !== id));
      fetchSidebarData(); // Anlık güncelleme
    } catch { alert("Mesaj anında gönderilemedi."); }
  };

  const openEditScheduledModal = (pm: any) => {
    setEditingScheduled(pm);
    setEditScheduledText(pm.content || '');
  };

  const handleSaveScheduledEdit = async () => {
    if (!editingScheduled) return;
    try {
      await api.put(`/messages/schedule/${editingScheduled.id}`, { content: editScheduledText });
      setPendingMessages(prev => prev.map(m => m.id === editingScheduled.id ? { ...m, content: editScheduledText } : m));
      setEditingScheduled(null);
      fetchSidebarData(); // Anlık güncelleme
    } catch { alert("Mesaj güncellenemedi."); }
  };

  const filterPassedTime = (time: Date) => new Date().getTime() < new Date(time).getTime();

  useEffect(() => () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);


  const handleSend = async () => {
    if (!newMessage.trim() && !selectedFile) return;
    onTyping(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

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
      setNewMessage('');
      setReplyingTo(null);
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

        setIsScheduling(false);
        setScheduleTime(null);
        setNewMessage('');
        cancelFile();
        fetchSidebarData(); // ANLIK GÜNCELLEME EKLENDİ
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

          setNewMessage('');
          cancelFile();
          setReplyingTo(null);
        } catch {
          alert("Dosya yüklenirken hata oluştu.");
        } finally {
          setIsUploading(false);
          setUploadProgress(0);
        }
      }
      else {
        mesajGonder(replyingTo?.id);
        setReplyingTo(null);
      }
    }
  };

  const handleReply = (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (msg) setReplyingTo(msg);
    setOpenOptionsId(null);
  };

  const handleForward = (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (msg) setForwardMessages([msg]);
    setOpenOptionsId(null);
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

  const handleCopyText = (text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => {})
      .catch(() => { alert("Kopyalanamadı."); });
    setOpenOptionsId(null);
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

  // YILDIZLAMA İŞLEMİ ANINDA YAN PANELİ GÜNCELLEYECEK
  const handleStar = async (msgId: string) => {
    try {
      await api.put(`/messages/${msgId}/star`);
      fetchSidebarData(); // Anlık güncelleme eklendi
    } catch { alert("İşlem başarısız."); }
    setOpenOptionsId(null);
  };

  const handlePin = async (msgId: string) => {
    try { await api.put(`/messages/${msgId}/pin`); } catch { alert("İşlem başarısız."); }
    setOpenOptionsId(null);
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

  // GRUPLAR İÇİN DE ARTIK YAN PANEL AÇILACAK!
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

  const uploadVoiceMessage = async (audioBlob: Blob) => {
    if (!activeConversation?.id || audioBlob.size === 0) return;
    setIsUploading(true);
    try {
      const file = new File([audioBlob], `voice-${Date.now()}.webm`, { type: audioBlob.type || 'audio/webm' });
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await api.post('/upload', formData, uploadConfig);

      await api.post('/messages', {
        conversationId: activeConversation.id,
        clientId: crypto.randomUUID(),
        content: '',
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

  const toggleVoiceRecording = async () => {
    if (isRecordingAudio) {
      mediaRecorderRef.current?.stop();
      setIsRecordingAudio(false);
      onVoiceRecording(false);
      return;
    }

    if (!activeConversation?.id) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Tarayıcınız ses kaydını desteklemiyor.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedAudioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedAudioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(recordedAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        recordedAudioChunksRef.current = [];
        void uploadVoiceMessage(audioBlob);
      };

      recorder.start();
      setIsRecordingAudio(true);
      onVoiceRecording(true);
    } catch {
      alert('Mikrofon izni alınamadı.');
    }
  };

  const handleEditMessage = async (message: Message) => {
    setEditingMessage(message);
    setEditMessageText(message.content || '');
    setOpenOptionsId(null);
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
      setEditingScheduled((previous: any) => previous?.id === target.id ? response.data.updatedMessage : previous);
      fetchSidebarData(); // Anlık güncelleme
    } catch { alert('Zamanlanmış dosya değiştirilemedi.'); }
    finally {
      setIsUploading(false);
      setUploadProgress(0);
      setScheduledFileTarget(null);
      event.target.value = '';
    }
  };

  const removeScheduledFile = async (message: any) => {
    if (!message.content?.trim()) return alert('Dosyayı kaldırmadan önce mesaj metni ekleyin.');
    try {
      const response = await api.put(`/messages/schedule/${message.id}`, {
        content: message.content,
        fileKey: null,
        fileType: null,
        fileName: null
      });
      setPendingMessages((previous) => previous.map((item) => item.id === message.id ? response.data.updatedMessage : item));
      fetchSidebarData(); // Anlık güncelleme
    } catch { alert('Dosya kaldırılamadı.'); }
  };

  const handleDeleteForMe = async (msgId: string) => {
    if (!window.confirm("Bu mesajı kendinizden silmek istediğinize emin misiniz?")) return;
    try { await api.delete(`/messages/${msgId}?forEveryone=false`); } catch { alert("İşlem başarısız."); }
    setOpenOptionsId(null);
  };

  const handleDeleteForEveryone = async (msgId: string) => {
    if (!window.confirm("Bu mesajı HERKESTEN silmek istediğinize emin misiniz?")) return;
    try { await api.delete(`/messages/${msgId}?forEveryone=true`); } catch { alert("İşlem başarısız."); }
    setOpenOptionsId(null);
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

  const renderLinkedText = (content: string) => {
    const parts = content.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, index) => /^https?:\/\/[^\s]+$/.test(part)
      ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#027eb5', textDecoration: 'underline' }}>{part}</a>
      : <span key={`${part}-${index}`}>{part}</span>);
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
    return (
      <div className="chat-area empty-chat-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, backgroundColor: panelBg }}>
        <div className="welcome-logo-container" style={{ marginBottom: '28px', opacity: 0.85 }}>
          <svg className="brand-logo-svg" viewBox="0 0 100 100" width="300" height="300" style={{ display: 'block', margin: '0 auto' }}>
            <defs>
              <filter id="lightning-fractal-welcome" x="-30%" y="-30%" width="160%" height="160%">
                <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="4" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </defs>

            {/* Multiple cascading lightning bolts deformed by the fractal noise */}
            <g filter="url(#lightning-fractal-welcome)" strokeLinecap="round" strokeLinejoin="round">
              <path className="old-lightning-hair" d="M26 35 L18 52 L28 68 L16 88" fill="none" strokeWidth="2.2" />
              <path className="old-lightning-hair" d="M42 35 L38 52 L48 68 L36 88" fill="none" strokeWidth="2.2" />
              <path className="old-lightning-hair" d="M58 35 L62 52 L54 68 L64 88" fill="none" strokeWidth="2.2" />
              <path className="old-lightning-hair" d="M74 35 L82 52 L72 68 L80 88" fill="none" strokeWidth="2.2" />
            </g>

            {/* Cloud shape with a WhatsApp-style message bubble tail (flashes on strike) */}
            <path className="brand-cloud" d="M20 32 C 20 20, 35 15, 50 20 C 65 15, 80 20, 80 32 C 92 32, 95 42, 85 49 C 75 53, 35 53, 28 52 L 12 65 C 12 65, 18 57, 18 49 C 5 42, 8 32, 20 32 Z" />

            {/* Smiling face elements inside/emerging from the cloud */}
            <circle className="discord-face-element" cx="38" cy="30" r="3" fill="#ffffff" />
            <circle className="discord-face-element" cx="62" cy="30" r="3" fill="#ffffff" />
            <path className="discord-face-element" d="M42 37 Q50 43 58 37" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="empty-chat-box" style={{ color: textColor, fontWeight: 300 }}>Mesajlaşmaya Başla</h2>
        <p style={{ color: iconColor, marginTop: '10px' }}>Sohbet etmek için sol taraftan bir kişi veya grup seçin.</p>
      </div>
    );
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

  const chatPartner = selectedUser || activeConversation?.otherUser;
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
    // DIŞ KAPSAYICI (RELATIVE). Sağ panel position absolute ile bunun üzerine gelecek.
    <div className="chat-area-wrapper" style={{ position: 'relative', display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>

      {/* SOL TARAF: ANA SOHBET ALANI */}
      <div className="chat-area" onPaste={handlePaste} style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, background: chatBg }}>

        {/* ÜST BAR (HEADER) */}
        <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', background: panelBg, borderBottom: `1px solid ${borderColor}`, height: '71px', boxSizing: 'border-box' }}>
          {isSelectMode ? (
            <div className="chat-title-info" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 auto' }}>
              <button onClick={() => { setIsSelectMode(false); setSelectedMessageIds(new Set()); }} aria-label="Seçimi kapat" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: iconColor }}>✖</button>
              <h2 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: '600' }}>
                {selectedMessageIds.size} mesaj seçildi
              </h2>
            </div>
          ) : (
            <div className="chat-title-info" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 auto' }}>
              <button className="mobile-back-btn" onClick={closeChat} aria-label="Sohbeti kapat" style={{ fontSize: '20px', color: iconColor }}>←</button>
              <button className="avatar-circle" onClick={handleHeaderClick} title={activeConversation?.isGroup ? 'Grup bilgisi' : 'Sohbet bilgisi'} aria-label={activeConversation?.isGroup ? 'Grup bilgisi' : 'Sohbet bilgisi'}>
                {activeConversation?.isGroup && activeConversation?.avatarUrl
                  ? <img src={activeConversation?.avatarUrl || undefined} alt="Grup" />
                  : !activeConversation?.isGroup && chatPartner?.avatarUrl
                    ? <img src={chatPartner?.avatarUrl || undefined} alt="Profil" />
                    : (activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username)?.[0]?.toUpperCase()}
              </button>
              <button onClick={handleHeaderClick} title={activeConversation?.isGroup ? 'Grup bilgisi' : 'Sohbet bilgisi'} aria-label={activeConversation?.isGroup ? 'Grup detayları' : 'Sohbet detayları'} style={{ minWidth: 0, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
                <h2 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username}
                </h2>
                {!activeConversation?.isGroup && partnerStatus && !(chatPartner?.isBlocked || chatPartner?.blockedByOther) && (
                  <div style={{ marginTop: '2px', fontSize: '11px', color: typingUsername || recordingUsername || chatPartner?.isOnline ? '#f97316' : iconColor, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {(typingUsername || recordingUsername) && <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>}
                    <span>{partnerStatus}</span>
                  </div>
                )}
              </button>
            </div>
          )}
          
          {isSelectMode ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, position: 'relative' }}>
              <Button variant="icon" onClick={() => {
                const selectedMsgs = messages.filter(m => selectedMessageIds.has(m.id));
                setForwardMessages(selectedMsgs);
              }} disabled={selectedMessageIds.size === 0} title="Seçilenleri İlet" aria-label="Seçilenleri ilet" style={{ color: iconColor }} icon={
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm1 14v-3h-4v-2h4V8l5 4-5 4z"></path></svg>
              } />
              <Button variant="icon" onClick={handleBulkStar} disabled={selectedMessageIds.size === 0} title="Seçilenleri Yıldızla" aria-label="Seçilenleri yıldızla" style={{ color: iconColor }} icon={
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>
              } />
              
              <div style={{ position: 'relative' }}>
                <Button variant="icon" onClick={() => setIsBulkDeleteMenuOpen(!isBulkDeleteMenuOpen)} disabled={selectedMessageIds.size === 0} title="Seçilenleri Sil" aria-label="Seçilenleri sil" style={{ color: iconColor }} icon={
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>
                } />
                {isBulkDeleteMenuOpen && (
                  <>
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} onClick={() => setIsBulkDeleteMenuOpen(false)}></div>
                    <div className="dropdown-menu" style={{ top: '35px', right: '0', width: '150px' }}>
                      <button className="msg-dropdown-btn" onClick={handleBulkDeleteForMe}>🗑️ Benden Sil</button>
                      <button className="msg-dropdown-btn danger-text" onClick={handleBulkDeleteForEveryone}>⛔ Herkesten Sil</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
              <Button variant="icon" onClick={() => onStartCall('audio')} disabled={!activeConversation?.id} title="Sesli Ara" aria-label="Sesli arama yap" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02z"></path></svg>} />
              <Button variant="icon" onClick={() => onStartCall('video')} disabled={!activeConversation?.id} title="Görüntülü Ara" aria-label="Görüntülü arama yap" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M17 10.5V6c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-4.5l4 4v-11z"></path></svg>} />
              <Button variant="icon" onClick={() => setIsPendingModalOpen(!isPendingModalOpen)} title="Bekleyen Mesajlar" aria-label="Bekleyen zamanlanmış mesajlar" style={{ color: iconColor, position: 'relative' }} icon={<><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"></path></svg>{pendingMessages.length > 0 && (<span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#e53935', color: 'white', fontSize: '10px', fontWeight: 'bold', width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${panelBg}` }}>{pendingMessages.length}</span>)}</>} />
              <Button variant="icon" onClick={() => { setIsSearchOpen(!isSearchOpen); setMessageSearchTerm(''); }} title="Mesajlarda Ara" aria-label="Mesajlarda ara" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 0 0 1.256-3.386 5.207 5.207 0 1 0-5.207 5.208 5.183 5.183 0 0 0 3.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.8 0a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"></path></svg>} />
              <div style={{ position: 'relative' }}>
                <Button variant="icon" onClick={() => setIsChatMenuOpen((previous) => !previous)} title="Sohbet seçenekleri" aria-label="Sohbet seçeneklerini aç" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"></path></svg>} />
                {isChatMenuOpen && activeConversation?.id && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setIsChatMenuOpen(false)} />
                    <div className="dropdown-menu" style={{ right: 0, top: '42px', width: '245px', color: textColor }}>
                      <button className="msg-dropdown-btn" onClick={() => openConversationInfoPanel('media')}>🖼️ Medya, dosyalar ve linkler</button>
                      <button className="msg-dropdown-btn" onClick={() => openConversationInfoPanel('starred')}>⭐ Yıldızlı mesajlar</button>
                      <button className="msg-dropdown-btn" onClick={() => { onToggleConversationMute(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isMuted ? '🔔 Sesi aç' : '🔕 Sessize al'}</button>
                      <button className="msg-dropdown-btn" onClick={() => { onToggleConversationPin(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isPinned ? '📌 Sabitlemeyi kaldır' : '📌 Sohbeti sabitle'}</button>
                      <button className="msg-dropdown-btn" onClick={() => { onToggleConversationArchive(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isArchived ? '🗄️ Arşivden çıkar' : '🗄️ Arşivle'}</button>
                      <button className="msg-dropdown-btn" onClick={handleDisappearingMode}>⏳ Kaybolan mesaj modu</button>
                      {!activeConversation.isGroup && (
                        <button className="msg-dropdown-btn danger-text" onClick={() => { handleBlockToggle(); setIsChatMenuOpen(false); }}>
                          {isBlockedLocally ? '✅ Engeli Kaldır' : '🚫 Kişiyi Engelle'}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        
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
          <div style={{ position: 'absolute', top: '75px', right: '20px', width: '320px', background: inputBg, borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 10, padding: '15px', border: `1px solid ${borderColor}` }}>
            <h3 style={{ fontSize: '15px', color: '#f97316', margin: '0 0 10px 0', borderBottom: `1px solid ${borderColor}`, paddingBottom: '8px' }}>Zamanlanmış Mesajlar</h3>
            {pendingMessages.length === 0 ? (
              <p style={{ fontSize: '13px', color: iconColor, textAlign: 'center' }}>Bekleyen mesaj yok.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                {pendingMessages.map((pm) => (
                  <div key={pm.id} style={{ background: panelBg, padding: '10px', borderRadius: '8px', fontSize: '13px' }}>
                    <div style={{ color: iconColor, marginBottom: '6px', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Zaman: {new Date(pm.sendAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button onClick={() => sendNowScheduledMessage(pm.id)} style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>Şimdi</button>
                        <button onClick={() => openEditScheduledModal(pm)} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>Düzenle</button>
                        <button onClick={() => replaceScheduledFile(pm.id)} style={{ background: 'none', border: 'none', color: '#7c4dff', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>{pm.fileKey ? 'Dosyayı Değiştir' : 'Dosya Ekle'}</button>
                        {pm.fileKey && <button onClick={() => removeScheduledFile(pm)} style={{ background: 'none', border: 'none', color: '#ef6c00', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>Dosyayı Kaldır</button>}
                        <button onClick={() => cancelScheduledMessage(pm.id)} style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>İptal</button>
                      </div>
                    </div>
                    <div style={{ color: textColor, wordBreak: 'break-word' }}>
                      {pm.fileUrl && (
                        <div style={{ marginBottom: '5px', color: '#f97316', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          📎 {pm.fileType === 'image' ? 'Görsel Eklendi' : 'Dosya Eklendi'}
                        </div>
                      )}
                      {pm.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ZAMANLANMIŞ MESAJ DÜZENLEME MODALI */}
        {editingScheduled && (
          <div className="settings-overlay" onClick={() => setEditingScheduled(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div style={{ width: '380px', maxWidth: '100%', background: panelBg, borderRadius: '16px', padding: '18px', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', color: textColor, border: `1px solid ${borderColor}` }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#f97316', fontWeight: 700 }}>Zamanlanmış mesaj düzenleme</div>
                  <h3 style={{ margin: '2px 0 0', fontSize: '18px' }}>
                    {new Date(editingScheduled.sendAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                  </h3>
                </div>
                <button onClick={() => setEditingScheduled(null)} style={{ border: 'none', background: inputBg, color: iconColor, borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>✕</button>
              </div>

              {editingScheduled.fileKey && (
                <div style={{ marginBottom: '12px', padding: '10px', borderRadius: '12px', background: inputBg, border: `1px solid ${borderColor}`, fontSize: '13px', color: iconColor }}>
                  {editingScheduled.fileType === 'image' || editingScheduled.fileType?.startsWith('image') ? '📷 Görsel eklentisi' : `📎 ${editingScheduled.fileName || 'Dosya eklentisi'}`}
                </div>
              )}

              <textarea
                value={editScheduledText}
                onChange={(e) => setEditScheduledText(e.target.value)}
                autoFocus
                style={{ width: '100%', minHeight: '110px', padding: '12px', borderRadius: '12px', border: `1px solid ${borderColor}`, background: inputBg, color: textColor, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontSize: '14px' }}
                placeholder="Mesaj metni..."
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                <Button text="Vazgeç" onClick={() => setEditingScheduled(null)} style={{ background: 'transparent', color: iconColor, border: `1px solid ${borderColor}` }} />
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

          {timelineItemsWithDateSeparators.map((item, index) => {
            if (item.type === 'date') {
              return (
                <div key={item.id} className="date-separator-row">
                  <span className="date-separator-pill">{item.label}</span>
                </div>
              );
            }

            if (item.type === 'system') {
              return (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
                  <div style={{ background: isDisappearingMode ? (isDarkMode ? '#113d34' : '#d9f5eb') : panelBg, color: isDisappearingMode ? '#f97316' : iconColor, border: `1px solid ${isDisappearingMode ? 'rgba(249, 115, 22,0.35)' : borderColor}`, padding: '8px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                    ⏳ {item.entry.text}
                  </div>
                </div>
              );
            }

            const msg = item.message;
            const isMe = msg.senderId === currentUser.id;

            let showBlueTick = false; // Mavi renk yanacak mı?
            let actuallyRead = false; // İkinci gri tik için fiziksel okunma durumu

            if (activeConversation?.isGroup) {
              const otherMembersCount = groupMembers.length > 0 ? groupMembers.length - 1 : 999;
              actuallyRead = (msg.readByIds?.length || 0) >= otherMembersCount && otherMembersCount > 0;
              showBlueTick = actuallyRead; // Gruplarda mavi tik gizliliği es geçilir
            } else {
              actuallyRead = !!(msg.readByIds && msg.readByIds.length > 0);
              const myReceiptsEnabled = currentUser.readReceiptsOn !== false;
              const theirReceiptsEnabled = selectedUser?.readReceiptsOn !== false;

              showBlueTick = actuallyRead && myReceiptsEnabled && theirReceiptsEnabled;
            }

            const timeString = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const isNearBottom = index >= timelineItemsWithDateSeparators.length - 5 && timelineItemsWithDateSeparators.length > 5;

            const isDeletedForEveryone = msg.content === "🚫 Bu mesaj silindi";

            return (
              <div key={msg.id} data-message-id={msg.id} className={`message-row ${isMe ? 'me' : 'them'} ${highlightedMessageId === msg.id ? 'highlight-message' : ''}`}>
                {isSelectMode && (
                  <input
                    type="checkbox"
                    checked={selectedMessageIds.has(msg.id)}
                    onChange={() => toggleSelectMessage(msg.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      alignSelf: 'center',
                      width: '18px',
                      height: '18px',
                      cursor: 'pointer',
                      accentColor: '#f97316',
                      marginRight: isMe ? '12px' : '0',
                      marginLeft: isMe ? '0' : '12px',
                      flexShrink: 0
                    }}
                  />
                )}

                {isDeletedForEveryone ? (
                  <div
                    className="message-bubble"
                    style={{ boxShadow: 'none', color: iconColor, fontStyle: 'italic', userSelect: 'none', pointerEvents: 'none', minWidth: '110px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', wordBreak: 'break-word', paddingBottom: '4px' }}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" opacity="0.6" style={{ flexShrink: 0 }}>
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm4.207 12.793-1.414 1.414L12 13.414l-2.793 2.793-1.414-1.414L10.586 12 7.793 9.207l1.414-1.414L12 10.586l2.793-2.793 1.414 1.414L13.414 12l2.793 2.793z"></path>
                      </svg>
                      <span>{isMe ? "Bu mesajı herkesten sildiniz" : "Bu mesaj silindi"}</span>
                    </div>
                    <div className="message-meta" style={{ opacity: 0.7 }}><span>{timeString}</span></div>
                  </div>
                ) : (
                  <div 
                    className="message-bubble" 
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('audio') || target.closest('a') || target.closest('button') || target.closest('input')) {
                        return;
                      }
                      e.stopPropagation();
                      if (isSelectMode) {
                        toggleSelectMessage(msg.id);
                      }
                    }}
                    onContextMenu={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('audio') || target.closest('a') || target.closest('button') || target.closest('input')) {
                        return;
                      }
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isSelectMode) {
                        setOpenOptionsId(openOptionsId === msg.id ? null : msg.id);
                      }
                    }}
                    style={{ 
                      position: 'relative', 
                      minWidth: '110px', 
                      paddingRight: '30px', 
                      cursor: 'pointer',
                      opacity: msg.isOffline ? 0.65 : 1,
                      ...(msg.isPinned ? { borderLeft: '4px solid #f97316' } : {}) 
                    }}
                  >
                    {!isMe && activeConversation?.isGroup && (
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#f97316', marginBottom: '4px' }}>{msg.sender?.username}</div>
                    )}

                    {msg.replyTo && (
                      <div onClick={() => { /* İstersen buraya tıklandığında mesaja gitme mantığı eklenebilir */ }} style={{ background: isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)', padding: '6px 10px', borderRadius: '5px', marginBottom: '6px', borderLeft: '4px solid #f97316', fontSize: '12px', cursor: 'pointer' }}>
                        <strong style={{ color: '#f97316', display: 'block', marginBottom: '2px' }}>{msg.replyTo.sender?.username}</strong>
                        <div style={{ opacity: 0.8, color: textColor, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{msg.replyTo.content}</div>
                      </div>
                    )}

                    {msg.fileUrl && (
                      <div style={{ marginBottom: msg.content ? '8px' : '0' }}>
                        {(msg.fileType === 'image' || msg.fileType?.startsWith('image')) && (
                          <img
                            src={msg.fileUrl || undefined}
                            alt="Görsel"
                            style={{ maxWidth: '100%', maxHeight: '250px', borderRadius: '8px', cursor: 'pointer', objectFit: 'contain' }}
                            onClick={() => msg.fileUrl && setLightboxImageUrl(msg.fileUrl)}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              e.currentTarget.parentElement?.insertAdjacentHTML('beforeend', '<span style="font-size:12px; color:#aebac1;">⏳ Görselin süresi dolmuş</span>');
                            }}
                          />
                        )}

                        {msg.fileType === 'audio' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', minWidth: '230px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: '#f97316' }}>
                              <span>🎤</span>
                              <span>Ses kaydı</span>
                            </div>
                            <audio controls src={msg.fileUrl || undefined} style={{ width: '230px', height: '40px', outline: 'none' }} />
                          </div>
                        )}

                        {(msg.fileType === 'document' || (!msg.fileType?.startsWith('image') && msg.fileType !== 'audio')) && (
                          <a
                            href={msg.fileUrl || undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', background: isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)', padding: '10px', borderRadius: '8px', textDecoration: 'none', color: textColor }}
                          >
                            <span style={{ fontSize: '24px' }}>📄</span>
                            <span style={{ fontSize: '13px', wordBreak: 'break-all' }}>{msg.fileName || "Bilinmeyen Dosya"}</span>
                          </a>
                        )}
                      </div>
                    )}

                    {msg.content && <div style={{ wordBreak: 'break-word' }}>{renderLinkedText(msg.content)}</div>}

                    <div className="message-meta">
                      {msg.starredByIds?.includes(currentUser.id) && <span style={{ color: '#fbc02d', fontSize: '12px' }}>⭐</span>}
                      {msg.editedAt && <span>düzenlendi</span>}
                      <span>{timeString}</span>
                      {isMe && (
                        <span className={`message-ticks ${showBlueTick ? 'read' : ''}`} style={msg.isOffline ? { fontSize: '11px', opacity: 0.8 } : {}}>
                          {msg.isOffline ? '⏳' : actuallyRead ? '✓✓' : '✓'}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenOptionsId(openOptionsId === msg.id ? null : msg.id); }}
                      style={{ position: 'absolute', top: '5px', right: '5px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: '2px 5px' }}
                    >
                      <svg viewBox="0 0 18 18" width="16" height="16" fill="currentColor"><path d="M3.3 5.4h11.4L9 12.6z"></path></svg>
                    </button>

                    {openOptionsId === msg.id && (
                      <>
                        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={(e) => { e.stopPropagation(); setOpenOptionsId(null); }}></div>

                        <div style={{
                          position: 'absolute',
                          ...(isNearBottom ? { bottom: '25px' } : { top: '25px' }),
                          ...(isMe ? { right: '10px' } : { left: '10px' }),
                          background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px',
                          zIndex: 100, boxShadow: '0 4px 15px rgba(0,0,0,0.2)', width: '170px', overflow: 'hidden',
                          display: 'flex', flexDirection: 'column'
                        }}>
                          <button className="msg-dropdown-btn" onClick={() => { setMessageInfo(msg); setOpenOptionsId(null); }}>ℹ️ Bilgi</button>
                          <button className="msg-dropdown-btn" onClick={() => { handleReply(msg.id); setOpenOptionsId(null); }}>↩️ Yanıtla</button>
                          {msg.content && <button className="msg-dropdown-btn" onClick={() => handleCopyText(msg.content)}>📋 Kopyala</button>}
                          <button className="msg-dropdown-btn" onClick={() => {
                            setIsSelectMode(true);
                            setSelectedMessageIds(new Set([msg.id]));
                            setOpenOptionsId(null);
                          }}>☑️ Seç</button>
                          {isMe && <button className="msg-dropdown-btn" onClick={() => handleEditMessage(msg)}>✏️ Düzenle</button>}
                          <button className="msg-dropdown-btn" onClick={() => { handleForward(msg.id); setOpenOptionsId(null); }}>➡️ İlet</button>
                          <button className="msg-dropdown-btn" onClick={() => handleStar(msg.id)}>
                            {msg.starredByIds?.includes(currentUser.id) ? '⭐ Yıldızı Kaldır' : '⭐ Yıldızla'}
                          </button>
                          <button className="msg-dropdown-btn" onClick={() => handlePin(msg.id)}>
                            {msg.isPinned ? '📌 Sabitlemeyi Kaldır' : '📌 Sabitle'}
                          </button>
                          <button className="msg-dropdown-btn" onClick={() => handleDeleteForMe(msg.id)}>🗑️ Benden Sil</button>
                          {isMe && <button className="msg-dropdown-btn danger-text" onClick={() => handleDeleteForEveryone(msg.id)}>⛔ Herkesten Sil</button>}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
                        const u = usersList.find(user => user.id === id);
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
                <Button text="Vazgeç" onClick={() => setEditingMessage(null)} style={{ background: 'transparent', color: iconColor, border: `1px solid ${borderColor}` }} />
                <Button text="Kaydet" onClick={handleSaveMessageEdit} />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* ALT KISIM: YAZMA VE ARAÇLAR ALANI */}
        {/* ========================================================= */}
        {isBlockedLocally ? (
          <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 15px', background: isDarkMode ? '#2c1a1a' : '#ffebee', borderRadius: '12px', border: `1px solid ${isDarkMode ? '#5c2222' : '#ffcdd2'}`, color: isDarkMode ? '#ff8a80' : '#c62828', fontSize: '14px', fontWeight: 600 }}>
              <span>🚫 Bu kullanıcıyı engellediniz.</span>
              <button 
                onClick={handleBlockToggle} 
                style={{ background: '#e53935', color: 'white', border: 'none', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', flexShrink: 0 }}
              >
                Engeli Kaldır
              </button>
            </div>
          </div>
        ) : chatPartner?.blockedByOther ? (
          <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '10px 15px', background: isDarkMode ? '#222' : '#f5f5f5', borderRadius: '12px', border: `1px solid ${borderColor}`, color: iconColor, fontSize: '14px', fontWeight: 600 }}>
              <span>🚫 Bu kullanıcıya mesaj gönderemezsiniz.</span>
            </div>
          </div>
        ) : (
          <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative' }}>
          {isUploading && (
            <div className="upload-progress-line">
              <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}

          {isRecordingAudio && (
            <div className="recording-indicator" style={{ position: 'absolute', bottom: '72px', left: '20px', background: inputBg, color: textColor, border: `1px solid ${borderColor}`, borderRadius: '999px', padding: '8px 13px', display: 'flex', alignItems: 'center', gap: '9px', boxShadow: '0 8px 22px rgba(0,0,0,0.14)', fontSize: '13px', fontWeight: 700 }}>
              <span className="recording-dot" />
              <span>Ses kaydı alınıyor...</span>
            </div>
          )}

          {/* YANITLANAN MESAJ GÖSTERGESİ */}
          {replyingTo && (
            <div style={{ position: 'absolute', top: '-52px', left: '20px', right: '20px', background: inputBg, padding: '10px 15px', borderRadius: '8px 8px 0 0', border: `1px solid ${borderColor}`, borderBottom: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10, boxShadow: '0 -2px 10px rgba(0,0,0,0.05)' }}>
              <div style={{ borderLeft: '4px solid #f97316', paddingLeft: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#f97316' }}>{replyingTo.sender?.username || 'Kullanıcı'} kişisine yanıt veriliyor</div>
                <div style={{ fontSize: '13px', color: textColor, opacity: 0.8 }}>{replyingTo.content.substring(0, 60)}...</div>
              </div>
              <button onClick={() => setReplyingTo(null)} style={{ background: 'none', border: 'none', color: iconColor, cursor: 'pointer', fontSize: '16px' }}>✖</button>
            </div>
          )}

          {/* ZAMANLAMA KUTUSU */}
          {isScheduling && (
            <div style={{ position: 'absolute', bottom: '75px', right: '20px', background: inputBg, padding: '15px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 100, border: `1px solid ${borderColor}`, color: textColor }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#f97316' }}>Gönderimi Planla</span>
                <button onClick={() => { setIsScheduling(false); setScheduleTime(null); }} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: iconColor }}>✖</button>
              </div>
              <DatePicker selected={scheduleTime} onChange={(date: Date | null) => setScheduleTime(date)} showTimeSelect timeFormat="HH:mm" timeIntervals={5} timeCaption="Saat" dateFormat="d MMMM yyyy, HH:mm" minDate={new Date()} filterTime={filterPassedTime} locale={tr} placeholderText="Tarih ve saat seçin" inline />
              <div style={{ marginTop: '10px', opacity: scheduleTime ? 1 : 0.5, pointerEvents: scheduleTime ? 'auto' : 'none', transition: 'all 0.2s ease' }}>
                <Button text="Zamanla ve Gönder" onClick={handleSend} fullWidth />
              </div>
            </div>
          )}

          {/* DOSYA ÖNİZLEME KUTUSU */}
          {selectedFile && (
            <div className="file-preview-banner" style={{ top: replyingTo ? '-130px' : '-80px' }}>
              {selectedFile.type.startsWith('image/') && filePreview ? (
                <img src={filePreview} alt="Önizleme" style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '5px' }} />
              ) : (
                <div style={{ width: '50px', height: '50px', background: '#5157ae', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '5px', fontSize: '20px' }}>📄</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '200px' }}>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedFile.name}</span>
                <span style={{ fontSize: '11px', color: iconColor }}>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <button onClick={cancelFile} style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', fontSize: '18px', marginLeft: '10px' }}>✖</button>
            </div>
          )}

          {/* BUTONLAR (EMOJİ VE ATAŞ) */}
          <div style={{ display: 'flex', gap: '8px', color: iconColor }}>
            <div style={{ position: 'relative' }}>
              <Button variant="icon" onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowAttachmentMenu(false); }} title="Emoji Ekle" aria-label="Emoji ekle" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M9.153 11.603c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962zm-3.204 1.362c-.026-.307-.131 5.218 6.063 5.551 6.066-.25 6.066-5.551 6.066-5.551-6.078 1.416-12.129 0-12.129 0zm11.363 1.108s-.669 1.959-5.051 1.959c-3.505 0-5.388-1.164-5.607-1.959 0 0 5.912 1.055 10.658 0zM11.804 1.011C5.609 1.011.978 6.033.978 12.228s4.826 10.761 11.021 10.761S23.02 18.423 23.02 12.228c.001-6.195-5.021-11.217-11.216-11.217zM12 21.354c-5.273 0-9.381-3.886-9.381-9.159s3.942-9.548 9.215-9.548 9.548 4.275 9.548 9.548c-.001 5.272-4.109 9.159-9.382 9.159zm3.108-9.751c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962z"></path></svg>} />
              {showEmojiPicker && (
                <div style={{ position: 'absolute', bottom: '55px', left: '0', zIndex: 1000, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                  <EmojiPicker onEmojiClick={(emojiData: EmojiClickData) => setNewMessage(newMessage + emojiData.emoji)} theme={isDarkMode ? Theme.DARK : Theme.LIGHT} emojiStyle={EmojiStyle.APPLE} lazyLoadEmojis={true} suggestedEmojisMode={SuggestionMode.RECENT} previewConfig={{ showPreview: false }} />
                </div>
              )}
            </div>

            <div style={{ position: 'relative' }}>
              <Button variant="icon" onClick={() => { setShowAttachmentMenu(!showAttachmentMenu); setShowEmojiPicker(false); }} title="Dosya Ekle" aria-label="Dosya ekle" style={{ color: iconColor, transform: showAttachmentMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.816 15.556v.002c0 1.502.584 2.912 1.646 3.972s2.472 1.647 3.974 1.647a5.58 5.58 0 0 0 3.972-1.645l9.547-9.548c.769-.768 1.147-1.767 1.058-2.817-.079-.968-.548-1.927-1.319-2.698-1.594-1.592-4.068-1.711-5.517-.262l-7.916 7.915c-.881.881-.792 2.25.214 3.261.959.958 2.423 1.053 3.263.215l5.511-5.512c.28-.28.267-.722.053-.936l-.244-.244c-.191-.191-.567-.349-.957.04l-5.506 5.506c-.18.18-.635.127-.976-.214-.098-.097-.576-.613-.213-.973l7.915-7.917c.818-.817 2.267-.699 3.23.262.5.501.802 1.1.849 1.685.051.573-.156 1.111-.589 1.543l-9.547 9.549a3.97 3.97 0 0 1-2.829 1.171 3.975 3.975 0 0 1-2.83-1.173 3.973 3.973 0 0 1-1.172-2.828c0-1.071.415-2.076 1.172-2.83l7.209-7.211c.157-.157.264-.579.028-.814L11.5 4.36a.57.57 0 0 0-.834.018l-7.205 7.207a5.577 5.577 0 0 0-1.645 3.971z"></path></svg>} />

              {showAttachmentMenu && (
                <div className="dropdown-menu" style={{ bottom: '55px', left: '0', padding: '10px', gap: '8px', minWidth: '160px' }}>
                  <button onClick={() => { setShowAttachmentMenu(false); openFilePicker('image/*'); }} className="msg-dropdown-btn" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px' }}><span style={{ fontSize: '18px' }}>📷</span> Görsel</button>
                  <button onClick={() => { setShowAttachmentMenu(false); openFilePicker('*/*'); }} className="msg-dropdown-btn" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px' }}><span style={{ fontSize: '18px' }}>📄</span> Belge</button>
                </div>
              )}
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept={fileAccept} onChange={handleFileUpload} />
              <input type="file" ref={scheduledFileInputRef} style={{ display: 'none' }} onChange={handleScheduledFileChange} />
            </div>
          </div>

          {/* INPUT ALANI */}
          <input
            type="text"
            placeholder={isUploading ? "Dosya gönderiliyor..." : "Bir mesaj yazın..."}
            value={newMessage}
            onChange={(e) => {
              setNewMessage(e.target.value);
              onTyping(true);
              if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
              typingTimeoutRef.current = setTimeout(() => onTyping(false), 1200);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            disabled={isUploading}
            aria-label="Mesaj yazma alanı"
            style={{ flex: 1, padding: '12px 15px', borderRadius: '8px', border: `1px solid ${borderColor}`, outline: 'none', backgroundColor: inputBg, color: textColor, fontSize: '15px' }}
          />

          <button
            onClick={toggleVoiceRecording}
            disabled={isUploading}
            title={isRecordingAudio ? 'Kaydı bitir ve gönder' : 'Sesli mesaj kaydet'}
            aria-label={isRecordingAudio ? 'Kaydı bitir ve gönder' : 'Sesli mesaj kaydet'}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: 'none',
              background: isRecordingAudio ? '#e53935' : '#f97316',
              color: 'white',
              cursor: isUploading ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isRecordingAudio ? '0 0 0 6px rgba(229,57,53,0.18)' : 'none',
              transition: 'all 0.2s ease',
              flexShrink: 0
            }}
          >
            {isRecordingAudio ? (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 6h12v12H6z"></path></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"></path></svg>
            )}
          </button>

          {/* GÖNDER BUTONU */}
          <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', opacity: (newMessage.trim() || selectedFile) ? 1 : 0.5, pointerEvents: ((newMessage.trim() || selectedFile) && !isUploading) ? 'auto' : 'none', transition: 'all 0.2s ease' }}>
            <button onClick={handleSend} style={{ background: '#f97316', color: 'white', border: 'none', padding: '10px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817z"></path></svg>
            </button>
            <button onClick={() => setIsScheduling(!isScheduling)} style={{ background: '#ea580c', color: 'white', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.2)', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▼</button>
          </div>

          </div>
        )}

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
          
          /* Sağ panel kayma animasyonu */
          @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        `}</style>

      </div>
      {/* <-- ANA SOHBET ALANI BURADA KAPANDI */}

      {/* ========================================================= */}
      {/* SAĞ TARAF: WHATSAPP TARZI KİŞİ/GRUP BİLGİSİ YAN PANELİ */}
      {/* ========================================================= */}
      {isConversationInfoOpen && (
        <div className="conversation-info-sidebar" style={{
          position: 'absolute', /* ÜZERİNE BİNMESİ İÇİN EKLENDİ */
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%', /* CHAT AREANIN TAMAMINI KAPSASIN DİYE 400PX'TEN 100%'E ÇIKARILDI */
          background: panelBg,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 100, /* ÜSTTE KALMASI İÇİN EKLENDİ */
          animation: 'slideInRight 0.25s ease-out'
        }}>
          {/* YAN PANEL HEADER */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '0 20px', background: panelBg, borderBottom: `1px solid ${borderColor}`, height: '71px', flexShrink: 0 }}>
            <button onClick={() => setIsConversationInfoOpen(false)} style={{ background: 'none', border: 'none', color: iconColor, cursor: 'pointer', fontSize: '20px', display: 'flex', alignItems: 'center' }}>✖</button>
            <h3 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: 500 }}>{activeConversation?.isGroup ? 'Grup bilgisi' : 'Kişi bilgisi'}</h3>
          </div>

          {/* YAN PANEL İÇERİK (Scrollable) */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0', color: textColor }}>

            {/* PROFİL FOTO VE İSİM (BÜYÜK) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px 20px', background: inputBg, marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ width: '200px', height: '200px', borderRadius: '50%', background: '#f97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '64px', overflow: 'hidden', marginBottom: '20px' }}>
                {activeConversation?.isGroup && activeConversation?.avatarUrl
                  ? <img src={activeConversation.avatarUrl} alt="Grup" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : !activeConversation?.isGroup && chatPartner?.avatarUrl
                    ? <img src={chatPartner.avatarUrl} alt="Profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username)?.[0]?.toUpperCase()}
              </div>
              <h2 style={{ margin: '0 0 5px 0', fontSize: '24px', color: textColor, textAlign: 'center' }}>{activeConversation?.isGroup ? activeConversation?.name : chatPartner?.username}</h2>
              {!activeConversation?.isGroup && partnerStatus && <div style={{ fontSize: '14px', color: iconColor }}>{partnerStatus}</div>}

              {/* GRUPLAR İÇİN GRUP AYARLARI BUTONU */}
              {activeConversation?.isGroup && (
                <button onClick={openGroupSettings} style={{ marginTop: '15px', padding: '8px 16px', borderRadius: '8px', border: `1px solid ${borderColor}`, background: panelBg, color: textColor, cursor: 'pointer', fontWeight: 600 }}>
                  ⚙️ Grup Ayarları
                </button>
              )}

              {/* BİREYSEL SOHBETLER İÇİN ENGELLE BUTONU */}
              {!activeConversation?.isGroup && (selectedUser || activeConversation?.otherUser) && (
                <button 
                  onClick={handleBlockToggle} 
                  style={{ marginTop: '15px', padding: '8px 16px', borderRadius: '8px', border: `1px solid ${isBlockedLocally ? '#f97316' : '#e53935'}`, background: panelBg, color: isBlockedLocally ? '#f97316' : '#e53935', cursor: 'pointer', fontWeight: 600 }}
                >
                  {isBlockedLocally ? '✅ Engeli Kaldır' : '🚫 Kişiyi Engelle'}
                </button>
              )}
            </div>

            {/* MEDYA / LİNKLER / SÜRELİ İÇERİK ALANI */}
            <div style={{ background: inputBg, padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {[
                  { key: 'media', label: `Medya (${mediaMessages.length})` },
                  { key: 'links', label: `Linkler (${linkItems.length})` },
                  { key: 'scheduled', label: `Süreli (${pendingMessages.length})` },
                  { key: 'starred', label: `Yıldızlı (${conversationStarredMessages.length})` }
                ].map((tab) => {
                  const isSelected = conversationInfoTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setConversationInfoTab(tab.key as ConversationInfoTab)}
                      style={{ border: `1px solid ${isSelected ? '#f97316' : borderColor}`, background: isSelected ? (isDarkMode ? 'rgba(249, 115, 22,0.18)' : '#ffedd5') : panelBg, color: isSelected ? '#f97316' : textColor, borderRadius: '999px', padding: '7px 11px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, transition: 'all 0.2s' }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* TAB İÇERİKLERİ */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

                {/* MEDYA SEKME İÇERİĞİ */}
                {conversationInfoTab === 'media' && (
                  mediaMessages.length === 0 ? <div style={{ color: iconColor, fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Hiç medya yok</div> :
                    mediaMessages.map((message) => (
                      <div key={message.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderRadius: '10px', background: panelBg }}>
                        <button onClick={() => message.fileUrl && window.open(message.fileUrl, '_blank')} style={{ width: '50px', height: '50px', borderRadius: '8px', border: 'none', background: '#f97316', color: 'white', cursor: message.fileUrl ? 'pointer' : 'default', overflow: 'hidden', flexShrink: 0 }}>
                          {(message.fileType === 'image' || message.fileType?.startsWith('image')) && message.fileUrl
                            ? <img src={message.fileUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : '📎'}
                        </button>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{message.fileName || "Bilinmeyen Dosya"}</div>
                          <button onClick={() => scrollToMessage(message.id)} style={{ border: 'none', background: 'transparent', color: '#f97316', padding: 0, cursor: 'pointer', fontSize: '13px', marginTop: '4px' }}>Mesaja git</button>
                        </div>
                      </div>
                    ))
                )}

                {/* LİNK SEKME İÇERİĞİ */}
                {conversationInfoTab === 'links' && (
                  linkItems.length === 0 ? <div style={{ color: iconColor, fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Hiç link yok</div> :
                    linkItems.map(({ messageId, url }, index) => (
                      <div key={`${messageId}-${index}`} style={{ padding: '12px', borderRadius: '10px', background: panelBg }}>
                        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#f97316', fontSize: '14px', wordBreak: 'break-all', textDecoration: 'none' }}>{url}</a>
                        <div style={{ marginTop: '8px' }}>
                          <button onClick={() => scrollToMessage(messageId)} style={{ border: 'none', background: 'transparent', color: iconColor, padding: '0', cursor: 'pointer', fontSize: '13px' }}>Mesaja git</button>
                        </div>
                      </div>
                    ))
                )}

                {/* SÜRELİ MESAJ SEKME İÇERİĞİ */}
                {conversationInfoTab === 'scheduled' && (
                  pendingMessages.length === 0 ? <div style={{ color: iconColor, fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Bekleyen mesaj yok</div> :
                    pendingMessages.map((message) => (
                      <div key={message.id} style={{ padding: '12px', borderRadius: '10px', background: panelBg }}>
                        <div style={{ fontSize: '13px', color: iconColor, marginBottom: '6px', fontWeight: 600 }}>
                          ⏳ {new Date(message.sendAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                        <div style={{ fontSize: '14px', color: textColor, wordBreak: 'break-word' }}>
                          {message.content || (message.fileName ? `📎 ${message.fileName}` : 'Dosyalı süreli mesaj')}
                        </div>
                      </div>
                    ))
                )}

                {/* YILDIZLI MESAJ SEKME İÇERİĞİ */}
                {conversationInfoTab === 'starred' && (
                  conversationStarredMessages.length === 0 ? <div style={{ color: iconColor, fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Yıldızlı mesaj yok</div> :
                    conversationStarredMessages.map((message) => (
                      <div key={message.id} style={{ padding: '12px', borderRadius: '10px', background: panelBg }}>
                        <div style={{ fontSize: '13px', color: iconColor, marginBottom: '6px', fontWeight: 600 }}>
                          ⭐ {message.sender?.username || 'Kullanıcı'}
                        </div>
                        <div style={{ fontSize: '14px', color: textColor, wordBreak: 'break-word' }}>
                          {message.content || message.fileName || 'Dosyalı mesaj'}
                        </div>
                        <button onClick={() => scrollToMessage(message.id)} style={{ border: 'none', background: 'transparent', color: '#f97316', padding: '8px 0 0', cursor: 'pointer', fontSize: '13px' }}>Mesaja git</button>
                      </div>
                    ))
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {lightboxImageUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxImageUrl(null)}>
          <button className="lightbox-close-btn" onClick={() => setLightboxImageUrl(null)} aria-label="Kapat">✕</button>
          <img src={lightboxImageUrl} alt="Görsel önizleme" className="lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

    </div>
  );
}
