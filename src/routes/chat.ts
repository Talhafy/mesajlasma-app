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
// MESAJ GÖNDERME (GÜNCELLENDİ: Yanıt ve İletildi Desteği)
router.post('/messages', async (req, res) => {
  try {
    const { conversationId, senderId, content, replyToId, isForwarded } = req.body;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }, include: { participants: true }
    });
    if (!conversation) return res.status(404).json({ error: "Sohbet bulunamadı." });

    const savedMessage = await prisma.message.create({
      data: { 
        content, 
        senderId, 
        conversationId,
        replyToId: replyToId || null, // Hangi mesaja yanıt verildi?
        isForwarded: isForwarded || false // Bu bir iletilmiş mesaj mı?
      },
      include: { 
        sender: { select: { username: true } },
        // Yanıtlanmışsa o mesajın kısa bir özetini frontend'e yolla
        replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } } 
      }
    });

    const io = req.app.get('io');
    const targetRooms = conversation.participants.map(p => p.userId);
    targetRooms.push(conversationId);
    
    io.to(targetRooms).emit('yeni_mesaj_geldi', savedMessage);
    res.status(201).json(savedMessage);
  } catch (error) { res.status(500).json({ error: "Mesaj gönderilemedi." }); }
});

// GEÇMİŞ MESAJLARI ÇEKME (GÜNCELLENDİ: Yanıt/Sabit/Yıldız Verilerini Getir)
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.query; // Mesajı çeken kişiyi bilmemiz lazım

    const messages = await prisma.message.findMany({
      where: { conversationId: conversationId },
      orderBy: { createdAt: 'asc' },
      include: { 
        sender: { select: { username: true } },
        replyTo: { select: { id: true, content: true, sender: { select: { username: true } } } }
      }
    });

    // "Benden Sil" denilmiş mesajları (deletedForIds) frontend'e hiç göndermiyoruz!
    const filteredMessages = messages.filter(msg => {
      const deletedFor = msg.deletedForIds || [];
      return !deletedFor.includes(userId as string);
    });

    res.status(200).json(filteredMessages);
  } catch (error) { res.status(500).json({ error: "Mesajlar yüklenemedi." }); }
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

    // ANINDA BİLDİRİM: Hiçbir mesaj kaydı oluşturmadan, kurucu hariç tüm
    // katılımcıların ekranına grubu canlı olarak düşürüyoruz. Her kullanıcı
    // zaten kendi userId'si ile bir odaya katılmış durumda (bkz: App.tsx
    // 'odaya_katil' -> currentUser.id), o yüzden direkt o odaya yayın yapıyoruz.
    const io = req.app.get('io');
    participantIds.forEach((userId: string) => {
      io.to(userId).emit('grup_olusturuldu', newGroup);
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

// --- 1. GRUPTAN KİŞİ ÇIKARTMA VE OTOMATİK SİLME ROBOTU ---
router.delete('/conversations/group/:id/participants/:userId', async (req, res) => {
  try {
    const { id: groupId, userId } = req.params;
    const { adminId } = req.query;

    const group = await prisma.conversation.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Grup bulunamadı." });

    // Çıkaran kişi admin değilse ve kendi kendine çıkmıyorsa yetki hatası ver
    if (group.adminId !== adminId && userId !== adminId) {
      return res.status(403).json({ error: "Sadece grup yöneticisi kişi çıkarabilir!" });
    }

    // 1. Kişiyi gruptan veritabanında sil
    await prisma.participant.deleteMany({
      where: { conversationId: groupId, userId: userId }
    });

    const io = req.app.get('io');
    io.to(groupId).emit('gruptan_atildi', { groupId, removedUserId: userId });

    // 2. KUSURSUZ MANTIK: Grupta geriye kimse kaldı mı?
    const remainingParticipants = await prisma.participant.findMany({
      where: { conversationId: groupId }
    });

    if (remainingParticipants.length === 0) {
      // KİMSE KALMADI! Mesajları ve Grubu PostgreSQL'den tamamen yokediyoruz.
      await prisma.message.deleteMany({ where: { conversationId: groupId } });
      await prisma.conversation.delete({ where: { id: groupId } });
      io.to(groupId).emit('grup_silindi', { groupId });
    } 
    else if (group.adminId === userId) {
      // YÖNETİCİ ÇIKTI AMA İÇERDE İNSANLAR VAR! 
      // İçeride kalan ilk kişiyi rastgele yeni yönetici yapıyoruz ki grup başıboş kalmasın.
      const newAdminId = remainingParticipants[0].userId;
      await prisma.conversation.update({
        where: { id: groupId },
        data: { adminId: newAdminId }
      });
      io.to(groupId).emit('grup_yonetici_degisti', { groupId, newAdminId });
    }

    res.status(200).json({ message: "İşlem başarılı." });
  } catch (error) { res.status(500).json({ error: "Kişi çıkarılamadı." }); }
});

// --- 2. GRUBA YENİ KİŞİ EKLEME API'Sİ ---
router.post('/conversations/group/:id/participants', async (req, res) => {
  try {
    const { id: groupId } = req.params;
    const { adminId, userIdsToAdd } = req.body;

    const group = await prisma.conversation.findUnique({ where: { id: groupId } });
    if (group?.adminId !== adminId) return res.status(403).json({ error: "Sadece yönetici kişi ekleyebilir." });

    const data = userIdsToAdd.map((userId: string) => ({ userId, conversationId: groupId }));
    await prisma.participant.createMany({ data, skipDuplicates: true });

    const io = req.app.get('io');
    userIdsToAdd.forEach((userId: string) => {
      io.to(userId).emit('grup_olusturuldu', group); // Yeni gelen kişinin sol paneline sessizce düşür
    });

    res.status(200).json({ message: "Kişiler eklendi." });
  } catch (error) { res.status(500).json({ error: "Ekleme başarısız." }); }
});

// --- 3. YÖNETİCİLİĞİ BAŞKASINA DEVRETME API'Sİ ---
router.put('/conversations/group/:id/admin', async (req, res) => {
  try {
    const { id: groupId } = req.params;
    const { currentAdminId, newAdminId } = req.body;

    const group = await prisma.conversation.findUnique({ where: { id: groupId } });
    if (group?.adminId !== currentAdminId) return res.status(403).json({ error: "Sadece kurucu yetki devredebilir." });

    await prisma.conversation.update({
      where: { id: groupId },
      data: { adminId: newAdminId }
    });

    const io = req.app.get('io');
    io.to(groupId).emit('grup_yonetici_degisti', { groupId, newAdminId });

    res.status(200).json({ message: "Yönetici değiştirildi." });
  } catch (error) { res.status(500).json({ error: "İşlem başarısız." }); }
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

    res.status(200).json({ success: true, updatedCount: unreadMessages.length });
  } catch (error) {
    console.error("[GÖRÜLDÜ HATASI]:", error);
    res.status(500).json({ error: "Görüldü atılamadı." });
  }
});
// --- DÜZELTİLMİŞ: OKUNMAMIŞ MESAJ SAYILARINI GETİRME API'Sİ ---
router.get('/unread-counts', async (req, res) => {
  try {
    const { userId } = req.query;

    // 1. Önce kullanıcının katılımcısı olduğu odaları bul
    const myParticipants = await prisma.participant.findMany({
      where: { userId: userId as string },
      select: { conversationId: true }
    });
    const validConversationIds = myParticipants.map(p => p.conversationId);

    // 2. Mesajları getirirken, Odanın (Conversation) 'isGroup' bilgisini de Prisma'dan çekiyoruz!
    const allPossibleUnread = await prisma.message.findMany({
      where: {
        conversationId: { in: validConversationIds },
        senderId: { not: userId as string }
      },
      select: { 
        conversationId: true, 
        senderId: true, 
        readByIds: true,
        conversation: { select: { isGroup: true } } // SİHİRLİ DOKUNUŞ BURASI
      }
    });

    // 3. Okuduklarımı filtreden çıkar
    const unreadMessages = allPossibleUnread.filter(msg => {
      const reads = msg.readByIds || [];
      return !reads.includes(userId as string);
    });

    // 4. HAYALET BİLDİRİMLERİ ENGELLEYEN AKILLI SAYAÇ
    const counts: Record<string, number> = {};
    
    unreadMessages.forEach(msg => {
      if (msg.conversation.isGroup) {
        // EĞER GRUP MESAJIYSA: Sadece gruba +1 yaz. Kişiye asla dokunma!
        counts[msg.conversationId] = (counts[msg.conversationId] || 0) + 1;
      } else {
        // EĞER ÖZEL MESAJSA (DM): O zaman gönderen kişiye (senderId) +1 yaz.
        counts[msg.senderId] = (counts[msg.senderId] || 0) + 1;
      }
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

// --- ZAMANLANMIŞ MESAJLAR İÇİN GEÇİCİ HAFIZA (RAM) ---
const scheduledTimeouts = new Map(); // Kronometreleri tutar
const scheduledMessagesData = new Map(); // Ekranda göstermek için mesaj içeriklerini tutar

// 14. İLERİ TARİHLİ MESAJI VERİTABANINA KAYDETME API'Sİ
router.post('/messages/schedule', async (req, res) => {
  try {
    const { conversationId, senderId, content, sendAt } = req.body;

    // MANTIKSAL KONTROL 1: Boş veri kontrolü
    if (!content || !content.trim()) {
      return res.status(400).json({ error: "HATA: Boş mesaj zamanlayamazsınız!" });
    }
    if (!sendAt) {
      return res.status(400).json({ error: "HATA: Lütfen geçerli bir tarih ve saat seçin!" });
    }

    const targetDate = new Date(sendAt);
    // MANTIKSAL KONTROL 2: Geçersiz format kontrolü
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: "HATA: Gönderilen tarih formatı geçersiz!" });
    }

    // MANTIKSAL KONTROL 3: Geçmiş zaman kontrolü
    if (targetDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: "HATA: Geçmiş bir zamana mesaj ayarlayamazsınız!" });
    }

    // Her şey doğru, veritabanına kaydet (Sonsuz ileri tarih serbest!)
    const scheduledMsg = await prisma.scheduledMessage.create({
      data: {
        content,
        senderId,
        conversationId,
        sendAt: targetDate
      }
    });

    res.status(200).json({ success: true, message: "Mesajınız veritabanına başarıyla güvenle kuruldu!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Sistem hatası: Mesaj zamanlanamadı." });
  }
});

// 15. BEKLEYEN ZAMANLANMIŞ MESAJLARI VERİTABANINDAN GETİRME
router.get('/messages/scheduled/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    const pendingMessages = await prisma.scheduledMessage.findMany({
      where: { conversationId },
      orderBy: { sendAt: 'asc' } // En yakın zamanlı olan en üstte gözüksün
    });
    
    res.status(200).json(pendingMessages);
  } catch (error) {
    res.status(500).json({ error: "Bekleyen mesajlar listelenemedi." });
  }
});

