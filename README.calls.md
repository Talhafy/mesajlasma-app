# Sesli ve görüntülü görüşme kurulumu

Bu uygulama görüşmeler için LiveKit kullanır. WebRTC bağlantısını LiveKit yönetir; uygulama backend'i yalnızca yetkili sohbet katılımcılarına kısa ömürlü oda token'ı üretir.

## Neden LiveKit?

- Açık kaynak ve self-host edilebilir.
- React için hazır sesli/görüntülü konferans bileşenleri var.
- Backend token modeli güvenli: `LIVEKIT_API_SECRET` tarayıcıya gönderilmez.
- Ücretsiz geliştirme için yerel LiveKit server veya LiveKit Cloud free geliştirme kullanımı uygundur.

## Yerel geliştirme

LiveKit server kuruluysa:

```bash
livekit-server --dev
```

Bu mod varsayılan olarak şu değerleri kullanır:

```text
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Backend `.env` dosyanızda bu değerler bulunmalı. Örnek için `.env.example` dosyasına bakın.

Ardından backend ve frontend'i normal başlatın:

```bash
npm run dev
```

```bash
cd frontend
npm run dev
```

Bir sohbete girince üst barda telefon ve kamera ikonları görünür. Başlatan kullanıcı LiveKit odasına girer, diğer katılımcılar Socket.IO üzerinden gelen çağrı bildirimi alır.

## Production notu

Production için `ws://localhost:7880` kullanılmaz. LiveKit'i domain ve TLS ile yayınlayıp `LIVEKIT_URL` değerini `wss://livekit.domaininiz.com` yapın. Kurumsal ağlar ve mobil ağlar için TURN yapılandırması kaliteyi ciddi şekilde artırır.

## İlgili endpoint ve socket olayları

- `POST /api/calls/token`: sohbet üyesi için LiveKit token üretir.
- `call:invite`: çağrı daveti gönderir.
- `call:incoming`: karşı tarafa gelen çağrı bildirimi gider.
- `call:accepted`: çağrı kabul edildi sinyali.
- `call:declined`: çağrı reddedildi sinyali.
- `call:ended`: çağrı kapatıldı sinyali.
