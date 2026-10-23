// Правила гри Ara Farm: економіка, енергія, пасивний дохід, рівні, завдання. Чисті функції — сервер
// рахує все сам (клієнт лише показує), тож «натапати» більше, ніж дозволяє енергія, не вийде.

const HOUR = 3600_000;

// Покращення: значення на рівнях 1…10 і ціна переходу з рівня N на N+1 (costs[N-1]).
const prices = (base) => Array.from({ length: 9 }, (_, i) => Math.round((base * 2.2 ** i) / 10) * 10);
export const UPGRADES = {
  tap: { values: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15], costs: prices(10_000) }, // монет за тап
  energy: { values: [500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000], costs: prices(15_000) }, // максимум енергії
  regen: { values: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10], costs: prices(30_000) }, // енергії за секунду
  passive: { values: [10, 25, 50, 100, 200, 400, 700, 1200, 2000, 3500], costs: prices(20_000) }, // монет за годину
};
export const MAX_LEVEL = 10;
export const PASSIVE_CAP_HOURS = 8; // поки гравця немає, ферма заробляє не довше 8 годин

// Рівень гравця — за всіма заробленими монетами.
export const LEVELS = [0, 1000, 5000, 20000, 60000, 150000, 400000, 1_000_000, 2_500_000, 6_000_000];

export const REWARDS = {
  daily: 500, // щоденний вхід
  channel: 1000, // підписка на канал
  friends3: 2500, // запросити 3 друзів
  friend: 1000, // тому, хто запросив, за кожного друга
  friendPremium: 2500, // … якщо в друга Telegram Premium
  welcome: 500, // новачку, який прийшов за запрошенням
};
export const FRIENDS_TARGET = 3;

// Тапати можна одним пальцем: не швидше за 12 разів на секунду (клієнт пускає трохи повільніше).
// «Відро» тапів: невикористаний час накопичується не більше ніж за 5 секунд — щоб не можна було
// довго чекати, а потім надіслати тисячу тапів разом.
export const TAPS_PER_SECOND = 12;
const TAP_WINDOW_MS = 5000;
const MAX_TAPS_PER_SYNC = 2000;

export const value = (kind, level) => UPGRADES[kind].values[level - 1];

// День за Києвом — для щоденної нагороди.
export const kyivDay = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date(now));

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
    created_at: now, version: 0,
  };
}

function give(p, amount) {
  p.coins += amount;
  p.earned += amount;
}

// Доводить енергію й пасивний дохід до моменту now. → скільки дав пасивний дохід.
export function settle(p, now) {
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

// Завдання. channelMember — підписаний на канал (перевіряє сервер у Telegram).
export const TASKS = ["daily", "channel", "friends3"];

export function taskState(p, now) {
  return {
    daily: { reward: REWARDS.daily, done: p.daily_day === kyivDay(now) },
    channel: { reward: REWARDS.channel, done: Boolean(p.channel_done) },
    friends3: { reward: REWARDS.friends3, done: Boolean(p.friends3_done), progress: Math.min(p.invited, FRIENDS_TARGET), target: FRIENDS_TARGET },
  };
}

// → null, якщо нагороду видано, або причина: "done" | "not_member" | "not_enough" | "unknown".
export function claimTask(p, id, now, { channelMember = false } = {}) {
  settle(p, now);
  if (id === "daily") {
    if (p.daily_day === kyivDay(now)) return "done";
    p.daily_day = kyivDay(now);
    give(p, REWARDS.daily);
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

// Новачок прийшов за запрошенням: йому — вітальні монети. → скільки отримає той, хто запросив.
export function joinByInvite(p, referrerId) {
  p.referrer = referrerId;
  p.ref_reward = p.premium ? REWARDS.friendPremium : REWARDS.friend;
  give(p, REWARDS.welcome);
  return p.ref_reward;
}

export function levelOf(earned) {
  let level = 1;
  while (level < LEVELS.length && earned >= LEVELS[level]) level++;
  return { level, from: LEVELS[level - 1], to: LEVELS[level] ?? null };
}

// Те, що бачить клієнт.
export function publicState(p, now) {
  const upgrade = (kind) => {
    const level = p[`${kind}_lvl`];
    return { level, value: value(kind, level), next: level < MAX_LEVEL ? value(kind, level + 1) : null, cost: upgradeCost(kind, level) };
  };
  return {
    id: p.id, name: p.name, photo: p.photo,
    coins: p.coins, earned: p.earned, ...levelOf(p.earned),
    energy: Math.floor(p.energy), energyMax: value("energy", p.energy_lvl), regen: value("regen", p.regen_lvl),
    perTap: value("tap", p.tap_lvl), passive: value("passive", p.passive_lvl), passiveCapHours: PASSIVE_CAP_HOURS,
    maxLevel: MAX_LEVEL,
    upgrades: { tap: upgrade("tap"), energy: upgrade("energy"), regen: upgrade("regen"), passive: upgrade("passive") },
    tasks: taskState(p, now),
    invited: p.invited, refBonus: p.ref_bonus,
    rewards: { friend: REWARDS.friend, friendPremium: REWARDS.friendPremium, welcome: REWARDS.welcome },
    now,
  };
}
