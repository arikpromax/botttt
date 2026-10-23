// Збереження гравців: D1 (таблиця players з migrations/0003_game.sql) або пам'ять — для тестів.
// save() пише, лише якщо запис не змінився з моменту читання (version), — так одночасні запити
// не перетирають один одного й не дають купити двічі за ті самі монети.

const MUTABLE = [
  "name", "username", "photo", "premium", "coins", "earned", "tap_lvl", "energy_lvl", "regen_lvl", "passive_lvl",
  "energy", "energy_at", "passive_at", "tap_at", "referrer", "ref_reward", "invited", "ref_bonus",
  "daily_day", "channel_done", "friends3_done", "streak", "streak_day", "chicken_at", "chicken_day", "chicken_count",
  "cipher_day", "cipher_tries", "cipher_tries_day",
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
    // Рейтинг друзів: сам гравець, той, хто його запросив, і ті, кого запросив він, — за заробленим.
    friends: async (id, referrer) => (await DB.prepare(
      `SELECT id, name, photo, premium, earned, referrer, ref_reward FROM players
       WHERE referrer = ?1 OR id = ?1 OR id = ?2 ORDER BY earned DESC LIMIT 100`,
    ).bind(id, referrer ?? -1).all()).results,
    wasInvited: async (id) => Boolean(await DB.prepare(`SELECT 1 FROM invite_used WHERE id = ?1`).bind(id).first()),
    markInvited: (id) => DB.prepare(`INSERT OR IGNORE INTO invite_used (id) VALUES (?1)`).bind(id).run(),
    remove: (id) => DB.batch([
      DB.prepare(`DELETE FROM players WHERE id = ?1`).bind(id),
      DB.prepare(`UPDATE players SET referrer = NULL WHERE referrer = ?1`).bind(id),
    ]),
  };
}

export function memoryPlayers() {
  const rows = new Map();
  const copy = (p) => (p ? { ...p } : null);
  const memory = {
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
    invitedOnce: new Set(),
    friends: async (id, referrer) => [...rows.values()].filter((r) => r.referrer === id || r.id === id || r.id === referrer)
      .sort((a, b) => b.earned - a.earned)
      .map(({ id, name, photo, premium, earned, referrer, ref_reward }) => ({ id, name, photo, premium, earned, referrer, ref_reward })),
    wasInvited: async (id) => memory.invitedOnce.has(id),
    markInvited: async (id) => memory.invitedOnce.add(id),
    async remove(id) {
      rows.delete(id);
      for (const r of rows.values()) if (r.referrer === id) r.referrer = null;
    },
  };
  return memory;
}
