import type { PoolClient } from 'pg';
import { Server } from 'socket.io';
import { logger } from '../config/logger';
import prisma, { pool } from '../db';
import { serializeMessage } from '../services/messageService';

const CHANNEL = 'scheduled_message_delivered';
const RETRY_DELAY_MS = 5_000;

// The worker cannot share an in-memory Socket.IO server with API instances. PostgreSQL LISTEN/NOTIFY
// delivers a committed message id to every API instance, each of which emits to its own local sockets.
export const startScheduledMessageDeliveryListener = (io: Server) => {
  let listener: PoolClient | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, RETRY_DELAY_MS);
  };

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
