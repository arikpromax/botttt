// Логіка бота Ara Converter: обов'язкова підписка на канал, TikTok без водяного знака, стиснення фото,
// фото → PDF / JPG, звук із відео. Нічого не зберігає: усе потрібне для продовження дії бот бере
// з повідомлення, на яке відповідає; лише альбоми на кілька хвилин збираються в тимчасове сховище.
import { Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { RestrictedError, findTikTokUrl, resolveTikTok } from "./tiktok.js";
import { MonthLimitError, UnsupportedImageError, compressToSize, parseSize, sizeChoices, toJpeg } from "./compress.js";
import { imagesToPdf, jpegInfo, pdfReady } from "./pdf.js";
import { NoAudioError, UnsupportedVideoError, extractAudio } from "./audio.js";
import { formatSize, t } from "./texts.js";

const HTML = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
const MEMBER = new Set(["creator", "administrator", "member"]);
const ACCESS_TTL = 60_000; // мс: як довго вірити перевірці підписки в межах одного екземпляра воркера
const URL_LIMIT = 20 * 1024 * 1024; // за посиланням Telegram сам завантажує до 20 МБ
const UPLOAD_LIMIT = 50 * 1024 * 1024; // бот може надіслати файл до 50 МБ
const FILE_LIMIT = 20 * 1024 * 1024; // бот може отримати файл до 20 МБ

export const COMMANDS = [{ command: "start", description: "Що вміє бот" }];

// channel — «@username» каналу для обов'язкової підписки; images — Cloudflare Images (env.IMAGES);
// albums — тимчасове сховище фото з альбомів (albums.js); albumWait — скільки чекати решту фото альбому, мс.
export function createBot(token, { channel, images, albums = null, albumWait = 2000, fetch = globalThis.fetch, ...config }) {
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

  // ---- Файли користувача ----

  async function download(fileId) {
    const file = await bot.api.getFile(fileId);
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!res.ok) throw new Error(`Telegram віддав файл з кодом ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  const baseName = (name, fallback) => (name ?? fallback).replace(/\.[^.]+$/, "").slice(0, 60) || fallback;

  // Фото з повідомлення: стиснуте Telegram (photo) або надіслане файлом (document з картинкою).
  function imageOf(msg) {
    if (msg?.photo) {
      const p = msg.photo.at(-1);
      return { fileId: p.file_id, size: p.file_size ?? 0, width: p.width, height: p.height, name: "photo", isDoc: false, jpeg: true };
    }
    const d = msg?.document;
    if (d && /^image\//.test(d.mime_type ?? "")) {
      return { fileId: d.file_id, size: d.file_size ?? 0, name: baseName(d.file_name, "photo"), isDoc: true, jpeg: d.mime_type === "image/jpeg" };
    }
    return null;
  }

  // Відео з повідомлення: звичайне відео, кружечок або файл із відео.
  function videoOf(msg) {
    const v = msg?.video ?? msg?.video_note;
    if (v) return { fileId: v.file_id, size: v.file_size ?? 0, name: baseName(v.file_name, "video") };
    const d = msg?.document;
    if (d && (/^video\//.test(d.mime_type ?? "") || /\.(mp4|mov|m4v)$/i.test(d.file_name ?? ""))) {
      return { fileId: d.file_id, size: d.file_size ?? 0, name: baseName(d.file_name, "video") };
    }
    return null;
  }

  // ---- Фото: стиснення, PDF, JPG ----

  function photoKeyboard(image, choices) {
    const keyboard = new InlineKeyboard();
    choices.forEach((size, i) => {
      keyboard.text(formatSize(size), `size:${size}`);
      if (i % 3 === 2 || i === choices.length - 1) keyboard.row();
    });
    keyboard.text(t.pdfButton, "pdf");
    if (!image.jpeg) keyboard.text(t.jpgButton, "jpg");
    return keyboard;
  }

  async function offerPhoto(msg, image) {
    if (image.size > FILE_LIMIT) return send(msg.chat.id, t.photoTooBig, reply(msg));
    const target = parseSize(msg.caption);
    if (target && image.size && target >= image.size * 0.95) {
      return send(msg.chat.id, t.alreadyUnder(target, image.size), reply(msg));
    }
    if (target) return compress(msg, image, target);
    const choices = sizeChoices(image.size);
    await send(msg.chat.id, choices.length ? t.photoMenu(image.size, image.width, image.height) : t.photoMenuSmall(image.size), {
      ...reply(msg), reply_markup: photoKeyboard(image, choices),
    });
  }

  function photoError(err) {
    console.error("Фото:", err.description ?? err.message);
    return err instanceof MonthLimitError ? t.monthLimit : err instanceof UnsupportedImageError ? t.photoUnsupported : t.photoFailed;
  }

  async function compress(msg, image, target, status) {
    status = status ? (await edit(status, t.compressing(target)), status) : await send(msg.chat.id, t.compressing(target), reply(msg));
    try {
      const original = await download(image.fileId);
      if (target >= original.length * 0.95) return edit(status, t.alreadyUnder(target, original.length));
      const result = await compressToSize(images, original, target);
      // Більший файл, ніж був, не віддаємо: фото вже стиснуте краще, ніж вийшло б у нас.
      if (result.size >= original.length) {
        console.log(`Фото: ${formatSize(original.length)} — менше не вийшло (ціль ${formatSize(target)})`);
        return edit(status, t.notSmaller(original.length));
      }
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
      await edit(status, photoError(err));
    }
  }

  // JPEG, придатний для PDF. Фото з Telegram уже такі; файли проганяємо через Cloudflare Images
  // (поворот за EXIF, будь-який формат → JPEG, не більше 2480 px — це A4 у 300 dpi).
  async function pdfJpeg(image) {
    const bytes = await download(image.fileId);
    if (!image.isDoc && pdfReady(jpegInfo(bytes))) return bytes;
    return toJpeg(images, bytes, { maxWidth: 2480, quality: 88 });
  }

  async function makePdf(msg, list, status) {
    status = status ? (await edit(status, t.pdfMaking(list.length)), status) : await send(msg.chat.id, t.pdfMaking(list.length), reply(msg));
    try {
      const pages = [];
      for (const image of list) pages.push(await pdfJpeg(image));
      const pdf = imagesToPdf(pages);
      const name = list.length === 1 ? list[0].name : "photos";
      await bot.api.sendDocument(msg.chat.id, new InputFile(pdf, `${name}.pdf`), {
        ...HTML, ...reply(msg), caption: t.pdfDone(list.length, pdf.length),
      });
      await bot.api.deleteMessage(msg.chat.id, status.message_id).catch(() => {});
      console.log(`PDF: ${list.length} фото → ${formatSize(pdf.length)}`);
    } catch (err) {
      await edit(status, photoError(err));
    }
  }

  async function makeJpg(msg, image, status) {
    await edit(status, t.jpgMaking);
    try {
      const jpg = await toJpeg(images, await download(image.fileId), { maxWidth: 8000, quality: 90 });
      await bot.api.sendDocument(msg.chat.id, new InputFile(jpg, `${image.name}.jpg`), {
        ...HTML, ...reply(msg), caption: t.jpgDone(jpg.length),
      });
      await bot.api.deleteMessage(msg.chat.id, status.message_id).catch(() => {});
      console.log(`JPG: ${formatSize(jpg.length)}`);
    } catch (err) {
      await edit(status, photoError(err));
    }
  }

  // ---- Альбом фото → одне меню ----
  // Фото альбому приходять окремими повідомленнями; збираємо їх у тимчасове сховище (albums) і чекаємо,
  // поки дійдуть усі. Меню показує лише перше фото альбому.

  async function collectAlbum(msg, image) {
    await albums.add({
      group_id: msg.media_group_id, chat_id: msg.chat.id, message_id: msg.message_id,
      file_id: image.fileId, is_doc: image.isDoc ? 1 : 0, size: image.size, name: image.name,
    });
    await new Promise((resolve) => setTimeout(resolve, albumWait));
    const items = await albums.list(msg.media_group_id);
    if (items[0]?.message_id !== msg.message_id) return;
    await albums.cleanup();
    await send(msg.chat.id, t.albumMenu(items.length), {
      ...reply(msg), reply_markup: new InlineKeyboard().text(t.albumPdfButton(items.length), `album:${msg.media_group_id}`),
    });
  }

  const albumImages = (items) => items.map((it) => ({
    fileId: it.file_id, size: it.size, name: it.name, isDoc: Boolean(it.is_doc), jpeg: !it.is_doc,
  }));

  // ---- Звук із відео ----

  async function offerVideo(msg, video) {
    if (video.size > FILE_LIMIT) return send(msg.chat.id, t.videoTooBig(video.size), reply(msg));
    await send(msg.chat.id, t.videoMenu(video.size), {
      ...reply(msg), reply_markup: new InlineKeyboard().text(t.soundButton, "sound"),
    });
  }

  async function extractSound(msg, video, status) {
    await edit(status, t.soundMaking);
    try {
      const audio = extractAudio(await download(video.fileId));
      await bot.api.sendAudio(msg.chat.id, new InputFile(audio.bytes, `${video.name}.m4a`), {
        ...reply(msg), title: video.name === "video" ? t.soundTitle : video.name, duration: audio.duration || undefined,
      });
      await bot.api.deleteMessage(msg.chat.id, status.message_id).catch(() => {});
      console.log(`Звук із відео: ${formatSize(video.size)} → ${formatSize(audio.bytes.length)} (${audio.codec}, ${audio.duration} с)`);
    } catch (err) {
      console.error("Звук із відео:", err.description ?? err.message);
      await edit(status, err instanceof NoAudioError ? t.noSound
        : err instanceof UnsupportedVideoError ? t.videoUnsupported : t.soundFailed);
    }
  }

  // ---- Повідомлення ----

  // Що зробити з повідомленням користувача (після перевірки підписки).
  async function handle(msg) {
    const url = findTikTokUrl(msg.text ?? msg.caption);
    if (url) return handleTikTok(msg, url);
    const image = imageOf(msg);
    if (image && msg.media_group_id && albums) return collectAlbum(msg, image);
    if (image) return offerPhoto(msg, image);
    const video = videoOf(msg);
    if (video) return offerVideo(msg, video);
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

  // Кнопки під меню: файл беремо з повідомлення, на яке меню відповідало. Підписку перевіряємо й тут.
  function onButton(pattern, action) {
    bot.callbackQuery(pattern, async (ctx) => {
      await ctx.answerCallbackQuery();
      const menu = ctx.callbackQuery.message;
      const original = menu.reply_to_message;
      if (!(await hasAccess(ctx.from.id))) return sendGate(original ?? menu);
      await action({ ctx, menu, original });
    });
  }

  onButton(/^size:(\d+)$/, ({ ctx, menu, original }) => {
    const image = imageOf(original);
    return image ? compress(original, image, Number(ctx.match[1]), menu) : edit(menu, t.photoGone);
  });

  onButton("pdf", ({ menu, original }) => {
    const image = imageOf(original);
    return image ? makePdf(original, [image], menu) : edit(menu, t.photoGone);
  });

  onButton("jpg", ({ menu, original }) => {
    const image = imageOf(original);
    return image ? makeJpg(original, image, menu) : edit(menu, t.photoGone);
  });

  onButton(/^album:(.+)$/, async ({ ctx, menu, original }) => {
    const items = albums ? await albums.list(ctx.match[1]) : [];
    if (!items.length) return edit(menu, t.albumGone);
    return makePdf(original ?? menu, albumImages(items), menu);
  });

  onButton("sound", ({ menu, original }) => {
    const video = videoOf(original);
    return video ? extractSound(original, video, menu) : edit(menu, t.videoGone);
  });

  bot.catch((err) => console.error("Помилка обробки оновлення:", err.error));
  return bot;
}
