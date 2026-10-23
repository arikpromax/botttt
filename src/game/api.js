// API гри для Mini App: POST /api/<дія> з тілом { auth: initData, ... }. Відповідь — стан гравця.
// Сервер перевіряє підпис Telegram і сам рахує монети, енергію та нагороди.
import { verifyInitData } from "./auth.js";
import { REWARDS, applyTaps, buyUpgrade, claimTask, joinByInvite, newPlayer, publicState, settle } from "./rules.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// store — d1Players / memoryPlayers; token — токен бота; checkMember(userId) — чи підписаний на канал;
// botUsername — для посилання-запрошення.
export function gameApi({ store, token, checkMember, botUsername, clock = () => Date.now() }) {
  // Гравець за даними Telegram; новий — створюємо (і даємо бонус за запрошення, якщо прийшов за посиланням).
  async function load(auth, now) {
    const existing = await store.get(auth.user.id);
    if (existing) return { p: existing, created: false };
    const p = newPlayer(auth.user, now);
    const refId = Number(/^ref_(\d{1,15})$/.exec(auth.startParam ?? "")?.[1]);
    const reward = refId && refId !== p.id && (await store.get(refId)) ? joinByInvite(p, refId) : 0;
    if (!(await store.insert(p))) return { p: await store.get(p.id), created: false };
    if (reward) await store.reward(refId, reward);
    return { p, created: true };
  }

  // Прочитати → змінити → зберегти; якщо паралельний запит устиг раніше — ще раз із свіжими даними.
  async function mutate(auth, change) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = clock();
      const { p, created } = await load(auth, now);
      const result = change(p, now) ?? {};
      if (result.error) return { p, now, result, created };
      if (await store.save(p)) {
        p.version += 1;
        return { p, now, result, created };
      }
    }
    throw new Error("гравця змінюють занадто часто");
  }

  const reply = ({ p, now, result }, extra = {}) =>
    json({ state: publicState(p, now), ...result, ...extra }, result.error ? 409 : 200);

  const routes = {
    async me(auth) {
      const out = await mutate(auth, (p, now) => {
        // Ім'я й фото могли змінитись у Telegram.
        p.name = [auth.user.first_name, auth.user.last_name].filter(Boolean).join(" ").slice(0, 64) || p.name;
        p.username = auth.user.username ?? null;
        p.photo = auth.user.photo_url ?? p.photo;
        p.premium = auth.user.is_premium ? 1 : 0;
        return { offline: settle(p, now) };
      });
      return reply(out, {
        isNew: out.created,
        welcome: out.created && out.p.referrer ? REWARDS.welcome : 0,
        refLink: `https://t.me/${botUsername}?startapp=ref_${out.p.id}`,
      });
    },
    tap: (auth, body) => mutate(auth, (p, now) => ({ accepted: applyTaps(p, Number(body.taps) || 0, now) })).then((out) => reply(out)),
    upgrade: (auth, body) => mutate(auth, (p, now) => {
      const error = buyUpgrade(p, String(body.kind), now);
      return error ? { error } : {};
    }).then((out) => reply(out)),
    async task(auth, body) {
      const id = String(body.id);
      const channelMember = id === "channel" ? await checkMember(auth.user.id).catch(() => false) : false;
      const out = await mutate(auth, (p, now) => {
        const error = claimTask(p, id, now, { channelMember });
        return error ? { error } : {};
      });
      return reply(out);
    },
    friends: async (auth) => json({ friends: await store.friends(auth.user.id) }),
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
