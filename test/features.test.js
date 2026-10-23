// Валюти, транслітерація, стікери, скан документа й статистика для власника.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { USER, fakeImages, fakeJpeg, harness } from "./harness.js";
import { parseConversion, resetRatesCache } from "../src/currency.js";
import { transliterate, hasCyrillic } from "../src/translit.js";
import { memoryStats } from "../src/stats.js";

const KB = 1024;
const NBU = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";
const RATES = JSON.stringify([
  { cc: "USD", rate: 45.05, exchangedate: "23.10.2026" },
  { cc: "EUR", rate: 50.44, exchangedate: "23.10.2026" },
  { cc: "PLN", rate: 11.54, exchangedate: "23.10.2026" },
  { cc: "GBP", rate: 58.1, exchangedate: "23.10.2026" },
]);
const buttons = (call) => call.payload.reply_markup.inline_keyboard.flat();
const photoMsg = (h, extra) => h.newMessage({ photo: [{ file_id: "big", file_unique_id: "b", width: 800, height: 600, file_size: 300 * KB }], ...extra });
const command = (text) => ({ text, entities: [{ type: "bot_command", offset: 0, length: text.length }] });

describe("валюти за курсом НБУ", () => {
  beforeEach(resetRatesCache);

  it("розуміє, як люди пишуть суми й валюти", () => {
    assert.deepEqual(parseConversion("100 usd"), { amount: 100, from: "USD", to: ["UAH"] });
    assert.deepEqual(parseConversion("50 євро"), { amount: 50, from: "EUR", to: ["UAH"] });
    assert.deepEqual(parseConversion("$20"), { amount: 20, from: "USD", to: ["UAH"] });
    assert.deepEqual(parseConversion("1000 грн в злоті"), { amount: 1000, from: "UAH", to: ["PLN"] });
    assert.deepEqual(parseConversion("1 000 гривень"), { amount: 1000, from: "UAH", to: ["USD", "EUR", "PLN"] });
    assert.deepEqual(parseConversion("100 доларів у євро"), { amount: 100, from: "USD", to: ["EUR"] });
    assert.deepEqual(parseConversion("2,5 фунта"), { amount: 2.5, from: "GBP", to: ["UAH"] });
    assert.deepEqual(parseConversion("Курс"), { rates: true });
    assert.equal(parseConversion("привіт як справи"), null);
    assert.equal(parseConversion("купив 2 кавуни"), null);
  });

  it("сума з валютою → одразу відповідь, «курс» → курс на сьогодні", async () => {
    const h = harness({ files: { [NBU]: RATES } });
    const [answer] = await h.text("100 usd");
    assert.match(answer.payload.text, /100,00 USD = 4\s505,00 грн/);
    assert.match(answer.payload.text, /Курс НБУ на 23\.10\.2026/);
    const [rates] = await h.text("курс");
    assert.match(rates.payload.text, /1 EUR = <b>50,44<\/b> грн/);
  });

  it("якщо НБУ не відповідає — чесно каже", async () => {
    const h = harness();
    assert.match(h.texts(await h.text("100 usd")), /Не вдалося отримати курс НБУ/);
  });
});

describe("транслітерація", () => {
  it("за правилами КМУ № 55 — як у закордонному паспорті", () => {
    const examples = {
      Згорани: "Zghorany", Розгон: "Rozghon", "Мар'їне": "Marine", "Знам'янка": "Znamianka", "Короп'є": "Koropie",
      Єнакієве: "Yenakiieve", Гаєвич: "Haievych", Їжакевич: "Yizhakevych", Кадиївка: "Kadyivka", Йосипівка: "Yosypivka",
      Стрий: "Stryi", Олексій: "Oleksii", Юрій: "Yurii", Корюківка: "Koriukivka", Яготин: "Yahotyn", Костянтин: "Kostiantyn",
      Щербухи: "Shcherbukhy", Гоща: "Hoshcha", Ґорґани: "Gorgany", Тернопіль: "Ternopil", Ужгород: "Uzhhorod",
      "Біла Церква": "Bila Tserkva", Ярослав: "Yaroslav", КИЇВ: "KYIV", Феодосія: "Feodosiia", Харків: "Kharkiv",
    };
    for (const [ua, latin] of Object.entries(examples)) assert.equal(transliterate(ua), latin, ua);
    assert.equal(transliterate("Hello, Київ!"), "Hello, Kyiv!");
    assert.ok(hasCyrillic("Київ") && !hasCyrillic("Kyiv 2026"));
  });

  it("текст → «Латиницею» → результат, який легко скопіювати", async () => {
    const h = harness();
    const [menu] = await h.text("Ярослав Шевченко");
    assert.ok(buttons(menu).some((b) => b.callback_data === "translit"));
    const result = (await h.press("translit", h.newMessage({ text: "Ярослав Шевченко" }))).find((c) => c.method === "editMessageText");
    assert.match(result.payload.text, /<code>Yaroslav Shevchenko<\/code>/);
  });
});

