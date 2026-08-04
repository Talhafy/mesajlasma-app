import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageInput } from './useMessageInput';

/**
 * useMessageInput özel hook'u için birim (unit) test süiti.
 * Yazıyor (typing) durumunun gecikmeli sıfırlanması (debounce), sohbet değiştirildiğinde state sıfırlama
 * ve unmount temizlik işlemlerinin doğruluğunu test eder.
 */
describe('useMessageInput Hook Testleri', () => {
  // Testlerden önce sahte zamanlayıcıları (fake timers) etkinleştirir
  beforeEach(() => vi.useFakeTimers());
  // Testlerden sonra gerçek zamanlayıcılara geri döner
  afterEach(() => vi.useRealTimers());

  /**
   * Test 1: Metin yazıldığında 'yazıyor' (typing) durumunun aktifleştiğini 
   * ve belirlenen süre (3000ms) dolduğunda otomatik olarak pasifleştiğini doğrular.
   */
  it('Yazıyor durumunu tetiklemeli ve gecikme süresi dolduğunda (debounce) durdurmalı', () => {
    const onTyping = vi.fn();
    const setMessage = vi.fn();
    
    // Hook render edilir
    const { result } = renderHook(() => useMessageInput({
      onTyping,
      conversationId: 'conversation-1',
      newMessageProp: '',
      setNewMessageProp: setMessage
    }));
    onTyping.mockClear();
    setMessage.mockClear();

    // Kullanıcının metin girdiğini simüle et
    act(() => result.current.setNewMessage('Merhaba'));
    expect(setMessage).toHaveBeenCalledWith('Merhaba');
    expect(onTyping).toHaveBeenCalledWith(true);

    // Zamanlayıcıyı 3 saniye (3000ms) ileri al
    act(() => vi.advanceTimersByTime(3000));
    // 3 saniye sonra 'yazıyor: false' çağrılmış olmalı
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  /**
   * Test 2: Aktif sohbet ID'si değiştiğinde yanıtlanan mesaj, zamanlama ve taslak metin durumlarının temizlendiğini doğrular.
   */
  it('Sohbet değiştiğinde (conversationId) yanıtlama, zamanlama ve metin durumlarını temizlemeli', () => {
    const onTyping = vi.fn();
    const setMessage = vi.fn();
    
    // İlk sohbet ID'si ile hook render edilir
    const { result, rerender } = renderHook(
      ({ conversationId }) => useMessageInput({ onTyping, conversationId, newMessageProp: 'taslak', setNewMessageProp: setMessage }),
      { initialProps: { conversationId: 'conversation-1' } }
    );

    // Yanıtlanan mesaj ve zamanlanmış mesaj durumlarını ayarla
    act(() => {
      result.current.setReplyingTo({ id: 'm1', content: 'x', senderId: 'u1', conversationId: 'conversation-1' });
      result.current.setIsScheduling(true);
      result.current.setScheduleTime(new Date());
    });
    setMessage.mockClear();
    
    // Sohbet ID'sini 'conversation-2' olarak güncelle (Rerender)
    rerender({ conversationId: 'conversation-2' });

    // Tüm girdilerin ve durumların sıfırlandığı doğrulanır
    expect(setMessage).toHaveBeenCalledWith('');
    expect(result.current.replyingTo).toBeNull();
    expect(result.current.isScheduling).toBe(false);
    expect(result.current.scheduleTime).toBeNull();
  });

  /**
   * Test 3: Giriş alanı tamamen silindiğinde veya temizlendiğinde yazıyor durumunun hemen durduğunu doğrular.
   */
  it('Girdi boşaltıldığında veya temizlendiğinde yazıyor durumunu hemen durdurmalı', () => {
    const onTyping = vi.fn();
    const setMessage = vi.fn();
    const { result } = renderHook(() => useMessageInput({
      onTyping,
      conversationId: 'conversation-1',
      newMessageProp: '',
      setNewMessageProp: setMessage
    }));
    onTyping.mockClear();

    // Metin yaz ve ardından hemen sil
    act(() => result.current.setNewMessage('yazılıyor'));
    act(() => result.current.setNewMessage(''));
    expect(onTyping).toHaveBeenLastCalledWith(false);

    // Metin yaz ve clearMessageInput ile temizle
    act(() => result.current.setNewMessage('yeniden'));
    act(() => result.current.clearMessageInput());
    expect(setMessage).toHaveBeenLastCalledWith('');
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  /**
   * Test 4: Hook ekrandan kaldırıldığında (unmount) aktif zamanlayıcıların (clearTimeout) temizlendiğini doğrular.
   */
  it('Bileşen ekrandan kaldırıldığında (unmount) aktif zamanlayıcıyı temizlemeli', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useMessageInput({
      onTyping: vi.fn(),
      conversationId: 'conversation-1',
      newMessageProp: '',
      setNewMessageProp: vi.fn()
    }));
    
    act(() => result.current.setNewMessage('taslak'));
    // Hook'u unmount et
    unmount();
    
    // clearTimeout fonksiyonunun çağrıldığı doğrulanır
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

