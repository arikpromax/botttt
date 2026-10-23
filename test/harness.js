// Бот із підробленими Telegram, tikwm і Cloudflare Images: перевіряємо логіку без мережі.
import { createBot } from "../src/bot.js";

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
          return { response: async () => new Response(new Uint8Array(size)) };
        },
      };
      return chain;
    },
  };
}

export function harness({ channel = "@chan", tiktok, images = fakeImages() } = {}) {
  const tg = { member: "member", calls: [], rejectUrl: false, nextId: 100 };
  const fetches = [];
  const fakeFetch = async (url) => {
    fetches.push(String(url));
    if (String(url).startsWith("https://www.tikwm.com/api/")) {
      return new Response(JSON.stringify(tiktok ?? { code: -1, msg: "no tiktok" }), { headers: { "content-type": "application/json" } });
    }
    if (String(url).startsWith("https://api.telegram.org/file/")) return new Response(new Uint8Array(4 * MB));
    return new Response("not found", { status: 404 });
  };

  const bot = createBot("123:TEST", { channel, images, fetch: fakeFetch, botInfo: BOT_INFO });
  bot.api.config.use(async (prev, method, payload) => {
    tg.calls.push({ method, payload });
    const ok = (result) => ({ ok: true, result });
    if (method === "getChatMember") return ok({ status: tg.member, user: { id: payload.user_id } });
    if (method === "getFile") return ok({ file_id: payload.file_id, file_unique_id: "u", file_path: "photos/file.jpg" });
    const media = payload.video ?? payload.audio;
    if (tg.rejectUrl && typeof media === "string") {
      return { ok: false, error_code: 400, description: "Bad Request: failed to get HTTP URL content" };
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
    return tg.calls.slice(from).filter((c) => c.method !== "getChatMember" && c.method !== "getFile");
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
  };
}

export const tiktokVideo = (size, extra = {}) => ({
  code: 0, msg: "success",
  data: {
    title: "Котик", author: { unique_id: "cat", nickname: "Cat" },
    play: "https://cdn.test/play.mp4", size, hdplay: "https://cdn.test/hd.mp4", hd_size: size,
    music: "https://cdn.test/sound.mp3", music_info: { title: "Original sound", author: "Cat" },
    ...extra,
  },
});
