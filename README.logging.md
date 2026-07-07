# Merkezi logging ve Elastic/Kibana kurulum rehberi

Bu kurulumda uygulama logları `pino` ile JSON formatında hem stdout'a hem de `logs/app.log` dosyasına yazılır. Logstash bu dosyayı okuyup Elasticsearch'e aktarır. Kibana üzerinden `mesajlasma-api-*` indexleri aranır.

## 1) Ortam değişkenleri

Örnek değerler için `.env.example` dosyasını kullanabilirsiniz. Logging için gerekli ayarlar:

- `LOG_LEVEL`: log seviyesi, varsayılan `info`
- `LOG_DIR`: log klasörü, varsayılan `./logs`
- `LOG_FILE_ENABLED`: dosya loglamayı açar/kapatır, varsayılan `true`
- `LOG_FILE_NAME`: log dosyası adı, varsayılan `app.log`
- `SERVICE_NAME`: loglarda görünecek servis adı

`.env` yoksa logger varsayılan değerlerle çalışır. API'nin tamamen açılması için veritabanı, JWT ve R2 değişkenleri yine gereklidir.

## 2) Elastic/Kibana/Logstash başlatma

```bash
npm run logging:up
```

Servisler:

- Elasticsearch: http://localhost:9200
- Kibana: http://localhost:5601
- Logstash: `logs/app.log` dosyasını okuyup Elasticsearch'e yazar

Log servislerini takip etmek için:

```bash
npm run logging:logs
```

Kapatmak için:

```bash
npm run logging:down
```

## 3) Backend log üretme

Backend'i normal şekilde başlatın:

```bash
npm run dev
```

Log pipeline test endpoint'i:

```bash
curl http://localhost:3000/api/health/logging
```

Bu endpoint hem logger ayarlarını döner hem de `system.logging_health_check` event'i ile test logu üretir.

## 4) Kibana'da görüntüleme

Kibana açıldıktan sonra:

1. Stack Management > Data Views bölümüne gidin.
2. Data view adı olarak `mesajlasma-api-*` girin.
3. Timestamp alanı olarak `@timestamp` seçin.
4. Discover ekranında logları arayın.

Faydalı alanlar:

- `event`
- `level`
- `message`
- `service`
- `env`
- `requestId`
- `userId`
- `statusCode`
- `ip`

Örnek aramalar:

```text
event : "auth.login_success"
level : "error"
statusCode >= 500
event : "security.rate_limit"
```

## 5) Dashboard ve alert önerileri

- HTTP 4xx/5xx oranı
- Auth başarısız giriş sayısı
- Rate limit'e takılan istekler
- Socket bağlantı/kopma sayıları
- Worker hataları
- `level:error` trendi

Alert önerileri:

- 5 dakika içinde 10'dan fazla 401/403
- 5 dakika içinde 3'ten fazla login failure
- 3 ardışık worker hatası
- 5 dakika içinde 5'ten fazla `level:error`

## 6) Sorun giderme

- Kibana'da log yoksa önce `logs/app.log` dosyasının oluştuğunu kontrol edin.
- `npm run logging:logs` ile Logstash'in dosyayı okuyup okumadığını kontrol edin.
- `curl http://localhost:9200/_cat/indices?v` çıktısında `mesajlasma-api-*` indexi görünmelidir.
- Logstash eski offset'te kaldıysa `npm run logging:down` çalıştırıp `logstash-data` volume'unu temizleyerek yeniden başlatabilirsiniz.
