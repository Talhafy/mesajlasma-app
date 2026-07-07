import 'dotenv/config';
import path from 'path';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { clientOrigin, port, trustProxy } from './config/env';
import { logger } from './config/logger';
import { loginLimiter, refreshLimiter, registerLimiter, uploadLimiter } from './config/rateLimiters';
import prisma from './db';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger, securityStatusLogger } from './middleware/requestLogger';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import healthRoutes from './routes/health';
import scheduledMessageRoutes from './routes/scheduledMessages';
import userRoutes from './routes/user';
import { registerSocketHandlers } from './socket/registerSocketHandlers';
import { startScheduledMessageWorker } from './workers/scheduledMessageWorker';

// index.ts yalnızca uygulamayı birleştirir; iş kuralları ilgili modüllerde kalır.
const app = express();
if (trustProxy) app.set('trust proxy', 1);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: clientOrigin, methods: ['GET', 'POST'], credentials: true }
});

// Route modülleri gerçek zamanlı olay yayınlamak için aynı Socket.IO örneğini kullanır.
app.set('io', io);
app.use(express.json({ limit: '100kb' }));
app.use(cors({
  origin: clientOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(requestLogger);
app.use(securityStatusLogger);

// Hassas endpoint'lerin limitleri genel API trafiğinden bağımsızdır.
app.use('/api/login', loginLimiter);
app.use('/api/register', registerLimiter);
app.use('/api/refresh', refreshLimiter);
app.use('/api/upload', uploadLimiter);

app.use('/api', authRoutes);
app.use('/api', healthRoutes);
app.use('/api', chatRoutes);
app.use('/api', scheduledMessageRoutes);
app.use('/api/user', userRoutes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/', (_req, res) => res.send('Mesajlaşma API çalışıyor 🚀'));

registerSocketHandlers(io);
const stopScheduledWorker = startScheduledMessageWorker(io);

app.use(notFoundHandler);
app.use(errorHandler);

httpServer.listen(port, () => {
  logger.info({ event: 'system.server_started', port }, 'API server started');
});

// Interval, socket ve DB bağlantısı kontrollü sırayla kapatılır.
const shutdown = (signal: string) => {
  logger.info({ event: 'system.server_shutdown', signal }, 'Server shutting down');
  stopScheduledWorker();
  io.disconnectSockets(true);
  httpServer.close(async () => {
    await prisma.$disconnect();
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
