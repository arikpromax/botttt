// Конвертер валют за офіційним курсом НБУ: «100 usd», «50 євро», «$20», «1000 грн в злоті», «курс».

const NBU = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";
const CACHE_MS = 60 * 60 * 1000; // курс НБУ змінюється раз на день — годину тримаємо в пам'яті

// Як люди пишуть валюти. Слова — за основою (долар, долари, доларів…), символи й коди — точно.
const WORDS = [
  ["USD", ["дол", "бакс", "usd", "dollar"]],
  ["EUR", ["євр", "евр", "eur"]],
  ["PLN", ["злот", "pln", "zł", "zl"]],
  ["GBP", ["фунт", "gbp", "pound"]],
  ["CHF", ["франк", "chf"]],
  ["CZK", ["крон", "czk"]],
  ["CAD", ["cad"]],
  ["TRY", ["лір", "try"]],
  ["HUF", ["форинт", "huf"]],
  ["JPY", ["єн", "jpy"]],
  ["CNY", ["юан", "cny"]],
  ["UAH", ["грн", "грив", "uah"]],
];
const SYMBOLS = { "$": "USD", "€": "EUR", "£": "GBP", "₴": "UAH", "¥": "JPY" };
const CODE = /^[a-z]{3}$/;

const DEFAULT_FROM_UAH = ["USD", "EUR", "PLN"];

// Валюта, з якої починається слово (без урахування регістру), або null.
function currencyOf(word) {
  const w = word.toLowerCase();
  for (const [code, stems] of WORDS) {
    if (stems.some((s) => (CODE.test(s) || s.length <= 2 ? w === s : w.startsWith(s)))) return code;
  }
  return null;
}

// → { amount, from, to: [кодів] } | { rates: true } | null, якщо це не запит про валюту.
export function parseConversion(text) {
  const t = (text ?? "").trim();
  if (/^курс(и)?(\s+(валют|нбу))?[.!?]?$/i.test(t)) return { rates: true };
  if (t.length > 80) return null;

  // Слова, числа й символи валют по порядку.
  const tokens = t.match(/\d[\d\s]*(?:[.,]\d+)?|[$€£₴¥]|[\p{L}]+/gu) ?? [];
  let amount = null;
  const currencies = [];
  let targetMark = false;
  let target = null;
  for (const token of tokens) {
    if (/^\d/.test(token)) {
      if (amount === null) amount = Number(token.replace(/\s/g, "").replace(",", "."));
      continue;
    }
    if (/^(в|у|to|in|на)$/i.test(token)) {
      targetMark = currencies.length > 0;
      continue;
    }
    const code = SYMBOLS[token] ?? currencyOf(token);
    if (!code) {
      // Інше слово — це не запит про валюту (крім службових на кшталт «скільки», «це»).
      if (!/^(скільки|це|буде|скiльки|по|курсу|за|курсом|нбу|переведи|конвертуй)$/i.test(token)) return null;
      continue;
    }
    if (targetMark && !target) target = code;
    else currencies.push(code);
  }
  if (amount === null || !Number.isFinite(amount) || amount <= 0 || !currencies.length) return null;
  const from = currencies[0];
  const to = target ? [target] : currencies[1] ? [currencies[1]] : from === "UAH" ? DEFAULT_FROM_UAH : ["UAH"];
  if (to.includes(from)) return null;
  return { amount, from, to };
}

let cache = null;
// → { date: "23.10.2026", rates: Map(код → гривень за 1) }
export async function nbuRates(fetch = globalThis.fetch) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const res = await fetch(NBU);
  if (!res.ok) throw new Error(`НБУ відповів ${res.status}`);
  const list = await res.json();
  const rates = new Map([["UAH", 1]]);
  for (const r of list) rates.set(r.cc, r.rate);
  const data = { date: list[0]?.exchangedate ?? "", rates };
  cache = { at: Date.now(), data };
  return data;
}
export const resetRatesCache = () => (cache = null);

const money = (n) => new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const label = (code) => (code === "UAH" ? "грн" : code);

// Готовий текст відповіді (HTML).
export async function convertText(request, fetch) {
  const { date, rates } = await nbuRates(fetch);
  if (request.rates) {
    const lines = ["USD", "EUR", "PLN", "GBP"].filter((c) => rates.has(c)).map((c) => `1 ${c} = <b>${money(rates.get(c))}</b> грн`);
    return `<b>Курс НБУ на ${date}</b>\n${lines.join("\n")}`;
  }
  const { amount, from, to } = request;
  const missing = [from, ...to].find((c) => !rates.has(c));
  if (missing) return `НБУ не встановлює курс для ${missing}.`;
  const lines = to.map((c) => `<b>${money(amount)} ${label(from)} = ${money((amount * rates.get(from)) / rates.get(c))} ${label(c)}</b>`);
  const basis = [from, ...to].filter((c) => c !== "UAH").map((c) => `1 ${c} = ${money(rates.get(c))} грн`);
  return `${lines.join("\n")}\n\n<i>Курс НБУ на ${date}: ${basis.join(", ")}</i>`;
}