// 16. ZAMANLANMIŞ MESAJI VERİTABANINDAN SİLEREK İPTAL ETME
router.delete('/messages/schedule/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Önce mesaj var mı kontrol et
    const exist = await prisma.scheduledMessage.findUnique({ where: { id } });
    if (!exist) {
      return res.status(404).json({ error: "HATA: İptal edilmek istenen mesaj zaten gönderilmiş veya bulunamadı!" });
    }

    await prisma.scheduledMessage.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Zamanlanmış görev veritabanından silindi, iptal başarılı!" });
  } catch (error) {
    res.status(500).json({ error: "İptal işlemi sırasında veritabanı hatası oluştu." });
  }
});

// 17. ZAMANLANMIŞ MESAJI BEKLETMEDEN "ŞİMDİ GÖNDER" API'Sİ
router.post('/messages/schedule/send-now/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Zamanlanmış mesajı bul
    const sm = await prisma.scheduledMessage.findUnique({ where: { id } });
    if (!sm) {
      return res.status(404).json({ error: "Zamanlanmış mesaj bulunamadı veya zaten gönderilmiş." });
    }

    // 2. Gerçek mesaj tablosuna anında kaydet
    const savedMessage = await prisma.message.create({
      data: {
        content: sm.content,
        senderId: sm.senderId,
        conversationId: sm.conversationId
      },
      include: { sender: { select: { username: true } } }
    });

    // 3. Zamanlayıcı tablosundan bu kaydı sil
    await prisma.scheduledMessage.delete({ where: { id } });

    // 4. Socket ile odadaki herkese CANLI olarak fırlat
    const conversation = await prisma.conversation.findUnique({
      where: { id: sm.conversationId },
      include: { participants: true }
    });

    const targetRooms = [sm.conversationId];
    if (conversation?.participants) {
      conversation.participants.forEach(p => {
        if (p.userId !== sm.senderId) targetRooms.push(p.userId);
      });
    }

    const io = req.app.get('io');
    io.to(targetRooms).emit('yeni_mesaj_geldi', savedMessage);

    res.status(200).json({ success: true, message: "Mesaj bekletilmeden şimdi gönderildi!" });
  } catch (error) {
    res.status(500).json({ error: "Mesaj anında gönderilirken hata oluştu." });
  }
});

