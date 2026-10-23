// Бот із підробленими Telegram, tikwm і Cloudflare Images: перевіряємо логіку без мережі.
import { createBot } from "../src/bot.js";
import { memoryAlbums } from "../src/albums.js";

// Найпростіший «JPEG»: SOI, JFIF, SOF0 з розмірами й 3 каналами, далі нулі до потрібного розміру.
export function fakeJpeg(width = 800, height = 600, size = 2048) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const out = new Uint8Array(Math.max(size, head.length + 2));
  out.set(head);
  out.set([0xff, 0xd9], out.length - 2);
  return out;
}

export const USER = { id: 111, is_bot: false, first_name: "Таня" };
const BOT_INFO = {
  id: 1, is_bot: true, first_name: "Ara Converter", username: "test_bot",
  can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
};
const MB = 1024 * 1024;

// Підроблений Cloudflare Images: розмір JPEG ≈ оригінал × (ширина/оригінальна)² × (якість/100)².
export function fakeImages({ width = 4000, height = 3000, base = 4 * MB, fail } = {}) {
  const calls = [];
  return {
    calls,
    info: async () => {
      if (fail === "unsupported") throw new Error("unsupported");
      return { width, height, fileSize: base, format: "image/jpeg" };
    },
    input: () => {
      let w = width;
      const chain = {
        transform: (opts) => ((w = opts.width ?? w), chain),
        output: async ({ quality }) => {
          if (fail === "limit") throw new Error("IMAGES_TRANSFORM_ERROR 9422: limit");
          calls.push({ width: w, quality });
          const size = Math.round(base * (w / width) ** 2 * (quality / 100) ** 2);
          return { response: async () => new Response(fakeJpeg(w, Math.round((w * height) / width), size)) };
        },
      };
      return chain;
    },
  };
}

