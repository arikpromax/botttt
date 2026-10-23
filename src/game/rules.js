// Правила гри Ara Farm: економіка, енергія, пасивний дохід, ліги, серія днів, курка, шифр дня, завдання.
// Чисті функції — сервер рахує все сам (клієнт лише показує), тож «натапати» більше, ніж дозволяють
// енергія й швидкість пальця, не вийде.

const HOUR = 3600_000;
const MINUTE = 60_000;

// ---- Економіка ----
// Покращення: значення на рівнях 1…10 і ціна переходу з рівня N на N+1 (costs[N-1]), кожен рівень ×2,2.
// Орієнтир: новачок без покращень заробляє ~3–5 тис. на день (енергія ×5 заходів, щоденна нагорода,
// пасивний дохід), тож перше покращення — за 2–4 дні, останні — це місяці гри.
const prices = (base) => Array.from({ length: 9 }, (_, i) => Math.round((base * 2.2 ** i) / 10) * 10);
export const UPGRADES = {
  // Монет за тап: перше покращення окупається за ~3 год активного тапання.
  tap: { values: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15], costs: prices(10_000) },
  // Максимум енергії = скільки монет дає один захід у гру.
  energy: { values: [500, 1000, 1500, 2000, 3000, 4000, 5500, 7000, 8500, 10_000], costs: prices(15_000) },
  // Енергії за секунду; більше 10 не треба — пальцем швидше за 12 тапів/с не натиснеш.
  regen: { values: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10], costs: prices(30_000) },
  // Монет за годину (навіть офлайн, до 8 год): перше покращення окупається за ~3 доби, далі — довше.
  passive: { values: [50, 300, 700, 1300, 2200, 3500, 5500, 8500, 13_000, 20_000], costs: prices(20_000) },
};
export const MAX_LEVEL = 10;
export const PASSIVE_CAP_HOURS = 8; // поки гравця немає, ферма заробляє не довше 8 годин

// Ліги — за всіма заробленими монетами (назви — у застосунку).
export const LEAGUES = [0, 10_000, 100_000, 500_000, 2_000_000, 10_000_000];

export const REWARDS = {
  channel: 1000, // підписка на канал
  friends3: 2500, // запросити 3 друзів
  friend: 1000, // тому, хто запросив, за кожного друга
  friendPremium: 2500, // … якщо в друга Telegram Premium
  welcome: 500, // новачку, який прийшов за запрошенням
};
export const FRIENDS_TARGET = 3;

// Серія днів (вогник): щоденна нагорода росте з кожним днем поспіль; пропустив день — серія з нуля.
export const STREAK_REWARDS = [500, 1000, 1500, 2500, 3500, 5000, 7500]; // день 1…7, далі — як 7-й
// Курка пролітає над фермою нечасто: не частіше ніж раз на 15 хв і не більше 8 разів на день.
export const CHICKEN = { reward: 300, cooldownMinutes: 15, perDay: 8 };
// Шифр дня: слово щодня публікується в каналі; 5 спроб на день.
export const CIPHER = { reward: 3000, tries: 5 };

// Бусти. «Повна енергія» — 3 рази на день, не частіше ніж раз на годину.
// «Турбо» — 2 рази на день: 20 секунд кожен тап ×5 і без витрати енергії.
export const BOOSTS = {
  energy: { perDay: 3, cooldownMinutes: 60 },
  turbo: { perDay: 2, seconds: 20, multiplier: 5 },
};
const TURBO_GRACE_MS = 2000; // останні турбо-тапи доходять до сервера трохи пізніше

// Досягнення: stat — що рахуємо, goal — скільки треба, reward — нагорода (забрати в Профілі).
export const ACHIEVEMENTS = [
  { id: "tap1k", stat: "taps", goal: 1_000, reward: 1_000 },
  { id: "tap10k", stat: "taps", goal: 10_000, reward: 5_000 },
  { id: "tap100k", stat: "taps", goal: 100_000, reward: 25_000 },
  { id: "earn100k", stat: "earned", goal: 100_000, reward: 5_000 },
  { id: "earn1m", stat: "earned", goal: 1_000_000, reward: 50_000 },
  { id: "friend1", stat: "invited", goal: 1, reward: 1_000 },
  { id: "friend5", stat: "invited", goal: 5, reward: 5_000 },
  { id: "friend10", stat: "invited", goal: 10, reward: 15_000 },
  { id: "streak3", stat: "bestStreak", goal: 3, reward: 1_500 },
  { id: "streak7", stat: "bestStreak", goal: 7, reward: 7_500 },
  { id: "streak30", stat: "bestStreak", goal: 30, reward: 30_000 },
  { id: "chicken1", stat: "chickens", goal: 1, reward: 500 },
  { id: "chicken25", stat: "chickens", goal: 25, reward: 5_000 },
  { id: "cipher1", stat: "ciphers", goal: 1, reward: 1_000 },
  { id: "cipher10", stat: "ciphers", goal: 10, reward: 10_000 },
  { id: "upgrade5", stat: "maxUpgrade", goal: 5, reward: 10_000 },
  { id: "allmax", stat: "minUpgrade", goal: MAX_LEVEL, reward: 100_000 },
];

