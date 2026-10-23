-- Ara Farm, захист від ферм ботів: бонус за запрошення — лише коли друг натапав 1000 разів (ref_paid),
-- один гаманець — один гравець (шукаємо за wallet).
ALTER TABLE players ADD COLUMN ref_paid INTEGER NOT NULL DEFAULT 1;  -- уже запрошені до цього — уже оплачені
CREATE INDEX IF NOT EXISTS players_wallet ON players (wallet);