// 18. ZAMANLANMIŞ MESAJIN İÇERİĞİNİ DÜZENLEME (EDIT) API'Sİ
router.put('/messages/schedule/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Mesaj içeriği boş olamaz!" });
    }

    // Veritabanındaki zamanlanmış mesajın içeriğini güncelle
    const updatedMessage = await prisma.scheduledMessage.update({
      where: { id },
      data: { content: content.trim() }
    });

    res.status(200).json({ success: true, updatedMessage });
  } catch (error) {
    res.status(500).json({ error: "Zamanlanmış mesaj güncellenirken hata oluştu." });
  }
});

// --- MESAJ SABİTLEME (PIN) ---
router.put('/messages/:id/pin', async (req, res) => {
  try {
    const { id } = req.params;
    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) return res.status(404).json({ error: "Mesaj bulunamadı." });

    const updatedMessage = await prisma.message.update({
      where: { id },
      data: { isPinned: !message.isPinned } // Tersine çevir (Aç/Kapat)
    });

    const io = req.app.get('io');
    io.to(message.conversationId).emit('mesaj_guncellendi', updatedMessage);
    res.status(200).json(updatedMessage);
  } catch (error) { res.status(500).json({ error: "Sabitleme işlemi başarısız." }); }
});

// --- MESAJ YILDIZLAMA (STAR) ---
router.put('/messages/:id/star', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) return res.status(404).json({ error: "Mesaj bulunamadı." });

    const currentStars = message.starredByIds || [];
    const isStarred = currentStars.includes(userId);
    
    // Eğer yıldızlıysa çıkar, değilse ekle
    const newStars = isStarred 
      ? currentStars.filter(uid => uid !== userId) 
      : [...currentStars, userId];

    const updatedMessage = await prisma.message.update({
      where: { id },
      data: { starredByIds: newStars }
    });

    // Yıldızlama kişisel olduğu için sadece o kullanıcıya bildiriyoruz
    const io = req.app.get('io');
    io.to(userId).emit('mesaj_guncellendi', updatedMessage);
    res.status(200).json(updatedMessage);
  } catch (error) { res.status(500).json({ error: "Yıldızlama başarısız." }); }
});

