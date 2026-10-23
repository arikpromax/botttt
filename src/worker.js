// Cloudflare Worker: Telegram надсилає оновлення на /webhook (секрет — WEBHOOK_SECRET).
// Відповідаємо одразу, а обробку (завантаження з TikTok, стиснення) доробляємо у фоні —
// інакше Telegram вважав би довгу обробку збоєм і надсилав би те саме оновлення ще раз.
import { createBot } from "./bot.js";
import { d1Albums } from "./albums.js";
import { d1Stats } from "./stats.js";
import { gameApi } from "./game/api.js";
import { d1Players } from "./game/store.js";

const MEMBER = new Set(["creator", "administrator", "member"]);

// Гра Ara Farm у Mini App: API на /api/*, сам застосунок — статичні файли з app/.
let game = null;
function setupGame(env) {
  game ??= gameApi({
    store: d1Players(env.DB),
    token: env.BOT_TOKEN,
    botUsername: env.BOT_USERNAME,
    // Завдання «підпишись на канал»: питаємо в Telegram, чи людина в каналі.
    async checkMember(userId) {
      const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(env.CHANNEL)}&user_id=${userId}`;
      const { ok, result } = await (await fetch(url)).json();
      return ok && (MEMBER.has(result.status) || (result.status === "restricted" && result.is_member));
    },
  });
  return game;
}

let ready = null; // бот живе весь час життя екземпляра воркера: getMe — лише при холодному старті
function setup(env) {
  ready ??= (async () => {
    const bot = createBot(env.BOT_TOKEN, {
      channel: env.CHANNEL || undefined,
      images: env.IMAGES,
      albums: env.DB ? d1Albums(env.DB) : null,
      // Сіль для хешів статистики — секрет вебхука: його знають лише воркер і Telegram.
      stats: env.DB ? d1Stats(env.DB, env.WEBHOOK_SECRET) : null,
      ownerId: Number(env.OWNER_ID) || null,
      appUrl: env.APP_URL || null,
    });
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
    if (url.pathname.startsWith("/api/")) return setupGame(env)(request);
    // Застосунок: напряму файли віддає Cloudflare сам; сюди доходять запити через старий воркер msgsaver.
    if (url.pathname !== "/webhook") return env.ASSETS.fetch(request);
    if (request.method !== "POST" || request.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await request.json();
    const bot = await setup(env);
    ctx.waitUntil(bot.handleUpdate(update).catch((err) => console.error("Помилка обробки оновлення:", err)));
    return new Response("ok");
  },
};
