// Гра Ara Farm: підпис Telegram, правила й API (сховище в пам'яті, без мережі).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signInitData, verifyInitData } from "../src/game/auth.js";
import { gameApi } from "../src/game/api.js";
import { memoryPlayers } from "../src/game/store.js";
import {
  CHICKEN, STREAK_REWARDS, TAPS_PER_SECOND, UPGRADES, applyTaps, claimChicken, dailyReward, leagueOf, newPlayer, settle, touchStreak,
} from "../src/game/rules.js";
import { cipherWord, isCipher, normalizeWord } from "../src/game/cipher.js";

const TOKEN = "123:TEST";
const T0 = Date.UTC(2026, 9, 23, 10, 0, 0);

async function initData(user, { startParam, authDate = T0 / 1000, token = TOKEN } = {}) {
  const fields = { auth_date: String(Math.floor(authDate)), query_id: "q", user: JSON.stringify(user) };
  if (startParam) fields.start_param = startParam;
  fields.hash = await signInitData(fields, token);
  return new URLSearchParams(fields).toString();
}

function game({ member = false } = {}) {
  let now = T0;
  const store = memoryPlayers();
  const handle = gameApi({ store, token: TOKEN, botUsername: "test_bot", secret: "s", checkMember: async () => member, clock: () => now });
  const call = async (path, user, body = {}, opts) => {
    const res = await handle(new Request(`https://x.test/api/${path}`, {
      method: "POST", body: JSON.stringify({ auth: await initData(user, { authDate: now / 1000, ...opts }), ...body }),
    }));
    return { status: res.status, ...(await res.json()) };
  };
  return { store, call, wait: (ms) => (now += ms), get now() { return now; } };
}

const ANNA = { id: 501, first_name: "Анна" };
const BOHDAN = { id: 502, first_name: "Богдан", is_premium: true };

describe("гра: вхід через Telegram", () => {
  it("приймає лише дані, підписані токеном бота, і не старші за добу", async () => {
    const good = await initData(ANNA);
    assert.equal((await verifyInitData(good, TOKEN, T0)).user.id, 501);
    assert.equal(await verifyInitData(good.replace("%D0%90", "%D0%91"), TOKEN, T0), null, "змінене ім'я");
    assert.equal(await verifyInitData(await initData(ANNA, { token: "999:OTHER" }), TOKEN, T0), null, "чужий бот");
    assert.equal(await verifyInitData(good, TOKEN, T0 + 25 * 3600_000), null, "застаріло");
    assert.equal(await verifyInitData("", TOKEN, T0), null);
  });

  it("API без правильного підпису — 401", async () => {
    const g = game();
    const res = await g.call("me", ANNA, {}, { token: "999:OTHER" });
    assert.equal(res.status, 401);
  });
});

