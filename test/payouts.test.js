// Виплати TON у грі: адреси, умови заявки, API, керування власником у боті.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signInitData } from "../src/game/auth.js";
import { gameApi } from "../src/game/api.js";
import { memoryPlayers } from "../src/game/store.js";
import { checkWithdrawal, coinsToNano, memoryPayouts, normalizeAddress, PAYOUT_DEFAULTS } from "../src/game/payouts.js";
import { newPlayer } from "../src/game/rules.js";
import { harness, USER } from "./harness.js";

const TOKEN = "123:TEST";
const T0 = Date.UTC(2026, 9, 23, 10, 0, 0);
const DAY = 86_400_000;
const EQ = "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2";
const UQ = "UQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p9dz";
const ON = { enabled: true, rate: 1_000_000, minTon: 0.5, budgetTon: 5 };

describe("виплати: адреси й умови", () => {
  it("адреса TON: дружня й сира → «UQ…»; тестова мережа, зіпсована й чужа — ні", () => {
    assert.equal(normalizeAddress(EQ), UQ);
    assert.equal(normalizeAddress(UQ), UQ);
    assert.equal(normalizeAddress("0:ed1691307050047117b998b561d8de82d31fbf84910ced6eb5fc92e7485ef8a7"), UQ);
    assert.equal(normalizeAddress(`k${EQ.slice(1)}`), null, "тестова мережа");
    assert.equal(normalizeAddress(`${EQ.slice(0, -1)}3`), null, "контрольна сума");
    assert.equal(normalizeAddress("hello"), null);
  });

  it("заявка: вимкнено, гаманець, новачок, мало тапів, підписка, мінімум, бюджет, баланс", () => {
    const p = { ...newPlayer({ id: 1, first_name: "А" }, T0), wallet: UQ, total_taps: 5000, coins: 3_000_000 };
    const now = T0 + 8 * DAY;
    const base = { settings: ON, coins: 1_000_000, member: true, now, last: null, todayNano: 0n };
    assert.equal(checkWithdrawal(p, { ...base, settings: PAYOUT_DEFAULTS }).error, "disabled", "за замовчуванням вимкнено");
    assert.equal(checkWithdrawal({ ...p, wallet: null }, base).error, "wallet");
    assert.equal(checkWithdrawal(p, { ...base, now: T0 + 3 * DAY }).error, "young");
    assert.equal(checkWithdrawal({ ...p, total_taps: 100 }, base).error, "inactive");
    assert.equal(checkWithdrawal(p, { ...base, member: false }).error, "not_member");
    assert.equal(checkWithdrawal(p, { ...base, last: { status: "pending", created_at: now - 1000 } }).error, "pending");
    assert.equal(checkWithdrawal(p, { ...base, last: { status: "paid", created_at: now - 3600_000 } }).error, "cooldown");
    assert.equal(checkWithdrawal(p, { ...base, coins: 100_000 }).error, "min");
    assert.equal(checkWithdrawal(p, { ...base, coins: 5_000_000 }).error, "coins");
    assert.equal(checkWithdrawal(p, { ...base, todayNano: 4_800_000_000n }).error, "budget");
    assert.equal(checkWithdrawal(p, base).nano, 1_000_000_000n);
    assert.equal(coinsToNano(1_234_567, 1_000_000), 1_234_567_000n, "без похибок округлення");
  });
});

