# Ara Converter

Telegram-бот українською (@arawebsite_bot, назва «Ara Converter»). Працює на Cloudflare Workers; нічого не зберігає, лише альбоми фото на годину (D1).

- **TikTok без водяного знака**: посилання → відео (або фото зі слайдів) і окремо звук (`src/tiktok.js`). Джерела по черзі: tikwm.com (HD, але на спільних IP Cloudflare часто вичерпаний ліміт) → сторінка TikTok (до 720p; з версій бот вибирає ту, де кращий звук, `src/mp4.js`). Відео з віковими обмеженнями без входу в акаунт TikTok не віддає — бот пояснює. До 20 МБ Telegram бере файл сам, до 50 МБ бот передає потоком.
- **Стиснення фото до вибраного розміру** (кнопки 3 МБ … 50 КБ або розмір у підписі, напр. «300 кб») через Cloudflare Images (`src/compress.js`): 5000 обробок на місяць безкоштовно, до 3 на фото; більший за оригінал файл не віддає.
- **Фото → PDF**: одне фото або альбом (одне меню на альбом) — власний генератор, JPEG без перекодування (`src/pdf.js`).
- **Фото → JPG**: PNG, WEBP тощо, надіслані файлом (Cloudflare Images).
- **Звук із відео** (до 20 МБ): доріжка AAC без перекодування в M4A (`src/audio.js`).
- **Обов'язкова підписка** на канал `CHANNEL` (@arawebsite): перевірка через Telegram, після підписки бот продовжує ту саму дію.

Не плануємо: стиснення відео, YouTube, PDF ↔ Word.

## Розміщення
```
npm install
npm test
npx wrangler d1 migrations apply araconverter --remote   # таблиця для альбомів
npx wrangler deploy
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET   # той самий, що в .env
npm run webhook                          # Telegram → https://araconverter.msgsaver.workers.dev/webhook
```
Журнал наживо: `npx wrangler tail araconverter`. Сторінка застосунку («Open») і політика конфіденційності лежать у проєкті msgsaver (`placeholder/`).
