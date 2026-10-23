// TikTok без водяного знака. Джерела по черзі, поки якесь не спрацює:
//   1) сервіс tikwm.com — оригінальна якість (HD, зазвичай 1080p), але безкоштовно лише 10 000 запитів на день
//      на IP, а адреси Cloudflare спільні, тож ліміт часто вичерпаний;
//   2) сама сторінка TikTok — завжди доступна, але максимум 540p (відео playAddr віддається лише з куками сторінки).
// Джерела змінюються — правити треба лише цей файл.

import { audioKbps, PROBE_RANGE } from "./mp4.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const UPLOAD_LIMIT = 50 * 1024 * 1024;

// Сторінка TikTok має кілька версій відео. H.264 (стандартна) — завжди зі звуком лише 32 кбіт/с, а H.265-версії
// часто мають 64 кбіт/с, але буває й зовсім без звуку. Тому читаємо початок кожної (заголовок MP4) і беремо
// версію з найкращим звуком; за рівного звуку — H.264 (найсумісніша), потім більша роздільність.
async function bestVariant(video, headers, fetch) {
  const variants = (video.bitrateInfo ?? [])
    .map((b) => ({
      url: b.PlayAddr?.UrlList?.[0], size: Number(b.PlayAddr?.DataSize) || 0,
      width: Number(b.PlayAddr?.Width) || undefined, height: Number(b.PlayAddr?.Height) || undefined,
      h264: /h264/i.test(b.CodecType ?? ""),
    }))
    .filter((v) => v.url && v.size <= UPLOAD_LIMIT)
    .slice(0, 5);
  if (!variants.length) return null;
  await Promise.all(variants.map(async (v) => {
    try {
      const res = await fetch(v.url, { headers: { ...headers, range: PROBE_RANGE } });
      v.audio = res.ok ? audioKbps(new Uint8Array(await res.arrayBuffer())) : null;
    } catch {
      v.audio = null;
    }
    v.audio ??= v.h264 ? 32 : 0; // не прочитали: H.264 у TikTok завжди зі звуком, H.265 — ризик без звуку
  }));
  const withSound = variants.filter((v) => v.audio > 0);
  withSound.sort((a, b) => b.audio - a.audio || b.h264 - a.h264 || (b.height ?? 0) - (a.height ?? 0));
  return withSound[0] ?? null;
}

// Посилання на TikTok у тексті: tiktok.com/@user/video/…, vm.tiktok.com/…, vt.tiktok.com/… тощо.
export function findTikTokUrl(text) {
  const match = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)?tiktok\.com\/[^\s<>"']+/i.exec(text ?? "");
  if (!match) return null;
  return match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
}

// Результат будь-якого джерела:
// { source, title, author, video: { url, size, headers? } | null, images: [url], music: { url, title, author } | null }
// headers — якщо файл віддається лише з ними (тоді Telegram сам його не завантажить, передає бот).

export async function fromTikTokPage(url, fetch = globalThis.fetch) {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error(`сторінка TikTok: ${res.status}`);
  const html = await res.text();
  const marker = html.indexOf('id="__UNIVERSAL_DATA_FOR_REHYDRATION__"');
  if (marker < 0) throw new Error("сторінка TikTok без даних (капча чи блокування)");
  const from = html.indexOf(">", marker) + 1;
  const detail = JSON.parse(html.slice(from, html.indexOf("</script>", from)))
    ?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  const item = detail?.itemInfo?.itemStruct;
  if (!item) throw new Error(`сторінка TikTok: немає відео (${detail?.statusMsg || detail?.statusCode || "?"})`);

  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const headers = { "user-agent": UA, referer: "https://www.tiktok.com/", cookie };
  const images = (item.imagePost?.images ?? []).map((i) => i.imageURL?.urlList?.[0]).filter(Boolean);
  const v = item.video;
  const best = images.length || !v?.playAddr ? null : await bestVariant(v, headers, fetch);
  return {
    source: "tiktok",
    title: item.desc ?? "",
    author: item.author?.uniqueId ?? "",
    video: images.length || !v?.playAddr ? null : {
      url: best?.url ?? v.playAddr,
      size: best?.size ?? (Number(v.size) || 0),
      headers,
      audioKbps: best?.audio,
      // Для чіткого прев'ю в Telegram: обкладинка, розміри й тривалість.
      cover: v.originCover || v.cover || null,
      width: best?.width ?? (Number(v.width) || undefined),
      height: best?.height ?? (Number(v.height) || undefined),
      duration: Number(v.duration) || undefined,
    },
    images,
    music: item.music?.playUrl
      ? { url: item.music.playUrl, title: item.music.title || "TikTok", author: item.music.authorName || "" }
      : null,
  };
}

const absolute = (url) => (!url ? null : url.startsWith("http") ? url : `https://www.tikwm.com${url}`);

export async function fromTikwm(url, fetch = globalThis.fetch) {
  const res = await fetch(`https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`tikwm: ${res.status}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data) throw new Error(`tikwm: ${json.msg ?? "немає даних"}`);
  const d = json.data;
  const images = Array.isArray(d.images) ? d.images.map(absolute).filter(Boolean) : [];
  // HD, якщо воно є й бот зможе його надіслати (до 50 МБ); інакше звичайне. Обидва без водяного знака.
  const hd = d.hdplay && d.hd_size > 0 && d.hd_size <= 50 * 1024 * 1024;
  const look = { cover: absolute(d.origin_cover || d.cover), duration: Number(d.duration) || undefined };
  return {
    source: "tikwm",
    title: d.title ?? "",
    author: d.author?.unique_id ?? "",
    video: images.length ? null
      : hd ? { url: absolute(d.hdplay), size: d.hd_size, ...look }
      : d.play ? { url: absolute(d.play), size: d.size || 0, ...look } : null,
    images,
    music: d.music ? {
      url: absolute(d.music),
      title: d.music_info?.title || "TikTok",
      author: d.music_info?.author || d.author?.nickname || "",
    } : null,
  };
}

export const SOURCES = [fromTikwm, fromTikTokPage];

export async function resolveTikTok(url, fetch = globalThis.fetch, sources = SOURCES) {
  const errors = [];
  for (const source of sources) {
    try {
      return await source(url, fetch);
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(errors.join("; "));
}
