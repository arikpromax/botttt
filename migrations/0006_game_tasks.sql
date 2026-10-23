-- Ara Farm: більше завдань — щоденні (тапи, курка, буст) і одноразові (бот-конвертер, сайт, головний екран).
ALTER TABLE players ADD COLUMN taps_day TEXT;
ALTER TABLE players ADD COLUMN taps_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN daily_tasks TEXT NOT NULL DEFAULT '';  -- «РРРР-ММ-ДД:id,id» — виконані сьогодні
ALTER TABLE players ADD COLUMN tasks_done TEXT NOT NULL DEFAULT '';   -- одноразові, через кому
ALTER TABLE players ADD COLUMN bot_used TEXT NOT NULL DEFAULT '';     -- якими функціями бота людина вже користувалась
ALTER TABLE players ADD COLUMN site_open_at INTEGER NOT NULL DEFAULT 0;
