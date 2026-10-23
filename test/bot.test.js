import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fakeImages, fakeJpeg, fakeMp4, harness, tiktokVideo } from "./harness.js";
import { decodeQrPng, readInputFile, sampleVideo } from "./fixtures.js";
import { audioKbps } from "../src/mp4.js";
import { findTikTokUrl, resolveTikTok } from "../src/tiktok.js";
import { compressToSize, parseSize, sizeChoices, MonthLimitError } from "../src/compress.js";

const MB = 1024 * 1024;
const KB = 1024;
const LINK = "https://vm.tiktok.com/ZMabc123/";

describe("TikTok", () => {
  it("знаходить посилання в тексті", () => {
    assert.equal(findTikTokUrl(`глянь ${LINK} класне`), LINK);
    assert.equal(findTikTokUrl("www.tiktok.com/@cat/video/123?is=1"), "https://www.tiktok.com/@cat/video/123?is=1");
    assert.equal(findTikTokUrl("https://youtube.com/watch?v=1"), null);
  });

  it("розбирає відповідь сервісу: відео, звук, слайди", async () => {
    const one = async (json) => resolveTikTok(LINK, async () => new Response(JSON.stringify(json)));
    const video = await one(tiktokVideo(5 * MB));
    assert.equal(video.video.url, "https://cdn.test/hd.mp4");
    assert.equal(video.music.url, "https://cdn.test/sound.mp3");
    const slides = await one(tiktokVideo(0, { images: ["https://cdn.test/1.jpg", "/rel/2.jpg"] }));
    assert.equal(slides.video, null);
    assert.deepEqual(slides.images, ["https://cdn.test/1.jpg", "https://www.tikwm.com/rel/2.jpg"]);
    await assert.rejects(one({ code: -1, msg: "Url parsing is failed" }), /Url parsing/);
  });

  it("надсилає відео з обкладинкою й окремо звук треком, без зайвих повідомлень", async () => {
    const h = harness({ tiktok: tiktokVideo(5 * MB) });
    const from = h.tg.calls.length;
    const calls = await h.text(`ось ${LINK}`);
    assert.deepEqual(h.methods(calls), ["sendVideo", "sendAudio"]);
    assert.ok(h.tg.calls.slice(from).some((c) => c.method === "sendChatAction" && c.payload.action === "upload_video"));

    const video = calls.find((c) => c.method === "sendVideo").payload;
    assert.equal(video.video, "https://cdn.test/hd.mp4"); // до 20 МБ — Telegram бере сам за посиланням
    assert.equal(video.cover, "https://cdn.test/cover.jpg");
    assert.equal(video.duration, 15);
    assert.match(video.caption, /Без водяного знака · @test_bot/);

    const audio = calls.find((c) => c.method === "sendAudio").payload;
    assert.equal(typeof audio.audio, "object"); // файлом, щоб Telegram показав трек, а не документ
    assert.equal(audio.audio.filename, "Original sound.m4a");
    assert.equal(audio.title, "Original sound");
    assert.equal(audio.performer, "Cat");
  });

  it("якщо Telegram не прийняв обкладинку — надсилає відео без неї", async () => {
    const h = harness({ tiktok: tiktokVideo(5 * MB) });
    h.tg.rejectCover = true;
    const videos = (await h.text(LINK)).filter((c) => c.method === "sendVideo");
    assert.equal(videos.at(-1).payload.cover, undefined);
    assert.equal(h.tg.calls.filter((c) => c.method === "sendVideo" && c.payload.cover).length >= 1, true);
  });

  it("великі відео (20–50 МБ) надсилає сам, а понад 50 МБ дає посилання", async () => {
    const big = harness({ tiktok: tiktokVideo(30 * MB) });
    const video = (await big.text(LINK)).find((c) => c.method === "sendVideo");
    assert.equal(typeof video.payload.video, "object"); // файл, а не посилання

    const huge = harness({ tiktok: tiktokVideo(60 * MB, { play: "https://cdn.test/sd.mp4", size: 60 * MB }) });
    const calls = await huge.text(LINK);
    assert.ok(!calls.some((c) => c.method === "sendVideo"));
    assert.match(huge.texts(calls), /завелике[\s\S]*https:\/\/cdn\.test\/sd\.mp4/);
  });

  it("якщо Telegram не взяв посилання — надсилає файл сам", async () => {
    const h = harness({ tiktok: tiktokVideo(5 * MB) });
    h.tg.rejectUrl = true;
    const videos = (await h.text(LINK)).filter((c) => c.method === "sendVideo");
    assert.equal(videos.length, 2);
    assert.equal(typeof videos[1].payload.video, "object");
  });

  it("слайди надсилає альбомом і звук", async () => {
    const images = Array.from({ length: 12 }, (_, i) => `https://cdn.test/${i}.jpg`);
    const h = harness({ tiktok: tiktokVideo(0, { images }) });
    const calls = await h.text(LINK);
    const groups = calls.filter((c) => c.method === "sendMediaGroup");
    assert.deepEqual(groups.map((g) => g.payload.media.length), [10, 2]);
    assert.ok(calls.some((c) => c.method === "sendAudio"));
  });

  it("коли tikwm не відповідає — бере відео прямо зі сторінки TikTok і передає його з куками", async () => {
    const h = harness({ page: {
      desc: "Котик", author: { uniqueId: "cat" },
      video: { playAddr: "https://cdn.test/page.mp4", size: "9513819", width: 576, height: 1024, duration: 58, originCover: "https://cdn.test/c.jpg" },
      music: { playUrl: "https://cdn.test/page.m4a", title: "Original sound", authorName: "Cat" },
    } });
    const calls = await h.text(LINK);
    const video = calls.find((c) => c.method === "sendVideo").payload;
    assert.equal(typeof video.video, "object"); // за посиланням Telegram не візьме — потрібні куки
    assert.deepEqual([video.width, video.height, video.duration, video.cover], [576, 1024, 58, "https://cdn.test/c.jpg"]);
    const download = h.fetches.find((f) => f.url === "https://cdn.test/page.mp4");
    assert.match(download.headers.cookie, /ttwid=a1; tt_chain_token=b2/);
    assert.ok(h.fetches.some((f) => f.url === "https://cdn.test/page.m4a"));
  });

  it("читає бітрейт звуку з початку MP4", () => {
    assert.equal(audioKbps(fakeMp4({ audioKbps: 64 })), 64);
    assert.equal(audioKbps(fakeMp4({ audioKbps: 0 })), 0); // лише відео
    assert.equal(audioKbps(fakeMp4({ audioKbps: 64 }).subarray(0, 30)), null); // moov не завантажено
  });

  it("зі сторінки бере версію з найкращим звуком, без звуку — відкидає", async () => {
    const variant = (url, codec, height) => ({ GearName: url, CodecType: codec, PlayAddr: { UrlList: [url], DataSize: "1000000", Width: 720, Height: height } });
    const h = harness({
      page: {
        video: {
          playAddr: "https://cdn.test/h264.mp4", size: "1000000",
          bitrateInfo: [
            variant("https://cdn.test/h264.mp4", "h264", 1024),
            variant("https://cdn.test/hevc64.mp4", "h265_hvc1", 1280),
            variant("https://cdn.test/hevc-mute.mp4", "h265_hvc1", 1920),
          ],
        },
      },
      files: {
        "https://cdn.test/h264.mp4": fakeMp4({ audioKbps: 32 }),
        "https://cdn.test/hevc64.mp4": fakeMp4({ audioKbps: 64 }),
        "https://cdn.test/hevc-mute.mp4": fakeMp4({ audioKbps: 0 }),
      },
    });
    await h.text(LINK);
    const download = h.fetches.filter((f) => !f.headers.range && f.url.endsWith(".mp4")).at(-1);
    assert.equal(download.url, "https://cdn.test/hevc64.mp4");
  });

  it("спершу пробує tikwm (HD) і тоді сторінку TikTok не чіпає", async () => {
    const h = harness({ tiktok: tiktokVideo(5 * MB), page: { video: { playAddr: "https://cdn.test/page.mp4" } } });
    const calls = await h.text(LINK);
    assert.equal(calls.find((c) => c.method === "sendVideo").payload.video, "https://cdn.test/hd.mp4");
    assert.ok(!h.fetches.some((f) => /tiktok\.com\//.test(f.url)), "сторінка не потрібна");
  });

  it("відео з обмеженням: сторінка порожня — пробує tikwm, а якщо й там ні, то пояснює", async () => {
    const restricted = { id: "1", desc: "", video: {}, warnInfo: [{}] };
    const viaTikwm = harness({ page: restricted, tiktok: tiktokVideo(5 * MB) });
    assert.ok((await viaTikwm.text(LINK)).some((c) => c.method === "sendVideo"));

    const nowhere = harness({ page: restricted });
    const calls = await nowhere.text(LINK);
    assert.ok(!calls.some((c) => c.method === "sendVideo"));
    assert.match(nowhere.texts(calls), /без входу в акаунт/);
  });

  it("каже, що не вдалося, якщо сервіс не впізнав посилання", async () => {
    const h = harness({ tiktok: { code: -1, msg: "Url parsing is failed!" } });
    assert.match(h.texts(await h.text(LINK)), /Не вдалося завантажити/);
  });
});

describe("обов'язкова підписка", () => {
  it("без підписки просить підписатись, після — робить те, що просили", async () => {
    const h = harness({ tiktok: tiktokVideo(5 * MB) });
    h.tg.member = "left";
    const gate = await h.text(LINK);
    assert.match(h.texts(gate), /Потрібна підписка/);
    assert.ok(!gate.some((c) => c.method === "sendVideo"));

    const original = gate[0].payload.reply_parameters && { message_id: gate[0].payload.reply_parameters.message_id, date: 0, chat: { id: 111, type: "private" }, text: LINK };
    const notYet = await h.press("check_sub", original); // ще не підписаний — лише спливне повідомлення
    assert.match(h.texts(notYet), /Підписки поки не видно/);
    assert.ok(!notYet.some((c) => c.method === "sendVideo"));
    h.tg.member = "member";
    const after = await h.press("check_sub", original);
    assert.ok(after.some((c) => c.method === "sendVideo"));
  });
});

describe("стиснення фото", () => {
  it("пропонує лише розміри, менші за фото, і стискає до вибраного", async () => {
    const h = harness();
    const [ask] = await h.photo(4 * MB);
    const buttons = ask.payload.reply_markup.inline_keyboard.flat().map((b) => b.text);
    assert.deepEqual(buttons, ["3 МБ", "2 МБ", "1 МБ", "500 КБ", "300 КБ", "200 КБ", "100 КБ", "50 КБ", "У PDF", "Скан документа", "Стікер"]);

    const original = { message_id: ask.payload.reply_parameters.message_id, date: 0, chat: { id: 111, type: "private" },
      photo: [{ file_id: "big", file_unique_id: "b", width: 4000, height: 3000, file_size: 4 * MB }] };
    const calls = await h.press(`size:${500 * KB}`, original);
    const doc = calls.find((c) => c.method === "sendDocument");
    assert.ok(doc, "надіслано файл");
    assert.match(doc.payload.caption, /Було 4 МБ → стало/);
    assert.match(doc.payload.document.filename, /^photo_500КБ\.jpg$/);
    assert.ok(h.images.calls.length <= 3);
  });

  it("розмір у підписі — стискає одразу, без кнопок", async () => {
    const h = harness();
    const calls = await h.photo(4 * MB, { caption: "до 300 кб" });
    assert.ok(calls.some((c) => c.method === "sendDocument"));
  });

  it("не стискає до розміру, більшого за фото", async () => {
    const h = harness({ fileBytes: 60 * KB });
    const calls = await h.photo(60 * KB, { caption: "1 мб" });
    assert.match(h.texts(calls), /Фото вже 60 КБ — це менше за 1 МБ/);
    assert.ok(!calls.some((c) => c.method === "sendDocument"));
    assert.equal(h.images.calls.length, 0);
  });

  it("не віддає файл, більший за оригінал", async () => {
    // Фото 60 КБ, а «стиснене» виходить сотні кілобайт — віддавати таке не можна.
    const h = harness({ fileBytes: 60 * KB, images: fakeImages({ width: 400, height: 300, base: 900 * KB }) });
    const calls = await h.photo(60 * KB, { caption: "50 кб" });
    assert.ok(!calls.some((c) => c.method === "sendDocument"));
    assert.match(h.texts(calls), /фото й так оптимальне \(60 КБ\)/);
  });

  it("маленьке фото не стискає, але пропонує PDF, скан і стікер", async () => {
    const h = harness();
    const [menu] = await h.photo(40 * KB);
    assert.match(menu.payload.text, /уже маленьке/);
    assert.deepEqual(menu.payload.reply_markup.inline_keyboard.flat().map((b) => b.text), ["У PDF", "Скан документа", "Стікер"]);
  });

  it("каже про вичерпаний місячний ліміт", async () => {
    const h = harness({ images: fakeImages({ fail: "limit" }) });
    assert.match(h.texts(await h.photo(4 * MB, { caption: "300кб" })), /Ліміт обробки фото/);
  });
});

describe("фото → PDF і JPG", () => {
  const photoMsg = (h) => h.newMessage({ photo: [{ file_id: "big", file_unique_id: "b", width: 800, height: 600, file_size: 300 * KB }] });

  it("одне фото → PDF на одну сторінку (фото з Telegram — без зайвої обробки)", async () => {
    const h = harness({ fileBytes: fakeJpeg(800, 600, 300 * KB) });
    const calls = await h.press("pdf", photoMsg(h));
    const doc = calls.find((c) => c.method === "sendDocument").payload;
    assert.equal(doc.document.filename, "photo.pdf");
    assert.match(doc.caption, /PDF · 1 сторінка/);
    assert.equal(h.images.calls.length, 0);
  });

  it("під звичайним фото підказує надсилати файлом, під файлом — ні", async () => {
    const h = harness();
    const [photoMenu] = await h.photo(300 * KB);
    assert.match(photoMenu.payload.text, /надішли фото <b>файлом<\/b>: скріпка → Файл/);
    const [fileMenu] = await h.post({ document: { file_id: "f", file_unique_id: "f", file_name: "a.jpg", mime_type: "image/jpeg", file_size: 300 * KB } });
    assert.doesNotMatch(fileMenu.payload.text, /скріпка → Файл/);
  });

  it("PNG-файл → кнопка «У JPG» і перетворення через Cloudflare Images", async () => {
    const h = harness({ fileBytes: 2 * MB });
    const [menu] = await h.post({ document: { file_id: "png", file_unique_id: "p", file_name: "скрін.png", mime_type: "image/png", file_size: 2 * MB } });
    assert.ok(menu.payload.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "jpg"));
    const original = h.newMessage({ document: { file_id: "png", file_unique_id: "p", file_name: "скрін.png", mime_type: "image/png", file_size: 2 * MB } });
    const doc = (await h.press("jpg", original)).find((c) => c.method === "sendDocument").payload;
    assert.equal(doc.document.filename, "скрін.jpg");
    assert.equal(h.images.calls.length, 1);
  });

  it("альбом → одне меню на весь альбом і PDF з усіх фото", async () => {
    const h = harness({ fileBytes: fakeJpeg(800, 600, 200 * KB) });
    const photo = (id) => ({ media_group_id: "G1", photo: [{ file_id: id, file_unique_id: id, width: 800, height: 600, file_size: 200 * KB }] });
    const [first, second, third] = [h.newMessage(photo("p1")), h.newMessage(photo("p2")), h.newMessage(photo("p3"))];
    const from = h.tg.calls.length;
    await Promise.all([first, second, third].map((message) => h.send({ message })));
    const menus = h.tg.calls.slice(from).filter((c) => c.method === "sendMessage");
    assert.equal(menus.length, 1);
    assert.match(menus[0].payload.text, /Альбом: 3 фото/);

    const doc = (await h.press("album:G1", first)).find((c) => c.method === "sendDocument").payload;
    assert.equal(doc.document.filename, "photos.pdf");
    assert.match(doc.caption, /3 сторінки/);
  });
});

describe("звук із відео", () => {
  const videoMsg = (h, size) => h.newMessage({ video: { file_id: "v", file_unique_id: "v", width: 720, height: 1280, duration: 3, file_size: size } });

  it("відео → меню → M4A зі звуком", async () => {
    const video = sampleVideo();
    const h = harness({ fileBytes: video.bytes });
    const [menu] = await h.post({ video: { file_id: "v", file_unique_id: "v", width: 720, height: 1280, duration: 3, file_size: video.bytes.length } });
    assert.deepEqual(menu.payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ["sound"]);
    const audio = (await h.press("sound", videoMsg(h, video.bytes.length))).find((c) => c.method === "sendAudio").payload;
    assert.equal(audio.audio.filename, "video.m4a");
    assert.equal(audio.title, "Звук із відео");
    assert.equal(audio.duration, 3);
  });

  it("відео без звуку й завелике — пояснює", async () => {
    const mute = harness({ fileBytes: sampleVideo({ withAudio: false }).bytes });
    assert.match(mute.texts(await mute.press("sound", videoMsg(mute, 1000))), /немає звуку/);
    const big = harness();
    assert.match(big.texts(await big.post({ video: { file_id: "v", file_unique_id: "v", width: 1, height: 1, duration: 1, file_size: 30 * MB } })), /до 20 МБ/);
  });
});

describe("QR-код", () => {
  it("текст → кнопка → картинка, яку сканер читає назад у той самий текст", async () => {
    const h = harness();
    const [menu] = await h.text("Привіт, Ара! https://t.me/arawebsite_bot");
    assert.deepEqual(menu.payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ["qr", "translit"]);
    const photo = (await h.press("qr", h.newMessage({ text: "Привіт, Ара! https://t.me/arawebsite_bot" })))
      .find((c) => c.method === "sendPhoto").payload;
    const png = await readInputFile(photo.photo);
    assert.equal(await decodeQrPng(png), "Привіт, Ара! https://t.me/arawebsite_bot");
  });

  it("задовгий текст — пояснює, без кнопки; український — лишає «Латиницею»", async () => {
    const h = harness();
    const [reply] = await h.text("a".repeat(400));
    assert.match(reply.payload.text, /Задовгий текст/);
    assert.equal(reply.payload.reply_markup, undefined);
    const [menu] = await h.text("я".repeat(200));
    assert.match(menu.payload.text, /Для QR-коду він задовгий/);
    assert.deepEqual(menu.payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ["translit"]);
  });

  it("команди й тікток не плутає з текстом для QR", async () => {
    const h = harness({ tiktok: tiktokVideo(MB) });
    assert.ok(!(await h.text("/help")).some((c) => c.payload.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data === "qr")));
    assert.ok((await h.text(LINK)).some((c) => c.method === "sendVideo"));
  });
});

