/**
 * ============================================================================
 * MESAJLAŞMA UYGULAMASI ANA SUNUCU BAŞLANGIÇ NOKTASI (App Entry Point)
 * ============================================================================
 * 
 * Bu dosya, Express HTTP sunucusunu, Socket.IO gerçek zamanlı WebSocket sunucusunu,
 * güvenlik middleware'lerini, API versiyonlamasını (/api/v1) ve veritabanı/Redis
 * bağlantılarını tek noktada birleştirir ve başlatır.
 * 
 * ÇALIŞMA SIRASI:
 * 1. Ortam Değişkenleri & Güvenlik Başlıkları (Helmet, CORS, Trust Proxy)
 * 2. İstek Loglayıcıları (Request & Security Loggers)
 * 3. Versiyonlanmış Router (/api/v1) & Rate Limiting Koruma Katmanı
 * 4. WebSocket (Socket.IO) & Zamanlanmış Mesaj Dinleyicileri
 * 5. Global 404 & Hata Yakalama (ErrorHandler) Middleware'leri
 * 6. Graceful Shutdown (Temiz Kapanış) İşleyicileri
 */

import 'dotenv/config';
import path from 'path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { clientOrigin, port, trustProxy } from './config/env';
import { flushLogs, logger } from './config/logger';
import { loginLimiter, refreshLimiter, registerLimiter, uploadLimiter, globalApiLimiter } from './config/rateLimiters';
import prisma, { closeDatabasePool } from './db';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger, securityStatusLogger } from './middleware/requestLogger';
import authRoutes from './routes/auth';
import callRoutes from './routes/calls';
import chatRoutes from './routes/chat';
import healthRoutes from './routes/health';
import scheduledMessageRoutes from './routes/scheduledMessages';
import userRoutes from './routes/user';
import docsRoutes from './routes/docs';
import { registerSocketHandlers } from './socket/registerSocketHandlers';
import { startScheduledMessageDeliveryListener } from './socket/scheduledMessageDeliveryListener';
import { closeRealtimeRedis, configureRealtimeAdapter } from './realtime/redis';

// Express uygulamasını ve HTTP sunucusunu oluşturuyoruz
const app = express();

// Load Balancer / Nginx arkasında çalışırken gerçek istemci IP adresini (req.ip) okumak için
if (trustProxy) app.set('trust proxy', 1);

const httpServer = createServer(app);

// Socket.IO Sunucusunu HTTP sunucusuyla aynı port üzerinde başlatıyoruz
const io = new Server(httpServer, {
  cors: { origin: clientOrigin, methods: ['GET', 'POST'], credentials: true }
});

// Express rotalarından io nesnesine erişilebilmesi için app üzerine kaydediyoruz
app.set('io', io);

// --- GÜVENLİK VE MİDDLEWARE KATMANI ---
app.use(helmet()); // XSS, Clickjacking gibi saldırılara karşı HTTP güvenlik başlıkları ekler
app.use(express.json({ limit: '100kb' })); // JSON istek boyutu sınırı (DDoS önleme)
app.use(cors({
  origin: clientOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
})); // Yalnızca izin verilen frontend kökenine (clientOrigin) ve çerez geçişine izin verir
app.use(requestLogger);
app.use(securityStatusLogger);

// --- VERSİYONLANMIŞ API ROUTER (/api/v1) ---
const v1Router = express.Router();

// 1. Rate Limiter'lar Rotalardan Önce Bağlanır
v1Router.use('/login', loginLimiter);
v1Router.use('/register', registerLimiter);
v1Router.use('/refresh', refreshLimiter);
v1Router.use('/upload', uploadLimiter);
v1Router.use(globalApiLimiter);

// 2. Modüler Rotaların v1Router Üzerinde Birleştirilmesi
v1Router.use(authRoutes);
v1Router.use(healthRoutes);
v1Router.use(callRoutes);
v1Router.use(chatRoutes);
v1Router.use(scheduledMessageRoutes);
v1Router.use(docsRoutes);
v1Router.use('/user', userRoutes);

// Birincil Sürüm Yolu (/api/v1) ve Geriye Dönük Uyumluluk Takma Adı (/api)
app.use('/api/v1', v1Router);
app.use('/api', v1Router);

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.get('/', (_req, res) => res.send('Mesajlaşma API çalışıyor 🚀'));

// --- SOCKET.IO VE DİNLEYİCİLER ---
registerSocketHandlers(io);
const stopScheduledMessageDeliveryListener = startScheduledMessageDeliveryListener(io);

// --- HATA YAKALAMA (ERROR HANDLING) ---
app.use(notFoundHandler); // Tanımlanmamış rotalarda 404 döner
app.use(errorHandler);    // Fırlatılan tüm hataları tek formatta yakalar ve yanıt döner

// --- SUNUCU BAŞLATMA ---
const start = async () => {
  try {
    // Dağıtık Socket.IO için Redis adaptörünü yapılandırır
    await configureRealtimeAdapter(io);
    httpServer.listen(port, () => {
      logger.info({ event: 'system.server_started', port }, 'API server started');
    });
  } catch (error) {
    logger.fatal({ event: 'system.realtime_start_failed', err: error }, 'Realtime infrastructure failed to start');
    await flushLogs();
    process.exit(1);
  }
};

void start();

httpServer.on('error', (error) => {
  logger.fatal({ event: 'system.server_listen_failed', err: error, port }, 'API server listen failed');
});

// --- GRACEFUL SHUTDOWN (TEMİZ KAPANIS) ---
const shutdown = (signal: string) => {
  logger.info({ event: 'system.server_shutdown', signal }, 'Server shutting down');
  stopScheduledMessageDeliveryListener();
  io.disconnectSockets(true);
  httpServer.close(async () => {
    try {
      await closeDatabasePool();
      await closeRealtimeRedis();
      logger.info({ event: 'system.server_stopped', signal }, 'Server stopped');
    } finally {
      await flushLogs();
    }
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('Calling client.query() when the client is already executing a query')) {
    return;
  }
  logger.warn({
    event: 'system.process_warning',
    warningName: warning.name,
    warningMessage: warning.message,
    stack: warning.stack
  }, 'Node.js process warning');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ event: 'system.unhandled_rejection', err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', async (error) => {
  logger.fatal({ event: 'system.uncaught_exception', err: error }, 'Uncaught exception');
  await flushLogs();
  process.exit(1);
});
