// Гра Ara Farm: підпис Telegram, правила й API (сховище в пам'яті, без мережі).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signInitData, verifyInitData } from "../src/game/auth.js";
import { gameApi } from "../src/game/api.js";
import { memoryPlayers } from "../src/game/store.js";
import { applyTaps, levelOf, newPlayer, settle, UPGRADES } from "../src/game/rules.js";

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
  const handle = gameApi({ store, token: TOKEN, botUsername: "test_bot", checkMember: async () => member, clock: () => now });
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
  it("енергія відновлюється до максимуму, тапи — не більше енергії й не швидше за людину", () => {
    const p = newPlayer(ANNA, T0);
    assert.equal(applyTaps(p, 10_000, T0 + 1000), 60, "за 1 с — не більше 20 тапів + запас 40");
    assert.equal(p.coins, 60);
    const later = T0 + 600_000;
    assert.equal(applyTaps(p, 10_000, later), 500, "за 10 хв енергія знову повна — 500");
    assert.equal(applyTaps(p, 5, later + 1), 0, "енергії немає");
    settle(p, later + 100_000);
    assert.equal(Math.floor(p.energy), 100, "1 енергія за секунду");
  });

  it("пасивний дохід: частки монет не губляться, максимум — 8 годин", () => {
    const p = newPlayer(ANNA, T0);
    let gained = 0;
    for (let s = 1; s <= 3600; s++) gained += settle(p, T0 + s * 1000); // синхронізація щосекунди
    assert.equal(gained, 10, "10 монет за годину навіть при частих запитах");
    assert.equal(settle(p, T0 + 3600_000 + 48 * 3600_000), 80, "за дві доби — лише 8 годин");
  });

  it("рівень гравця — за всіма заробленими монетами", () => {
    assert.deepEqual(levelOf(0), { level: 1, from: 0, to: 1000 });
    assert.deepEqual(levelOf(5200), { level: 3, from: 5000, to: 20000 });
    assert.equal(levelOf(1e9).to, null);
  });

  it("ціни покращень ростуть, рівнів — 10", () => {
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
    const tap = await g.call("tap", ANNA, { taps: 50 });
    assert.equal(tap.accepted, 50);
    assert.equal(tap.state.coins, 50);
    g.wait(1000);
    const cheat = await g.call("tap", ANNA, { taps: 100_000 });
    assert.equal(cheat.accepted, 60, "автоклікер не пройде");
  });

  it("покращення: купує, коли вистачає монет, інакше — 409 і нічого не змінює", async () => {
    const g = game();
    await g.call("me", ANNA);
    g.wait(2000);
    const poor = await g.call("upgrade", ANNA, { kind: "tap" });
    assert.equal(poor.status, 409);
    assert.equal(poor.error, "coins");
    g.store.rows.get(501).coins = 1000;
    const bought = await g.call("upgrade", ANNA, { kind: "tap" });
    assert.equal(bought.status, 200);
    assert.equal(bought.state.perTap, 2);
    assert.equal(bought.state.coins, 1000 - UPGRADES.tap.costs[0]);
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
    const { friends } = await g.call("friends", ANNA);
    assert.deepEqual(friends.map((f) => [f.name, f.ref_reward]), [["Богдан", 2500], ["Олег", 1000]]);
    const self = await g.call("me", { id: 900, first_name: "Сам" }, {}, { startParam: "ref_900" });
    assert.equal(self.welcome, 0, "себе запросити не можна");
  });

  it("завдання: щоденне — раз на день, канал — лише з підпискою, 3 друзі — коли їх 3", async () => {
    const g = game({ member: false });
    await g.call("me", ANNA);
    assert.equal((await g.call("task", ANNA, { id: "daily" })).state.coins, 500);
    assert.equal((await g.call("task", ANNA, { id: "daily" })).error, "done");
    g.wait(24 * 3600_000);
    assert.equal((await g.call("task", ANNA, { id: "daily" })).status, 200, "наступного дня — знову");
    assert.equal((await g.call("task", ANNA, { id: "channel" })).error, "not_member");
    assert.equal((await g.call("task", ANNA, { id: "friends3" })).error, "not_enough");

    const member = game({ member: true });
    await member.call("me", ANNA);
    assert.equal((await member.call("task", ANNA, { id: "channel" })).state.tasks.channel.done, true);
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
