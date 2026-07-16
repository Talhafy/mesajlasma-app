import { useState, useRef, useEffect } from 'react';
import type { Message } from '../types/chat';

interface UseMessageInputProps {
  onTyping: (isTyping: boolean) => void;
  conversationId?: string | null;
  newMessageProp: string;
  setNewMessageProp: (val: string) => void;
}

export function useMessageInput({ onTyping, conversationId, newMessageProp, setNewMessageProp }: UseMessageInputProps) {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleTime, setScheduleTime] = useState<Date | null>(null);
  
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Sohbet değiştiğinde durumları temizle
    setNewMessageProp('');
    setReplyingTo(null);
    setIsScheduling(false);
    setScheduleTime(null);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      onTyping(false);
    }
  }, [conversationId]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

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