// Тапати можна одним пальцем: не швидше за 12 разів на секунду (клієнт пускає трохи повільніше).
// «Відро» тапів: невикористаний час накопичується не більше ніж за 5 секунд — щоб не можна було
// довго чекати, а потім надіслати тисячу тапів разом.
export const TAPS_PER_SECOND = 12;
const TAP_WINDOW_MS = 5000;
const MAX_TAPS_PER_SYNC = 2000;

export const value = (kind, level) => UPGRADES[kind].values[level - 1];

// День за Києвом (РРРР-ММ-ДД) і зсув дня — без мілісекунд, щоб перехід на літній час нічого не ламав.
export const kyivDay = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date(now));
export function shiftDay(day, delta) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function newPlayer(user, now) {
  return {
    id: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 64) || "Гравець",
    username: user.username ?? null,
    photo: user.photo_url ?? null,
    premium: user.is_premium ? 1 : 0,
    coins: 0, earned: 0,
    tap_lvl: 1, energy_lvl: 1, regen_lvl: 1, passive_lvl: 1,
    energy: value("energy", 1), energy_at: now, passive_at: now, tap_at: now,
    referrer: null, ref_reward: 0, invited: 0, ref_bonus: 0,
    daily_day: null, channel_done: 0, friends3_done: 0,
    streak: 0, streak_day: null,
    chicken_at: now, chicken_day: null, chicken_count: 0,
    cipher_day: null, cipher_tries: 0, cipher_tries_day: null,
    total_taps: 0, best_streak: 0, chickens_total: 0, ciphers_total: 0, achievements: "",
    taps_day: null, taps_today: 0, daily_tasks: "", tasks_done: "", bot_used: "", site_open_at: 0, wallet: null,
    boost_energy_day: null, boost_energy_count: 0, boost_energy_at: 0,
    turbo_day: null, turbo_count: 0, turbo_until: 0,
    created_at: now, version: 0,
  };
}

function give(p, amount) {
  p.coins += amount;
  p.earned += amount;
}

// Вогник: перший запит за день продовжує серію (якщо вчора гравець був) або починає заново.
// → { lost } — скільки днів згоріло (0, якщо нічого).
export function touchStreak(p, now) {
  const today = kyivDay(now);
  if (p.streak_day === today) return { lost: 0 };
  let lost = 0;
  if (p.streak_day && p.streak_day === shiftDay(today, -1)) p.streak += 1;
  else {
    lost = p.streak;
    p.streak = 1;
  }
  p.streak_day = today;
  p.best_streak = Math.max(p.best_streak, p.streak); // для досягнень: згорілий вогник їх не забирає
  return { lost };
}
export const dailyReward = (streak) => STREAK_REWARDS[Math.min(Math.max(streak, 1), STREAK_REWARDS.length) - 1];

// Доводить енергію, пасивний дохід і серію до моменту now. → скільки дав пасивний дохід.
export function settle(p, now) {
  touchStreak(p, now);
  const max = value("energy", p.energy_lvl);
  p.energy = Math.min(max, p.energy + (value("regen", p.regen_lvl) * Math.max(0, now - p.energy_at)) / 1000);
  p.energy_at = now;

  const rate = value("passive", p.passive_lvl);
  const elapsed = Math.max(0, now - p.passive_at);
  let gain;
  if (elapsed >= PASSIVE_CAP_HOURS * HOUR) {
    gain = Math.floor(rate * PASSIVE_CAP_HOURS);
    p.passive_at = now;
  } else {
    // Частку монети не губимо: час зсуваємо лише на нараховані цілі монети.
    gain = Math.floor((rate * elapsed) / HOUR);
    p.passive_at += (gain * HOUR) / rate;
  }
  give(p, gain);
  return gain;
}

