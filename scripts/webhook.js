// Підключає бота до воркера: Telegram надсилатиме оновлення на WORKER_URL/webhook.
// Запуск: npm run webhook (бере BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET з .env).
import { Api } from "grammy";
import { COMMANDS } from "../src/bot.js";

const { BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET } = process.env;
if (!BOT_TOKEN || !WORKER_URL || !WEBHOOK_SECRET) {
  console.error("Потрібні BOT_TOKEN, WORKER_URL і WEBHOOK_SECRET у .env.");
  process.exit(1);
}
const api = new Api(BOT_TOKEN);
await api.setWebhook(`${WORKER_URL.replace(/\/$/, "")}/webhook`, {
  secret_token: WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});
await api.setMyCommands(COMMANDS);
const info = await api.getWebhookInfo();
console.log(`Вебхук: ${info.url}\nОчікують обробки: ${info.pending_update_count}` +
  (info.last_error_message ? `\nОстання помилка: ${info.last_error_message}` : ""));
