import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageInput } from './useMessageInput';

describe('useMessageInput', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits typing state and stops it after the debounce window', () => {
    const onTyping = vi.fn();
    const setMessage = vi.fn();
    const { result } = renderHook(() => useMessageInput({
      onTyping,
      conversationId: 'conversation-1',
      newMessageProp: '',
      setNewMessageProp: setMessage
    }));
    onTyping.mockClear();
    setMessage.mockClear();

    act(() => result.current.setNewMessage('Merhaba'));
    expect(setMessage).toHaveBeenCalledWith('Merhaba');
    expect(onTyping).toHaveBeenCalledWith(true);

    act(() => vi.advanceTimersByTime(3000));
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it('clears reply, scheduling and text state when conversation changes', () => {
    const onTyping = vi.fn();
    const setMessage = vi.fn();
    const { result, rerender } = renderHook(
      ({ conversationId }) => useMessageInput({ onTyping, conversationId, newMessageProp: 'taslak', setNewMessageProp: setMessage }),
      { initialProps: { conversationId: 'conversation-1' } }
    );

    act(() => {
      result.current.setReplyingTo({ id: 'm1', content: 'x', senderId: 'u1', conversationId: 'conversation-1' });
      result.current.setIsScheduling(true);
      result.current.setScheduleTime(new Date());
    });
    setMessage.mockClear();
    rerender({ conversationId: 'conversation-2' });

    expect(setMessage).toHaveBeenCalledWith('');
    expect(result.current.replyingTo).toBeNull();
    expect(result.current.isScheduling).toBe(false);
    expect(result.current.scheduleTime).toBeNull();
  });

  it('stops typing when the input is emptied or explicitly cleared', () => {
    const onTyping = vi.fn();
    const setMessage = vi.fn();
    const { result } = renderHook(() => useMessageInput({
      onTyping,
      conversationId: 'conversation-1',
      newMessageProp: '',
      setNewMessageProp: setMessage
    }));
    onTyping.mockClear();

    act(() => result.current.setNewMessage('yazılıyor'));
    act(() => result.current.setNewMessage(''));
    expect(onTyping).toHaveBeenLastCalledWith(false);

    act(() => result.current.setNewMessage('yeniden'));
    act(() => result.current.clearMessageInput());
    expect(setMessage).toHaveBeenLastCalledWith('');
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it('cleans an active typing timer when unmounted', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useMessageInput({
      onTyping: vi.fn(),
      conversationId: 'conversation-1',
      newMessageProp: '',
      setNewMessageProp: vi.fn()
    }));
    act(() => result.current.setNewMessage('taslak'));
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
