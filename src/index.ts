import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import userRoutes from './routes/user';
import prisma from './db';
import path from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" } 
});

// Modüller erişebilsin diye
app.set('io', io);

app.use(express.json());
app.use(cors());

// ROTALARI KULLANMA
app.use('/api', authRoutes);
app.use('/api', chatRoutes); 
app.use('/api/user', userRoutes); 
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/', (req, res) => {
  res.send('Mesajlaşma API modüler yapıda tıkır tıkır çalışıyor 🚀');
});

// --- SOCKET.IO GÜVENLİK DUVARI ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers['token'];
  if (!token) return next(new Error("Kimlik doğrulama hatası: Token bulunamadı!"));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
    socket.data.user = decoded; 
    next(); 
  } catch (err) {
    return next(new Error("Kimlik doğrulama hatası: Geçersiz token!"));
  }
});

// --- ANLIK İLETİŞİM BİLDİRİM MERKEZİ ---
io.on('connection', (socket) => {
  const currentUser = socket.data.user;

  socket.on('odaya_katil', (conversationId) => {
    const cleanId = conversationId.trim(); 
    socket.join(cleanId);
  });

  socket.on('mesaj_alindi_onayi', (data) => {
    socket.broadcast.emit('mesaj_karsi_tarafa_iletildi', data);
  });

  socket.on('disconnect', () => {
    // Kullanıcı koptuğunda yapılacak işlemler
  });
});

// --- GERÇEK ZAMANLI VERİTABANI İŞÇİSİ (WORKER) ---
// Her 30 saniyede bir çalışır ve saati gelmiş mesajları teslim eder
setInterval(async () => {
  try {
    const simdi = new Date();

    // 1. Saati gelmiş veya geçmiş ama hala bekleyen zamanlanmış mesajları bul
    const scheduledMessages = await prisma.scheduledMessage.findMany({
      where: {
        sendAt: { lte: simdi } // sendAt <= simdi
      }
    });

    if (scheduledMessages.length === 0) return;

    // 2. Her bir mesajı sırayla teslim et
    for (const sm of scheduledMessages) {
      
      // Gerçek mesaj tablosuna kaydet
     // OTOMATİK GÖNDERİM BOTU
          const savedMessage = await prisma.message.create({
            data: {
              content: sm.content,
              senderId: sm.senderId,
              conversationId: sm.conversationId,
              fileUrl: sm.fileUrl,
              fileType: sm.fileType,
              fileName: sm.fileName
            },
            include: { sender: { select: { username: true } } }
          });

      // Odanın katılımcılarını bul (Socket bildirimi için)
      const conversation = await prisma.conversation.findUnique({
        where: { id: sm.conversationId },
        include: { participants: true }
      });

      const targetRooms = [sm.conversationId];
      if (conversation?.participants) {
        conversation.participants.forEach((p: any) => {
          if (p.userId !== sm.senderId) targetRooms.push(p.userId);
        });
      }

      // 2. EKSİKLİK GİDERİLDİ: 'io' objesi zaten bu dosyada tanımlı olduğu için 
      // global.io yerine direkt io.to(...) kullanıyoruz.
      io.to(targetRooms).emit('yeni_mesaj_geldi', savedMessage);

      // 3. Görevi tamamlanan mesajı zamanlayıcı tablosundan sil
      await prisma.scheduledMessage.delete({
        where: { id: sm.id }
      });
    }
  } catch (error) {
    console.error("Zamanlanmış mesaj işçisi hatası:", error);
  }
}, 30000); // 30 saniyede bir kontrol et

// --- SUNUCUYU BAŞLAT ---
const PORT = 3000;
httpServer.listen(PORT, () => {
});
