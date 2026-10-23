// TikTok без водяного знака через сервіс tikwm.com: він віддає прямі посилання на відео, звук і фото зі слайдів.
// Сторонній сервіс може змінитися — тоді правити треба лише цей файл.

const API = "https://www.tikwm.com/api/";

// Посилання на TikTok у тексті: tiktok.com/@user/video/…, vm.tiktok.com/…, vt.tiktok.com/… тощо.
export function findTikTokUrl(text) {
  const match = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)?tiktok\.com\/[^\s<>"']+/i.exec(text ?? "");
  if (!match) return null;
  return match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
}

const absolute = (url) => (!url ? null : url.startsWith("http") ? url : `https://www.tikwm.com${url}`);

// → { title, author, video: { url, size } | null, images: [url] , music: { url, title, author } | null }
export async function resolveTikTok(url, fetch = globalThis.fetch) {
  const res = await fetch(`${API}?hd=1&url=${encodeURIComponent(url)}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`tikwm відповів ${res.status}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data) throw new Error(`tikwm: ${json.msg ?? "немає даних"}`);
  const d = json.data;

  const images = Array.isArray(d.images) ? d.images.map(absolute).filter(Boolean) : [];
  // HD, якщо воно є й бот зможе його надіслати (до 50 МБ); інакше звичайне. Обидва без водяного знака.
  const hd = d.hdplay && d.hd_size > 0 && d.hd_size <= 50 * 1024 * 1024;
  const video = images.length ? null
    : hd ? { url: absolute(d.hdplay), size: d.hd_size }
    : d.play ? { url: absolute(d.play), size: d.size || 0 } : null;

  return {
    title: d.title ?? "",
    author: d.author?.unique_id ?? "",
    video,
    images,
    music: d.music ? {
      url: absolute(d.music),
      title: d.music_info?.title || "TikTok",
      author: d.music_info?.author || d.author?.nickname || "",
    } : null,
  };
}
