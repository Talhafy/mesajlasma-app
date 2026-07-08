import 'dotenv/config';
import path from 'path';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { clientOrigin, port, trustProxy } from './config/env';
import { flushLogs, logger } from './config/logger';
import { loginLimiter, refreshLimiter, registerLimiter, uploadLimiter } from './config/rateLimiters';
import prisma from './db';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger, securityStatusLogger } from './middleware/requestLogger';
import authRoutes from './routes/auth';
import callRoutes from './routes/calls';
import chatRoutes from './routes/chat';
import healthRoutes from './routes/health';
import scheduledMessageRoutes from './routes/scheduledMessages';
import userRoutes from './routes/user';
import { registerSocketHandlers } from './socket/registerSocketHandlers';
import { startScheduledMessageWorker } from './workers/scheduledMessageWorker';

// index.ts yalnızca uygulamayı birleştirir; iş kuralları ilgili modüllerde kalır.
const app = express();
// Reverse proxy arkasında çalışırken gerçek IP'nin req.ip'ye düşmesi için trust proxy açılır.
// Lokal geliştirmede kapalı kalabilir; prod ortamda load balancer/proxy varsa env ile yönetilir.
if (trustProxy) app.set('trust proxy', 1);

const httpServer = createServer(app);
// Socket.IO HTTP server ile aynı portu paylaşır; CORS burada da frontend origin ile sınırlandırılır.
const io = new Server(httpServer, {
  cors: { origin: clientOrigin, methods: ['GET', 'POST'], credentials: true }
});

// Route modülleri gerçek zamanlı olay yayınlamak için aynı Socket.IO örneğini kullanır.
app.set('io', io);
app.use(express.json({ limit: '100kb' }));
// CORS'u wildcard bırakmıyoruz; HttpOnly refresh cookie kullandığımız için yalnızca frontend origin'e izin verilir.
app.use(cors({
  origin: clientOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(requestLogger);
app.use(securityStatusLogger);

// Rate limiter'lar route'lardan önce bağlanır ki pahalı iş kuralları/DB sorguları çalışmadan istek kesilebilsin.
// Hassas endpoint'lerin limitleri genel API trafiğinden bağımsızdır.
app.use('/api/login', loginLimiter);
app.use('/api/register', registerLimiter);
app.use('/api/refresh', refreshLimiter);
app.use('/api/upload', uploadLimiter);

app.use('/api', authRoutes);
app.use('/api', callRoutes);
app.use('/api', healthRoutes);
app.use('/api', chatRoutes);
app.use('/api', scheduledMessageRoutes);
app.use('/api/user', userRoutes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/', (_req, res) => res.send('Mesajlaşma API çalışıyor 🚀'));

registerSocketHandlers(io);
// Zamanlanmış mesaj worker'ı API ile aynı process içinde başlar; stop fonksiyonu graceful shutdown'da çağrılır.
const stopScheduledWorker = startScheduledMessageWorker(io);

app.use(notFoundHandler);
app.use(errorHandler);

httpServer.listen(port, () => {
  logger.info({ event: 'system.server_started', port }, 'API server started');
});

httpServer.on('error', (error) => {
  // Port kullanımda, yetki hatası veya bind problemi gibi açılış hatalarını fatal olarak loglarız.
  logger.fatal({ event: 'system.server_listen_failed', err: error, port }, 'API server listen failed');
});

// Interval, socket ve DB bağlantısı kontrollü sırayla kapatılır.
const shutdown = (signal: string) => {
  logger.info({ event: 'system.server_shutdown', signal }, 'Server shutting down');
  stopScheduledWorker();
  io.disconnectSockets(true);
  httpServer.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info({ event: 'system.server_stopped', signal }, 'Server stopped');
    } finally {
      await flushLogs();
    }
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('warning', (warning) => {
  // Node/pg/Prisma deprecation warning'leri console'da kaybolmasın diye structured log'a alınır.
  // Özellikle adapter-pg warning'lerinde stack, hangi akışın tetiklediğini bulmamızı sağlar.
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