describe("фото → стікер", () => {
  it("питає про фон, перший стікер створює набір від імені користувача, наступні додає туди", async () => {
    const h = harness({ fileBytes: fakeJpeg(800, 600, 300 * KB) });
    const ask = (await h.press("sticker", photoMsg(h))).find((c) => c.method === "editMessageText");
    assert.deepEqual(buttons(ask).map((b) => b.callback_data), ["sticker:cut", "sticker:keep"]);

    const first = await h.press("sticker:cut", photoMsg(h));
    const created = first.find((c) => c.method === "createNewStickerSet").payload;
    assert.equal(created.user_id, 111);
    assert.equal(created.name, "ara111_by_test_bot");
    assert.equal(created.title, "Мої стікери · @test_bot");
    assert.equal(created.stickers[0].format, "static");
    assert.equal(first.find((c) => c.method === "sendSticker").payload.sticker, "st1");
    const done = first.find((c) => c.method === "editMessageText" && /Готово/.test(c.payload.text));
    assert.equal(buttons(done)[0].url, "https://t.me/addstickers/ara111_by_test_bot");
    assert.deepEqual(h.images.calls[0].transform, { width: 512, height: 512, fit: "contain", segment: "foreground" });
    assert.equal(h.images.calls[0].format, "image/webp");

    const second = await h.press("sticker:keep", photoMsg(h));
    assert.ok(second.some((c) => c.method === "addStickerToSet"));
    assert.ok(!second.some((c) => c.method === "createNewStickerSet"));
    assert.equal(second.find((c) => c.method === "sendSticker").payload.sticker, "st2");
    assert.equal(h.images.calls[1].transform.segment, undefined);
  });

  it("фон не прибрався — стікер усе одно буде, з поясненням; повний набір — пояснює", async () => {
    const h = harness({ images: fakeImages({ fail: "segment" }) });
    const calls = await h.press("sticker:cut", photoMsg(h));
    assert.ok(calls.some((c) => c.method === "sendSticker"));
    assert.match(h.texts(calls), /Фон прибрати не вдалося/);

    h.tg.stickerSets.set("ara111_by_test_bot", new Array(120).fill({}));
    assert.match(h.texts(await h.press("sticker:keep", photoMsg(h))), /набір заповнений/);
  });
});

describe("фото → емодзі й мозаїка", () => {
  const menuOf = (calls) => calls.find((c) => c.method === "editMessageText");

  it("меню пояснює про Telegram Premium — і тим, у кого він є, і тим, у кого немає", async () => {
    const h = harness();
    const plain = menuOf(await h.press("emoji", photoMsg(h)));
    assert.match(plain.payload.text, /Потрібен Telegram Premium/);
    assert.deepEqual(buttons(plain).map((b) => b.callback_data), ["emoji:cut", "emoji:keep", "emoji:3", "emoji:5"]);
    const premium = menuOf(await h.press("emoji", photoMsg(h), { ...USER, is_premium: true }));
    assert.match(premium.payload.text, /лише з Telegram Premium — у тебе він є/);
  });

  it("одне емодзі: 100×100 з прозорими полями, у власний набір емодзі, з прев'ю в повідомленні", async () => {
    const h = harness({ fileBytes: fakeJpeg(800, 600, 300 * KB) });
    const first = await h.press("emoji:cut", photoMsg(h));
    const created = first.find((c) => c.method === "createNewStickerSet").payload;
    assert.equal(created.name, "emoji111_by_test_bot");
    assert.equal(created.sticker_type, "custom_emoji");
    assert.equal(created.title, "Мої емодзі · @test_bot");
    assert.deepEqual(h.images.calls[0].transform,
      { width: 100, height: 100, fit: "pad", background: "rgba(0,0,0,0)", segment: "foreground" });
    const done = first.find((c) => /Готово/.test(c.payload.text ?? ""));
    assert.match(done.payload.text, /<tg-emoji emoji-id="ce1">🙂<\/tg-emoji>/);
    assert.match(done.payload.text, /лише з Telegram Premium/);
    assert.equal(buttons(done)[0].url, "https://t.me/addemoji/emoji111_by_test_bot");

    const second = await h.press("emoji:keep", photoMsg(h));
    assert.ok(second.some((c) => c.method === "addStickerToSet"));
    assert.match(second.find((c) => /Готово/.test(c.payload.text ?? "")).payload.text, /там уже 2 шт/);
  });

  it("якщо власні емодзі в тексті не пройшли — готово все одно, просто без прев'ю", async () => {
    const h = harness();
    h.tg.rejectCustomEmoji = true;
    const calls = await h.press("emoji:keep", photoMsg(h));
    const done = calls.filter((c) => /Готово/.test(c.payload.text ?? "")).at(-1);
    assert.doesNotMatch(done.payload.text, /tg-emoji/);
  });

  it("мозаїка 3×3: квадрат по центру → 9 клітинок по порядку → окремий набір і картинка з емодзі", async () => {
    const h = harness({ fileBytes: fakeJpeg(800, 600, 300 * KB) });
    const calls = await h.press("emoji:3", photoMsg(h));
    const created = calls.find((c) => c.method === "createNewStickerSet").payload;
    assert.match(created.name, /^mosaic111t[0-9a-z]+_by_test_bot$/);
    assert.equal(created.sticker_type, "custom_emoji");
    assert.equal(created.stickers.length, 9);
    assert.equal(h.images.calls.length, 10);
    assert.deepEqual(h.images.calls[0].transform, { width: 300, height: 300, fit: "cover" });
    assert.deepEqual(h.images.calls[6].transform.trim, { top: 100, left: 200, bottom: 100, right: 0 });
    const mosaic = calls.find((c) => c.method === "sendMessage" && /tg-emoji/.test(c.payload.text)).payload.text;
    const rows = mosaic.split("\n").map((row) => [...row.matchAll(/emoji-id="(ce\d+)"/g)].map((m) => m[1]));
    assert.deepEqual(rows, [["ce1", "ce2", "ce3"], ["ce4", "ce5", "ce6"], ["ce7", "ce8", "ce9"]]);
    assert.match(h.texts(calls), /Мозаїка 3×3 готова/);
  });

  it("мозаїка 5×5 — 25 емодзі за 26 обробок", async () => {
    const h = harness();
    const calls = await h.press("emoji:5", photoMsg(h));
    assert.equal(calls.find((c) => c.method === "createNewStickerSet").payload.stickers.length, 25);
    assert.equal(h.images.calls.length, 26);
  });
});

