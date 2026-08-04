import { useState, useRef, useEffect } from 'react';
import type { Message } from '../types/chat';

/**
 * useMessageInput bileşenine iletilen prop'ların tip tanımlamaları.
 */
interface UseMessageInputProps {
  /** Kullanıcı metin yazmaya başladığında veya bıraktığında tetiklenen callback (isTyping: boolean) */
  onTyping: (isTyping: boolean) => void;
  /** O anda aktif olan sohbetin ID'si */
  conversationId?: string | null;
  /** Mesaj metin alanı değeri */
  newMessageProp: string;
  /** Mesaj metin alanı değerini güncelleyen setter fonksiyonu */
  setNewMessageProp: (val: string) => void;
}

/**
 * Mesaj giriş alanının (Input) durumunu, yanıtlanan mesaj (reply), mesaj zamanlama (scheduling)
 * ve 3 saniyelik "yazıyor..." (typing) durumlarının yaşam döngüsünü yöneten özel React Hook.
 */
export function useMessageInput({ onTyping, conversationId, newMessageProp, setNewMessageProp }: UseMessageInputProps) {
  /** Yanıt verilmek üzere seçilmiş mesaj nesnesi (Varsayılan: null) */
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  /** Mesaj zamanlama panelinin açık olup olmadığı bilgisi */
  const [isScheduling, setIsScheduling] = useState(false);
  /** Mesajın gelecekte gönderilmesi için seçilen tarih ve saat */
  const [scheduleTime, setScheduleTime] = useState<Date | null>(null);
  
  /** 3 saniyelik "yazıyor..." pasifleşme zamanlayıcısının (timer) referansı */
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** En güncel callback fonksiyonlarını tutan referans */
  const callbacksRef = useRef({ onTyping, setNewMessageProp });

  // Callback referanslarını günceller
  useEffect(() => {
    callbacksRef.current = { onTyping, setNewMessageProp };
  }, [onTyping, setNewMessageProp]);

  // Aktif sohbet (conversationId) değiştiğinde tüm girdi ve zamanlama durumlarını sıfırlar
  useEffect(() => {
    callbacksRef.current.setNewMessageProp('');
    setReplyingTo(null);
    setIsScheduling(false);
    setScheduleTime(null);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      callbacksRef.current.onTyping(false);
    }
  }, [conversationId]);

  // Hook unmount olduğunda (ekrandan kaldırıldığında) zamanlayıcıyı temizler
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Kullanıcı girdi kutusuna metin yazdığında çalışan fonksiyon.
   * Metin doluysa `onTyping(true)` yayınlar ve 3 saniye sonra otomatik durması için zamanlayıcı başlatır.
   */
  const handleInputChange = (val: string) => {
    setNewMessageProp(val);

    if (val.trim() && conversationId) {
      onTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false);
      }, 3000);
    } else {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      onTyping(false);
    }
  };

  /**
   * Mesaj gönderildikten veya iptal edildikten sonra metin alanını ve yanıt durumunu temizler.
   */
  const handleClearInput = () => {
    setNewMessageProp('');
    setReplyingTo(null);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    onTyping(false);
  };

  return {
    newMessage: newMessageProp,
    setNewMessage: handleInputChange,
    clearMessageInput: handleClearInput,
    replyingTo,
    setReplyingTo,
    isScheduling,
    setIsScheduling,
    scheduleTime,
    setScheduleTime,
  };
}

