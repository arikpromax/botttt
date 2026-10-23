-- Ara Farm: виплати в TON. Гаманець гравця, налаштування власника, заявки на виплату.
ALTER TABLE players ADD COLUMN wallet TEXT;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,  -- enabled | rate | minTon | budgetTon
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  address    TEXT    NOT NULL,   -- куди платити (дружня адреса «UQ…»)
  coins      INTEGER NOT NULL,   -- скільки монет списано
  nano       TEXT    NOT NULL,   -- сума в nano-TON (рядком — щоб не втратити точність)
  status     TEXT    NOT NULL,   -- pending | paid | rejected
  day        TEXT    NOT NULL,   -- день заявки за Києвом (для денного бюджету)
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS withdrawals_user ON withdrawals (user_id, id);
CREATE INDEX IF NOT EXISTS withdrawals_day ON withdrawals (day, status);
