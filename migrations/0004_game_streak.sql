-- Ara Farm: серія днів (вогник), курка, шифр дня.
ALTER TABLE players ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN streak_day TEXT;
ALTER TABLE players ADD COLUMN chicken_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN chicken_day TEXT;
ALTER TABLE players ADD COLUMN chicken_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN cipher_day TEXT;
ALTER TABLE players ADD COLUMN cipher_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN cipher_tries_day TEXT;

-- Хто вже колись приходив за запрошенням (лише Telegram id): бонус за запрошення дається один раз,
-- навіть якщо гравець видалив прогрес і зайшов знову за чужим посиланням.
CREATE TABLE IF NOT EXISTS invite_used (id INTEGER PRIMARY KEY);
