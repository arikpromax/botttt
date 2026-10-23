// Збереження гравців: D1 (таблиця players з migrations/0003_game.sql) або пам'ять — для тестів.
// save() пише, лише якщо запис не змінився з моменту читання (version), — так одночасні запити
// не перетирають один одного й не дають купити двічі за ті самі монети.

const MUTABLE = [
  "name", "username", "photo", "premium", "coins", "earned", "tap_lvl", "energy_lvl", "regen_lvl", "passive_lvl",
  "energy", "energy_at", "passive_at", "tap_at", "referrer", "ref_reward", "invited", "ref_bonus",
  "daily_day", "channel_done", "friends3_done",
];
const ALL = ["id", ...MUTABLE, "created_at", "version"];

export function d1Players(DB) {
  const n = MUTABLE.length;
  const update = `UPDATE players SET ${MUTABLE.map((k, i) => `${k} = ?${i + 1}`).join(", ")}, version = version + 1 ` +
    `WHERE id = ?${n + 1} AND version = ?${n + 2}`;
  const insert = `INSERT OR IGNORE INTO players (${ALL.join(", ")}) VALUES (${ALL.map((_, i) => `?${i + 1}`).join(", ")})`;
  return {
    get: (id) => DB.prepare(`SELECT * FROM players WHERE id = ?1`).bind(id).first(),
    // → true, якщо створено (false — гравця вже створив паралельний запит).
    async insert(p) {
      const res = await DB.prepare(insert).bind(...ALL.map((k) => p[k])).run();
      return res.meta.changes > 0;
    },
    async save(p) {
      const res = await DB.prepare(update).bind(...MUTABLE.map((k) => p[k]), p.id, p.version).run();
      return res.meta.changes > 0;
    },
    // Бонус тому, хто запросив, — атомарно, без читання.
    reward: (id, amount) => DB.prepare(
      `UPDATE players SET coins = coins + ?2, earned = earned + ?2, invited = invited + 1, ref_bonus = ref_bonus + ?2,
       version = version + 1 WHERE id = ?1`,
    ).bind(id, amount).run(),
    friends: async (id) => (await DB.prepare(
      `SELECT name, photo, premium, ref_reward, created_at FROM players WHERE referrer = ?1 ORDER BY created_at DESC LIMIT 50`,
    ).bind(id).all()).results,
    remove: (id) => DB.batch([
      DB.prepare(`DELETE FROM players WHERE id = ?1`).bind(id),
      DB.prepare(`UPDATE players SET referrer = NULL WHERE referrer = ?1`).bind(id),
    ]),
  };
}

export function memoryPlayers() {
  const rows = new Map();
  const copy = (p) => (p ? { ...p } : null);
  return {
    rows,
    get: async (id) => copy(rows.get(id)),
    async insert(p) {
      if (rows.has(p.id)) return false;
      rows.set(p.id, copy(p));
      return true;
    },
    async save(p) {
      const row = rows.get(p.id);
      if (!row || row.version !== p.version) return false;
      rows.set(p.id, { ...copy(p), version: p.version + 1 });
      return true;
    },
    async reward(id, amount) {
      const row = rows.get(id);
      if (row) Object.assign(row, { coins: row.coins + amount, earned: row.earned + amount, invited: row.invited + 1, ref_bonus: row.ref_bonus + amount, version: row.version + 1 });
    },
    friends: async (id) => [...rows.values()].filter((r) => r.referrer === id).sort((a, b) => b.created_at - a.created_at)
      .map(({ name, photo, premium, ref_reward, created_at }) => ({ name, photo, premium, ref_reward, created_at })),
    async remove(id) {
      rows.delete(id);
      for (const r of rows.values()) if (r.referrer === id) r.referrer = null;
    },
  };
}
