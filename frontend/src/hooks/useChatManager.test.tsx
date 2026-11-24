import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Conversation, Message } from '../types/chat';
import type { TypedSocket } from '../types/socket';
import { useChatManager } from './useChatManager';

const { api, readGroupHistory, saveGroupHistory, decryptMessageList, cacheGroupAttachment, deleteGroupHistory, deleteLocalHistoryMessage, clearLocalConversationHistory } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  readGroupHistory: vi.fn(),
  saveGroupHistory: vi.fn(),
  decryptMessageList: vi.fn(),
  cacheGroupAttachment: vi.fn(),
  deleteGroupHistory: vi.fn(),
  deleteLocalHistoryMessage: vi.fn(),
  clearLocalConversationHistory: vi.fn(async () => undefined)
}));

vi.mock('../api/httpClient', () => ({ api }));
vi.mock('../crypto/fileCrypto', () => ({ cacheGroupAttachment }));
vi.mock('../crypto/vault', () => ({
  isVaultUnlocked: () => true,
  clearLocalConversationHistory,
  readGroupHistory,
  saveGroupHistory,
  deleteGroupHistory,
  deleteLocalHistoryMessage
}));

it('opens a direct chat at the requested message and clears only messages through the selected cutoff', async () => {
  const { result } = renderChat();
  const target = { ...first, conversationId: 'direct', createdAt: '2026-11-20T12:00:00.000Z' };
  const recent = { ...target, id: 'new', createdAt: '2026-11-20T13:00:00.000Z' };
  api.post.mockResolvedValue({ data: { id: 'direct', isGroup: false } });
  api.get.mockResolvedValue({ data: { items: [target, recent], hasNewer: true, nextCursor: 'older' } });

  await act(() => result.current.startChat(otherUser, target.id));
  expect(api.get).toHaveBeenCalledWith('/conversations/direct/messages', { params: { anchor: target.id } });
  expect(result.current.messageFocus).toEqual({ conversationId: 'direct', messageId: target.id });
  expect(result.current.hasNewer).toBe(true);
  expect(result.current.autoScrollRef.current).toBe(false);

  await act(() => result.current.applyPersonalHistoryClear(user.id, 'direct', target.createdAt));
  expect(result.current.activeConversation?.id).toBe('direct');
  expect(result.current.messages).toEqual([recent]);
  expect(result.current.messageFocus).toBeNull();
});

it('loads recent chats when history cutoffs arrive first during startup', async () => {
  const { result, socket } = renderChat();
  const clearedAt = '2026-11-20T12:00:00.000Z';
  const cleared = {
    id: 'direct', isGroup: false, otherUser, lastMessage: { ...first, conversationId: 'direct', createdAt: clearedAt }
  } satisfies Conversation;
  const untouched = {
    id: 'another', isGroup: false, lastMessage: { ...last, conversationId: 'another', createdAt: clearedAt }
  } satisfies Conversation;
  let resolveList!: (value: { data: { items: Conversation[] } }) => void;
  api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
  const listRequest = result.current.fetchConversations(user.id);

  api.get.mockResolvedValueOnce({ data: [{ conversationId: cleared.id, clearedAt }] });
  const syncCutoffs = socket.on.mock.calls.filter(([event]) => event === 'connect').at(-1)?.[1];
  await act(async () => { syncCutoffs?.(); });
  expect(clearLocalConversationHistory).toHaveBeenCalledWith(user.id, cleared.id, clearedAt);
  await act(async () => {
    resolveList({ data: { items: [cleared, untouched] } });
    await listRequest;
  });

  expect(result.current.conversationList).toEqual([
    expect.objectContaining({ id: cleared.id, historyClearedAt: clearedAt, lastMessage: null }),
    untouched
  ]);
});

it('keeps a post-clear message when an older conversation refresh resolves later', async () => {
  const { result } = renderChat();
  const cutoff = '2026-11-20T12:00:00.000Z';
  const conversation = { id: 'direct', isGroup: false, historyClearedAt: cutoff } satisfies Conversation;
  const recent = { ...last, conversationId: conversation.id, createdAt: '2026-11-20T13:00:00.000Z' };
  let resolveOlder!: (value: { data: { items: Conversation[] } }) => void;
  api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve; }))
    .mockResolvedValueOnce({ data: { items: [{ ...conversation, lastMessage: recent }] } });
  await act(() => result.current.applyPersonalHistoryClear(user.id, conversation.id, cutoff));
  const olderRequest = result.current.fetchConversations(user.id);
  await act(() => result.current.fetchConversations(user.id));
  await act(async () => {
    resolveOlder({ data: { items: [{ ...conversation, lastMessage: null }] } });
    await olderRequest;
  });

  expect(result.current.conversationList[0]?.lastMessage).toEqual(recent);
});

