-- Ara Farm: бусти (повна енергія, турбо) і досягнення.
ALTER TABLE players ADD COLUMN total_taps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN best_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN chickens_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN ciphers_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN achievements TEXT NOT NULL DEFAULT '';  -- забрані досягнення через кому
ALTER TABLE players ADD COLUMN boost_energy_day TEXT;
ALTER TABLE players ADD COLUMN boost_energy_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN boost_energy_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN turbo_day TEXT;
ALTER TABLE players ADD COLUMN turbo_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN turbo_until INTEGER NOT NULL DEFAULT 0;
-- Тим, хто вже грає: найдовша серія — щонайменше поточна; спіймані курки й шифри — з сьогоднішніх.
UPDATE players SET best_streak = streak,
  chickens_total = chicken_count,
  ciphers_total = CASE WHEN cipher_day IS NULL THEN 0 ELSE 1 END;
