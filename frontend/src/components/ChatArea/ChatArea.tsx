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
  onTyping: (isTyping: boolean) => void;
  onToggleConversationPin: (conversationId: string) => void;
  onToggleConversationArchive: (conversationId: string) => void;
  onToggleConversationMute: (conversationId: string) => void;
  onSetDisappearingMode: (conversationId: string, durationSeconds: number | null) => void;
  onStartCall: (callType: 'audio' | 'video') => void;
}

export default function ChatArea({
  currentUser, activeConversation, selectedUser, messages, newMessage,
  setNewMessage, mesajGonder, messagesEndRef, openGroupSettings, closeChat, isDarkMode,
  usersList, groupMembers, loadMoreMessages, hasMore, isLoadingMore, typingUsername, onTyping,
  onToggleConversationPin, onToggleConversationArchive, onToggleConversationMute, onSetDisappearingMode,
  onStartCall
}: ChatAreaProps) {

  // ARAMA VE MENÜ DURUMLARI
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [messageSearchTerm, setMessageSearchTerm] = useState('');
  const [isMediaPanelOpen, setIsMediaPanelOpen] = useState(false);
  const [mediaPanelData, setMediaPanelData] = useState<{ mediaMessages: Message[]; linkItems: Array<{ messageId: string; url: string; createdAt?: string }> }>({ mediaMessages: [], linkItems: [] });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [openOptionsId, setOpenOptionsId] = useState<string | null>(null);
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const [isDisappearingSettingsOpen, setIsDisappearingSettingsOpen] = useState(false);
  const [systemNotice, setSystemNotice] = useState<string | null>(null);

  // MESAJ İŞLEM DURUMLARI (BİLGİ, YANITLA, İLET)
  const [messageInfo, setMessageInfo] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editMessageText, setEditMessageText] = useState('');

  // ZAMANLAMA VE BEKLEYEN MESAJ DURUMLARI
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleTime, setScheduleTime] = useState<Date | null>(null);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<any[]>([]);

  // Zamanlanmış mesaj düzenleme modalının geçici form durumu
  const [editingScheduled, setEditingScheduled] = useState<any>(null);
  const [editScheduledText, setEditScheduledText] = useState('');

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

  // Oda ve liste yaşam döngüsü

  // 1. Sohbet odası değiştiğinde çalışan temizlikçi
  useEffect(() => {
    if (activeConversation?.id) {
      setReplyingTo(null);
      setIsMediaPanelOpen(false);
      cancelFile();
    }
  }, [activeConversation?.id, cancelFile]);

  // 2. Bekleyen mesajlar ikonuna basıldığında çalışan getirici
  useEffect(() => {
    if (activeConversation?.id && isPendingModalOpen) {
      fetchPendingMessages();
    }
  }, [isPendingModalOpen, activeConversation?.id, fetchPendingMessages]);

  useEffect(() => {
    if (!activeConversation?.id || !isMediaPanelOpen) return;
    api.get(`/conversations/${activeConversation.id}/media`)
      .then((response) => setMediaPanelData(response.data))
      .catch(() => setMediaPanelData({ mediaMessages: [], linkItems: [] }));
  }, [activeConversation?.id, isMediaPanelOpen]);

  useEffect(() => {
    const conversationId = activeConversation?.id || null;
    const currentMode = activeConversation?.disappearingDurationSeconds ?? null;

    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId;
      previousDisappearingModeRef.current = currentMode;
      setSystemNotice(null);
      return;
    }

    if (previousDisappearingModeRef.current !== undefined && previousDisappearingModeRef.current !== currentMode) {
      setSystemNotice(currentMode ? 'Kaybolan mesaj modu açıldı.' : 'Kaybolan mesaj modu kapatıldı.');
      const timeout = window.setTimeout(() => setSystemNotice(null), 2800);
      previousDisappearingModeRef.current = currentMode;
      return () => window.clearTimeout(timeout);
    }

    previousDisappearingModeRef.current = currentMode;
  }, [activeConversation?.id, activeConversation?.disappearingDurationSeconds]);

  // 3. Geçmiş mesajlar yüklendiğinde kaydırma çubuğunu sabitleyici
  useEffect(() => {
    if (isLoadingMore && messagesListRef.current) {
      const newScrollHeight = messagesListRef.current.scrollHeight;
      messagesListRef.current.scrollTop = newScrollHeight - previousScrollHeight.current;
    }
  }, [messages, isLoadingMore]);

  // Liste ve zamanlama yardımcıları

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.currentTarget.scrollTop === 0 && hasMore && !isLoadingMore) {
      previousScrollHeight.current = e.currentTarget.scrollHeight;
      loadMoreMessages();
    }
  };

  const cancelScheduledMessage = async (id: string) => {
    try { await api.delete(`/messages/schedule/${id}`); setPendingMessages(prev => prev.filter(m => m.id !== id)); } catch { alert("İptal işlemi başarısız."); }
  };

  const sendNowScheduledMessage = async (id: string) => {
    try { await api.post(`/messages/schedule/send-now/${id}`); setPendingMessages(prev => prev.filter(m => m.id !== id)); } catch { alert("Mesaj anında gönderilemedi."); }
  };

  // Düzenleme kaydı ScheduledMessage üzerinde kalır; normal sohbete mesaj üretmez.
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
    } catch { alert("Mesaj güncellenemedi."); }
  };

  const filterPassedTime = (time: Date) => new Date().getTime() < new Date(time).getTime();

  // Yükleme ilerlemesi Axios progress olayıyla tek noktadan hesaplanır.

  useEffect(() => () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  // Normal ve zamanlanmış gönderimler aynı dosya yükleme sonucunu kullanır.

  const handleSend = async () => {
    if (!newMessage.trim() && !selectedFile) return;
    onTyping(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

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
        fetchPendingMessages();
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

  // Yanıt, iletme, yıldızlama, sabitleme ve silme işlemleri

  const handleReply = (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (msg) setReplyingTo(msg);
    setOpenOptionsId(null);
  };

  const handleForward = (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (msg) setForwardMessage(msg);
    setOpenOptionsId(null);
  };

  const executeForward = async (targetUser: User) => {
    if (!forwardMessage) return;
    try {
      const convRes = await api.post('/conversations/direct', { targetUserId: targetUser.id });
      await api.post('/messages', {
        conversationId: convRes.data.id,
        clientId: crypto.randomUUID(),
        content: forwardMessage.content,
        isForwarded: true,
        fileKey: forwardMessage.fileKey,
        fileType: forwardMessage.fileType,
        fileName: forwardMessage.fileName
      });
      alert(`Mesaj ${targetUser.username} kişisine iletildi!`);
      setForwardMessage(null);
    } catch { alert("Mesaj iletilemedi."); }
  };

  const handleStar = async (msgId: string) => {
    try { await api.put(`/messages/${msgId}/star`); } catch { alert("İşlem başarısız."); }
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
    } catch { alert('Dosya kaldırılamadı.'); }
  };

  const handleDeleteForMe = async (msgId: string) => {
    if(!window.confirm("Bu mesajı kendinizden silmek istediğinize emin misiniz?")) return;
    try { await api.delete(`/messages/${msgId}?forEveryone=false`); } catch { alert("İşlem başarısız."); }
    setOpenOptionsId(null);
  };

  const handleDeleteForEveryone = async (msgId: string) => {
    if(!window.confirm("Bu mesajı HERKESTEN silmek istediğinize emin misiniz?")) return;
    try { await api.delete(`/messages/${msgId}?forEveryone=true`); } catch { alert("İşlem başarısız."); }
    setOpenOptionsId(null);
  };

  const formatDetailedDate = (dateString?: string) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' });
  };

  const getUnixEpoch = (dateString?: string) => dateString ? Math.floor(new Date(dateString).getTime() / 1000) : "-";

  const getMessagePreview = (message?: Message | null) => {
    if (!message) return '';
    if (message.content?.trim()) return message.content;
    if (message.fileType === 'image' || message.fileType?.startsWith('image')) return '📷 Görsel';
    if (message.fileType === 'audio') return '🎧 Ses dosyası';
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
    const target = messagesListRef.current.querySelector(`[data-message-id="${messageId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => setHighlightedMessageId((current) => current === messageId ? null : current), 1600);
  };

  if (!activeConversation && !selectedUser) {
    return (
      <div className="chat-area empty-chat-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, backgroundColor: panelBg }}>
        <h2 className="empty-chat-box" style={{ color: textColor, fontWeight: 300 }}>Mesajlaşmaya Başla</h2>
        <p style={{ color: iconColor, marginTop: '10px' }}>Sohbet etmek için sol taraftan bir kişi veya grup seçin.</p>
      </div>
    );
  }

  const displayedMessages = messageSearchTerm.trim() !== ''
    ? messages.filter(m => m.content.toLowerCase().includes(messageSearchTerm.toLowerCase()))
    : messages;

  const pinnedMessages = displayedMessages.filter(m => m.isPinned);
  const mediaMessages = mediaPanelData.mediaMessages;
  const linkItems = mediaPanelData.linkItems;
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
  const disappearingLabel = disappearingOptions.find((option) => option.seconds === (activeConversation?.disappearingDurationSeconds ?? null))?.label || 'Kapalı';

  return (
    <div className="chat-area" onPaste={handlePaste} style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: chatBg }}>

      {/* ÜST BAR (HEADER) */}
      <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', background: panelBg, borderBottom: `1px solid ${borderColor}`, height: '71px', boxSizing: 'border-box' }}>
        <div className="chat-title-info" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 auto' }}>
          <button className="mobile-back-btn" onClick={closeChat} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: iconColor }}>←</button>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#00a884', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
            {!activeConversation?.isGroup && chatPartner?.avatarUrl
              ? <img src={chatPartner.avatarUrl} alt="Profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (activeConversation?.isGroup ? activeConversation.name : chatPartner?.username)?.[0]?.toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '16px', color: textColor, fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeConversation?.isGroup ? activeConversation.name : chatPartner?.username}
            </h2>
            {!activeConversation?.isGroup && partnerStatus && <div style={{ marginTop: '2px', fontSize: '11px', color: typingUsername || chatPartner?.isOnline ? '#00a884' : iconColor }}>{partnerStatus}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
          <Button variant="icon" onClick={() => onStartCall('audio')} disabled={!activeConversation?.id} title="Sesli Ara" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02z"></path></svg>} />
          <Button variant="icon" onClick={() => onStartCall('video')} disabled={!activeConversation?.id} title="Görüntülü Ara" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M17 10.5V6c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-4.5l4 4v-11z"></path></svg>} />
          <Button variant="icon" onClick={() => setIsPendingModalOpen(!isPendingModalOpen)} title="Bekleyen Mesajlar" style={{ color: iconColor, position: 'relative' }} icon={<><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"></path></svg>{pendingMessages.length > 0 && (<span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#e53935', color: 'white', fontSize: '10px', fontWeight: 'bold', width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${panelBg}` }}>{pendingMessages.length}</span>)}</>} />
          <Button variant="icon" onClick={() => { setIsSearchOpen(!isSearchOpen); setMessageSearchTerm(''); }} title="Mesajlarda Ara" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 0 0 1.256-3.386 5.207 5.207 0 1 0-5.207 5.208 5.183 5.183 0 0 0 3.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.8 0a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"></path></svg>} />
          {activeConversation?.isGroup && (<Button variant="icon" onClick={openGroupSettings} title="Grup Bilgisi" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 7a2 2 0 1 0-.001-4.001A2 2 0 0 0 12 7zm0 2a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 9zm0 6a2 2 0 1 0-.001 3.999A2 2 0 0 0 12 15z"></path></svg>} />)}
          <div style={{ position: 'relative' }}>
            <Button variant="icon" onClick={() => setIsChatMenuOpen((previous) => !previous)} title="Sohbet seçenekleri" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"></path></svg>} />
            {isChatMenuOpen && activeConversation?.id && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setIsChatMenuOpen(false)} />
                <div style={{ position: 'absolute', right: 0, top: '42px', width: '245px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '14px', boxShadow: '0 14px 40px rgba(0,0,0,0.26)', zIndex: 100, overflow: 'hidden', color: textColor }}>
                  <button className="msg-dropdown-btn" onClick={() => { setIsMediaPanelOpen(true); setIsChatMenuOpen(false); }}>🖼️ Medya, dosyalar ve linkler</button>
                  <button className="msg-dropdown-btn" onClick={() => { onToggleConversationMute(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isMuted ? '🔔 Sesi aç' : '🔕 Sessize al'}</button>
                  <button className="msg-dropdown-btn" onClick={() => { onToggleConversationPin(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isPinned ? '📌 Sabitlemeyi kaldır' : '📌 Sohbeti sabitle'}</button>
                  <button className="msg-dropdown-btn" onClick={() => { onToggleConversationArchive(activeConversation.id); setIsChatMenuOpen(false); }}>{activeConversation.isArchived ? '🗄️ Arşivden çıkar' : '🗄️ Arşivle'}</button>
                  <button className="msg-dropdown-btn" onClick={handleDisappearingMode}>⏳ Kaybolan mesaj modu</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* BEKLEYEN/ZAMANLANMIŞ MESAJLAR MODALI */}
      {isMediaPanelOpen && (
        <div style={{ position: 'absolute', top: '75px', right: '20px', width: '360px', maxWidth: 'calc(100% - 40px)', maxHeight: '70vh', overflowY: 'auto', background: inputBg, borderRadius: '14px', boxShadow: '0 14px 45px rgba(0,0,0,0.28)', zIndex: 20, padding: '16px', border: `1px solid ${borderColor}`, color: textColor }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <div style={{ color: '#00a884', fontSize: '12px', fontWeight: 700 }}>Sohbet bilgisi</div>
              <h3 style={{ margin: 0, fontSize: '17px' }}>Medya, dosyalar ve linkler</h3>
            </div>
            <button onClick={() => setIsMediaPanelOpen(false)} style={{ border: 'none', background: panelBg, color: iconColor, borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer' }}>✕</button>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <strong style={{ fontSize: '13px', color: iconColor }}>Medya ve dosyalar ({mediaMessages.length})</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              {mediaMessages.length === 0 ? (
                <div style={{ color: iconColor, fontSize: '13px', padding: '8px 0' }}>Henüz medya veya dosya yok.</div>
              ) : mediaMessages.map((message) => (
                <div key={message.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px', borderRadius: '10px', background: panelBg }}>
                  <button onClick={() => message.fileUrl && window.open(message.fileUrl, '_blank')} style={{ width: '44px', height: '44px', borderRadius: '8px', border: 'none', background: '#00a884', color: 'white', cursor: message.fileUrl ? 'pointer' : 'default', overflow: 'hidden', flexShrink: 0 }}>
                    {(message.fileType === 'image' || message.fileType?.startsWith('image')) && message.fileUrl
                      ? <img src={message.fileUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : '📎'}
                  </button>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{message.fileName || getMessagePreview(message)}</div>
                    <button onClick={() => scrollToMessage(message.id)} style={{ border: 'none', background: 'transparent', color: '#00a884', padding: 0, cursor: 'pointer', fontSize: '12px' }}>Mesaja git</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <strong style={{ fontSize: '13px', color: iconColor }}>Linkler ({linkItems.length})</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              {linkItems.length === 0 ? (
                <div style={{ color: iconColor, fontSize: '13px', padding: '8px 0' }}>Henüz link yok.</div>
              ) : linkItems.map(({ messageId, url }, index) => (
                <div key={`${messageId}-${index}`} style={{ padding: '9px', borderRadius: '10px', background: panelBg }}>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#00a884', fontSize: '13px', wordBreak: 'break-all', textDecoration: 'none' }}>{url}</a>
                  <div>
                    <button onClick={() => scrollToMessage(messageId)} style={{ border: 'none', background: 'transparent', color: iconColor, padding: '6px 0 0', cursor: 'pointer', fontSize: '12px' }}>Mesaja git</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isDisappearingSettingsOpen && activeConversation?.id && (
        <div className="settings-overlay" onClick={() => setIsDisappearingSettingsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: '430px', maxWidth: '100%', background: panelBg, border: `1px solid ${borderColor}`, borderRadius: '18px', boxShadow: '0 24px 70px rgba(0,0,0,0.38)', color: textColor, overflow: 'hidden' }}>
            <div style={{ padding: '18px 18px 14px', background: isDisappearingMode ? 'linear-gradient(135deg, #0f8f6f, #145c4d)' : inputBg }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: isDisappearingMode ? '#d8fff3' : '#00a884' }}>Kaybolan mesaj modu</div>
              <h3 style={{ margin: '4px 0 6px', fontSize: '19px', color: isDisappearingMode ? 'white' : textColor }}>Mesajlar ne kadar sonra kaybolsun?</h3>
              <p style={{ margin: 0, fontSize: '13px', color: isDisappearingMode ? '#d8fff3' : iconColor }}>Bu ayar açıldıktan sonra gönderilen yeni mesajlara uygulanır.</p>
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
                    style={{ border: `1px solid ${isSelected ? '#00a884' : borderColor}`, background: isSelected ? (isDarkMode ? 'rgba(0,168,132,0.18)' : '#e1f7f0') : inputBg, color: textColor, borderRadius: '14px', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}
                  >
                    <span>
                      <strong style={{ display: 'block', fontSize: '14px' }}>{option.label}</strong>
                      <span style={{ display: 'block', fontSize: '12px', color: iconColor, marginTop: '3px' }}>{option.description}</span>
                    </span>
                    <span style={{ color: isSelected ? '#00a884' : iconColor, fontWeight: 800 }}>{isSelected ? '✓' : '○'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {isPendingModalOpen && (
        <div style={{ position: 'absolute', top: '75px', right: '20px', width: '320px', background: inputBg, borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 10, padding: '15px', border: `1px solid ${borderColor}` }}>
          <h3 style={{ fontSize: '15px', color: '#00a884', margin: '0 0 10px 0', borderBottom: `1px solid ${borderColor}`, paddingBottom: '8px' }}>Zamanlanmış Mesajlar</h3>
          {pendingMessages.length === 0 ? (
             <p style={{ fontSize: '13px', color: iconColor, textAlign: 'center' }}>Bekleyen mesaj yok.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto' }}>
              {pendingMessages.map((pm) => (
                <div key={pm.id} style={{ background: panelBg, padding: '10px', borderRadius: '8px', fontSize: '13px' }}>
                  <div style={{ color: iconColor, marginBottom: '6px', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Zaman: {new Date(pm.sendAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button onClick={() => sendNowScheduledMessage(pm.id)} style={{ background: 'none', border: 'none', color: '#00a884', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>Şimdi</button>
                      <button onClick={() => openEditScheduledModal(pm)} style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>Düzenle</button>
                      <button onClick={() => replaceScheduledFile(pm.id)} style={{ background: 'none', border: 'none', color: '#7c4dff', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>{pm.fileKey ? 'Dosyayı Değiştir' : 'Dosya Ekle'}</button>
                      {pm.fileKey && <button onClick={() => removeScheduledFile(pm)} style={{ background: 'none', border: 'none', color: '#ef6c00', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>Dosyayı Kaldır</button>}
                      <button onClick={() => cancelScheduledMessage(pm.id)} style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>İptal</button>
                    </div>
                  </div>
                 <div style={{ color: textColor, wordBreak: 'break-word' }}>
                    {pm.fileUrl && (
                      <div style={{ marginBottom: '5px', color: '#00a884', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}>
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

      {/* SABİTLENMİŞ MESAJ BANNERI */}
      {pinnedMessages.length > 0 && (
        <div
          onClick={() => scrollToMessage(pinnedMessages[pinnedIndex % pinnedMessages.length]?.id)}
          style={{ background: panelBg, borderBottom: `1px solid ${borderColor}`, padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: textColor, zIndex: 5, boxShadow: '0 2px 5px rgba(0,0,0,0.05)', cursor: 'pointer' }}
        >
           <span style={{ color: '#8696a0', fontSize: '16px' }}>📌</span>
           <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
             <strong style={{ color: '#00a884' }}>
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
          <div style={{ textAlign: 'center', padding: '10px', color: '#00a884', fontSize: '12px', fontWeight: 'bold' }}>
            Eski mesajlar yükleniyor... ⏳
          </div>
        )}

        {activeConversation?.isGroup && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 25px 0' }}>
            <div style={{ background: isDarkMode ? '#182229' : '#fff5c4', color: isDarkMode ? '#8696a0' : '#54656f', padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', maxWidth: '85%' }}>
              <span style={{ fontSize: '14px', marginRight: '5px' }}>🔒</span>
              <strong>Mesajlar güvenli bağlantı üzerinden iletilir.</strong><br/>
              <span style={{ marginTop: '5px', display: 'inline-block' }}>{activeConversation.adminId === currentUser.id ? `Siz "${activeConversation.name}" grubunu oluşturdunuz.` : `Grup yöneticisi sizi "${activeConversation.name}" grubuna ekledi.`}</span>
            </div>
          </div>
        )}

        {displayedMessages.map((msg, index) => {
          const isMe = msg.senderId === currentUser.id;

          let isRead = false;
          if (activeConversation?.isGroup) {
            const otherMembersCount = groupMembers.length > 0 ? groupMembers.length - 1 : 999;
            isRead = (msg.readByIds?.length || 0) >= otherMembersCount && otherMembersCount > 0;
          } else {
            const myReceiptsEnabled = currentUser.readReceiptsOn !== false;
            const theirReceiptsEnabled = selectedUser?.readReceiptsOn !== false;
            isRead = !!(msg.readByIds && msg.readByIds.length > 0) && myReceiptsEnabled && theirReceiptsEnabled;
          }

          const timeString = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
          const isNearBottom = index >= displayedMessages.length - 2 && displayedMessages.length > 5;
          // Backend "herkesten sil" işleminde mesajı fiziksel silmez; içeriği bu sabit placeholder'a çevirir.
          // Frontend bu değeri görünce normal mesaj menüsünü kapatır ve WhatsApp benzeri silindi balonu gösterir.
          const isDeletedForEveryone = msg.content === "🚫 Bu mesaj silindi";

          return (
            <div key={msg.id} data-message-id={msg.id} className={`message-row ${isMe ? 'me' : 'them'} ${highlightedMessageId === msg.id ? 'highlight-message' : ''}`}>

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
                <div className="message-bubble" style={{ position: 'relative', minWidth: '110px', paddingRight: '30px', ...(msg.isPinned ? { borderLeft: '4px solid #00a884' } : {}) }}>
                  {!isMe && activeConversation?.isGroup && (
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#00a884', marginBottom: '4px' }}>{msg.sender?.username}</div>
                  )}

                  {msg.replyTo && (
                    <div onClick={() => { /* İstersen buraya tıklandığında mesaja gitme mantığı eklenebilir */ }} style={{ background: isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)', padding: '6px 10px', borderRadius: '5px', marginBottom: '6px', borderLeft: '4px solid #00a884', fontSize: '12px', cursor: 'pointer' }}>
                      <strong style={{ color: '#00a884', display: 'block', marginBottom: '2px' }}>{msg.replyTo.sender?.username}</strong>
                      <div style={{ opacity: 0.8, color: textColor, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{msg.replyTo.content}</div>
                    </div>
                  )}

                  {msg.fileUrl && (
                    <div style={{ marginBottom: msg.content ? '8px' : '0' }}>
                      {(msg.fileType === 'image' || msg.fileType?.startsWith('image')) && (
                        <img
                          src={msg.fileUrl}
                          alt="Görsel"
                          style={{ maxWidth: '100%', maxHeight: '250px', borderRadius: '8px', cursor: 'pointer', objectFit: 'contain' }}
                          onClick={() => window.open(msg.fileUrl, '_blank')}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.parentElement?.insertAdjacentHTML('beforeend', '<span style="font-size:12px; color:#aebac1;">⏳ Görselin süresi dolmuş</span>');
                          }}
                        />
                      )}

                      {msg.fileType === 'audio' && (
                        <audio controls src={msg.fileUrl} style={{ width: '220px', height: '40px', outline: 'none' }} />
                      )}

                      {(msg.fileType === 'document' || (!msg.fileType?.startsWith('image') && msg.fileType !== 'audio')) && (
                        <a
                          href={msg.fileUrl}
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
                    {isMe && <span className={`message-ticks ${isRead ? 'read' : ''}`}>{isRead ? '✓✓' : '✓'}</span>}
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
        {(systemNotice || isDisappearingMode) && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 4px' }}>
            <div style={{ background: isDisappearingMode ? (isDarkMode ? '#113d34' : '#d9f5eb') : panelBg, color: isDisappearingMode ? '#00a884' : iconColor, border: `1px solid ${isDisappearingMode ? 'rgba(0,168,132,0.35)' : borderColor}`, padding: '8px 13px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              ⏳ {systemNotice || `Kaybolan mesaj modu açık: ${disappearingLabel}`}
            </div>
          </div>
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
              <div style={{ fontWeight: '600', color: '#00a884', fontSize: '15px' }}>✓ İletilme Tarihi</div>
              <div style={{ fontSize: '14px' }}>{formatDetailedDate(messageInfo.createdAt)}</div>
              <div style={{ fontSize: '12px', color: iconColor, fontFamily: 'monospace' }}>Unix Epoch: {getUnixEpoch(messageInfo.createdAt)}</div>
            </div>

            {messageInfo.senderId === currentUser.id && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ fontWeight: '600', color: '#00a884', fontSize: '15px' }}>✓✓ Okuyanlar</div>
                {messageInfo.readByIds && messageInfo.readByIds.length > 0 ? (
                  <div style={{ maxHeight: '120px', overflowY: 'auto', background: inputBg, padding: '10px', borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                     {messageInfo.readByIds.map(id => {
                        const u = usersList.find(user => user.id === id);
                        return (
                          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                             <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#00a884', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
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
      {forwardMessage && (
        <div className="settings-overlay" onClick={() => setForwardMessage(null)} style={{ zIndex: 10000 }}>
          <div style={{ width: '350px', background: panelBg, borderRadius: '12px', padding: '20px', boxShadow: '0 15px 50px rgba(0,0,0,0.3)', color: textColor, display: 'flex', flexDirection: 'column', maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 15px 0', borderBottom: `1px solid ${borderColor}`, paddingBottom: '10px', fontSize: '16px', display: 'flex', justifyContent: 'space-between' }}>
              Mesajı İlet...
              <span style={{ cursor: 'pointer', color: iconColor }} onClick={() => setForwardMessage(null)}>✖</span>
            </h3>

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '5px' }}>
              {usersList.filter(u => u.id !== currentUser.id).length === 0 ? (
                <div style={{ fontSize: '13px', color: iconColor, textAlign: 'center', padding: '20px 0' }}>İletilecek kişi bulunamadı.</div>
              ) : (
                usersList.filter(u => u.id !== currentUser.id).map(u => (
                  <div key={u.id} onClick={() => executeForward(u)} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderBottom: `1px solid ${borderColor}`, cursor: 'pointer', transition: 'background 0.2s', borderRadius: '8px' }} onMouseOver={(e) => e.currentTarget.style.background = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#00a884', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px' }}>
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

      {editingMessage && (
        <div className="settings-overlay" onClick={() => setEditingMessage(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ width: '380px', maxWidth: '100%', background: panelBg, borderRadius: '16px', padding: '18px', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', color: textColor, border: `1px solid ${borderColor}` }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#00a884', fontWeight: 700 }}>Mesaj düzenleme</div>
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

      {/* ZAMANLANMIŞ MESAJ DÜZENLEME MODALI */}
      {editingScheduled && (
        <div className="settings-overlay" onClick={() => setEditingScheduled(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ width: '420px', maxWidth: '100%', background: panelBg, borderRadius: '16px', padding: '18px', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', color: textColor, border: `1px solid ${borderColor}` }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 15px 0', borderBottom: `1px solid ${borderColor}`, paddingBottom: '10px', fontSize: '16px', display: 'flex', justifyContent: 'space-between' }}>
              Mesajı Düzenle
              <span style={{ cursor: 'pointer', color: iconColor }} onClick={() => setEditingScheduled(null)}>✖</span>
            </h3>

            {editingScheduled.fileUrl && (
              <div style={{ marginBottom: '15px', background: inputBg, padding: '10px', borderRadius: '8px', border: `1px solid ${borderColor}`, textAlign: 'center' }}>
                {(editingScheduled.fileType === 'image' || editingScheduled.fileType?.startsWith('image')) ? (
                  <img src={editingScheduled.fileUrl} alt="Eklenti" style={{ maxWidth: '100%', maxHeight: '120px', borderRadius: '5px', objectFit: 'cover' }} />
                ) : (
                  <div style={{ padding: '10px 0', color: '#00a884', fontWeight: 'bold' }}>📎 Dosya Eklentisi</div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <Button text={editingScheduled.fileKey ? 'Dosyayı Değiştir' : 'Dosya Ekle'} onClick={() => replaceScheduledFile(editingScheduled.id)} />
              {editingScheduled.fileKey && <Button text="Dosyayı Kaldır" onClick={async () => { await removeScheduledFile(editingScheduled); setEditingScheduled((previous: any) => previous ? { ...previous, fileKey: null, fileUrl: null, fileType: null, fileName: null } : previous); }} style={{ background: '#e53935' }} />}
            </div>

            <textarea
              value={editScheduledText}
              onChange={(e) => setEditScheduledText(e.target.value)}
              style={{ width: '100%', minHeight: '110px', padding: '12px', borderRadius: '12px', border: `1px solid ${borderColor}`, background: inputBg, color: textColor, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontSize: '14px' }}
              placeholder="Mesajınızı düzenleyin..."
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '15px' }}>
              <Button text="İptal" onClick={() => setEditingScheduled(null)} style={{ background: 'transparent', color: iconColor, border: `1px solid ${borderColor}` }} />
              <Button text="Kaydet" onClick={handleSaveScheduledEdit} />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ALT KISIM: YAZMA VE ARAÇLAR ALANI */}
      {/* ========================================================= */}
      <div className="input-area" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '12px', padding: '12px 20px', background: panelBg, borderTop: `1px solid ${borderColor}`, position: 'relative' }}>
        {isUploading && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: borderColor }}>
            <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#00a884', transition: 'width 0.15s ease' }} />
          </div>
        )}

        {/* YANITLANAN MESAJ GÖSTERGESİ */}
        {replyingTo && (
          <div style={{ position: 'absolute', top: '-52px', left: '20px', right: '20px', background: inputBg, padding: '10px 15px', borderRadius: '8px 8px 0 0', border: `1px solid ${borderColor}`, borderBottom: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10, boxShadow: '0 -2px 10px rgba(0,0,0,0.05)' }}>
             <div style={{ borderLeft: '4px solid #00a884', paddingLeft: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#00a884' }}>{replyingTo.sender?.username || 'Kullanıcı'} kişisine yanıt veriliyor</div>
                <div style={{ fontSize: '13px', color: textColor, opacity: 0.8 }}>{replyingTo.content.substring(0, 60)}...</div>
             </div>
             <button onClick={() => setReplyingTo(null)} style={{ background: 'none', border: 'none', color: iconColor, cursor: 'pointer', fontSize: '16px' }}>✖</button>
          </div>
        )}

        {/* ZAMANLAMA KUTUSU */}
        {isScheduling && (
          <div style={{ position: 'absolute', bottom: '75px', right: '20px', background: inputBg, padding: '15px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 100, border: `1px solid ${borderColor}`, color: textColor }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#00a884' }}>Gönderimi Planla</span>
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
          <div style={{ position: 'absolute', top: replyingTo ? '-130px' : '-80px', left: '20px', background: inputBg, padding: '10px', borderRadius: '8px', border: `1px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: '15px', zIndex: 10, boxShadow: '0 -2px 10px rgba(0,0,0,0.05)' }}>
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
            <Button variant="icon" onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowAttachmentMenu(false); }} title="Emoji Ekle" style={{ color: iconColor }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M9.153 11.603c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962zm-3.204 1.362c-.026-.307-.131 5.218 6.063 5.551 6.066-.25 6.066-5.551 6.066-5.551-6.078 1.416-12.129 0-12.129 0zm11.363 1.108s-.669 1.959-5.051 1.959c-3.505 0-5.388-1.164-5.607-1.959 0 0 5.912 1.055 10.658 0zM11.804 1.011C5.609 1.011.978 6.033.978 12.228s4.826 10.761 11.021 10.761S23.02 18.423 23.02 12.228c.001-6.195-5.021-11.217-11.216-11.217zM12 21.354c-5.273 0-9.381-3.886-9.381-9.159s3.942-9.548 9.215-9.548 9.548 4.275 9.548 9.548c-.001 5.272-4.109 9.159-9.382 9.159zm3.108-9.751c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962z"></path></svg>} />
            {showEmojiPicker && (
              <div style={{ position: 'absolute', bottom: '55px', left: '0', zIndex: 1000, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                <EmojiPicker onEmojiClick={(emojiData: EmojiClickData) => setNewMessage(newMessage + emojiData.emoji)} theme={isDarkMode ? Theme.DARK : Theme.LIGHT} emojiStyle={EmojiStyle.APPLE} lazyLoadEmojis={true} suggestedEmojisMode={SuggestionMode.RECENT} previewConfig={{ showPreview: false }} />
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
             <Button variant="icon" onClick={() => { setShowAttachmentMenu(!showAttachmentMenu); setShowEmojiPicker(false); }} title="Dosya Ekle" style={{ color: iconColor, transform: showAttachmentMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }} icon={<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.816 15.556v.002c0 1.502.584 2.912 1.646 3.972s2.472 1.647 3.974 1.647a5.58 5.58 0 0 0 3.972-1.645l9.547-9.548c.769-.768 1.147-1.767 1.058-2.817-.079-.968-.548-1.927-1.319-2.698-1.594-1.592-4.068-1.711-5.517-.262l-7.916 7.915c-.881.881-.792 2.25.214 3.261.959.958 2.423 1.053 3.263.215l5.511-5.512c.28-.28.267-.722.053-.936l-.244-.244c-.191-.191-.567-.349-.957.04l-5.506 5.506c-.18.18-.635.127-.976-.214-.098-.097-.576-.613-.213-.973l7.915-7.917c.818-.817 2.267-.699 3.23.262.5.501.802 1.1.849 1.685.051.573-.156 1.111-.589 1.543l-9.547 9.549a3.97 3.97 0 0 1-2.829 1.171 3.975 3.975 0 0 1-2.83-1.173 3.973 3.973 0 0 1-1.172-2.828c0-1.071.415-2.076 1.172-2.83l7.209-7.211c.157-.157.264-.579.028-.814L11.5 4.36a.57.57 0 0 0-.834.018l-7.205 7.207a5.577 5.577 0 0 0-1.645 3.971z"></path></svg>} />

             {showAttachmentMenu && (
               <div style={{ position: 'absolute', bottom: '55px', left: '0', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '12px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)', zIndex: 100, minWidth: '160px' }}>
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
          style={{ flex: 1, padding: '12px 15px', borderRadius: '8px', border: `1px solid ${borderColor}`, outline: 'none', backgroundColor: inputBg, color: textColor, fontSize: '15px' }}
        />

        <button
          onClick={toggleVoiceRecording}
          disabled={isUploading}
          title={isRecordingAudio ? 'Kaydı bitir ve gönder' : 'Sesli mesaj kaydet'}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: 'none',
            background: isRecordingAudio ? '#e53935' : '#00a884',
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
          <button onClick={handleSend} style={{ background: '#00a884', color: 'white', border: 'none', padding: '10px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817z"></path></svg>
          </button>
          <button onClick={() => setIsScheduling(!isScheduling)} style={{ background: '#009071', color: 'white', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.2)', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▼</button>
        </div>

      </div>

      <style>{`
        .msg-dropdown-btn { width: 100%; text-align: left; padding: 12px 15px; border: none; background: transparent; color: ${textColor}; font-size: 14px; cursor: pointer; transition: background 0.2s; }
        .msg-dropdown-btn:hover { background: ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}; }
        .msg-dropdown-btn.danger-text { color: #e53935; font-weight: bold; }
        .msg-dropdown-btn.danger-text:hover { background: ${isDarkMode ? 'rgba(229, 57, 53, 0.15)' : '#ffebee'}; }
      `}</style>
    </div>
  );
}
