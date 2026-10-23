// Перевірка, що запит справді з Telegram Mini App (initData, підписаний токеном бота):
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

const MAX_AGE_SECONDS = 24 * 3600; // Telegram видає нові дані при кожному відкритті застосунку

const encoder = new TextEncoder();
const hmac = async (key, data) => {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? encoder.encode(data) : data));
};
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// Підпис initData (для тестів і самої перевірки): HMAC(HMAC("WebAppData", token), рядок полів).
export async function signInitData(fields, token) {
  const checkString = Object.keys(fields).filter((k) => k !== "hash").sort().map((k) => `${k}=${fields[k]}`).join("\n");
  return hex(await hmac(await hmac(encoder.encode("WebAppData"), token), checkString));
}

// → { user, startParam } або null, якщо підпис неправильний чи дані застарілі.
export async function verifyInitData(initData, token, now = Date.now()) {
  if (typeof initData !== "string" || !initData || initData.length > 4096) return null;
  const fields = Object.fromEntries(new URLSearchParams(initData));
  if (!fields.hash || !fields.user) return null;
  const expected = await signInitData(fields, token);
  let diff = expected.length ^ fields.hash.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (fields.hash.charCodeAt(i) || 0);
  if (diff !== 0) return null;
  if (!(now / 1000 - Number(fields.auth_date) < MAX_AGE_SECONDS)) return null;
  try {
    const user = JSON.parse(fields.user);
    return Number.isInteger(user?.id) ? { user, startParam: fields.start_param ?? null } : null;
  } catch {
    return null;
  }
}
