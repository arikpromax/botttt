// Виплати Ara Farm у TON: монети → TON за курсом, який задає власник. Автоматично гроші не надсилаються:
// гравець подає заявку (монети списуються), власник отримує її в боті, платить зі свого гаманця сам
// і натискає «Виплачено» (або «Відхилити» — монети повертаються). Ключів від гаманця на сервері немає.

const NANO = 1_000_000_000n;
const DAY = 24 * 3600_000;

// Налаштування за замовчуванням; власник міняє їх командами бота (/payouts, /rate, /minton, /budget).
export const PAYOUT_DEFAULTS = { enabled: false, rate: 1_000_000, minTon: 0.5, budgetTon: 5 };
// Захист від ферм ботів: виводити можна, лише якщо гравець у грі давно й справді грає.
export const PAYOUT_RULES = { minDays: 7, minTaps: 3000, cooldownHours: 24 };

// ---- TON-адреси ----
// Дружня адреса: 36 байт = прапорці, воркчейн, 32 байти хешу, CRC16 (XMODEM). Сира: «0:» + 64 hex.
function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
const fromBase64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");

// → адреса для виплат (дружня, non-bounceable «UQ…», щоб гроші дійшли й на ще не активований гаманець) або null.
export function normalizeAddress(input) {
  const s = String(input ?? "").trim();
  let workchain, hash;
  const raw = /^(-1|0):([0-9a-fA-F]{64})$/.exec(s);
  if (raw) {
    workchain = Number(raw[1]);
    hash = Uint8Array.from(raw[2].match(/../g), (h) => parseInt(h, 16));
  } else {
    if (!/^[A-Za-z0-9+/_-]{48}$/.test(s)) return null;
    let bytes;
    try {
      bytes = fromBase64(s);
    } catch {
      return null;
    }
    if (bytes.length !== 36 || crc16(bytes.subarray(0, 34)) !== ((bytes[34] << 8) | bytes[35])) return null;
    if (bytes[0] & 0x80) return null; // адреса тестової мережі
    if (![0x11, 0x51].includes(bytes[0])) return null;
    workchain = bytes[1] === 0xff ? -1 : bytes[1];
    hash = bytes.subarray(2, 34);
  }
  if (workchain !== 0) return null; // гаманці людей — у базовому воркчейні
  const out = new Uint8Array(36);
  out[0] = 0x51; // non-bounceable
  out[1] = 0;
  out.set(hash, 2);
  const crc = crc16(out.subarray(0, 34));
  out[34] = crc >> 8;
  out[35] = crc & 0xff;
  return toBase64Url(out);
}

// ---- Суми ----
// nano-TON за монети (цілі числа, без похибок округлення).
export const coinsToNano = (coins, rate) => (BigInt(Math.floor(coins)) * NANO) / BigInt(Math.max(1, Math.floor(rate)));
export const tonToNano = (ton) => BigInt(Math.round(Number(ton) * 1e9));
export const formatTon = (nano) => {
  const n = Number(nano) / 1e9;
  return n.toLocaleString("uk-UA", { maximumFractionDigits: n < 1 ? 4 : 2 });
};

// Чи можна подати заявку. → { nano } або { error }:
// disabled | wallet | young | inactive | not_member | pending | cooldown | amount | coins | min | budget.
export function checkWithdrawal(p, { settings, coins, member, now, last, todayNano }) {
  if (!settings.enabled) return { error: "disabled" };
  if (!p.wallet) return { error: "wallet" };
  if (now - p.created_at < PAYOUT_RULES.minDays * DAY) return { error: "young" };
  if (p.total_taps < PAYOUT_RULES.minTaps) return { error: "inactive" };
  if (!member) return { error: "not_member" };
  if (last?.status === "pending") return { error: "pending" };
  if (last && now - last.created_at < PAYOUT_RULES.cooldownHours * 3600_000) return { error: "cooldown" };
  if (!Number.isInteger(coins) || coins <= 0) return { error: "amount" };
  if (coins > p.coins) return { error: "coins" };
  const nano = coinsToNano(coins, settings.rate);
  if (nano < tonToNano(settings.minTon)) return { error: "min" };
  if (BigInt(todayNano) + nano > tonToNano(settings.budgetTon)) return { error: "budget" };
  return { nano };
}

// ---- Сховище (D1: settings, withdrawals з migrations/0007_payouts.sql) ----
function parseSettings(rows) {
  const s = { ...PAYOUT_DEFAULTS };
  for (const { key, value } of rows) {
    if (key === "enabled") s.enabled = value === "1";
    else if (key in s) s[key] = Number(value);
  }
  return s;
}

export function d1Payouts(DB) {
  return {
    settings: async () => parseSettings((await DB.prepare(`SELECT key, value FROM settings`).all()).results),
    set: (key, value) => DB.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, String(value)).run(),
    async create(w) {
      const res = await DB.prepare(`INSERT INTO withdrawals (user_id, name, address, coins, nano, status, day, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)`)
        .bind(w.user_id, w.name, w.address, w.coins, String(w.nano), w.day, w.created_at).run();
      return res.meta.last_row_id;
    },
    last: (userId) => DB.prepare(`SELECT * FROM withdrawals WHERE user_id = ?1 ORDER BY id DESC LIMIT 1`).bind(userId).first(),
    history: async (userId) => (await DB.prepare(
      `SELECT id, coins, nano, status, address, created_at FROM withdrawals WHERE user_id = ?1 ORDER BY id DESC LIMIT 10`,
    ).bind(userId).all()).results,
    dayTotal: async (day) => BigInt((await DB.prepare(
      `SELECT COALESCE(SUM(CAST(nano AS INTEGER)), 0) AS n FROM withdrawals WHERE day = ?1 AND status != 'rejected'`,
    ).bind(day).first()).n),
    pending: async () => (await DB.prepare(`SELECT id, nano FROM withdrawals WHERE status = 'pending'`).all()).results,
    // Рішення власника — лише для заявки, що ще чекає. → заявка або null.
    async decide(id, status, now) {
      const res = await DB.prepare(`UPDATE withdrawals SET status = ?2, decided_at = ?3 WHERE id = ?1 AND status = 'pending'`)
        .bind(id, status, now).run();
      return res.meta.changes ? DB.prepare(`SELECT * FROM withdrawals WHERE id = ?1`).bind(id).first() : null;
    },
  };
}

// У пам'яті — для тестів.
export function memoryPayouts(initial = {}) {
  const settings = { ...PAYOUT_DEFAULTS, ...initial };
  const rows = [];
  return {
    rows,
    settings: async () => ({ ...settings }),
    set: async (key, value) => (settings[key] = key === "enabled" ? value === "1" || value === true : Number(value)),
    async create(w) {
      rows.push({ ...w, id: rows.length + 1, status: "pending", nano: String(w.nano) });
      return rows.length;
    },
    last: async (userId) => [...rows].reverse().find((r) => r.user_id === userId) ?? null,
    history: async (userId) => [...rows].reverse().filter((r) => r.user_id === userId),
    dayTotal: async (day) => rows.filter((r) => r.day === day && r.status !== "rejected").reduce((n, r) => n + BigInt(r.nano), 0n),
    pending: async () => rows.filter((r) => r.status === "pending"),
    async decide(id, status, now) {
      const r = rows.find((x) => x.id === id && x.status === "pending");
      if (!r) return null;
      Object.assign(r, { status, decided_at: now });
      return { ...r };
    },
  };
}
