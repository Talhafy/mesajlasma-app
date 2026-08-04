/**
 * ============================================================================
 * ZAMANLANMIŞ MESAJ BİLDİRİM DİNLEYİCİSİ (Scheduled Message Delivery Listener)
 * ============================================================================
 * 
 * Bu modül, arka planda çalışan zamanlanmış mesaj servisi (worker) tarafından
 * gönderilme zamanı gelip veritabanına yazılan mesajların bildirimini alır.
 * 
 * PostgreSQL `LISTEN/NOTIFY` mekanizmasını kullanarak çoklu API sunucusu (multi-instance)
 * mimarisinde tüm sunucu örneklerinin kendi Socket.IO istemcilerine anında bildirim 
 * (`yeni_mesaj_geldi`) yayınlamasını sağlar.
 */

import type { PoolClient } from 'pg';
import { Server } from 'socket.io';
import { logger } from '../config/logger';
import prisma, { pool } from '../db';
import { serializeMessage } from '../services/messageService';

/** PostgreSQL NOTIFY kanal adı */
const CHANNEL = 'scheduled_message_delivered';

/** Bağlantı kopması durumunda yeniden bağlanma bekleme süresi (5 saniye) */
const RETRY_DELAY_MS = 5_000;

/**
 * PostgreSQL NOTIFY kanalını dinleyerek zamanlanmış mesajlar teslim edildikçe 
 * Socket.IO odalarına yayını başlatan fonksiyon.
 */
export const startScheduledMessageDeliveryListener = (io: Server) => {
  let listener: PoolClient | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Bağlantı koptuğunda yeniden bağlanmayı zamanlayan yardımcı */
  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RETRY_DELAY_MS);
  };

  /** Teslim edilen mesajı veritabanından çekip Socket.IO ile ilgili odalara yayınlar */
  const broadcastMessage = async (messageId: string) => {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: { select: { username: true } },
        conversation: {
          select: {
            isGroup: true,
            isDeleted: true,
            participants: { where: { isActive: true }, select: { userId: true } }
          }
        },
        reads: { select: { userId: true } },
        stars: { select: { userId: true } },
        deletions: { select: { userId: true } }
      }
    });

    if (!message || message.conversation.isDeleted) return;
    const rooms = [
      ...new Set([
        message.conversationId,
        ...message.conversation.participants.map((participant) => participant.userId)
      ])
    ];
    io.to(rooms).emit('yeni_mesaj_geldi', await serializeMessage(message));
  };

  /** PostgreSQL havuzundan istemci alıp LISTEN komutunu çalıştıran ana bağlantı döngüsü */
  const connect = async (): Promise<void> => {
    try {
      const nextListener = await pool.connect();
      if (stopped) {
        nextListener.release();
        return;
      }

      listener = nextListener;
      await nextListener.query(`LISTEN ${CHANNEL}`);
      nextListener.on('notification', (notification) => {
        if (notification.channel !== CHANNEL || !notification.payload) return;
        void broadcastMessage(notification.payload).catch((error) => {
          logger.error(
            { event: 'socket.scheduled_message_broadcast_failed', err: error, messageId: notification.payload },
            'Scheduled message socket broadcast failed'
          );
        });
      });
      nextListener.on('error', (error) => {
        logger.error({ event: 'socket.scheduled_message_listener_failed', err: error }, 'Scheduled message DB listener failed');
        if (listener !== nextListener) return;
        listener = null;
        nextListener.release(error);
        scheduleReconnect();
      });
      logger.info({ event: 'socket.scheduled_message_listener_started' }, 'Scheduled message delivery listener started');
    } catch (error) {
      logger.error({ event: 'socket.scheduled_message_listener_connect_failed', err: error }, 'Scheduled message listener connection failed');
      scheduleReconnect();
    }
  };

  void connect();

  // Temizlik (Cleanup) fonksiyonu - Dinleyiciyi kapatır
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (listener) {
      listener.removeAllListeners('notification');
      listener.removeAllListeners('error');
      void listener.query(`UNLISTEN ${CHANNEL}`).catch(() => undefined);
      listener.release();
      listener = null;
    }
    logger.info({ event: 'socket.scheduled_message_listener_stopped' }, 'Scheduled message delivery listener stopped');
  };
};