describe("гра: правила", () => {
  it("тапи — не більше енергії й не швидше, ніж одним пальцем (12 за секунду)", () => {
    const p = newPlayer(ANNA, T0);
    assert.equal(applyTaps(p, 10_000, T0 + 1000), 12, "за 1 с — не більше 12");
    assert.equal(p.coins, 12);
    assert.equal(applyTaps(p, 30, T0 + 4000), 30, "чесні 30 тапів за 3 с — усі");
    const later = T0 + 600_000;
    assert.equal(applyTaps(p, 10_000, later), 60, "після довгої паузи — не більше ніж за 5 с");
    settle(p, later);
    assert.equal(Math.floor(p.energy), 440);
    p.energy = 3;
    assert.equal(applyTaps(p, 30, later + 1000), 4, "енергії лише на 4 тапи (3 + 1 відновилась за секунду)");
    settle(p, later + 101_000);
    assert.equal(Math.floor(p.energy), 100, "1 енергія за секунду");
  });

  it("пасивний дохід: частки монет не губляться, максимум — 8 годин", () => {
    const p = newPlayer(ANNA, T0);
    let gained = 0;
    for (let s = 1; s <= 3600; s++) gained += settle(p, T0 + s * 1000); // синхронізація щосекунди
    assert.equal(gained, 50, "50 монет за годину навіть при частих запитах");
    assert.equal(settle(p, T0 + 3600_000 + 48 * 3600_000), 400, "за дві доби — лише 8 годин");
  });

  it("ліга — за всіма заробленими монетами", () => {
    assert.deepEqual(leagueOf(0), { league: 0, from: 0, to: 10_000 });
    assert.deepEqual(leagueOf(150_000), { league: 2, from: 100_000, to: 500_000 });
    assert.deepEqual(leagueOf(1e9), { league: 5, from: 10_000_000, to: null });
  });

  it("економіка: покращення окупаються, але не швидко; новачок на перше покращення працює кілька днів", () => {
    // Пасивний дохід: кожне покращення окупається за 3 доби… 3 місяці, і що далі — то довше.
    const p = UPGRADES.passive;
    const payback = p.costs.map((cost, i) => cost / (p.values[i + 1] - p.values[i]));
    assert.ok(payback.every((h, i) => h >= 72 && h <= 2400 && (i === 0 || h > payback[i - 1])), payback.join(" "));
    // Тап: +1 монета за тап при 1 енергії/с — це +3600 за годину безперервного тапання → ~3 год.
    assert.ok(UPGRADES.tap.costs[0] / 3600 >= 2.5);
    // Новачок за день: 5 заходів по повній енергії + щоденна нагорода + пасивний дохід за 3 заходи по 8 год.
    const day = 5 * UPGRADES.energy.values[0] + STREAK_REWARDS[0] + 24 * UPGRADES.passive.values[0];
    assert.ok(UPGRADES.tap.costs[0] / day >= 2 && UPGRADES.tap.costs[0] / day <= 5, `${day} за день`);
    // Енергія понад швидкість пальця не потрібна.
    assert.ok(Math.max(...UPGRADES.regen.values) <= TAPS_PER_SECOND);
  });

  it("вогник: серія росте щодня, пропустив день — згорає; щоденна нагорода росте з серією", () => {
    const p = newPlayer(ANNA, T0);
    const DAY = 24 * 3600_000;
    assert.deepEqual(touchStreak(p, T0), { lost: 0 });
    assert.equal(p.streak, 1);
    touchStreak(p, T0 + 3600_000);
    assert.equal(p.streak, 1, "у той самий день — не росте");
    for (let d = 1; d <= 7; d++) touchStreak(p, T0 + d * DAY);
    assert.equal(p.streak, 8);
    assert.equal(dailyReward(1), 500);
    assert.equal(dailyReward(3), 1500);
    assert.equal(dailyReward(8), 7500, "після 7-го дня — як 7-й");
    assert.deepEqual(touchStreak(p, T0 + 9 * DAY), { lost: 8 }, "пропустив день — згоріло 8");
    assert.equal(p.streak, 1);
  });

  it("курка: не частіше ніж раз на 15 хв і не більше 8 на день", () => {
    const p = newPlayer(ANNA, T0);
    assert.equal(claimChicken(p, T0 + 60_000), "early", "новачку — не одразу");
    let t = T0;
    for (let i = 0; i < 8; i++) assert.equal(claimChicken(p, (t += 15 * 60_000)), null);
    assert.equal(p.chicken_count, 8);
    assert.ok(p.coins >= 8 * CHICKEN.reward);
    assert.equal(claimChicken(p, (t += 15 * 60_000)), "limit");
  });

  it("шифр дня: одне слово на день для всіх, регістр і латинські двійники не важливі", async () => {
    const word = await cipherWord("2026-10-23", "s");
    assert.equal(word, await cipherWord("2026-10-23", "s"));
    assert.ok(await isCipher(` ${word.toLowerCase()} `, "2026-10-23", "s"));
    assert.equal(normalizeWord("Moлoкo"), "МОЛОКО");
    const days = new Set();
    for (let d = 1; d <= 20; d++) days.add(await cipherWord(`2026-11-${String(d).padStart(2, "0")}`, "s"));
    assert.ok(days.size >= 12, "слова змінюються день у день");
  });

  it("ціни покращень: перший рівень — 10 000 / 15 000 / 30 000 / 20 000, далі ростуть; рівнів — 10", () => {
    assert.deepEqual([UPGRADES.tap, UPGRADES.energy, UPGRADES.regen, UPGRADES.passive].map((u) => u.costs[0]), [10_000, 15_000, 30_000, 20_000]);
    for (const { values, costs } of Object.values(UPGRADES)) {
      assert.equal(values.length, 10);
      assert.equal(costs.length, 9);
      assert.ok(costs.every((c, i) => i === 0 || c > costs[i - 1]));
    }
  });
});