// Тапи від клієнта: не більше, ніж є енергії, і не швидше, ніж одним пальцем. turboTaps — зроблені під
// час турбо: енергії не витрачають і дають ×5, але лише в межах вікна турбо. → скільки зараховано (усього).
export function applyTaps(p, taps, now, turboTaps = 0) {
  settle(p, now);
  const from = Math.max(p.tap_at, now - TAP_WINDOW_MS);
  const byTime = Math.min(Math.floor(((now - from) / 1000) * TAPS_PER_SECOND), MAX_TAPS_PER_SYNC);
  const turboStart = p.turbo_until - BOOSTS.turbo.seconds * 1000;
  const turboMs = Math.max(0, Math.min(now, p.turbo_until + TURBO_GRACE_MS) - Math.max(from, turboStart));
  const turbo = Math.max(0, Math.min(Math.floor(turboTaps) || 0, Math.floor((turboMs / 1000) * TAPS_PER_SECOND), byTime));
  const normal = Math.max(0, Math.min(Math.floor(taps) || 0, Math.floor(p.energy), byTime - turbo));
  p.energy -= normal;
  p.tap_at = from + ((normal + turbo) / TAPS_PER_SECOND) * 1000; // використаний час «відра»
  p.total_taps += normal + turbo;
  const today = kyivDay(now);
  if (p.taps_day !== today) Object.assign(p, { taps_day: today, taps_today: 0 });
  p.taps_today += normal + turbo;
  give(p, (normal + turbo * BOOSTS.turbo.multiplier) * value("tap", p.tap_lvl));
  return normal + turbo;
}

// Бусти: → null або "limit" | "early" | "full" | "active" | "unknown".
export function useBoost(p, kind, now) {
  settle(p, now);
  const today = kyivDay(now);
  if (kind === "energy") {
    if (p.boost_energy_day !== today) Object.assign(p, { boost_energy_day: today, boost_energy_count: 0 });
    if (p.boost_energy_count >= BOOSTS.energy.perDay) return "limit";
    if (now - p.boost_energy_at < BOOSTS.energy.cooldownMinutes * MINUTE) return "early";
    const max = value("energy", p.energy_lvl);
    if (p.energy >= max - 1) return "full";
    p.energy = max;
    p.boost_energy_count += 1;
    p.boost_energy_at = now;
    return null;
  }
  if (kind === "turbo") {
    if (p.turbo_day !== today) Object.assign(p, { turbo_day: today, turbo_count: 0 });
    if (p.turbo_count >= BOOSTS.turbo.perDay) return "limit";
    if (p.turbo_until > now) return "active";
    p.turbo_until = now + BOOSTS.turbo.seconds * 1000;
    p.turbo_count += 1;
    return null;
  }
  return "unknown";
}

// ---- Досягнення ----
const levels = (p) => ["tap", "energy", "regen", "passive"].map((k) => p[`${k}_lvl`]);
const STATS = {
  taps: (p) => p.total_taps, earned: (p) => p.earned, invited: (p) => p.invited, bestStreak: (p) => p.best_streak,
  chickens: (p) => p.chickens_total, ciphers: (p) => p.ciphers_total,
  maxUpgrade: (p) => Math.max(...levels(p)), minUpgrade: (p) => Math.min(...levels(p)),
};
const claimed = (p) => new Set(p.achievements ? p.achievements.split(",") : []);

// → null або "done" | "not_yet" | "unknown".
export function claimAchievement(p, id, now) {
  settle(p, now);
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return "unknown";
  const have = claimed(p);
  if (have.has(id)) return "done";
  if (STATS[a.stat](p) < a.goal) return "not_yet";
  have.add(id);
  p.achievements = [...have].join(",");
  give(p, a.reward);
  return null;
}

export const upgradeCost = (kind, level) => (level >= MAX_LEVEL ? null : UPGRADES[kind].costs[level - 1]);

// → null, якщо куплено, або причина: "max" | "coins" | "unknown".
export function buyUpgrade(p, kind, now) {
  if (!UPGRADES[kind]) return "unknown";
  settle(p, now);
  const key = `${kind}_lvl`;
  const cost = upgradeCost(kind, p[key]);
  if (cost === null) return "max";
  if (p.coins < cost) return "coins";
  p.coins -= cost;
  p[key] += 1;
  return null;
}

