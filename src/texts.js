// Тексти бота й допоміжне форматування.
import { FEATURES } from "./stats.js";

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

const pages = (n) => `${n} ${n === 1 ? "сторінка" : n < 5 ? "сторінки" : "сторінок"}`;
const sum = (by) => Object.values(by).reduce((a, b) => a + b, 0);

// Опис бота в Telegram: description (до 512 символів) — на порожньому чаті, short (до 120) — у профілі.
export const ABOUT = {
  description:
    "Ara Converter — українською, без купи підписок. Надішли щось — і я покажу, що можна зробити:\n\n" +
    "• Посилання на TikTok → відео без водяного знака + звук окремо\n" +
    "• Фото → стиснути, у PDF, скан документа, стікер чи емодзі у твій набір; PNG, WEBP файлом → JPG\n" +
    "• Відео → звук окремим файлом\n" +
    "• Текст → QR-код або латиницею, як у закордонному паспорті\n" +
    "• «100 usd», «50 євро» → переведу за курсом НБУ\n" +
    "• Гра Ara Farm — тапай монети й запрошуй друзів (кнопка «Open»)",
  short: "TikTok без водяного знака, стиснення фото, PDF і скани, стікери й емодзі, QR-коди, курс НБУ. Українською.",
};

// Підказка під фото, надісланим звичайно (Telegram його вже стиснув і перетворив на JPG).
const SEND_AS_FILE =
  `\n\n<i>Щоб стиснути без втрати якості або перетворити PNG/WEBP у JPG — надішли фото <b>файлом</b>: скріпка → Файл.</i>`;

