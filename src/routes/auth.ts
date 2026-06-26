import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { username, email, password_hash: hashedPassword },
    });
    res.status(201).json({
      message: "Kullanıcı başarıyla oluşturuldu!",
      user: { id: newUser.id, username: newUser.username, email: newUser.email }
    });
  } catch (error: any) {
    console.error(" VERİTABANI KAYIT HATASI:", error);
    res.status(400).json({ error: `Hata Detayı: ${error.message || "Bilinmeyen bir veritabanı hatası oluştu."}` });
  }
});

//KULLANICI GİRİŞ API'Sİ 
router.post('/login', async (req, res) => {
  try {
    //identifier' (email veya kullanıcı adı) gelecek
    const { identifier, password } = req.body; 

    // Veritabanında VEYA (OR) mantığıyla arama yapıyoruz
    const user = await prisma.user.findFirst({ 
      where: { 
        OR: [
          { email: identifier },
          { username: identifier }
        ]
      } 
    });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Giriş bilgileri veya şifre hatalı." });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      message: "Giriş başarılı!",
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Giriş işlemi sırasında sunucu hatası oluştu." });
  }
});

export default router;