describe("виплати: API", () => {
  async function setup({ settings = ON, member = true } = {}) {
    let now = T0;
    const store = memoryPlayers();
    const payouts = memoryPayouts(settings);
    const notified = [];
    const handle = gameApi({
      store, payouts, token: TOKEN, botUsername: "b", secret: "s", checkMember: async () => member,
      notifyOwner: async (w, p) => notified.push([w, p.id]), clock: () => now,
    });
    const call = async (path, body = {}) => {
      const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify(USER) };
      fields.hash = await signInitData(fields, TOKEN);
      const res = await handle(new Request(`https://x/api/${path}`, {
        method: "POST", body: JSON.stringify({ auth: new URLSearchParams(fields).toString(), ...body }),
      }));
      return { status: res.status, ...(await res.json()) };
    };
    await call("me");
    now += 8 * DAY;
    Object.assign(store.rows.get(USER.id), { total_taps: 5000, coins: 2_000_000 });
    return { call, store, payouts, notified };
  }

  it("гаманець → заявка: монети списуються, власник отримує заявку, друга — лише після рішення", async () => {
    const { call, store, payouts, notified } = await setup();
    assert.equal((await call("withdraw", { coins: 1_000_000 })).error, "wallet");
    assert.equal((await call("wallet", { address: "не адреса" })).status, 400);
    assert.equal((await call("wallet", { address: EQ })).wallet, UQ);
    assert.equal((await call("withdraw", { coins: 100_000 })).error, "min");
    const ok = await call("withdraw", { coins: 1_000_000 });
    assert.equal(ok.status, 200);
    assert.equal(ok.withdrawal.ton, "1");
    assert.equal(ok.state.coins, 1_000_000);
    assert.equal(notified.length, 1);
    assert.equal(notified[0][0].address, UQ);
    assert.equal((await call("withdraw", { coins: 500_000 })).error, "pending");
    const info = await call("payouts");
    assert.equal(info.history[0].status, "pending");
    assert.equal(info.settings.enabled, true);
    assert.equal(payouts.rows.length, 1);
    assert.equal(store.rows.get(USER.id).coins, 1_000_000);
  });

  it("вимкнено або без підписки — заявки немає, монети на місці", async () => {
    const off = await setup({ settings: {} });
    await off.call("wallet", { address: UQ });
    assert.equal((await off.call("withdraw", { coins: 1_000_000 })).error, "disabled");
    const notMember = await setup({ member: false });
    await notMember.call("wallet", { address: UQ });
    assert.equal((await notMember.call("withdraw", { coins: 1_000_000 })).error, "not_member");
    assert.equal(notMember.store.rows.get(USER.id).coins, 2_000_000);
  });
});

describe("виплати: власник у боті", () => {
  it("команди лише власнику: увімкнути, курс; «Відхилити» повертає монети й пише гравцю", async () => {
    const payouts = memoryPayouts();
    const players = memoryPlayers();
    await players.insert({ ...newPlayer({ id: 555, first_name: "Гравець" }, T0), coins: 0 });
    const h = harness({ ownerId: USER.id, payouts, players });
    const cmd = (text) => h.post({ text, entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] });

    const [status] = await cmd("/payouts on");
    assert.match(status.payload.text, /увімкнено/);
    assert.equal((await payouts.settings()).enabled, true);
    await cmd("/rate 2000000");
    assert.equal((await payouts.settings()).rate, 2_000_000);
    assert.match(h.texts(await cmd("/rate 5")), /не менше 1000/);

    const id = await payouts.create({ user_id: 555, name: "Гравець", address: UQ, coins: 700_000, nano: 350_000_000n, day: "2026-10-23", created_at: T0 });
    const calls = await h.press(`wd:reject:${id}`, h.newMessage({ text: "заявка" }));
    assert.equal(players.rows.get(555).coins, 700_000, "монети повернуто");
    const toPlayer = calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === 555);
    assert.match(toPlayer.payload.text, /відхилено/);
    const again = await h.press(`wd:paid:${id}`, h.newMessage({ text: "заявка" }));
    assert.match(again.find((c) => c.method === "answerCallbackQuery").payload.text, /вже вирішено/);

    const stranger = harness({ ownerId: 999, payouts, players });
    await stranger.post({ text: "/payouts off", entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    assert.equal((await payouts.settings()).enabled, true, "чужий не вимкне");
  });
});

