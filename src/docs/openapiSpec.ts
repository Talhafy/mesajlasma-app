export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Mesajlaşma Uygulaması REST API',
    version: '1.0.0',
    description: 'Birebir sohbetler, grup mesajlaşması, sesli/yazılı oyun kanalları, zamanlanmış mesajlar ve dosya paylaşımı için güvenli REST API dokümantasyonu.'
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1 Sunucusu (Birincil)'
    },
    {
      url: '/api',
      description: 'API Legacy Sunucusu (Takma Ad)'
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token Yetkilendirmesi (Authorization: Bearer <token>)'
      },
      CookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'refresh_token',
        description: 'Yalnızca /auth/refresh uç noktasında kullanılan HttpOnly refresh token cookie'
      }
    },
    schemas: {
      AppErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Bu sohbete erişim yetkiniz yok.' },
          code: {
            type: 'string',
            example: 'CONVERSATION_FORBIDDEN',
            enum: [
              'CONVERSATION_FORBIDDEN',
              'MESSAGE_NOT_FOUND',
              'ASSET_NOT_OWNED',
              'VALIDATION_ERROR',
              'CONVERSATION_NOT_FOUND',
              'MESSAGE_FORBIDDEN',
              'CHANNEL_NOT_FOUND',
              'CHANNEL_FORBIDDEN',
              'CHANNEL_LIMIT_REACHED',
              'CHANNEL_DUPLICATE',
              'USER_NOT_FOUND',
              'USER_BLOCKED',
              'CANNOT_BLOCK_SELF',
              'CANNOT_CHAT_SELF',
              'UNAUTHORIZED',
              'INVALID_CREDENTIALS',
              'ASSET_EXPIRED_OR_REJECTED',
              'FILE_NOT_FOUND',
              'MALWARE_DETECTED',
              'MALWARE_SCANNER_UNAVAILABLE',
              'FORBIDDEN',
              'NOT_FOUND',
              'CONFLICT',
              'BAD_REQUEST',
              'RATE_LIMIT_EXCEEDED',
              'INTERNAL_ERROR'
            ]
          },
          details: { type: 'object', nullable: true }
        },
        required: ['error', 'code']
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string' },
          avatarFileKey: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
          lastSeenAt: { type: 'string', format: 'date-time', nullable: true }
        },
        required: ['id', 'username']
      },
      Conversation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          isGroup: { type: 'boolean' },
          name: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
          isPinned: { type: 'boolean' },
          isArchived: { type: 'boolean' },
          isMuted: { type: 'boolean' }
        },
        required: ['id', 'isGroup']
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          conversationId: { type: 'string', format: 'uuid' },
          senderId: { type: 'string', format: 'uuid' },
          senderName: { type: 'string' },
          content: { type: 'string' },
          fileKey: { type: 'string', nullable: true },
          fileUrl: { type: 'string', nullable: true },
          fileType: { type: 'string', nullable: true },
          fileName: { type: 'string', nullable: true },
          isPinned: { type: 'boolean' },
          isStarred: { type: 'boolean' },
          isRead: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'conversationId', 'senderId', 'content', 'createdAt']
      },
      GameChannel: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          conversationId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['TEXT', 'VOICE'] },
          position: { type: 'integer' },
          maxParticipants: { type: 'integer', nullable: true }
        },
        required: ['id', 'conversationId', 'name', 'type', 'position']
      }
    }
  },
  security: [
    { BearerAuth: [] }
  ],
  paths: {
    '/auth/register': {
      post: {
        tags: ['Kimlik Doğrulama'],
        summary: 'Yeni kullanıcı kaydı oluşturur',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  username: { type: 'string', example: 'ahmet_yilmaz' },
                  email: { type: 'string', format: 'email', example: 'ahmet@example.com' },
                  password: { type: 'string', example: 'StrongP@ss123' }
                },
                required: ['username', 'email', 'password']
              }
            }
          }
        },
        responses: {
          '201': { description: 'Kullanıcı oluşturuldu' },
          '400': { $ref: '#/components/schemas/AppErrorResponse' },
          '409': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      }
    },
    '/auth/login': {
      post: {
        tags: ['Kimlik Doğrulama'],
        summary: 'Kullanıcı girişi yapar ve access token döner',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  identifier: { type: 'string', example: 'ahmet@example.com' },
                  password: { type: 'string', example: 'StrongP@ss123' }
                },
                required: ['identifier', 'password']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Giriş başarılı' },
          '401': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      }
    },
    '/auth/refresh': {
      post: {
        tags: ['Kimlik Doğrulama'],
        summary: 'Refresh cookie kullanarak yeni access token üretir',
        security: [{ CookieAuth: [] }],
        responses: {
          '200': { description: 'Token yenilendi' },
          '401': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      }
    },
    '/auth/logout': {
      post: {
        tags: ['Kimlik Doğrulama'],
        summary: 'Oturumu kapatır ve refresh cookie yi temizler',
        responses: {
          '200': { description: 'Çıkış yapıldı' }
        }
      }
    },
    '/health/ready': {
      get: {
        tags: ['Sistem Sağlığı'],
        summary: 'Veritabanı ve Redis hazırlık durumunu döner',
        security: [],
        responses: {
          '200': { description: 'Sistem hazır' },
          '503': { description: 'Sistem servis dışı' }
        }
      }
    },
    '/conversations': {
      get: {
        tags: ['Sohbetler'],
        summary: 'Kullanıcının sohbet listesini getirir',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Conversation' } }
              }
            }
          }
        }
      }
    },
    '/conversations/direct': {
      post: {
        tags: ['Sohbetler'],
        summary: 'Birebir sohbet başlatır',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { targetUserId: { type: 'string', format: 'uuid' } },
                required: ['targetUserId']
              }
            }
          }
        },
        responses: {
          '200': { $ref: '#/components/schemas/Conversation' },
          '400': { $ref: '#/components/schemas/AppErrorResponse' },
          '404': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      }
    },
    '/conversations/group': {
      post: {
        tags: ['Sohbetler'],
        summary: 'Yeni grup sohbeti oluşturur',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  participantIds: { type: 'array', items: { type: 'string', format: 'uuid' } }
                },
                required: ['name', 'participantIds']
              }
            }
          }
        },
        responses: {
          '201': { $ref: '#/components/schemas/Conversation' },
          '400': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      }
    },
    '/messages': {
      post: {
        tags: ['Mesajlaşma'],
        summary: 'Sohbete veya kanala mesaj gönderir',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  conversationId: { type: 'string', format: 'uuid' },
                  clientId: { type: 'string', format: 'uuid' },
                  content: { type: 'string' },
                  fileKey: { type: 'string', nullable: true },
                  replyToId: { type: 'string', format: 'uuid', nullable: true }
                },
                required: ['conversationId', 'clientId']
              }
            }
          }
        },
        responses: {
          '201': { $ref: '#/components/schemas/Message' },
          '400': { $ref: '#/components/schemas/AppErrorResponse' },
          '403': { $ref: '#/components/schemas/AppErrorResponse' },
          '404': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      }
    },
    '/conversations/{conversationId}/messages': {
      get: {
        tags: ['Mesajlaşma'],
        summary: 'Sohbet mesajlarını cursor pagination ile getirir',
        parameters: [
          { name: 'conversationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'cursor', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Message' } }
              }
            }
          },
          '403': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      }
    },
    '/game/groups/{groupId}/channels': {
      get: {
        tags: ['Oyun Kanalları'],
        summary: 'Oyun grubunun sesli ve yazılı kanallarını listeler',
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        responses: {
          '200': { description: 'Kanal listesi' },
          '403': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      },
      post: {
        tags: ['Oyun Kanalları'],
        summary: 'Oyun grubunda yeni kanal oluşturur',
        parameters: [
          { name: 'groupId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['TEXT', 'VOICE'] },
                  maxParticipants: { type: 'integer', nullable: true }
                },
                required: ['name', 'type']
              }
            }
          }
        },
        responses: {
          '201': { $ref: '#/components/schemas/GameChannel' },
          '400': { $ref: '#/components/schemas/AppErrorResponse' },
          '409': { $ref: '#/components/schemas/AppErrorResponse' }
        }
      }
    }
  }
};