// ---- Завдання ----
// kind: daily — щодня заново, once — раз назавжди. goal — скільки треба (прогрес рахує taskProgress).
// bot — функції бота-конвертера, будь-якою з яких можна виконати завдання (бот позначає це сам).
export const TASKS = {
  daily: { kind: "daily" }, // нагорода — за серією днів (вогник)
  taps: { kind: "daily", reward: 1000, goal: 1000 }, // натапати 1000 разів за день
  chicken: { kind: "daily", reward: 700, goal: 1 }, // зловити курку
  boost: { kind: "daily", reward: 300, goal: 1 }, // скористатися бустом
  channel: { kind: "once", reward: REWARDS.channel },
  friends3: { kind: "once", reward: REWARDS.friends3, goal: FRIENDS_TARGET },
  tiktok: { kind: "once", reward: 1000, goal: 1, bot: ["tiktok"] },
  photo: { kind: "once", reward: 700, goal: 1, bot: ["compress", "pdf", "album", "scan", "jpg", "sticker", "emoji", "mosaic"] },
  qr: { kind: "once", reward: 500, goal: 1, bot: ["qr"] },
  currency: { kind: "once", reward: 300, goal: 1, bot: ["currency"] },
  home: { kind: "once", reward: 500 }, // додати гру на головний екран (Telegram не дає це перевірити — віримо)
};

const list = (s) => (s ? s.split(",") : []);
const dailyDone = (p, id, today) => (p.daily_tasks ?? "").startsWith(`${today}:`) && list(p.daily_tasks.slice(11)).includes(id);
const onceDone = (p, id) => list(p.tasks_done).includes(id);
const usedInBot = (p, features) => list(p.bot_used).some((f) => features.includes(f));

function taskDone(p, id, today) {
  if (id === "daily") return p.daily_day === today;
  if (id === "channel") return Boolean(p.channel_done);
  if (id === "friends3") return Boolean(p.friends3_done);
  return TASKS[id].kind === "daily" ? dailyDone(p, id, today) : onceDone(p, id);
}

function taskProgress(p, id, today, now) {
  if (id === "taps") return p.taps_day === today ? p.taps_today : 0;
  if (id === "chicken") return p.chicken_day === today ? p.chicken_count : 0;
  if (id === "boost") return (p.boost_energy_day === today ? p.boost_energy_count : 0) + (p.turbo_day === today ? p.turbo_count : 0);
  if (id === "friends3") return p.invited;
  if (TASKS[id].bot) return usedInBot(p, TASKS[id].bot) ? 1 : 0;
  return 0;
}

// → null, якщо нагороду видано, або причина: "done" | "not_member" | "not_enough" | "unknown".
// channelMember — підписаний на канал (перевіряє сервер у Telegram).
export function claimTask(p, id, now, { channelMember = false } = {}) {
  const task = Object.hasOwn(TASKS, id) ? TASKS[id] : null;
  if (!task) return "unknown";
  settle(p, now);
  const today = kyivDay(now);
  if (taskDone(p, id, today)) return "done";
  if (id === "channel" && !channelMember) return "not_member";
  if (task.goal && taskProgress(p, id, today, now) < task.goal) return "not_enough";

  if (id === "daily") p.daily_day = today;
  else if (id === "channel") p.channel_done = 1;
  else if (id === "friends3") p.friends3_done = 1;
  else if (task.kind === "daily") {
    // «РРРР-ММ-ДД:taps,chicken» — список лише за сьогодні; новий день — новий список.
    p.daily_tasks = (p.daily_tasks ?? "").startsWith(`${today}:`) ? `${p.daily_tasks},${id}` : `${today}:${id}`;
  } else p.tasks_done = [...list(p.tasks_done), id].join(",");
  give(p, id === "daily" ? dailyReward(p.streak) : task.reward);
  return null;
}

// Стан завдань для клієнта.
function tasksState(p, now) {
  const today = kyivDay(now);
  return Object.fromEntries(Object.entries(TASKS).map(([id, t]) => {
    const done = taskDone(p, id, today);
    const progress = t.goal ? Math.min(taskProgress(p, id, today, now), t.goal) : 0;
    const reward = id === "daily" ? dailyReward(p.streak_day === today ? p.streak : 1) : t.reward;
    return [id, { kind: t.kind, reward, done, progress, goal: t.goal ?? 0 }];
  }));
}