describe("гра: API", () => {
  it("перший вхід створює гравця, тапи зараховує сервер", async () => {
    const g = game();
    const me = await g.call("me", ANNA);
    assert.equal(me.isNew, true);
    assert.equal(me.state.coins, 0);
    assert.equal(me.state.energyMax, 500);
    assert.equal(me.refLink, "https://t.me/test_bot?startapp=ref_501");
    g.wait(3000);
    const tap = await g.call("tap", ANNA, { taps: 30 });
    assert.equal(tap.accepted, 30);
    assert.equal(tap.state.coins, 30);
    g.wait(1000);
    const cheat = await g.call("tap", ANNA, { taps: 100_000 });
    assert.equal(cheat.accepted, 18, "автоклікер не пройде: лише 1,5 с невикористаного часу × 12");
  });

  it("покращення: купує, коли вистачає монет, інакше — 409 і нічого не змінює", async () => {
    const g = game();
    await g.call("me", ANNA);
    g.wait(2000);
    const poor = await g.call("upgrade", ANNA, { kind: "tap" });
    assert.equal(poor.status, 409);
    assert.equal(poor.error, "coins");
    g.store.rows.get(501).coins = 25_000;
    const bought = await g.call("upgrade", ANNA, { kind: "tap" });
    assert.equal(bought.status, 200);
    assert.equal(bought.state.perTap, 2);
    assert.equal(bought.state.coins, 15_000);
    assert.equal(bought.state.upgrades.tap.cost, 22_000, "наступний рівень дорожчий");
  });

  it("запрошення: другу — вітальні 500, тому, хто запросив, — 1000 (за друга з Premium — 2500)", async () => {
    const g = game();
    await g.call("me", ANNA);
    const friend = await g.call("me", { id: 777, first_name: "Олег" }, {}, { startParam: "ref_501" });
    assert.equal(friend.welcome, 500);
    assert.equal(friend.state.coins, 500);
    g.wait(1000);
    await g.call("me", BOHDAN, {}, { startParam: "ref_501" });
    await g.call("me", BOHDAN, {}, { startParam: "ref_501" }); // повторний вхід — бонус не вдруге
    const anna = await g.call("me", ANNA);
    assert.equal(anna.state.invited, 2);
    assert.equal(anna.state.refBonus, 3500);
    const self = await g.call("me", { id: 900, first_name: "Сам" }, {}, { startParam: "ref_900" });
    assert.equal(self.welcome, 0, "себе запросити не можна");
  });

  it("рейтинг друзів: я, хто мене запросив, і кого запросив я — за заробленим", async () => {
    const g = game();
    await g.call("me", ANNA);
    await g.call("me", BOHDAN, {}, { startParam: "ref_501" });
    await g.call("me", { id: 777, first_name: "Олег" }, {}, { startParam: "ref_502" });
    g.store.rows.get(777).earned = 9000;
    const { friends } = await g.call("friends", BOHDAN);
    assert.deepEqual(friends.map((f) => [f.name, f.earned]), [["Олег", 9000], ["Анна", 2500], ["Богдан", 1500]]);
    assert.equal(friends.find((f) => f.name === "Олег").ref_reward, 1000, "Олега запросив Богдан");
  });

  it("видалив прогрес і зайшов знову за посиланням — другові бонус удруге не нараховується", async () => {
    const g = game();
    await g.call("me", ANNA);
    await g.call("me", BOHDAN, {}, { startParam: "ref_501" });
    await g.call("delete", BOHDAN);
    const again = await g.call("me", BOHDAN, {}, { startParam: "ref_501" });
    assert.equal(again.welcome, 0);
    assert.equal((await g.call("me", ANNA)).state.refBonus, 2500, "лише перший раз");
  });

  it("завдання: щоденне — раз на день, канал — лише з підпискою, 3 друзі — коли їх 3", async () => {
    const g = game({ member: false });
    await g.call("me", ANNA);
    assert.equal((await g.call("task", ANNA, { id: "daily" })).state.coins, 500);
    assert.equal((await g.call("task", ANNA, { id: "daily" })).error, "done");
    g.wait(24 * 3600_000);
    const day2 = await g.call("task", ANNA, { id: "daily" });
    // 500 (день 1) + 1000 (день 2, серія) + пасивний дохід за 8 год (50/год).
    assert.equal(day2.state.coins, 500 + 1000 + 8 * 50, "наступного дня — знову, і вже 1000 (серія 2 дні)");
    assert.equal(day2.state.streak, 2);
    assert.equal((await g.call("task", ANNA, { id: "channel" })).error, "not_member");
    assert.equal((await g.call("task", ANNA, { id: "friends3" })).error, "not_enough");

    const member = game({ member: true });
    await member.call("me", ANNA);
    assert.equal((await member.call("task", ANNA, { id: "channel" })).state.tasks.channel.done, true);
  });

  it("вогник у грі: зайшов через день — сервер каже, скільки днів згоріло", async () => {
    const g = game();
    await g.call("me", ANNA);
    for (let d = 0; d < 3; d++) {
      g.wait(24 * 3600_000);
      await g.call("me", ANNA);
    }
    g.wait(48 * 3600_000);
    const back = await g.call("me", ANNA);
    assert.equal(back.streakLost, 4);
    assert.equal(back.state.streak, 1);
  });

  it("курка й шифр дня через API", async () => {
    const g = game();
    await g.call("me", ANNA);
    assert.equal((await g.call("chicken", ANNA)).error, "early");
    g.wait(16 * 60_000);
    const caught = await g.call("chicken", ANNA);
    assert.equal(caught.status, 200);
    assert.equal(caught.state.chicken.left, 7);

    const word = await cipherWord(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date(g.now)), "s");
    const wrong = await g.call("cipher", ANNA, { word: "НЕВГАДАВ" });
    assert.equal(wrong.error, "wrong");
    assert.equal(wrong.state.cipher.triesLeft, 4, "неправильна спроба зберігається");
    const right = await g.call("cipher", ANNA, { word });
    assert.equal(right.status, 200);
    assert.equal(right.state.coins, caught.state.coins + 3000);
    assert.equal((await g.call("cipher", ANNA, { word })).error, "done");
  });

  it("видалення прогресу стирає гравця, а в його друзів — посилання на нього", async () => {
    const g = game();
    await g.call("me", ANNA);
    await g.call("me", BOHDAN, {}, { startParam: "ref_501" });
    assert.deepEqual(await g.call("delete", ANNA), { status: 200, ok: true });
    assert.equal(g.store.rows.has(501), false);
    assert.equal(g.store.rows.get(502).referrer, null);
  });
});