// --- MESAJ SİLME (BENDEN / HERKESTEN SİL) ---
router.delete('/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, forEveryone } = req.query; // forEveryone=true veya false

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) return res.status(404).json({ error: "Mesaj bulunamadı." });

    const io = req.app.get('io');

    if (forEveryone === 'true') {
      // HERKESTEN SİL: Sadece gönderen silebilir
      if (message.senderId !== userId) return res.status(403).json({ error: "Sadece kendi mesajınızı herkesten silebilirsiniz." });
      
      // Veritabanından tamamen sil (Veya content'i "Bu mesaj silindi" yapabilirsin)
      await prisma.message.delete({ where: { id } });
      
      // Herkese mesajın silindiğini bildir ki ekrandan kaybolsun
      io.to(message.conversationId).emit('mesaj_silindi', { messageId: id, conversationId: message.conversationId });
      return res.status(200).json({ message: "Mesaj herkesten silindi." });
      
    } else {
      // BENDEN SİL: Sadece kullanıcının IDsini `deletedForIds` listesine ekle
      const currentDeleted = message.deletedForIds || [];
      if (!currentDeleted.includes(userId as string)) {
        await prisma.message.update({
          where: { id },
          data: { deletedForIds: [...currentDeleted, userId as string] }
        });
      }
      
      // Sadece o kullanıcının ekranından silinmesi için sinyal at
      io.to(userId as string).emit('mesaj_silindi', { messageId: id, conversationId: message.conversationId });
      return res.status(200).json({ message: "Mesaj sadece sizden silindi." });
    }
  } catch (error) { res.status(500).json({ error: "Silme işlemi başarısız." }); }
});

export default router;