export const t = {
  start:
    `<b>Привіт! Я Ara Converter.</b>\nНадішли мені щось — і я покажу, що з цим можна зробити.\n\n` +
    `<b>Посилання на TikTok</b> → відео без водяного знака й окремо звук\n\n` +
    `<b>Фото</b> →\n` +
    `• стиснути до потрібного розміру\n` +
    `• зробити PDF (з одного фото чи цілого альбому)\n` +
    `• зробити скан документа — чорно-білий PDF, як зі сканера\n` +
    `• зробити стікер — він додасться у твій власний набір\n` +
    `• зробити емодзі чи мозаїку з емодзі (надсилати їх можна з Telegram Premium)\n` +
    `• перетворити в JPG (для PNG і WEBP, надісланих файлом)\n\n` +
    `<b>Відео</b> → звук окремим файлом\n\n` +
    `<b>Текст чи посилання</b> →\n` +
    `• QR-код\n` +
    `• латиницею, як у закордонному паспорті (Ярослав → Yaroslav)\n\n` +
    `<b>Сума з валютою</b> («100 usd», «50 євро», «1000 грн в злоті») → переведу за курсом НБУ. ` +
    `Напиши «курс» — покажу курс на сьогодні.\n\n` +
    `<b>Гра Ara Farm</b> → тапай монети, прокачуй ферму й запрошуй друзів за бонуси. Кнопка нижче.\n\n` +
    `<i>Фото краще надсилати файлом (скріпка → Файл) — так якість не втрачається.</i>`,

  help: `Надішли посилання на TikTok, фото, відео, текст або суму з валютою — і я покажу, що можна зробити.`,
  playButton: "Грати в Ara Farm",

  // ---- Текст: QR-код і латиниця ----
  textMenu: (qr, latin) => latin
    ? `Що зробити з цим текстом?` + (qr ? "" : `\n<i>Для QR-коду він задовгий.</i>`)
    : "Зробити з цього QR-код?",
  qrButton: "QR-код",
  translitButton: "Латиницею",
  qrDone: "QR-код · наведи камеру телефона, щоб відкрити",
  qrTooLong: "Задовгий текст для QR-коду: до ~300 латинських або ~150 українських символів — інакше камера погано його зчитує.",
  qrFailed: "Не вдалося зробити QR-код. Спробуй ще раз.",
  textGone: "Не бачу тексту — надішли його ще раз.",
  translitDone: (latin) =>
    `<code>${esc(latin)}</code>\n\n<i>Латиницею за офіційними правилами — як у закордонному паспорті. Торкнись тексту, щоб скопіювати.</i>`,

  // ---- Валюти ----
  currencyFailed: "Не вдалося отримати курс НБУ. Спробуй трохи пізніше.",

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

  // ---- Фото ----
  photoMenu: (size, width, height, asFile) =>
    `<b>Фото ${formatSize(size)}</b>${width ? ` (${width}×${height})` : ""}\nСтиснути до розміру або перетворити:\n\n` +
    `<i>Свій розмір можна вказати в підписі до фото, наприклад «300 кб».</i>` + (asFile ? "" : SEND_AS_FILE),
  photoMenuSmall: (size, asFile) =>
    `<b>Фото ${formatSize(size)}</b> — уже маленьке, стискати нема куди. Можу перетворити:` + (asFile ? "" : SEND_AS_FILE),
  pdfButton: "У PDF",
  scanButton: "Скан документа",
  stickerButton: "Стікер",
  jpgButton: "У JPG",
  pdfMaking: (n) => (n > 1 ? `Збираю PDF із ${n} фото…` : "Роблю PDF…"),
  pdfDone: (n, size) => `PDF · ${pages(n)} · ${formatSize(size)}`,
  scanMaking: (n) => (n > 1 ? `Сканую ${n} фото…` : "Роблю скан…"),
  scanDone: (n, size) => `Скан · ${pages(n)} · ${formatSize(size)}`,
  jpgMaking: "Перетворюю в JPG…",
  jpgDone: (size) => `JPG · ${formatSize(size)}`,
  albumMenu: (n) => `<b>Альбом: ${n} фото</b>\nЗібрати їх в один PDF? Щоб стиснути фото, надсилай їх по одному.`,
  albumPdfButton: (n) => `Зібрати в PDF (${n} фото)`,
  albumScanButton: "Скан документа в PDF",
  albumGone: "Альбом застарів — надішли фото ще раз.",

  // ---- Стікер ----
  stickerMenu: `<b>Стікер</b>\nПрибрати фон? Для людей, тварин і предметів — так; для мемів і скрінів краще залишити.`,
  stickerCutButton: "Прибрати фон",
  stickerKeepButton: "Залишити як є",
  stickerMaking: "Роблю стікер…",
  stickerSetTitle: (bot) => `Мої стікери · @${bot}`,
  stickerSetButton: "Відкрити мій набір",
  stickerDone: (count, cutFailed) =>
    `<b>Готово!</b> Стікер у твоєму наборі — там уже ${count} шт.` +
    (cutFailed ? `\n<i>Фон прибрати не вдалося, тож стікер із фоном.</i>` : "") +
    `\n\nДодай набір кнопкою нижче — і стікери будуть у тебе в усіх чатах. Змінити емодзі чи видалити стікер можна в @Stickers.`,
  stickerSetFull: "Твій набір заповнений (120 стікерів — це межа Telegram). Видали кілька в @Stickers і спробуй ще раз.",

  // ---- Емодзі ----
  emojiButton: "Емодзі",
  emojiMenu: (premium) =>
    `<b>Емодзі з фото</b>\n` +
    `• <b>Одне емодзі</b> — додасться у твій власний набір емодзі.\n` +
    `• <b>Мозаїка</b> — фото розріжу на 9 або 25 емодзі, які разом складаються в одну картинку.\n\n` +
    (premium
      ? `<i>Надсилати власні емодзі можна лише з Telegram Premium — у тебе він є.</i>`
      : `<b>Потрібен Telegram Premium.</b> Без нього емодзі створяться й будуть видні тут, але надіслати їх в інші чати не вийде.`),
  emojiCutButton: "Одне, без фону",
  emojiKeepButton: "Одне, з фоном",
  mosaicButton: (n) => `Мозаїка ${n}×${n}`,
  emojiMaking: "Роблю емодзі…",
  emojiSetTitle: (bot) => `Мої емодзі · @${bot}`,
  emojiSetButton: "Відкрити мій набір емодзі",
  emojiDone: (count, cutFailed, emoji) =>
    (emoji ? `${emoji} ` : "") + `<b>Готово!</b> Емодзі у твоєму наборі — там уже ${count} шт.` +
    (cutFailed ? `\n<i>Фон прибрати не вдалося, тож емодзі з фоном.</i>` : "") +
    `\n\nДодай набір кнопкою нижче — емодзі з'являться на панелі емодзі. ` +
    `<i>Надсилати власні емодзі можна лише з Telegram Premium.</i>`,
  emojiSetFull: "Твій набір емодзі заповнений (200 — це межа Telegram). Видали кілька в @Stickers і спробуй ще раз.",
  mosaicMaking: (n) => `Ріжу фото на ${n * n} емодзі…`,
  mosaicSetTitle: (bot) => `Мозаїка · @${bot}`,
  mosaicSetButton: "Відкрити набір мозаїки",
  mosaicDone: (n) =>
    `<b>Мозаїка ${n}×${n} готова</b> — вона нижче.\n\n` +
    `Щоб надіслати її комусь, перешли наступне повідомлення або скопіюй його. Для кожної мозаїки — свій набір, ` +
    `його можна додати кнопкою. <i>Надсилати власні емодзі можна лише з Telegram Premium.</i>`,

  // ---- Відео ----
  videoMenu: (size) => `<b>Відео ${formatSize(size)}</b>\nЩо зробити?`,
  soundButton: "Звук із відео",
  soundMaking: "Витягую звук…",
  soundTitle: "Звук із відео",
  noSound: "У цьому відео немає звуку.",
  videoUnsupported: "Цей формат відео поки не підтримується — спробуй MP4 або MOV.",
  soundFailed: "Не вдалося витягти звук. Спробуй ще раз трохи пізніше.",
  videoTooBig: (size) => `Відео ${formatSize(size)} — завелике: Telegram дає ботам файли лише до 20 МБ.`,
  videoGone: "Не бачу відео — надішли його ще раз.",
  compressing: (target) => `Стискаю до ${formatSize(target)}…`,
  compressed: (before, after, width, height) =>
    `Було ${formatSize(before)} → стало <b>${formatSize(after)}</b> (${width}×${height})`,
  compressedNear: (target, after) =>
    `Менше ${formatSize(target)} без втрати читабельності не вийшло — ось найменше: <b>${formatSize(after)}</b>`,
  alreadyUnder: (target, size) => `Фото вже ${formatSize(size)} — це менше за ${formatSize(target)}, стискати не треба.`,
  notSmaller: (size) =>
    `Менше вже не стиснеться без помітної втрати якості — фото й так оптимальне (${formatSize(size)}).`,
  photoTooBig: "Фото завелике: Telegram дає ботам файли лише до 20 МБ.",
  photoUnsupported: "Цей формат фото поки не підтримується. Спробуй JPG, PNG або WEBP.",
  photoFailed: "Не вдалося обробити фото. Спробуй ще раз трохи пізніше.",
  monthLimit: "Ліміт обробки фото на цей місяць вичерпано. Спробуй на початку наступного місяця.",
  photoGone: "Не бачу фото — надішли його ще раз.",

  // ---- /stats (лише власнику) ----
  stats: ({ users, uses }) => {
    const rows = Object.entries(uses.month).sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `${FEATURES[f] ?? f} — <b>${n}</b>${uses.today[f] ? ` (сьогодні ${uses.today[f]})` : ""}`);
    return `<b>Статистика Ara Converter</b>\n\n` +
      `<b>Люди:</b> сьогодні ${users.today} · 7 днів ${users.week} · 30 днів ${users.month}\n` +
      `<b>Дії:</b> сьогодні ${sum(uses.today)} · 7 днів ${sum(uses.week)} · 30 днів ${sum(uses.month)}\n\n` +
      (rows.length ? `<b>За 30 днів</b>\n${rows.join("\n")}` : "Поки що порожньо.") +
      `\n\n<i>Знеособлено: лише хеші, без імен та ідентифікаторів. Записи старші за 90 днів видаляються.</i>`;
  },
  statsFailed: "Не вдалося зібрати статистику — подивись журнал воркера.",
  // ---- Магазин гри за Telegram Stars ----
  shopThanks: (title) => `<b>Оплату отримано!</b> ${esc(title)} — уже в грі. Повертайся й тапай!`,
  shopNoPlayer: "Оплату отримано, але гравця не знайдено. Напиши /paysupport — повернемо Stars.",
  shopBadInvoice: "Цей рахунок застарів. Відкрий гру й спробуй ще раз.",
  shopCantBuy: {
    freeze_max: "У тебе вже 3 захисти вогника — більше не потрібно.",
    full: "Енергія й так повна — купи, коли вона скінчиться.",
    no_player: "Спершу відкрий гру.",
  },
  paySupport:
    `<b>Допомога з оплатою</b>\nУ грі Ara Farm за Telegram Stars можна купити бусти: повну енергію, турбо, ` +
    `прискорене відновлення, захист вогника. Покупка діє одразу після оплати.\n\n` +
    `Якщо щось пішло не так (оплатив, а буст не з'явився, чи купив помилково) — напиши в коментарях каналу @arawebsite ` +
    `або власнику бота: перевіримо й за потреби повернемо Stars.`,
  starsReport: (r) => {
    const names = { energy: "Повна енергія", turbo10: "Турбо ×10", regen2: "Відновлення ×2", freeze: "Захист вогника" };
    const n = (x) => new Intl.NumberFormat("uk-UA").format(x);
    const by = Object.entries(r.byProduct).sort((a, b) => b[1] - a[1]).map(([p, s]) => `${names[p] ?? p} — ${n(s)}`).join("\n");
    const recent = r.recent.map((x) =>
      `${new Date(x.created_at).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" })} · ${names[x.product] ?? x.product} · ${x.stars}${x.refunded ? " · повернено" : ""}\n<code>${esc(x.charge_id)}</code>`).join("\n");
    return `<b>Магазин гри: Telegram Stars</b>\nСьогодні: ${n(r.today)} · 7 днів: ${n(r.week)} · усього: ${n(r.total)} (${n(r.count)} покупок)\n\n` +
      (by ? `<b>За товарами</b>\n${by}\n\n` : "") +
      (recent ? `<b>Останні платежі</b> (id — для /refund)\n${recent}\n\n` : "") +
      `<i>Stars виводяться в TON через Fragment: @BotFather → бот → Balance (Telegram тримає їх ~21 день). ` +
      `Цими TON можна платити гравцям — став /budget як частку доходу.</i>`;
  },
  refundUnknown: "Такого платежу немає. Напиши /refund і id з /stars.",
  refundAlready: "Цей платіж уже повернено.",
  refundDone: (stars) => `Повернено ${stars} Stars.`,

  // ---- Виплати TON у грі ----
  payoutStatus: (s, pendingCount, pendingTon, todayTon) =>
    `<b>Виплати TON у грі: ${s.enabled ? "увімкнено" : "вимкнено"}</b>\n` +
    `Курс: ${new Intl.NumberFormat("uk-UA").format(s.rate)} монет = 1 TON\n` +
    `Мінімальна виплата: ${String(s.minTon).replace(".", ",")} TON\n` +
    `Бюджет на день: ${String(s.budgetTon).replace(".", ",")} TON (сьогодні заявок на ${todayTon} TON)\n` +
    `Чекають рішення: ${pendingCount}${pendingCount ? ` (${pendingTon} TON)` : ""}\n\n` +
    `<b>Команди</b>\n/payouts on — увімкнути, /payouts off — вимкнути\n/rate 1000000 — монет за 1 TON\n` +
    `/minton 0.5 — мінімальна виплата\n/budget 5 — скільки TON на день можна виплатити всім разом\n\n` +
    `<i>Гроші бот не надсилає сам: заявки приходять тобі, ти платиш зі свого гаманця й натискаєш «Виплачено».</i>`,
  payoutBadValue: (command) =>
    ({ rate: "Напиши ціле число не менше 1000, наприклад: /rate 1000000", minton: "Напиши суму в TON, наприклад: /minton 0.5",
      budget: "Напиши суму в TON на день, наприклад: /budget 5" })[command],
  payoutOwner: (w, p) =>
    `<b>Заявка на виплату #${w.id}</b>\n` +
    `Гравець: ${esc(p.name)}${p.username ? ` (@${esc(p.username)})` : ""}, id ${p.id}\n` +
    `Сума: <b>${w.ton} TON</b> (${new Intl.NumberFormat("uk-UA").format(w.coins)} монет)\n` +
    `Гаманець: <code>${esc(w.address)}</code>\n` +
    `У грі з ${new Date(p.created_at).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" })} · ` +
    `зароблено ${new Intl.NumberFormat("uk-UA").format(p.earned)} · тапів ${new Intl.NumberFormat("uk-UA").format(p.total_taps)} · друзів ${p.invited}\n` +
    `Telegram Premium: ${p.premium ? "так" : "ні — будь уважнішим, акаунти ферм майже завжди без Premium"}\n\n` +
    `Заплати зі свого гаманця й натисни «Виплачено». «Відхилити» поверне монети гравцю.`,
  payoutPayButton: "Оплатити в Tonkeeper",
  payoutPaidButton: "Виплачено",
  payoutRejectButton: "Відхилити",
  payoutMarkedPaid: "Виплачено",
  payoutMarkedRejected: "Відхилено — монети повернуто гравцю",
  payoutAlreadyDecided: "Цю заявку вже вирішено.",
  payoutPaid: (ton, address) =>
    `<b>Виплату ${ton} TON надіслано</b> на твій гаманець <code>${esc(address)}</code>.\nДякуємо, що граєш в Ara Farm!`,
  payoutRejected: (ton, coins) =>
    `Заявку на виплату ${ton} TON відхилено. ${new Intl.NumberFormat("uk-UA").format(coins)} монет повернуто на твій баланс у грі.`,

  cipherToday: (word) =>
    `Шифр дня в грі: <b>${esc(word)}</b>\n<i>Бот публікує його в каналі щоранку о 10:00 за Києвом (влітку — об 11:00).</i>`,
};