describe("гра в боті", () => {
  it("привітання з кнопкою, що відкриває гру; без адреси застосунку — без кнопки", async () => {
    const { harness } = await import("./harness.js");
    const h = harness({ appUrl: "https://app.test/" });
    const [hello] = await h.text("/start");
    assert.match(hello.payload.text, /Гра Ara Farm/);
    assert.deepEqual(hello.payload.reply_markup.inline_keyboard[0][0], { text: "Грати в Ara Farm", web_app: { url: "https://app.test/" } });
    const [plain] = await harness().text("/start");
    assert.equal(plain.payload.reply_markup, undefined);
  });
});

describe("гра: бусти й досягнення", () => {
  it("повна енергія: лише коли енергія не повна, раз на годину, 3 рази на день", async () => {
    const { useBoost } = await import("../src/game/rules.js");
    const p = newPlayer(ANNA, T0);
    assert.equal(useBoost(p, "energy", T0 + 3_600_000), "full", "повну не заповнюємо — щоб буст не пропав");
    const drain = (at) => Object.assign(p, { energy: 10, energy_at: at }); // натапав — енергії майже немає
    let t = T0 + 3_600_000;
    for (let i = 0; i < 3; i++) {
      drain(t);
      assert.equal(useBoost(p, "energy", t), null);
      assert.equal(Math.floor(p.energy), 500);
      drain(t + 60_000);
      assert.equal(useBoost(p, "energy", t + 60_000), i < 2 ? "early" : "limit", "раз на годину");
      t += 3_600_000;
    }
    drain(t);
    assert.equal(useBoost(p, "energy", t), "limit", "3 на день");
  });

  it("турбо: 20 с кожен тап ×5 без енергії, лише у вікні турбо, 2 рази на день", async () => {
    const { useBoost } = await import("../src/game/rules.js");
    const p = newPlayer(ANNA, T0);
    assert.equal(useBoost(p, "turbo", T0 + 1000), null);
    assert.equal(useBoost(p, "turbo", T0 + 2000), "active");
    assert.equal(applyTaps(p, 0, T0 + 4000, 36), 36, "3 с турбо — 36 тапів");
    assert.equal(p.coins, 36 * 5);
    assert.equal(p.energy, 500, "енергія не витрачається");
    assert.equal(applyTaps(p, 0, T0 + 40_000, 50), 0, "турбо скінчилось — турбо-тапи не зараховуються");
    assert.equal(useBoost(p, "turbo", T0 + 60_000), null);
    assert.equal(useBoost(p, "turbo", T0 + 120_000), "limit");
  });

  it("досягнення: забрати можна, лише коли виконано, і лише раз", async () => {
    const { claimAchievement, publicState } = await import("../src/game/rules.js");
    const p = newPlayer(ANNA, T0);
    assert.equal(claimAchievement(p, "tap1k", T0), "not_yet");
    p.total_taps = 1000;
    assert.equal(claimAchievement(p, "tap1k", T0), null);
    assert.equal(p.coins, 1000);
    assert.equal(claimAchievement(p, "tap1k", T0), "done");
    assert.equal(claimAchievement(p, "nope", T0), "unknown");
    const tap10k = publicState(p, T0).achievements.find((a) => a.id === "tap10k");
    assert.deepEqual(tap10k, { id: "tap10k", goal: 10_000, reward: 5_000, progress: 1000, done: false });
    p.streak = 5;
    p.best_streak = 7;
    assert.equal(claimAchievement(p, "streak7", T0), null, "найдовша серія — навіть якщо вогник уже згорів");
  });

  it("бусти й досягнення через API, лічильник тапів", async () => {
    const g = game();
    await g.call("me", ANNA);
    g.wait(3000);
    await g.call("tap", ANNA, { taps: 30 });
    const turbo = await g.call("boost", ANNA, { kind: "turbo" });
    assert.equal(turbo.status, 200);
    assert.equal(turbo.state.boosts.turbo.left, 1);
    g.wait(2000);
    const fast = await g.call("tap", ANNA, { taps: 0, turboTaps: 24 });
    assert.equal(fast.accepted, 24);
    assert.equal(fast.state.coins, 30 + 24 * 5);
    assert.equal(g.store.rows.get(501).total_taps, 54);
    assert.equal((await g.call("achievement", ANNA, { id: "tap1k" })).error, "not_yet");
  });
});
