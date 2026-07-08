## Production notu

Production için `ws://localhost:7880` kullanılmaz. LiveKit'i domain ve TLS ile yayınlayıp `LIVEKIT_URL` değerini `wss://livekit.domaininiz.com` yapın. Kurumsal ağlar ve mobil ağlar için TURN yapılandırması kaliteyi ciddi şekilde artırır.

## İlgili endpoint ve socket olayları

- `POST /api/calls/token`: sohbet üyesi için LiveKit token üretir.
- `call:invite`: çağrı daveti gönderir.
- `call:incoming`: karşı tarafa gelen çağrı bildirimi gider.
- `call:accepted`: çağrı kabul edildi sinyali.
- `call:declined`: çağrı reddedildi sinyali.
- `call:ended`: çağrı kapatıldı sinyali.
