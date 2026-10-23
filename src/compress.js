// Стиснення фото до потрібного розміру через Cloudflare Images (env.IMAGES): обробка йде на їхніх серверах,
// не в ліміті процесора воркера. Безкоштовно — 5000 обробок на місяць; кожна спроба — одна обробка, тому спроб не більше трьох.

const KB = 1024;
const MB = 1024 * KB;

export const SIZE_STEPS = [5 * MB, 3 * MB, 2 * MB, 1 * MB, 500 * KB, 300 * KB, 200 * KB, 100 * KB, 50 * KB];
const MIN_SIZE = 20 * KB;
const MAX_SIDE = 6000; // більше не потрібно навіть для друку

// Варіанти розміру, менші за оригінал хоча б на 10%.
export const sizeChoices = (original) => SIZE_STEPS.filter((s) => s < original * 0.9);

// «300 кб», «1,5 мб», «2mb» → байти; інакше null.
export function parseSize(text) {
  // \b не працює з кирилицею, тому кінець слова — «далі не літера».
  const m = /(\d+(?:[.,]\d+)?)\s*(мб|mb|м|кб|kb|к)(?!\p{L})/iu.exec(text ?? "");
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  const bytes = Math.round(value * (/^(мб|mb|м)$/i.test(m[2]) ? MB : KB));
  return bytes >= MIN_SIZE ? bytes : null;
}

export class MonthLimitError extends Error {}
export class UnsupportedImageError extends Error {}

const streamOf = (bytes) => new Response(bytes).body;

async function render(images, bytes, width, quality) {
  try {
    const result = await images.input(streamOf(bytes))
      .transform({ width })
      .output({ format: "image/jpeg", quality });
    return new Uint8Array(await (await result.response()).arrayBuffer());
  } catch (err) {
    if (String(err?.message ?? err).includes("9422")) throw new MonthLimitError();
    throw err;
  }
}

// Будь-яке фото → JPEG не ширше за maxWidth (із поворотом за EXIF) — для PDF і «У JPG».
export async function toJpeg(images, bytes, { maxWidth, quality }) {
  let info;
  try {
    info = await images.info(streamOf(bytes));
  } catch {
    throw new UnsupportedImageError();
  }
  if (!info?.width) throw new UnsupportedImageError();
  return render(images, bytes, Math.min(info.width, maxWidth), quality);
}

// Стікер Telegram: WEBP, одна сторона рівно 512 px, друга — не більше. cutout — прибрати фон
// (segment: foreground); якщо Cloudflare не зміг — стікер буде з фоном. → { bytes, cutout }
export async function toSticker(images, bytes, { cutout = true } = {}) {
  const make = async (cut) => {
    const transform = { width: 512, height: 512, fit: "contain", ...(cut ? { segment: "foreground" } : {}) };
    const result = await images.input(streamOf(bytes)).transform(transform).output({ format: "image/webp", quality: 90 });
    return new Uint8Array(await (await result.response()).arrayBuffer());
  };
  const limit = (err) => String(err?.message ?? err).includes("9422");
  if (cutout) {
    try {
      return { bytes: await make(true), cutout: true };
    } catch (err) {
      if (limit(err)) throw new MonthLimitError();
      console.warn("Фон не прибрано:", err?.message ?? err);
    }
  }
  try {
    return { bytes: await make(false), cutout: false };
  } catch (err) {
    if (limit(err)) throw new MonthLimitError();
    throw new UnsupportedImageError();
  }
}

// «Скан документа»: чорно-біле, контрастніше, світліше й різкіше, не ширше за A4 у 300 dpi.
export async function toScan(images, bytes) {
  let info;
  try {
    info = await images.info(streamOf(bytes));
  } catch {
    throw new UnsupportedImageError();
  }
  try {
    const result = await images.input(streamOf(bytes))
      .transform({ width: Math.min(info.width, 2480), saturation: 0, contrast: 1.5, brightness: 1.12, sharpen: 1.5 })
      .output({ format: "image/jpeg", quality: 85 });
    return new Uint8Array(await (await result.response()).arrayBuffer());
  } catch (err) {
    if (String(err?.message ?? err).includes("9422")) throw new MonthLimitError();
    throw err;
  }
}

// → { bytes, width, height, size, fits }; fits = false, якщо до target не дотягли й віддаємо найменше, що вийшло.
export async function compressToSize(images, bytes, target) {
  let info;
  try {
    info = await images.info(streamOf(bytes));
  } catch {
    throw new UnsupportedImageError();
  }
  if (!info?.width) throw new UnsupportedImageError();
  const ratio = info.height / info.width;

  const attempts = [];
  const tryRender = async (width, quality) => {
    width = Math.max(320, Math.min(Math.round(width), MAX_SIDE, info.width));
    const out = await render(images, bytes, width, quality);
    attempts.push({ bytes: out, width, height: Math.round(width * ratio), size: out.length });
    return out.length;
  };

  // 1) Без зміни розміру, якість 82 — зазвичай уже значно менше.
  let size = await tryRender(info.width, 82);
  let width = Math.min(info.width, MAX_SIDE);
  // 2) Якщо замало, — нижча якість або менший розмір (розмір JPEG ≈ пропорційний кількості пікселів).
  if (size > target) {
    const need = target / size;
    if (need >= 0.55) size = await tryRender(width, 62);
    else size = await tryRender((width = width * Math.sqrt(need / 0.85)), 75);
  }
  // 3) Остання спроба — дотиснути розмір із запасом.
  if (size > target) {
    width = attempts.at(-1).width * Math.sqrt(target / size) * 0.92;
    size = await tryRender(width, 70);
  }

  const fitting = attempts.filter((a) => a.size <= target);
  const best = fitting.length
    ? fitting.reduce((a, b) => (b.size > a.size ? b : a)) // найякісніше з тих, що вмістились
    : attempts.reduce((a, b) => (b.size < a.size ? b : a)); // інакше — найменше
  return { ...best, fits: fitting.length > 0 };
}
