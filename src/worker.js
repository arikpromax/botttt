// Cloudflare Worker: Telegram надсилає оновлення на /webhook (секрет — WEBHOOK_SECRET).
// Відповідаємо одразу, а обробку (завантаження з TikTok, стиснення) доробляємо у фоні —
// інакше Telegram вважав би довгу обробку збоєм і надсилав би те саме оновлення ще раз.
import { createBot } from "./bot.js";

let ready = null; // бот живе весь час життя екземпляра воркера: getMe — лише при холодному старті
function setup(env) {
  ready ??= (async () => {
    const bot = createBot(env.BOT_TOKEN, { channel: env.CHANNEL || undefined, images: env.IMAGES });
    await bot.init();
    return bot;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/webhook") return new Response("Ara Converter", { status: 404 });
    if (request.method !== "POST" || request.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await request.json();
    const bot = await setup(env);
    ctx.waitUntil(bot.handleUpdate(update).catch((err) => console.error("Помилка обробки оновлення:", err)));
    return new Response("ok");
  },
};