describe("скан документа", () => {
  it("фото → чорно-білий PDF", async () => {
    const h = harness({ fileBytes: fakeJpeg(800, 600, 300 * KB) });
    const calls = await h.press("scan", photoMsg(h));
    const doc = calls.find((c) => c.method === "sendDocument").payload;
    assert.equal(doc.document.filename, "scan.pdf");
    assert.match(doc.caption, /Скан · 1 сторінка/);
    assert.equal(h.images.calls[0].transform.saturation, 0);
  });

  it("альбом → кнопка скану → усі фото в одному PDF", async () => {
    const h = harness({ fileBytes: fakeJpeg(800, 600, 200 * KB) });
    const photo = (id) => ({ media_group_id: "G1", photo: [{ file_id: id, file_unique_id: id, width: 800, height: 600, file_size: 200 * KB }] });
    const album = [h.newMessage(photo("p1")), h.newMessage(photo("p2")), h.newMessage(photo("p3"))];
    const from = h.tg.calls.length;
    await Promise.all(album.map((message) => h.send({ message })));
    const menu = h.tg.calls.slice(from).find((c) => c.method === "sendMessage");
    assert.deepEqual(buttons(menu).map((b) => b.callback_data), ["album:G1", "scan:G1"]);

    const doc = (await h.press("scan:G1", album[0])).find((c) => c.method === "sendDocument").payload;
    assert.match(doc.caption, /Скан · 3 сторінки/);
    assert.equal(h.images.calls.length, 3);
  });
});

describe("статистика для власника", () => {
  it("рахує людей і дії знеособлено, /stats бачить лише власник", async () => {
    const h = harness({ ownerId: 111, files: { [NBU]: RATES } });
    resetRatesCache();
    await h.text("/start");
    await h.text("50 євро");
    await h.text("100 usd");
    const [report] = await h.post(command("/stats"));
    assert.match(report.payload.text, /Люди:<\/b> сьогодні 1/);
    assert.match(report.payload.text, /Валюти — <b>2<\/b>/);
    assert.match(report.payload.text, /Привітання — <b>1<\/b>/);
    assert.ok(![...h.stats.seen.keys()].some((k) => k.includes("111")), "без id користувача");

    const stranger = harness({ ownerId: 999 });
    const [answer] = await stranger.post(command("/stats"));
    assert.doesNotMatch(answer.payload.text, /Статистика/);
  });

  it("унікальні люди — за хешем, дії — за функціями", async () => {
    const stats = memoryStats();
    await stats.track(1, "qr");
    await stats.track(1, "qr");
    await stats.track(2, "tiktok");
    const { users, uses } = await stats.report();
    assert.deepEqual(users, { today: 2, week: 2, month: 2 });
    assert.deepEqual(uses.month, { qr: 2, tiktok: 1 });
  });
});