describe("виплати: фонд для власника", () => {
  it("рахує, скільки Stars можна вивести, у TON і скільки треба на монети гравців", async () => {
    const { fundReport } = await import("../src/game/fund.js");
    const f = fundReport({ balance: 1000, recentStars: 300, earnedStars: 1200, playerCoins: 5_000_000, rate: 1_000_000, tonUsd: 5 });
    assert.equal(f.withdrawable, 700, "останні 21 день ще не виводяться");
    assert.equal(f.fromTelegram, true);
    assert.ok(Math.abs(f.fundTon - (700 * 0.013) / 5) < 1e-9);
    assert.equal(f.coinsTon, 5);
    assert.ok(Math.abs(f.suggestedBudget - f.fundTon / 30) < 1e-9);
    const noPrice = fundReport({ balance: null, recentStars: 0, earnedStars: 200, playerCoins: 0, rate: 1_000_000, tonUsd: null });
    assert.equal(noPrice.stars, 200, "без даних Telegram — за нашим обліком");
    assert.equal(noPrice.fundTon, null);
  });

  it("курс TON: якщо CoinGecko не відповів — бере з Binance, і кешує", async () => {
    const { resetPriceCache, tonUsd } = await import("../src/game/fund.js");
    resetPriceCache();
    const asked = [];
    const fakeFetch = async (url) => {
      asked.push(url);
      return url.includes("coingecko") ? new Response("blocked", { status: 403 }) : Response.json({ symbol: "TONUSDT", price: "5.20" });
    };
    assert.equal(await tonUsd(fakeFetch, T0), 5.2);
    assert.equal(await tonUsd(fakeFetch, T0 + 60_000), 5.2);
    assert.equal(asked.length, 2, "вдруге — з кешу");
    resetPriceCache();
  });

  it("/payouts власнику показує фонд", async () => {
    const { memoryPurchases } = await import("../src/game/shop.js");
    const purchases = memoryPurchases();
    await purchases.add({ charge_id: "a", user_id: 1, product: "turbo10", stars: 25, created_at: Date.now() - 30 * DAY });
    await purchases.add({ charge_id: "b", user_id: 1, product: "freeze", stars: 20, created_at: Date.now() });
    const players = memoryPlayers();
    await players.insert({ ...newPlayer({ id: 5, first_name: "Г" }, T0), coins: 2_000_000 });
    const h = harness({ ownerId: USER.id, payouts: memoryPayouts(), players, shop: { store: players, purchases } });
    const calls = await h.post({ text: "/payouts", entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    assert.ok(calls.some((c) => c.method === "getMyStarBalance"), "баланс питаємо в Telegram");
    const msg = calls.find((c) => c.method === "sendMessage");
    assert.match(msg.payload.text, /<b>Фонд<\/b>/);
    assert.match(msg.payload.text, /Можна вивести вже зараз: ~25 Stars/);
    assert.match(msg.payload.text, /Монети гравців: 2\s000\s000 ≈ <b>2 TON<\/b>/);
  });
});

describe("виплати: увімкнення кнопкою", () => {
  it("під статусом — кнопка «Увімкнути виплати»; натиснув — увімкнено, кнопка стала «Вимкнути»", async () => {
    const payouts = memoryPayouts();
    const h = harness({ ownerId: USER.id, payouts, players: memoryPlayers() });
    const [status] = await h.post({ text: "/payouts", entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    assert.deepEqual(status.payload.reply_markup.inline_keyboard[0][0], { text: "Увімкнути виплати", callback_data: "payouts:on" });
    const calls = await h.press("payouts:on", h.newMessage({ text: "стан" }));
    assert.equal((await payouts.settings()).enabled, true);
    const edited = calls.find((c) => c.method === "editMessageText");
    assert.match(edited.payload.text, /увімкнено/);
    assert.equal(edited.payload.reply_markup.inline_keyboard[0][0].callback_data, "payouts:off");
    await h.post({ text: "/payouts викл", entities: [{ type: "bot_command", offset: 0, length: 8 }] });
    assert.equal((await payouts.settings()).enabled, false, "українською теж розуміє");
    const stranger = harness({ ownerId: 999, payouts, players: memoryPlayers() });
    await stranger.press("payouts:on", stranger.newMessage({ text: "стан" }));
    assert.equal((await payouts.settings()).enabled, false, "чужий не ввімкне");
  });
});
