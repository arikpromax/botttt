// Тексти бота й допоміжне форматування.

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KB = 1024;
const MB = 1024 * KB;

export function formatSize(bytes) {
  if (bytes >= MB) {
    const mb = bytes / MB;
    return `${(Number.isInteger(mb) || mb >= 10 ? Math.round(mb) : mb.toFixed(1).replace(".", ","))} МБ`;
  }
  return `${Math.max(1, Math.round(bytes / KB))} КБ`;
}

export const t = {
  start:
    `<b>Привіт! Я Ara Converter.</b>\n\n` +
    `<b>Що вмію зараз:</b>\n` +
    `• <b>TikTok без водяного знака</b> — надішли посилання, отримаєш відео й окремо звук\n` +
    `• <b>Стиснення фото</b> — надішли фото (краще файлом, щоб не втратити якість) і вибери розмір\n\n` +
    `<b>Скоро:</b> PDF ↔ Word, стиснення відео, звук із відео та інше.`,

  help: `Надішли посилання на TikTok або фото — і я покажу, що можна зробити.`,

  // ---- Підписка ----
  gate: `<b>Потрібна підписка</b>\nЩоб користуватися ботом, підпишись на канал <b>AraWebsite</b>. Це один раз — і все працює.`,
  subscribeButton: "Підписатися на канал",
  checkButton: "Я підписався — продовжити",
  notYet: "Підписки поки не видно. Підпишись на канал і натисни ще раз.",

  // ---- TikTok ----
  ttFailed: "Не вдалося завантажити. Перевір, що відео публічне й посилання правильне, і спробуй ще раз.",
  ttRestricted:
    "TikTok не віддає це відео без входу в акаунт — так буває з відео з віковими обмеженнями. Спробуй трохи пізніше або інше відео.",
  ttTooBig: (url) =>
    `Відео завелике для Telegram (понад 50 МБ).` +
    (url ? ` Завантаж його напряму: <a href="${esc(url)}">відео без водяного знака</a>` : ""),
  ttCaption: (bot) => `Без водяного знака · @${bot}`,

  // ---- Стиснення фото ----
  askSize: (size, width, height) =>
    `<b>Фото ${formatSize(size)}</b>${width ? ` (${width}×${height})` : ""}\nДо якого розміру стиснути?\n\n` +
    `<i>Порада: свій розмір можна вказати в підписі до фото, наприклад «300 кб».</i>`,
  compressing: (target) => `Стискаю до ${formatSize(target)}…`,
  compressed: (before, after, width, height) =>
    `Було ${formatSize(before)} → стало <b>${formatSize(after)}</b> (${width}×${height})`,
  compressedNear: (target, after) =>
    `Менше ${formatSize(target)} без втрати читабельності не вийшло — ось найменше: <b>${formatSize(after)}</b>`,
  alreadySmall: (size) => `Фото вже маленьке — ${formatSize(size)}. Стискати нема куди.`,
  alreadyUnder: (target, size) => `Фото вже ${formatSize(size)} — це менше за ${formatSize(target)}, стискати не треба.`,
  notSmaller: (size) =>
    `Менше вже не стиснеться без помітної втрати якості — фото й так оптимальне (${formatSize(size)}).`,
  photoTooBig: "Фото завелике: Telegram дає ботам файли лише до 20 МБ.",
  photoUnsupported: "Цей формат фото поки не підтримується. Спробуй JPG, PNG або WEBP.",
  photoFailed: "Не вдалося стиснути фото. Спробуй ще раз трохи пізніше.",
  monthLimit: "Ліміт стиснень на цей місяць вичерпано. Спробуй на початку наступного місяця.",
  photoGone: "Не бачу фото, яке треба стиснути. Надішли його ще раз.",
};
