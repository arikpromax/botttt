import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fakeImages, harness, tiktokVideo } from "./harness.js";
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

  it("надсилає відео без водяного знака й окремо звук", async () => {
    const h = harness({ tiktok: tiktokVideo(5 * MB) });
    const calls = await h.text(`ось ${LINK}`);
    assert.deepEqual(h.methods(calls), ["sendMessage", "sendVideo", "sendAudio", "deleteMessage"]);
    const video = calls.find((c) => c.method === "sendVideo");
    assert.equal(video.payload.video, "https://cdn.test/hd.mp4"); // до 20 МБ — Telegram бере сам за посиланням
    assert.match(video.payload.caption, /Без водяного знака · @test_bot/);
    assert.equal(calls.find((c) => c.method === "sendAudio").payload.title, "Original sound");
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
    assert.deepEqual(buttons, ["3 МБ", "2 МБ", "1 МБ", "500 КБ", "300 КБ", "200 КБ", "100 КБ", "50 КБ"]);

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

  it("маленьке фото не чіпає", async () => {
    const h = harness();
    assert.match(h.texts(await h.photo(40 * KB)), /вже маленьке/);
  });

  it("каже про вичерпаний місячний ліміт", async () => {
    const h = harness({ images: fakeImages({ fail: "limit" }) });
    assert.match(h.texts(await h.photo(4 * MB, { caption: "300кб" })), /Ліміт стиснень/);
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