it('keeps recent chats available while the former group cache is being cleaned', async () => {
  const { result } = renderChat();
  const clearedAt = '2026-11-20T12:00:00.000Z';
  const removed = { ...first, createdAt: clearedAt };
  const recent = { ...last, createdAt: '2026-11-20T12:30:00.000Z' };
  const formerGroup = { ...group, historyClearedAt: clearedAt, lastMessage: recent };
  let finishCleanup!: () => void;
  clearLocalConversationHistory.mockImplementationOnce(() => new Promise((resolve) => {
    finishCleanup = () => resolve(undefined);
  }));
  readGroupHistory.mockResolvedValue({ leftAt: group.leftAt, messages: [removed, recent], attachmentsReady: true });
  api.get.mockResolvedValueOnce({ data: { items: [formerGroup] } });
  const listRequest = result.current.fetchConversations(user.id);

  try {
    await waitFor(() => expect(result.current.conversationList).toEqual([formerGroup]));
    await act(() => result.current.startGroupChat(formerGroup));
    expect(result.current.messages).toEqual([recent]);
  } finally {
    await act(async () => {
      finishCleanup();
      await listRequest;
    });
  }
});

vi.mock('../crypto/mlsClient', () => ({
  decryptIncomingMessage: async (_userId: string, message: Message) => message,
  decryptMessageList,
  ensureDeviceRegistered: vi.fn()
}));

const user = { id: 'me', username: 'Ben' };
const otherUser = { id: 'other', username: 'Diğer' };
const group = { id: 'group', isGroup: true, isActive: false, leftAt: '2026-11-20T13:00:00Z' } satisfies Conversation;
const first = { id: 'first', conversationId: group.id, senderId: otherUser.id, content: 'İlk mesaj' } satisfies Message;
const last = { ...first, id: 'last', content: 'Son mesaj' };

const renderChat = () => {
  const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
  const onlineUserIds = new Set<string>();
  const hook = renderHook(() => useChatManager({
    socket: socket as unknown as TypedSocket,
    currentUser: user,
    onlineUserIds,
    onlineUserIdsRef: { current: onlineUserIds }
  }));
  return { ...hook, socket };
};

beforeEach(() => {
  vi.resetAllMocks();
  readGroupHistory.mockResolvedValue(null);
  decryptMessageList.mockImplementation(async (_userId, messages) => messages);
});

it('refreshes every directory page when another account finishes setting up its vault', async () => {
  const { result, socket } = renderChat();
  api.get.mockResolvedValueOnce({ data: { items: [otherUser] } });
  await act(() => result.current.fetchUsers());

  const readyUser = { id: 'ready', username: 'Yeni kullanıcı' };
  api.get.mockResolvedValueOnce({ data: { items: [otherUser], nextCursor: otherUser.id } })
    .mockResolvedValueOnce({ data: { items: [readyUser] } });

  const refresh = socket.on.mock.calls.find(([event]) => event === 'user_directory_changed')?.[1];
  expect(refresh).toBeTypeOf('function');
  act(() => refresh());

  await waitFor(() => expect(result.current.usersList).toEqual([
    { ...otherUser, isOnline: false },
    { ...readyUser, isOnline: false }
  ]));
  expect(api.get).toHaveBeenLastCalledWith('/users', { params: { cursor: otherUser.id, limit: 100 } });
});

it('opens a former group from the vault after direct chat without making group requests', async () => {
  const { result, socket } = renderChat();
  api.post.mockResolvedValue({ data: { id: 'direct', isGroup: false } });
  api.get.mockResolvedValue({ data: { items: [{ ...last, conversationId: 'direct' }] } });
  readGroupHistory.mockResolvedValue({ leftAt: group.leftAt, messages: [first, last] });

  await act(() => result.current.startChat(otherUser));
  expect(result.current.activeConversation?.id).toBe('direct');
  api.get.mockClear();
  api.post.mockClear();
  socket.emit.mockClear();

  await act(() => result.current.startGroupChat(group));

  expect(result.current.messages).toEqual([first, last]);
  expect(result.current.hasMore).toBe(false);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(socket.emit).not.toHaveBeenCalled();
});

