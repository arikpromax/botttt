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

// Тапи від клієнта: не більше, ніж є енергії, і не швидше, ніж одним пальцем. → скільки зараховано.
export function applyTaps(p, taps, now) {
  settle(p, now);
  const from = Math.max(p.tap_at, now - TAP_WINDOW_MS);
  const byTime = Math.floor(((now - from) / 1000) * TAPS_PER_SECOND);
  const accepted = Math.max(0, Math.min(Math.floor(taps) || 0, Math.floor(p.energy), byTime, MAX_TAPS_PER_SYNC));
  p.energy -= accepted;
  p.tap_at = from + (accepted / TAPS_PER_SECOND) * 1000; // використаний час «відра»
  give(p, accepted * value("tap", p.tap_lvl));
  return accepted;
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
export const TASKS = ["daily", "channel", "friends3"];

// → null, якщо нагороду видано, або причина: "done" | "not_member" | "not_enough" | "unknown".
// channelMember — підписаний на канал (перевіряє сервер у Telegram).
export function claimTask(p, id, now, { channelMember = false } = {}) {
  settle(p, now);
  if (id === "daily") {
    if (p.daily_day === kyivDay(now)) return "done";
    p.daily_day = kyivDay(now);
    give(p, dailyReward(p.streak));
    return null;
  }
  if (id === "channel") {
    if (p.channel_done) return "done";
    if (!channelMember) return "not_member";
    p.channel_done = 1;
    give(p, REWARDS.channel);
    return null;
  }
  if (id === "friends3") {
    if (p.friends3_done) return "done";
    if (p.invited < FRIENDS_TARGET) return "not_enough";
    p.friends3_done = 1;
    give(p, REWARDS.friends3);
    return null;
  }
  return "unknown";
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
    tasks: {
      daily: { reward: dailyReward(p.streak_day === today ? p.streak : 1), done: p.daily_day === today },
      channel: { reward: REWARDS.channel, done: Boolean(p.channel_done) },
      friends3: { reward: REWARDS.friends3, done: Boolean(p.friends3_done), progress: Math.min(p.invited, FRIENDS_TARGET), target: FRIENDS_TARGET },
    },
    cipher: {
      reward: CIPHER.reward, done: p.cipher_day === today,
      triesLeft: CIPHER.tries - (p.cipher_tries_day === today ? p.cipher_tries : 0),
    },
    chicken: {
      reward: CHICKEN.reward, readyAt: p.chicken_at + CHICKEN.cooldownMinutes * MINUTE,
      left: CHICKEN.perDay - (p.chicken_day === today ? p.chicken_count : 0),
    },
    invited: p.invited, refBonus: p.ref_bonus,
    rewards: { friend: REWARDS.friend, friendPremium: REWARDS.friendPremium, welcome: REWARDS.welcome },
    now,
  };
}
