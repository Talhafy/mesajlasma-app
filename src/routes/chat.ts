import express from 'express';
import prisma from '../db';

const router = express.Router();

//KULLANICILARI LİSTELEME
router.get('/users', async (req, res) => {
  try {
    const { currentUserId } = req.query;
    const users = await prisma.user.findMany({
      where: { NOT: { id: currentUserId as string } },
      select: { id: true, username: true, email: true }
    });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: "Kullanıcılar getirilemedi." });
  }
});

//ODA BULMA / OLUŞTURMA (Birebir Sohbet Başlatma)
router.post('/conversations/direct', async (req, res) => {
  try {
    const { currentUserId, targetUserId } = req.body;

    // Önce aralarında zaten bir sohbet var mı diye bakıyoruz
    let conversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { participants: { some: { userId: currentUserId } } },
          { participants: { some: { userId: targetUserId } } }
        ]
      }
    });

    // Eğer sohbet yoksa, yeni bir tane oluştur
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          isGroup: false,
          participants: {
            create: [
              { userId: currentUserId },
              { userId: targetUserId }
            ]
          }
        }
      });
    }

    res.status(200).json(conversation);
  } catch (error) {
    console.error("Oda oluşturma hatası:", error);
    res.status(500).json({ error: "Sohbet odası oluşturulamadı." });
  }
});

//MESAJ GÖNDERME VE SOKET YAYINI
router.post('/messages', async (req, res) => {
  try {
    const { conversationId, senderId, content } = req.body;

    // GÜVENLİK KONTROLÜ: Odanın var olup olmadığını ve katılımcıları çekiyoruz
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true }
    });

    if (!conversation) {
      return res.status(404).json({ error: "Sohbet odası bulunamadı veya silinmiş." });
    }

    // Mesajı Veritabanına Kaydet
    const savedMessage = await prisma.message.create({
      data: { content, senderId, conversationId },
      include: { sender: { select: { username: true } } }
    });

    // SOKET NESNESİ İLE CANLI YAYIN
    const io = req.app.get('io');
    
    // Klasik Yayın: Mesajı sohbet odasına gönder (İçeride olanlar duysun)
    io.to(conversationId).emit('yeni_mesaj_geldi', savedMessage);

    if (conversation.participants) {
      conversation.participants.forEach(participant => {
        if (participant.userId !== senderId) {
          io.to(participant.userId).emit('yeni_mesaj_geldi', savedMessage);
        }
      });
    }

    res.status(201).json(savedMessage);
  } catch (error) {
    console.error("Mesaj kayıt hatası:", error);
    res.status(500).json({ error: "Mesaj gönderilemedi veya veritabanına kaydedilemedi." });
  }
});

//GEÇMİŞ MESAJLARI ÇEKME
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const messages = await prisma.message.findMany({
      where: { conversationId: conversationId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { username: true } } }
    });
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ error: "Mesajlar yüklenemedi." });
  }
});

//GRUP OLUŞTURMA API'Sİ
router.post('/conversations/group', async (req, res) => {
  try {
    const { currentUserId, name, participantIds } = req.body;
    const allMemberIds = [...participantIds, currentUserId];

    const newGroup = await prisma.conversation.create({
      data: {
        isGroup: true,
        name: name,
        adminId: currentUserId, // GRUBU KURAN KİŞİYİ YÖNETİCİ YAPTIK
        participants: { create: allMemberIds.map((id: string) => ({ userId: id })) }
      }
    });
    res.status(201).json(newGroup);
  } catch (error) { res.status(500).json({ error: "Grup oluşturulamadı." }); }
});

