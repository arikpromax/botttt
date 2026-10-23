// Звук із відео без перекодування: беремо звукову доріжку з MP4/MOV і складаємо окремий файл M4A.
// Якість та сама, що й у відео; процесора майже не потрібно — лише перекладаємо байти.

export class NoAudioError extends Error {}
export class UnsupportedVideoError extends Error {}

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const box = (type, parts) => concat([u32(8 + parts.reduce((n, p) => n + p.length, 0)), ascii(type), ...parts]);

const CONTAINERS = new Set(["trak", "mdia", "minf", "stbl"]);
const AUDIO_CODECS = new Set(["mp4a", "alac"]);

// → { name, codec, bytes (M4A), duration (с) }
export function extractAudio(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const typeAt = (p) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);

  function children(start, end) {
    const out = [];
    for (let p = start; p + 8 <= end;) {
      let size = view.getUint32(p);
      let head = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(p + 8));
        head = 16;
      } else if (size === 0) {
        size = end - p; // до кінця файлу
      }
      if (size < head || p + size > end) break;
      out.push({ type: typeAt(p + 4), p, head, end: p + size });
      p += size;
    }
    return out;
  }
  const kids = (b) => children(b.p + b.head, b.end);
  const find = (list, type) => list.find((b) => b.type === type);

  const top = children(0, bytes.length);
  const moov = find(top, "moov");
  if (!moov) throw new UnsupportedVideoError("немає moov");
  if (find(top, "moof")) throw new UnsupportedVideoError("фрагментований MP4");
  const moovKids = kids(moov);
  const mvhd = find(moovKids, "mvhd");

  const handlerOf = (trak) => {
    const hdlr = find(kids(find(kids(trak), "mdia") ?? { p: 0, head: 0, end: 0 }), "hdlr");
    return hdlr ? typeAt(hdlr.p + 16) : null;
  };
  const trak = moovKids.filter((b) => b.type === "trak").find((t) => handlerOf(t) === "soun");
  if (!trak) throw new NoAudioError("у відео немає звуку");

  const mdia = find(kids(trak), "mdia");
  const mdhd = find(kids(mdia), "mdhd");
  const stbl = find(kids(find(kids(mdia), "minf")), "stbl");
  const stblKids = kids(stbl);
  const stsd = find(stblKids, "stsd");
  const codec = typeAt(stsd.p + 16 + 4);
  if (!AUDIO_CODECS.has(codec)) throw new UnsupportedVideoError(`звук у форматі ${codec}`);

  // Розміри семплів (stsz), семпли в чанках (stsc), зсуви чанків (stco/co64).
  const stsz = find(stblKids, "stsz");
  const fixedSize = view.getUint32(stsz.p + 12);
  const sampleCount = view.getUint32(stsz.p + 16);
  const sampleSize = (i) => fixedSize || view.getUint32(stsz.p + 20 + i * 4);

  const stsc = find(stblKids, "stsc");
  const runs = [];
  for (let i = 0, n = view.getUint32(stsc.p + 12); i < n; i++) {
    const at = stsc.p + 16 + i * 12;
    runs.push({ first: view.getUint32(at), perChunk: view.getUint32(at + 4) });
  }

  const co = find(stblKids, "stco") ?? find(stblKids, "co64");
  const wide = co.type === "co64";
  const chunkCount = view.getUint32(co.p + 12);
  const chunks = [];
  let sample = 0;
  for (let c = 0; c < chunkCount; c++) {
    const offset = wide ? Number(view.getBigUint64(co.p + 16 + c * 8)) : view.getUint32(co.p + 16 + c * 4);
    let run = runs.length - 1;
    while (run > 0 && runs[run].first > c + 1) run--;
    let size = 0;
    for (let k = 0; k < runs[run].perChunk && sample < sampleCount; k++) size += sampleSize(sample++);
    if (offset + size > bytes.length) throw new UnsupportedVideoError("файл обрізаний");
    chunks.push({ offset, size });
  }

  // Новий файл: ftyp, moov (mvhd + лише звукова доріжка з новими зсувами), mdat зі звуком.
  const ftyp = box("ftyp", [ascii("M4A "), u32(0x200), ascii("M4A "), ascii("mp42"), ascii("isom")]);
  const newOffsets = (base) => {
    const out = new Uint8Array(8 + 8 + 4 * chunks.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, out.length);
    out.set(ascii("stco"), 4);
    v.setUint32(12, chunks.length);
    let at = base;
    chunks.forEach((ch, i) => {
      v.setUint32(16 + i * 4, at);
      at += ch.size;
    });
    return out;
  };
  const rebuild = (b, base) => {
    if (b.type === "stco" || b.type === "co64") return newOffsets(base);
    if (!CONTAINERS.has(b.type)) return bytes.subarray(b.p, b.end);
    return box(b.type, kids(b).map((k) => rebuild(k, base)));
  };
  // Тривалість у mvhd — як у звукової доріжки (tkhd у тих самих одиницях часу).
  const tkhd = find(kids(trak), "tkhd");
  const mvhdCopy = bytes.slice(mvhd.p, mvhd.end);
  const mv = new DataView(mvhdCopy.buffer);
  if (bytes[mvhd.p + 8] === 0 && bytes[tkhd.p + 8] === 0) mv.setUint32(24, view.getUint32(tkhd.p + 28));

  const moovSize = box("moov", [mvhdCopy, rebuild(trak, 0)]).length; // розмір не залежить від зсувів
  const base = ftyp.length + moovSize + 8;
  const moovOut = box("moov", [mvhdCopy, rebuild(trak, base)]);
  const audioSize = chunks.reduce((n, ch) => n + ch.size, 0);
  if (base + audioSize > 0xffffffff) throw new UnsupportedVideoError("завеликий файл");
  const out = new Uint8Array(base + audioSize);
  out.set(ftyp);
  out.set(moovOut, ftyp.length);
  new DataView(out.buffer).setUint32(base - 8, 8 + audioSize);
  out.set(ascii("mdat"), base - 4);
  let at = base;
  for (const ch of chunks) {
    out.set(bytes.subarray(ch.offset, ch.offset + ch.size), at);
    at += ch.size;
  }

  const v1 = bytes[mdhd.p + 8] === 1;
  const timescale = view.getUint32(mdhd.p + (v1 ? 28 : 20));
  const duration = v1 ? Number(view.getBigUint64(mdhd.p + 32)) : view.getUint32(mdhd.p + 24);
  return { codec, bytes: out, duration: timescale ? Math.round(duration / timescale) : 0 };
}
