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
import { d1Payouts } from "./game/payouts.js";
import { d1Purchases } from "./game/shop.js";
import { t } from "./texts.js";

// Заявка на виплату — власнику в бот: кнопка оплати в Tonkeeper (сума й коментар уже заповнені) і рішення.
async function notifyOwner(env, w, p) {
  const pay = `https://app.tonkeeper.com/transfer/${w.address}?amount=${w.nano}&text=${encodeURIComponent(`Ara Farm #${w.id}`)}`;
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(env.OWNER_ID), text: t.payoutOwner(w, p), parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: t.payoutPayButton, url: pay }],
        [{ text: t.payoutPaidButton, callback_data: `wd:paid:${w.id}` }, { text: t.payoutRejectButton, callback_data: `wd:reject:${w.id}` }],
      ] },
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description);
}

const MEMBER = new Set(["creator", "administrator", "member"]);

// Гра Ara Farm у Mini App: API на /api/*, сам застосунок — статичні файли з app/.
let game = null;
function setupGame(env) {
  game ??= gameApi({
    store: d1Players(env.DB),
    token: env.BOT_TOKEN,
    botUsername: env.BOT_USERNAME,
    secret: env.WEBHOOK_SECRET, // від нього залежить шифр дня
    payouts: d1Payouts(env.DB),
    notifyOwner: (w, p) => notifyOwner(env, w, p),
    // Рахунок у Telegram Stars (валюта XTR, без платіжного провайдера).
    async createInvoiceLink(params) {
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.description);
      return data.result;
    },
    appUrl: env.APP_URL,
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
      // Завдання гри «зроби щось у боті»: позначаємо функцію в прогресі гравця (якщо він грає).
      onFeature: env.DB ? (userId, feature) => d1Players(env.DB).markBotUse(userId, feature) : null,
      // Виплати TON у грі: власник керує командами й кнопками під заявками.
      payouts: env.DB ? d1Payouts(env.DB) : null,
      shop: env.DB ? { store: d1Players(env.DB), purchases: d1Purchases(env.DB) } : null,
      players: env.DB ? d1Players(env.DB) : null,
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
