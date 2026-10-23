// Магазин гри за Telegram Stars: товари, рахунок, підтвердження оплати, видача (рівно раз), команди.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signInitData } from "../src/game/auth.js";
import { gameApi } from "../src/game/api.js";
import { memoryPlayers } from "../src/game/store.js";
import { applyPurchase, applyTaps, cantBuy, newPlayer, settle, SHOP, touchStreak } from "../src/game/rules.js";
import { grantPurchase, invoicePayload, memoryPurchases, parsePayload } from "../src/game/shop.js";
import { harness, USER } from "./harness.js";

const T0 = Date.UTC(2026, 9, 23, 10, 0, 0);
const DAY = 86_400_000;

describe("магазин: товари", () => {
  it("турбо ×10: 30 с кожен тап ×10 без енергії", () => {
    const p = newPlayer(USER, T0);
    applyPurchase(p, "turbo10", T0);
    assert.equal(applyTaps(p, 0, T0 + 5000, 60), 60);
    assert.equal(p.coins, 600);
    assert.equal(p.energy, 500);
    assert.equal(applyTaps(p, 0, T0 + 40_000, 60), 0, "через 30 с (+2 с запасу) — усе");
  });

  it("відновлення ×2 на добу: енергія вдвічі швидше, потім як було", () => {
    const p = newPlayer(USER, T0);
    p.energy = 0;
    applyPurchase(p, "regen2", T0);
    settle(p, T0 + 100_000);
    assert.equal(Math.floor(p.energy), 200);
    p.energy = 0;
    p.energy_at = T0 + DAY + 1000;
    settle(p, T0 + DAY + 101_000);
    assert.equal(Math.floor(p.energy), 100, "добу по тому — звичайне відновлення");
  });

  it("захист вогника: пропущений день не спалює серію; без захисту — згорає; більше 3 — не можна", () => {
    const p = newPlayer(USER, T0);
    touchStreak(p, T0);
    touchStreak(p, T0 + DAY);
    applyPurchase(p, "freeze", T0 + DAY);
    assert.deepEqual(touchStreak(p, T0 + 3 * DAY), { lost: 0, frozen: 1 }, "пропустив 1 день — захист спрацював");
    assert.equal(p.streak, 3);
    assert.equal(p.streak_freezes, 0);
    assert.deepEqual(touchStreak(p, T0 + 5 * DAY), { lost: 3, frozen: 0 });
    for (let i = 0; i < 3; i++) applyPurchase(p, "freeze", T0 + 5 * DAY);
    assert.equal(cantBuy(p, "freeze", T0 + 5 * DAY), "freeze_max");
    assert.equal(cantBuy(p, "energy", T0 + 5 * DAY), "full", "повна енергія — не продаємо");
    assert.equal(cantBuy(p, "coins", T0), "unknown", "монет за Stars не продаємо");
  });
});

describe("магазин: оплата", () => {
  it("рахунок у Stars: валюта XTR, ціна з магазину, наш payload", async () => {
    let now = T0;
    const store = memoryPlayers();
    const params = [];
    const handle = gameApi({
      store, token: "123:T", botUsername: "b", secret: "s", checkMember: async () => true, appUrl: "https://app.test/",
      createInvoiceLink: async (p) => (params.push(p), "https://t.me/$abc"), clock: () => now,
    });
    const call = async (path, body = {}) => {
      const f = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify(USER) };
      f.hash = await signInitData(f, "123:T");
      const res = await handle(new Request(`https://x/api/${path}`, { method: "POST", body: JSON.stringify({ auth: new URLSearchParams(f).toString(), ...body }) }));
      return { status: res.status, ...(await res.json()) };
    };
    await call("me");
    const r = await call("invoice", { product: "turbo10" });
    assert.equal(r.link, "https://t.me/$abc");
    assert.equal(params[0].currency, "XTR");
    assert.deepEqual(params[0].prices, [{ label: "Турбо ×10", amount: SHOP.turbo10.stars }]);
    assert.deepEqual(parsePayload(params[0].payload), { userId: USER.id, product: "turbo10" });
    assert.equal(params[0].photo_url, "https://app.test/icon-180.png");
    assert.equal((await call("invoice", { product: "energy" })).error, "full");
  });

  it("видача: рівно один раз на платіж", async () => {
    const store = memoryPlayers();
    const purchases = memoryPurchases();
    await store.insert(newPlayer(USER, T0));
    const pay = { userId: USER.id, product: "freeze", chargeId: "ch1", stars: 20, now: T0 };
    assert.equal(await grantPurchase({ store, purchases }, pay), "granted");
    assert.equal(await grantPurchase({ store, purchases }, pay), "duplicate");
    assert.equal(store.rows.get(USER.id).streak_freezes, 1);
    assert.equal((await purchases.report(T0)).total, 20);
  });

  it("бот: підтверджує оплату, видає товар, дякує; чужий чи застарілий рахунок — відмова", async () => {
    const store = memoryPlayers();
    const purchases = memoryPurchases();
    await store.insert(newPlayer(USER, T0));
    const h = harness({ shop: { store, purchases }, appUrl: "https://app.test/", ownerId: USER.id });
    const checkout = (payload, amount = SHOP.turbo10.stars) => h.send({ pre_checkout_query: {
      id: "pq", from: USER, currency: "XTR", total_amount: amount, invoice_payload: payload,
    } });
    const ok = (await checkout(invoicePayload(USER.id, "turbo10"))).find((c) => c.method === "answerPreCheckoutQuery");
    assert.equal(ok.payload.ok, true);
    const cheat = (await checkout(invoicePayload(USER.id, "turbo10"), 1)).find((c) => c.method === "answerPreCheckoutQuery");
    assert.equal(cheat.payload.ok, false, "інша сума");
    const foreign = (await checkout(invoicePayload(999, "turbo10"))).find((c) => c.method === "answerPreCheckoutQuery");
    assert.equal(foreign.payload.ok, false, "чужий рахунок");

    const paid = { successful_payment: {
      currency: "XTR", total_amount: SHOP.turbo10.stars, invoice_payload: invoicePayload(USER.id, "turbo10"),
      telegram_payment_charge_id: "tg-1", provider_payment_charge_id: "",
    } };
    const thanks = await h.post(paid);
    assert.match(h.texts(thanks), /Оплату отримано/);
    assert.equal(store.rows.get(USER.id).turbo_mult, 10);
    assert.equal((await h.post(paid)).length, 0, "той самий платіж удруге — нічого");

    assert.match(h.texts(await h.post({ text: "/paysupport", entities: [{ type: "bot_command", offset: 0, length: 11 }] })), /Допомога з оплатою/);
    assert.match(h.texts(await h.post({ text: "/stars", entities: [{ type: "bot_command", offset: 0, length: 6 }] })), /усього: 25/);
    const refund = await h.post({ text: "/refund tg-1", entities: [{ type: "bot_command", offset: 0, length: 7 }] });
    assert.deepEqual(refund.find((c) => c.method === "refundStarPayment").payload, { user_id: USER.id, telegram_payment_charge_id: "tg-1" });
    assert.equal((await purchases.get("tg-1")).refunded, 1);
  });
});
