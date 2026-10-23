-- Гра Ara Farm у Mini App: прогрес гравців. version — захист від одночасних змін (оптимістичне блокування).
CREATE TABLE IF NOT EXISTS players (
  id            INTEGER PRIMARY KEY,         -- Telegram id
  name          TEXT    NOT NULL,
  username      TEXT,
  photo         TEXT,
  premium       INTEGER NOT NULL DEFAULT 0,
  coins         INTEGER NOT NULL DEFAULT 0,
  earned        INTEGER NOT NULL DEFAULT 0,  -- усього зароблено (для рівня)
  tap_lvl       INTEGER NOT NULL DEFAULT 1,
  energy_lvl    INTEGER NOT NULL DEFAULT 1,
  regen_lvl     INTEGER NOT NULL DEFAULT 1,
  passive_lvl   INTEGER NOT NULL DEFAULT 1,
  energy        REAL    NOT NULL,
  energy_at     INTEGER NOT NULL,            -- мс
  passive_at    REAL    NOT NULL,            -- мс (із частками — щоб не губити частини монет)
  tap_at        INTEGER NOT NULL,
  referrer      INTEGER,                     -- хто запросив
  ref_reward    INTEGER NOT NULL DEFAULT 0,  -- скільки за цього гравця отримав той, хто запросив
  invited       INTEGER NOT NULL DEFAULT 0,
  ref_bonus     INTEGER NOT NULL DEFAULT 0,
  daily_day     TEXT,
  channel_done  INTEGER NOT NULL DEFAULT 0,
  friends3_done INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS players_referrer ON players (referrer, created_at);
