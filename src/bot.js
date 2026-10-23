// Логіка бота Ara Converter: обов'язкова підписка на канал, TikTok без водяного знака, стиснення фото.
// Бази немає: усе потрібне для продовження дії бот бере з повідомлення, на яке відповідає.
import { Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { RestrictedError, findTikTokUrl, resolveTikTok } from "./tiktok.js";
import { MonthLimitError, UnsupportedImageError, compressToSize, parseSize, sizeChoices } from "./compress.js";
import { formatSize, t } from "./texts.js";

const HTML = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
const MEMBER = new Set(["creator", "administrator", "member"]);
const ACCESS_TTL = 60_000; // мс: як довго вірити перевірці підписки в межах одного екземпляра воркера
const URL_LIMIT = 20 * 1024 * 1024; // за посиланням Telegram сам завантажує до 20 МБ
const UPLOAD_LIMIT = 50 * 1024 * 1024; // бот може надіслати файл до 50 МБ
const FILE_LIMIT = 20 * 1024 * 1024; // бот може отримати файл до 20 МБ

export const COMMANDS = [{ command: "start", description: "Що вміє бот" }];

// channel — «@username» каналу для обов'язкової підписки; images — Cloudflare Images (env.IMAGES).
export function createBot(token, { channel, images, fetch = globalThis.fetch, ...config }) {
  const bot = new Bot(token, config);
  bot.api.config.use(autoRetry());

  const reply = (msg) => ({ reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } });
  const send = (chatId, text, extra) => bot.api.sendMessage(chatId, text, { ...HTML, ...extra });
  const edit = (msg, text, extra) => bot.api.editMessageText(msg.chat.id, msg.message_id, text, { ...HTML, ...extra }).catch(() => {});

  // ---- Обов'язкова підписка ----

  const accessCache = new Map();
  async function hasAccess(userId, fresh = false) {
    if (!channel) return true;
    const cached = accessCache.get(userId);
    if (!fresh && cached && Date.now() - cached.at < ACCESS_TTL) return cached.ok;
    try {
      const m = await bot.api.getChatMember(channel, userId);
      const ok = MEMBER.has(m.status) || (m.status === "restricted" && m.is_member);
      accessCache.set(userId, { ok, at: Date.now() });
      return ok;
    } catch (err) {
      // Канал налаштовано неправильно (бот не адмін тощо) — краще пустити, ніж зламати бота.
      console.error("Не вдалося перевірити підписку:", err.description ?? err.message);
      return true;
    }
  }

  // Повідомлення про підписку — відповіддю на запит, щоб після підписки продовжити саме його.
  function sendGate(msg) {
    const link = `https://t.me/${channel.replace(/^@/, "")}`;
    return send(msg.chat.id, t.gate, {
      ...reply(msg),
      reply_markup: new InlineKeyboard().url(t.subscribeButton, link).row().text(t.checkButton, "check_sub"),
    });
  }

  // ---- TikTok ----

  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

  // Поки бот працює, вгорі чату видно «надсилає відео…». Telegram тримає статус ~5 с, тож оновлюємо його.
  function keepStatus(chatId, action) {
    const tick = () => bot.api.sendChatAction(chatId, action).catch(() => {});
    tick();
    const timer = setInterval(tick, 4500);
    return { set: (next) => (action = next), stop: () => clearInterval(timer) };
  }

  // Telegram завантажує файл за посиланням сам (до 20 МБ). Більші — або ті, що віддаються лише з куками
  // (file.headers), — бот завантажує й передає потоком сам (до 50 МБ).
  async function sendMedia(chatId, method, file, filename, extra) {
    if (!file.headers && (!file.size || file.size <= URL_LIMIT)) {
      try {
        return await bot.api[method](chatId, file.url, extra);
      } catch (err) {
        if (!(err instanceof GrammyError) || err.error_code !== 400) throw err;
        console.warn(`Telegram не взяв файл за посиланням (${err.description}), надсилаю сам`);
      }
    }
    if (file.size > UPLOAD_LIMIT) throw new Error("завеликий файл");
    const res = await fetch(file.url, { headers: file.headers ?? {} });
    if (!res.ok) throw new Error(`файл не віддається: ${res.status}`);
    return bot.api[method](chatId, new InputFile(res.body, filename), extra);
  }

  // Відео з обкладинкою, розмірами й тривалістю — тоді в Telegram одразу чітке прев'ю.
  // Якщо обкладинку Telegram не прийняв — надсилаємо без неї.
  async function sendVideo(chatId, video, caption) {
    const extra = clean({ caption, supports_streaming: true, width: video.width, height: video.height, duration: video.duration });
    if (video.cover) {
      try {
        return await sendMedia(chatId, "sendVideo", video, "tiktok.mp4", { ...extra, cover: video.cover });
      } catch (err) {
        if (!(err instanceof GrammyError) || err.error_code !== 400) throw err;
        console.warn("Обкладинку не прийнято:", err.description);
      }
    }
    return sendMedia(chatId, "sendVideo", video, "tiktok.mp4", extra);
  }

  // Звук — завжди файлом із назвою й автором: за посиланням Telegram показує m4a як документ, а не як трек.
  async function sendSound(chatId, music) {
    const res = await fetch(music.url);
    if (!res.ok) throw new Error(`звук не віддається: ${res.status}`);
    const ext = /mpeg|mp3/.test(res.headers.get("content-type") ?? "") ? "mp3" : "m4a";
    const name = (music.title || "TikTok").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60).trim() || "TikTok";
    return bot.api.sendAudio(chatId, new InputFile(res.body, `${name}.${ext}`), clean({ title: music.title, performer: music.author }));
  }

  async function handleTikTok(msg, url) {
    const status = keepStatus(msg.chat.id, "upload_video");
    let post;
    try {
      post = await resolveTikTok(url, fetch);
      const caption = t.ttCaption(bot.botInfo.username);
      if (post.images.length) {
        status.set("upload_photo");
        for (let i = 0; i < post.images.length; i += 10) {
          const group = post.images.slice(i, i + 10).map((media) => ({ type: "photo", media }));
          if (i === 0) group[0].caption = caption;
          await bot.api.sendMediaGroup(msg.chat.id, group);
        }
      } else if (post.video) {
        if (post.video.size > UPLOAD_LIMIT) {
          return await send(msg.chat.id, t.ttTooBig(post.video.headers ? null : post.video.url), reply(msg));
        }
        await sendVideo(msg.chat.id, post.video, caption);
      }
      if (post.music) {
        status.set("upload_document");
        await sendSound(msg.chat.id, post.music);
      }
      const v = post.video;
      const what = post.images.length ? `${post.images.length} фото`
        : `відео ${v?.height ? `${v.height}p` : ""}${v?.audioKbps ? `, звук у відео ${v.audioKbps} кбіт/с` : ""}`;
      console.log(`TikTok (${post.source}${post.id ? ` ${post.id}` : ""}): ${what}${post.music ? " + трек" : ""}` +
        (post.note ? ` [${post.note}]` : ""));
    } catch (err) {
      console.error(`TikTok${post ? ` (${post.source})` : ""}:`, err.description ?? err.message);
      const tooBig = post?.video && !post.video.headers && post.video.size > URL_LIMIT;
      await send(msg.chat.id, tooBig ? t.ttTooBig(post.video.url)
        : err instanceof RestrictedError ? t.ttRestricted : t.ttFailed, reply(msg));
    } finally {
      status.stop();
    }
  }

  // ---- Стиснення фото ----

  // Фото з повідомлення: стиснуте Telegram (photo) або надіслане файлом (document з картинкою).
  function imageOf(msg) {
    if (msg?.photo) {
      const p = msg.photo.at(-1);
      return { fileId: p.file_id, size: p.file_size ?? 0, width: p.width, height: p.height, name: "photo" };
    }
    const d = msg?.document;
    if (d && /^image\//.test(d.mime_type ?? "")) {
      return { fileId: d.file_id, size: d.file_size ?? 0, name: (d.file_name ?? "photo").replace(/\.[^.]+$/, "") };
    }
    return null;
  }

  async function offerCompression(msg, image) {
    if (image.size > FILE_LIMIT) return send(msg.chat.id, t.photoTooBig, reply(msg));
    const target = parseSize(msg.caption);
    if (target) return compress(msg, image, target);
    const choices = sizeChoices(image.size);
    if (!choices.length) return send(msg.chat.id, t.alreadySmall(image.size), reply(msg));
    const keyboard = new InlineKeyboard();
    choices.forEach((size, i) => {
      keyboard.text(formatSize(size), `size:${size}`);
      if (i % 3 === 2) keyboard.row();
    });
    await send(msg.chat.id, t.askSize(image.size, image.width, image.height), { ...reply(msg), reply_markup: keyboard });
  }

  async function compress(msg, image, target, status) {
    status = status ? (await edit(status, t.compressing(target)), status) : await send(msg.chat.id, t.compressing(target), reply(msg));
    try {
      const file = await bot.api.getFile(image.fileId);
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!res.ok) throw new Error(`Telegram віддав файл з кодом ${res.status}`);
      const original = new Uint8Array(await res.arrayBuffer());
      const result = await compressToSize(images, original, target);
      const sizeLabel = formatSize(target).replace(/\s|,/g, "");
      await bot.api.sendDocument(msg.chat.id, new InputFile(result.bytes, `${image.name}_${sizeLabel}.jpg`), {
        ...HTML, ...reply(msg),
        caption: result.fits
          ? t.compressed(original.length, result.size, result.width, result.height)
          : t.compressedNear(target, result.size),
      });
      await bot.api.deleteMessage(msg.chat.id, status.message_id).catch(() => {});
      console.log(`Фото: ${formatSize(original.length)} → ${formatSize(result.size)} (ціль ${formatSize(target)})`);
    } catch (err) {
      console.error("Стиснення:", err.description ?? err.message);
      await edit(status, err instanceof MonthLimitError ? t.monthLimit
        : err instanceof UnsupportedImageError ? t.photoUnsupported : t.photoFailed);
    }
  }

  // ---- Повідомлення ----

  // Що зробити з повідомленням користувача (після перевірки підписки).
  async function handle(msg) {
    const url = findTikTokUrl(msg.text ?? msg.caption);
    if (url) return handleTikTok(msg, url);
    const image = imageOf(msg);
    if (image) return offerCompression(msg, image);
    return send(msg.chat.id, msg.text?.startsWith("/start") ? t.start : t.help);
  }

  bot.command("start", (ctx) => send(ctx.chat.id, t.start));

  bot.chatType("private").on("message", async (ctx) => {
    if (!(await hasAccess(ctx.from.id))) return sendGate(ctx.message);
    await handle(ctx.message);
  });

  // «Я підписався — продовжити»: перевіряємо й робимо те, про що людина просила.
  bot.callbackQuery("check_sub", async (ctx) => {
    if (!(await hasAccess(ctx.from.id, true))) {
      return ctx.answerCallbackQuery({ text: t.notYet, show_alert: true });
    }
    await ctx.answerCallbackQuery();
    await bot.api.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id).catch(() => {});
    const original = ctx.callbackQuery.message.reply_to_message;
    await (original ? handle(original) : send(ctx.chat.id, t.start));
  });

  // Вибраний розмір: фото беремо з повідомлення, на яке відповідали кнопки.
  bot.callbackQuery(/^size:(\d+)$/, async (ctx) => {
    if (!(await hasAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery();
      return sendGate(ctx.callbackQuery.message.reply_to_message ?? ctx.callbackQuery.message);
    }
    await ctx.answerCallbackQuery();
    const original = ctx.callbackQuery.message.reply_to_message;
    const image = imageOf(original);
    if (!image) return edit(ctx.callbackQuery.message, t.photoGone);
    await compress(original, image, Number(ctx.match[1]), ctx.callbackQuery.message);
  });

  bot.catch((err) => console.error("Помилка обробки оновлення:", err.error));
  return bot;
}
