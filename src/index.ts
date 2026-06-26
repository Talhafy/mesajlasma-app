import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import userRoutes from './routes/user';


const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" } 
});

//Modüller erişebilsin diye
app.set('io', io);

app.use(express.json());
app.use(cors());

//ROTALARI KULLANMA
app.use('/api', authRoutes);
app.use('/api', chatRoutes); 
app.use('/api/user', userRoutes); 

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
  });
});

// --- SUNUCUYU BAŞLAT ---
const PORT = 3000;
httpServer.listen(PORT, () => {
});