# Ara Converter

Telegram-бот українською (@arawebsite_bot, назва «Ara Converter»). Працює на Cloudflare Workers, бази немає.

- **TikTok без водяного знака**: посилання → відео (або фото зі слайдів) і окремо звук. Посилання дає сервіс tikwm.com (`src/tiktok.js`); до 20 МБ Telegram бере файл сам, 20–50 МБ бот передає потоком, більше — дає пряме посилання.
- **Стиснення фото до вибраного розміру** (кнопки 3 МБ … 50 КБ або розмір у підписі, напр. «300 кб») через Cloudflare Images (`src/compress.js`): 5000 обробок на місяць безкоштовно, до 3 обробок на фото.
- **Обов'язкова підписка** на канал `CHANNEL` (@arawebsite): перевірка через Telegram, після підписки бот продовжує ту саму дію.

Далі (потрібен сервер з FFmpeg/LibreOffice): PDF ↔ Word, стиснення відео, звук із відео, YouTube.

## Розміщення
```
npm install
npm test
npx wrangler deploy
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET   # той самий, що в .env
npm run webhook                          # Telegram → https://araconverter.msgsaver.workers.dev/webhook
```
Журнал наживо: `npx wrangler tail araconverter`.