//KULLANICININ GRUPLARINI GETİRME API'Sİ 
router.get('/conversations/groups', async (req, res) => {
  try {
    const { currentUserId } = req.query;
    
    // Benim (currentUserId) içinde olduğum ve isGroup: true olan odaları bul
    const myGroups = await prisma.participant.findMany({
      where: { 
        userId: currentUserId as string, 
        conversation: { isGroup: true } 
      },
      include: { conversation: true }
    });

    // Sadece oda verilerini temiz bir liste halinde dön
    const groups = myGroups.map(p => p.conversation);
    res.status(200).json(groups);
  } catch (error) {
    res.status(500).json({ error: "Gruplar getirilemedi." });
  }
});

//GRUBUN İÇİNDEKİ KİŞİLERİ ÇEKME API'Sİ
router.get('/conversations/group/:id/participants', async (req, res) => {
  try {
    const participants = await prisma.participant.findMany({
      where: { conversationId: req.params.id },
      include: { user: { select: { id: true, username: true } } }
    });
    // Sadece kullanıcı (user) objelerini ayıklayıp frontend'e gönderiyoruz
    res.status(200).json(participants.map(p => p.user));
  } catch (error) {
    res.status(500).json({ error: "Grup üyeleri alınamadı." });
  }
});

//GRUP ADI GÜNCELLEME API'Sİ
router.put('/conversations/group/:id/name', async (req, res) => {
  try {
    const updatedGroup = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { name: req.body.newName }
    });
    res.status(200).json(updatedGroup);
  } catch (error) {
    res.status(500).json({ error: "Grup adı güncellenemedi." });
  }
});

//GRUPTAN KİŞİ ÇIKARTMA API'Sİ
router.delete('/conversations/group/:id/participants/:userId', async (req, res) => {
  try {
    const { adminId } = req.query; // İsteği kim yapıyor?

    //Güvenlik: Grubu bul ve yetkiyi kontrol et
    const group = await prisma.conversation.findUnique({ where: { id: req.params.id } });
    if (group?.adminId !== adminId && req.params.userId !== adminId) {
      return res.status(403).json({ error: "Sadece grup yöneticisi kişi çıkarabilir!" });
    }

    await prisma.participant.deleteMany({
      where: { conversationId: req.params.id, userId: req.params.userId }
    });

    //Anlık Bildirim: Atılan kişiye sinyal gönder
    const io = req.app.get('io');
    io.to(req.params.id).emit('gruptan_atildi', { 
      groupId: req.params.id, 
      removedUserId: req.params.userId 
    });

    res.status(200).json({ message: "Kişi gruptan çıkarıldı." });
  } catch (error) { res.status(500).json({ error: "Kişi çıkarılamadı." }); }
});

//GRUBU KOMPLE SİLME API'Sİ
router.delete('/conversations/group/:id', async (req, res) => {
  try {
    const { adminId } = req.query;
    const group = await prisma.conversation.findUnique({ where: { id: req.params.id } });
    
    if (group?.adminId !== adminId) {
      return res.status(403).json({ error: "Sadece kurucu grubu silebilir!" });
    }

    await prisma.conversation.delete({ where: { id: req.params.id } });
    
    // Grubu herkesin ekranından anında silmek için sinyal
    const io = req.app.get('io');
    io.to(req.params.id).emit('grup_silindi', { groupId: req.params.id });

    res.status(200).json({ message: "Grup başarıyla silindi." });
  } catch (error) { res.status(500).json({ error: "Grup silinemedi." }); }
});

