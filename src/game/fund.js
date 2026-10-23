// «Фонд» для власника (/payouts): скільки Stars заробила гра, скільки можна вивести, приблизно в TON
// і скільки TON знадобилося б, якби всі гравці вивели свої монети за поточним курсом.

export const HOLD_DAYS = 21; // Telegram тримає зароблені Stars ~21 день, перш ніж їх можна вивести
export const STAR_USD = 0.013; // приблизно стільки отримує розробник за 1 Star при виводі через Fragment
const BUDGET_DAYS = 30; // радимо розтягнути фонд щонайменше на місяць

// Курс TON у доларах: спершу CoinGecko, якщо не відповів — Binance. Кеш на 10 хв. → число або null.
let priceCache = null;
export async function tonUsd(fetch = globalThis.fetch, now = Date.now()) {
  if (priceCache && now - priceCache.at < 600_000) return priceCache.value;
  const sources = [
    ["https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd", (j) => j?.["the-open-network"]?.usd],
    ["https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT", (j) => Number(j?.price)],
  ];
  for (const [url, pick] of sources) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      const value = res.ok ? pick(await res.json()) : null;
      if (value > 0) {
        priceCache = { at: now, value };
        return value;
      }
    } catch {
      // наступне джерело
    }
  }
  return null;
}
export const resetPriceCache = () => (priceCache = null);

// balance — баланс Stars бота з Telegram (або null), recentStars — Stars за останні 21 день,
// earnedStars — усього зароблено (без повернених), playerCoins — монети всіх гравців, rate — монет за 1 TON.
export function fundReport({ balance, recentStars, earnedStars, playerCoins, rate, tonUsd: price }) {
  const stars = balance ?? earnedStars;
  const withdrawable = Math.max(0, stars - recentStars);
  const toTon = (s) => (price ? (s * STAR_USD) / price : null);
  const fundTon = toTon(withdrawable);
  return {
    stars, fromTelegram: balance != null, earnedStars, withdrawable,
    usd: withdrawable * STAR_USD, fundTon, starsTon: toTon(stars), price,
    coinsTon: playerCoins / rate, playerCoins,
    suggestedBudget: fundTon != null ? fundTon / BUDGET_DAYS : null,
  };
}
