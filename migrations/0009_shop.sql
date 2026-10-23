-- Ara Farm: магазин за Telegram Stars — платне турбо ×10, відновлення ×2, захист вогника; облік покупок.
ALTER TABLE players ADD COLUMN turbo_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN turbo_mult INTEGER NOT NULL DEFAULT 5;
ALTER TABLE players ADD COLUMN regen_boost_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN streak_freezes INTEGER NOT NULL DEFAULT 0;
-- Турбо, яке вже йде, — початок за старим правилом (тривалість 20 с).
UPDATE players SET turbo_start = turbo_until - 20000 WHERE turbo_until > 0;

CREATE TABLE IF NOT EXISTS purchases (
  charge_id  TEXT    PRIMARY KEY,           -- telegram_payment_charge_id: один платіж — одна видача
  user_id    INTEGER NOT NULL,
  product    TEXT    NOT NULL,
  stars      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  refunded   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS purchases_time ON purchases (created_at);
