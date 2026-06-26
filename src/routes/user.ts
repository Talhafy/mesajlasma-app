import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db';
import jwt from 'jsonwebtoken';

const router = express.Router();

// --- GÜVENLİK DUVARI (Middleware) ---
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; 
  
  if (!token) return res.status(401).json({ error: "Yetkisiz erişim" });

  jwt.verify(token, process.env.JWT_SECRET as string, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: "Geçersiz token" });
    req.user = user; 
    next();
  });
};

//KULLANICI İSMİ DEĞİŞTİRME ---
router.put('/username', authenticateToken, async (req: any, res: any) => {
  try {
    const { newUsername } = req.body;
    const userId = req.user.userId;

    const existingUser = await prisma.user.findUnique({ where: { username: newUsername } });
    if (existingUser) return res.status(400).json({ error: "Bu kullanıcı adı zaten alınmış." });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { username: newUsername }
    });

    res.status(200).json({ message: "Kullanıcı adı güncellendi", username: updatedUser.username });
  } catch (error) {
    res.status(500).json({ error: "İsim güncellenemedi." });
  }
});

//ŞİFRE DEĞİŞTİRME ---
router.put('/password', authenticateToken, async (req: any, res: any) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: "Mevcut şifreniz yanlış." });

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: hashedNewPassword }
    });

    res.status(200).json({ message: "Şifreniz başarıyla değiştirildi." });
  } catch (error) {
    res.status(500).json({ error: "Şifre güncellenemedi." });
  }
});

// HESAP SİLME ---
router.delete('/account', authenticateToken, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    await prisma.user.delete({ where: { id: userId } });
    res.status(200).json({ message: "Hesabınız başarıyla silindi." });
  } catch (error) {
    res.status(500).json({ error: "Hesap silinirken bir hata oluştu." });
  }
});

//SESSİZ GİRİŞ (BEN KİMİM?) API'Sİ ---
router.get('/me', authenticateToken, async (req: any, res: any) => {
  try {
    const userId = req.user.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    // İstemciye readReceiptsOn bilgisini de gönderiyoruz ki ayarlarda tiki gösterelim
    res.status(200).json({ 
        id: user.id, 
        username: user.username, 
        email: user.email,
        readReceiptsOn: user.readReceiptsOn 
    });
  } catch (error) {
    res.status(500).json({ error: "Kullanıcı bilgileri alınamadı." });
  }
});

// GÖRÜLDÜ AYARINI GÜNCELLEME ---
router.put('/settings/read-receipts', authenticateToken, async (req: any, res: any) => {
  try {
    const { isEnabled } = req.body;
    const userId = req.user.userId;
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { readReceiptsOn: isEnabled }
    });
    
    res.status(200).json({ message: "Görüldü ayarı güncellendi.", readReceiptsOn: updatedUser.readReceiptsOn });
  } catch (error) {
    res.status(500).json({ error: "Ayar güncellenemedi." });
  }
});

export default router;