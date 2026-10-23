// Підключає бота до воркера: Telegram надсилатиме оновлення на WORKER_URL/webhook.
// Також оновлює команди (власнику — ще й /stats) та опис бота.
// Запуск: npm run webhook (бере BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET і OWNER_ID з .env).
import { Api } from "grammy";
import { COMMANDS, OWNER_COMMANDS } from "../src/bot.js";
import { ABOUT } from "../src/texts.js";

const { BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET, OWNER_ID } = process.env;
if (!BOT_TOKEN || !WORKER_URL || !WEBHOOK_SECRET) {
  console.error("Потрібні BOT_TOKEN, WORKER_URL і WEBHOOK_SECRET у .env.");
  process.exit(1);
}
const api = new Api(BOT_TOKEN);
await api.setWebhook(`${WORKER_URL.replace(/\/$/, "")}/webhook`, {
  secret_token: WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query", "pre_checkout_query"], // pre_checkout_query — оплата за Stars
  drop_pending_updates: true,
});
await api.setMyCommands(COMMANDS);
if (OWNER_ID) await api.setMyCommands(OWNER_COMMANDS, { scope: { type: "chat", chat_id: Number(OWNER_ID) } });
await api.setMyDescription(ABOUT.description);
await api.setMyShortDescription(ABOUT.short);
const info = await api.getWebhookInfo();
console.log(`Вебхук: ${info.url}\nОчікують обробки: ${info.pending_update_count}` +
  (info.last_error_message ? `\nОстання помилка: ${info.last_error_message}` : ""));
