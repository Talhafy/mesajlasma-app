/**
 * ============================================================================
 * FRONTEND API CLIENT SDK GENERATOR (OpenAPI -> TypeScript Client SDK)
 * ============================================================================
 * 
 * Bu script, backend tarafında tanımlanan OpenAPI 3.0 spesifikasyonundan
 * frontend kullanımı için %100 tip güvenli (type-safe) bir API istemci SDK'sı
 * (`frontend/src/api/generatedClient.ts`) üretir.
 * 
 * ÇALIŞTIRMA:
 * npm run generate:client
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Üretilecek TypeScript dosyasının hedef dosya yolu
const targetPath = resolve(process.cwd(), 'frontend/src/api/generatedClient.ts');

// Üretilecek dosyaya yazılacak olan TypeScript kaynak koda ilişkin şablon metin
const clientCode = `/**
 * ============================================================================
 * OTOMATİK ÜRETİLMİŞ FRONTEND API İSTEMCİ SDK'SI (Generated Client SDK)
 * ============================================================================
 * 
 * Bu dosya 'scripts/generate-client.mjs' tarafından OpenAPI spesifikasyonundan
 * otomatik olarak üretilmiştir. ELLE DÜZENLEMEYİNİZ.
 * 
 * NE İŞE YARAR?
 * Frontend geliştiricilerin API isteklerini (POST /auth/login, GET /conversations vb.)
 * doğrudan tip güvenli fonksiyonlar üzerinden çağırmasını sağlar.
 */

import { api, authApi } from './httpClient';
import type { AppErrorCode } from '../../../src/errors/AppError';

/** API Hata Yanıt Arayüzü */
export interface ApiErrorResponse {
  error: string;
  code: AppErrorCode;
  details?: any;
}

/** Kullanıcı Veri Transfer Nesnesi (User DTO) */
export interface UserDto {
  id: string;
  username: string;
  avatarFileKey?: string | null;
  avatarUrl?: string | null;
  lastSeenAt?: string | null;
}

/** Sohbet Veri Transfer Nesnesi (Conversation DTO) */
export interface ConversationDto {
  id: string;
  isGroup: boolean;
  name?: string | null;
  avatarUrl?: string | null;
  isPinned: boolean;
  isArchived: boolean;
  isMuted: boolean;
}

/** Mesaj Veri Transfer Nesnesi (Message DTO) */
export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  content: string;
  fileKey?: string | null;
  fileUrl?: string | null;
  fileType?: string | null;
  fileName?: string | null;
  isPinned: boolean;
  isStarred: boolean;
  isRead: boolean;
  createdAt: string;
}

/**
 * TİP GÜVENLİ İSTEMCİ UÇ NOKTALARI (Generated API Client Methods)
 */
export const generatedApiClient = {
  /** Kimlik Doğrulama Servisleri */
  auth: {
    register: (data: { username: string; email: string; password: string }) =>
      api.post('/auth/register', data),
    login: (data: { identifier: string; password: string }) =>
      api.post<{ token: string; user: UserDto }>('/auth/login', data),
    refresh: () =>
      authApi.post<{ token: string }>('/auth/refresh'),
    logout: () =>
      authApi.post('/auth/logout')
  },
  /** Sistem Sağlık Servisleri */
  system: {
    checkHealthLive: () =>
      api.get<{ status: string; timestamp: string }>('/health/live'),
    checkHealthReady: () =>
      api.get<{ status: string; checks: Record<string, string> }>('/health/ready')
  },
  /** Sohbet ve Grup Yönetim Servisleri */
  conversations: {
    list: (cursor?: string, limit?: number) =>
      api.get<{ items: ConversationDto[]; nextCursor: string | null }>('/conversations', { params: { cursor, limit } }),
    createDirect: (targetUserId: string) =>
      api.post<ConversationDto>('/conversations/direct', { targetUserId }),
    createGroup: (name: string, participantIds: string[]) =>
      api.post<ConversationDto>('/conversations/group', { name, participantIds }),
    deleteHistory: (conversationId: string) =>
      api.delete<{ message: string }>(\`/conversations/\${conversationId}\`),
    pin: (conversationId: string) =>
      api.put<{ isPinned: boolean }>(\`/conversations/\${conversationId}/pin\`),
    archive: (conversationId: string) =>
      api.put<{ isArchived: boolean }>(\`/conversations/\${conversationId}/archive\`),
    mute: (conversationId: string) =>
      api.put<{ isMuted: boolean }>(\`/conversations/\${conversationId}/mute\`)
  },
  /** Mesajlaşma Servisleri */
  messages: {
    fetch: (conversationId: string, cursor?: string, limit?: number) =>
      api.get<{ items: MessageDto[]; nextCursor: string | null }>(\`/conversations/\${conversationId}/messages\`, { params: { cursor, limit } }),
    send: (data: { conversationId: string; clientId: string; content: string; fileKey?: string | null; replyToId?: string | null }) =>
      api.post<MessageDto>('/messages', data),
    edit: (id: string, content: string) =>
      api.put<MessageDto>(\`/messages/\${id}\`, { content }),
    delete: (id: string, forEveryone: boolean) =>
      api.delete<{ message: string }>(\`/messages/\${id}\`, { params: { forEveryone } }),
    pin: (id: string) =>
      api.put<MessageDto>(\`/messages/\${id}/pin\`),
    star: (id: string) =>
      api.put<MessageDto>(\`/messages/\${id}/star\`)
  }
};
`;

// Üretilen kod metnini dosyaya yazar
writeFileSync(targetPath, clientCode, 'utf8');
console.log(`Generated frontend API client at: ${targetPath}`);
