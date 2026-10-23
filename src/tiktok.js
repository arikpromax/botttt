// TikTok без водяного знака. Джерела по черзі, поки якесь не спрацює:
//   1) сама сторінка TikTok (відео playAddr — без водяного знака, але віддається лише з куками сторінки);
//   2) сервіс tikwm.com (безкоштовно 10 000 запитів на день на IP — на спільних адресах Cloudflare часто вичерпано).
// Джерела змінюються — правити треба лише цей файл.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

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
  const images = (item.imagePost?.images ?? []).map((i) => i.imageURL?.urlList?.[0]).filter(Boolean);
  return {
    source: "tiktok",
    title: item.desc ?? "",
    author: item.author?.uniqueId ?? "",
    video: images.length || !item.video?.playAddr ? null : {
      url: item.video.playAddr,
      size: Number(item.video.size) || 0,
      headers: { "user-agent": UA, referer: "https://www.tiktok.com/", cookie },
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
  return {
    source: "tikwm",
    title: d.title ?? "",
    author: d.author?.unique_id ?? "",
    video: images.length ? null
      : hd ? { url: absolute(d.hdplay), size: d.hd_size }
      : d.play ? { url: absolute(d.play), size: d.size || 0 } : null,
    images,
    music: d.music ? {
      url: absolute(d.music),
      title: d.music_info?.title || "TikTok",
      author: d.music_info?.author || d.author?.nickname || "",
    } : null,
  };
}

export const SOURCES = [fromTikTokPage, fromTikwm];

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