describe("підбір розміру", () => {
  it("вміщається в ціль не більш ніж за 3 спроби", async () => {
    for (const target of [3 * MB, 1 * MB, 300 * KB, 100 * KB, 50 * KB]) {
      const images = fakeImages();
      const r = await compressToSize(images, new Uint8Array(10), target);
      assert.ok(r.fits && r.size <= target, `ціль ${target}: ${r.size}`);
      assert.ok(images.calls.length <= 3);
    }
  });

  it("якщо не вміщається — віддає найменше й чесно про це каже", async () => {
    const r = await compressToSize(fakeImages({ width: 400, height: 300, base: 900 * KB }), new Uint8Array(10), 20 * KB);
    assert.equal(r.fits, false);
  });

  it("ліміт місяця — окрема помилка", async () => {
    await assert.rejects(compressToSize(fakeImages({ fail: "limit" }), new Uint8Array(10), 100 * KB), MonthLimitError);
  });

  it("розуміє розмір у тексті й пропонує варіанти", () => {
    assert.equal(parseSize("300 кб"), 300 * KB);
    assert.equal(parseSize("1,5 мб"), 1.5 * MB);
    assert.equal(parseSize("2MB"), 2 * MB);
    assert.equal(parseSize("привіт"), null);
    assert.deepEqual(sizeChoices(600 * KB).map((s) => s / KB), [500, 300, 200, 100, 50]);
  });
});