// Сторінка TikTok так, як її віддає сайт: дані в <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"> і куки.
export function tiktokPage(itemStruct) {
  const data = { __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct }, statusCode: 0 } } };
  const html = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></html>`;
  const headers = new Headers({ "content-type": "text/html" });
  headers.append("set-cookie", "ttwid=a1; Path=/");
  headers.append("set-cookie", "tt_chain_token=b2; Path=/");
  return new Response(html, { headers });
}

// Мінімальний MP4: ftyp + moov з однією доріжкою (звук із заданим бітрейтом або відео без звуку) + mdat.
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const concat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const box = (type, ...parts) => concat([u32(8 + parts.reduce((n, p) => n + p.length, 0)), ascii(type), ...parts]);
export function fakeMp4({ audioKbps = 0 } = {}) {
  const handler = audioKbps ? "soun" : "vide";
  const esds = box("esds", new Uint8Array(4), Uint8Array.from([0x03, 0x19, 0x00, 0x01, 0x00, 0x04, 0x11, 0x40, 0x15, 0, 0, 0]),
    u32(audioKbps * 1000), u32(audioKbps * 1000));
  const stsd = box("stsd", new Uint8Array(8), box("mp4a", new Uint8Array(28), esds));
  const mdia = box("mdia", box("hdlr", new Uint8Array(8), ascii(handler), new Uint8Array(12)), box("minf", box("stbl", stsd)));
  return concat([box("ftyp", ascii("isom")), box("moov", box("trak", mdia)), box("mdat", new Uint8Array(64))]);
}

// fileBytes — що віддає Telegram, коли бот завантажує файл користувача: розмір (нулі) або самі байти.
export function harness({
  channel = "@chan", tiktok, page, files = {}, images = fakeImages(), fileBytes = 4 * MB,
  albums = memoryAlbums(), albumWait = 30,
} = {}) {
  const tg = { member: "member", calls: [], rejectUrl: false, nextId: 100 };
  const fetches = [];
  const fakeFetch = async (url, init = {}) => {
    fetches.push({ url: String(url), headers: init.headers ?? {} });
    if (String(url).startsWith("https://www.tikwm.com/api/")) {
      return new Response(JSON.stringify(tiktok ?? { code: -1, msg: "no tiktok" }), { headers: { "content-type": "application/json" } });
    }
    if (/tiktok\.com\//.test(String(url))) return page ? tiktokPage(page) : new Response("blocked", { status: 403 });
    if (String(url).startsWith("https://api.telegram.org/file/")) {
      return new Response(typeof fileBytes === "number" ? new Uint8Array(fileBytes) : fileBytes);
    }
    if (files[String(url)]) return new Response(files[String(url)]);
    if (String(url).startsWith("https://cdn.test/")) return new Response(new Uint8Array(1024));
    return new Response("not found", { status: 404 });
  };

  const bot = createBot("123:TEST", { channel, images, albums, albumWait, fetch: fakeFetch, botInfo: BOT_INFO });
  bot.api.config.use(async (prev, method, payload) => {
    tg.calls.push({ method, payload });
    const ok = (result) => ({ ok: true, result });
    if (method === "getChatMember") return ok({ status: tg.member, user: { id: payload.user_id } });
    if (method === "getFile") return ok({ file_id: payload.file_id, file_unique_id: "u", file_path: "photos/file.jpg" });
    const media = payload.video ?? payload.audio;
    if (tg.rejectUrl && typeof media === "string") {
      return { ok: false, error_code: 400, description: "Bad Request: failed to get HTTP URL content" };
    }
    if (tg.rejectCover && payload.cover) {
      return { ok: false, error_code: 400, description: "Bad Request: wrong cover" };
    }
    if (method.startsWith("answer") || method.startsWith("delete") || method === "editMessageText") return ok(true);
    if (method === "sendMediaGroup") return ok(payload.media.map(() => ({ message_id: tg.nextId++, date: 0, chat: { id: payload.chat_id, type: "private" } })));
    return ok({ message_id: tg.nextId++, date: 0, chat: { id: payload.chat_id, type: "private" } });
  });

  let updateId = 1;
  let messageId = 1;
  const chat = { id: USER.id, type: "private", first_name: USER.first_name };
  const send = async (update) => {
    const from = tg.calls.length;
    await bot.handleUpdate({ update_id: updateId++, ...update });
    return tg.calls.slice(from).filter((c) => !["getChatMember", "getFile", "sendChatAction"].includes(c.method));
  };
  const message = (extra) => ({ message_id: messageId++, date: 0, chat, from: USER, ...extra });

  return {
    bot, tg, images, fetches, send,
    texts: (calls) => calls.map((c) => c.payload.text ?? c.payload.caption ?? "").join("\n---\n"),
    methods: (calls) => calls.map((c) => c.method),
    text: (text) => send({ message: message({ text }) }),
    photo: (size, extra) => send({ message: message({ photo: [{ file_id: "small", file_unique_id: "s", width: 90, height: 60, file_size: 2000 }, { file_id: "big", file_unique_id: "b", width: 4000, height: 3000, file_size: size }], ...extra }) }),
    // Натискання кнопки під повідомленням бота, яке було відповіддю на original.
    press: (data, original) => send({ callback_query: {
      id: "cq", from: USER, chat_instance: "x", data,
      message: { message_id: 999, date: 0, chat, from: { id: 1, is_bot: true, first_name: "Ara Converter" }, text: "…", reply_to_message: original },
    } }),
    lastUserMessage: () => message({}),
    // Будь-яке повідомлення користувача: newMessage(extra) — лише побудувати, post(extra) — надіслати боту.
    newMessage: message,
    post: (extra) => send({ message: message(extra) }),
    albums,
  };
}

export const tiktokVideo = (size, extra = {}) => ({
  code: 0, msg: "success",
  data: {
    title: "Котик", author: { unique_id: "cat", nickname: "Cat" },
    play: "https://cdn.test/play.mp4", size, hdplay: "https://cdn.test/hd.mp4", hd_size: size,
    origin_cover: "https://cdn.test/cover.jpg", duration: 15,
    music: "https://cdn.test/sound.mp3", music_info: { title: "Original sound", author: "Cat" },
    ...extra,
  },
});
