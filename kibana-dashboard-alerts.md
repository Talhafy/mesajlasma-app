# Kibana dashboard ve alert taslağı

Docker logging stack ayağa kalktıktan sonra Kibana'da `mesajlasma-api-*` data view'i oluşturun.

## Dashboard panelleri

Önerilen paneller:

1. **HTTP istek hacmi**
   - Data view: `mesajlasma-api-*`
   - KQL: `event : "http.request" or req.method : *`
   - Visualization: date histogram

2. **HTTP hata oranı**
   - KQL: `statusCode >= 400 or res.statusCode >= 400`
   - Breakdown: `statusCode` veya `res.statusCode`

3. **Auth başarısızlıkları**
   - KQL: `event : "auth.login_failed" or event : "auth.token_invalid" or event : "auth.refresh_invalid" or event : "auth.refresh_expired"`
   - Breakdown: `event`

4. **Rate limit olayları**
   - KQL: `event : "security.rate_limit"`
   - Breakdown: `limiter`

5. **Yetkisiz socket oda katılımı**
   - KQL: `event : "security.unauthorized_room_join"`
   - Breakdown: `userId`

6. **Chat ve dosya hataları**
   - KQL: `event : "chat.message_send_failed" or event : "chat.file_upload_failed" or event : "storage.r2_upload_failed" or event : "storage.signed_url_failed"`
   - Breakdown: `event`

7. **Worker sağlığı**
   - KQL: `event : "worker.started" or event : "worker.stopped" or event : "worker.scheduled_message_failed"`
   - Breakdown: `event`

## Alert önerileri

Kibana > Stack Management > Rules bölümünden aşağıdaki kuralları oluşturabilirsiniz:

1. **Çok fazla 401/403**
   - KQL: `statusCode in (401, 403) or res.statusCode in (401, 403)`
   - Window: 5 dakika
   - Threshold: `count() >= 10`

2. **Login saldırısı ihtimali**
   - KQL: `event : "auth.login_failed"`
   - Window: 5 dakika
   - Threshold: `count() >= 5`

3. **Rate limit patlaması**
   - KQL: `event : "security.rate_limit"`
   - Window: 5 dakika
   - Threshold: `count() >= 10`

4. **Worker hatası**
   - KQL: `event : "worker.scheduled_message_failed"`
   - Window: 10 dakika
   - Threshold: `count() >= 1`

5. **R2 dosya/signed URL hataları**
   - KQL: `event : "storage.r2_upload_failed" or event : "storage.r2_delete_failed" or event : "storage.signed_url_failed"`
   - Window: 10 dakika
   - Threshold: `count() >= 3`

6. **Genel backend error/fatal**
   - KQL: `level : "error" or level : "fatal"`
   - Window: 5 dakika
   - Threshold: `count() >= 5`

Not: Alert bildirimi için Kibana connector gerekir. Local geliştirmede connector olmadan sadece Kibana içinde kural durumunu izleyebilirsiniz; production'da e-posta, Slack veya webhook connector eklenmelidir.
