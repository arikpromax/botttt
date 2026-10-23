// Магазин Ara Farm за Telegram Stars: рахунок (createInvoiceLink, валюта XTR), видача товару після оплати
// (рівно один раз на платіж — за telegram_payment_charge_id) і облік покупок для власника (/stars, /refund).
import { SHOP, applyPurchase } from "./rules.js";

export const invoicePayload = (userId, product) => JSON.stringify({ u: userId, p: product });

// → { userId, product } або null, якщо рахунок не наш.
export function parsePayload(payload) {
  try {
    const { u, p } = JSON.parse(payload);
    return Number.isInteger(u) && Object.hasOwn(SHOP, p) ? { userId: u, product: p } : null;
  } catch {
    return null;
  }
}

// Параметри рахунку для Bot API createInvoiceLink (Stars — без платіжного провайдера).
export function invoiceParams(userId, product, photoUrl) {
  const item = SHOP[product];
  return {
    title: item.title, description: item.about, payload: invoicePayload(userId, product), currency: "XTR",
    prices: [{ label: item.title, amount: item.stars }],
    ...(photoUrl ? { photo_url: photoUrl, photo_width: 180, photo_height: 180 } : {}),
  };
}

// Оплачено: записуємо платіж і даємо товар. Повторне повідомлення про той самий платіж нічого не дає.
// → "granted" | "duplicate" | "no_player"
export async function grantPurchase({ store, purchases }, { userId, product, chargeId, stars, now }) {
  if (!(await purchases.add({ charge_id: chargeId, user_id: userId, product, stars, created_at: now }))) return "duplicate";
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await store.get(userId);
    if (!p) return "no_player";
    applyPurchase(p, product, now);
    if (await store.save(p)) return "granted";
  }
  throw new Error("гравця змінюють занадто часто");
}

// Звіт для власника: Stars за сьогодні / 7 днів / увесь час і за товарами (без повернених).
function report(rows, now) {
  const since = (ms) => rows.filter((r) => !r.refunded && r.created_at >= now - ms);
  const sum = (list) => list.reduce((n, r) => n + r.stars, 0);
  const all = rows.filter((r) => !r.refunded);
  const byProduct = {};
  for (const r of all) byProduct[r.product] = (byProduct[r.product] ?? 0) + r.stars;
  return {
    today: sum(since(86_400_000)), week: sum(since(7 * 86_400_000)), total: sum(all), count: all.length,
    refunded: rows.filter((r) => r.refunded).length, byProduct,
    // Останні платежі — щоб власник міг скопіювати id для /refund.
    recent: [...rows].sort((a, b) => b.created_at - a.created_at).slice(0, 5),
  };
}

// D1 (таблиця purchases з migrations/0009_shop.sql).
export function d1Purchases(DB) {
  return {
    async add(r) {
      const res = await DB.prepare(`INSERT OR IGNORE INTO purchases (charge_id, user_id, product, stars, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)`).bind(r.charge_id, r.user_id, r.product, r.stars, r.created_at).run();
      return res.meta.changes > 0;
    },
    get: (chargeId) => DB.prepare(`SELECT * FROM purchases WHERE charge_id = ?1`).bind(chargeId).first(),
    markRefunded: (chargeId) => DB.prepare(`UPDATE purchases SET refunded = 1 WHERE charge_id = ?1`).bind(chargeId).run(),
    // Stars, отримані після моменту since (без повернених) — для «Фонду».
    starsSince: async (since) => (await DB.prepare(
      `SELECT COALESCE(SUM(stars), 0) AS n FROM purchases WHERE refunded = 0 AND created_at >= ?1`,
    ).bind(since).first()).n,
    async report(now) {
      return report((await DB.prepare(`SELECT charge_id, user_id, product, stars, created_at, refunded FROM purchases`).all()).results, now);
    },
  };
}

export function memoryPurchases() {
  const rows = new Map();
  return {
    rows,
    async add(r) {
      if (rows.has(r.charge_id)) return false;
      rows.set(r.charge_id, { ...r, refunded: 0 });
      return true;
    },
    get: async (chargeId) => rows.get(chargeId) ?? null,
    markRefunded: async (chargeId) => rows.has(chargeId) && (rows.get(chargeId).refunded = 1),
    starsSince: async (since) => [...rows.values()].filter((r) => !r.refunded && r.created_at >= since).reduce((n, r) => n + r.stars, 0),
    report: async (now) => report([...rows.values()], now),
  };
}
