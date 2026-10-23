-- Знеособлена статистика для /stats: унікальні користувачі за днями (хеш, не ідентифікатор) і кількість дій.
CREATE TABLE IF NOT EXISTS stats_seen (
  day       TEXT NOT NULL,  -- РРРР-ММ-ДД (UTC)
  user_hash TEXT NOT NULL,
  PRIMARY KEY (day, user_hash)
);
CREATE TABLE IF NOT EXISTS stats_usage (
  day     TEXT    NOT NULL,
  feature TEXT    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, feature)
);
