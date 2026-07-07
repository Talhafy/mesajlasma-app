# Merkezi logging ve Elastic/Kibana kurulum rehberi

## 1) Backend loglama

- Uygulama artık pino tabanlı merkezi logger kullanır.
- Tüm ana HTTP, auth, chat, socket, worker ve storage olayları structured log olarak yazılır.
- Loglar stdout ve [logs/app.log](logs/app.log) dosyasına yazılır.

### Ortam değişkenleri

- LOG_LEVEL: log seviyesi (varsayılan: info)
- LOG_DIR: log dosyalarının yazılacağı dizin (varsayılan: ./logs)
- SERVICE_NAME: servis adı
- NODE_ENV: çalışma ortamı

## 2) Elastic/Kibana Docker ile başlatma

```bash
docker compose -f docker-compose.logging.yml up -d
```

Ardından Kibana'ya erişin:

- http://localhost:5601
- Elasticsearch: http://localhost:9200

## 3) Logstash entegrasyonu (opsiyonel)

Logstash kurup ayarlandıysa:

```bash
logstash -f logstash.conf
```

## 4) Kibana dashboard / alert önerileri

- Index pattern: `mesajlasma-api-*`
- Dashboard widgets:
  - HTTP 4xx/5xx oranı
  - Auth başarısız giriş sayısı
  - Rate limit'e takılan istekler
  - Socket bağlantı kesilme oranı
  - Worker hataları
- Alert kuralları:
  - 5 dakika içinde 10'dan fazla 401/403
  - 5 dakika içinde 3'ten fazla login failure
  - 3 ardışık worker hatası
  - 10'dan fazla socket disconnect