// Курка: → null або "early" | "limit".
export function claimChicken(p, now) {
  settle(p, now);
  const today = kyivDay(now);
  if (p.chicken_day !== today) {
    p.chicken_day = today;
    p.chicken_count = 0;
  }
  if (p.chicken_count >= CHICKEN.perDay) return "limit";
  if (now - p.chicken_at < CHICKEN.cooldownMinutes * MINUTE) return "early";
  p.chicken_at = now;
  p.chicken_count += 1;
  p.chickens_total += 1;
  give(p, CHICKEN.reward);
  return null;
}

// Шифр дня: correct — чи вгадав (слово перевіряє api). → null або "done" | "no_tries" | "wrong".
// Неправильна спроба теж зберігається (лічильник), тому api зберігає гравця й при "wrong".
export function claimCipher(p, now, correct) {
  settle(p, now);
  const today = kyivDay(now);
  if (p.cipher_day === today) return "done";
  if (p.cipher_tries_day !== today) {
    p.cipher_tries_day = today;
    p.cipher_tries = 0;
  }
  if (p.cipher_tries >= CIPHER.tries) return "no_tries";
  if (!correct) {
    p.cipher_tries += 1;
    return "wrong";
  }
  p.cipher_day = today;
  p.ciphers_total += 1;
  give(p, CIPHER.reward);
  return null;
}

// Новачок прийшов за запрошенням: йому — вітальні монети. → скільки отримає той, хто запросив.
export function joinByInvite(p, referrerId) {
  p.referrer = referrerId;
  p.ref_reward = p.premium ? REWARDS.friendPremium : REWARDS.friend;
  give(p, REWARDS.welcome);
  return p.ref_reward;
}

export function leagueOf(earned) {
  let league = 0;
  while (league + 1 < LEAGUES.length && earned >= LEAGUES[league + 1]) league++;
  return { league, from: LEAGUES[league], to: LEAGUES[league + 1] ?? null };
}

// Те, що бачить клієнт.
export function publicState(p, now) {
  const today = kyivDay(now);
  const upgrade = (kind) => {
    const level = p[`${kind}_lvl`];
    return { level, value: value(kind, level), next: level < MAX_LEVEL ? value(kind, level + 1) : null, cost: upgradeCost(kind, level) };
  };
  return {
    id: p.id, name: p.name, photo: p.photo,
    coins: p.coins, earned: p.earned, ...leagueOf(p.earned), leagues: LEAGUES,
    energy: Math.floor(p.energy), energyMax: value("energy", p.energy_lvl), regen: value("regen", p.regen_lvl),
    perTap: value("tap", p.tap_lvl), passive: value("passive", p.passive_lvl), passiveCapHours: PASSIVE_CAP_HOURS,
    maxLevel: MAX_LEVEL, tapsPerSecond: TAPS_PER_SECOND,
    upgrades: { tap: upgrade("tap"), energy: upgrade("energy"), regen: upgrade("regen"), passive: upgrade("passive") },
    streak: p.streak_day === today || p.streak_day === shiftDay(today, -1) ? p.streak : 0,
    streakRewards: STREAK_REWARDS,
    tasks: tasksState(p, now),
    cipher: {
      reward: CIPHER.reward, done: p.cipher_day === today,
      triesLeft: CIPHER.tries - (p.cipher_tries_day === today ? p.cipher_tries : 0),
    },
    chicken: {
      reward: CHICKEN.reward, readyAt: p.chicken_at + CHICKEN.cooldownMinutes * MINUTE,
      left: CHICKEN.perDay - (p.chicken_day === today ? p.chicken_count : 0),
    },
    boosts: {
      energy: {
        perDay: BOOSTS.energy.perDay, readyAt: p.boost_energy_at + BOOSTS.energy.cooldownMinutes * MINUTE,
        left: BOOSTS.energy.perDay - (p.boost_energy_day === today ? p.boost_energy_count : 0),
      },
      turbo: {
        perDay: BOOSTS.turbo.perDay, seconds: BOOSTS.turbo.seconds, multiplier: BOOSTS.turbo.multiplier, until: p.turbo_until,
        left: BOOSTS.turbo.perDay - (p.turbo_day === today ? p.turbo_count : 0),
      },
    },
    achievements: ACHIEVEMENTS.map((a) => ({
      id: a.id, goal: a.goal, reward: a.reward, progress: Math.min(STATS[a.stat](p), a.goal), done: claimed(p).has(a.id),
    })),
    invited: p.invited, refBonus: p.ref_bonus,
    rewards: { friend: REWARDS.friend, friendPremium: REWARDS.friendPremium, welcome: REWARDS.welcome },
    now,
  };
}
