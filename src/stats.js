// Знеособлена статистика для власника бота (/stats): скільки людей і чим користуються.
// Замість ідентифікатора Telegram зберігаємо короткий хеш (з секретною «сіллю»), лише щоб рахувати унікальних;
// записи старші за 90 днів видаляються.

const KEEP_DAYS = 90;
export const FEATURES = {
  start: "Привітання", tiktok: "TikTok", compress: "Стиснення фото", pdf: "Фото → PDF", album: "Альбом → PDF",
  scan: "Скан документа", jpg: "Фото → JPG", sticker: "Стікер", emoji: "Емодзі", mosaic: "Мозаїка з емодзі", sound: "Звук із відео", qr: "QR-код",
  currency: "Валюти", purchase: "Покупка за Stars", translit: "Транслітерація",
};

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const daysAgo = (n) => day(new Date(Date.now() - n * 86400_000));

async function hash(salt, userId) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${userId}`));
  return [...new Uint8Array(digest).slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Звіт з рядків usage [{ day, feature, count }] і seen [{ day, user_hash }].
function report(usage, seen) {
  const users = (from) => new Set(seen.filter((s) => s.day >= from).map((s) => s.user_hash)).size;
  const uses = (from) => {
    const by = {};
    for (const u of usage) if (u.day >= from) by[u.feature] = (by[u.feature] ?? 0) + u.count;
    return by;
  };
  return {
    users: { today: users(day()), week: users(daysAgo(6)), month: users(daysAgo(29)) },
    uses: { today: uses(day()), week: uses(daysAgo(6)), month: uses(daysAgo(29)) },
  };
}

// D1 (таблиці з migrations/0002_stats.sql). Один запит на дію — пакетом.
export function d1Stats(DB, salt) {
  return {
    async track(userId, feature) {
      const h = await hash(salt, userId);
      await DB.batch([
        DB.prepare(`INSERT OR IGNORE INTO stats_seen (day, user_hash) VALUES (?1, ?2)`).bind(day(), h),
        DB.prepare(`INSERT INTO stats_usage (day, feature, count) VALUES (?1, ?2, 1)
                    ON CONFLICT(day, feature) DO UPDATE SET count = count + 1`).bind(day(), feature),
      ]);
    },
    async report() {
      const from = daysAgo(29);
      await DB.batch([
        DB.prepare(`DELETE FROM stats_seen WHERE day < ?1`).bind(daysAgo(KEEP_DAYS)),
        DB.prepare(`DELETE FROM stats_usage WHERE day < ?1`).bind(daysAgo(KEEP_DAYS)),
      ]);
      const [usage, seen] = await DB.batch([
        DB.prepare(`SELECT day, feature, count FROM stats_usage WHERE day >= ?1`).bind(from),
        DB.prepare(`SELECT day, user_hash FROM stats_seen WHERE day >= ?1`).bind(from),
      ]);
      return report(usage.results, seen.results);
    },
  };
}

// У пам'яті — для тестів.
export function memoryStats(salt = "test") {
  const usage = new Map();
  const seen = new Map();
  return {
    seen,
    async track(userId, feature) {
      seen.set(`${day()}|${await hash(salt, userId)}`, true);
      const key = `${day()}|${feature}`;
      usage.set(key, (usage.get(key) ?? 0) + 1);
    },
    async report() {
      return report(
        [...usage].map(([k, count]) => ({ day: k.split("|")[0], feature: k.split("|")[1], count })),
        [...seen.keys()].map((k) => ({ day: k.split("|")[0], user_hash: k.split("|")[1] })),
      );
    },
  };
}