it('saves all former-group history pages in chronological order during conversation sync', async () => {
  const { result } = renderChat();
  const afterLeaving = { ...last, id: 'new', createdAt: '2026-11-20T13:00:01Z' };
  const attachment = { ...last, fileUrl: 'temporary-url', fileKey: 'file', fileName: 'rapor.pdf', fileType: 'document' };
  api.get.mockResolvedValueOnce({ data: { items: [group] } })
    .mockResolvedValueOnce({ data: { items: [attachment, afterLeaving], nextCursor: last.id } })
    .mockResolvedValueOnce({ data: { items: [first], nextCursor: null } });

  await act(() => result.current.fetchConversations(user.id));

  await waitFor(() => expect(saveGroupHistory).toHaveBeenCalledWith(user.id, group.id, {
    leftAt: group.leftAt,
    historyId: undefined,
    attachmentsReady: true,
    messages: [{ ...first, archivedFileAvailable: false }, { ...attachment, fileUrl: undefined, archivedFileAvailable: true }]
  }));
  expect(api.get).toHaveBeenLastCalledWith(`/conversations/${group.id}/messages`, expect.objectContaining({ params: { cursor: last.id } }));
  expect(decryptMessageList).toHaveBeenCalledWith(user.id, [first, attachment], false);
  expect(cacheGroupAttachment).toHaveBeenCalledWith(user.id, attachment, expect.any(AbortSignal));
  expect(api.post).not.toHaveBeenCalled();
});

it('shows legacy local history alongside active history after rejoining a group', async () => {
  const { result } = renderChat();
  const old = { ...first, createdAt: '2026-11-19T13:00:00Z' };
  const current = { ...last, createdAt: '2026-11-21T14:00:00Z' };
  const returned = { ...group, isActive: true, leftAt: null };
  readGroupHistory.mockResolvedValue({ leftAt: group.leftAt, messages: [old] });
  api.get.mockResolvedValue({ data: { items: [current], historySince: '2026-11-21T13:00:00Z', nextCursor: 'cursor' } });
  api.post.mockResolvedValue({});

  await act(() => result.current.startGroupChat(returned));

  expect(result.current.messages).toEqual([{ ...old, isLocalGroupHistory: true }, current]);
  expect(result.current.hasMore).toBe(true);
});

it('clears a pinned former group and ignores a conversation list response that began before deletion', async () => {
  const { result } = renderChat();
  const pinned = { ...group, isPinned: true };
  readGroupHistory.mockResolvedValue({ leftAt: group.leftAt, messages: [first, last], attachmentsReady: true });
  api.get.mockResolvedValueOnce({ data: { items: [pinned] } });
  await act(() => result.current.fetchConversations(user.id));
  await act(() => result.current.startGroupChat(pinned));

  let resolveList!: (value: { data: { items: Conversation[] } }) => void;
  api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
  const staleList = result.current.fetchConversations(user.id);
  await act(() => result.current.clearGroupHistory(user.id, pinned.id));
  await act(async () => {
    resolveList({ data: { items: [pinned] } });
    await staleList;
  });

  expect(deleteGroupHistory).toHaveBeenCalledWith(user.id, pinned.id);
  expect(result.current.conversationList).toEqual([]);
  expect(result.current.activeConversation).toBeNull();
  expect(result.current.messages).toEqual([]);
});

it('keeps a personally deleted message out of a former group when it is opened again', async () => {
  const { result } = renderChat();
  readGroupHistory.mockResolvedValue({ leftAt: group.leftAt, messages: [first, last] });
  await act(() => result.current.startGroupChat(group));
  await act(() => result.current.forgetHistoryMessage(user.id, group.id, last.id));
  await act(() => result.current.startGroupChat(group));

  expect(deleteLocalHistoryMessage).toHaveBeenCalledWith(user.id, group.id, last.id);
  expect(result.current.messages).toEqual([first]);
});

it('rehydrates already loaded messages as soon as a history backup is restored', async () => {
  const { result } = renderChat();
  const active = { ...group, isActive: true, leftAt: null };
  const encrypted = { ...first, content: '', ciphertext: 'encrypted', protocolVersion: 2 };
  const pending = { ...encrypted, decryptionPending: true };
  api.get.mockImplementation(async (path: string) => ({ data: { items: path.endsWith('/messages') ? [encrypted] : [active] } }));
  api.post.mockResolvedValue({});
  decryptMessageList.mockResolvedValueOnce([pending]);
  await act(() => result.current.startGroupChat(active));
  expect(result.current.messages).toEqual([pending]);

  decryptMessageList.mockResolvedValue([{ ...encrypted, content: first.content, decryptionPending: false }]);
  act(() => { window.dispatchEvent(new Event('message-vault-unlocked')); });

  await waitFor(() => expect(result.current.messages[0]).toMatchObject({ content: first.content, decryptionPending: false }));
});
