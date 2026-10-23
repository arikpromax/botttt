// Cloudflare Worker: Telegram надсилає оновлення на /webhook (секрет — WEBHOOK_SECRET).
// Відповідаємо одразу, а обробку (завантаження з TikTok, стиснення) доробляємо у фоні —
// інакше Telegram вважав би довгу обробку збоєм і надсилав би те саме оновлення ще раз.
import { createBot } from "./bot.js";
import { d1Albums } from "./albums.js";
import { d1Stats } from "./stats.js";
import { gameApi } from "./game/api.js";
import { d1Players } from "./game/store.js";
import { cipherPost, cipherWord } from "./game/cipher.js";
import { CIPHER, kyivDay } from "./game/rules.js";

const MEMBER = new Set(["creator", "administrator", "member"]);

// Гра Ara Farm у Mini App: API на /api/*, сам застосунок — статичні файли з app/.
let game = null;
function setupGame(env) {
  game ??= gameApi({
    store: d1Players(env.DB),
    token: env.BOT_TOKEN,
    botUsername: env.BOT_USERNAME,
    secret: env.WEBHOOK_SECRET, // від нього залежить шифр дня
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
      cipherSecret: env.WEBHOOK_SECRET,
    });
    await bot.init();
    return bot;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

// Щоранку (розклад — у wrangler.toml) бот публікує в каналі шифр дня з кнопкою, що відкриває гру.
async function postCipher(env) {
  const word = await cipherWord(kyivDay(Date.now()), env.WEBHOOK_SECRET);
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.CHANNEL, text: cipherPost(word, CIPHER.reward), parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Грати в Ara Farm", url: `https://t.me/${env.BOT_USERNAME}?startapp` }]] },
    }),
  });
  const data = await res.json();
  if (data.ok) console.log(`Шифр дня опубліковано в ${env.CHANNEL}`);
  else console.error("Шифр дня не опубліковано:", data.description);
}

export default {
  scheduled(event, env, ctx) {
    ctx.waitUntil(postCipher(env));
  },

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
