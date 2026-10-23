// Звук у MP4 за початком файлу (заголовок moov): бітрейт AAC у кбіт/с — без ffprobe, щоб обрати версію відео з кращим звуком.
// TikTok кладе moov на початок файлу, тож вистачає перших сотень кілобайт.

const PROBE_BYTES = 256 * 1024;
export const PROBE_RANGE = `bytes=0-${PROBE_BYTES - 1}`;

// Вкладені бокси в межах [start, end); обрізаний бокс (кінець файлу не завантажено) завершує список.
function children(bytes, view, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) {
    let size = view.getUint32(p);
    if (size === 1 && p + 16 <= end) size = Number(view.getBigUint64(p + 8));
    if (size < 8) break;
    out.push({ type: String.fromCharCode(...bytes.subarray(p + 4, p + 8)), p, end: p + size, truncated: p + size > end });
    p += size;
  }
  return out;
}

// → кбіт/с; 0 — у файлі немає звуку; null — не вдалося прочитати (moov не на початку тощо).
export function audioKbps(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inside = (box, type, skip = 8) => box && !box.truncated
    ? children(bytes, view, box.p + skip, box.end).find((b) => b.type === type) : null;

  const moov = children(bytes, view, 0, bytes.length).find((b) => b.type === "moov");
  if (!moov || moov.truncated) return null;
  for (const trak of children(bytes, view, moov.p + 8, moov.end).filter((b) => b.type === "trak")) {
    const mdia = inside(trak, "mdia");
    const hdlr = inside(mdia, "hdlr");
    if (!hdlr || String.fromCharCode(...bytes.subarray(hdlr.p + 16, hdlr.p + 20)) !== "soun") continue;
    const stsd = inside(inside(inside(mdia, "minf"), "stbl"), "stsd");
    if (!stsd) return null;
    const entry = children(bytes, view, stsd.p + 16, stsd.end)[0]; // перший опис звуку (mp4a)
    const esds = entry && children(bytes, view, entry.p + 36, entry.end).find((b) => b.type === "esds");
    if (!esds) return null;
    // ES_Descriptor (0x03) → DecoderConfigDescriptor (0x04): …, maxBitrate, avgBitrate.
    let q = esds.p + 12;
    if (bytes[q++] !== 0x03) return null;
    while (bytes[q++] & 0x80);
    q += 2;
    const flags = bytes[q++];
    if (flags & 0x80) q += 2;
    if (flags & 0x40) q += 1 + bytes[q];
    if (flags & 0x20) q += 2;
    if (bytes[q++] !== 0x04) return null;
    while (bytes[q++] & 0x80);
    q += 5; // objectType, streamType, bufferSize
    const max = view.getUint32(q);
    const avg = view.getUint32(q + 4);
    return Math.round((avg || max) / 1000);
  }
  return 0;
}