// 11. MESAJLARI OKUNDU OLARAK İŞARETLEME 
router.post('/conversations/:id/read', async (req, res) => {
  try {
    const { userId, emitReceipt } = req.body;
    const conversationId = req.params.id;

    console.log(`[GÖRÜLDÜ BAŞLADI] Oda: ${conversationId} | Okuyan: ${userId}`);

    // 1. Odaya ait ve benim göndermediğim tüm mesajları çek
    const allMessages = await prisma.message.findMany({
      where: {
        conversationId: conversationId,
        senderId: { not: userId }
      }
    });

    // 2. JavaScript ile Kesin Filtreleme (Sadece ID'min olmadıklarını bul)
    const unreadMessages = allMessages.filter(msg => {
      const reads = msg.readByIds || [];
      return !reads.includes(userId);
    });

    console.log(`[GÖRÜLDÜ] Güncellenecek okunmamış mesaj sayısı: ${unreadMessages.length}`);

    // 3. PostgreSQL'i Zorlayan Tekil Güncelleme (Push/Set yerine direkt eşitleme)
    for (const msg of unreadMessages) {
      const currentReads = msg.readByIds || [];

      await prisma.message.update({
        where: { id: msg.id },
        data: {
          // Diziyi eski elemanlar + benim ID'm olacak şekilde sıfırdan yaratıp üzerine yazıyoruz!
          readByIds: [...currentReads, userId] 
        }
      });
    }

    // 4. Mavi tik sinyali (ayar açıksa)
    if (emitReceipt !== false) {
      const io = req.app.get('io');
      io.to(conversationId).emit('mesajlar_okundu', { conversationId, readByUserId: userId });
    }

    console.log(`[GÖRÜLDÜ BAŞARILI] İşlem tamamlandı!`);
    res.status(200).json({ success: true, updatedCount: unreadMessages.length });
  } catch (error) {
    console.error("[GÖRÜLDÜ HATASI]:", error);
    res.status(500).json({ error: "Görüldü atılamadı." });
  }
});
//OKUNMAMIŞ MESAJ SAYILARINI GETİRME
router.get('/unread-counts', async (req, res) => {
  try {
    const { userId } = req.query;

    // 1. KUSURSUZ MANTIK: Önce kullanıcının ŞU AN aktif olarak katılımcısı olduğu odaları bul!
    const myParticipants = await prisma.participant.findMany({
      where: { userId: userId as string },
      select: { conversationId: true }
    });
    const validConversationIds = myParticipants.map(p => p.conversationId);

    // 2. Sadece bu geçerli odalardaki, başkasının attığı mesajları getir
    const allPossibleUnread = await prisma.message.findMany({
      where: {
        conversationId: { in: validConversationIds },
        senderId: { not: userId as string }
      },
      select: { conversationId: true, senderId: true, readByIds: true }
    });

    // 3. JavaScript ile kesin filtreleme yap (Okuduklarımı çıkar)
    const unreadMessages = allPossibleUnread.filter(msg => {
      const reads = msg.readByIds || [];
      return !reads.includes(userId as string);
    });

    // 4. Sayıları topla ve Frontend'e gönder
    const counts: Record<string, number> = {};
    unreadMessages.forEach(msg => {
      counts[msg.conversationId] = (counts[msg.conversationId] || 0) + 1;
      counts[msg.senderId] = (counts[msg.senderId] || 0) + 1;
    });

    res.status(200).json(counts);
  } catch (error) {
    console.error("Unread Counts Hatası:", error);
    res.status(500).json({ error: "Okunmamış mesajlar getirilemedi." });
  }
});
// 13. GLOBAL MESAJ ARAMA API'Sİ
router.get('/messages/search', async (req, res) => {
  try {
    const { q, userId } = req.query;
    if (!q || !userId) return res.status(400).json({ error: "Eksik parametre" });

    const messages = await prisma.message.findMany({
      where: {
        content: { contains: q as string, mode: 'insensitive' }, // Büyük/küçük harf duyarsız arama
        conversation: {
          participants: { some: { userId: userId as string } } // Sadece benim içinde olduğum odalar
        }
      },
      include: {
        sender: { select: { username: true } },
        conversation: {
          include: {
            participants: { include: { user: { select: { id: true, username: true, email: true } } } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 30 // Performans için en son 30 sonucu getir
    });

    res.status(200).json(messages);
  } catch (error) {
    console.error("Arama hatası:", error);
    res.status(500).json({ error: "Arama yapılamadı." });
  }
});
export default router;