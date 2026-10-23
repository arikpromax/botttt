// API гри для Mini App: POST /api/<дія> з тілом { auth: initData, ... }. Відповідь — стан гравця.
// Сервер перевіряє підпис Telegram і сам рахує монети, енергію та нагороди.
import { verifyInitData } from "./auth.js";
import { isCipher } from "./cipher.js";
import { PAYOUT_RULES, checkWithdrawal, formatTon, normalizeAddress } from "./payouts.js";
import {
  REWARDS, activateReferral, applyTaps, buyUpgrade, claimAchievement, claimChicken, claimCipher, claimTask, joinByInvite, kyivDay, newPlayer,
  publicState, settle, touchStreak, useBoost,
} from "./rules.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// store — d1Players / memoryPlayers; token — токен бота; checkMember(userId) — чи підписаний на канал;
// botUsername — для посилання-запрошення; secret — для шифру дня;
// payouts — d1Payouts / memoryPayouts; notifyOwner(withdrawal, player) — заявка на виплату власнику в бот.
export function gameApi({
  store, token, checkMember, botUsername, secret, payouts = null, notifyOwner = async () => {}, clock = () => Date.now(),
}) {
  // Гравець за даними Telegram; новий — створюємо. Прийшов за посиланням уперше в житті — запам'ятовуємо,
  // хто запросив (бонус тому нарахується, коли новачок пограє: activateReferral); хто видалив прогрес
  // і зайшов знову, другому разу бонусу не приносить.
  async function load(auth, now) {
    const existing = await store.get(auth.user.id);
    if (existing) return { p: existing, created: false };
    const p = newPlayer(auth.user, now);
    const refId = Number(/^ref_(\d{1,15})$/.exec(auth.startParam ?? "")?.[1]);
    const invited = refId && refId !== p.id && (await store.get(refId)) && !(await store.wasInvited(p.id));
    if (invited) joinByInvite(p, refId);
    if (!(await store.insert(p))) return { p: await store.get(p.id), created: false };
    if (invited) await store.markInvited(p.id);
    return { p, created: true };
  }

  // Прочитати → змінити → зберегти; якщо паралельний запит устиг раніше — ще раз із свіжими даними.
  // Відмову (error) не зберігаємо, крім тих, що змінюють гравця (keep: неправильна спроба шифру).
  async function mutate(auth, change) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = clock();
      const { p, created } = await load(auth, now);
      const result = change(p, now) ?? {};
      if (result.error && !result.keep) return { p, now, result, created };
      if (await store.save(p)) {
        p.version += 1;
        delete result.keep;
        return { p, now, result, created };
      }
    }
    throw new Error("гравця змінюють занадто часто");
  }

  const reply = ({ p, now, result }, extra = {}) =>
    json({ state: publicState(p, now), ...result, ...extra }, result.error ? 409 : 200);
  const refusal = (error) => (error ? { error } : {});

  const routes = {
    async me(auth) {
      const out = await mutate(auth, (p, now) => {
        // Ім'я й фото могли змінитись у Telegram.
        p.name = [auth.user.first_name, auth.user.last_name].filter(Boolean).join(" ").slice(0, 64) || p.name;
        p.username = auth.user.username ?? null;
        p.photo = auth.user.photo_url ?? p.photo;
        p.premium = auth.user.is_premium ? 1 : 0;
        const { lost } = touchStreak(p, now);
        return { offline: settle(p, now), streakLost: lost >= 2 ? lost : 0 };
      });
      // Виплати: щоб показати на балансі «≈ N TON» (лише коли виплати ввімкнено).
      const s = payouts ? await payouts.settings().catch(() => null) : null;
      return reply(out, {
        isNew: out.created,
        welcome: out.created && out.p.referrer ? REWARDS.welcome : 0,
        refLink: `https://t.me/${botUsername}?startapp=ref_${out.p.id}`,
        payout: s ? { enabled: s.enabled, rate: s.rate } : { enabled: false },
      });
    },
    async tap(auth, body) {
      let activation = null;
      const out = await mutate(auth, (p, now) => {
        const accepted = applyTaps(p, Number(body.taps) || 0, now, Number(body.turboTaps) || 0);
        activation = activateReferral(p);
        return { accepted };
      });
      // Друг натапав 1000 разів — той, хто запросив, отримує бонус (атомарно, після збереження друга).
      if (activation) await store.reward(activation.referrer, activation.amount);
      return reply(out);
    },
    boost: (auth, body) => mutate(auth, (p, now) => refusal(useBoost(p, String(body.kind), now))).then((out) => reply(out)),
    achievement: (auth, body) => mutate(auth, (p, now) => refusal(claimAchievement(p, String(body.id), now))).then((out) => reply(out)),
    upgrade: (auth, body) => mutate(auth, (p, now) => refusal(buyUpgrade(p, String(body.kind), now))).then((out) => reply(out)),
    async task(auth, body) {
      const id = String(body.id);
      const channelMember = id === "channel" ? await checkMember(auth.user.id).catch(() => false) : false;
      return reply(await mutate(auth, (p, now) => refusal(claimTask(p, id, now, { channelMember }))));
    },
    chicken: (auth) => mutate(auth, (p, now) => refusal(claimChicken(p, now))).then((out) => reply(out)),
    async cipher(auth, body) {
      const correct = await isCipher(String(body.word ?? "").slice(0, 40), kyivDay(clock()), secret);
      return reply(await mutate(auth, (p, now) => {
        const error = claimCipher(p, now, correct);
        return error === "wrong" ? { error, keep: true } : refusal(error);
      }));
    },
    // ---- Виплати TON ----
    async payouts(auth) {
      const [settings, p, history] = await Promise.all([payouts.settings(), store.get(auth.user.id), payouts.history(auth.user.id)]);
      if (!p) return json({ error: "no_player" }, 404);
      return json({
        settings: { enabled: settings.enabled, rate: settings.rate, minTon: settings.minTon },
        rules: PAYOUT_RULES, wallet: p.wallet, coins: p.coins, taps: p.total_taps,
        days: Math.floor((clock() - p.created_at) / 86_400_000),
        history: history.map((w) => ({ id: w.id, coins: w.coins, ton: formatTon(w.nano), status: w.status, address: w.address, at: w.created_at })),
      });
    },
    async wallet(auth, body) {
      const address = body.address == null ? null : normalizeAddress(body.address);
      if (body.address != null && !address) return json({ error: "wallet" }, 400);
      // Один гаманець — один гравець: ферма не зведе сотні акаунтів на свій гаманець.
      if (address && (await store.walletOwner(address, auth.user.id))) return json({ error: "wallet_taken" }, 409);
      return reply(await mutate(auth, (p) => ((p.wallet = address), {})), { wallet: address });
    },
    async withdraw(auth, body) {
      const now = clock();
      const coins = Number(body.coins);
      const [settings, p, last, todayNano, member] = await Promise.all([
        payouts.settings(), store.get(auth.user.id), payouts.last(auth.user.id), payouts.dayTotal(kyivDay(now)),
        checkMember(auth.user.id).catch(() => false),
      ]);
      if (!p) return json({ error: "no_player" }, 404);
      const check = checkWithdrawal(p, { settings, coins, member, now, last, todayNano });
      if (check.error) return json({ error: check.error }, 409);
      // Списуємо монети; не вистачило (паралельний запит) — відмова.
      const out = await mutate(auth, (pl) => (pl.coins < coins ? { error: "coins" } : ((pl.coins -= coins), {})));
      if (out.result.error) return reply(out);
      let id;
      try {
        id = await payouts.create({
          user_id: p.id, name: p.name, address: p.wallet, coins, nano: check.nano, day: kyivDay(now), created_at: now,
        });
      } catch (err) {
        await store.refund(p.id, coins); // заявка не записалась — монети назад
        throw err;
      }
      const withdrawal = { id, coins, nano: check.nano, address: p.wallet, ton: formatTon(check.nano) };
      await notifyOwner(withdrawal, out.p).catch((err) => console.error("Заявку не надіслано власнику:", err.message));
      return reply(out, { withdrawal: { id, ton: withdrawal.ton } });
    },

    async friends(auth) {
      const me = await store.get(auth.user.id);
      return json({ friends: await store.friends(auth.user.id, me?.referrer ?? null) });
    },
    async delete(auth) {
      await store.remove(auth.user.id);
      return json({ ok: true });
    },
  };

  return async function handle(request) {
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const route = routes[new URL(request.url).pathname.replace(/^\/api\//, "")];
    if (!route) return json({ error: "not_found" }, 404);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "body" }, 400);
    }
    const auth = await verifyInitData(body?.auth, token, clock());
    if (!auth) return json({ error: "auth" }, 401);
    try {
      return await route(auth, body);
    } catch (err) {
      console.error("Гра:", err.message);
      return json({ error: "server" }, 500);
    }
  };
}
